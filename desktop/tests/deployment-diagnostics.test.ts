import { describe, expect, it } from 'vitest'
import {
  classifyDeploymentFailure,
  containsSecretPattern,
  getDeploymentFailureDescriptor,
  listDeploymentFailureDescriptors,
  maskStoreCode,
  sanitizeDeploymentMetadata,
  shortenInstallationId,
} from '../src/shared/deploymentDiagnostics'

describe('deployment failure taxonomy', () => {
  it('classifies common employee cloud failures deterministically', () => {
    expect(classifyDeploymentFailure({
      component: 'BUSINESS_CLOUD',
      electronErrorCode: -105,
      description: 'ERR_NAME_NOT_RESOLVED',
    }).code).toBe('BUSINESS_CLOUD_DNS_FAILURE')

    expect(classifyDeploymentFailure({
      component: 'BUSINESS_CLOUD',
      electronErrorCode: -202,
      description: 'ERR_CERT_AUTHORITY_INVALID',
    }).code).toBe('BUSINESS_CLOUD_TLS_FAILURE')

    expect(classifyDeploymentFailure({
      component: 'BUSINESS_CLOUD',
      statusCode: 503,
    }).code).toBe('BUSINESS_CLOUD_HTTP_ERROR')

    expect(classifyDeploymentFailure({
      component: 'BUSINESS_CLOUD',
      statusCode: 403,
    }).code).toBe('BUSINESS_CLOUD_UNAUTHORIZED')
  })

  it('maps activation states without exposing secret-shaped fields', () => {
    const failure = classifyDeploymentFailure({
      component: 'ACTIVATION',
      activationKind: 'SAFE_STORAGE_UNAVAILABLE',
      metadata: {
        activationState: 'SAFE_STORAGE_UNAVAILABLE',
        deviceToken: 'secret-token',
        pin: '123456',
      },
    })
    expect(failure.code).toBe('ACTIVATION_SAFE_STORAGE_UNAVAILABLE')
    expect(failure.retryable).toBe(false)
    expect(JSON.stringify(failure)).not.toMatch(/secret-token|123456|deviceToken|pin/i)
  })

  it('keeps descriptors support-readable and complete', () => {
    const descriptors = listDeploymentFailureDescriptors()
    expect(descriptors.length).toBeGreaterThanOrEqual(30)
    for (const descriptor of descriptors) {
      expect(descriptor.code).toBeTruthy()
      expect(descriptor.title).toBeTruthy()
      expect(descriptor.explanation).toBeTruthy()
      expect(descriptor.recommendedAction).toBeTruthy()
      expect(descriptor.logEvent).toMatch(/^deployment\./)
    }
  })

  it('only keeps descriptor allowlisted metadata fields', () => {
    const safe = sanitizeDeploymentMetadata('BUSINESS_CLOUD_HTTP_ERROR', {
      statusCode: 502,
      phase: 'employee-load',
      url: 'https://example.invalid/secret?deviceToken=abc',
      stack: 'stack should not cross the renderer boundary',
    })
    expect(safe).toEqual({ statusCode: 502, phase: 'employee-load' })
    expect(getDeploymentFailureDescriptor('BUSINESS_CLOUD_HTTP_ERROR').metadataAllowlist).not.toContain('url')
  })

  it('detects secret patterns and masks deployment identifiers', () => {
    expect(containsSecretPattern({ Authorization: 'Bearer abc' })).toBe(true)
    expect(containsSecretPattern({ safe: 'network timeout' })).toBe(false)
    expect(maskStoreCode('STORE-A')).toBe('ST***-A')
    expect(shortenInstallationId('installation-1234567890')).toBe('inst-7890')
  })
})
