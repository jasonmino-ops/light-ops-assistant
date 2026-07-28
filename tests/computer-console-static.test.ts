import assert from 'node:assert/strict'
import fs from 'node:fs'
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ComputerConsoleModal from '../app/home/ComputerConsoleModal'
import { buildComputerConsoleCashierUrl } from '../app/home/computer-console-url'

(globalThis as typeof globalThis & { React: typeof React }).React = React

const home = fs.readFileSync('app/home/page.tsx', 'utf8')
const modal = fs.readFileSync('app/home/ComputerConsoleModal.tsx', 'utf8')
const computerClientPage = fs.readFileSync('app/home/computer-client/page.tsx', 'utf8')
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
  canManageComputerClient: false,
  onClose() {},
}))
assert.doesNotMatch(unavailableMarkup, /<a\b/, 'missing storeCode must not render an executable cashier link')
assert.doesNotMatch(unavailableMarkup, /\/cashier\?lang=/, 'missing storeCode must not expose a partial cashier URL')
assert.equal((unavailableMarkup.match(/\sdisabled=""/g) ?? []).length, 2, 'missing storeCode must disable both browser actions')

const availableMarkup = renderToStaticMarkup(createElement(ComputerConsoleModal, {
  cashierUrl: sampleCashierUrl,
  canManageComputerClient: false,
  onClose() {},
}))
assert.match(availableMarkup, /href="[^"]*\/cashier\?storeCode=STORE-A&amp;lang=zh"/, 'valid storeCode should render the formal cashier link')
assert.equal((availableMarkup.match(/\sdisabled=""/g) ?? []).length, 0, 'valid storeCode should enable both browser actions')

const ownerMarkup = renderToStaticMarkup(createElement(ComputerConsoleModal, {
  cashierUrl: sampleCashierUrl,
  canManageComputerClient: true,
  onClose() {},
}))
assert.match(ownerMarkup, /href="\/home\/computer-client"/, 'real owners should see the computer client management entry')
assert.doesNotMatch(availableMarkup, /href="\/home\/computer-client"/, 'staff should not see the computer client management entry')

assert.match(home, /<ComputerConsoleModal/, 'home should expose the computer console as a lightweight modal')
assert.match(home, /const cashierUrl = buildComputerConsoleCashierUrl\(storeCode, lang\)/, 'home should only build the cashier URL through the guarded helper')
assert.match(home, /cashierUrl=\{cashierUrl\}/, 'home should pass the final cashier URL into the modal')
assert.match(
  home,
  /\{effectiveRole === 'OWNER' && \(\s*<CashierAction[\s\S]*?label=\{t\('home\.cashier'\)\}/,
  'the computer console quick action should only render in the current owner work mode',
)
assert.match(
  home,
  /\{effectiveRole === 'OWNER' && computerConsoleOpen && \([\s\S]*?<ComputerConsoleModal/,
  'an open computer console should close with current owner work-mode access',
)
assert.match(home, /canManageComputerClient=\{effectiveRole === 'OWNER'\}/, 'computer client management should follow the current work mode')
assert.match(modal, /disabled=\{!cashierUrl\}/, 'copy must be disabled until the current store is ready')
assert.match(modal, /if \(cashierUrl\) void handleCopy\(cashierUrl,\s*'browser'\)/, 'copy must guard the final cashier URL')
assert.match(modal, /\{cashierUrl \? \([\s\S]*href=\{cashierUrl\}[\s\S]*\) : \([\s\S]*<button[\s\S]*disabled/, 'open must render as a disabled button until the current store is ready')
assert.match(modal, /href=\{cashierUrl\}[\s\S]*target="_blank"[\s\S]*rel="noopener noreferrer"/, 'browser POS open should use the same final cashier URL')
assert.doesNotMatch(modal, /desktopPath|desktopUrl/, 'the modal should not retain ambiguous legacy desktop URL names')

assert.doesNotMatch(modal, /apiFetch|\/api\/stores|\/api\/desktop\/activation-pins/, 'the product shell must not request merchant PIN APIs')
assert.doesNotMatch(modal, /issuedPin|generatePin|revokePin|copyDesktopPin|generateDesktopPin/, 'the product shell must not retain merchant PIN state or actions')
assert.match(computerClientPage, /effectiveRole !== 'OWNER'[\s\S]*router\.replace\('\/home'\)/, 'the management shell should redirect outside owner work mode')
assert.doesNotMatch(computerClientPage, /realRole/, 'the management shell must not bypass staff work mode through real owner identity')
assert.match(computerClientPage, /computerClientManagementTitle/, 'the management shell should render its product title')
assert.match(computerClientPage, /computerClientManagementDesc/, 'the management shell should explain its purpose')
assert.match(computerClientPage, /computerClientPendingTitle/, 'the management shell should expose the pending-computers section')
assert.match(computerClientPage, /computerClientEmptyTitle/, 'the management shell should expose the truthful empty state')
assert.match(computerClientPage, /computerClientCloudUnavailable/, 'the empty state should disclose that cloud approval is unavailable')
assert.match(
  computerClientPage,
  /data-computer-request-region="loading-error-list"/,
  'the shell should reserve one stable region for future loading, error, and real request states',
)
for (const futureSlot of ['Computer ID', 'computer name', 'system version', 'request time', 'decision action area']) {
  assert.match(computerClientPage, new RegExp(futureSlot), `the future request region should reserve the ${futureSlot} slot`)
}
assert.doesNotMatch(computerClientPage, /apiFetch|fetch\s*\(|\/api\//, 'the UI-only shell must not call an API')
assert.doesNotMatch(computerClientPage, /localhost|127\.0\.0\.1|iframe/i, 'the UI-only shell must not embed or reference local services')
assert.doesNotMatch(computerClientPage, /mock|fixture|sample|requests\s*=|requests\.map/i, 'the UI-only shell must not provide fake requests')
assert.doesNotMatch(computerClientPage, /pendingCount|requestCount|requests\.length|待审批数量/i, 'the UI-only shell must not expose a fake pending count')
assert.doesNotMatch(computerClientPage, /<button|approve|reject|批准|拒绝/i, 'the UI-only shell must not expose approval actions')
assert.doesNotMatch(computerClientPage, /\bPIN\b|activation-pins|desktopPin|generateDesktopPin/i, 'the UI-only shell must not retain legacy PIN copy or actions')
assert.doesNotMatch(computerClientPage, /\/desktop\b|DesktopActivation|desktop activation/i, 'the UI-only shell must not expose the legacy Desktop activation entry')

for (const [language, source] of [['zh', zh], ['en', en], ['km', km]] as const) {
  for (const key of [
    'computerConsoleTitle',
    'browserCashierTitle',
    'computerClientTitle',
    'computerClientDesc',
    'manageComputers',
    'computerClientManagementTitle',
    'computerClientManagementDesc',
    'computerClientPendingTitle',
    'computerClientEmptyTitle',
    'computerClientCloudUnavailable',
  ]) {
    assert.match(source, new RegExp(`\\b${key}:`), `${language} should translate ${key}`)
  }
  assert.doesNotMatch(
    source,
    /\b(?:desktopClientTitle|desktopClientDesc|desktopPin\w*|copyDesktopPin|revokeDesktopPin|generateDesktopPin|generatingDesktopPin):/,
    `${language} should not retain the merchant PIN product copy`,
  )
}

assert.match(zh, /暂无待审批电脑/, 'Chinese should state the truthful empty result')
assert.match(zh, /云端设备审批尚未启用。启用后，请先在新电脑提交绑定申请，申请会显示在这里。/, 'Chinese should explain the unavailable cloud boundary and next step')
assert.match(en, /Cloud device approval is not enabled yet\./, 'English should explain the unavailable cloud boundary')
assert.match(km, /Cloud/, 'Khmer should explain the unavailable cloud boundary')

console.log('computer console static tests passed')
