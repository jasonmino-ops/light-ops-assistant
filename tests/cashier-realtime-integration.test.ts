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
  assert.deepEqual(changed.filter(path => !approved.has(path)), [])
  assert.equal(changed.includes('app/api/cashier/orders/route.ts'), false)
  assert.equal(changed.includes('app/api/cashier/pending-orders/route.ts'), false)
  assert.equal(changed.some(path => path === 'app/sale/page.tsx' || path.includes('customer-display') || path.includes('pos/session/update')), false)
  assert.equal(changed.some(path => (path.startsWith('prisma/') || path.includes('migration') || path.includes('print')) && !approved.has(path)), false)

  console.log('cashier realtime Stage 1F integration and regression checks passed')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
