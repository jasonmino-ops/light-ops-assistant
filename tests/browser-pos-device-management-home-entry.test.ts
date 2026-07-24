import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const home = readFileSync('app/home/page.tsx', 'utf8')

assert.match(home, /deviceManagementHref=\{realRole === 'OWNER' \? '\/cashier\/devices' : undefined\}/,
  'only the existing OWNER context may receive the Browser POS device-management link')
assert.match(home, /deviceManagementLabel="设备管理"/,
  'the cashier quick-action card must expose a clear device-management label')
assert.match(home, /\{deviceManagementHref && \([\s\S]*<Link href=\{deviceManagementHref\} style=\{s\.actionMiniBtnManagement\}>\{deviceManagementLabel\}<\/Link>/,
  'device management must navigate inside the current Telegram WebApp to /cashier/devices')
assert.match(home, /<button type="button" style=\{s\.actionMiniBtn\} onClick=\{onCopy\}>\{copyLabel\}<\/button>/,
  'the existing authorization-link copy action must remain on the cashier card')
assert.match(home, /<button type="button" style=\{s\.actionMiniBtnPrimary\} onClick=\{onOpen\}>\{openLabel\}<\/button>/,
  'the existing open-cashier action must remain on the cashier card')
assert.match(home, /ActionBtn href="\/sale"/, 'unrelated quick-sale entry must remain present')
assert.match(home, /ActionBtn href="\/refund"/, 'unrelated refund entry must remain present')
assert.match(home, /ActionBtn href="\/records"/, 'unrelated records entry must remain present')

console.log('Browser POS device-management home entry tests passed')
