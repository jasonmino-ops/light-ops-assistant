const assert = require('node:assert/strict')
const fs = require('node:fs')

const management = fs.readFileSync('app/management/page.tsx', 'utf8')
const home = fs.readFileSync('app/home/page.tsx', 'utf8')
const translations = ['lib/i18n/zh.ts', 'lib/i18n/en.ts', 'lib/i18n/km.ts']

for (const groupKey of ['business', 'data', 'members', 'stores', 'system']) {
  assert.match(management, new RegExp(`t\\('management\\.${groupKey}'\\)`), `management must render the ${groupKey} group`)
}

for (const route of [
  '/records',
  '/refund',
  '/cashier',
  '/products',
  '/product-sales',
  '/members',
  '/my-stores',
  '/invite',
  '/table-qrcodes',
  '/contact',
]) {
  assert.match(management, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `management must retain the existing ${route} entry`)
}

assert.match(management, /entry\.ownerOnly\)/, 'owner-only entries must be filtered in the UI')
assert.match(management, /effectiveRole === 'OWNER'/, 'visibility must use the existing effective UI role')
assert.doesNotMatch(management, /apiFetch|fetch\(|\/api\//, 'management must not add API calls')
assert.doesNotMatch(management, /online|connected|runtime|IPC|network-v2|Provider Runtime|Local Printing Contract/i, 'management must not expose technical or false status language')
assert.doesNotMatch(management, /systemCheck|computerClient|businessDashboard/, 'management must hide future or technical entries')
assert.doesNotMatch(management, /['"]\/dashboard/, 'management must not expose a dashboard entry')
assert.doesNotMatch(management, /CashierPage|OperatorBoundary|UsbCustomerDisplayBridge|checkout|payment|cartState|pendingOrderState/, 'management must not duplicate Cashier or Desktop business logic')
assert.match(management, /params\.get\('from'\) === 'desktop'/, 'management must recognize the authorized Desktop navigation context')
assert.match(management, /params\.get\('storeCode'\)/, 'management must preserve the existing storeCode navigation context')
assert.match(management, /\/desktop\/pos\?mode=pos&storeCode=/, 'management must return to the authorized Desktop POS route')
assert.match(management, /\/cashier\?storeCode=/, 'management must retain the authorized Browser Cashier return route')
assert.match(management, /useState|useEffect/, 'management may use only the minimal state/effect needed for navigation context')
assert.doesNotMatch(management, /useReducer/, 'management must not add a reducer or business state machine')
assert.match(home, /<Link href="\/management"[^>]*>\{t\('home\.managementCenter'\)\}/, 'home must link to the Management Center')

for (const file of translations) {
  const source = fs.readFileSync(file, 'utf8')
  assert.match(source, /managementCenter:/, `${file} must translate the home entry`)
  assert.match(source, /management: \{/, `${file} must translate the Management Center namespace`)
}

console.log('management-center-static.test.cjs: PASS')
