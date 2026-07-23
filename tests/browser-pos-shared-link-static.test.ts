import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sharedAuthorization = readFileSync('lib/browser-pos-authorization.ts', 'utf8')
const bindRoute = readFileSync('app/api/cashier/device-authorization/[requestId]/bind/route.ts', 'utf8')
const browserDevice = readFileSync('lib/browser-pos-device.ts', 'utf8')
const cashierAuthorizePage = readFileSync('app/cashier/authorize/page.tsx', 'utf8')

assert.match(sharedAuthorization, /lockChallenge[\s\S]*SELECT "id"[\s\S]*FOR UPDATE/, 'challenge redemption must lock the exact OperationLog row')
assert.match(
  sharedAuthorization,
  /prisma\.\$transaction[\s\S]*issueBrowserPosDeviceInTransaction\(tx,[\s\S]*tx\.operationLog\.update[\s\S]*status: 'SUCCESS'/,
  'challenge consumption and BrowserPosDevice issuance must share one transaction',
)
assert.match(sharedAuthorization, /if \(payload\.browserPosDeviceId \|\| \(row\.status === 'SUCCESS' && payload\.deliveredAt\)\)/, 'a consumed link must reject repeat redemption')
assert.match(sharedAuthorization, /POS_DEVICE_AUTH_TTL_MS = 10 \* 60 \* 1000/, 'shared links must remain ten-minute capabilities')
assert.match(sharedAuthorization, /BROWSER_POS_SHARED_LINK_REDEEMED/, 'shared-link redemption must be audited')
assert.doesNotMatch(
  sharedAuthorization,
  /payloadSnapshot:\s*\{[^}]*\btoken\s*:/s,
  'challenge payloads must never persist raw pos-device-v1 credentials',
)

assert.match(browserDevice, /issueBrowserPosDeviceInTransaction/, 'existing BrowserPosDevice issuance must be reused by the shared-link flow')
assert.match(browserDevice, /tokenHash/, 'Browser credentials must retain only a hash')
assert.match(bindRoute, /redeemBrowserPosAuthorization/, 'public bind endpoint must use the atomic redemption service')
assert.doesNotMatch(bindRoute, /getContext|signSession|role:\s*'OWNER'/, 'shared bind must not establish or synthesize an OWNER principal')
assert.match(cashierAuthorizePage, /savePosDeviceToken\(body\.storeCode, body\.token\)/, 'only the bound browser should save its returned device credential')
assert.doesNotMatch(cashierAuthorizePage, /\/api\/cashier\/(sales|member-balance-pay|offline-sync)/, 'binding UI must not replay a transaction')

console.log('Browser POS shared-link static security tests passed')
