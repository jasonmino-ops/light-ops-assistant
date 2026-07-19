export type PublicDeviceIdentity = {
  deviceId: string
  tenantId: string
  storeId: string
  storeCode: string
  status: string
  tokenExpiresAt: string
  credentialVersion: number
}

export type PublicSubscriptionState = {
  accessState: string
  status: string
  warning: string | null
}

export type PublicReactivationReason =
  | 'DESKTOP_DEVICE_REVOKED'
  | 'DESKTOP_TOKEN_EXPIRED'
  | 'DESKTOP_DEVICE_UNAUTHORIZED'

export type ActivationPublicStateKind =
  | 'BOOTING'
  | 'UNACTIVATED'
  | 'ACTIVATING'
  | 'VERIFYING'
  | 'AUTHORIZED_STARTING'
  | 'AUTHORIZED_RUNNING'
  | 'STARTUP_ERROR'
  | 'NETWORK_ERROR'
  | 'INVALID_PIN'
  | 'PIN_LOCKED'
  | 'PIN_EXPIRED'
  | 'PIN_ALREADY_USED'
  | 'STORE_NOT_FOUND'
  | 'TENANT_INACTIVE'
  | 'STORE_INACTIVE'
  | 'SUBSCRIPTION_BLOCKED'
  | 'INSTALLATION_BOUND_TO_OTHER_STORE'
  | 'SAFE_STORAGE_UNAVAILABLE'
  | 'CREDENTIAL_CORRUPTED'
  | 'DEVICE_REVOKED'
  | 'TOKEN_EXPIRED'
  | 'REACTIVATION_REQUIRED'
  | 'SERVER_ERROR'
  | 'QUITTING'

export type ActivationPublicState = {
  kind: ActivationPublicStateKind
  storeCodeHint?: string
  device?: PublicDeviceIdentity
  subscription?: PublicSubscriptionState
  reactivationReason?: PublicReactivationReason
  errorCode?: string
  retryAfterSeconds?: number
  message?: string
  isBusy: boolean
  canActivate: boolean
  canRetryVerify: boolean
  canResetLocal: boolean
  canQuit: boolean
}

export type AuthorizedDesktopContext = {
  device: PublicDeviceIdentity
  subscription: PublicSubscriptionState
}

export type ActivationInput = {
  storeCode: string
  pin: string
}

export type ActivationIpcResult =
  | { ok: true; state: ActivationPublicState }
  | { ok: false; error: string; state?: ActivationPublicState }

export type InstallationRecordV1 = {
  schemaVersion: 1
  installationId: string
  createdAt: string
}

export type ActivationMetadataV1 = {
  schemaVersion: 1
  storeCodeHint?: string
  deviceId?: string
  credentialVersion?: number
  tokenExpiresAt?: string
  lastVerifiedAt?: string
}

export type EncryptedCredentialFileV1 = {
  schemaVersion: 1
  encryption: 'electron.safeStorage'
  ciphertextBase64: string
  updatedAt: string
}

export type ActivationCredentialV1 = {
  schemaVersion: 1
  deviceToken: string
}

export type ActivationSecretSafeStorage = {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(encrypted: Buffer): string
}

export type CloudApiFailureKind =
  | 'NETWORK'
  | 'TIMEOUT'
  | 'HTTP'
  | 'MALFORMED_JSON'
  | 'SCHEMA'

export type CloudApiFailure = {
  ok: false
  kind: CloudApiFailureKind
  status?: number
  errorCode: string
  retryAfterSeconds?: number
  subscription?: PublicSubscriptionState
}

export type CloudActivateSuccess = {
  ok: true
  deviceToken: string
  tokenExpiresAt: string
  device: PublicDeviceIdentity
  subscription: PublicSubscriptionState
}

export type CloudVerifySuccess = {
  ok: true
  device: PublicDeviceIdentity
  subscription: PublicSubscriptionState
}

export type CloudActivateResult = CloudActivateSuccess | CloudApiFailure
export type CloudVerifyResult = CloudVerifySuccess | CloudApiFailure

export const ACTIVATION_PUBLIC_INITIAL_STATE: ActivationPublicState = {
  kind: 'BOOTING',
  isBusy: true,
  canActivate: false,
  canRetryVerify: false,
  canResetLocal: false,
  canQuit: true,
}

export function isPublicStateSecretFree(state: ActivationPublicState): boolean {
  const serialized = JSON.stringify(state)
  return !/(deviceToken|authorization|bearer|pin|installationId|ciphertext)/i.test(serialized)
}
