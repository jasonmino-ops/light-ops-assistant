import type { ActivationApiClient } from './activationApiClient'
import type { CredentialStore } from './credentialStore'
import type {
  ActivationInput,
  ActivationMetadataV1,
  ActivationPublicState,
  AuthorizedDesktopContext,
  CloudApiFailure,
  PublicDeviceIdentity,
  PublicReactivationReason,
  PublicSubscriptionState,
} from './activationTypes'
import { ACTIVATION_PUBLIC_INITIAL_STATE, isPublicStateSecretFree } from './activationTypes'

type Listener = (state: ActivationPublicState) => void

export type ActivationRuntimeOptions = {
  credentialStore: CredentialStore
  apiClient: ActivationApiClient
  startAuthorizedRuntime: (context: AuthorizedDesktopContext) => Promise<void>
  initialStoreCodeHint?: string
}

function normalizeStoreCode(value: string): string {
  return value.trim().toUpperCase()
}

function normalizePin(value: string): string {
  return value.trim()
}

function state(
  kind: ActivationPublicState['kind'],
  extra: Partial<ActivationPublicState> = {},
): ActivationPublicState {
  const isBusy = kind === 'BOOTING' || kind === 'ACTIVATING' || kind === 'VERIFYING' || kind === 'AUTHORIZED_STARTING'
  const next: ActivationPublicState = {
    kind,
    isBusy,
    canActivate: ['UNACTIVATED', 'INVALID_PIN', 'PIN_EXPIRED', 'PIN_ALREADY_USED', 'STORE_NOT_FOUND', 'REACTIVATION_REQUIRED', 'DEVICE_REVOKED', 'TOKEN_EXPIRED'].includes(kind),
    canRetryVerify: kind === 'NETWORK_ERROR' || kind === 'SERVER_ERROR' || kind === 'SUBSCRIPTION_BLOCKED' || kind === 'TENANT_INACTIVE' || kind === 'STORE_INACTIVE',
    canResetLocal: ['CREDENTIAL_CORRUPTED', 'SAFE_STORAGE_UNAVAILABLE', 'INSTALLATION_BOUND_TO_OTHER_STORE', 'REACTIVATION_REQUIRED', 'DEVICE_REVOKED', 'TOKEN_EXPIRED', 'SERVER_ERROR'].includes(kind),
    canQuit: true,
    ...extra,
  }
  if (!isPublicStateSecretFree(next)) {
    return {
      kind: 'SERVER_ERROR',
      isBusy: false,
      canActivate: false,
      canRetryVerify: false,
      canResetLocal: false,
      canQuit: true,
      errorCode: 'PUBLIC_STATE_REDACTION_FAILED',
    }
  }
  return next
}

function reactivationReason(errorCode: string): PublicReactivationReason | null {
  if (
    errorCode === 'DESKTOP_DEVICE_REVOKED' ||
    errorCode === 'DESKTOP_TOKEN_EXPIRED' ||
    errorCode === 'DESKTOP_DEVICE_UNAUTHORIZED'
  ) {
    return errorCode
  }
  return null
}

function activationFailureToState(failure: CloudApiFailure, storeCodeHint?: string): ActivationPublicState {
  if (failure.kind === 'NETWORK' || failure.kind === 'TIMEOUT') {
    return state('NETWORK_ERROR', { errorCode: failure.errorCode, storeCodeHint, canRetryVerify: false })
  }
  switch (failure.errorCode) {
    case 'INVALID_PIN':
      return state('INVALID_PIN', { errorCode: failure.errorCode, storeCodeHint })
    case 'PIN_LOCKED':
      return state('PIN_LOCKED', {
        errorCode: failure.errorCode,
        retryAfterSeconds: failure.retryAfterSeconds,
        storeCodeHint,
        canActivate: false,
      })
    case 'PIN_EXPIRED':
      return state('PIN_EXPIRED', { errorCode: failure.errorCode, storeCodeHint })
    case 'PIN_ALREADY_USED':
      return state('PIN_ALREADY_USED', { errorCode: failure.errorCode, storeCodeHint })
    case 'STORE_NOT_FOUND':
      return state('STORE_NOT_FOUND', { errorCode: failure.errorCode, storeCodeHint })
    case 'TENANT_INACTIVE':
      return state('TENANT_INACTIVE', { errorCode: failure.errorCode, storeCodeHint })
    case 'STORE_INACTIVE':
      return state('STORE_INACTIVE', { errorCode: failure.errorCode, storeCodeHint })
    case 'SUBSCRIPTION_BLOCKED':
      return state('SUBSCRIPTION_BLOCKED', {
        errorCode: failure.errorCode,
        subscription: failure.subscription,
        storeCodeHint,
      })
    case 'INSTALLATION_BOUND_TO_OTHER_STORE':
      return state('INSTALLATION_BOUND_TO_OTHER_STORE', { errorCode: failure.errorCode, storeCodeHint })
    default:
      return state('SERVER_ERROR', { errorCode: failure.errorCode, storeCodeHint })
  }
}

function verifyFailureToState(failure: CloudApiFailure, storeCodeHint?: string): ActivationPublicState {
  if (failure.kind === 'NETWORK' || failure.kind === 'TIMEOUT') {
    return state('NETWORK_ERROR', { errorCode: failure.errorCode, storeCodeHint, canRetryVerify: true })
  }
  const reason = reactivationReason(failure.errorCode)
  if (reason) {
    return state(reason === 'DESKTOP_TOKEN_EXPIRED' ? 'TOKEN_EXPIRED' : reason === 'DESKTOP_DEVICE_REVOKED' ? 'DEVICE_REVOKED' : 'REACTIVATION_REQUIRED', {
      errorCode: failure.errorCode,
      reactivationReason: reason,
      storeCodeHint,
    })
  }
  switch (failure.errorCode) {
    case 'TENANT_INACTIVE':
      return state('TENANT_INACTIVE', { errorCode: failure.errorCode, storeCodeHint })
    case 'STORE_INACTIVE':
      return state('STORE_INACTIVE', { errorCode: failure.errorCode, storeCodeHint })
    case 'SUBSCRIPTION_BLOCKED':
      return state('SUBSCRIPTION_BLOCKED', {
        errorCode: failure.errorCode,
        subscription: failure.subscription,
        storeCodeHint,
      })
    default:
      return state('SERVER_ERROR', { errorCode: failure.errorCode, storeCodeHint, canRetryVerify: true })
  }
}

export class ActivationRuntime {
  private currentState: ActivationPublicState
  private readonly listeners = new Set<Listener>()
  private installationId: string | null = null
  private activationPromise: Promise<ActivationPublicState> | null = null
  private verifyPromise: Promise<ActivationPublicState> | null = null
  private startPromise: Promise<void> | null = null
  private authorizedContext: AuthorizedDesktopContext | null = null
  private quitting = false

  constructor(private readonly options: ActivationRuntimeOptions) {
    this.currentState = {
      ...ACTIVATION_PUBLIC_INITIAL_STATE,
      storeCodeHint: options.initialStoreCodeHint || undefined,
    }
  }

  onStateChanged(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getPublicState(): ActivationPublicState {
    return { ...this.currentState }
  }

  getDeploymentSummary() {
    return {
      state: this.currentState.kind,
      storeCodeHint: this.currentState.storeCodeHint,
      installationId: this.installationId,
    }
  }

  isAuthorized(): boolean {
    return this.currentState.kind === 'AUTHORIZED_RUNNING' || this.currentState.kind === 'AUTHORIZED_STARTING'
  }

  markQuitting() {
    this.quitting = true
    this.setState(state('QUITTING'))
  }

  async initialize(): Promise<ActivationPublicState> {
    this.setState(state('BOOTING', { storeCodeHint: this.options.initialStoreCodeHint || undefined }))
    const installation = await this.options.credentialStore.ensureInstallation()
    this.installationId = installation.installationId
    const metadata = await this.options.credentialStore.readMetadata()
    const storeCodeHint = metadata?.storeCodeHint ?? this.options.initialStoreCodeHint

    if (!this.options.credentialStore.isEncryptionAvailable()) {
      this.setState(state('SAFE_STORAGE_UNAVAILABLE', { storeCodeHint, errorCode: 'SAFE_STORAGE_UNAVAILABLE' }))
      return this.getPublicState()
    }

    const credential = await this.options.credentialStore.readCredential()
    if (!credential.ok) {
      if (credential.reason === 'missing') {
        this.setState(state('UNACTIVATED', { storeCodeHint }))
      } else {
        this.setState(state('CREDENTIAL_CORRUPTED', { storeCodeHint, errorCode: credential.reason }))
      }
      return this.getPublicState()
    }
    if (!metadata) {
      await this.options.credentialStore.quarantineCredential('missing-metadata')
      this.setState(state('CREDENTIAL_CORRUPTED', { storeCodeHint, errorCode: 'missing-metadata' }))
      return this.getPublicState()
    }

    return this.verifyCredential(credential.credential.deviceToken, storeCodeHint)
  }

  async activate(input: ActivationInput): Promise<ActivationPublicState> {
    if (this.activationPromise) return this.activationPromise
    this.activationPromise = this.activateInternal(input).finally(() => {
      this.activationPromise = null
    })
    return this.activationPromise
  }

  async retryVerification(): Promise<ActivationPublicState> {
    if (this.verifyPromise) return this.verifyPromise
    const metadata = await this.options.credentialStore.readMetadata()
    const storeCodeHint = metadata?.storeCodeHint ?? this.currentState.storeCodeHint
    if (!this.options.credentialStore.isEncryptionAvailable()) {
      this.setState(state('SAFE_STORAGE_UNAVAILABLE', { storeCodeHint, errorCode: 'SAFE_STORAGE_UNAVAILABLE' }))
      return this.getPublicState()
    }
    const credential = await this.options.credentialStore.readCredential()
    if (!credential.ok) {
      this.setState(state(credential.reason === 'missing' ? 'UNACTIVATED' : 'CREDENTIAL_CORRUPTED', {
        storeCodeHint,
        errorCode: credential.reason,
      }))
      return this.getPublicState()
    }
    if (!metadata) {
      await this.options.credentialStore.quarantineCredential('missing-metadata')
      this.setState(state('CREDENTIAL_CORRUPTED', { storeCodeHint, errorCode: 'missing-metadata' }))
      return this.getPublicState()
    }
    return this.verifyCredential(credential.credential.deviceToken, storeCodeHint)
  }

  async resetLocalActivation(): Promise<ActivationPublicState> {
    await this.options.credentialStore.resetLocalActivation()
    this.authorizedContext = null
    this.setState(state('UNACTIVATED', {
      storeCodeHint: this.currentState.storeCodeHint ?? this.options.initialStoreCodeHint,
    }))
    return this.getPublicState()
  }

  private async activateInternal(input: ActivationInput): Promise<ActivationPublicState> {
    if (this.quitting) return this.getPublicState()
    if (!this.installationId) {
      const installation = await this.options.credentialStore.ensureInstallation()
      this.installationId = installation.installationId
    }
    if (!this.options.credentialStore.isEncryptionAvailable()) {
      this.setState(state('SAFE_STORAGE_UNAVAILABLE', { errorCode: 'SAFE_STORAGE_UNAVAILABLE' }))
      return this.getPublicState()
    }
    const storeCode = normalizeStoreCode(input.storeCode)
    const pin = normalizePin(input.pin)
    if (!storeCode || !/^\d{6}$/.test(pin)) {
      this.setState(state('SERVER_ERROR', { storeCodeHint: storeCode, errorCode: 'INVALID_LOCAL_PAYLOAD' }))
      return this.getPublicState()
    }

    this.setState(state('ACTIVATING', { storeCodeHint: storeCode }))
    const activated = await this.options.apiClient.activate({
      storeCode,
      pin,
      installationId: this.installationId,
    })
    if (!activated.ok) {
      this.setState(activationFailureToState(activated, storeCode))
      return this.getPublicState()
    }

    const metadata: ActivationMetadataV1 = {
      schemaVersion: 1,
      storeCodeHint: activated.device.storeCode,
      deviceId: activated.device.deviceId,
      credentialVersion: activated.device.credentialVersion,
      tokenExpiresAt: activated.tokenExpiresAt,
    }
    const written = await this.options.credentialStore.writeCredential(
      { schemaVersion: 1, deviceToken: activated.deviceToken },
      metadata,
    )
    if (!written.ok) {
      this.setState(state(
        written.reason === 'safe-storage-unavailable' ? 'SAFE_STORAGE_UNAVAILABLE' : 'CREDENTIAL_CORRUPTED',
        { storeCodeHint: activated.device.storeCode, errorCode: written.reason },
      ))
      return this.getPublicState()
    }

    return this.verifyCredential(activated.deviceToken, activated.device.storeCode)
  }

  private async verifyCredential(deviceToken: string, storeCodeHint?: string): Promise<ActivationPublicState> {
    if (this.verifyPromise) return this.verifyPromise
    this.verifyPromise = this.verifyCredentialInternal(deviceToken, storeCodeHint).finally(() => {
      this.verifyPromise = null
    })
    return this.verifyPromise
  }

  private async verifyCredentialInternal(deviceToken: string, storeCodeHint?: string): Promise<ActivationPublicState> {
    if (this.quitting) return this.getPublicState()
    this.setState(state('VERIFYING', { storeCodeHint }))
    const verified = await this.options.apiClient.verify({ deviceToken })
    if (!verified.ok) {
      this.setState(verifyFailureToState(verified, storeCodeHint))
      return this.getPublicState()
    }
    await this.options.credentialStore.updateVerifiedMetadata(verified.device)
    await this.startAuthorized(verified.device, verified.subscription)
    return this.getPublicState()
  }

  private async startAuthorized(device: PublicDeviceIdentity, subscription: PublicSubscriptionState) {
    if (this.quitting) return
    this.authorizedContext = { device, subscription }
    if (this.startPromise) {
      await this.startPromise
      if (!this.quitting) {
        this.setState(state('AUTHORIZED_RUNNING', { device, subscription, storeCodeHint: device.storeCode }))
      }
      return
    }
    if (!this.startPromise) {
      this.setState(state('AUTHORIZED_STARTING', { device, subscription, storeCodeHint: device.storeCode }))
      this.startPromise = this.options.startAuthorizedRuntime({ device, subscription }).then(() => {
        if (!this.quitting) {
          this.setState(state('AUTHORIZED_RUNNING', { device, subscription, storeCodeHint: device.storeCode }))
        }
      }).catch((error) => {
        this.startPromise = null
        this.authorizedContext = null
        const message = error instanceof Error ? error.message : 'authorized runtime start failed'
        this.setState(state('SERVER_ERROR', { errorCode: 'AUTHORIZED_RUNTIME_START_FAILED', message }))
      })
    }
    await this.startPromise
  }

  private setState(next: ActivationPublicState) {
    this.currentState = next
    for (const listener of this.listeners) {
      try {
        listener(this.getPublicState())
      } catch {
        // Listener failures must not change activation decisions.
      }
    }
  }
}
