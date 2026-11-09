import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { createCashierRealtimeWakeCoalescer } from '../lib/cashier-realtime-client'
import { notifyCashierGateway } from '../lib/cashier-realtime-notify'

const root = process.cwd()
const { readUsbFrontSuccessor } = createRequire(resolve(root, 'package.json'))('./scripts/governance/es-print-usb-baseline-01.cjs')
const { readUnifiedPrintSuccessor } = createRequire(resolve(root, 'package.json'))('./scripts/governance/es-print-unified-integration-01.cjs')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

async function main() {
  const cashier = read('app/cashier/page.tsx')
  const ticket = read('app/api/cashier-realtime/ticket/route.ts')
  const notify = read('lib/cashier-realtime-notify.ts')

  // Disabled: public flag defaults false, prevents ticket issuance and server notify.
  assert.match(cashier, /NEXT_PUBLIC_CASHIER_REALTIME_ENABLED\s*\?\?\s*''/)
  assert.match(ticket, /if \(!cashierRealtimeEnabled\(\)\)[\s\S]*CASHIER_REALTIME_DISABLED/)
  assert.ok(
    ticket.indexOf('CASHIER_REALTIME_DISABLED') < ticket.indexOf('prisma.store.findUnique'),
    'disabled ticket must return before DB/auth work',
  )
  assert.match(notify, /if \(!enabled\) return \{ ok: false, reason: 'disabled' \}/)
  assert.match(ticket, /!dedicatedSecretConfigured\(secret\)/, 'ticket secret must be present and valid')
  assert.match(ticket, /!dedicatedSecretConfigured\(notifySecret\)/, 'notify secret must be present and valid')
  assert.match(ticket, /notifySecret === secret/, 'ticket and notify secrets must remain independent')
  assert.match(ticket, /!configuredGatewayUrl/, 'gateway URL must be present and valid')
  assert.ok(
    ticket.indexOf('!dedicatedSecretConfigured(notifySecret)') < ticket.indexOf('const ticket = await signCashierRealtimeTicket'),
    'incomplete server-notify configuration must fail closed before ticket signing',
  )
  const ticketResponse = ticket.slice(ticket.indexOf('return json({\n      ticket,'), ticket.indexOf('}, 503)', ticket.indexOf('return json({\n      ticket,')))
  assert.doesNotMatch(ticketResponse, /notifySecret|CASHIER_REALTIME_NOTIFY_SECRET/, 'ticket response must never expose notify credentials')
  const previousFlag = process.env.NEXT_PUBLIC_CASHIER_REALTIME_ENABLED
  delete process.env.NEXT_PUBLIC_CASHIER_REALTIME_ENABLED
  let disabledFetchCalled = false
  const disabledNotify = await notifyCashierGateway({
    tenantId: 'tenant-a', storeId: 'store-a', type: 'orders_changed',
  }, {
    gatewayUrl: 'https://gateway.example',
    secret: 'notify-secret-is-at-least-32-bytes-long',
    fetchImpl: async () => {
      disabledFetchCalled = true
      return new Response(null, { status: 202 })
    },
  })
  if (previousFlag === undefined) delete process.env.NEXT_PUBLIC_CASHIER_REALTIME_ENABLED
  else process.env.NEXT_PUBLIC_CASHIER_REALTIME_ENABLED = previousFlag
  assert.deepEqual(disabledNotify, { ok: false, reason: 'disabled' })
  assert.equal(disabledFetchCalled, false)

  // State machine: one fixed timer and one cadence mapping; lifecycle owns immediate/reconnect cleanup.
  const scheduleStart = cashier.indexOf('const cashierAuthorized')
  const scheduleEnd = cashier.indexOf('// ── Keyboard shortcuts', scheduleStart)
  assert.ok(scheduleStart > 0 && scheduleEnd > scheduleStart)
  const schedule = cashier.slice(scheduleStart, scheduleEnd)
  assert.equal((schedule.match(/setInterval\(/g) ?? []).length, 1, 'only one fixed timer may exist')
  assert.match(schedule, /cashierRealtimeMode === 'HEALTHY'[\s\S]*30_000[\s\S]*5_000/)
  assert.match(schedule, /intervalMs === null/)
  assert.match(schedule, /setCashierRealtimeMode\('DISABLED'\)/)
  assert.match(schedule, /setCashierRealtimeMode\('CONNECTING'\)/)
  assert.match(schedule, /status === 'healthy'[\s\S]*'HEALTHY'/)
  assert.match(schedule, /'DEGRADED'/)
  assert.match(schedule, /onConnected: \(reconnected\)[\s\S]*!reconnected[\s\S]*pullCashierBoth\(\)/)
  assert.match(schedule, /clearInterval\(timer\)/)
  assert.match(schedule, /realtimeClient\.stop\(\)/)
  assert.match(schedule, /removeEventListener\('visibilitychange'/)

  // Targeted wake and visibility: orders only, pending only, hidden reconciliation paused, socket retained.
  assert.match(schedule, /type === 'orders_changed'[\s\S]*pullCashierOrders\(\)[\s\S]*return/)
  assert.match(schedule, /cashierVisibleRef\.current\)[\s\S]*cashierRealtimeDirtyRef\.current = true[\s\S]*return[\s\S]*pullCashierPendingOrders\(\)/)
  assert.match(schedule, /!wasVisible && visible[\s\S]*pullCashierBoth\(\)/)
  const visibilityBlock = schedule.slice(schedule.indexOf('// Visibility changes'), schedule.indexOf('// Exactly one fixed cadence'))
  assert.doesNotMatch(visibilityBlock, /\.stop\(\)|\.close\(/, 'visibility must not close the WebSocket')

  // In-flight guard: one trailing refresh maximum for each active request.
  assert.match(cashier, /if \(guard\.inFlight\)[\s\S]*guard\.trailing = true[\s\S]*return guard\.inFlight/)
  assert.equal((read('app/cashier/page.tsx').match(/runCashierPullGuard\(/g) ?? []).length, 3)
  assert.match(cashier, /if \(guardRef\.current === guard && guard\.trailing\)[\s\S]*success = await pullOnce\(\)/)

  // Actual Stage 1B coalescer keeps one signal per type at the approved 350ms default.
  const coalesced: string[] = []
  const coalescer = createCashierRealtimeWakeCoalescer({ onWake: type => coalesced.push(type) })
  coalescer.push({ version: 1, type: 'orders_changed', timestamp: 1, eventId: 'orders-1' })
  coalescer.push({ version: 1, type: 'orders_changed', timestamp: 2, eventId: 'orders-2' })
  coalescer.push({ version: 1, type: 'pending_orders_changed', timestamp: 3, eventId: 'pending-1' })
  await new Promise(resolvePromise => setTimeout(resolvePromise, 380))
  assert.deepEqual(coalesced.sort(), ['orders_changed', 'pending_orders_changed'])
  coalescer.clear()

  // Failure isolation: rejected, DNS/network, invalid config, and timeout are values, never throws.
  const baseNotify = { tenantId: 'tenant-a', storeId: 'store-a', type: 'orders_changed' as const }
  const baseOptions = {
    enabled: true,
    gatewayUrl: 'https://gateway.example',
    secret: 'notify-secret-is-at-least-32-bytes-long',
    logger: { warn() {} },
  }
  const delivered: Array<{ url: string; body: Record<string, unknown> }> = []
  const accepted = await notifyCashierGateway(baseNotify, {
    ...baseOptions,
    nowMs: 1_700_000_000_000,
    fetchImpl: async (url, init) => {
      delivered.push({ url: String(url), body: JSON.parse(String(init?.body)) })
      return new Response(null, { status: 202 })
    },
  })
  assert.equal(accepted.ok, true)
  assert.equal(delivered.length, 1)
  assert.equal(delivered[0].url, 'https://gateway.example/notify')
  assert.deepEqual(delivered[0].body, {
    version: 1,
    tenantId: 'tenant-a',
    storeId: 'store-a',
    type: 'orders_changed',
    timestamp: 1_700_000_000_000,
    eventId: delivered[0].body.eventId,
  })
  assert.deepEqual(await notifyCashierGateway(baseNotify, {
    ...baseOptions,
    fetchImpl: async () => new Response(null, { status: 500 }),
  }), { ok: false, reason: 'rejected', status: 500 })
  assert.deepEqual(await notifyCashierGateway(baseNotify, {
    ...baseOptions,
    fetchImpl: async () => { throw new Error('dns failure') },
  }), { ok: false, reason: 'network' })
  assert.deepEqual(await notifyCashierGateway(baseNotify, {
    ...baseOptions,
    gatewayUrl: 'file:///invalid',
  }), { ok: false, reason: 'invalid_config' })
  assert.deepEqual(await notifyCashierGateway(baseNotify, {
    ...baseOptions,
    timeoutMs: 100,
    fetchImpl: async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }),
  }), { ok: false, reason: 'timeout' })

  // Approved write routes schedule one wake outside the transaction/mutation and never await Cloudflare.
  // customer-orders is covered by real route behavior tests below; it has no
  // source-marker assertion because its fulfillment transaction has multiple
  // legitimate success branches.
  const routeCases = [
    ['app/api/public/orders/route.ts', 'orders_changed', 'order = await prisma.$transaction'],
    ['app/api/cashier/orders/[id]/route.ts', 'orders_changed', 'const updated = await prisma.customerOrder.update'],
    ['app/api/sales/route.ts', 'pending_orders_changed', 'const result = await prisma.$transaction'],
    ['app/api/orders/[orderNo]/checkout/route.ts', 'pending_orders_changed', 'const pi = await prisma.$transaction'],
    ['app/api/orders/[orderNo]/cancel/route.ts', 'pending_orders_changed', 'await prisma.$transaction'],
    ['app/api/payments/[paymentId]/confirm/route.ts', 'pending_orders_changed', 'const [updated, pendingTransition] = await prisma.$transaction'],
    ['app/api/payments/[paymentId]/cancel/route.ts', 'pending_orders_changed', 'await prisma.$transaction'],
  ] as const
  for (const [path, wakeType, successMarker] of routeCases) {
    const source = read(path)
    assert.equal((source.match(/after\(\(\) => notifyCashierGateway\(\{/g) ?? []).length, 1, `${path}: one notify`)
    assert.match(source, new RegExp(`type: '${wakeType}'`))
    assert.ok(source.indexOf('after(() => notifyCashierGateway') > source.indexOf(successMarker), `${path}: notify after success`)
    assert.doesNotMatch(source, /await\s+notifyCashierGateway/, `${path}: business response must not await Cloudflare`)
    const wakeBlock = source.slice(source.indexOf('after(() => notifyCashierGateway'), source.indexOf('}))', source.indexOf('after(() => notifyCashierGateway')) + 3)
    assert.doesNotMatch(wakeBlock, /\btx\b|orderNo|paymentId|customer|items|price/i, `${path}: wake-only payload`)
  }

  const salesRoute = read('app/api/sales/route.ts')
  assert.ok(salesRoute.indexOf('notifyCashierGateway({') > salesRoute.indexOf('async function handleDeferredSale'))
  assert.ok(salesRoute.indexOf('notifyCashierGateway({') < salesRoute.indexOf('async function handleRefund'))
  assert.match(read('app/api/orders/[orderNo]/checkout/route.ts'), /if \(paymentMethod === 'CASH'\)[\s\S]*after\(\(\) => notifyCashierGateway/)

  // Payment wakes are conditional on a real pending-list transition, not merely a PaymentIntent mutation.
  const paymentConfirmRoute = read('app/api/payments/[paymentId]/confirm/route.ts')
  assert.match(paymentConfirmRoute, /const \[updated, pendingTransition\] = await prisma\.\$transaction/)
  assert.match(paymentConfirmRoute, /if \(pendingTransition\.count > 0\) \{[\s\S]*pending_orders_changed[\s\S]*\}/)
  assert.ok(
    paymentConfirmRoute.indexOf('if (pendingTransition.count > 0)') < paymentConfirmRoute.indexOf('after(() => notifyCashierGateway'),
    'direct-retail confirm no-op must not wake pending orders',
  )
  const paymentCancelRoute = read('app/api/payments/[paymentId]/cancel/route.ts')
  assert.match(paymentCancelRoute, /prisma\.saleRecord\.count\([\s\S]*status: 'PENDING_PAYMENT'/)
  assert.match(paymentCancelRoute, /if \(pendingRecordCount > 0\) \{[\s\S]*pending_orders_changed[\s\S]*\}/)
  assert.ok(
    paymentCancelRoute.indexOf('if (pendingRecordCount > 0)') < paymentCancelRoute.indexOf('after(() => notifyCashierGateway'),
    'non-pending cancel must not wake pending orders',
  )

  // Candidate boundary: check the complete candidate (tracked and untracked
  // files), rather than relying on a post-commit empty diff or ignoring new
  // files. The H5 task's approved paths are explicit here.
  const changed = [
    ...execFileSync('git', ['diff', '--name-only', 'origin/main'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean),
    ...execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean),
  ].filter((path, index, paths) => paths.indexOf(path) === index)
  const approved = new Set([
    // ES-DINE-IN-01 M1 exact-path package; formal Scope registration remains separate.
    // Remove these entries when the ES-DINE-IN-01 exception is closed.
    '.env.example',
    'app/api/orders/[orderNo]/checkout/route.ts',
    'app/api/orders/[orderNo]/cancel/route.ts',
    'prisma/migrations/20261010_es_dine_in_01/migration.sql',
    'app/api/dine-in/eligibility/route.ts',
    'app/api/dine-in/tables/route.ts',
    'app/api/dine-in/sessions/route.ts',
    'app/api/dine-in/sessions/[id]/route.ts',
    'app/api/dine-in/sessions/[id]/batches/route.ts',
    'app/api/dine-in/sessions/[id]/batches/[batchId]/renotify/route.ts',
    'app/api/dine-in/sessions/[id]/settle/route.ts',
    'app/api/dine-in/sessions/[id]/close/route.ts',
    'app/api/dine-in/sessions/[id]/kitchen/claim/route.ts',
    'app/api/dine-in/sessions/[id]/kitchen/report/route.ts',
    'app/desktop/dine-in/page.tsx',
    'app/desktop/dine-in/components/DiningMealBill.tsx',
    'app/desktop/dine-in/components/DiningProductPicker.tsx',
    'app/desktop/dine-in/components/DiningTableOverview.tsx',
    'lib/dine-in/commands.ts',
    'lib/dine-in/eligibility.ts',
    'lib/dine-in/http.ts',
    'lib/dine-in/i18n.ts',
    'lib/dine-in/kitchen-notice.ts',
    'lib/dine-in/ticket-renderer.ts',
    'lib/dine-in/types.ts',
    'tests/dine-in-m1-contract.test.ts',
    'tests/dine-in-m1-db.test.ts',
    // ES-H5-THREE-TICKET-FULFILLMENT-01: exact incremental migration; formal Scope remains separate.
    'prisma/migrations/20261009090000_add_customer_order_fulfillment_purpose/migration.sql',
    // ES-H5-DESKTOP-FULFILLMENT-WIRING-01 exact successor registration.
    'app/cashier/page.tsx',
    'tests/es-tray-desktop-pos-entry.test.ts',
    'tests/v3-reprint-recovery.test.ts',
    'docs/change-gates/exceptions/ES-H5-DESKTOP-FULFILLMENT-WIRING-01.json',
    'app/api/customer-orders/[id]/route.ts',
    'app/api/customer-orders/[id]/khqr/route.ts',
    'app/menu/page.tsx',
    'app/p/[slug]/page.tsx',
    'prisma/migrations/20261007090000_add_customer_order_submission_idempotency/migration.sql',
    'tests/customer-order-submission.test.ts',
    'tests/product-discount-v01-static.test.ts',
    'tests/es-tray-device-print-contract.test.ts',
    'tests/subscription-expiry-reminder.test.ts',
    'tests/desktop-pos-write-fallback-runtime.test.ts',
    'tests/network-print-jobs-api.test.ts',
    'tests/v2-relay-endtoend-snapshot.test.ts',
    'tests/__snapshots__/v2-relay-endtoend-snapshot.json',
    'tests/dashboard-print-settings-mobile.test.ts',
    'tests/desktop-pos-web-auth-compat.test.ts',
    'tests/es-tray-desktop-launch-route.test.ts',
    'tests/es-tray-relay-runtime.test.ts',
    'app/api/customer-orders/route.ts',
    'app/api/public/orders/route.ts',
    'app/api/cron/customer-order-fulfillment-recovery/route.ts',
    'app/home/page.tsx',
    'lib/customer-order-fulfillment.ts',
    'lib/customer-order-fulfillment-renderer.ts',
    'tests/customer-order-fulfillment.test.ts',
    'tests/customer-order-payment-intent.test.ts',
    'tests/customer-order-recovery.test.ts',
    'scripts/test/manifests/root-core-tests.json',
    'vercel.json',
    'prisma/schema.prisma',
    'prisma/migrations/20261005120000_add_customer_order_fulfillment_intent/migration.sql',
    'lib/v3-print-job-adapter.ts',
    'lib/v3-print-reprint.ts',
    'tests/v3-print-job-adapter.test.ts',
    'tests/customer-order-fulfillment-db.test.ts',
    'scripts/test/manifests/root-integration-tests.json',
    'tests/cashier-realtime-integration.test.ts',
    'tests/network-release-deployment-policy.test.cjs',
    'lib/customer-order-render-dispatch.ts',
    'app/api/customer-order-renderer/route.ts',
    'prisma/migrations/20261006160000_add_customer_order_render_dispatch/migration.sql',
    'tests/customer-order-renderer.test.ts',
    'tests/customer-order-renderer-host.test.ts',
    'packages/h5-renderer/package.json',
    'packages/h5-renderer/package-lock.json',
    'packages/h5-renderer/artifact-manifest.json',
    'packages/h5-renderer/build.mjs',
    'packages/h5-renderer/module.mjs',
    'packages/h5-renderer/controller.mjs',
    'packages/h5-renderer/service.mjs',
    'packages/h5-renderer/runtime/h5-render-controller.service',
    'packages/h5-renderer/runtime/h5-render-sandbox.service',
    'packages/h5-renderer/runtime/h5-render-sandbox.socket',
    'packages/h5-renderer/runtime/apparmor.profile',
  ])
  const assertBoundary = (paths: string[], allowed: ReadonlySet<string>) => {
    assert.deepEqual(paths.filter(path => !allowed.has(path)), [])
    assert.equal(paths.includes('app/api/cashier/orders/route.ts'), false)
    assert.equal(paths.includes('app/api/cashier/pending-orders/route.ts'), false)
    assert.equal(paths.some(path => path === 'app/sale/page.tsx' || path.includes('customer-display') || path.includes('pos/session/update')), false)
    assert.equal(paths.some(path => (path.startsWith('prisma/') || path.includes('migration') || path.includes('print')) && !allowed.has(path)), false)
  }

  // Founder EXACT SCOPE EXPANSION: ES-PRINT-NEW-STORE-NETWORK-ONBOARDING-01,
  // M1 SAFE SETTINGS-ONLY, MINIMAL TASK-BOUND ALLOWLIST SUCCESSOR.
  // Like the fixed H5/Dine-in successors, bind to exact approved content, not
  // a branch name or an environment flag. Do NOT union this into the legacy set.
  const productCandidate = 'bd4ed1a532b4db9609841bb5d8e2e184793fecad'
  const correctiveCandidate = '5c0a2895bb188610d494bb4aadf4b8f7641037f5'
  const approvedBase = 'ede397d808cd88347d5c641ff833d1a7a6fe404d'
  const successorPath = 'tests/cashier-realtime-integration.test.ts'
  const productPaths = [
    'e-shop-tray/network-addon/entryCoordinator.ts',
    'e-shop-tray/network-addon/main.ts',
    'e-shop-tray/network-addon/ui.ts',
    'e-shop-tray/tests/network-addon-settings-only.test.ts',
  ]
  const correctivePaths = [
    'scripts/test/run-root-full-suite.mjs',
    'tests/desktop-pos-web-auth-compat.test.ts',
  ]
  // ES-PRINT-NEW-STORE-NETWORK-ONBOARDING-01 M2: Founder-approved sealed
  // successor coordination for the Desktop Management Center entry wiring.
  // Keep this separate from the legacy set and bind it to the exact current
  // trusted base. Once M2 is merged, origin/main changes and this temporary
  // successor branch no longer applies to later edits.
  const m2ApprovedBase = '22413afea7cf249f907a263013e45367bd121db7'
  const m2Paths = [
    'app/management/page.tsx',
    'desktop/src/main/networkPrintSettingsLauncher.ts',
    'desktop/src/main/ipcRouter.ts',
    'desktop/src/preload/employeePreload.ts',
    'desktop/src/shared/ipcChannels.ts',
    'desktop/tests/network-print-settings-launcher.test.ts',
    'desktop/tests/ipc-whitelist.test.ts',
    'desktop/tests/static-security.test.ts',
    'tests/management-center-static.test.cjs',
    'e-shop-tray/network-addon/shortcutLifecycle.ts',
    'e-shop-tray/tests/network-addon-shortcuts.test.ts',
    'lib/i18n/zh.ts',
    'lib/i18n/en.ts',
    'lib/i18n/km.ts',
  ]
  const m2SuccessorPath = 'tests/cashier-realtime-integration.test.ts'
  // ES-PRINT-NEW-STORE-NETWORK-ONBOARDING-01 M3: exact Desktop packaging
  // successor coordination. This is a governance-test registration only; it
  // does not authorize any additional product or runtime path.
  const m3ApprovedBase = 'c4a675b5e7bbf95be4b5ab9ad81cec97b5c7584b'
  const m3Candidate = 'd7448e6045293e8311f7a214d4cb453bc8e84236'
  const m3Paths = [
    '.task-state/ES-PRINT-NEW-STORE-NETWORK-ONBOARDING-01-M3.md',
    'desktop/build/installer.nsh',
    'desktop/electron-builder.yml',
    'desktop/package.json',
    'desktop/scripts/build-single-installer.mjs',
    'desktop/scripts/single-installer-contract.mjs',
    'desktop/scripts/verify-single-installer.mjs',
    'desktop/tests/single-installer-packaging.test.ts',
    'desktop/tests/windows-autostart-installer.test.ts',
    'desktop/tests/windows-installer-upgrade-lifecycle.test.ts',
  ]
  const m3SuccessorPath = 'tests/cashier-realtime-integration.test.ts'
  // ES-PRINT-NEW-STORE-NETWORK-ONBOARDING-01 M4: exact Printer Onboarding UX
  // and safe FRONT/KITCHEN replacement successor. This registration keeps the
  // historical governance regression exact-path and task-bound; it does not
  // authorize packaging or FIELD release.
  const m4ApprovedBase = '90a88df92b0441d20e55a6420605034095a52612'
  const m4Candidate = '60209a74ab036bddeaf6279c062a769a4ea2db77'
  const m4Paths = [
    'desktop/scripts/build-single-installer.mjs',
    'desktop/scripts/single-installer-contract.mjs',
    'desktop/scripts/verify-single-installer.mjs',
    'desktop/tests/single-installer-packaging.test.ts',
    'e-shop-tray/network-addon/coldModeLifecycle.ts',
    'e-shop-tray/network-addon/entryCoordinator.ts',
    'e-shop-tray/network-addon/main.ts',
    'e-shop-tray/network-addon/preload.ts',
    'e-shop-tray/network-addon/profile.ts',
    'e-shop-tray/network-addon/ui.css',
    'e-shop-tray/network-addon/ui.html',
    'e-shop-tray/network-addon/ui.ts',
    'e-shop-tray/src/networkNodeConfig.ts',
    'e-shop-tray/tests/network-addon-cold-mode-change.test.ts',
    'e-shop-tray/tests/network-addon-entry.test.ts',
    'e-shop-tray/tests/network-addon-lifecycle.test.ts',
    'e-shop-tray/tests/network-addon-settings-only.test.ts',
    'e-shop-tray/tests/network-dual-endpoint.test.ts',
  ]
  const m4SuccessorPath = 'tests/cashier-realtime-integration.test.ts'
  // ES-PRINT-UNIFIED-TERMINAL-IDENTITY-01: exact registration for the
  // Founder-approved presentation unification and Desktop POS handoff race
  // corrective. The two identity models remain separate; this branch only
  // admits the reviewed implementation paths below.
  const unifiedTerminalCandidate = '449fd4e533753d4ac759346575a55b268e12cdc7'
  const unifiedTerminalPaths = [
    'app/api/computer-client/terminals/route.ts',
    'app/api/desktop/devices/[id]/revoke/route.ts',
    'app/home/computer-client/page.tsx',
    'desktop/src/main/ipcRouter.ts',
    'desktop/src/main/posSessionBridge.ts',
    'desktop/tests/pos-session-bridge-static.test.ts',
    'lib/computer-client/unified-terminal.ts',
    'lib/i18n/en.ts',
    'lib/i18n/km.ts',
    'lib/i18n/zh.ts',
    'tests/computer-console-static.test.ts',
  ]
  const unifiedTerminalSuccessorPath = 'tests/cashier-realtime-integration.test.ts'
  // E-SHOP-STORE-NAME-EDIT-01: exact governance registration for the reviewed
  // Store.name candidate. This registration admits only the four reviewed
  // paths and does not authorize any cashier/realtime source changes.
  const storeNameApprovedBase = '0e52807f54035b16e02b43d171439995c10abcc0'
  const storeNameCandidate = '3efcb643a2b474ec24257dd9dfeb00c308dc0a1f'
  const storeNamePaths = [
    'app/api/store/settings/route.ts',
    'app/settings/page.tsx',
    'tests/settings-center-static.test.cjs',
    'tests/settings-center-browser.spec.ts',
  ]
  const gitPaths = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean)
  const gitIsAncestor = (ancestor: string, descendant: string) => spawnSync(
    'git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd: root },
  ).status === 0
  const unmergedCommits = gitPaths('rev-list', 'origin/main..HEAD')
  // ES-DIAMOND-STORE-OPERATIONAL-RECOVERY-01. This branch accepts only the
  // reviewed V3 source and frozen successor bytes on the merged Stage 1 base.
  const diamondBase = '67338b57bf2d872e2b0755c76820036f6f0743f4'
  const diamondPath = 'tests/cashier-realtime-integration.test.ts'
  const diamondContent = new Map([
    ['app/api/ops/tenants/[tenantId]/stores/[storeId]/v3-print-control-plane/route.ts', 'ecdcfc48d334a7b1b623efd3bb45e2e146cb2475a1889878199e8895005ee678'],
    ['app/api/ops/tenants/[tenantId]/stores/[storeId]/v3-print-control-plane/service.ts', '14603085ab8398269cdab7d3180f84b87b08f1a31b349d070f6ee11ff421c24c'],
    ['docs/freezes/ES-DIAMOND-V3-PRINT-FROZEN-SUCCESSOR-01.md', 'b1277d2d78ad1391d2b4928fcc30a909d43d528fe43e6201969d0de5259b9b50'],
    ['tests/es-tray-device-print-contract.test.ts', '4eafd378442affdcda7b28ca7237b640f83b3b113ffe3644ccdfb1436b43a49e'],
    ['tests/v2-invariance-extension-points.test.cjs', 'db05bd55d071f916fdfcd7c0a8c91d204cbfc95a62b9f3c849713f62470e8cef'],
    ['tests/v2-invariance-service-regions.test.cjs', 'd985f9cb0b170ff054f38f2fc6628e82cb66de829fb2c4315fd95da8d68b5335'],
    ['tests/v3-print-control-plane-service.test.ts', '2e45bd0f1631ab752c27d62be2d614d0112bae1e0e51fa79879ea72247eb35e1'],
    ['tests/v3-reprint-recovery.test.ts', 'a3ef7906411245af074f7e990f6417e6143eabcc4d15a447d602fc346313ed11'],
  ])
  const diamondStaged = gitPaths('diff', '--cached', '--no-renames', '--name-only', 'origin/main')
  const diamondCommitted = gitPaths('diff', '--no-renames', '--name-only', 'origin/main', 'HEAD')
  const diamondWorktree = gitPaths('diff', '--no-renames', '--name-only', 'origin/main')
  const diamondChanged = [...new Set([...changed, ...diamondWorktree, ...diamondStaged, ...diamondCommitted])]
  const isDiamond = diamondChanged.some(path => diamondContent.has(path))
  // ES-DIAMOND-P0-FOUNDER-QUEUE-RECOVERY-01: a separate exact-content
  // successor for the one-time Founder queue recovery. Existing Diamond and
  // all other task predicates below remain unchanged.
  const founderP0Base = 'c9508d180d6ea16595f966685eb70e54cb3e48b4'
  const founderP0Registry = 'docs/change-gates/exceptions/ES-DIAMOND-P0-FOUNDER-QUEUE-RECOVERY-01.json'
  const founderP0Record = 'docs/freezes/ES-DIAMOND-P0-FOUNDER-QUEUE-RECOVERY-01.md'
  const founderP0Service = 'app/api/ops/tenants/[tenantId]/stores/[storeId]/v3-print-control-plane/service.ts'
  const founderP0Test = 'tests/v3-print-control-plane-service.test.ts'
  const founderP0Content = new Map([
    [founderP0Service, '1f681d7445258f166f9f532a0c43ff39588112b50f0bd2abf2737685db9cfa44'],
    [founderP0Test, '96f219964ca09520d64cf6f9960df95b08fff132279fcb8b2a97140a10521d57'],
    [founderP0Record, '90bfc15019dc296096d77afabdc2fa2abd3a33c0fa1c98b5a152d0bcd0b4a4e0'],
  ])
  const isFounderP0 = gitPaths('branch', '--show-current')[0] === 'codex/es-diamond-p0-founder-recovery-catalogue'
    && diamondChanged.some(path => path === founderP0Service || path === founderP0Test)
  const isM2 = gitPaths('rev-parse', 'origin/main')[0] === m2ApprovedBase
    && changed.some(path => m2Paths.includes(path))
  const isM3 = gitPaths('rev-parse', 'origin/main')[0] === m3ApprovedBase
    && unmergedCommits.includes(m3Candidate)
    && changed.some(path => m3Paths.includes(path))
  const isM4 = gitIsAncestor(m4ApprovedBase, gitPaths('rev-parse', 'origin/main')[0])
    && unmergedCommits.includes(m4Candidate)
    && changed.some(path => m4Paths.includes(path))
  const isUnifiedTerminal = gitPaths('rev-parse', 'origin/main')[0] === 'a8c22a01da5b8cba5796decb1311f2ee174abcba'
    && unmergedCommits.includes(unifiedTerminalCandidate)
    && changed.some(path => unifiedTerminalPaths.includes(path))
  const isStoreName = gitPaths('rev-parse', 'origin/main')[0] === storeNameApprovedBase
    && unmergedCommits.includes(storeNameCandidate)
    && storeNamePaths.every(path => changed.includes(path))
  // Once merged, the candidate is no longer an unmerged task grant. Later M1
  // path edits still enter this branch and fail without that exact grant.
  const isM1 = !isM4 && (unmergedCommits.includes(productCandidate) || changed.some(path => productPaths.includes(path)))
  const isCombinedCorrective = isM1 && unmergedCommits.includes(correctiveCandidate)
  const catalogueTask = 'ES-PRODUCT-COUNT-LIMIT-01'
  const catalogueBranch = 'codex/es-product-count-limit-01'
  const registrationBranch = `${catalogueBranch}-registration`
  const currentBranch = gitPaths('branch', '--show-current')[0]
  if (currentBranch === registrationBranch || currentBranch === catalogueBranch) {
    const catalogueTest = 'tests/cashier-realtime-integration.test.ts'
    const paths = [
      'app/api/cashier/store/route.ts',
      'app/api/products/route.ts',
      'app/cashier/page.tsx',
      'app/products/page.tsx',
      'app/sale/page.tsx',
      'lib/cashier-offline-db.ts',
      catalogueTest,
      'tests/es-tray-device-print-contract.test.ts',
      'tests/product-sku-search.test.ts',
      'tests/v3-reprint-recovery.test.ts',
    ]
    const registrationPath = `docs/change-gates/exceptions/${catalogueTask}.json`
    const successorPath = 'docs/freezes/ES-PRODUCT-COUNT-LIMIT-01-FROZEN-SUCCESSOR.md'
    const trustedMain = gitPaths('rev-parse', 'origin/main')[0]
    const isRegistration = currentBranch === registrationBranch
    const recordRef = isRegistration ? 'HEAD' : 'origin/main'
    const blobSha = (ref: string, path: string) => createHash('sha256')
      .update(execFileSync('git', ['show', `${ref}:${path}`], { cwd: root })).digest('hex')
    assert.ok(gitIsAncestor(trustedMain, 'HEAD'), 'Catalogue HEAD must descend from trusted main')
    const registration = JSON.parse(gitPaths('show', `${recordRef}:${registrationPath}`).join('\n'))
    assert.equal(registration.taskId, catalogueTask)
    assert.equal(registration.featureBranch, catalogueBranch)
    assert.equal(registration.lineageMode, 'PRE_COMMIT_CONTENT_SHA256')
    assert.equal(registration.baseOriginMainSha, 'c9508d180d6ea16595f966685eb70e54cb3e48b4')
    assert.ok(gitIsAncestor(registration.baseOriginMainSha, trustedMain),
      'Catalogue approved base must be an ancestor of trusted main')
    const guardPaths = ['scripts/guards/check-change-scope.js', 'docs/change-gates/gate-config.json']
    const registrationRecords = isRegistration ? [registrationPath, successorPath] : []
    assert.deepEqual(
      gitPaths('diff', '--no-renames', '--name-only', registration.baseOriginMainSha, trustedMain, '--',
        ...guardPaths, ...paths, ...registrationRecords),
      isRegistration ? [] : [catalogueTest],
      'Catalogue trusted main must preserve the sealed paths and Scope Guard bytes',
    )
    assert.deepEqual(registration.additionalAuthorizations ?? [], [])
    assert.deepEqual([...registration.authorizedPaths].sort(), paths, 'Catalogue grant must name exactly the sealed paths')
    const productDelta = paths.filter(path => path !== catalogueTest)
    const unchangedHashes = productDelta.map(path => [path, registration.authorizedPathSha256[path]])
    assert.equal(createHash('sha256').update(JSON.stringify(unchangedHashes)).digest('hex'),
      'b3346df890ca382043bd6ce1583dd9d02dd677f5d67205b9cd08c233cb3a906f',
      'The nine previously approved catalogue file hashes must remain exact')
    assert.equal(blobSha(recordRef, catalogueTest), registration.authorizedPathSha256[catalogueTest],
      'The installed compatibility test must match the sealed SHA-256')
    assert.equal(blobSha(recordRef, successorPath), registration.approvalSource?.freezeSuccessorSha256,
      'The freeze successor must match the registration SHA-256')

    if (isRegistration) {
      // This branch validates the governance commit without activating its product grant.
      assert.equal(isDiamond, false, 'Catalogue registration cannot claim any Diamond path')
      assert.deepEqual(gitPaths('status', '--porcelain', '--untracked-files=all'), [],
        'Catalogue registration must be a clean commit')
      const bootstrapPaths = [registrationPath, successorPath, catalogueTest].sort()
      assert.deepEqual([...diamondCommitted].sort(), bootstrapPaths,
        'Catalogue registration commit must contain only the two records and compatibility test')
      const { validateException } = require('../scripts/guards/check-change-scope.js')
      const approved = registration.approvalSource?.finalCompatibilityApproval === 'APPROVED'
      assert.equal(registration.status, approved ? 'ACTIVE' : 'DRAFT_NOT_ACTIVE',
        'Only the final exact-content decision can produce an ACTIVE registration')
      // Check the prospective record schema; the committed draft remains invalid to Scope Guard.
      validateException({ ...registration, status: 'ACTIVE' }, root)
      execFileSync(process.execPath, [
        'scripts/guards/check-change-scope.js', '--files', bootstrapPaths.join(','),
      ], { cwd: root, stdio: 'inherit' })
      console.log('Catalogue registration boundary checks passed')
    } else {
      assert.equal(registration.approvalSource?.finalCompatibilityApproval, 'APPROVED',
        'Catalogue compatibility bytes require a final exact-content decision')
      assert.deepEqual([...diamondChanged].sort(), productDelta,
        'Catalogue feature delta must contain exactly the nine remaining sealed paths')

      // Use the real guard for trusted record, branch, lineage and worktree checks.
      // Only the task's registered branch can reach this case; old Diamond checks
      // remain the authority on every branch that would have used them before.
      execFileSync(process.execPath, [
        'scripts/guards/check-change-scope.js', '--task-id', catalogueTask, '--files', paths.join(','),
      ], { cwd: root, stdio: 'inherit' })

      // A valid working file must not conceal different staged or committed bytes.
      const staged = gitPaths('diff', '--cached', '--no-renames', '--name-only', 'HEAD')
      for (const [revision, files] of [['', staged], ['HEAD', diamondCommitted]] as const) {
        for (const path of files) {
          const content = execFileSync('git', ['show', `${revision}:${path}`], { cwd: root })
          assert.equal(createHash('sha256').update(content).digest('hex'), registration.authorizedPathSha256[path],
            `Catalogue ${revision || 'index'} SHA-256 mismatch: ${path}`)
        }
      }
    }
  } else if (isM2) {
    assert.deepEqual(gitPaths('rev-parse', 'origin/main'), [m2ApprovedBase], 'M2 requires the authorized trusted baseline')
    assert.ok(m2Paths.every(path => changed.includes(path)), 'M2 complete sealed 14-path package required')
    assertBoundary(changed, new Set([...m2Paths, m2SuccessorPath]))
  } else if (isCombinedCorrective) {
    assert.deepEqual(gitPaths('rev-parse', 'origin/main'), [approvedBase], 'combined candidate requires the same authorized baseline')
    assert.ok(productPaths.every(path => changed.includes(path)), 'combined candidate requires the reviewed four-path product candidate')
    assert.ok(correctivePaths.every(path => changed.includes(path)), 'combined candidate requires the reviewed corrective paths')
    // The two reviewed candidates may be composed, but neither candidate's
    // source contract may be edited by the composition step. The successor
    // test itself is the only coordination file permitted to differ.
    assert.deepEqual(
      gitPaths('diff', '--name-only', productCandidate, 'HEAD').filter(path => path !== successorPath && !correctivePaths.includes(path)),
      [],
      'M1 reviewed product/content boundary changed',
    )
    assert.deepEqual(
      gitPaths('diff', '--name-only', correctiveCandidate, 'HEAD').filter(path => path !== successorPath && !productPaths.includes(path)),
      [],
      'baseline corrective content boundary changed',
    )
    assertBoundary(changed, new Set([...productPaths, ...correctivePaths, successorPath]))
  } else if (isM1) {
    assert.ok(unmergedCommits.includes(productCandidate), 'M1 requires the reviewed product candidate in unmerged ancestry')
    assert.deepEqual(gitPaths('rev-parse', 'origin/main'), [approvedBase], 'M1 requires its authorized baseline')
    // Check HEAD, index and worktree separately: restoring a working file must
    // not hide a staged product edit. Only the governance test may differ.
    for (const args of [
      ['diff', '--name-only', productCandidate, 'HEAD'],
      ['diff', '--cached', '--name-only', productCandidate],
      ['diff', '--name-only', productCandidate],
    ]) {
      assert.deepEqual(gitPaths(...args).filter(path => path !== successorPath), [], 'M1 reviewed product/content boundary changed')
    }
    assert.ok(productPaths.every(path => changed.includes(path)), 'M1 complete four-path product candidate required')
    assertBoundary(changed, new Set([...productPaths, successorPath]))
  } else if (isM3) {
    assert.deepEqual(gitPaths('rev-parse', 'origin/main'), [m3ApprovedBase], 'M3 requires the authorized trusted baseline')
    assert.ok(m3Paths.every(path => changed.includes(path)), 'M3 complete exact packaging package required')
    assertBoundary(changed, new Set([...m3Paths, m3SuccessorPath]))
  } else if (isM4) {
    assert.ok(m4Paths.every(path => changed.includes(path)), 'M4 complete exact product package required')
    const m4AuthorizationPath = 'docs/change-gates/exceptions/ES-PRINT-NETWORK-FIRST-01.json'
    const m4CorrectivePaths = new Set([
      'desktop/scripts/build-single-installer.mjs',
      'desktop/scripts/single-installer-contract.mjs',
      'desktop/scripts/verify-single-installer.mjs',
      'desktop/tests/single-installer-packaging.test.ts',
      m4SuccessorPath,
    ])
    assert.deepEqual(
      gitPaths('diff', '--name-only', m4Candidate, 'HEAD')
        .filter(path => path !== m4AuthorizationPath),
      [...m4CorrectivePaths].sort(),
      'M4 product candidate may only receive the approved dual-SHA packaging corrective',
    )
    assertBoundary(changed, new Set([...m4Paths, m4SuccessorPath, m4AuthorizationPath]))
  } else if (isUnifiedTerminal) {
    assert.deepEqual(
      gitPaths('rev-parse', 'origin/main'),
      ['a8c22a01da5b8cba5796decb1311f2ee174abcba'],
      'unified terminal candidate requires the current trusted baseline',
    )
    assert.ok(
      unifiedTerminalPaths.every(path => changed.includes(path)),
      'unified terminal candidate requires every reviewed implementation path',
    )
    assertBoundary(changed, new Set([...unifiedTerminalPaths, unifiedTerminalSuccessorPath]))
  } else if (isStoreName) {
    assert.deepEqual(gitPaths('rev-parse', 'origin/main'), [storeNameApprovedBase], 'Store.name candidate requires its trusted baseline')
    assert.ok(gitIsAncestor(storeNameApprovedBase, storeNameCandidate), 'Store.name candidate must descend from its trusted baseline')
    assert.ok(storeNamePaths.every(path => changed.includes(path)), 'Store.name candidate requires all four exact paths')
    assertBoundary(changed, new Set([...storeNamePaths, 'tests/cashier-realtime-integration.test.ts']))
  } else if (isFounderP0) {
    const [trustedMain] = gitPaths('rev-parse', 'origin/main')
    assert.ok(gitIsAncestor(founderP0Base, trustedMain), 'Founder P0 main must descend from approved base')
    const founderP0GovernanceMain = 'cdeb8acb573b9707b5ea041a5c69c390085af32b'
    const catalogueMain = '5211e38dd2d3c1636f76673ab3dd2816a9657b12'
    const catalogueRegistry = 'docs/change-gates/exceptions/ES-PRODUCT-COUNT-LIMIT-01.json'
    const catalogueRecord = 'docs/freezes/ES-PRODUCT-COUNT-LIMIT-01-FROZEN-SUCCESSOR.md'
    assert.ok(gitIsAncestor(catalogueMain, trustedMain), 'Founder P0 main must descend from the reviewed catalogue merge')
    assert.deepEqual(gitPaths('diff', '--no-renames', '--name-only', catalogueMain, trustedMain),
      [founderP0Registry], 'Founder P0 successor admission may change only its exact registry')
    assert.ok(gitIsAncestor(founderP0GovernanceMain, trustedMain), 'Founder P0 governance must precede catalogue')
    assert.deepEqual(gitPaths('diff', '--no-renames', '--name-only', founderP0Base, founderP0GovernanceMain),
      [founderP0Registry, founderP0Record].sort(), 'Founder P0 governance admission changed')
    const catalogueRegistryBytes = execFileSync('git', ['show', `origin/main:${catalogueRegistry}`], { cwd: root })
    assert.equal(createHash('sha256').update(catalogueRegistryBytes).digest('hex'),
      'a3be6061e888edac4f4569b1e5cac3f0b6e7f8d3fb7648c84f6a898b87d72fb4',
      'Catalogue ACTIVE registry changed')
    const catalogue = JSON.parse(catalogueRegistryBytes.toString('utf8'))
    assert.equal(catalogue.taskId, 'ES-PRODUCT-COUNT-LIMIT-01')
    assert.equal(catalogue.status, 'ACTIVE')
    assert.equal(catalogue.approvedBy, 'Founder')
    assert.equal(catalogue.featureBranch, 'codex/es-product-count-limit-01')
    assert.deepEqual(catalogue.additionalAuthorizations ?? [], [])
    const cataloguePaths = [...catalogue.authorizedPaths].sort()
    assert.deepEqual(cataloguePaths, [
      'app/api/cashier/store/route.ts',
      'app/api/products/route.ts',
      'app/cashier/page.tsx',
      'app/products/page.tsx',
      'app/sale/page.tsx',
      'lib/cashier-offline-db.ts',
      'tests/cashier-realtime-integration.test.ts',
      'tests/es-tray-device-print-contract.test.ts',
      'tests/product-sku-search.test.ts',
      'tests/v3-reprint-recovery.test.ts',
    ])
    assert.deepEqual(Object.keys(catalogue.authorizedPathSha256).sort(), cataloguePaths)
    assert.deepEqual(gitPaths('diff', '--no-renames', '--name-only', founderP0GovernanceMain, catalogueMain),
      [...cataloguePaths, catalogueRegistry, catalogueRecord].sort(),
      'Founder P0 main permits only the exact catalogue admission and product release')
    for (const path of cataloguePaths) {
      const content = execFileSync('git', ['show', `origin/main:${path}`], { cwd: root })
      assert.equal(createHash('sha256').update(content).digest('hex'), catalogue.authorizedPathSha256[path],
        `Catalogue main content changed: ${path}`)
    }
    const grant = JSON.parse(execFileSync('git', ['show', `origin/main:${founderP0Registry}`], { cwd: root, encoding: 'utf8' }))
    const originalGrant = JSON.parse(execFileSync('git',
      ['show', `${founderP0GovernanceMain}:${founderP0Registry}`], { cwd: root, encoding: 'utf8' }))
    const { additionalAuthorizations: originalAdditions, ...originalPrimary } = originalGrant
    const { additionalAuthorizations: currentAdditions, ...currentPrimary } = grant
    assert.deepEqual(originalAdditions, [], 'Founder P0 original grant contained no successor')
    assert.deepEqual(currentPrimary, originalPrimary, 'Founder P0 primary grant changed')
    assert.equal(grant.taskId, 'ES-DIAMOND-P0-FOUNDER-QUEUE-RECOVERY-01')
    assert.equal(grant.status, 'ACTIVE')
    assert.equal(grant.authorizationType, 'FOUNDER_APPROVED_TASK_SCOPED_EXCEPTION')
    assert.equal(grant.approvedBy, 'Founder')
    assert.equal(grant.trustedRef, 'origin/main')
    assert.equal(grant.lineageMode, 'PRE_COMMIT_CONTENT_SHA256')
    assert.equal(grant.baseOriginMainSha, founderP0Base)
    assert.equal(grant.featureBranch, 'codex/es-diamond-p0-founder-recovery')
    assert.equal(currentAdditions.length, 1, 'Founder P0 requires one exact catalogue successor')
    const successor = currentAdditions[0]
    assert.equal(successor.authorizationId, 'CATALOGUE-MAIN-SUCCESSOR')
    assert.equal(successor.featureBranch, 'codex/es-diamond-p0-founder-recovery-catalogue')
    assert.equal(successor.baseOriginMainSha, catalogueMain)
    assert.equal(successor.lineageMode, 'PRE_COMMIT_CONTENT_SHA256')
    assert.equal(successor.status, 'ACTIVE')
    assert.equal(successor.approvedBy, 'Founder')
    const founderAllowed = [founderP0Service, founderP0Test, 'tests/cashier-realtime-integration.test.ts']
    assert.deepEqual(grant.authorizedPaths, [...founderAllowed, founderP0Record].sort())
    assert.deepEqual(Object.keys(grant.authorizedPathSha256).sort(), [...founderAllowed, founderP0Record].sort())
    assert.equal(grant.authorizedPathSha256['tests/cashier-realtime-integration.test.ts'],
      '0e311651ec35967d6997381121404d54fce6757fb4086624facd8dab999f9d14',
      'Founder P0 original Cashier grant changed')
    assert.deepEqual(successor.authorizedPaths, [...founderAllowed, founderP0Record].sort())
    assert.deepEqual(Object.keys(successor.authorizedPathSha256).sort(), [...founderAllowed, founderP0Record].sort())
    for (const [path, digest] of founderP0Content) {
      assert.equal(grant.authorizedPathSha256[path], digest, `Founder P0 original grant changed: ${path}`)
      assert.equal(successor.authorizedPathSha256[path], digest, `Founder P0 successor source changed: ${path}`)
    }
    assertBoundary(diamondChanged, new Set(founderAllowed))
    assert.deepEqual([...diamondChanged].sort(), founderAllowed.sort(), 'Founder P0 requires exactly three changed paths')
    const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
    for (const path of [...founderAllowed, founderP0Record]) {
      const digest = successor.authorizedPathSha256[path]
      assert.match(digest, /^[0-9a-f]{64}$/)
      assert.equal(sha256(readFileSync(resolve(root, path))), digest, `Founder P0 worktree content changed: ${path}`)
      if (diamondStaged.includes(path)) {
        assert.equal(sha256(execFileSync('git', ['show', `:${path}`], { cwd: root })), digest,
          `Founder P0 staged content changed: ${path}`)
      }
      if (diamondCommitted.includes(path)) {
        assert.equal(sha256(execFileSync('git', ['show', `HEAD:${path}`], { cwd: root })), digest,
          `Founder P0 committed content changed: ${path}`)
      }
    }
  } else if (isDiamond) {
    const diamondRegistration = 'docs/change-gates/exceptions/ES-DIAMOND-CASHIER-EXACT-BOUNDARY-01.json'
    const [diamondTrustedMain] = gitPaths('rev-parse', 'origin/main')
    assert.ok(gitIsAncestor(diamondBase, diamondTrustedMain), 'Diamond trusted main must descend from the exact Stage 1 base')
    const h5Registration = 'docs/change-gates/exceptions/ES-DIAMOND-H5-MISSING-SEAL-SUCCESSOR-01.json'
    const approvedBaseline = {
      'lib/customer-order-fulfillment.ts': '7611a003ebbfba7a1dabf18fcd7c1b93ee025885ae645d91e6ae24409d1039e0',
      'tests/customer-order-fulfillment-db.test.ts': 'ab141992742743228a9dd501eec9b28c3f5b10e8795d4d6cf0ac3c0389ec7f36',
      'tests/es-tray-device-print-runtime.test.ts': '343ca290d2dbbe8706fac62d5c0476a7263abf69941996323ed9e52b6701d053',
    }
    assert.deepEqual(
      gitPaths('diff', '--no-renames', '--name-only', diamondBase, diamondTrustedMain),
      [diamondRegistration, h5Registration, ...Object.keys(approvedBaseline)].sort(),
      'Diamond trusted main may differ only by exact registrations and approved baseline fixes',
    )
    const trustedBlob = (path: string) => execFileSync('git', ['show', `origin/main:${path}`], { cwd: root })
    for (const [path, digest] of Object.entries(approvedBaseline)) {
      assert.equal(createHash('sha256').update(trustedBlob(path)).digest('hex'), digest, `Diamond baseline content changed: ${path}`)
    }
    const h5Grant = JSON.parse(trustedBlob(h5Registration).toString('utf8'))
    assert.equal(h5Grant.taskId, 'ES-DIAMOND-H5-MISSING-SEAL-SUCCESSOR-01')
    assert.equal(h5Grant.status, 'CLOSED')
    assert.equal(h5Grant.approvedBy, 'Founder')
    assert.equal(h5Grant.authorizationType, 'FOUNDER_APPROVED_TASK_SCOPED_EXCEPTION')
    assert.equal(h5Grant.trustedRef, 'origin/main')
    assert.equal(h5Grant.lineageMode, 'PRE_COMMIT_CONTENT_SHA256')
    assert.equal(h5Grant.baseOriginMainSha, 'fc351529da576793eec2e2618c6f32867f62703f')
    assert.equal(h5Grant.featureBranch, 'codex/es-diamond-h5-fail-closed-successor')
    assert.deepEqual(h5Grant.additionalAuthorizations ?? [], [])
    assert.deepEqual(h5Grant.authorizedPaths, ['lib/customer-order-fulfillment.ts', 'tests/customer-order-fulfillment-db.test.ts'])
    assert.deepEqual(h5Grant.authorizedPathSha256, {
      'lib/customer-order-fulfillment.ts': '7611a003ebbfba7a1dabf18fcd7c1b93ee025885ae645d91e6ae24409d1039e0',
      'tests/customer-order-fulfillment-db.test.ts': 'ab141992742743228a9dd501eec9b28c3f5b10e8795d4d6cf0ac3c0389ec7f36',
    })
    assert.match(h5Grant.featureMergeCommitSha, /^[0-9a-f]{40}$/)
    assert.ok(gitIsAncestor(h5Grant.featureMergeCommitSha, diamondTrustedMain), 'H5 closure must name a merged commit')
    assert.ok(gitIsAncestor(diamondTrustedMain, 'HEAD'), 'Diamond HEAD must descend from the registered trusted main')
    const registration = JSON.parse(execFileSync('git', ['show', `origin/main:${diamondRegistration}`], { cwd: root, encoding: 'utf8' }))
    assert.equal(registration.taskId, 'ES-DIAMOND-CASHIER-EXACT-BOUNDARY-01')
    assert.equal(registration.status, 'ACTIVE')
    assert.equal(registration.authorizationType, 'FOUNDER_APPROVED_TASK_SCOPED_EXCEPTION')
    assert.equal(registration.approvedBy, 'Founder')
    assert.equal(registration.trustedRef, 'origin/main')
    assert.equal(registration.lineageMode, 'PRE_COMMIT_CONTENT_SHA256')
    assert.equal(registration.baseOriginMainSha, diamondBase)
    assert.equal(registration.featureBranch, 'codex/es-diamond-v3-print-frozen-successor-01')
    assert.deepEqual(registration.authorizedPaths, [diamondPath])
    assert.deepEqual(registration.additionalAuthorizations ?? [], [])
    assert.deepEqual(Object.keys(registration.authorizedPathSha256), [diamondPath])
    const cashierDigest: string = registration.authorizedPathSha256[diamondPath]
    assert.match(cashierDigest, /^[0-9a-f]{64}$/, 'Diamond registration must pin the exact Cashier bytes')
    const diamondAllowed = new Set([...diamondContent.keys(), diamondPath])
    assertBoundary(diamondChanged, diamondAllowed)
    assert.deepEqual([...diamondChanged].sort(), [...diamondAllowed].sort(), 'Diamond requires all nine exact paths')
    const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
    for (const [path, digest] of [...diamondContent, [diamondPath, cashierDigest]]) {
      assert.equal(sha256(readFileSync(resolve(root, path))), digest, `Diamond worktree content changed: ${path}`)
      if (diamondStaged.includes(path)) {
        const staged = execFileSync('git', ['show', `:${path}`], { cwd: root })
        assert.equal(sha256(staged), digest, `Diamond staged content changed: ${path}`)
      }
      if (diamondCommitted.includes(path)) {
        const committed = execFileSync('git', ['show', `HEAD:${path}`], { cwd: root })
        assert.equal(sha256(committed), digest, `Diamond committed content changed: ${path}`)
      }
    }
  } else if (currentBranch === 'codex/cashier-sales-tx-timeout-01' && diamondChanged.length > 0) {
    // This successor only admits the exact checkout package under the trusted active grant.
    const taskId = 'TASK-CASHIER-SALES-TX-TIMEOUT-01'
    const paths = ['app/api/cashier/sales/route.ts', 'lib/record-no.ts', 'tests/cashier-realtime-integration.test.ts']
    const exceptionPath = `docs/change-gates/exceptions/${taskId}.json`
    const exception = JSON.parse(gitPaths('show', `origin/main:${exceptionPath}`).join('\n'))
    assert.ok(gitIsAncestor('origin/main', 'HEAD'), 'Cashier timeout candidate must descend from trusted main')
    assert.deepEqual([...exception.authorizedPaths].sort(), paths, 'Cashier timeout grant must name only this package')
    assert.deepEqual([...diamondChanged].sort(), paths, 'Cashier timeout candidate must contain exactly the sealed paths')
    assertBoundary(diamondChanged, new Set(paths))
    execFileSync(process.execPath, [
      'scripts/guards/check-change-scope.js', '--task-id', taskId, '--files', paths.join(','),
    ], { cwd: root, stdio: 'inherit' })
    const staged = gitPaths('diff', '--cached', '--no-renames', '--name-only', 'HEAD')
    for (const [ref, files] of [['', staged], ['HEAD', diamondCommitted]] as const) {
      for (const path of files) {
        const bytes = execFileSync('git', ['show', `${ref}:${path}`], { cwd: root })
        assert.equal(createHash('sha256').update(bytes).digest('hex'), exception.authorizedPathSha256[path],
          `Cashier timeout ${ref || 'index'} SHA-256 mismatch: ${path}`)
      }
    }
  } else {
    // ES-CASHIER-COST-01 exclusions and the existing H5/Dine-in approved set
    // retain their prior semantics. Closed historical grants are not reopened.
    const usb = readUsbFrontSuccessor(root)
    const unified = usb ? null : readUnifiedPrintSuccessor(root)
    const exactPaths = unified?.corePaths(changed, changed.filter(path => !approved.has(path)))
    assertBoundary(changed, usb?.productPaths ?? exactPaths ?? approved)
  }

  console.log('cashier realtime Stage 1F integration and regression checks passed')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
