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
assert.doesNotMatch(management, /['"]\/dashboard|['"]\/desktop\/pos/, 'management must not expose P5 out-of-scope dashboard or desktop POS entries')
assert.doesNotMatch(management, /useState|useReducer|useEffect/, 'management should remain a navigation hub without business state')
assert.match(home, /<Link href="\/management"[^>]*>\{t\('home\.managementCenter'\)\}/, 'home must link to the Management Center')

for (const file of translations) {
  const source = fs.readFileSync(file, 'utf8')
  assert.match(source, /managementCenter:/, `${file} must translate the home entry`) 
  assert.match(source, /management: \{/, `${file} must translate the Management Center namespace`)
}

console.log('management-center-static.test.cjs: PASS')
