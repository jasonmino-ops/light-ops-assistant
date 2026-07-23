import assert from 'node:assert/strict'
import {
  AuthSecretConfigurationError,
  requireAuthSecret,
} from '../lib/auth-secret'
import { signPosDeviceToken, verifyPosDeviceToken } from '../lib/browser-pos-device'
import { signSession, verifySession } from '../lib/session'
import {
  openBrowserPosBindingDelivery,
  sealBrowserPosBindingDelivery,
} from '../lib/browser-pos-binding-delivery'

const originalAuthSecret = process.env.AUTH_SECRET
const originalNodeEnv = process.env.NODE_ENV
const mutableEnv = process.env as unknown as Record<string, string | undefined>

const deviceInput = {
  tenantId: 'tenant-auth-secret-test',
  storeId: 'store-auth-secret-test',
  storeCode: 'AUTH-SECRET',
  deviceId: 'browser-auth-secret-test',
  issuedBy: 'owner-auth-secret-test',
}
const sessionInput = {
  tenantId: deviceInput.tenantId,
  userId: deviceInput.issuedBy,
  storeId: deviceInput.storeId,
  role: 'OWNER' as const,
}
const deliveryContext = {
  requestId: 'request-auth-secret-test',
  tenantId: deviceInput.tenantId,
  storeId: deviceInput.storeId,
  browserDeviceId: deviceInput.deviceId,
  bindingAttemptId: 'attempt-auth-secret-test',
}
const deliveryResult = {
  ...deliveryContext,
  browserPosDeviceId: 'device-row-auth-secret-test',
  token: 'pos-device-credential-auth-secret-test',
  storeCode: deviceInput.storeCode,
  storeName: 'Auth Secret Store',
  deviceName: 'Auth Secret Browser',
  tokenExpiresAt: '2027-01-01T00:00:00.000Z',
}

function assertMissingSecretFailure(operation: () => unknown) {
  assert.throws(
    operation,
    (error) => error instanceof AuthSecretConfigurationError && error.code === 'AUTH_SECRET_NOT_CONFIGURED',
  )
}

function assertInvalidSecretFailure(operation: () => unknown) {
  assert.throws(
    operation,
    (error) => error instanceof AuthSecretConfigurationError && error.code === 'AUTH_SECRET_INVALID',
  )
}

try {
  mutableEnv.NODE_ENV = 'production'
  delete process.env.AUTH_SECRET
  assertMissingSecretFailure(() => requireAuthSecret())
  assertMissingSecretFailure(() => signPosDeviceToken(deviceInput))
  assertMissingSecretFailure(() => verifyPosDeviceToken('malformed'))
  assertMissingSecretFailure(() => signSession(sessionInput))
  assertMissingSecretFailure(() => verifySession('malformed'))
  assertMissingSecretFailure(() => sealBrowserPosBindingDelivery(deliveryResult))
  assertMissingSecretFailure(() => openBrowserPosBindingDelivery('v1.invalid.invalid.invalid', deliveryContext))

  process.env.AUTH_SECRET = '   '
  assertMissingSecretFailure(() => signPosDeviceToken(deviceInput))
  assertMissingSecretFailure(() => verifyPosDeviceToken('malformed'))
  assertMissingSecretFailure(() => signSession(sessionInput))
  assertMissingSecretFailure(() => verifySession('malformed'))
  assertMissingSecretFailure(() => sealBrowserPosBindingDelivery(deliveryResult))
  assertMissingSecretFailure(() => openBrowserPosBindingDelivery('v1.invalid.invalid.invalid', deliveryContext))

  process.env.AUTH_SECRET = 'too-short'
  assertInvalidSecretFailure(() => requireAuthSecret())
  assertInvalidSecretFailure(() => signPosDeviceToken(deviceInput))
  assertInvalidSecretFailure(() => verifySession('malformed'))
  assertInvalidSecretFailure(() => sealBrowserPosBindingDelivery(deliveryResult))

  process.env.AUTH_SECRET = 'auth-secret-focused-test-value-0123456789'
  const browserDeviceToken = signPosDeviceToken(deviceInput)
  const sessionToken = signSession(sessionInput)
  const deliveryCiphertext = sealBrowserPosBindingDelivery(deliveryResult)
  assert.equal(verifyPosDeviceToken(browserDeviceToken)?.deviceId, deviceInput.deviceId)
  assert.deepEqual(verifySession(sessionToken), sessionInput)
  assert.deepEqual(openBrowserPosBindingDelivery(deliveryCiphertext, deliveryContext), deliveryResult)

  process.env.AUTH_SECRET = 'auth-secret-focused-wrong-value-9876543210'
  assert.equal(verifyPosDeviceToken(browserDeviceToken), null, 'wrong key must reject BrowserPosDevice token')
  assert.equal(verifySession(sessionToken), null, 'wrong key must reject OWNER session')
  assert.equal(openBrowserPosBindingDelivery(deliveryCiphertext, deliveryContext), null, 'wrong key must reject delivery replay')
} finally {
  if (originalAuthSecret === undefined) delete process.env.AUTH_SECRET
  else process.env.AUTH_SECRET = originalAuthSecret
  if (originalNodeEnv === undefined) delete mutableEnv.NODE_ENV
  else mutableEnv.NODE_ENV = originalNodeEnv
}

console.log('AUTH_SECRET fail-closed tests passed')
