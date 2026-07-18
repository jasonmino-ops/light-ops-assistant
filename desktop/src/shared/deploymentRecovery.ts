import type {
  DeploymentFailure,
  DeploymentFailureDescriptor,
  RetryAction,
  RetryState,
} from './deploymentDiagnostics'

export type DeploymentRetryPolicy = {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
}

export const DEFAULT_DEPLOYMENT_RETRY_POLICY: DeploymentRetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
}

export type RetryTransitionResult = {
  state: RetryState
  action: RetryAction
  delayMs: number
  accepted: boolean
  reason: string
}

export function initialRetryState(nowMs = Date.now(), policy = DEFAULT_DEPLOYMENT_RETRY_POLICY): RetryState {
  return {
    state: 'IDLE',
    attempt: 0,
    maxAttempts: policy.maxAttempts,
    cooldownUntil: null,
    lastAction: 'NONE',
    lastFailureCode: null,
    inFlightCorrelationId: null,
    updatedAt: new Date(nowMs).toISOString(),
  }
}

export function deploymentRetryDelay(attempt: number, policy = DEFAULT_DEPLOYMENT_RETRY_POLICY): number {
  if (attempt <= 0) return 0
  const delay = policy.baseDelayMs * 2 ** (attempt - 1)
  return Math.min(delay, policy.maxDelayMs)
}

export function markRetryFailure(
  current: RetryState,
  failure: DeploymentFailure,
  nowMs = Date.now(),
  policy = DEFAULT_DEPLOYMENT_RETRY_POLICY,
): RetryTransitionResult {
  const attempt = current.state === 'RETRYING' ? current.attempt : current.attempt + 1
  const timestamp = new Date(nowMs).toISOString()
  if (!failure.retryable) {
    return {
      state: {
        ...current,
        state: 'PERMANENT_BLOCKED',
        attempt,
        maxAttempts: policy.maxAttempts,
        cooldownUntil: null,
        lastAction: 'BLOCK',
        lastFailureCode: failure.code,
        inFlightCorrelationId: null,
        updatedAt: timestamp,
      },
      action: 'BLOCK',
      delayMs: 0,
      accepted: true,
      reason: 'failure-not-retryable',
    }
  }
  if (attempt > policy.maxAttempts) {
    return {
      state: {
        ...current,
        state: 'PERMANENT_BLOCKED',
        attempt,
        maxAttempts: policy.maxAttempts,
        cooldownUntil: null,
        lastAction: 'BLOCK',
        lastFailureCode: failure.code,
        inFlightCorrelationId: null,
        updatedAt: timestamp,
      },
      action: 'BLOCK',
      delayMs: 0,
      accepted: true,
      reason: 'retry-budget-exhausted',
    }
  }
  const delayMs = deploymentRetryDelay(attempt, policy)
  return {
    state: {
      state: delayMs > 0 ? 'WAITING_COOLDOWN' : 'FAILED',
      attempt,
      maxAttempts: policy.maxAttempts,
      cooldownUntil: delayMs > 0 ? new Date(nowMs + delayMs).toISOString() : null,
      lastAction: delayMs > 0 ? 'WAIT' : 'NONE',
      lastFailureCode: failure.code,
      inFlightCorrelationId: null,
      updatedAt: timestamp,
    },
    action: delayMs > 0 ? 'WAIT' : 'NONE',
    delayMs,
    accepted: true,
    reason: 'retryable-failure',
  }
}

export function beginRetry(
  current: RetryState,
  descriptor: DeploymentFailureDescriptor,
  correlationId: string,
  nowMs = Date.now(),
  manual = false,
): RetryTransitionResult {
  if (!descriptor.retryable) {
    return {
      state: {
        ...current,
        state: 'PERMANENT_BLOCKED',
        lastAction: 'BLOCK',
        inFlightCorrelationId: null,
        updatedAt: new Date(nowMs).toISOString(),
      },
      action: 'BLOCK',
      delayMs: 0,
      accepted: false,
      reason: 'descriptor-not-retryable',
    }
  }
  if (current.state === 'RETRYING') {
    return {
      state: current,
      action: 'NONE',
      delayMs: 0,
      accepted: false,
      reason: 'retry-already-in-flight',
    }
  }
  const cooldownUntilMs = current.cooldownUntil ? Date.parse(current.cooldownUntil) : 0
  if (!manual && cooldownUntilMs > nowMs) {
    return {
      state: current,
      action: 'WAIT',
      delayMs: cooldownUntilMs - nowMs,
      accepted: false,
      reason: 'cooldown-active',
    }
  }
  if (current.attempt > current.maxAttempts) {
    return {
      state: {
        ...current,
        state: 'PERMANENT_BLOCKED',
        cooldownUntil: null,
        lastAction: 'BLOCK',
        inFlightCorrelationId: null,
        updatedAt: new Date(nowMs).toISOString(),
      },
      action: 'BLOCK',
      delayMs: 0,
      accepted: false,
      reason: 'retry-budget-exhausted',
    }
  }
  return {
    state: {
      ...current,
      state: 'RETRYING',
      cooldownUntil: null,
      lastAction: 'RETRY',
      inFlightCorrelationId: correlationId,
      updatedAt: new Date(nowMs).toISOString(),
    },
    action: 'RETRY',
    delayMs: 0,
    accepted: true,
    reason: manual ? 'manual-retry' : 'cooldown-complete',
  }
}

export function completeRetrySuccess(current: RetryState, correlationId: string, nowMs = Date.now()): RetryTransitionResult {
  if (current.state === 'RETRYING' && current.inFlightCorrelationId && current.inFlightCorrelationId !== correlationId) {
    return {
      state: current,
      action: 'NONE',
      delayMs: 0,
      accepted: false,
      reason: 'stale-retry-result',
    }
  }
  return {
    state: {
      state: 'RECOVERED',
      attempt: 0,
      maxAttempts: current.maxAttempts,
      cooldownUntil: null,
      lastAction: 'NONE',
      lastFailureCode: null,
      inFlightCorrelationId: null,
      updatedAt: new Date(nowMs).toISOString(),
    },
    action: 'NONE',
    delayMs: 0,
    accepted: true,
    reason: 'retry-succeeded',
  }
}
