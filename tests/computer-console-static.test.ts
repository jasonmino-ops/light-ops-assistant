import assert from 'node:assert/strict'
import fs from 'node:fs'
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ComputerConsoleModal from '../app/home/ComputerConsoleModal'
import { buildComputerConsoleCashierUrl } from '../app/home/computer-console-url'

(globalThis as typeof globalThis & { React: typeof React }).React = React

const home = fs.readFileSync('app/home/page.tsx', 'utf8')
const modal = fs.readFileSync('app/home/ComputerConsoleModal.tsx', 'utf8')
const zh = fs.readFileSync('lib/i18n/zh.ts', 'utf8')
const en = fs.readFileSync('lib/i18n/en.ts', 'utf8')
const km = fs.readFileSync('lib/i18n/km.ts', 'utf8')

assert.equal(buildComputerConsoleCashierUrl(null, 'zh'), null, 'missing storeCode must not produce a cashier URL')
assert.equal(buildComputerConsoleCashierUrl('', 'zh'), null, 'empty storeCode must not produce a cashier URL')
assert.equal(buildComputerConsoleCashierUrl('   ', 'zh'), null, 'blank storeCode must not produce a cashier URL')

const sampleCashierUrl = buildComputerConsoleCashierUrl('STORE-A', 'zh')
assert.ok(sampleCashierUrl, 'valid storeCode should produce a cashier URL')
const parsedCashierUrl = new URL(sampleCashierUrl)
assert.equal(parsedCashierUrl.pathname, '/cashier', 'browser POS must use the formal cashier route')
assert.equal(parsedCashierUrl.searchParams.get('storeCode'), 'STORE-A', 'cashier URL should contain the current storeCode')
assert.equal(parsedCashierUrl.searchParams.get('lang'), 'zh', 'cashier URL should preserve the current language')
assert.notEqual(parsedCashierUrl.pathname, '/desktop', 'cashier URL must not use the legacy desktop route')

const unavailableMarkup = renderToStaticMarkup(createElement(ComputerConsoleModal, {
  cashierUrl: null,
  storeCode: null,
  canManagePin: false,
  onClose() {},
}))
assert.doesNotMatch(unavailableMarkup, /<a\b/, 'missing storeCode must not render an executable cashier link')
assert.doesNotMatch(unavailableMarkup, /\/cashier\?lang=/, 'missing storeCode must not expose a partial cashier URL')
assert.equal((unavailableMarkup.match(/\sdisabled=""/g) ?? []).length, 2, 'missing storeCode must disable both browser actions')

const availableMarkup = renderToStaticMarkup(createElement(ComputerConsoleModal, {
  cashierUrl: sampleCashierUrl,
  storeCode: 'STORE-A',
  canManagePin: false,
  onClose() {},
}))
assert.match(availableMarkup, /href="[^"]*\/cashier\?storeCode=STORE-A&amp;lang=zh"/, 'valid storeCode should render the formal cashier link')
assert.equal((availableMarkup.match(/\sdisabled=""/g) ?? []).length, 0, 'valid storeCode should enable both browser actions')

assert.match(home, /<ComputerConsoleModal/, 'home should expose the computer console as a lightweight modal')
assert.match(home, /const cashierUrl = buildComputerConsoleCashierUrl\(storeCode, lang\)/, 'home should only build the cashier URL through the guarded helper')
assert.match(home, /cashierUrl=\{cashierUrl\}/, 'home should pass the final cashier URL into the modal')
assert.match(modal, /disabled=\{!cashierUrl\}/, 'copy must be disabled until the current store is ready')
assert.match(modal, /if \(cashierUrl\) void handleCopy\(cashierUrl,\s*'browser'\)/, 'copy must guard the final cashier URL')
assert.match(modal, /\{cashierUrl \? \([\s\S]*href=\{cashierUrl\}[\s\S]*\) : \([\s\S]*<button[\s\S]*disabled/, 'open must render as a disabled button until the current store is ready')
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
