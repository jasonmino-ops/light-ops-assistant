import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync('app/cashier/devices/page.tsx', 'utf8')
const listRoute = readFileSync('app/api/cashier/browser-devices/route.ts', 'utf8')
const revokeRoute = readFileSync('app/api/cashier/browser-devices/[id]/revoke/route.ts', 'utf8')

assert.match(page, /apiFetch\('\/api\/cashier\/browser-devices', \{ cache: 'no-store' \}/,
  'OWNER UI must list Browser POS devices through the existing no-store endpoint')
assert.match(page, /window\.confirm\(`撤销/, 'OWNER UI must request confirmation before revocation')
assert.match(page, /\/api\/cashier\/browser-devices\/\$\{encodeURIComponent\(device\.id\)\}\/revoke/,
  'OWNER UI must call the existing single-device revoke endpoint')
assert.match(page, /status: 'REVOKED'/,
  'a successful revoke must immediately update the displayed device state')
assert.match(page, /await load\(false\)/,
  'a successful revoke must refresh the authoritative device list without hiding its confirmed revoke state on a refresh failure')
assert.match(page, /LOGIN_REQUIRED/, 'the UI must explain an expired login instead of claiming success')
assert.match(page, /OWNER_REQUIRED.*FORBIDDEN/, 'the UI must explain store-owner authorization failures')
assert.match(page, /BROWSER_DEVICE_NOT_FOUND/, 'the UI must explain a missing or cross-store device safely')
assert.match(page, /绑定时间：\{formatTime\(device\.activatedAt\)\}/, 'the UI must show binding time')
assert.match(page, /最近在线：\{formatTime\(device\.lastSeenAt\)\}/, 'the UI must show optional last-use time')
assert.match(page, /device\.browserInfo/, 'the UI must show browser information when available')

assert.match(listRoute, /where: \{ tenantId: auth\.ctx\.tenantId, storeId: auth\.store\.id \}/,
  'the list endpoint must remain scoped to the current owner store')
assert.match(revokeRoute, /storeId: ctx\.storeId[\s\S]*role: 'OWNER'[\s\S]*status: 'ACTIVE'/,
  'the revoke endpoint must retain active current-store OWNER membership checks')

console.log('Browser POS device-management UI tests passed')
