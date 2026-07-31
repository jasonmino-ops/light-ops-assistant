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
const requestListRoute = fs.readFileSync('app/api/computer-client/requests/route.ts', 'utf8')
const disableRoute = fs.readFileSync(
  'app/api/computer-client/computers/[computerId]/disable/route.ts',
  'utf8',
)
const reapplyRoute = fs.readFileSync(
  'app/api/computer-client/computers/[computerId]/reapply/route.ts',
  'utf8',
)
const selfRoute = fs.readFileSync('app/api/computer-client/bindings/self/route.ts', 'utf8')
const launchTicketRoute = fs.readFileSync(
  'app/api/computer-client/bindings/self/launch-ticket/route.ts',
  'utf8',
)
const consumeRoute = fs.readFileSync(
  'app/api/computer-client/browser-launch/consume/route.ts',
  'utf8',
)
const cashierLaunchPage = fs.readFileSync('app/cashier/launch/page.tsx', 'utf8')
const cashierPage = fs.readFileSync('app/cashier/page.tsx', 'utf8')
const posAuth = fs.readFileSync('lib/desktop-pos-auth.ts', 'utf8')
const closeoutMigration = fs.readFileSync(
  'prisma/migrations/20260730120000_add_computer_console_closeout/migration.sql',
  'utf8',
)
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
  /<CashierAction[\s\S]*?label=\{t\('home\.cashier'\)\}/,
  'staff must retain the Browser POS computer-console entry',
)
assert.doesNotMatch(
  home,
  /\{effectiveRole === 'OWNER' && computerConsoleOpen && \([\s\S]*?<ComputerConsoleModal/,
  'staff access to the Browser POS modal must not be owner-gated',
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

// ── 已绑定 / 已停用管理闭环 ────────────────────────────────────────────────
assert.match(computerClientPage, /computerClientBoundTitle/, 'the page must expose bound computers')
assert.match(computerClientPage, /computerClientDisabledTitle/, 'the page must expose disabled computers')
assert.match(computerClientPage, /boundComputers\.map\(/, 'bound computers must come from the API')
assert.match(computerClientPage, /disabledComputers\.map\(/, 'disabled computers must come from the API')
assert.match(computerClientPage, /computerClientComputerId/, 'management cards must show Computer ID')
assert.match(computerClientPage, /computerClientBoundAt/, 'management cards must show binding time')
assert.match(computerClientPage, /computerClientCurrentStatus/, 'management cards must show current status')
assert.match(
  computerClientPage,
  /apiFetch\(\s*`\/api\/computer-client\/computers\/\$\{computerId\}\/disable`/,
  'disable must call the scoped OWNER API',
)
assert.doesNotMatch(
  computerClientPage,
  /enableComputer|reenable|resumeComputer|重新启用/,
  'this release must not expose re-enable',
)
assert.match(requestListRoute, /tenantId:\s*ctx\.tenantId[\s\S]*storeId:\s*ctx\.storeId/, 'all management lists must be tenant/store scoped')
assert.match(disableRoute, /ctx\.role !== 'OWNER'/, 'disable must require an OWNER session')
assert.match(disableRoute, /disabledAt:\s*now/, 'disable must be a soft state change')
assert.match(disableRoute, /credentialStatus:\s*'VOID'/, 'disable must invalidate the Agent credential')
assert.match(disableRoute, /COMPUTER_BINDING_DISABLED/, 'disable must preserve an audit event')
assert.doesNotMatch(disableRoute, /\.delete(?:Many)?\(/, 'disable must never delete the binding')
assert.match(computerClientPage, /computerClientRestoreUse/, 'disabled computers must expose restore use')
assert.match(
  computerClientPage,
  /apiFetch\(\s*`\/api\/computer-client\/computers\/\$\{computerId\}\/reapply`/,
  'restore use must call the scoped OWNER API',
)
assert.match(reapplyRoute, /ctx\.role !== 'OWNER'/, 'restore use must require an OWNER session')
assert.match(
  reapplyRoute,
  /tenantId:\s*ctx\.tenantId[\s\S]*storeId:\s*ctx\.storeId[\s\S]*disabledAt:\s*\{\s*not:\s*null\s*\}/,
  'restore use must be scoped to a disabled computer in the current tenant and store',
)
assert.match(reapplyRoute, /COMPUTER_REAPPLY_ALLOWED_EVENT/, 'restore use must leave an audit trail')
assert.match(reapplyRoute, /computerBindingAudit\.upsert/, 'repeated restore use clicks must be idempotent')
assert.doesNotMatch(
  reapplyRoute,
  /computerBinding\.(?:update|delete)|status:\s*'APPROVED'/,
  'restore use must never reactivate or delete the old binding',
)
assert.match(selfRoute, /reapplyAllowed/, 'the Agent self channel must expose the restore permission')
assert.match(requestListRoute, /reapplyAllowed/, 'the OWNER list must expose restore permission state')
assert.doesNotMatch(closeoutMigration, /DROP TABLE|DELETE FROM/i, 'forward migration must not delete business data')

// ── 一次性 Browser Launch Ticket + 现有 POS Session ──────────────────────
assert.match(launchTicketRoute, /authenticateAgent\(req,\s*'device'\)/, 'launch ticket issuance must use Computer Identity device auth')
assert.match(launchTicketRoute, /computerBrowserLaunchTicket\.create/, 'the server must persist only a launch-ticket record')
assert.doesNotMatch(launchTicketRoute, /signPosDeviceToken/, 'the Agent endpoint must not receive a long-lived POS token')
assert.match(consumeRoute, /usedAt:\s*null[\s\S]*expiresAt:\s*\{\s*gt:\s*now\s*\}/, 'ticket consumption must atomically require unused and unexpired state')
assert.match(consumeRoute, /TransactionIsolationLevel\.Serializable/, 'consume must serialize against concurrent disable')
assert.match(consumeRoute, /issuePosDeviceSession\(tx,/, 'consume must create the existing Browser POS session')
assert.match(consumeRoute, /browserPosDeviceId:\s*browserSession\.sessionId/, 'the ticket lifecycle must retain its resulting Browser POS session id')
assert.doesNotMatch(consumeRoute, /claimSecret|deviceSecret/, 'browser ticket consumption must not accept Agent credentials')
assert.match(cashierLaunchPage, /window\.history\.replaceState\(null,\s*'',\s*'\/cashier\/launch'\)/, 'the launch page must immediately remove its fragment')
assert.match(cashierLaunchPage, /window\.location\.replace\('\/cashier'\)/, 'the final URL must be plain /cashier')
assert.match(cashierLaunchPage, /savePosDeviceToken/, 'the launch page must save the existing POS session format')
assert.doesNotMatch(cashierLaunchPage, /Telegram|storeCode=.*ticket|posDeviceToken=.*location/i, 'the launch page must not restart Telegram auth or put long tokens in URLs')
assert.match(cashierPage, /takeComputerLaunchStoreCode\(\)/, 'cashier must accept the one-time same-tab store bootstrap')
assert.match(cashierPage, /if \(getPosDeviceToken\(cachedStoreCode\)\)[\s\S]*sc = cachedStoreCode/, 'an existing POS session must keep the final URL at plain /cashier')
assert.match(posAuth, /payload\.browserPosSessionId/, 'managed POS tokens must carry only a Browser Session reference')
assert.match(posAuth, /prisma\.browserPosDevice\.findFirst/, 'daily authorization must validate the existing Browser Session lifecycle')
assert.doesNotMatch(posAuth, /prisma\.computerBinding/, 'daily Browser POS authorization must not read Computer Binding')
assert.match(disableRoute, /browserPosDevice\.updateMany/, 'computer disable must end its Browser Sessions at the lifecycle boundary')

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
    'computerClientBoundTitle',
    'computerClientBoundEmpty',
    'computerClientDisabledTitle',
    'computerClientDisabledEmpty',
    'computerClientComputerId',
    'computerClientBoundAt',
    'computerClientDisabledAt',
    'computerClientCurrentStatus',
    'computerClientStatusActive',
    'computerClientStatusDisabled',
    'computerClientDisable',
    'computerClientDisabling',
    'computerClientConfirmDisable',
    'computerClientDisabled',
    'computerClientDisableFailed',
    'computerClientRestoreUse',
    'computerClientRestoringUse',
    'computerClientWaitingReapply',
    'computerClientConfirmRestoreUse',
    'computerClientRestoreUseAllowed',
    'computerClientRestoreUseFailed',
    'computerClientLaunchWorking',
    'computerClientLaunchWorkingDesc',
    'computerClientLaunchFailed',
    'computerClientLaunchFailedDesc',
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
