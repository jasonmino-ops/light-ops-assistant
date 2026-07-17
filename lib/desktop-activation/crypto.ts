import crypto from 'crypto'

export const DESKTOP_DEVICE_TOKEN_PREFIX = 'edt_v1_'
export const DESKTOP_DEVICE_TOKEN_BYTES = 32
export const DESKTOP_DEVICE_TOKEN_TTL_DAYS = 365
export const DESKTOP_DEVICE_TOKEN_HASH_VERSION = 1
export const DESKTOP_ACTIVATION_PIN_HASH_VERSION = 1
export const DESKTOP_ACTIVATION_PIN_TTL_HOURS = 24
export const DESKTOP_ACTIVATION_PIN_MAX_FAILED_ATTEMPTS = 5
export const DESKTOP_ACTIVATION_PIN_LOCK_MINUTES = 15

export class DesktopSecretError extends Error {
  code: 'TOKEN_SECRET_NOT_CONFIGURED' | 'PIN_SECRET_NOT_CONFIGURED'

  constructor(code: DesktopSecretError['code']) {
    super(code)
    this.code = code
  }
}

function requiredSecret(name: 'DESKTOP_DEVICE_TOKEN_SECRET' | 'DESKTOP_ACTIVATION_PIN_SECRET') {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new DesktopSecretError(
      name === 'DESKTOP_DEVICE_TOKEN_SECRET'
        ? 'TOKEN_SECRET_NOT_CONFIGURED'
        : 'PIN_SECRET_NOT_CONFIGURED',
    )
  }
  return value
}

function hmacSha256Hex(secret: string, value: string) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex')
}

export function assertDesktopActivationSecretsConfigured() {
  requiredSecret('DESKTOP_DEVICE_TOKEN_SECRET')
  requiredSecret('DESKTOP_ACTIVATION_PIN_SECRET')
}

export function createDesktopDeviceToken(now = new Date()) {
  const raw = crypto.randomBytes(DESKTOP_DEVICE_TOKEN_BYTES).toString('base64url')
  const token = `${DESKTOP_DEVICE_TOKEN_PREFIX}${raw}`
  return {
    token,
    tokenHash: hashDesktopDeviceToken(token),
    tokenHashVersion: DESKTOP_DEVICE_TOKEN_HASH_VERSION,
    tokenIssuedAt: now,
    tokenExpiresAt: new Date(now.getTime() + DESKTOP_DEVICE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
  }
}

export function hashDesktopDeviceToken(token: string) {
  return hmacSha256Hex(requiredSecret('DESKTOP_DEVICE_TOKEN_SECRET'), `desktop-device-token:v1:${token}`)
}

export function isValidDesktopDeviceTokenFormat(token: string | null | undefined): token is string {
  if (typeof token !== 'string') return false
  return new RegExp(`^${DESKTOP_DEVICE_TOKEN_PREFIX}[A-Za-z0-9_-]{40,128}$`).test(token.trim())
}

export function hashInstallationId(installationId: string) {
  return hmacSha256Hex(
    requiredSecret('DESKTOP_DEVICE_TOKEN_SECRET'),
    `desktop-installation-id:v1:${installationId}`,
  )
}

export function isValidInstallationId(value: string | null | undefined): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return trimmed.length >= 8 && trimmed.length <= 256
}

export function createActivationPin() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
}

export function hashActivationPin(input: { tenantId: string; storeId: string; pin: string }) {
  return hmacSha256Hex(
    requiredSecret('DESKTOP_ACTIVATION_PIN_SECRET'),
    `desktop-activation-pin:v1:${input.tenantId}:${input.storeId}:${input.pin}`,
  )
}

export function isValidActivationPinFormat(pin: string | null | undefined): pin is string {
  return typeof pin === 'string' && /^\d{6}$/.test(pin.trim())
}

export function getActivationPinExpiresAt(now = new Date()) {
  return new Date(now.getTime() + DESKTOP_ACTIVATION_PIN_TTL_HOURS * 60 * 60 * 1000)
}

export function getActivationPinLockedUntil(now = new Date()) {
  return new Date(now.getTime() + DESKTOP_ACTIVATION_PIN_LOCK_MINUTES * 60 * 1000)
}

export function hashAuditValue(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  if (!normalized) return null
  try {
    return hmacSha256Hex(requiredSecret('DESKTOP_DEVICE_TOKEN_SECRET'), `desktop-audit:v1:${normalized}`)
  } catch {
    return null
  }
}
