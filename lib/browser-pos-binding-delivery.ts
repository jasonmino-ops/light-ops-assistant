import crypto from 'crypto'
import { requireAuthSecret } from './auth-secret'

const DELIVERY_VERSION = 'v1'
const DELIVERY_ALGORITHM = 'aes-256-gcm'
const DELIVERY_IV_BYTES = 12

export { AuthSecretConfigurationError as BrowserPosBindingDeliverySecretError } from './auth-secret'

export type BrowserPosBindingDeliveryContext = {
  requestId: string
  tenantId: string
  storeId: string
  browserDeviceId: string
  bindingAttemptId: string
}

export type BrowserPosBindingDeliveryResult = BrowserPosBindingDeliveryContext & {
  browserPosDeviceId: string
  token: string
  storeCode: string
  storeName: string
  deviceName: string
  tokenExpiresAt: string
}

export function assertBrowserPosBindingDeliverySecretConfigured() {
  requireAuthSecret()
}

function deliveryKey() {
  // Browser POS credentials already use AUTH_SECRET for signing and hashing.
  // Derive a domain-separated AES key so a delivery envelope cannot be used as
  // a session or a BrowserPosDevice token primitive.
  const secret = requireAuthSecret()
  return crypto
    .createHash('sha256')
    .update('browser-pos-binding-delivery:v1\0')
    .update(secret)
    .digest()
}

function aad(context: BrowserPosBindingDeliveryContext) {
  return Buffer.from(JSON.stringify({
    v: DELIVERY_VERSION,
    requestId: context.requestId,
    tenantId: context.tenantId,
    storeId: context.storeId,
    browserDeviceId: context.browserDeviceId,
    bindingAttemptId: context.bindingAttemptId,
  }))
}

export function sealBrowserPosBindingDelivery(
  result: BrowserPosBindingDeliveryResult,
) {
  const iv = crypto.randomBytes(DELIVERY_IV_BYTES)
  const cipher = crypto.createCipheriv(DELIVERY_ALGORITHM, deliveryKey(), iv)
  cipher.setAAD(aad(result))
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(result), 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return [
    DELIVERY_VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

export function openBrowserPosBindingDelivery(
  encryptedResult: string,
  context: BrowserPosBindingDeliveryContext,
): BrowserPosBindingDeliveryResult | null {
  // Resolve configuration before parsing ciphertext: an absent AUTH_SECRET is
  // an operational configuration failure, never an ordinary replay miss.
  const key = deliveryKey()
  try {
    const [version, encodedIv, encodedTag, encodedCiphertext, extra] = encryptedResult.split('.')
    if (version !== DELIVERY_VERSION || !encodedIv || !encodedTag || !encodedCiphertext || extra) return null
    const decipher = crypto.createDecipheriv(
      DELIVERY_ALGORITHM,
      key,
      Buffer.from(encodedIv, 'base64url'),
    )
    decipher.setAAD(aad(context))
    decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
    const parsed = JSON.parse(plaintext) as BrowserPosBindingDeliveryResult
    if (
      parsed.requestId !== context.requestId
      || parsed.tenantId !== context.tenantId
      || parsed.storeId !== context.storeId
      || parsed.browserDeviceId !== context.browserDeviceId
      || parsed.bindingAttemptId !== context.bindingAttemptId
      || !parsed.browserPosDeviceId
      || !parsed.token
      || !parsed.storeCode
      || !parsed.storeName
      || !parsed.deviceName
      || !parsed.tokenExpiresAt
    ) return null
    return parsed
  } catch {
    return null
  }
}
