import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { ActivationRuntime } from './activationRuntime'
import type { ActivationInput, ActivationIpcResult } from './activationTypes'
import type { ActivationWindowController } from './activationWindowController'
import { logger } from '../logger'

export const ACTIVATION_IPC_CHANNELS = {
  GET_STATE: 'eshop:activation:get-state',
  ACTIVATE: 'eshop:activation:activate',
  RETRY_VERIFY: 'eshop:activation:retry-verify',
  RESET_LOCAL: 'eshop:activation:reset-local',
  QUIT: 'eshop:activation:quit',
  STATE_CHANGED: 'eshop:activation:state-changed',
} as const

export type RegisterActivationIpcOptions = {
  runtime: ActivationRuntime
  windowController: ActivationWindowController
  onQuit: () => void
}

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

export function validateActivationInput(payload: unknown): ActivationInput | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const record = payload as Record<string, unknown>
  const storeCode = normalizeStoreCode(record.storeCode)
  const pin = normalizePin(record.pin)
  if (!storeCode || !pin) return null
  return { storeCode, pin }
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
  const { runtime, windowController, onQuit } = options

  ipcMain.handle(ACTIVATION_IPC_CHANNELS.GET_STATE, async (event): Promise<ActivationIpcResult> => {
    if (!authorize(windowController, event, ACTIVATION_IPC_CHANNELS.GET_STATE)) return { ok: false, error: 'UNAUTHORIZED' }
    return { ok: true, state: runtime.getPublicState() }
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
