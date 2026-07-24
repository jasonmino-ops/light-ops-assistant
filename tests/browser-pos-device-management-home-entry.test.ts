import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canShowBrowserPosHomeEntry } from '../lib/browser-pos-home-entry'

const home = readFileSync('app/home/page.tsx', 'utf8')

assert.equal(canShowBrowserPosHomeEntry('OWNER', false), true,
  'the authenticated owner in owner mode must see Browser POS controls')
assert.equal(canShowBrowserPosHomeEntry('STAFF', false), false,
  'staff must not see Browser POS controls')
assert.equal(canShowBrowserPosHomeEntry('OWNER', true), false,
  'an owner operating in staff mode must not see Browser POS controls')
assert.equal(canShowBrowserPosHomeEntry(undefined, false), false,
  'an unauthenticated or incomplete context must not see Browser POS controls')

assert.match(home, /const showBrowserPosHomeEntry = canShowBrowserPosHomeEntry\(realRole, isOwnerInStaffMode\)/,
  'the home page must combine real role and current authority mode before rendering Browser POS controls')
assert.match(home, /\{showBrowserPosHomeEntry && \(\s*<CashierAction/,
  'the entire cashier card must be gated by the Browser POS authority check')
assert.equal((home.match(/<CashierAction\b/g) ?? []).length, 1,
  'the owner home page must render exactly one Browser POS cashier card')
assert.doesNotMatch(home, /<ActionBtn href="\/cashier\/devices"/,
  'the duplicate standalone “我的收银电脑” action must not be rendered')
assert.match(home, /deviceManagementHref="\/cashier\/devices"/,
  'the owner cashier card must retain the Browser POS device-management link')
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
