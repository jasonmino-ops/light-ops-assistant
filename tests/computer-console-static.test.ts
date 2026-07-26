import assert from 'node:assert/strict'
import fs from 'node:fs'

const home = fs.readFileSync('app/home/page.tsx', 'utf8')
const modal = fs.readFileSync('app/home/ComputerConsoleModal.tsx', 'utf8')
const zh = fs.readFileSync('lib/i18n/zh.ts', 'utf8')
const en = fs.readFileSync('lib/i18n/en.ts', 'utf8')
const km = fs.readFileSync('lib/i18n/km.ts', 'utf8')

assert.match(home, /<ComputerConsoleModal/, 'home should expose the computer console as a lightweight modal')
assert.match(home, /desktopPath=\{desktopPath\}/, 'browser POS should reuse the existing desktop entry path')
assert.match(modal, /handleCopy\(desktopUrl,\s*'browser'\)/, 'browser POS link copy should remain available')
assert.match(modal, /href=\{desktopPath\}[\s\S]*target="_blank"[\s\S]*rel="noopener noreferrer"/, 'browser POS should use a stable safe link from the modal')

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
