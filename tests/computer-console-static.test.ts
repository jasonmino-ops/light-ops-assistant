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
assert.match(computerClientPage, /computerClientManagementTitle/, 'the management page should render its product title')
assert.match(computerClientPage, /computerClientManagementDesc/, 'the management page should explain its purpose')
assert.match(computerClientPage, /computerClientPendingTitle/, 'the management page should expose the pending-computers section')
assert.match(computerClientPage, /computerClientEmptyTitle/, 'the management page should expose the empty state')
assert.match(
  computerClientPage,
  /data-computer-request-region="loading-error-list"/,
  'the page should keep one stable region for loading, error, and real request states',
)

// ── 真实审批页（云端审批已接通）─────────────────────────────────────────────
assert.match(
  computerClientPage,
  /apiFetch\('\/api\/computer-client\/requests'/,
  'the approval page must read pending requests from the Computer Client OWNER API',
)
assert.match(
  computerClientPage,
  /apiFetch\(\s*`\/api\/computer-client\/requests\/\$\{requestId\}\/\$\{action\}`/,
  'the approval page must call the OWNER approve/reject API',
)
assert.match(computerClientPage, /computerClientLoading/, 'the approval page must expose a loading state')
assert.match(computerClientPage, /computerClientLoadFailed/, 'the approval page must expose an error state')
assert.match(computerClientPage, /computerClientRetry/, 'the error state must offer a retry action')
assert.match(computerClientPage, /computerClientEmptyDesc/, 'the empty state must tell the owner what to do next')
assert.match(computerClientPage, /requests\.map\(/, 'the approval page must render the real request list')
assert.match(computerClientPage, /computerClientApprove/, 'the approval page must expose an approve action')
assert.match(computerClientPage, /computerClientReject/, 'the approval page must expose a reject action')
assert.match(computerClientPage, /computerClientConfirmReject/, 'reject must ask for confirmation')
assert.match(computerClientPage, /decide\(item\.requestId,\s*'approve'\)/, 'approve must be wired to the request id')
assert.match(computerClientPage, /decide\(item\.requestId,\s*'reject'\)/, 'reject must be wired to the request id')

// ── 身份与边界 ──────────────────────────────────────────────────────────────
assert.match(computerClientPage, /effectiveRole !== 'OWNER'[\s\S]*router\.replace\('\/home'\)/, 'the approval page should redirect outside owner work mode')
assert.doesNotMatch(computerClientPage, /realRole/, 'the approval page must not bypass staff work mode through real owner identity')
assert.doesNotMatch(
  computerClientPage,
  /OWNER_CTX|STAFF_CTX|x-tenant-id|x-role/,
  'the approval page must not inject development identity headers',
)
assert.doesNotMatch(computerClientPage, /computerClientCloudUnavailable/, 'the stale "cloud unavailable" copy must no longer be rendered')
assert.doesNotMatch(computerClientPage, /localhost|127\.0\.0\.1|iframe/i, 'the approval page must not embed or reference local services')
assert.doesNotMatch(computerClientPage, /mock|fixture|sampleRequests/i, 'the approval page must not provide fake requests')
assert.doesNotMatch(computerClientPage, /\bPIN\b|activation-pins|desktopPin|generateDesktopPin/i, 'the approval page must not retain legacy PIN copy or actions')
assert.doesNotMatch(computerClientPage, /\/desktop\b|DesktopActivation|desktop activation/i, 'the approval page must not expose the legacy Desktop activation entry')
assert.doesNotMatch(computerClientPage, /tenantId|storeId/, 'the approval page must not surface internal tenant or store identifiers')

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
    'computerClientEmptyDesc',
    'computerClientLoading',
    'computerClientLoadFailed',
    'computerClientRetry',
    'computerClientApprove',
    'computerClientReject',
    'computerClientApproving',
    'computerClientApproved',
    'computerClientRejected',
    'computerClientActionFailed',
    'computerClientStateChanged',
    'computerClientRequestedAt',
    'computerClientAgentVersion',
    'computerClientSystem',
    'computerClientConfirmReject',
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
assert.match(zh, /请先在新电脑上填写门店码提交绑定申请/, 'Chinese should tell the owner what to do next')
assert.match(en, /submit a binding request/i, 'English should tell the owner what to do next')
assert.match(km, /\u1781\u17d2\u1798\u17c2\u179a|\u179f\u17c6\u178e\u17be/, 'Khmer should provide translated approval copy')

console.log('computer console static tests passed')
