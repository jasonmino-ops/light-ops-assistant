const assert = require('node:assert/strict')
const fs = require('node:fs')

const settings = fs.readFileSync('app/settings/page.tsx', 'utf8')
const management = fs.readFileSync('app/management/page.tsx', 'utf8')

assert.match(settings, /data-settings-page="owner"/)
assert.match(settings, /effectiveRole !== 'OWNER'/, 'Settings must remain OWNER-only')
assert.match(settings, /router\.replace\('\/home'\)/, 'non-owners must be redirected away')
assert.match(settings, /'\/api\/store\/settings'/, 'Settings must reuse /api/store/settings')
assert.match(settings, /'\/api\/stores'/, 'Settings must reuse /api/stores')
assert.match(settings, /\/api\/stores\/\$\{encodeURIComponent\(settings\.storeId\)\}\/checkout-mode/, 'Settings must reuse the checkout-mode API')
assert.match(settings, /\/api\/stores\/\$\{encodeURIComponent\(settings\.storeId\)\}\/menu-config/, 'Settings must reuse the menu-config API')
assert.match(settings, /OWNER_CTX/, 'settings writes must use the existing owner request context')
assert.match(settings, /\/table-qrcodes/, 'Table QR must remain a link to the existing page')
assert.match(settings, /cashier:autoPrint/, 'Auto print must reuse the existing localStorage key')
assert.match(settings, /isDesktop/, 'desktop-only settings must detect the existing runtime marker')
assert.match(settings, /data-settings-auto-print="desktop-only"/)
assert.match(settings, /data-settings-display="desktop-only"/)
assert.doesNotMatch(settings, /\/api\/(print|network-print)\//, 'Settings must not create printing status/API coupling')
assert.doesNotMatch(settings, /compactMode|usdKhrRate/, 'Settings must not absorb unrelated Cashier preferences')
assert.doesNotMatch(settings, /windowManager|ipcRenderer|preload|electron\/|prisma|\/dashboard/, 'Settings must not cross the frozen runtime boundary')

assert.match(management, /href: '\/settings#printing'/, 'Management must expose the canonical Settings entry')
assert.match(management, /ownerOnly: true/, 'Settings entry must be owner-only')
assert.doesNotMatch(management, /apiFetch|fetch\(|\/api\//, 'Management remains navigation-only')

for (const file of ['lib/i18n/zh.ts', 'lib/i18n/en.ts', 'lib/i18n/km.ts']) {
  const source = fs.readFileSync(file, 'utf8')
  assert.match(source, /settings: \{/, `${file} must include the Settings namespace`)
  assert.match(source, /management: \{/, `${file} must retain Management translations`)
}

console.log('settings-center-static.test.cjs: PASS')
