import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const transactionWrites = [
  'app/api/sales/route.ts',
  'app/api/orders/[orderNo]/checkout/route.ts',
  'app/api/orders/[orderNo]/cancel/route.ts',
  'app/api/payments/[paymentId]/confirm/route.ts',
  'app/api/payments/[paymentId]/cancel/route.ts',
  'app/api/customer-orders/[id]/route.ts',
  'app/api/cashier/sales/route.ts',
  'app/api/cashier/member-balance-pay/route.ts',
  'app/api/cashier/offline-sync/route.ts',
  'app/api/cashier/orders/[id]/route.ts',
  'app/api/members/[id]/adjust/route.ts',
  'app/api/members/[id]/recharge/route.ts',
  'app/api/members/import/confirm/route.ts',
]

for (const file of transactionWrites) {
  const source = read(file)
  assert.match(source, /authorizeTransaction\(/, `${file} must use the unified transaction policy`)
  assert.doesNotMatch(source, /allowStoreCodeFallback|authorizeDesktopPosRequest/, `${file} must not retain legacy POS fallback`)
}

for (const readRoute of [
  'app/api/cashier/orders/route.ts',
  'app/api/cashier/sale-records/[id]/receipt/route.ts',
  'app/api/records/route.ts',
]) {
  const source = read(readRoute)
  assert.match(source, /authorizeTransaction\(/, `${readRoute} must not authorize a desktop read with weak signals`)
  assert.doesNotMatch(source, /allowStoreCodeFallback|authorizeDesktopPosRequest/, `${readRoute} must not retain legacy POS fallback`)
}

const policy = read('lib/transaction-authorization.ts')
assert.match(policy, /actorType: 'BROWSER_POS_DEVICE'/, 'Browser device must keep an explicit device principal')
assert.match(policy, /actorType: 'DESKTOP_POS_DEVICE'/, 'Desktop device must keep an explicit device principal')
assert.doesNotMatch(policy, /source:\s*'STORE_CODE'|x-lightops-client/, 'weak client hints must not enter the policy decision')

const legacyFacade = read('lib/desktop-pos-auth.ts')
assert.doesNotMatch(legacyFacade, /STORE_CODE|allowStoreCodeFallback|source:\s*deviceAuth/, 'legacy facade must not keep a fallback authority path')

const schema = read('prisma/schema.prisma')
assert.match(schema, /model BrowserPosDevice/, 'Browser POS Device must be server-persisted')
assert.match(schema, /BrowserPosDeviceStatus/, 'Browser POS Device must have lifecycle status')
assert.match(schema, /tokenHash\s+String\s+@unique/, 'Browser POS Device must store a token hash only')
assert.match(schema, /transactionActorType/, 'transaction records must retain actual principal audit fields')

const browserDevice = read('lib/browser-pos-device.ts')
assert.match(browserDevice, /legacyMigratedAt/, 'old token use must have a controlled migration record')
assert.match(browserDevice, /status: 'REVOKED'/, 'Browser Device revoke must be persistent')
assert.match(browserDevice, /status: 'EXPIRED'/, 'Browser Device expiry must be persistent')
assert.doesNotMatch(browserDevice, /payloadSnapshot:\s*\{[^}]*token/, 'new Browser Device audit must not persist raw token material')

console.log(`transaction authorization policy static checks passed (${transactionWrites.length} write routes)`)
