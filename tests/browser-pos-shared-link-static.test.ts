import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sharedAuthorization = readFileSync('lib/browser-pos-authorization.ts', 'utf8')
const bindRoute = readFileSync('app/api/cashier/device-authorization/[requestId]/bind/route.ts', 'utf8')
const browserDevice = readFileSync('lib/browser-pos-device.ts', 'utf8')
const cashierAuthorizePage = readFileSync('app/cashier/authorize/page.tsx', 'utf8')
const browserDeviceManagement = readFileSync('app/api/cashier/browser-devices/route.ts', 'utf8')
const browserDeviceRevoke = readFileSync('app/api/cashier/browser-devices/[id]/revoke/route.ts', 'utf8')

assert.match(sharedAuthorization, /lockChallenge[\s\S]*SELECT "id"[\s\S]*FOR UPDATE/, 'challenge redemption must lock the exact OperationLog row')
assert.match(
  sharedAuthorization,
  /prisma\.\$transaction[\s\S]*issueBrowserPosDeviceInTransaction\(tx,[\s\S]*tx\.operationLog\.update[\s\S]*status: 'SUCCESS'/,
  'challenge consumption and BrowserPosDevice issuance must share one transaction',
)
assert.match(sharedAuthorization, /POS_DEVICE_TOKEN_RECOVERY_GRACE_MS = 3_000/, 'delivery recovery must be delayed to preserve single-winner concurrent redemption')
assert.match(sharedAuthorization, /row\.targetId !== input\.deviceId/, 'only the exact originally bound browser may recover token delivery')
assert.match(sharedAuthorization, /deliveryRecoveryCount\(payload\) >= 1/, 'delivery recovery must be single-use')
assert.match(sharedAuthorization, /SELECT "id"[\s\S]*FROM "BrowserPosDevice"[\s\S]*"browserDeviceId" = \$\{input\.deviceId\}[\s\S]*FOR UPDATE/, 'recovery must lock the existing active BrowserPosDevice before rotating its token')
assert.match(sharedAuthorization, /issued\.device\.id !== payload\.browserPosDeviceId[\s\S]*throw new Error/, 'recovery must fail closed instead of creating another device')
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
assert.match(cashierAuthorizePage, /savePosDeviceToken\(body\.storeCode, body\.token\)/, 'only the bound browser should save its returned device credential')
assert.doesNotMatch(cashierAuthorizePage, /\/api\/cashier\/(sales|member-balance-pay|offline-sync)/, 'binding UI must not replay a transaction')

assert.match(browserDeviceManagement, /where: \{ tenantId: auth\.ctx\.tenantId, storeId: auth\.store\.id \}/, 'device list must be scoped to the current owner store')
assert.match(browserDeviceManagement, /storeId: ctx\.storeId[\s\S]*role: 'OWNER'[\s\S]*status: 'ACTIVE'/, 'device management must require active OWNER membership in the current store')
assert.match(browserDeviceRevoke, /storeId: ctx\.storeId[\s\S]*role: 'OWNER'[\s\S]*status: 'ACTIVE'/, 'revocation must require active OWNER membership in the current store')
assert.match(browserDevice, /where: \{ id: input\.id, tenantId: input\.tenantId, storeId: input\.storeId \}/, 'revocation must scope the target device to the current store')

console.log('Browser POS shared-link static security tests passed')
