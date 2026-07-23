import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sharedAuthorization = readFileSync('lib/browser-pos-authorization.ts', 'utf8')
const bindRoute = readFileSync('app/api/cashier/device-authorization/[requestId]/bind/route.ts', 'utf8')
const browserDevice = readFileSync('lib/browser-pos-device.ts', 'utf8')
const cashierAuthorizePage = readFileSync('app/cashier/authorize/page.tsx', 'utf8')
const browserDeviceManagement = readFileSync('app/api/cashier/browser-devices/route.ts', 'utf8')
const browserDeviceRevoke = readFileSync('app/api/cashier/browser-devices/[id]/revoke/route.ts', 'utf8')
const bindingDelivery = readFileSync('lib/browser-pos-binding-delivery.ts', 'utf8')
const authSecret = readFileSync('lib/auth-secret.ts', 'utf8')

assert.match(sharedAuthorization, /lockChallenge[\s\S]*SELECT "id"[\s\S]*FOR UPDATE/, 'challenge redemption must lock the exact OperationLog row')
assert.match(
  sharedAuthorization,
  /prisma\.\$transaction[\s\S]*issueBrowserPosDeviceInTransaction\(tx,[\s\S]*tx\.operationLog\.update[\s\S]*status: 'SUCCESS'/,
  'challenge consumption and BrowserPosDevice issuance must share one transaction',
)
assert.doesNotMatch(sharedAuthorization, /POS_DEVICE_TOKEN_RECOVERY_GRACE_MS|deliveryRecovery/, 'delivery must not infer retry safety from a time window')
assert.match(sharedAuthorization, /assertBrowserPosBindingDeliverySecretConfigured\(\)/, 'binding must fail before BrowserPosDevice issuance when the delivery secret is absent')
assert.match(sharedAuthorization, /findAndExpireBindingDelivery[\s\S]*challengeExpired/, 'every terminal bind path must inspect the exact delivery before challenge expiry returns')
assert.doesNotMatch(sharedAuthorization, /browserPosBindingDelivery\.deleteMany/, 'delivery cleanup must be deterministic for the current request, not opportunistic deletion')
assert.match(sharedAuthorization, /bindingAttemptId: string/, 'redemption must require a stable bindingAttemptId')
assert.match(sharedAuthorization, /browserPosBindingDelivery\.findUnique/, 'same operation must replay a dedicated delivery record')
assert.match(sharedAuthorization, /browserPosBindingDelivery\.create/, 'initial binding must persist delivery atomically with issuance')
assert.match(sharedAuthorization, /existingDelivery\.bindingAttemptId === input\.bindingAttemptId/, 'delivery replay must require the exact attemptId')
assert.match(sharedAuthorization, /encryptedResult: ''/, 'expired delivery must clear encrypted ciphertext')
assert.match(sharedAuthorization, /POS_DEVICE_AUTH_TTL_MS = 10 \* 60 \* 1000/, 'shared links must remain ten-minute capabilities')
assert.match(sharedAuthorization, /BROWSER_POS_SHARED_LINK_REDEEMED/, 'shared-link redemption must be audited')
assert.doesNotMatch(
  sharedAuthorization,
  /payloadSnapshot:\s*\{[^}]*\btoken\s*:/,
  'challenge payloads must never persist raw pos-device-v1 credentials',
)

assert.match(browserDevice, /issueBrowserPosDeviceInTransaction/, 'existing BrowserPosDevice issuance must be reused by the shared-link flow')
assert.match(browserDevice, /tokenHash/, 'Browser credentials must retain only a hash')
assert.match(bindRoute, /redeemBrowserPosAuthorization/, 'public bind endpoint must use the atomic redemption service')
assert.doesNotMatch(bindRoute, /getContext|signSession|role:\s*'OWNER'/, 'shared bind must not establish or synthesize an OWNER principal')
assert.match(bindRoute, /bindingAttemptId/, 'public bind must receive the client binding attempt identifier')
assert.match(cashierAuthorizePage, /savePosDeviceToken\(body\.storeCode, body\.token\)/, 'only the bound browser should save its returned device credential')
assert.match(cashierAuthorizePage, /bindingAttemptIdRef/, 'client retries must keep a stable attempt identifier')
assert.doesNotMatch(cashierAuthorizePage, /\/api\/cashier\/(sales|member-balance-pay|offline-sync)/, 'binding UI must not replay a transaction')

assert.match(browserDeviceManagement, /where: \{ tenantId: auth\.ctx\.tenantId, storeId: auth\.store\.id \}/, 'device list must be scoped to the current owner store')
assert.match(browserDeviceManagement, /storeId: ctx\.storeId[\s\S]*role: 'OWNER'[\s\S]*status: 'ACTIVE'/, 'device management must require active OWNER membership in the current store')
assert.match(browserDeviceRevoke, /storeId: ctx\.storeId[\s\S]*role: 'OWNER'[\s\S]*status: 'ACTIVE'/, 'revocation must require active OWNER membership in the current store')
assert.match(browserDevice, /where: \{ id: input\.id, tenantId: input\.tenantId, storeId: input\.storeId \}/, 'revocation must scope the target device to the current store')

assert.match(bindingDelivery, /aes-256-gcm/, 'delivery result must be encrypted with an authenticated envelope')
assert.match(authSecret, /AUTH_SECRET_NOT_CONFIGURED/, 'delivery encryption must expose a non-secret configuration failure')
assert.equal(bindingDelivery.includes(['dev', 'secret', 'change', 'in', 'production'].join('-')), false, 'delivery encryption must not fall back to a public default secret')
assert.match(authSecret, /requireAuthSecret/, 'all auth credentials must resolve AUTH_SECRET through one fail-closed helper')
assert.match(authSecret, /MIN_AUTH_SECRET_LENGTH = 32/, 'AUTH_SECRET must reject undersized values')
assert.match(bindingDelivery, /cipher\.setAAD/, 'delivery ciphertext must be bound to its request/device/attempt context')
assert.match(bindingDelivery, /decipher\.setAuthTag/, 'delivery replay must authenticate ciphertext before release')
assert.doesNotMatch(bindingDelivery, /OperationLog/, 'encrypted delivery result must not use ordinary audit logs')

console.log('Browser POS shared-link static security tests passed')
