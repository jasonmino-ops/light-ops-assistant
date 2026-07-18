/**
 * E-Shop Desktop — Runtime Health 基础版
 *
 * 内存态健康模型；变更即写日志。Milestone A 通过日志与 Tray「查看运行状态」
 * 查看，不做完整运营 UI。
 */

import { logger } from './logger'
import type {
  DeploymentFailure,
  DeploymentHealthComponent,
  DeploymentHealthLevel,
  DeploymentHealthSnapshot,
} from '../shared/deploymentDiagnostics'
import { initialRetryState } from '../shared/deploymentRecovery'

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
  version: string
  uptimeSeconds: number
  lastError: { at: string; scope: string; message: string } | null
  lastCartSequence: number | null
  customerRecovery: { attempts: number; exhausted: boolean }
  deployment: DeploymentHealthSnapshot
  updatedAt: string
}

const startedAtMs = Date.now()

type DeploymentComponentKey =
  | 'application'
  | 'activation'
  | 'cloud'
  | 'provider'
  | 'displays'
  | 'logs'
  | 'system'

function healthComponent(level: DeploymentHealthLevel, stateName: string, message?: string): DeploymentHealthComponent {
  return {
    level,
    state: stateName,
    ...(message ? { message } : {}),
    updatedAt: new Date().toISOString(),
  }
}

function createInitialDeploymentHealth(): DeploymentHealthSnapshot {
  const now = new Date().toISOString()
  return {
    level: 'UNKNOWN',
    application: healthComponent('UNKNOWN', 'starting'),
    activation: healthComponent('UNKNOWN', 'booting'),
    cloud: healthComponent('UNKNOWN', 'not-loaded'),
    provider: healthComponent('UNKNOWN', 'unknown'),
    displays: healthComponent('UNKNOWN', 'unknown'),
    logs: healthComponent('UNKNOWN', 'unknown'),
    system: healthComponent('UNKNOWN', 'unknown'),
    retry: initialRetryState(),
    printerRuntime: 'BROWSER_PRINT',
    printerNativeAvailability: 'NATIVE_NOT_AVAILABLE',
    scannerRuntime: 'KEYBOARD_MODE',
    scannerNativeAvailability: 'NATIVE_NOT_AVAILABLE',
    lastFailure: null,
    lastSuccessfulCloudLoadAt: null,
    updatedAt: now,
  }
}

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
  version: '0.0.0',
  uptimeSeconds: 0,
  lastError: null,
  lastCartSequence: null,
  customerRecovery: { attempts: 0, exhausted: false },
  deployment: createInitialDeploymentHealth(),
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

export function updateDeploymentComponent(
  component: DeploymentComponentKey,
  patch: Partial<DeploymentHealthComponent>,
  logEvent = 'deployment-health.component-updated',
) {
  const current = state.deployment[component]
  state.deployment = aggregateDeploymentHealth({
    ...state.deployment,
    [component]: {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  })
  state.updatedAt = new Date().toISOString()
  logger.info(logEvent, { component, level: state.deployment[component].level, state: state.deployment[component].state })
}

export function updateDeploymentRetry(retry: DeploymentHealthSnapshot['retry'], logEvent = 'deployment.retry-state') {
  state.deployment = aggregateDeploymentHealth({
    ...state.deployment,
    retry: { ...retry },
    updatedAt: new Date().toISOString(),
  })
  state.updatedAt = new Date().toISOString()
  logger.info(logEvent, {
    attempt: retry.attempt,
    state: retry.state,
    lastAction: retry.lastAction,
    lastFailureCode: retry.lastFailureCode,
  })
}

export function recordDeploymentFailure(failure: DeploymentFailure) {
  const component = failure.component === 'BUSINESS_CLOUD'
    ? 'cloud'
    : failure.component === 'ACTIVATION'
      ? 'activation'
      : failure.component === 'PROVIDER'
        ? 'provider'
        : failure.component === 'DISPLAY'
          ? 'displays'
          : failure.component === 'DIAGNOSTICS'
            ? 'logs'
            : 'system'
  const level = failure.healthImpact === 'FAILED' ? 'FAILED' : failure.healthImpact === 'DEGRADED' ? 'DEGRADED' : 'HEALTHY'
  state.deployment = aggregateDeploymentHealth({
    ...state.deployment,
    [component]: {
      ...state.deployment[component],
      level,
      state: failure.code,
      message: failure.title,
      lastFailureCode: failure.code,
      updatedAt: failure.occurredAt,
    },
    lastFailure: { ...failure, metadata: { ...failure.metadata } },
    updatedAt: new Date().toISOString(),
  })
  state.updatedAt = new Date().toISOString()
  logger[failure.severity === 'INFO' ? 'info' : failure.severity === 'WARNING' ? 'warn' : 'error'](failure.logEvent, {
    component: failure.component,
    severity: failure.severity,
    eventCode: failure.code,
    correlationId: failure.correlationId,
    healthImpact: failure.healthImpact,
    metadata: failure.metadata,
  })
}

export function markDeploymentCloudRecovered(at = new Date().toISOString()) {
  state.deployment = aggregateDeploymentHealth({
    ...state.deployment,
    cloud: {
      ...state.deployment.cloud,
      level: 'HEALTHY',
      state: 'loaded',
      message: 'employee cloud page loaded',
      updatedAt: at,
    },
    lastSuccessfulCloudLoadAt: at,
    updatedAt: at,
  })
  state.updatedAt = at
  logger.info('deployment.cloud.recovered', { at })
}

export function getHealthSnapshot(): RuntimeHealthSnapshot {
  const deployment = aggregateDeploymentHealth(deriveDeploymentFromRuntime(state.deployment))
  return {
    ...state,
    displays: { ...state.displays, externalIds: [...state.displays.externalIds] },
    providerRuntime: { ...state.providerRuntime },
    deployment,
    uptimeSeconds: Math.round((Date.now() - startedAtMs) / 1000),
  }
}

function deriveDeploymentFromRuntime(current: DeploymentHealthSnapshot): DeploymentHealthSnapshot {
  const now = new Date().toISOString()
  const application = healthComponent(
    state.app === 'error' ? 'FAILED' : state.app === 'ok' ? 'HEALTHY' : 'UNKNOWN',
    state.app,
  )
  const cloudLevel: DeploymentHealthLevel = current.retry.state === 'PERMANENT_BLOCKED' && current.lastFailure?.component === 'BUSINESS_CLOUD'
    ? 'FAILED'
    : state.employeeWindow === 'ok' && state.cloudReachability === 'ok'
      ? 'HEALTHY'
      : state.employeeWindow === 'error' || state.cloudReachability === 'error' || current.retry.state === 'RETRYING' || current.retry.state === 'WAITING_COOLDOWN'
        ? 'DEGRADED'
        : current.cloud.level
  const providerLevel: DeploymentHealthLevel = state.providerRuntime.state === 'ok'
    ? 'HEALTHY'
    : state.providerRuntime.state === 'unknown' || state.providerRuntime.state === 'starting'
      ? 'UNKNOWN'
      : 'DEGRADED'
  const displayLevel: DeploymentHealthLevel = state.displays.count <= 0
    ? 'UNKNOWN'
    : state.displays.externalIds.length > 0
      ? 'HEALTHY'
      : 'DEGRADED'
  return {
    ...current,
    application: { ...current.application, ...application, updatedAt: now },
    cloud: { ...current.cloud, level: cloudLevel, state: current.retry.state === 'RETRYING' ? 'retrying' : current.cloud.state, updatedAt: now },
    provider: {
      ...current.provider,
      level: providerLevel,
      state: state.providerRuntime.state,
      message: state.providerRuntime.lastError ?? current.provider.message,
      updatedAt: now,
    },
    displays: {
      ...current.displays,
      level: displayLevel,
      state: `${state.displays.count} display(s), ${state.displays.externalIds.length} external`,
      updatedAt: now,
    },
    updatedAt: now,
  }
}

function aggregateDeploymentHealth(input: DeploymentHealthSnapshot): DeploymentHealthSnapshot {
  const components = [
    input.application,
    input.activation,
    input.cloud,
    input.provider,
    input.displays,
    input.logs,
    input.system,
  ]
  const level: DeploymentHealthLevel = components.some((component) => component.level === 'FAILED')
    ? 'FAILED'
    : components.some((component) => component.level === 'DEGRADED')
      ? 'DEGRADED'
      : components.some((component) => component.level === 'UNKNOWN')
        ? 'UNKNOWN'
        : 'HEALTHY'
  return { ...input, level, updatedAt: new Date().toISOString() }
}
