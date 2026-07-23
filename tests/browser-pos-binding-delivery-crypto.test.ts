import assert from 'node:assert/strict'
import {
  BrowserPosBindingDeliverySecretError,
  openBrowserPosBindingDelivery,
  sealBrowserPosBindingDelivery,
} from '../lib/browser-pos-binding-delivery'
import { signPosDeviceToken, verifyPosDeviceToken } from '../lib/browser-pos-device'

const originalAuthSecret = process.env.AUTH_SECRET
const originalNodeEnv = process.env.NODE_ENV
const mutableEnv = process.env as unknown as Record<string, string | undefined>

const context = {
  requestId: 'request-crypto-test',
  tenantId: 'tenant-crypto-test',
  storeId: 'store-crypto-test',
  browserDeviceId: 'browser-crypto-test',
  bindingAttemptId: 'attempt-crypto-test',
}

const result = {
  ...context,
  browserPosDeviceId: 'device-crypto-test',
  token: 'token-crypto-test',
  storeCode: 'CRYPTO',
  storeName: 'Crypto Store',
  deviceName: 'Crypto Browser',
  tokenExpiresAt: '2027-01-01T00:00:00.000Z',
}

function assertSecretConfigurationFailure(operation: () => unknown) {
  assert.throws(
    operation,
    (error) => error instanceof BrowserPosBindingDeliverySecretError && error.code === 'AUTH_SECRET_NOT_CONFIGURED',
  )
}

try {
  mutableEnv.NODE_ENV = 'production'
  delete process.env.AUTH_SECRET
  assertSecretConfigurationFailure(() => sealBrowserPosBindingDelivery(result))
  assertSecretConfigurationFailure(() => openBrowserPosBindingDelivery('v1.invalid.invalid.invalid', context))

  process.env.AUTH_SECRET = '   '
  assertSecretConfigurationFailure(() => sealBrowserPosBindingDelivery(result))
  assertSecretConfigurationFailure(() => openBrowserPosBindingDelivery('v1.invalid.invalid.invalid', context))

  process.env.AUTH_SECRET = 'browser-pos-delivery-crypto-test-secret'
  const encrypted = sealBrowserPosBindingDelivery(result)
  assert.notEqual(encrypted, result.token)
  assert.deepEqual(openBrowserPosBindingDelivery(encrypted, context), result)

  process.env.AUTH_SECRET = 'browser-pos-delivery-wrong-secret'
  assert.equal(openBrowserPosBindingDelivery(encrypted, context), null, 'wrong key must not decrypt delivery ciphertext')

  process.env.AUTH_SECRET = 'browser-pos-delivery-crypto-test-secret'
  const posDeviceToken = signPosDeviceToken({
    tenantId: context.tenantId,
    storeId: context.storeId,
    storeCode: result.storeCode,
    deviceId: context.browserDeviceId,
    issuedBy: 'owner-crypto-test',
  })
  assert.equal(verifyPosDeviceToken(posDeviceToken)?.deviceId, context.browserDeviceId)
} finally {
  if (originalAuthSecret === undefined) delete process.env.AUTH_SECRET
  else process.env.AUTH_SECRET = originalAuthSecret
  if (originalNodeEnv === undefined) delete mutableEnv.NODE_ENV
  else mutableEnv.NODE_ENV = originalNodeEnv
}

console.log('Browser POS binding delivery crypto tests passed')
