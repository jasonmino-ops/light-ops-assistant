/**
 * E-Shop Desktop — Runtime Health 基础版
 *
 * 内存态健康模型；变更即写日志。Milestone A 通过日志与 Tray「查看运行状态」
 * 查看，不做完整运营 UI。
 */

import { logger } from './logger'

export type ComponentStatus = 'unknown' | 'starting' | 'ok' | 'degraded' | 'error' | 'closed'

export type RuntimeHealthSnapshot = {
  app: ComponentStatus
  employeeWindow: ComponentStatus
  customerWindow: ComponentStatus
  ipc: ComponentStatus
  displays: { count: number; primaryId: number | null; externalIds: number[] }
  network: ComponentStatus
  cloudReachability: ComponentStatus
  hardwareRuntime: ComponentStatus
  providerRuntime: {
    state: ComponentStatus
    pid: number | null
    providerId?: string
    providerInstanceId?: string
    pipeNameHash?: string
    lastError: string | null
    restartAttempts?: number
  }
  printerRuntime: {
    providerConnected: boolean
    printerCapabilityAvailable: boolean
    configuredPrinterName: string | null
    printerExecutorAvailable: boolean
    lastPrintCommandAt: string | null
    lastPrintOutcome: string | null
    lastPrintError: string | null
  }
  storeRuntime: {
    state: ComponentStatus
    cloudConnection: ComponentStatus
    storeId: string | null
    storeCode: string | null
    deviceId: string | null
    bindingVersion: number | null
    lastHeartbeatAt: string | null
    lastTaskId: string | null
    lastTaskStatus: string | null
    lastResultCode: string | null
    lastError: string | null
  }
  autoStart: {
    supported: boolean
    configured: boolean
    lastError: string | null
  }
  version: string
  uptimeSeconds: number
  lastError: { at: string; scope: string; message: string } | null
  lastCartSequence: number | null
  customerRecovery: { attempts: number; exhausted: boolean }
  updatedAt: string
}

const startedAtMs = Date.now()

const state: RuntimeHealthSnapshot = {
  app: 'starting',
  employeeWindow: 'unknown',
  customerWindow: 'unknown',
  ipc: 'unknown',
  displays: { count: 0, primaryId: null, externalIds: [] },
  network: 'unknown',
  cloudReachability: 'unknown',
  hardwareRuntime: 'unknown',
  providerRuntime: { state: 'unknown', pid: null, lastError: null },
  printerRuntime: {
    providerConnected: false,
    printerCapabilityAvailable: false,
    configuredPrinterName: null,
    printerExecutorAvailable: false,
    lastPrintCommandAt: null,
    lastPrintOutcome: null,
    lastPrintError: null,
  },
  storeRuntime: {
    state: 'unknown',
    cloudConnection: 'unknown',
    storeId: null,
    storeCode: null,
    deviceId: null,
    bindingVersion: null,
    lastHeartbeatAt: null,
    lastTaskId: null,
    lastTaskStatus: null,
    lastResultCode: null,
    lastError: null,
  },
  autoStart: { supported: false, configured: false, lastError: null },
  version: '0.0.0',
  uptimeSeconds: 0,
  lastError: null,
  lastCartSequence: null,
  customerRecovery: { attempts: 0, exhausted: false },
  updatedAt: new Date().toISOString(),
}

export function updateHealth(patch: Partial<RuntimeHealthSnapshot>, logEvent = 'health.updated') {
  Object.assign(state, patch)
  state.updatedAt = new Date().toISOString()
  logger.info(logEvent, patch)
}

export function recordHealthError(scope: string, message: string) {
  state.lastError = { at: new Date().toISOString(), scope, message: message.slice(0, 500) }
  state.updatedAt = new Date().toISOString()
  logger.error('health.error', { scope, message: message.slice(0, 500) })
}

export function getHealthSnapshot(): RuntimeHealthSnapshot {
  return {
    ...state,
    displays: { ...state.displays, externalIds: [...state.displays.externalIds] },
    providerRuntime: { ...state.providerRuntime },
    printerRuntime: { ...state.printerRuntime },
    storeRuntime: { ...state.storeRuntime },
    autoStart: { ...state.autoStart },
    uptimeSeconds: Math.round((Date.now() - startedAtMs) / 1000),
  }
}
