import assert from 'node:assert/strict'
import {
  DESKTOP_ACTIVATION_PIN_HASH_VERSION,
  DESKTOP_DEVICE_TOKEN_BYTES,
  DESKTOP_DEVICE_TOKEN_HASH_VERSION,
  DESKTOP_DEVICE_TOKEN_PREFIX,
  DesktopSecretError,
  assertDesktopActivationSecretsConfigured,
  createActivationPin,
  createDesktopDeviceToken,
  getActivationPinExpiresAt,
  getActivationPinLockedUntil,
  hashActivationPin,
  hashDesktopDeviceToken,
  hashInstallationId,
  isValidActivationPinFormat,
  isValidDesktopDeviceTokenFormat,
  isValidInstallationId,
} from '../lib/desktop-activation/crypto'

const originalDeviceSecret = process.env.DESKTOP_DEVICE_TOKEN_SECRET
const originalPinSecret = process.env.DESKTOP_ACTIVATION_PIN_SECRET
const originalAuthSecret = process.env.AUTH_SECRET

try {
  process.env.DESKTOP_DEVICE_TOKEN_SECRET = 'test-device-secret-06a'
  process.env.DESKTOP_ACTIVATION_PIN_SECRET = 'test-pin-secret-06a'
  process.env.AUTH_SECRET = 'legacy-auth-secret-must-not-be-used'

  const now = new Date('2026-07-17T00:00:00.000Z')
  const tokenBundle = createDesktopDeviceToken(now)
  assert.equal(DESKTOP_DEVICE_TOKEN_BYTES, 32, 'desktop token entropy must be at least 256 bits')
  assert.equal(tokenBundle.tokenHashVersion, DESKTOP_DEVICE_TOKEN_HASH_VERSION)
  assert.equal(tokenBundle.tokenIssuedAt.toISOString(), '2026-07-17T00:00:00.000Z')
  assert.equal(tokenBundle.tokenExpiresAt.toISOString(), '2027-07-17T00:00:00.000Z')
  assert.match(tokenBundle.token, new RegExp(`^${DESKTOP_DEVICE_TOKEN_PREFIX}[A-Za-z0-9_-]{40,128}$`))
  assert.equal(isValidDesktopDeviceTokenFormat(tokenBundle.token), true)
  assert.equal(isValidDesktopDeviceTokenFormat(`${DESKTOP_DEVICE_TOKEN_PREFIX}${'a'.repeat(129)}`), false)
  assert.match(tokenBundle.tokenHash, /^[a-f0-9]{64}$/)
  assert.notEqual(tokenBundle.tokenHash, tokenBundle.token)
  assert.equal(hashDesktopDeviceToken(tokenBundle.token), tokenBundle.tokenHash)
  assert.notEqual(createDesktopDeviceToken(now).token, tokenBundle.token, 'token generation must be random')

  const installationHash = hashInstallationId('desktop-installation-001')
  assert.match(installationHash, /^[a-f0-9]{64}$/)
  assert.equal(isValidInstallationId('desktop-installation-001'), true)
  assert.equal(isValidInstallationId('short'), false)
  assert.equal(isValidInstallationId('x'.repeat(257)), false)

  const pin = createActivationPin()
  assert.equal(DESKTOP_ACTIVATION_PIN_HASH_VERSION, 1)
  assert.match(pin, /^\d{6}$/)
  assert.equal(isValidActivationPinFormat(pin), true)
  assert.equal(isValidActivationPinFormat('12345'), false)
  assert.equal(isValidActivationPinFormat('12345a'), false)
  assert.equal(getActivationPinExpiresAt(now).toISOString(), '2026-07-18T00:00:00.000Z')
  assert.equal(getActivationPinLockedUntil(now).toISOString(), '2026-07-17T00:15:00.000Z')

  const pinHash = hashActivationPin({ tenantId: 'tenant-a', storeId: 'store-a', pin: '123456' })
  assert.match(pinHash, /^[a-f0-9]{64}$/)
  assert.equal(hashActivationPin({ tenantId: 'tenant-a', storeId: 'store-a', pin: '123456' }), pinHash)
  assert.notEqual(hashActivationPin({ tenantId: 'tenant-a', storeId: 'store-b', pin: '123456' }), pinHash)
  assert.notEqual(hashActivationPin({ tenantId: 'tenant-b', storeId: 'store-a', pin: '123456' }), pinHash)
  assert.doesNotThrow(() => assertDesktopActivationSecretsConfigured())

  delete process.env.DESKTOP_DEVICE_TOKEN_SECRET
  assert.throws(
    () => hashDesktopDeviceToken(tokenBundle.token),
    (error) => error instanceof DesktopSecretError && error.code === 'TOKEN_SECRET_NOT_CONFIGURED',
    'desktop token hashing must fail closed and must not fall back to AUTH_SECRET',
  )
  assert.throws(
    () => assertDesktopActivationSecretsConfigured(),
    (error) => error instanceof DesktopSecretError && error.code === 'TOKEN_SECRET_NOT_CONFIGURED',
    'desktop activation should fail closed when the device token secret is missing',
  )

  process.env.DESKTOP_DEVICE_TOKEN_SECRET = 'test-device-secret-06a'
  delete process.env.DESKTOP_ACTIVATION_PIN_SECRET
  assert.throws(
    () => hashActivationPin({ tenantId: 'tenant-a', storeId: 'store-a', pin: '123456' }),
    (error) => error instanceof DesktopSecretError && error.code === 'PIN_SECRET_NOT_CONFIGURED',
    'activation PIN hashing must fail closed and must not fall back to AUTH_SECRET',
  )
  assert.throws(
    () => assertDesktopActivationSecretsConfigured(),
    (error) => error instanceof DesktopSecretError && error.code === 'PIN_SECRET_NOT_CONFIGURED',
    'desktop activation should fail closed when the activation PIN secret is missing',
  )
} finally {
  if (originalDeviceSecret === undefined) delete process.env.DESKTOP_DEVICE_TOKEN_SECRET
  else process.env.DESKTOP_DEVICE_TOKEN_SECRET = originalDeviceSecret

  if (originalPinSecret === undefined) delete process.env.DESKTOP_ACTIVATION_PIN_SECRET
  else process.env.DESKTOP_ACTIVATION_PIN_SECRET = originalPinSecret

  if (originalAuthSecret === undefined) delete process.env.AUTH_SECRET
  else process.env.AUTH_SECRET = originalAuthSecret
}

console.log('desktop activation crypto tests passed')
