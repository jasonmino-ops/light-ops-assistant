import assert from 'node:assert/strict'
import fs from 'node:fs'

const home = fs.readFileSync('app/home/page.tsx', 'utf8')
const modal = fs.readFileSync('app/home/ComputerConsoleModal.tsx', 'utf8')
const zh = fs.readFileSync('lib/i18n/zh.ts', 'utf8')
const en = fs.readFileSync('lib/i18n/en.ts', 'utf8')
const km = fs.readFileSync('lib/i18n/km.ts', 'utf8')

const sampleCashierPath = `/cashier?${new URLSearchParams({ storeCode: 'STORE-A', lang: 'zh' }).toString()}`
assert.equal(sampleCashierPath, '/cashier?storeCode=STORE-A&lang=zh', 'cashier URL should contain the expected storeCode and lang')
assert.equal(sampleCashierPath.startsWith('/desktop'), false, 'cashier URL must not use the legacy desktop route')

assert.match(home, /<ComputerConsoleModal/, 'home should expose the computer console as a lightweight modal')
assert.match(home, /const cashierParams = new URLSearchParams\(\{ \.\.\.\(storeCode \? \{ storeCode \} : \{\}\), lang \}\)/, 'cashier URL should preserve current storeCode and lang')
assert.match(home, /const cashierPath = `\/cashier\?\$\{cashierParams\.toString\(\)\}`/, 'browser POS must use the formal cashier route')
assert.match(home, /const cashierUrl = publicUrl\(cashierPath\)/, 'browser POS should resolve one final public URL')
assert.match(home, /cashierUrl=\{cashierUrl\}/, 'home should pass the final cashier URL into the modal')
assert.doesNotMatch(home, /const (?:cashier|desktop)Path = `\/desktop/, 'browser POS must not fall back to the legacy desktop mode selector')
assert.match(modal, /handleCopy\(cashierUrl,\s*'browser'\)/, 'browser POS link copy should use the final cashier URL')
assert.match(modal, /href=\{cashierUrl\}[\s\S]*target="_blank"[\s\S]*rel="noopener noreferrer"/, 'browser POS open should use the same final cashier URL')
assert.doesNotMatch(modal, /desktopPath|desktopUrl/, 'the modal should not retain ambiguous legacy desktop URL names')

assert.match(modal, /apiFetch\('\/api\/stores'/, 'the modal should resolve the current store through the existing stores API')
assert.match(modal, /apiFetch\('\/api\/desktop\/activation-pins'/, 'PIN generation should reuse the existing merchant activation API')
assert.match(modal, /apiFetch\(`\/api\/desktop\/activation-pins\/\$\{issuedPin\.pinId\}\/revoke`/, 'PIN revocation should reuse the existing revoke API')
assert.match(modal, /handleCopy\(issuedPin\.pin,\s*'pin'\)/, 'PIN copy must be an explicit user action')
assert.doesNotMatch(modal, /localStorage|sessionStorage/, 'activation PINs must not be persisted in browser storage')
assert.doesNotMatch(modal, /searchParams\.(?:set|append)\([^)]*pin/i, 'activation PINs must not be placed in the URL')

for (const [language, source] of [['zh', zh], ['en', en], ['km', km]] as const) {
  for (const key of [
    'computerConsoleTitle',
    'browserCashierTitle',
    'desktopClientTitle',
    'generateDesktopPin',
    'copyDesktopPin',
    'revokeDesktopPin',
  ]) {
    assert.match(source, new RegExp(`\\b${key}:`), `${language} should translate ${key}`)
  }
}

console.log('computer console static tests passed')
