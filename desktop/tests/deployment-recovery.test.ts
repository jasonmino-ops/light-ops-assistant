import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DEPLOYMENT_RETRY_POLICY,
  beginRetry,
  completeRetrySuccess,
  deploymentRetryDelay,
  initialRetryState,
  markRetryFailure,
} from '../src/shared/deploymentRecovery'
import { classifyDeploymentFailure, getDeploymentFailureDescriptor } from '../src/shared/deploymentDiagnostics'

describe('deployment retry state machine', () => {
  it('uses bounded exponential backoff', () => {
    expect(deploymentRetryDelay(1)).toBe(1000)
    expect(deploymentRetryDelay(2)).toBe(2000)
    expect(deploymentRetryDelay(3)).toBe(4000)
    expect(deploymentRetryDelay(6)).toBe(30000)
  })

  it('moves retryable cloud failures into cooldown and then retrying', () => {
    const now = Date.UTC(2026, 6, 18, 8, 0, 0)
    const failure = classifyDeploymentFailure({
      component: 'BUSINESS_CLOUD',
      electronErrorCode: -105,
      occurredAt: new Date(now).toISOString(),
      correlationId: 'c1',
    })
    const failed = markRetryFailure(initialRetryState(now), failure, now)
    expect(failed.state.state).toBe('WAITING_COOLDOWN')
    expect(failed.state.attempt).toBe(1)
    expect(failed.delayMs).toBe(1000)

    const blockedByCooldown = beginRetry(
      failed.state,
      getDeploymentFailureDescriptor(failure.code),
      'c2',
      now + 500,
      false,
    )
    expect(blockedByCooldown.accepted).toBe(false)
    expect(blockedByCooldown.reason).toBe('cooldown-active')

    const retrying = beginRetry(
      failed.state,
      getDeploymentFailureDescriptor(failure.code),
      'c2',
      now + 1000,
      false,
    )
    expect(retrying.accepted).toBe(true)
    expect(retrying.state.state).toBe('RETRYING')
  })

  it('deduplicates in-flight retries and rejects stale success', () => {
    const now = Date.UTC(2026, 6, 18, 8, 0, 0)
    const descriptor = getDeploymentFailureDescriptor('BUSINESS_CLOUD_TIMEOUT')
    const retrying = beginRetry(
      { ...initialRetryState(now), state: 'FAILED', attempt: 1, lastFailureCode: 'BUSINESS_CLOUD_TIMEOUT' },
      descriptor,
      'live',
      now,
      true,
    )
    expect(retrying.accepted).toBe(true)

    const duplicate = beginRetry(retrying.state, descriptor, 'second', now + 1, true)
    expect(duplicate.accepted).toBe(false)
    expect(duplicate.reason).toBe('retry-already-in-flight')

    const stale = completeRetrySuccess(retrying.state, 'old', now + 2)
    expect(stale.accepted).toBe(false)
    expect(stale.state.state).toBe('RETRYING')

    const success = completeRetrySuccess(retrying.state, 'live', now + 3)
    expect(success.accepted).toBe(true)
    expect(success.state.state).toBe('RECOVERED')
    expect(success.state.attempt).toBe(0)
  })

  it('permanently blocks non-retryable authorization failures', () => {
    const now = Date.UTC(2026, 6, 18, 8, 0, 0)
    const failure = classifyDeploymentFailure({
      component: 'BUSINESS_CLOUD',
      statusCode: 403,
      occurredAt: new Date(now).toISOString(),
    })
    const result = markRetryFailure(initialRetryState(now), failure, now)
    expect(result.state.state).toBe('PERMANENT_BLOCKED')
    expect(result.action).toBe('BLOCK')
    expect(result.reason).toBe('failure-not-retryable')
  })

  it('blocks after the retry budget is exhausted', () => {
    const now = Date.UTC(2026, 6, 18, 8, 0, 0)
    const failure = classifyDeploymentFailure({ component: 'BUSINESS_CLOUD', electronErrorCode: -7 })
    const current = {
      ...initialRetryState(now),
      state: 'FAILED' as const,
      attempt: DEFAULT_DEPLOYMENT_RETRY_POLICY.maxAttempts,
    }
    const result = markRetryFailure(current, failure, now)
    expect(result.state.state).toBe('PERMANENT_BLOCKED')
    expect(result.reason).toBe('retry-budget-exhausted')
  })
})
