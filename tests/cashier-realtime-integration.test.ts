import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createCashierRealtimeWakeCoalescer } from '../lib/cashier-realtime-client'
import { notifyCashierGateway } from '../lib/cashier-realtime-notify'

const root = process.cwd()
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
  const m4Candidate = 'ce59da981e3a7acadaf986da230b320b9bb99225'
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
  const gitPaths = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean)
  const unmergedCommits = gitPaths('rev-list', 'origin/main..HEAD')
  const isM2 = gitPaths('rev-parse', 'origin/main')[0] === m2ApprovedBase
    && changed.some(path => m2Paths.includes(path))
  const isM3 = gitPaths('rev-parse', 'origin/main')[0] === m3ApprovedBase
    && unmergedCommits.includes(m3Candidate)
    && changed.some(path => m3Paths.includes(path))
  const isM4 = gitPaths('rev-parse', 'origin/main')[0] === m4ApprovedBase
    && unmergedCommits.includes(m4Candidate)
    && changed.some(path => m4Paths.includes(path))
  // Once merged, the candidate is no longer an unmerged task grant. Later M1
  // path edits still enter this branch and fail without that exact grant.
  const isM1 = !isM4 && (unmergedCommits.includes(productCandidate) || changed.some(path => productPaths.includes(path)))
  const isCombinedCorrective = isM1 && unmergedCommits.includes(correctiveCandidate)
  if (isM2) {
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
    assert.deepEqual(gitPaths('rev-parse', 'origin/main'), [m4ApprovedBase], 'M4 requires the authorized trusted baseline')
    assert.ok(m4Paths.every(path => changed.includes(path)), 'M4 complete exact product package required')
    assert.deepEqual(
      gitPaths('diff', '--name-only', m4Candidate, 'HEAD').filter(path => path !== m4SuccessorPath),
      [],
      'M4 reviewed product/content boundary changed',
    )
    assertBoundary(changed, new Set([...m4Paths, m4SuccessorPath]))
  } else {
    // ES-CASHIER-COST-01 exclusions and the existing H5/Dine-in approved set
    // retain their prior semantics. Closed historical grants are not reopened.
    assertBoundary(changed, approved)
  }

  console.log('cashier realtime Stage 1F integration and regression checks passed')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
