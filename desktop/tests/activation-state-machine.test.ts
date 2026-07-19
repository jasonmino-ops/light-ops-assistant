import { describe, expect, it, vi } from 'vitest'
import { ActivationRuntime } from '../src/main/activation/activationRuntime'
import type {
  ActivationCredentialV1,
  ActivationMetadataV1,
  CloudActivateResult,
  CloudVerifyResult,
  PublicDeviceIdentity,
  PublicSubscriptionState,
} from '../src/main/activation/activationTypes'

const device: PublicDeviceIdentity = {
  deviceId: 'device-001',
  tenantId: 'tenant-001',
  storeId: 'store-001',
  storeCode: 'STORE-A',
  status: 'ACTIVE',
  tokenExpiresAt: '2027-01-01T00:00:00.000Z',
  credentialVersion: 1,
}

const subscription: PublicSubscriptionState = {
  accessState: 'ACTIVE',
  status: 'ACTIVE',
  warning: null,
}

function credential(value = 'test-device-token-value-000000000000'): ActivationCredentialV1 {
  return { schemaVersion: 1, deviceToken: value }
}

function makeRuntime(options: {
  storedCredential?: ActivationCredentialV1 | null
  verifyResult?: CloudVerifyResult
  activateResult?: CloudActivateResult
  encryptionAvailable?: boolean
  ensureInstallationReject?: boolean
} = {}) {
  let storedCredential = options.storedCredential
  const store = {
    ensureInstallation: vi.fn(async () => {
      if (options.ensureInstallationReject) throw new Error('installation fs failed')
      return {
        schemaVersion: 1 as const,
        installationId: '11111111-1111-4111-8111-111111111111',
        createdAt: '2026-01-01T00:00:00.000Z',
      }
    }),
    readMetadata: vi.fn(async (): Promise<ActivationMetadataV1 | null> => ({
      schemaVersion: 1,
      storeCodeHint: 'STORE-A',
    })),
    isEncryptionAvailable: vi.fn(() => options.encryptionAvailable ?? true),
    readCredential: vi.fn(async () => storedCredential
      ? { ok: true as const, credential: storedCredential }
      : { ok: false as const, reason: 'missing' as const }),
    writeCredential: vi.fn(async (next: ActivationCredentialV1) => {
      storedCredential = next
      return { ok: true as const }
    }),
    updateVerifiedMetadata: vi.fn(async () => undefined),
    resetLocalActivation: vi.fn(async () => {
      storedCredential = null
    }),
  }
  const api = {
    verify: vi.fn(async () => options.verifyResult ?? { ok: true as const, device, subscription }),
    activate: vi.fn(async () => options.activateResult ?? {
      ok: true as const,
      deviceToken: 'test-device-token-value-111111111111',
      tokenExpiresAt: device.tokenExpiresAt,
      device,
      subscription,
    }),
  }
  const startAuthorizedRuntime = vi.fn(async () => undefined)
  const runtime = new ActivationRuntime({
    credentialStore: store as never,
    apiClient: api as never,
    startAuthorizedRuntime,
    initialStoreCodeHint: 'STORE-A',
  })
  return { runtime, store, api, startAuthorizedRuntime }
}

describe('activation runtime state machine', () => {
  it('shows activation state when no credential exists', async () => {
    const { runtime, startAuthorizedRuntime } = makeRuntime({ storedCredential: null })
    await runtime.initialize()
    expect(runtime.getPublicState()).toMatchObject({ kind: 'UNACTIVATED', canActivate: true })
    expect(startAuthorizedRuntime).not.toHaveBeenCalled()
  })

  it('verifies a valid credential and starts formal runtime once', async () => {
    const { runtime, api, startAuthorizedRuntime } = makeRuntime({ storedCredential: credential() })
    await runtime.initialize()
    await runtime.retryVerification()
    expect(api.verify).toHaveBeenCalledTimes(2)
    expect(startAuthorizedRuntime).toHaveBeenCalledTimes(1)
    expect(runtime.getPublicState()).toMatchObject({ kind: 'AUTHORIZED_RUNNING' })
  })

  it('keeps token local and enters blocked state when subscription is blocked', async () => {
    const { runtime, startAuthorizedRuntime } = makeRuntime({
      storedCredential: credential(),
      verifyResult: {
        ok: false,
        kind: 'HTTP',
        status: 403,
        errorCode: 'SUBSCRIPTION_BLOCKED',
        subscription: { accessState: 'BLOCKED', status: 'EXPIRED', warning: null },
      },
    })
    await runtime.initialize()
    expect(runtime.getPublicState()).toMatchObject({ kind: 'SUBSCRIPTION_BLOCKED', canRetryVerify: true })
    expect(startAuthorizedRuntime).not.toHaveBeenCalled()
  })

  it('returns revoked credentials to reactivation flow', async () => {
    const { runtime, startAuthorizedRuntime } = makeRuntime({
      storedCredential: credential(),
      verifyResult: {
        ok: false,
        kind: 'HTTP',
        status: 403,
        errorCode: 'DESKTOP_DEVICE_REVOKED',
      },
    })
    await runtime.initialize()
    expect(runtime.getPublicState()).toMatchObject({
      kind: 'DEVICE_REVOKED',
      canActivate: true,
      reactivationReason: 'DESKTOP_DEVICE_REVOKED',
    })
    expect(startAuthorizedRuntime).not.toHaveBeenCalled()
  })

  it('stores activation token before verify and does not start on verify network failure', async () => {
    const { runtime, store, startAuthorizedRuntime } = makeRuntime({
      storedCredential: null,
      verifyResult: { ok: false, kind: 'NETWORK', errorCode: 'NETWORK_ERROR' },
    })
    await runtime.initialize()
    const result = await runtime.activate({ storeCode: 'store-a', pin: '123456' })
    expect(store.writeCredential).toHaveBeenCalledTimes(1)
    expect(result.kind).toBe('NETWORK_ERROR')
    expect(result.canRetryVerify).toBe(true)
    expect(startAuthorizedRuntime).not.toHaveBeenCalled()
  })

  it('does not call cloud activate when safeStorage is unavailable', async () => {
    const { runtime, api } = makeRuntime({ encryptionAvailable: false })
    await runtime.initialize()
    await runtime.activate({ storeCode: 'STORE-A', pin: '123456' })
    expect(runtime.getPublicState()).toMatchObject({ kind: 'SAFE_STORAGE_UNAVAILABLE' })
    expect(api.activate).not.toHaveBeenCalled()
  })

  it('serializes repeated activation clicks through one in-flight operation', async () => {
    const { runtime, api, startAuthorizedRuntime } = makeRuntime({ storedCredential: null })
    await runtime.initialize()
    await Promise.all([
      runtime.activate({ storeCode: 'STORE-A', pin: '123456' }),
      runtime.activate({ storeCode: 'STORE-A', pin: '123456' }),
    ])
    expect(api.activate).toHaveBeenCalledTimes(1)
    expect(startAuthorizedRuntime).toHaveBeenCalledTimes(1)
  })

  it('local reset deletes only local activation state', async () => {
    const { runtime, store } = makeRuntime({ storedCredential: credential() })
    await runtime.resetLocalActivation()
    expect(store.resetLocalActivation).toHaveBeenCalledTimes(1)
    expect(runtime.getPublicState()).toMatchObject({ kind: 'UNACTIVATED' })
  })

  it('converts unexpected initialize rejection into STARTUP_ERROR', async () => {
    const { runtime, startAuthorizedRuntime } = makeRuntime({ ensureInstallationReject: true })
    await expect(runtime.initialize()).resolves.toMatchObject({
      kind: 'STARTUP_ERROR',
      errorCode: 'ACTIVATION_INITIALIZE_FAILED',
      isBusy: false,
    })
    expect(runtime.getPublicState()).toMatchObject({ kind: 'STARTUP_ERROR' })
    expect(startAuthorizedRuntime).not.toHaveBeenCalled()
  })
})
