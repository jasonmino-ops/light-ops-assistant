import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { ActivationRuntime } from './activationRuntime'
import type { ActivationInput, ActivationIpcResult, ActivationPublicStateKind } from './activationTypes'
import type { ActivationWindowController } from './activationWindowController'
import { logger } from '../logger'

export const ACTIVATION_IPC_CHANNELS = {
  GET_STATE: 'eshop:activation:get-state',
  ACTIVATE: 'eshop:activation:activate',
  RETRY_VERIFY: 'eshop:activation:retry-verify',
  RESET_LOCAL: 'eshop:activation:reset-local',
  QUIT: 'eshop:activation:quit',
  STATE_CHANGED: 'eshop:activation:state-changed',
  RENDERER_CHECKPOINT: 'eshop:activation:renderer-checkpoint',
} as const

export type ActivationRendererCheckpointStage =
  | 'preload-ready'
  | 'script-started'
  | 'bridge-detected'
  | 'subscribed'
  | 'get-state-started'
  | 'get-state-succeeded'
  | 'get-state-failed'
  | 'rendered'
  | 'startup-error'

export type ActivationRendererCheckpoint = {
  stage: ActivationRendererCheckpointStage
  stateKind?: ActivationPublicStateKind
  reasonCode?: string
}

export type RegisterActivationIpcOptions = {
  runtime: ActivationRuntime
  windowController: ActivationWindowController
  onQuit: () => void
  onRendererCheckpoint?: (checkpoint: ActivationRendererCheckpoint) => void
}

const CHECKPOINT_STAGES: readonly ActivationRendererCheckpointStage[] = [
  'preload-ready',
  'script-started',
  'bridge-detected',
  'subscribed',
  'get-state-started',
  'get-state-succeeded',
  'get-state-failed',
  'rendered',
  'startup-error',
]

const STATE_KINDS: readonly ActivationPublicStateKind[] = [
  'BOOTING',
  'UNACTIVATED',
  'ACTIVATING',
  'VERIFYING',
  'AUTHORIZED_STARTING',
  'AUTHORIZED_RUNNING',
  'STARTUP_ERROR',
  'NETWORK_ERROR',
  'INVALID_PIN',
  'PIN_LOCKED',
  'PIN_EXPIRED',
  'PIN_ALREADY_USED',
  'STORE_NOT_FOUND',
  'TENANT_INACTIVE',
  'STORE_INACTIVE',
  'SUBSCRIPTION_BLOCKED',
  'INSTALLATION_BOUND_TO_OTHER_STORE',
  'SAFE_STORAGE_UNAVAILABLE',
  'CREDENTIAL_CORRUPTED',
  'DEVICE_REVOKED',
  'TOKEN_EXPIRED',
  'REACTIVATION_REQUIRED',
  'SERVER_ERROR',
  'QUITTING',
]

function sanitizeError(error: unknown): string {
  if (!(error instanceof Error)) return 'ACTIVATION_IPC_ERROR'
  if (/token|authorization|bearer|pin|ciphertext/i.test(error.message)) return 'ACTIVATION_IPC_ERROR'
  return error.message.slice(0, 120) || 'ACTIVATION_IPC_ERROR'
}

function normalizeStoreCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  if (!normalized || normalized.length > 64 || !/^[A-Z0-9_-]+$/.test(normalized)) return null
  return normalized
}

function normalizePin(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return /^\d{6}$/.test(normalized) ? normalized : null
}

function normalizeReasonCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  if (/token|authorization|bearer|pin|ciphertext|\b\d{6}\b|\bSTORE[-_][A-Z0-9_-]+\b/i.test(value)) return 'ACTIVATION_RENDERER_ERROR'
  const normalized = value
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return normalized ? normalized.slice(0, 72) : undefined
}

export function validateActivationInput(payload: unknown): ActivationInput | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const record = payload as Record<string, unknown>
  const storeCode = normalizeStoreCode(record.storeCode)
  const pin = normalizePin(record.pin)
  if (!storeCode || !pin) return null
  return { storeCode, pin }
}

export function validateRendererCheckpoint(payload: unknown): ActivationRendererCheckpoint | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const record = payload as Record<string, unknown>
  if (!CHECKPOINT_STAGES.includes(record.stage as ActivationRendererCheckpointStage)) return null
  const checkpoint: ActivationRendererCheckpoint = { stage: record.stage as ActivationRendererCheckpointStage }
  if (record.stateKind !== undefined) {
    if (!STATE_KINDS.includes(record.stateKind as ActivationPublicStateKind)) return null
    checkpoint.stateKind = record.stateKind as ActivationPublicStateKind
  }
  const reasonCode = normalizeReasonCode(record.reasonCode)
  if (reasonCode) checkpoint.reasonCode = reasonCode
  return checkpoint
}

function authorize(windowController: ActivationWindowController, event: IpcMainInvokeEvent, channel: string): boolean {
  const ok = windowController.isActivationSender(event)
  if (!ok) {
    logger.warn('activation-ipc.unauthorized', { channel, webContentsId: event.sender.id })
  }
  return ok
}

async function toResult(action: () => Promise<ActivationIpcResult>): Promise<ActivationIpcResult> {
  try {
    return await action()
  } catch (error) {
    return { ok: false, error: sanitizeError(error) }
  }
}

export function registerActivationIpcHandlers(options: RegisterActivationIpcOptions) {
  const { runtime, windowController, onQuit, onRendererCheckpoint } = options

  ipcMain.handle(ACTIVATION_IPC_CHANNELS.GET_STATE, async (event): Promise<ActivationIpcResult> => {
    if (!authorize(windowController, event, ACTIVATION_IPC_CHANNELS.GET_STATE)) return { ok: false, error: 'UNAUTHORIZED' }
    logger.info('activation-ipc.get-state.invoked', { webContentsId: event.sender.id })
    const state = runtime.getPublicState()
    logger.info('activation-ipc.get-state.completed', { state: state.kind })
    return { ok: true, state }
  })

  ipcMain.handle(ACTIVATION_IPC_CHANNELS.RENDERER_CHECKPOINT, async (event, payload: unknown): Promise<{ ok: boolean; error?: string }> => {
    if (!authorize(windowController, event, ACTIVATION_IPC_CHANNELS.RENDERER_CHECKPOINT)) return { ok: false, error: 'UNAUTHORIZED' }
    const checkpoint = validateRendererCheckpoint(payload)
    if (!checkpoint) return { ok: false, error: 'INVALID_PAYLOAD' }
    onRendererCheckpoint?.(checkpoint)
    return { ok: true }
  })

  ipcMain.handle(ACTIVATION_IPC_CHANNELS.ACTIVATE, async (event, payload: unknown): Promise<ActivationIpcResult> => {
    if (!authorize(windowController, event, ACTIVATION_IPC_CHANNELS.ACTIVATE)) return { ok: false, error: 'UNAUTHORIZED' }
    const input = validateActivationInput(payload)
    if (!input) return { ok: false, error: 'INVALID_PAYLOAD', state: runtime.getPublicState() }
    return toResult(async () => ({ ok: true, state: await runtime.activate(input) }))
  })

  ipcMain.handle(ACTIVATION_IPC_CHANNELS.RETRY_VERIFY, async (event): Promise<ActivationIpcResult> => {
    if (!authorize(windowController, event, ACTIVATION_IPC_CHANNELS.RETRY_VERIFY)) return { ok: false, error: 'UNAUTHORIZED' }
    return toResult(async () => ({ ok: true, state: await runtime.retryVerification() }))
  })

  ipcMain.handle(ACTIVATION_IPC_CHANNELS.RESET_LOCAL, async (event): Promise<ActivationIpcResult> => {
    if (!authorize(windowController, event, ACTIVATION_IPC_CHANNELS.RESET_LOCAL)) return { ok: false, error: 'UNAUTHORIZED' }
    return toResult(async () => ({ ok: true, state: await runtime.resetLocalActivation() }))
  })

  ipcMain.handle(ACTIVATION_IPC_CHANNELS.QUIT, async (event): Promise<ActivationIpcResult> => {
    if (!authorize(windowController, event, ACTIVATION_IPC_CHANNELS.QUIT)) return { ok: false, error: 'UNAUTHORIZED' }
    runtime.markQuitting()
    onQuit()
    return { ok: true, state: runtime.getPublicState() }
  })
}
