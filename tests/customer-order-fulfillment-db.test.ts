import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, unlink, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import pg from 'pg'
import test from 'node:test'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import {
  cancelCustomerOrderKitchenIntent,
  customerOrderPrintReceipt,
  intentCreateData,
  processCustomerOrderFulfillmentIntent,
  recordCustomerOrderIntent,
  runCustomerOrderFulfillmentRecovery,
  type CustomerOrderPrintOrder,
} from '../lib/customer-order-fulfillment'
import { deliverV3PrintIntent, enqueueV3PrintIntent, parseV3PrintIntent, reportV3Execution } from '../lib/v3-print-job-adapter'
import { enqueueV3ManualReprintWithDb, V3ReprintError } from '../lib/v3-print-reprint'
import { customerOrderEnvelopeFromSeal } from '../lib/customer-order-fulfillment-renderer'
import { encodeRgbaToEscPosEscStar24 } from '../lib/qzEscPosBitImage'
import { claimCustomerOrderRender, sealCustomerOrderRender, failCustomerOrderRender, type RenderWorker } from '../lib/customer-order-render-dispatch'

// No DATABASE_URL fallback, database creation, reset, or server startup. The
// operator supplies dedicated disposable loopback databases explicitly.
const databaseUrl = process.env.ES_H5_ORDER_FULFILLMENT_TEST_DATABASE_URL ?? ''
function disposableUrlError(raw: string): string | null {
  try {
    const url = new URL(raw)
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) return 'PostgreSQL URL required'
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return 'loopback only'
    if (!/^(es_)?h5_test_[a-z0-9_]+$/i.test(url.pathname.slice(1))) return 'database must be named h5_test_* or es_h5_test_*'
    if ([...url.searchParams.keys()].some((key) => !['sslmode', 'application_name'].includes(key))) return 'connection override parameters are forbidden'
    return null
  } catch { return 'explicit disposable PostgreSQL URL required' }
}
const skipReason = process.env.ES_H5_ORDER_FULFILLMENT_TEST_DATABASE !== '1'
  ? 'NOT RUN: set ES_H5_ORDER_FULFILLMENT_TEST_DATABASE=1 and the explicit disposable test URL'
  : process.env.ES_H5_ORDER_FULFILLMENT_DISPOSABLE !== '1'
    ? 'NOT RUN: ES_H5_ORDER_FULFILLMENT_DISPOSABLE=1 acknowledgment required'
    : disposableUrlError(databaseUrl) || false

// Exercise the real public route on independent real PostgreSQL connections.
// This router changes connection selection only; no query, response or business
// transition is simulated. Existing worker hooks observe exact transaction stages.
async function publicRouteHarness(defaultWorker: Worker) {
  ;(globalThis as any).AsyncLocalStorage = AsyncLocalStorage
  const { prisma } = await import('../lib/prisma')
  const { NextRequest } = await import('next/server')
  const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external')
  const { POST } = await import('../app/api/public/orders/route')
  const connection = new AsyncLocalStorage<Worker>(), undo: Array<() => void> = [], callbacks: Array<() => unknown> = []
  const db = prisma as any
  for (const [model, methods] of Object.entries({ store: ['findUnique'], customerOrder: ['findUnique'], user: ['findFirst'], campaignLink: ['findUnique'] })) {
    for (const method of methods) {
      const old = db[model][method]
      db[model][method] = (...args: any[]) => ((connection.getStore() ?? defaultWorker).client as any)[model][method](...args)
      undo.push(() => { db[model][method] = old })
    }
  }
  const oldTransaction = db.$transaction
  db.$transaction = (...args: any[]) => ((connection.getStore() ?? defaultWorker).db as any).$transaction(...args)
  undo.push(() => { db.$transaction = oldTransaction })
  return {
    callbacks,
    async submit(worker: Worker, body: any, key: string) {
      return connection.run(worker, () => workAsyncStorage.run({ afterContext: { after: (fn: () => unknown) => callbacks.push(fn) } } as any, async () => {
        const res = await POST(new NextRequest('https://isolated.test/api/public/orders', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body) }))
        return { status: res.status, body: await res.json() }
      }))
    },
    close() { undo.reverse().forEach(f => f()) },
  }
}

async function submissionProduct(client: PrismaClient, f: Fixture) {
  const product = await client.product.create({ data: { tenantId: f.tenantId, barcode: `SUB-${f.orderId}`, name: 'Synthetic submission item', sellPrice: 5, printKitchenTicket: true } })
  const store = await client.store.findUniqueOrThrow({ where: { id: f.storeId } })
  return { storeCode: store.code, items: [{ productId: product.id, quantity: 1 }], lang: 'en' }
}

test('DB public route: two lock-proven overlapping submissions plus eighteen retries create one order; new keys allow add-ons and >9999', { skip: skipReason, timeout: 120_000 }, async () => {
  await withFixture(async ({ fixture: f, admin, observer, worker, barrier, track }) => {
    const body = await submissionProduct(admin.client, f), route = await publicRouteHarness(admin)
    const first = await worker('submit-first'), second = await worker('submit-second'), held = barrier('submission holds namespace')
    const key = randomUUID()
    first.setHook(async e => { if (e.phase === 'after' && e.model === '$raw' && rawSql(e).includes('pg_advisory_xact_lock')) await held.pause() })
    try {
      const a = track(route.submit(first, body, key)); await held.entered()
      const b = track(route.submit(second, body, key))
      await waitForBlockedBy(observer, second, first, /pg_advisory_xact_lock/, e => e.model === '$raw' && rawSql(e).includes('pg_advisory_xact_lock'))
      held.release(); const replies = await Promise.all([a, b]); first.setHook(async () => {})
      const more = await Promise.all(Array.from({ length: 18 }, () => route.submit(second, body, key)))
      for (const r of [...replies, ...more]) { assert.equal(r.status, 200); assert.deepEqual(r.body, replies[0].body) }
      assert.equal(await admin.client.customerOrder.count({ where: { tenantId: f.tenantId, submissionKey: key } }), 1)
      assert.equal(route.callbacks.length, 1)
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, ''), prefix = `C-${date}-${body.storeCode.toUpperCase().slice(0, 6)}-`
      await admin.client.customerOrder.create({ data: { tenantId: f.tenantId, storeId: f.storeId, storeCode: body.storeCode, orderNo: prefix + '9999', itemsJson: '[]', totalAmount: 0 } })
      const newOrders = await Promise.all([route.submit(first, body, randomUUID()), route.submit(second, body, randomUUID())])
      assert.ok(newOrders.every(r => r.status === 200)); assert.deepEqual(newOrders.map(r => r.body.orderNo).sort(), [prefix + '10000', prefix + '10001'])
      assert.equal(await admin.client.saleRecord.count({ where: { tenantId: f.tenantId } }), 0)
      assert.equal(await admin.client.paymentIntent.count({ where: { tenantId: f.tenantId } }), 0)
      assert.equal(await admin.client.customerOrderFulfillmentIntent.count({ where: { tenantId: f.tenantId } }), 0)
    } finally { held.release(); route.close() }
  })
})

test('DB public route: SQL failure after coupon update rolls back order/receipt/redemption; original-key retry commits once', { skip: skipReason, timeout: 60_000 }, async () => {
  await withFixture(async ({ fixture: f, admin, worker }) => {
    const body = await submissionProduct(admin.client, f), w = await worker('coupon-rollback'), route = await publicRouteHarness(admin)
    const template = await admin.client.couponTemplate.create({ data: { tenantId: f.tenantId, storeId: f.storeId, name: 'Synthetic', amountOff: 1 } })
    const coupon = await admin.client.customerCoupon.create({ data: { tenantId: f.tenantId, storeId: f.storeId, templateId: template.id, telegramId: 'synthetic-customer', name: 'Synthetic', type: 'AMOUNT_OFF', amountOff: 1, expiresAt: new Date(Date.now() + 3600_000) } })
    const key = randomUUID(), payload = { ...body, customerTelegramId: coupon.telegramId, couponId: coupon.id }
    w.setHook(async (e, tx) => { if (e.model === 'customerCoupon' && e.method === 'updateMany' && e.phase === 'after') await tx.$queryRaw`SELECT 1 / 0` })
    try {
      const failed = await route.submit(w, payload, key); assert.equal(failed.status, 500)
      assert.equal(w.transactionErrors.length, 1); assert.equal(w.transactionErrors[0].code, 'P2010')
      assert.equal(await admin.client.customerOrder.count({ where: { tenantId: f.tenantId, submissionKey: key } }), 0)
      assert.equal((await admin.client.customerCoupon.findUniqueOrThrow({ where: { id: coupon.id } })).status, 'AVAILABLE')
      assert.equal(await admin.client.couponRedemption.count({ where: { couponId: coupon.id } }), 0); assert.equal(route.callbacks.length, 0)
      w.setHook(async () => {}); const accepted = await route.submit(w, payload, key); assert.equal(accepted.status, 200)
      assert.deepEqual(await route.submit(w, payload, key), accepted); assert.equal(accepted.body.totalAmount, 4)
      assert.equal(await admin.client.couponRedemption.count({ where: { couponId: coupon.id } }), 1); assert.equal(route.callbacks.length, 1)
      const conflict = await route.submit(w, { ...payload, tableNo: 'changed' }, key); assert.equal(conflict.status, 409)
      assert.equal(await admin.client.customerOrder.count({ where: { tenantId: f.tenantId, submissionKey: key } }), 1)
    } finally { route.close() }
  })
})

test('DB public route: actual P2002 rolls back then replays verified winner; mismatched winner is rejected', { skip: skipReason, timeout: 90_000 }, async (t) => {
  await withFixture(async ({ fixture: f, admin, worker, barrier, track }) => {
    const body = await submissionProduct(admin.client, f), route = await publicRouteHarness(admin)
    const create = await worker('key-contender'), other = await worker('independent-key-insert')
    try {
      for (const mismatch of [false, true]) {
        const key = randomUUID(), entered = barrier(`before-real-key-insert-${mismatch}`); let data: any
        create.setHook(async e => { if (e.model === 'customerOrder' && e.method === 'create' && e.phase === 'before') { data = e.args[0].data; await entered.pause() } })
        const pending = track(route.submit(create, body, key)); await entered.entered()
        const winnerOrderNo = `SYNTH-WINNER-${randomUUID()}`
        // Independent old/other writer bypasses the number lock, forcing the DB
        // unique-key branch rather than a serialized pre-insert idempotent read.
        const winner = await other.client.customerOrder.create({ data: { ...data, orderNo: winnerOrderNo,
          submissionHash: mismatch ? 'f'.repeat(64) : data.submissionHash,
          submissionResponse: { ...data.submissionResponse, orderNo: winnerOrderNo } } })
        entered.release(); const r = await pending
        assert.equal(create.transactionErrors.at(-1).code, 'P2002')
        t.diagnostic(`Synthetic unique conflict structured metadata: ${JSON.stringify(create.transactionErrors.at(-1).meta)}`)
        assert.equal(r.status, mismatch ? 409 : 200)
        if (mismatch) assert.equal(r.body.error, 'IDEMPOTENCY_KEY_CONFLICT'); else assert.deepEqual(r.body, winner.submissionResponse)
        assert.equal(await admin.client.customerOrder.count({ where: { tenantId: f.tenantId, submissionKey: key } }), 1)
        assert.equal(await admin.client.customerOrder.count({ where: { tenantId: f.tenantId, orderNo: data.orderNo } }), 0)
        assert.equal(route.callbacks.length, 0)
      }
    } finally { route.close() }
  })
})

const WAIT_MS = 8_000
const TX_MS = 30_000
const CANCEL_CODE = 'CUSTOMER_ORDER_CANCELLED_BEFORE_CLAIM'
const testProfileId = createHash('sha256').update('isolated-renderer-fixture-v1').digest('hex')
const runtime = { testProfileId }
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
const raster = Buffer.from(encodeRgbaToEscPosEscStar24({ width: 576, height: 24, rgba: new Uint8ClampedArray(576 * 24 * 4).fill(255) }))
const sealedBytes = { payloadBase64: raster.toString('base64'), payloadHash: sha(raster), byteLength: raster.length, rendererVersion: testProfileId }
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))

async function bounded<T>(promise: Promise<T>, label: string, ms = WAIT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), ms)
    })])
  } finally { clearTimeout(timer) }
}

function gate(label: string) {
  let markEntered!: () => void
  let release!: () => void
  const entered = new Promise<void>((done) => { markEntered = done })
  const released = new Promise<void>((done) => { release = done })
  let used = false
  return {
    release,
    entered: () => bounded(entered, `${label}: entered`),
    pause: async () => {
      assert.equal(used, false, `${label}: barrier must enter exactly once`)
      used = true
      markEntered()
      await bounded(released, `${label}: released`, TX_MS - 2_000)
    },
  }
}

type Event = { tx: number; model: string; method: string; args: any[]; result?: any; phase: 'before' | 'after' }
type Hook = (event: Event, transaction: any) => Promise<void>
type Worker = Awaited<ReturnType<typeof openWorker>>

// Each worker has its own single-connection pool, with no idle eviction. The
// observer and barrier have separate pools: a blocked business transaction
// cannot starve observation or a releasing transaction of a connection.
async function openWorker(label: string) {
  const applicationName = `h5db-${randomUUID().slice(0, 8)}-${label}`
  const url = new URL(databaseUrl)
  url.searchParams.set('application_name', applicationName)
  const pool = new pg.Pool({ connectionString: url.toString(), max: 1, idleTimeoutMillis: 0,
    connectionTimeoutMillis: 3_000, statement_timeout: 20_000, idle_in_transaction_session_timeout: 35_000 })
  const client = new PrismaClient({ adapter: new PrismaPg(pool), transactionOptions: { maxWait: 5_000, timeout: TX_MS } })
  try {
    const { rows } = await pool.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
    const pid = rows[0].pid
    let sequence = 0
    const events: Event[] = []
    const transactionErrors: any[] = []
    let hook: Hook = async () => {}
    const observedDb = new Proxy(client, {
      get(target, property) {
        if (property !== '$transaction') {
          const value = Reflect.get(target, property)
          return typeof value === 'function' ? value.bind(target) : value
        }
        return async (callback: (tx: any) => Promise<unknown>, options?: any) => {
          const txNumber = ++sequence
          try {
            // Check connection identity outside the transaction, so tracing
            // cannot establish an earlier Serializable business snapshot.
            const connected = await pool.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
            assert.equal(connected.rows[0].pid, pid, 'worker must retain its identified connection')
            return await client.$transaction(async (tx) => {
              const invoke = async (model: string, method: string, owner: any, args: any[]) => {
                const before: Event = { tx: txNumber, model, method, args, phase: 'before' }
                events.push(before)
                await hook(before, tx)
                const result = await owner[method](...args)
                const after: Event = { ...before, phase: 'after', result }
                events.push(after)
                await hook(after, tx)
                return result
              }
              const traced = new Proxy(tx, {
                get(targetTx: any, key: string | symbol) {
                  if (typeof key !== 'string') return Reflect.get(targetTx, key)
                  if (key === '$queryRaw' || key === '$executeRaw') return (...args: any[]) => invoke('$raw', key, targetTx, args)
                  const value = targetTx[key]
                  if (key.startsWith('$') || !value || typeof value !== 'object') return typeof value === 'function' ? value.bind(targetTx) : value
                  return new Proxy(value, { get(delegate, method: string) {
                    return typeof delegate[method] === 'function'
                      ? (...args: any[]) => invoke(key, method, delegate, args) : delegate[method]
                  } })
                },
              })
              return callback(traced)
            }, options)
          } catch (error) { transactionErrors.push(error); throw error }
        }
      },
    })
    return { client, pool, db: observedDb, pid, applicationName, events, transactionErrors,
      setHook(next: Hook) { hook = next },
      close: async () => { await client.$disconnect(); await pool.end() } }
  } catch (error) { await client.$disconnect(); await pool.end(); throw error }
}

function rawSql(event: Event): string {
  return Array.isArray(event.args[0]) ? event.args[0].join('?') : String(event.args[0]?.sql ?? '')
}
function tableStatement(table: string, verb: 'UPDATE' | 'INSERT INTO' | 'FROM'): RegExp {
  return new RegExp(`\\b${verb}\\s+(?:"[^"]+"\\.)?"${table}"(?=\\s|\\()`, 'i')
}
type WaitRow = { pid: number; application_name: string; state: string; wait_event_type: string | null; blockers: number[]; query: string }
function matchesWait(row: WaitRow, worker: Pick<Worker, 'pid' | 'applicationName'>, blockerPid: number, statement: RegExp) {
  return row.pid === worker.pid && row.application_name === worker.applicationName
    && row.state === 'active' && row.wait_event_type === 'Lock'
    && row.blockers.includes(blockerPid) && statement.test(row.query)
}

async function waitForBlockedBy(observer: Worker, waiter: Worker, blocker: Worker, statement: RegExp, targetOperation: (event: Event) => boolean) {
  const deadline = Date.now() + WAIT_MS
  let last: WaitRow | undefined
  while (Date.now() < deadline) {
    const { rows } = await observer.pool.query<WaitRow>(`
      SELECT pid, application_name, state, wait_event_type, query, pg_blocking_pids(pid) AS blockers
      FROM pg_stat_activity WHERE pid = $1 AND application_name = $2`, [waiter.pid, waiter.applicationName])
    last = rows[0]
    if (last && matchesWait(last, waiter, blocker.pid, statement)) {
      const before = waiter.events.filter((event) => event.phase === 'before').at(-1)
      assert.ok(before && targetOperation(before), 'waiting statement must belong to the exact target operation/fixture')
      return before
    }
    await sleep(20)
  }
  throw new Error(`waiter ${waiter.pid}/${waiter.applicationName} not blocked by ${blocker.pid}; last=${JSON.stringify(last)}`)
}

test('lock observer matches exact worker/blocker and table, including transactionid waits without relation', () => {
  const worker = { pid: 11, applicationName: 'fixture-create' }
  const row: WaitRow = { pid: 11, application_name: 'fixture-create', state: 'active', wait_event_type: 'Lock', blockers: [22], query: 'UPDATE "public"."CustomerOrder" SET "status"=$1' }
  const orderUpdate = tableStatement('CustomerOrder', 'UPDATE')
  assert.equal(matchesWait(row, worker, 22, orderUpdate), true)
  assert.equal(matchesWait(row, worker, 33, orderUpdate), false)
  assert.equal(matchesWait({ ...row, pid: 12 }, worker, 22, orderUpdate), false)
  assert.equal(matchesWait({ ...row, application_name: 'other' }, worker, 22, orderUpdate), false)
  assert.equal(matchesWait({ ...row, wait_event_type: 'IO' }, worker, 22, orderUpdate), false)
  assert.equal(matchesWait({ ...row, query: 'UPDATE "public"."CustomerOrderFulfillmentIntent" SET "state"=$1' }, worker, 22, orderUpdate), false)
})

async function createFixture(client: PrismaClient, suffix: string) {
  const tenantId = `h5-tenant-${suffix}`, storeId = `h5-store-${suffix}`, orderId = `h5-order-${suffix}`
  const orderNo = `H5-${suffix}`, deviceId = `h5-device-${suffix}`, controlPlaneId = `h5-control-${suffix}`, batchId = `h5-batch-${suffix}`
  const now = new Date(), deadline = new Date(now.getTime() + 30 * 60_000)
  const order: CustomerOrderPrintOrder = {
    tenantId, storeId, orderNo, storeName: 'DB Test Store', currencyCode: 'USD', createdAt: now,
    paidAt: null, tableNo: 'A1', remark: null, totalAmount: 4.5, paymentStatus: 'UNPAID', paymentMethod: null,
    items: [{ productId: 'p1', name: 'Kitchen item', spec: null, originalPrice: 4.5, price: 4.5, quantity: 1, lineAmount: 4.5, printKitchenTicket: true }],
  }
  await client.tenant.create({ data: { id: tenantId, name: `H5 DB ${suffix}` } })
  await client.store.create({ data: { id: storeId, tenantId, code: `H5DB${suffix}`, name: order.storeName, businessType: 'FOOD', printKitchenTicket: true } })
  await client.customerOrder.create({ data: { id: orderId, tenantId, storeId, storeCode: `H5DB${suffix}`, orderNo,
    itemsJson: JSON.stringify(order.items), totalAmount: '4.50', status: 'CONFIRMED', paymentStatus: 'UNPAID', createdAt: now } })
  await client.desktopDevice.create({ data: { id: deviceId, tenantId, storeId, installationIdHash: `install-${suffix}`, tokenHash: `token-${suffix}`, tokenIssuedAt: now, tokenExpiresAt: deadline } })
  await client.v3PrintControlPlane.create({ data: { id: controlPlaneId, tenantId, storeId, ownerDeviceId: deviceId,
    ownerEpoch: 1, leaseId: `lease-${suffix}`, leaseExpiresAt: deadline, mode: 'V3_ACTIVE', stateVersion: 1 } })
  await client.v3PrintExecutionBatch.create({ data: { id: batchId, controlPlaneId, tenantId, storeId, ownerDeviceId: deviceId,
    ownerEpoch: 1, stateVersion: 1, leaseId: `lease-${suffix}`, mode: 'V3_ACTIVE', expiresAt: deadline } })
  const operator = await client.user.create({ data: { id: `user-${suffix}`, tenantId, username: `user-${suffix}`, displayName: 'DB test', role: 'OWNER' } })
  return { tenantId, storeId, orderId, orderNo, deviceId, controlPlaneId, batchId, now, deadline, order, operator }
}
type Fixture = Awaited<ReturnType<typeof createFixture>>

for (const method of ['CASH', 'QR'] as const) for (const schedule of ['sequential retry', 'stale order read before competing collection commits', 'missing payment read before competing collection commits'] as const) {
  test(`DB Desktop H5 three tickets: ${method}, ${schedule}, FRONT unpaid + KITCHEN then FRONT paid, no SaleRecord`, { skip: skipReason, timeout: 90_000 }, async () => withFixture(async h => {
    const { fixture: f, admin } = h
    const submission = await publicRouteHarness(admin)
    const submitted = await submission.submit(admin, await submissionProduct(admin.client, f), randomUUID())
    submission.close()
    assert.equal(submitted.status, 200)
    const order = await admin.client.customerOrder.findUniqueOrThrow({ where: { orderNo: submitted.body.orderNo } })
    assert.equal(order.status, 'PENDING'); assert.equal(order.paymentStatus, 'UNPAID')
    assert.equal(await admin.client.customerOrderFulfillmentIntent.count({ where: { tenantId: f.tenantId } }), 0)
    assert.equal(await admin.client.eshopTrayPrintJob.count({ where: { tenantId: f.tenantId } }), 0)
    const { prisma } = await import('../lib/prisma')
    const { signSession } = await import('../lib/session')
    const { NextRequest } = await import('next/server')
    const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external')
    const { PATCH } = await import('../app/api/customer-orders/[id]/route')
    const { POST: confirmPayment } = await import('../app/api/payments/[paymentId]/confirm/route')
    const { POST: cancelPayment } = await import('../app/api/payments/[paymentId]/cancel/route')
    const active = new AsyncLocalStorage<Worker>(), undo: Array<() => void> = [], callbacks: unknown[] = []
    const db = prisma as any, disabled = process.env.ESHOP_DISABLE_DEV_HEADERS
    process.env.ESHOP_DISABLE_DEV_HEADERS = '1'
    for (const model of ['tenant', 'user', 'store', 'customerOrder', 'paymentIntent', 'customerOrderFulfillmentIntent', 'eshopTrayPrintJob']) {
      for (const op of ['findUnique', 'findFirst', 'findMany']) {
        const old = db[model][op]
        db[model][op] = (...args: any[]) => ((active.getStore() ?? admin).client as any)[model][op](...args)
        undo.push(() => { db[model][op] = old })
      }
    }
    const oldTransaction = db.$transaction
    db.$transaction = (...args: any[]) => ((active.getStore() ?? admin).db as any).$transaction(...args)
    undo.push(() => { db.$transaction = oldTransaction })
    const identity = { tenantId: f.tenantId, userId: f.operator.id, storeId: f.storeId, role: 'OWNER' as const }
    const token = signSession(identity)
    async function patch(worker: Worker, body: object, cookie = token) {
      return active.run(worker, () => workAsyncStorage.run({ afterContext: { after: (fn: unknown) => callbacks.push(fn) } } as any,
        () => PATCH(new NextRequest(`https://isolated.test/api/customer-orders/${order.id}`, {
          method: 'PATCH', headers: { cookie: `auth-session=${cookie}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
        }), { params: Promise.resolve({ id: order.id }) })))
    }
    const scoped = { tenantId: f.tenantId, storeId: f.storeId, orderNo: order.orderNo }
    const worker: RenderWorker = { ...renderOwner(f), roles: ['KITCHEN', 'FRONT'] }
    async function sealAndQueue(purpose: 'KITCHEN_MAKE' | 'FRONT_UNPAID' | 'FRONT_PAID') {
      const role = purpose === 'KITCHEN_MAKE' ? 'KITCHEN' : 'FRONT'
      const claim = await claimCustomerOrderRender(admin.client as any, { ...worker, roles: [role] }, runtime)
      assert.equal(claim.kind, 'CLAIMED'); assert.equal(claim.claim.orderNo, order.orderNo); assert.equal(claim.claim.role, role)
      assert.equal((await sealCustomerOrderRender(admin.client as any, worker, { ...claim.claim, ...sealedBytes }, runtime)).kind, 'SEALED')
      const replies = await Promise.all([processCustomerOrderFulfillmentIntent(admin.client as any, claim.claim.intentId, new Date(), runtime),
        processCustomerOrderFulfillmentIntent(admin.client as any, claim.claim.intentId, new Date(), runtime)])
      assert.equal(replies.filter(r => r.created).length, 1)
      const intent = await admin.client.customerOrderFulfillmentIntent.findUniqueOrThrow({ where: { id: claim.claim.intentId } })
      const job = await admin.client.eshopTrayPrintJob.findUniqueOrThrow({ where: { id: intent.printJobId! } })
      const payload = parseV3PrintIntent(job.payload)
      assert.ok(payload && payload.payloadKind === 'RAW_BYTES')
      assert.equal(payload.role, role); assert.equal(payload.orderNo, order.orderNo); assert.equal(payload.source, 'CLOUD_H5')
      assert.equal(job.tenantId, f.tenantId); assert.equal(job.storeId, f.storeId); assert.equal(job.status, 'PENDING')
      assert.equal(job.claimTokenHash, null); assert.equal(intent.state, 'ENQUEUED')
      const snapshot = JSON.parse(intent.snapshotJson)
      assert.equal(intent.purpose, purpose); assert.equal(snapshot.ticketPurpose, purpose)
      assert.equal(snapshot.paymentStatus, purpose === 'FRONT_PAID' ? 'PAID' : 'UNPAID')
      assert.equal(snapshot.paymentMethod, purpose === 'FRONT_PAID' ? method : null)
      if (purpose !== 'FRONT_PAID') { assert.equal(intent.paymentIntentId, null); assert.equal(snapshot.paidAt, null) }
      return job.id
    }
    try {
      const a = await h.worker('route-a'), b = await h.worker('route-b')
      assert.equal((await patch(a, { status: 'CONFIRMED' }, 'invalid')).status, 401)
      assert.equal((await patch(a, { status: 'CONFIRMED' }, signSession({ ...identity, role: 'STAFF', storeId: 'another-store' }))).status, 404)
      for (const response of await Promise.all([patch(a, { status: 'CONFIRMED' }), patch(b, { status: 'CONFIRMED' })])) assert.equal(response.status, 200)
      assert.equal(await admin.client.customerOrderFulfillmentIntent.count({ where: scoped }), 2)
      assert.equal(await admin.client.paymentIntent.count({ where: scoped }), 0)
      assert.equal(await admin.client.eshopTrayPrintJob.count({ where: { tenantId: f.tenantId } }), 0, 'business commit precedes asynchronous render/job')
      const kitchenJob = await sealAndQueue('KITCHEN_MAKE')
      const unpaidJob = await sealAndQueue('FRONT_UNPAID')
      assert.notEqual(unpaidJob, kitchenJob)
      assert.equal((await patch(a, { status: 'CONFIRMED' })).status, 200)
      assert.equal((await patch(a, { status: 'COMPLETED' })).status, 200)
      let competingResponse: Response | undefined
      if (schedule === 'sequential retry') {
        assert.equal((await patch(a, { paymentMethod: method })).status, 200)
        assert.equal((await patch(b, { paymentMethod: method })).status, 200)
      } else {
        // Real READ COMMITTED schedule: collector B has read UNPAID, then A
        // commits before B reads PaymentIntent. No query/result is simulated.
        const held = h.barrier('collector B read the unpaid order')
        let entered = false
        b.setHook(async e => {
          const staleOrder = schedule === 'stale order read before competing collection commits'
          if (!entered && e.phase === 'after' && e.model === (staleOrder ? 'customerOrder' : 'paymentIntent')
            && e.method === (staleOrder ? 'findFirst' : 'findUnique')) {
            if (staleOrder) { assert.equal(e.result.id, order.id); assert.equal(e.result.paymentStatus, 'UNPAID') }
            else assert.equal(e.result, null)
            entered = true
            await held.pause()
          }
        })
        const delayed = h.track(patch(b, { paymentMethod: method }))
        await held.entered()
        try { assert.equal((await patch(a, { paymentMethod: method })).status, 200) }
        finally { held.release() }
        competingResponse = await delayed
        b.setHook(async () => {})
      }
      const pi = await admin.client.paymentIntent.findUniqueOrThrow({ where: { orderNo: order.orderNo } })
      assert.equal(pi.status, 'PAID'); assert.equal(pi.paymentMethod, method === 'QR' ? 'KHQR' : 'CASH')
      assert.equal(pi.transactionActorType, 'H5_CUSTOMER_ORDER'); assert.equal(pi.transactionActorId, order.id)
      assert.equal(pi.amount.toString(), order.totalAmount.toString())
      const frontJob = await sealAndQueue('FRONT_PAID'); assert.notEqual(frontJob, kitchenJob); assert.notEqual(frontJob, unpaidJob)
      assert.equal((await patch(a, { paymentMethod: method })).status, 200)
      assert.equal((await patch(a, { paymentMethod: method === 'CASH' ? 'QR' : 'CASH' })).status, 409)
      for (const generic of [confirmPayment, cancelPayment]) {
        const response = await generic(new NextRequest('https://isolated.test/api/payments/test', { method: 'POST', headers: { cookie: `auth-session=${token}` } }), { params: Promise.resolve({ paymentId: pi.id }) })
        assert.equal(response.status, 422); assert.equal((await response.json()).error, 'INVALID_STATE')
      }
      assert.equal(await admin.client.customerOrderFulfillmentIntent.count({ where: scoped }), 3)
      assert.equal(await admin.client.paymentIntent.count({ where: scoped }), 1)
      assert.equal(await admin.client.eshopTrayPrintJob.count({ where: { tenantId: f.tenantId } }), 3)
      assert.equal(await admin.client.saleRecord.count({ where: { tenantId: f.tenantId } }), 0)
      assert.equal(callbacks.length, 2, 'confirm + complete only; pure collection does not add a notification')
      if (competingResponse) {
        const responseBody = await competingResponse.json()
        assert.equal(competingResponse.status, 200, `same-key/same-method collector must be idempotent; persisted 1 payment, 3 intents/jobs, 0 sales; actual ${JSON.stringify(responseBody)}`)
        assert.equal(responseBody.businessStatus, 'SUCCEEDED')
      }
    } finally {
      undo.reverse().forEach(fn => fn())
      if (disabled === undefined) delete process.env.ESHOP_DISABLE_DEV_HEADERS; else process.env.ESHOP_DISABLE_DEV_HEADERS = disabled
      await admin.client.customerOrderFulfillmentIntent.deleteMany({ where: { tenantId: f.tenantId } })
      await admin.client.paymentIntent.deleteMany({ where: { tenantId: f.tenantId } })
    }
  }))
}

// Forward the real signed-session route to independently connected real
// transaction clients. Hooks control scheduling/faults, never fake query data.
async function collectionRouteHarness(admin: Worker, f: Fixture) {
  ;(globalThis as any).AsyncLocalStorage = AsyncLocalStorage
  const { prisma } = await import('../lib/prisma')
  const { signSession } = await import('../lib/session')
  const { NextRequest } = await import('next/server')
  const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external')
  const { PATCH } = await import('../app/api/customer-orders/[id]/route')
  const { GET } = await import('../app/api/customer-orders/route')
  const active = new AsyncLocalStorage<Worker>(), undo: Array<() => void> = [], callbacks: unknown[] = []
  const db = prisma as any, disabled = process.env.ESHOP_DISABLE_DEV_HEADERS
  process.env.ESHOP_DISABLE_DEV_HEADERS = '1'
  for (const model of ['tenant', 'user', 'store', 'customerOrder', 'paymentIntent', 'customerOrderFulfillmentIntent', 'eshopTrayPrintJob']) {
    for (const op of ['findUnique', 'findFirst', 'findMany']) {
      const old = db[model][op]
      db[model][op] = (...args: any[]) => ((active.getStore() ?? admin).client as any)[model][op](...args)
      undo.push(() => { db[model][op] = old })
    }
  }
  const old = db.$transaction
  db.$transaction = (...args: any[]) => ((active.getStore() ?? admin).db as any).$transaction(...args)
  undo.push(() => { db.$transaction = old })
  const identity = { tenantId: f.tenantId, storeId: f.storeId, userId: f.operator.id, role: 'OWNER' as const }
  const token = signSession(identity)
  const patchBody = (w: Worker, body: object, cookie = token) => active.run(w, () => workAsyncStorage.run({
    afterContext: { after: (fn: unknown) => callbacks.push(fn) },
  } as any, () => PATCH(new NextRequest(`https://isolated.test/api/customer-orders/${f.orderId}`, {
    method: 'PATCH', headers: { cookie: `auth-session=${cookie}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: f.orderId }) })))
  return {
    callbacks,
    cookie: (overrides: Record<string, string>) => signSession({ ...identity, ...overrides } as typeof identity),
    patchBody,
    get: (query: string, cookie = token) => GET(new NextRequest(`https://isolated.test/api/customer-orders?${query}`, { headers: { cookie: `auth-session=${cookie}` } })),
    patch: (w: Worker, method: 'CASH' | 'QR' = 'CASH', cookie = token) => patchBody(w, { paymentMethod: method }, cookie),
    close() {
      undo.reverse().forEach(fn => fn())
      if (disabled === undefined) delete process.env.ESHOP_DISABLE_DEV_HEADERS; else process.env.ESHOP_DISABLE_DEV_HEADERS = disabled
    },
  }
}

test('DB collection rejects actual missing payment, illegal states and unauthorized sessions without writes', { skip: skipReason, timeout: 60_000 }, async () => withFixture(async h => {
  const { fixture: f, admin } = h, route = await collectionRouteHarness(admin, f)
  try {
    assert.equal((await route.patch(admin, 'CASH', 'invalid')).status, 401)
    assert.equal((await route.patch(admin, 'CASH', route.cookie({ role: 'STAFF', storeId: 'other-store' }))).status, 404)
    for (const status of ['PENDING', 'CONFIRMED', 'CANCELLED']) {
      await admin.client.customerOrder.update({ where: { id: f.orderId }, data: { status } })
      const response = await route.patch(admin)
      assert.equal(response.status, 400); assert.equal((await response.json()).error, 'ORDER_NOT_COMPLETED')
    }
    // A real persisted corrupt/legacy PAID row with no PaymentIntent. It must
    // not be "repaired" by inventing another collection or receipt.
    await admin.client.customerOrder.update({ where: { id: f.orderId }, data: {
      status: 'COMPLETED', paymentStatus: 'PAID', paymentMethod: 'CASH', paidAt: f.now, paidAmount: 4.5,
      transactionActorType: 'H5_CUSTOMER_ORDER', transactionActorId: f.orderId,
    } })
    const before = await admin.client.customerOrder.findUniqueOrThrow({ where: { id: f.orderId } })
    const response = await route.patch(admin)
    assert.equal(response.status, 409); assert.equal((await response.json()).error, 'PAYMENT_RECORD_MISSING')
    assert.deepEqual(await admin.client.customerOrder.findUniqueOrThrow({ where: { id: f.orderId } }), before)
    for (const model of ['paymentIntent', 'customerOrderFulfillmentIntent', 'eshopTrayPrintJob', 'saleRecord'] as const) {
      assert.equal(await (admin.client[model] as any).count({ where: { tenantId: f.tenantId } }), 0)
    }
    assert.equal(route.callbacks.length, 0)
  } finally { route.close() }
}))

const collectionFaults = [
  'payment-missing', 'front-missing', 'order-state', 'order-paidAt', 'order-amount', 'order-actor', 'order-method',
  'payment-tenant', 'payment-store', 'payment-actor', 'payment-amount', 'payment-method', 'payment-status', 'payment-paidAt',
  'front-link', 'front-source',
] as const
for (const fault of collectionFaults) {
  test(`DB zero-row collection fails closed on committed evidence: ${fault}`, { skip: skipReason, timeout: 60_000 }, async () => withFixture(async h => {
    const { fixture: f, admin } = h
    await admin.client.customerOrder.update({ where: { id: f.orderId }, data: { status: 'COMPLETED' } })
    const route = await collectionRouteHarness(admin, f), a = await h.worker('winner'), b = await h.worker('stale-reader')
    const orderRead = h.barrier('B has stale unpaid order'), paymentRead = h.barrier('B has valid but now stale payment')
    let orderEntered = false, paymentEntered = false
    b.setHook(async e => {
      if (e.phase !== 'after') return
      if (!orderEntered && e.model === 'customerOrder' && e.method === 'findFirst') {
        assert.equal(e.result.paymentStatus, 'UNPAID'); orderEntered = true; await orderRead.pause()
      } else if (!paymentEntered && e.model === 'paymentIntent' && e.method === 'findUnique') {
        assert.equal(e.result.status, 'PAID'); paymentEntered = true; await paymentRead.pause()
      }
    })
    try {
      const delayed = h.track(route.patch(b))
      await orderRead.entered()
      assert.equal((await route.patch(a)).status, 200)
      orderRead.release()
      await paymentRead.entered()
      const pi = await admin.client.paymentIntent.findUniqueOrThrow({ where: { orderNo: f.orderNo } })
      const front = await admin.client.customerOrderFulfillmentIntent.findUniqueOrThrow({ where: {
        tenantId_storeId_orderNo_purpose: { tenantId: f.tenantId, storeId: f.storeId, orderNo: f.orderNo, purpose: 'FRONT_PAID' },
      } })
      if (fault === 'payment-missing') await admin.client.paymentIntent.delete({ where: { id: pi.id } })
      else if (fault === 'front-missing') await admin.client.customerOrderFulfillmentIntent.delete({ where: { id: front.id } })
      else if (fault.startsWith('order-')) {
        const data = fault === 'order-state' ? { status: 'CANCELLED' }
          : fault === 'order-paidAt' ? { paidAt: null } : fault === 'order-amount' ? { paidAmount: 99 }
            : fault === 'order-actor' ? { transactionActorId: 'wrong-order' } : { paymentMethod: 'QR' }
        await admin.client.customerOrder.update({ where: { id: f.orderId }, data })
      } else if (fault.startsWith('payment-')) {
        const data = fault === 'payment-tenant' ? { tenantId: 'wrong-tenant' }
          : fault === 'payment-store' ? { storeId: 'wrong-store' }
            : fault === 'payment-actor' ? { transactionActorType: 'NOT_H5' }
              : fault === 'payment-amount' ? { amount: 99 }
                : fault === 'payment-method' ? { paymentMethod: 'KHQR' as const }
                  : fault === 'payment-status' ? { status: 'CANCELLED' as const } : { paidAt: null }
        await admin.client.paymentIntent.update({ where: { id: pi.id }, data })
      } else await admin.client.customerOrderFulfillmentIntent.update({ where: { id: front.id }, data:
        fault === 'front-link' ? { paymentIntentId: 'wrong-payment' } : { source: 'NOT_H5_HOME' },
      })
      const beforeOrder = await admin.client.customerOrder.findUniqueOrThrow({ where: { id: f.orderId } })
      const beforePi = await admin.client.paymentIntent.findUnique({ where: { id: pi.id } })
      const beforeFront = await admin.client.customerOrderFulfillmentIntent.findUnique({ where: { id: front.id } })
      paymentRead.release()
      const response = await delayed
      const missing = ['payment-missing', 'front-missing', 'order-paidAt'].includes(fault)
      assert.equal(response.status, fault === 'order-state' ? 400 : 409)
      assert.equal((await response.json()).error, fault === 'order-state' ? 'ORDER_NOT_COMPLETED' : missing ? 'PAYMENT_RECORD_MISSING' : 'PAYMENT_INTENT_CONFLICT')
      assert.ok(b.events.some(e => e.phase === 'after' && e.model === 'customerOrder' && e.method === 'updateMany' && e.result.count === 0))
      assert.deepEqual(await admin.client.customerOrder.findUniqueOrThrow({ where: { id: f.orderId } }), beforeOrder)
      assert.deepEqual(await admin.client.paymentIntent.findUnique({ where: { id: pi.id } }), beforePi)
      assert.deepEqual(await admin.client.customerOrderFulfillmentIntent.findUnique({ where: { id: front.id } }), beforeFront)
      assert.equal(await admin.client.paymentIntent.count({ where: { orderNo: f.orderNo } }), fault === 'payment-missing' ? 0 : 1)
      assert.equal(await admin.client.eshopTrayPrintJob.count({ where: { tenantId: f.tenantId } }), 0)
      assert.equal(await admin.client.saleRecord.count({ where: { tenantId: f.tenantId } }), 0)
      assert.equal(route.callbacks.length, 0)
    } finally {
      orderRead.release(); paymentRead.release(); route.close()
      // The deliberately wrong tenant value must not leak beyond this fixture.
      await admin.client.paymentIntent.deleteMany({ where: { orderNo: f.orderNo } })
    }
  }))
}

for (const stage of ['paymentIntent', 'customerOrderFulfillmentIntent'] as const) {
  test(`DB actual collection SQL failure after ${stage} rolls back payment/order/intent; retry commits once`, { skip: skipReason, timeout: 60_000 }, async () => withFixture(async h => {
    const { fixture: f, admin } = h, w = await h.worker('collection-rollback')
    await admin.client.customerOrder.update({ where: { id: f.orderId }, data: { status: 'COMPLETED' } })
    const route = await collectionRouteHarness(admin, f)
    let injections = 0
    w.setHook(async (e, tx) => { if (e.phase === 'after' && e.model === stage && e.method === 'create') { injections += 1; await tx.$queryRaw`SELECT 1 / 0` } })
    try {
      await assert.rejects(route.patch(w), (e: any) => e.code === 'P2010' && e.meta?.driverAdapterError?.cause?.originalCode === '22012')
      assert.equal(injections, 1)
      const order = await admin.client.customerOrder.findUniqueOrThrow({ where: { id: f.orderId } })
      assert.equal(order.paymentStatus, 'UNPAID'); assert.equal(order.paidAt, null); assert.equal(order.paidAmount, null)
      assert.equal(await admin.client.paymentIntent.count({ where: { orderNo: f.orderNo } }), 0)
      assert.equal(await admin.client.customerOrderFulfillmentIntent.count({ where: { tenantId: f.tenantId } }), 0)
      w.setHook(async () => {})
      assert.equal((await route.patch(w)).status, 200); assert.equal((await route.patch(w)).status, 200)
      assert.equal(await admin.client.paymentIntent.count({ where: { orderNo: f.orderNo } }), 1)
      assert.equal(await admin.client.customerOrderFulfillmentIntent.count({ where: { tenantId: f.tenantId, role: 'FRONT' } }), 1)
      assert.equal(await admin.client.eshopTrayPrintJob.count({ where: { tenantId: f.tenantId } }), 0)
      assert.equal(await admin.client.saleRecord.count({ where: { tenantId: f.tenantId } }), 0)
      assert.equal(route.callbacks.length, 0)
    } finally { route.close() }
  }))
}

async function acceptedThreePurposeFixture(h: { admin: Worker; fixture: Fixture }) {
  const { admin, fixture: f } = h, route = await collectionRouteHarness(admin, f)
  await admin.client.customerOrder.update({ where: { id: f.orderId }, data: { status: 'PENDING' } })
  try { assert.equal((await route.patchBody(admin, { status: 'CONFIRMED' })).status, 200) }
  catch (error) { route.close(); throw error }
  const intents = await admin.client.customerOrderFulfillmentIntent.findMany({ where: { tenantId: f.tenantId } })
  assert.deepEqual(intents.map(i => i.purpose).sort(), ['FRONT_UNPAID', 'KITCHEN_MAKE'])
  return { route, intents, owner: { ...renderOwner(f), roles: ['KITCHEN', 'FRONT'] as RenderWorker['roles'] } }
}

async function sealPurpose(h: { admin: Worker; fixture: Fixture }, purpose: 'KITCHEN_MAKE' | 'FRONT_UNPAID' | 'FRONT_PAID', now?: Date) {
  const role = purpose === 'KITCHEN_MAKE' ? 'KITCHEN' : 'FRONT'
  const owner: RenderWorker = { ...renderOwner(h.fixture), roles: [role] }
  const options = { ...runtime, ...(now ? { now: () => now } : {}) }
  const reserved = await claimCustomerOrderRender(h.admin.client as any, owner, options)
  assert.equal(reserved.kind, 'CLAIMED')
  assert.equal(JSON.parse(reserved.claim.snapshotJson).ticketPurpose, purpose)
  assert.equal((await sealCustomerOrderRender(h.admin.client as any, owner, { ...reserved.claim, ...sealedBytes }, options)).kind, 'SEALED')
  return reserved.claim.intentId as string
}

test('DB R1: failed collection retains completed unpaid order in scoped Desktop list; retry pays once without reaccept', { skip: skipReason, timeout: 90_000 }, async () => withFixture(async h => {
  const { admin, fixture: f } = h, { route } = await acceptedThreePurposeFixture(h), payer = await h.worker('reentry-payment')
  try {
    for (const purpose of ['KITCHEN_MAKE', 'FRONT_UNPAID'] as const) {
      const id = await sealPurpose(h, purpose)
      assert.equal((await processCustomerOrderFulfillmentIntent(admin.client as any, id, new Date(), runtime)).status, 'QUEUED')
    }
    assert.equal((await route.patchBody(admin, { status: 'COMPLETED' })).status, 200)
    payer.setHook(async (e, tx) => { if (e.phase === 'after' && e.model === 'paymentIntent' && e.method === 'create') await tx.$queryRaw`SELECT 1 / 0` })
    await assert.rejects(route.patch(payer), (e: any) => e.code === 'P2010')
    const store = await admin.client.store.findUniqueOrThrow({ where: { id: f.storeId } })
    const list = await route.get(`storeCode=${store.code}`)
    assert.equal(list.status, 200)
    const rows = await list.json(); assert.equal(rows.length, 1)
    assert.equal(rows[0].id, f.orderId); assert.equal(rows[0].status, 'COMPLETED'); assert.equal(rows[0].paymentStatus, 'UNPAID')
    assert.deepEqual(await (await route.get('storeCode=wrong-store')).json(), [])
    assert.equal((await route.get(`id=${f.orderId}&storeCode=wrong-store`)).status, 404)
    assert.equal((await route.get(`id=${f.orderId}`, route.cookie({ role: 'STAFF', storeId: 'wrong-store' }))).status, 404)
    assert.equal((await route.get(`id=${f.orderId}`, 'invalid')).status, 401)
    payer.setHook(async () => {})
    assert.equal((await route.patch(payer)).status, 200); assert.equal((await route.patch(payer)).status, 200)
    assert.deepEqual(await (await route.get(`storeCode=${store.code}`)).json(), [])
    const paid = await sealPurpose(h, 'FRONT_PAID')
    assert.equal((await processCustomerOrderFulfillmentIntent(admin.client as any, paid, new Date(), runtime)).status, 'QUEUED')
    assert.equal(await admin.client.paymentIntent.count({ where: { tenantId: f.tenantId } }), 1)
    assert.equal(await admin.client.eshopTrayPrintJob.count({ where: { tenantId: f.tenantId } }), 3)
    assert.equal(await admin.client.saleRecord.count({ where: { tenantId: f.tenantId } }), 0)
  } finally { route.close() }
}))

for (const mismatch of ['none', 'unknown', 'hash', 'missing-seal'] as const) {
  test(`DB R3: unpaid job association gap ${mismatch}; payment never invents NOT_REQUIRED or another task`, { skip: skipReason, timeout: 90_000 }, async () => withFixture(async h => {
    const { admin, fixture: f } = h, { route } = await acceptedThreePurposeFixture(h)
    try {
      const id = await sealPurpose(h, 'FRONT_UNPAID')
      const created = await processCustomerOrderFulfillmentIntent(admin.client as any, id, new Date(), runtime)
      assert.equal(created.status, 'QUEUED'); assert.ok(created.printJobId)
      const matches = mismatch === 'none' || mismatch === 'unknown'
      if (mismatch === 'unknown') {
        const delivered = await deliverV3PrintIntent(admin.client as any, { tenantId: f.tenantId, storeId: f.storeId, deviceId: f.deviceId, batchId: f.batchId, role: 'FRONT' })
        assert.equal(delivered.ok, true); assert.equal(delivered.job?.id, created.printJobId)
        const original = await admin.client.customerOrderFulfillmentIntent.findUniqueOrThrow({ where: { id } })
        assert.deepEqual(await reportV3Execution(admin.client as any, { tenantId: f.tenantId, storeId: f.storeId, deviceId: f.deviceId, batchId: f.batchId },
          { printJobId: original.idempotencyKey, source: 'CLOUD_H5', role: 'FRONT', executionId: `unknown-${randomUUID()}`, ownerEpoch: 1, reportVersion: 1, outcome: 'CROSSING_UNKNOWN' }), { ok: true, acknowledged: true })
      }
      // Deliberately inject a persisted association gap, not a purported normal transaction outcome.
      await admin.client.customerOrderFulfillmentIntent.update({ where: { id }, data: { printJobId: null, state: 'PENDING',
        ...(mismatch === 'missing-seal' ? { sealedAt: null } : {}) } })
      if (mismatch === 'hash') await admin.client.eshopTrayPrintJob.update({ where: { id: created.printJobId }, data: { requestHash: '0'.repeat(64) } })
      assert.equal((await route.patchBody(admin, { status: 'COMPLETED' })).status, 200)
      assert.equal((await route.patch(admin)).status, 200)
      const current = await admin.client.customerOrderFulfillmentIntent.findUniqueOrThrow({ where: { id } })
      assert.equal(current.state, matches ? 'ENQUEUED' : 'MANUAL_REVIEW')
      assert.equal(current.printJobId, matches ? created.printJobId : null)
      assert.notEqual(current.lastErrorCode, 'FRONT_UNPAID_SUPERSEDED_BY_PAYMENT')
      if (!matches) assert.equal(current.manualReviewReason, 'CUSTOMER_ORDER_EXISTING_JOB_IDENTITY_MISMATCH')
      const again = await processCustomerOrderFulfillmentIntent(admin.client as any, id, new Date(), runtime)
      assert.equal(again.status, matches ? 'ALREADY_PRESENT' : 'MANUAL_REVIEW'); assert.equal(again.created, false)
      const evidence = await (await route.get(`id=${f.orderId}`)).json()
      assert.equal(evidence.fulfillment.frontUnpaid, matches ? mismatch === 'unknown' ? 'RESULT_UNKNOWN' : 'QUEUED' : 'REVIEW_REQUIRED')
      if (matches) {
        // Exercise the recovery caller too, after payment has committed.
        await admin.client.customerOrderFulfillmentIntent.update({ where: { id }, data: { printJobId: null, state: 'PENDING' } })
        const recovered = await processCustomerOrderFulfillmentIntent(admin.client as any, id, new Date(), runtime)
        assert.equal(recovered.status, 'ALREADY_PRESENT'); assert.equal(recovered.printJobId, created.printJobId); assert.equal(recovered.created, false)
      }
      assert.equal(await admin.client.eshopTrayPrintJob.count({ where: { tenantId: f.tenantId } }), 1)
      assert.equal(await admin.client.saleRecord.count({ where: { tenantId: f.tenantId } }), 0)
    } finally { route.close() }
  }))
}

for (const deliveryState of ['unclaimed', 'claimed', 'unknown', 'mismatch'] as const) {
  test(`DB R3: cancel association gap ${deliveryState} verifies the real job; repeat and lost-link receipt fail closed`, { skip: skipReason, timeout: 90_000 }, async () => withFixture(async h => {
    const { admin, fixture: f } = h, { route } = await acceptedThreePurposeFixture(h)
    try {
      const id = await sealPurpose(h, 'FRONT_UNPAID')
      const created = await processCustomerOrderFulfillmentIntent(admin.client as any, id, new Date(), runtime)
      assert.equal(created.status, 'QUEUED'); assert.ok(created.printJobId)
      if (deliveryState === 'claimed' || deliveryState === 'unknown') {
        const delivered = await deliverV3PrintIntent(admin.client as any, { tenantId: f.tenantId, storeId: f.storeId, deviceId: f.deviceId, batchId: f.batchId, role: 'FRONT' })
        assert.equal(delivered.ok, true); assert.equal(delivered.job?.id, created.printJobId)
        if (deliveryState === 'unknown') {
          const original = await admin.client.customerOrderFulfillmentIntent.findUniqueOrThrow({ where: { id } })
          assert.deepEqual(await reportV3Execution(admin.client as any, { tenantId: f.tenantId, storeId: f.storeId, deviceId: f.deviceId, batchId: f.batchId },
            { printJobId: original.idempotencyKey, source: 'CLOUD_H5', role: 'FRONT', executionId: `unknown-${randomUUID()}`, ownerEpoch: 1, reportVersion: 1, outcome: 'CROSSING_UNKNOWN' }), { ok: true, acknowledged: true })
        }
      }
      if (deliveryState === 'mismatch') await admin.client.eshopTrayPrintJob.update({ where: { id: created.printJobId }, data: { requestHash: '0'.repeat(64) } })
      const before = await admin.client.eshopTrayPrintJob.findUniqueOrThrow({ where: { id: created.printJobId } })
      await admin.client.customerOrderFulfillmentIntent.update({ where: { id }, data: { printJobId: null, state: 'PENDING' } })
      for (let retry = 0; retry < 2; retry++) {
        assert.equal((await route.patchBody(admin, { status: 'CANCELLED' })).status, 200)
        const evidence = await (await route.get(`id=${f.orderId}`)).json()
        assert.equal(evidence.fulfillment.frontUnpaid, deliveryState === 'unclaimed' ? 'NOT_REQUIRED' : 'REVIEW_REQUIRED')
        const receipt = await customerOrderPrintReceipt(admin.client as any, f, 'FRONT', 'FRONT_UNPAID')
        assert.equal(receipt.status, deliveryState === 'unclaimed' ? 'NOT_REQUIRED' : 'MANUAL_REVIEW')
      }
      const current = await admin.client.customerOrderFulfillmentIntent.findUniqueOrThrow({ where: { id } })
      const job = await admin.client.eshopTrayPrintJob.findUniqueOrThrow({ where: { id: created.printJobId } })
      if (deliveryState === 'unclaimed') {
        assertWithdrawn(job)
        assert.equal(current.printJobId, job.id)
        const delivery = await deliverV3PrintIntent(admin.client as any, { tenantId: f.tenantId, storeId: f.storeId, deviceId: f.deviceId, batchId: f.batchId, role: 'FRONT' })
        assert.equal(delivery.ok, true); assert.equal(delivery.job, null)
      } else {
        assert.deepEqual(job, before, 'ambiguous/claimed task is never modified by cancellation')
        assert.notEqual(current.cancelResultCode, CANCEL_CODE)
      }
      // Read-only evidence must also reject a terminal lost link; do not relink or redeliver here.
      await admin.client.customerOrderFulfillmentIntent.update({ where: { id }, data: { printJobId: null } })
      const lostLink = await (await route.get(`id=${f.orderId}`)).json()
      assert.equal(lostLink.fulfillment.frontUnpaid, 'REVIEW_REQUIRED')
      assert.equal((await customerOrderPrintReceipt(admin.client as any, f, 'FRONT', 'FRONT_UNPAID')).status, 'MANUAL_REVIEW')
      assert.equal(await admin.client.eshopTrayPrintJob.count({ where: { tenantId: f.tenantId } }), 1)
      assert.equal(await admin.client.saleRecord.count({ where: { tenantId: f.tenantId } }), 0)
    } finally { route.close() }
  }))
}

for (const state of ['EXPIRED', 'MANUAL_REVIEW'] as const) test(`DB payment supersedes jobless ${state} unpaid Intent, preserving audit reason`, { skip: skipReason, timeout: 90_000 }, async () => withFixture(async h => {
  const { admin, fixture: f } = h, { route, intents } = await acceptedThreePurposeFixture(h)
  try {
    const id = intents.find(i => i.purpose === 'FRONT_UNPAID')!.id
    await admin.client.customerOrderFulfillmentIntent.update({ where: { id }, data: { state, manualReviewReason: 'PRIOR_EVIDENCE' } })
    assert.equal((await route.patchBody(admin, { status: 'COMPLETED' })).status, 200)
    assert.equal((await route.patch(admin)).status, 200)
    const current = await admin.client.customerOrderFulfillmentIntent.findUniqueOrThrow({ where: { id } })
    assert.equal(current.state, 'NOT_REQUIRED'); assert.equal(current.manualReviewReason, 'PRIOR_EVIDENCE')
    assert.equal(current.lastErrorCode, 'FRONT_UNPAID_SUPERSEDED_BY_PAYMENT'); assert.equal(current.printJobId, null)
  } finally { route.close() }
}))

for (const phase of ['seal', 'create'] as const) for (const first of ['render', 'payment'] as const) {
  test(`DB unpaid ${phase}/payment: ${first} holds real order lock first`, { skip: skipReason, timeout: 90_000 }, async () => withFixture(async h => {
    const { admin, observer, fixture: f } = h, { route, owner } = await acceptedThreePurposeFixture(h)
    const render = await h.worker('render-pay-race'), payer = await h.worker('pay-render-race'), held = h.barrier(`${first} holds order`)
    try {
      assert.equal((await route.patchBody(admin, { status: 'COMPLETED' })).status, 200)
      const reservation = await claimCustomerOrderRender(admin.client as any, { ...owner, roles: ['FRONT'] }, runtime)
      assert.equal(reservation.kind, 'CLAIMED')
      const reply = { ...reservation.claim, ...sealedBytes }, id = reply.intentId
      if (phase === 'create') assert.equal((await sealCustomerOrderRender(admin.client as any, owner, reply, runtime)).kind, 'SEALED')
      const action = (): Promise<any> => phase === 'seal' ? sealCustomerOrderRender(render.db as any, owner, reply, runtime)
        : processCustomerOrderFulfillmentIntent(render.db as any, id, new Date(), runtime)
      let rendering: Promise<any>, payment: Promise<Response>
      if (first === 'render') {
        render.setHook(async e => { if (e.phase === 'after' && orderLock(f)(e)) await held.pause() })
        rendering = h.track(action()); await held.entered()
        payment = h.track(route.patch(payer))
        await waitForBlockedBy(observer, payer, render, tableStatement('CustomerOrder', 'UPDATE'), orderUpdate(f))
      } else {
        payer.setHook(async e => { if (e.phase === 'after' && orderUpdate(f)(e)) { assert.equal(e.result.count, 1); await held.pause() } })
        payment = h.track(route.patch(payer)); await held.entered()
        rendering = h.track(action())
        await waitForBlockedBy(observer, render, payer, tableStatement('CustomerOrder', 'FROM'), orderLock(f))
      }
      held.release()
      const [r, p] = await Promise.all([rendering, payment]); assert.equal(p.status, 200)
      assert.equal(phase === 'seal' ? r.kind : r.status, first === 'render' ? (phase === 'seal' ? 'SEALED' : 'QUEUED') : (phase === 'seal' ? 'TERMINAL' : 'NOT_REQUIRED'))
      const current = await admin.client.customerOrderFulfillmentIntent.findUniqueOrThrow({ where: { id } })
      const createdBeforePayment = first === 'render' && phase === 'create'
      assert.equal(current.state, createdBeforePayment ? 'ENQUEUED' : 'NOT_REQUIRED')
      assert.equal(Boolean(current.printJobId), createdBeforePayment)
      assert.equal(await admin.client.eshopTrayPrintJob.count({ where: { tenantId: f.tenantId } }), createdBeforePayment ? 1 : 0)
      assert.equal(await admin.client.paymentIntent.count({ where: { tenantId: f.tenantId } }), 1)
      assert.equal(await admin.client.saleRecord.count({ where: { tenantId: f.tenantId } }), 0)
    } finally { held.release(); route.close() }
  }))
}

test('DB three-purpose unique and role CHECK reject invalid rows; old snapshots retain canonical identity', { skip: skipReason, timeout: 60_000 }, async () => withFixture(async h => {
  const { admin, fixture: f } = h, { route, intents } = await acceptedThreePurposeFixture(h)
  try {
    const unpaid = intents.find(i => i.purpose === 'FRONT_UNPAID')!, kitchen = intents.find(i => i.purpose === 'KITCHEN_MAKE')!
    assert.notEqual(unpaid.idempotencyKey, kitchen.idempotencyKey)
    await assert.rejects(admin.client.customerOrderFulfillmentIntent.create({ data: intentCreateData({ order: f.order, role: 'FRONT', purpose: 'FRONT_UNPAID', decision: 'REQUIRED', now: f.now }) }), (e: any) => e.code === 'P2002')
    await assert.rejects(admin.pool.query('UPDATE "CustomerOrderFulfillmentIntent" SET role = $1 WHERE id = $2', ['KITCHEN', unpaid.id]), (e: any) => e.code === '23514')
    await assert.rejects(admin.pool.query('UPDATE "CustomerOrderFulfillmentIntent" SET purpose = NULL WHERE id = $1', [unpaid.id]), (e: any) => e.code === '23502')
    const old = JSON.parse(kitchen.snapshotJson); delete old.ticketPurpose
    const snapshotJson = JSON.stringify(old)
    await admin.client.customerOrderFulfillmentIntent.update({ where: { id: kitchen.id }, data: { snapshotJson, snapshotHash: sha(snapshotJson), ...sealedBytes, renderProfileId: testProfileId, sealedAt: f.now, state: 'PENDING' } })
    const queued = await processCustomerOrderFulfillmentIntent(admin.client as any, kitchen.id, new Date(), runtime)
    assert.equal(queued.status, 'QUEUED')
    await exactJob(admin.client, f, kitchen.idempotencyKey, queued.printJobId!)
    assert.equal(await admin.client.customerOrderFulfillmentIntent.count({ where: { tenantId: f.tenantId } }), 2)
  } finally { route.close() }
}))

for (const failed of ['KITCHEN_MAKE', 'FRONT_UNPAID', 'FRONT_PAID'] as const) {
  test(`DB independent purpose recovery: ${failed} renderer failure retries only failed purpose`, { skip: skipReason, timeout: 90_000 }, async () => withFixture(async h => {
    const { admin, fixture: f } = h, { route } = await acceptedThreePurposeFixture(h)
    try {
      const completed = new Map<string, string>()
      for (const purpose of ['KITCHEN_MAKE', 'FRONT_UNPAID'] as const) if (purpose !== failed) {
        const id = await sealPurpose(h, purpose)
        const r = await processCustomerOrderFulfillmentIntent(admin.client as any, id, new Date(), runtime)
        assert.equal(r.status, 'QUEUED'); completed.set(id, r.printJobId!)
      }
      if (failed === 'FRONT_PAID') {
        assert.equal((await route.patchBody(admin, { status: 'COMPLETED' })).status, 200)
        assert.equal((await route.patch(admin)).status, 200)
      }
      const owner: RenderWorker = { ...renderOwner(f), roles: [failed === 'KITCHEN_MAKE' ? 'KITCHEN' : 'FRONT'] }
      const reserved = await claimCustomerOrderRender(admin.client as any, owner, runtime)
      assert.equal(reserved.kind, 'CLAIMED'); assert.equal(JSON.parse(reserved.claim.snapshotJson).ticketPurpose, failed)
      assert.equal((await failCustomerOrderRender(admin.client as any, owner, { ...reserved.claim, code: 'RENDER_TIMEOUT' }, runtime)).kind, 'WAITING')
      const row = await admin.client.customerOrderFulfillmentIntent.findUniqueOrThrow({ where: { id: reserved.claim.intentId } })
      assert.equal(row.renderAttemptCount, 1); assert.equal(row.attemptCount, 0); assert.equal(row.printJobId, null)
      // Use the exact persisted backoff instant; no sleep, budget reset or manual association.
      const id = await sealPurpose(h, failed, row.nextAttemptAt)
      assert.equal((await failCustomerOrderRender(admin.client as any, owner, { ...reserved.claim, code: 'RENDER_TIMEOUT' }, runtime)).kind, 'STALE')
      // A late failure from the expired reservation cannot overwrite the sealed winner.
      const sealed = await admin.client.customerOrderFulfillmentIntent.findUniqueOrThrow({ where: { id } })
      assert.ok(sealed.sealedAt); assert.equal(sealed.renderAttemptCount, 2)
      // Job creation uses wall time; set only the test clock's persisted eligibility back to now.
      await admin.client.customerOrderFulfillmentIntent.update({ where: { id }, data: { nextAttemptAt: new Date() } })
      const result = await processCustomerOrderFulfillmentIntent(admin.client as any, id, new Date(), runtime)
      assert.equal(result.status, 'QUEUED')
      for (const [doneId, jobId] of completed) {
        assert.equal((await processCustomerOrderFulfillmentIntent(admin.client as any, doneId, new Date(), runtime)).printJobId, jobId)
      }
      assert.equal((await processCustomerOrderFulfillmentIntent(admin.client as any, id, new Date(), runtime)).printJobId, result.printJobId)
      assert.equal(await admin.client.eshopTrayPrintJob.count({ where: { tenantId: f.tenantId } }), failed === 'FRONT_PAID' ? 3 : 2)
      assert.equal(await admin.client.saleRecord.count({ where: { tenantId: f.tenantId } }), 0)
    } finally { route.close() }
  }))
}

for (const phase of ['rendering', 'sealed'] as const) {
  test(`DB payment supersedes ${phase} FRONT_UNPAID before enqueue; late result cannot create it`, { skip: skipReason, timeout: 90_000 }, async () => withFixture(async h => {
    const { admin, fixture: f } = h, { route, owner } = await acceptedThreePurposeFixture(h)
    try {
      const kitchen = await sealPurpose(h, 'KITCHEN_MAKE')
      assert.equal((await processCustomerOrderFulfillmentIntent(admin.client as any, kitchen, new Date(), runtime)).status, 'QUEUED')
      const claim = await claimCustomerOrderRender(admin.client as any, { ...owner, roles: ['FRONT'] }, runtime)
      assert.equal(claim.kind, 'CLAIMED'); assert.equal(JSON.parse(claim.claim.snapshotJson).ticketPurpose, 'FRONT_UNPAID')
      if (phase === 'sealed') assert.equal((await sealCustomerOrderRender(admin.client as any, owner, { ...claim.claim, ...sealedBytes }, runtime)).kind, 'SEALED')
      assert.equal((await route.patchBody(admin, { status: 'COMPLETED' })).status, 200)
      assert.equal((await route.patch(admin)).status, 200)
      assert.equal((await route.patch(admin)).status, 200)
      const unpaid = await admin.client.customerOrderFulfillmentIntent.findUniqueOrThrow({ where: { id: claim.claim.intentId } })
      assert.equal(unpaid.state, 'NOT_REQUIRED'); assert.equal(unpaid.lastErrorCode, 'FRONT_UNPAID_SUPERSEDED_BY_PAYMENT')
      assert.equal(unpaid.printJobId, null); assert.equal(unpaid.renderLeaseTokenHash, null)
      assert.equal((await sealCustomerOrderRender(admin.client as any, owner, { ...claim.claim, ...sealedBytes }, runtime)).kind, 'TERMINAL')
      assert.equal((await processCustomerOrderFulfillmentIntent(admin.client as any, unpaid.id, new Date(), runtime)).status, 'NOT_REQUIRED')
      const paid = await sealPurpose(h, 'FRONT_PAID')
      assert.equal((await processCustomerOrderFulfillmentIntent(admin.client as any, paid, new Date(), runtime)).status, 'QUEUED')
      assert.equal(await admin.client.eshopTrayPrintJob.count({ where: { tenantId: f.tenantId } }), 2)
      assert.equal(await admin.client.eshopTrayPrintJob.count({ where: jobWhere(f, unpaid.idempotencyKey).tenantId_storeId_idempotencyKey }), 0)
      assert.equal(await admin.client.saleRecord.count({ where: { tenantId: f.tenantId } }), 0)
    } finally { route.close() }
  }))
}

for (const claimed of [false, true]) {
  test(`DB formal cancel withdraws both acceptance purposes; claimed unpaid=${claimed} stays fail closed`, { skip: skipReason, timeout: 90_000 }, async () => withFixture(async h => {
    const { admin, fixture: f } = h, { route } = await acceptedThreePurposeFixture(h)
    try {
      for (const purpose of ['KITCHEN_MAKE', 'FRONT_UNPAID'] as const) {
        const id = await sealPurpose(h, purpose)
        assert.equal((await processCustomerOrderFulfillmentIntent(admin.client as any, id, new Date(), runtime)).status, 'QUEUED')
      }
      const unpaid = await admin.client.customerOrderFulfillmentIntent.findFirstOrThrow({ where: { tenantId: f.tenantId, orderNo: f.orderNo, purpose: 'FRONT_UNPAID' } })
      if (claimed) {
        const delivery = await deliverV3PrintIntent(admin.client as any, { tenantId: f.tenantId, storeId: f.storeId, deviceId: f.deviceId, batchId: f.batchId, role: 'FRONT' })
        assert.equal(delivery.ok, true)
        assert.equal(delivery.job?.id, unpaid.printJobId)
      }
      for (let repeat = 0; repeat < 2; repeat++) assert.equal((await route.patchBody(admin, { status: 'CANCELLED' })).status, 200)
      const response = await (await route.get(`id=${f.orderId}`)).json()
      assert.equal(response.fulfillment.frontUnpaid, claimed ? 'REVIEW_REQUIRED' : 'NOT_REQUIRED')
      const intents = await admin.client.customerOrderFulfillmentIntent.findMany({ where: { tenantId: f.tenantId } })
      for (const i of intents) {
        assert.equal(i.state, 'CANCELLED')
        const job = await admin.client.eshopTrayPrintJob.findUniqueOrThrow({ where: { id: i.printJobId! } })
        if (claimed && i.purpose === 'FRONT_UNPAID') {
          assert.equal(i.cancelResultCode, 'V3_CANCEL_MANUAL_REVIEW'); assert.ok(i.manualReviewReason)
          assert.ok(job.claimTokenHash); assert.equal(job.resultStatus, null); assert.equal(job.status, 'PENDING')
        } else assertWithdrawn(job)
      }
      assert.equal(await admin.client.eshopTrayPrintJob.count({ where: { tenantId: f.tenantId } }), 2)
      assert.equal(await admin.client.saleRecord.count({ where: { tenantId: f.tenantId } }), 0)
    } finally { route.close() }
  }))
}

test('DB unpaid FRONT cannot use canonical FRONT reprint; no task or successful audit', { skip: skipReason, timeout: 60_000 }, async () => withFixture(async h => {
  const { admin, fixture: f } = h, { route } = await acceptedThreePurposeFixture(h)
  try {
    const id = await sealPurpose(h, 'FRONT_UNPAID')
    assert.equal((await processCustomerOrderFulfillmentIntent(admin.client as any, id, new Date(), runtime)).status, 'QUEUED')
    const request = { schemaVersion: 3 as const, requestId: `v3-reprint:front:${randomUUID()}`, orderNo: f.orderNo,
      role: 'FRONT' as const, confirmation: 'OPERATOR_CONFIRMED' as const, rendererVersion: 'reprint-raw-v1' as const,
      commandStream: { encoding: 'base64' as const, byteLength: sealedBytes.byteLength, sha256: sealedBytes.payloadHash, data: sealedBytes.payloadBase64 } }
    await assert.rejects(enqueueV3ManualReprintWithDb(admin.client, { tenantId: f.tenantId, storeId: f.storeId }, { kind: 'ACCOUNT', userId: f.operator.id, role: 'OWNER' }, request), (e: any) => e instanceof V3ReprintError && e.status === 409 && e.code === 'V3_REPRINT_ORIGINAL_NOT_TERMINAL')
    assert.equal(await admin.client.eshopTrayPrintJob.count({ where: { tenantId: f.tenantId } }), 1)
    assert.equal(await admin.client.operationLog.count({ where: { tenantId: f.tenantId, actionType: 'V3_PRINT_MANUAL_REPRINT_REQUESTED' } }), 0)
  } finally { route.close() }
}))

async function cleanupFixture(client: PrismaClient, tenantId: string) {
  await client.couponRedemption.deleteMany({ where: { tenantId } })
  await client.customerCoupon.deleteMany({ where: { tenantId } })
  await client.couponTemplate.deleteMany({ where: { tenantId } })
  await client.customerOrderFulfillmentIntent.deleteMany({ where: { tenantId } })
  await client.paymentIntent.deleteMany({ where: { tenantId } })
  await client.eshopTrayPrintJob.deleteMany({ where: { tenantId } })
  await client.operationLog.deleteMany({ where: { tenantId } })
  await client.v3PrintExecutionBatch.deleteMany({ where: { tenantId } })
  await client.v3PrintControlPlane.deleteMany({ where: { tenantId } })
  await client.customerOrder.deleteMany({ where: { tenantId } })
  await client.product.deleteMany({ where: { tenantId } })
  await client.user.deleteMany({ where: { tenantId } })
  await client.desktopDevice.deleteMany({ where: { tenantId } })
  await client.store.deleteMany({ where: { tenantId } })
  await client.tenant.deleteMany({ where: { id: tenantId } })
}

async function withFixture(run: (h: {
  fixture: Fixture; admin: Worker; observer: Worker; worker: (name: string) => Promise<Worker>;
  barrier: (name: string) => ReturnType<typeof gate>; track: <T>(promise: Promise<T>) => Promise<T>;
}) => Promise<void>) {
  const workers: Worker[] = [], gates: ReturnType<typeof gate>[] = [], pending: Promise<unknown>[] = []
  const suffix = randomUUID()
  const savedRenderer = process.env.ES_H5_ORDER_FULFILLMENT_TEST_RENDERER
  assert.notEqual(process.env.NODE_ENV, 'production', 'database fixtures must not run with NODE_ENV=production')
  process.env.ES_H5_ORDER_FULFILLMENT_TEST_RENDERER = '1'
  const worker = async (name: string) => { const value = await openWorker(name); workers.push(value); return value }
  const track = <T>(promise: Promise<T>) => { pending.push(promise); void promise.catch(() => {}); return promise }
  let admin: Worker | undefined
  try {
    admin = await worker('fixture')
    const observer = await worker('observer')
    // Scanner is global: refuse a reused/non-exclusive business test database.
    assert.equal(await admin.client.customerOrderFulfillmentIntent.count(), 0, 'dedicated empty business fixture database required')
    assert.equal(await admin.client.eshopTrayPrintJob.count(), 0, 'unrelated print jobs must not be present')
    const fixture = await createFixture(admin.client, suffix)
    await run({ fixture, admin, observer, worker, track, barrier: (name) => { const value = gate(name); gates.push(value); return value } })
  } finally {
    gates.forEach((value) => value.release())
    try {
      // Sessions have statement/transaction timeouts in addition to this join.
      await bounded(Promise.allSettled(pending), 'all started operations settled', TX_MS + 5_000)
      if (admin) await cleanupFixture(admin.client, `h5-tenant-${suffix}`)
    } finally {
      try { await Promise.all(workers.map((value) => value.close())) }
      finally {
        if (savedRenderer === undefined) delete process.env.ES_H5_ORDER_FULFILLMENT_TEST_RENDERER
        else process.env.ES_H5_ORDER_FULFILLMENT_TEST_RENDERER = savedRenderer
      }
    }
  }
}

async function kitchenIntent(client: PrismaClient, f: Fixture, presealed = true) {
  const intent = await client.$transaction((tx) => recordCustomerOrderIntent(tx as any, f.order, 'KITCHEN', 'REQUIRED', f.now))
  if (!presealed) return intent
  // Fixture preparation only. In particular this never writes printJobId.
  return client.customerOrderFulfillmentIntent.update({ where: { id: intent.id }, data: {
    state: 'PENDING', ...sealedBytes, renderProfileId: testProfileId, sealedAt: f.now,
  } })
}
const intentWhere = (f: Fixture) => ({ tenantId_storeId_orderNo_purpose: { tenantId: f.tenantId, storeId: f.storeId, orderNo: f.orderNo, purpose: 'KITCHEN_MAKE' as const } })
const jobWhere = (f: Fixture, key: string) => ({ tenantId_storeId_idempotencyKey: { tenantId: f.tenantId, storeId: f.storeId, idempotencyKey: key } })

async function exactJob(client: PrismaClient, f: Fixture, key: string, id?: string, source = 'CLOUD_H5', sentRequestHash?: string) {
  const job = await client.eshopTrayPrintJob.findUniqueOrThrow({ where: jobWhere(f, key) })
  if (id) assert.equal(job.id, id)
  assert.equal(job.tenantId, f.tenantId); assert.equal(job.storeId, f.storeId); assert.equal(job.schemaVersion, 3)
  const payload = parseV3PrintIntent(job.payload)
  assert.ok(payload && payload.payloadKind === 'RAW_BYTES')
  assert.equal(payload.orderNo, f.orderNo); assert.equal(payload.role, 'KITCHEN'); assert.equal(payload.source, source)
  assert.equal(payload.printJobId, key)
  // Compare to the actual H5 producer input (or captured reprint INSERT input),
  // never hash the jsonb-read object to "verify" the same ordering bug.
  const sent = customerOrderEnvelopeFromSeal(f.order, 'KITCHEN', sealedBytes)
  if (source !== 'CLOUD_H5') assert.ok(sentRequestHash, 'reprint INSERT evidence is required')
  assert.equal(job.requestHash, sentRequestHash ?? sha(JSON.stringify(sent)))
  assert.equal(payload.payloadBase64, sent.payloadBase64)
  const bytes = Buffer.from(payload.payloadBase64, 'base64')
  assert.equal(bytes.toString('base64'), payload.payloadBase64)
  assert.equal(payload.byteLength, bytes.length); assert.equal(payload.payloadHash, sha(bytes))
  return job
}
function assertWithdrawn(job: Awaited<ReturnType<typeof exactJob>>) {
  assert.equal(job.status, 'FAILED'); assert.equal(job.resultStatus, 'FAILED_NOT_CROSSED')
  assert.equal(job.effectBoundary, 'NOT_CROSSED'); assert.equal(job.resultCode, CANCEL_CODE)
  assert.equal(job.claimTokenHash, null); assert.equal(job.leaseExpiresAt, null)
  assert.equal(job.physicalCompletionKnown, false); assert.ok(job.completedAt)
}
async function queued(client: PrismaClient, f: Fixture) {
  const intent = await kitchenIntent(client, f)
  const result = await processCustomerOrderFulfillmentIntent(client as any, intent.id, new Date(), runtime)
  assert.equal(result.status, 'QUEUED'); assert.ok(result.printJobId)
  const job = await exactJob(client, f, intent.idempotencyKey, result.printJobId!)
  return { intent, job }
}

// Same transaction boundary as the route: status update + actual cancellation
// function + Intent/job updates on the very same tx client. No hand-written SQL
// performs business transitions or associations in these tests.
async function cancelRouteTransaction(db: PrismaClient, f: Fixture) {
  return db.$transaction(async (tx) => {
    const changed = await tx.customerOrder.updateMany({ where: { id: f.orderId, tenantId: f.tenantId, storeId: f.storeId, status: 'CONFIRMED' }, data: { status: 'CANCELLED' } })
    assert.equal(changed.count, 1)
    return cancelCustomerOrderKitchenIntent(tx as any, f.order, new Date())
  })
}
async function assertCancelled(client: PrismaClient, f: Fixture, code: string, jobId: string | null) {
  const order = await client.customerOrder.findFirstOrThrow({ where: { id: f.orderId, tenantId: f.tenantId, storeId: f.storeId } })
  assert.equal(order.status, 'CANCELLED')
  const intent = await client.customerOrderFulfillmentIntent.findUniqueOrThrow({ where: intentWhere(f) })
  assert.equal(intent.state, 'CANCELLED'); assert.equal(intent.cancelResultCode, code); assert.equal(intent.printJobId, jobId)
  const repeated = await client.$transaction((tx) => cancelCustomerOrderKitchenIntent(tx as any, f.order, new Date()))
  assert.deepEqual(repeated, { kind: 'CANCELLED', code })
  return intent
}
const orderUpdate = (f: Fixture) => (event: Event) => event.model === 'customerOrder' && event.method === 'updateMany' && event.args[0].where.id === f.orderId
const orderLock = (f: Fixture) => (event: Event) => event.model === '$raw' && event.method === '$queryRaw'
  && tableStatement('CustomerOrder', 'FROM').test(rawSql(event)) && /FOR UPDATE/i.test(rawSql(event))
  && [f.tenantId, f.storeId, f.orderNo].every((value) => event.args.slice(1).includes(value))
const jobUpdate = (id: string) => (event: Event) => event.model === 'eshopTrayPrintJob' && event.method === 'updateMany' && event.args[0].where.id === id
const claim = (db: PrismaClient, f: Fixture) => deliverV3PrintIntent(db as any, { tenantId: f.tenantId, storeId: f.storeId, deviceId: f.deviceId, batchId: f.batchId, role: 'KITCHEN' })

for (const first of ['create', 'cancel'] as const) {
  test(`DB create/cancel: ${first} holds the order lock first`, { skip: skipReason, timeout: 90_000 }, async () => withFixture(async (h) => {
    const { fixture: f, admin, observer } = h
    // PRESEAL THE ACTUAL RACE FIXTURE, not the duplicate-recovery fixture.
    const intent = await kitchenIntent(admin.client, f, true)
    assert.ok(intent.sealedAt); assert.equal(intent.state, 'PENDING'); assert.equal(intent.printJobId, null)
    const creator = await h.worker('creator'), canceller = await h.worker('canceller')
    if (first === 'create') {
      const holder = await h.worker('intent-barrier'), barrier = h.barrier('intent row held')
      const holding = h.track(holder.client.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "CustomerOrderFulfillmentIntent" WHERE "id" = ${intent.id} FOR UPDATE`
        assert.equal(rows[0]?.id, intent.id)
        await barrier.pause()
      }))
      await barrier.entered()
      const creating = h.track(processCustomerOrderFulfillmentIntent(creator.db as any, intent.id, new Date(), runtime))
      const attempt = await waitForBlockedBy(observer, creator, holder, tableStatement('CustomerOrderFulfillmentIntent', 'UPDATE'),
        (event) => event.model === 'customerOrderFulfillmentIntent' && event.method === 'updateMany'
          && event.args[0].where.id === intent.id && event.args[0].data.attemptCount?.increment === 1)
      assert.ok(creator.events.some((event) => event.tx === attempt.tx && event.phase === 'after' && orderLock(f)(event)))
      assert.equal(creator.events.filter((event) => event.phase === 'after' && orderLock(f)(event)).length, 1, 'presealed fixture enters only the job creation transaction')
      const cancelling = h.track(cancelRouteTransaction(canceller.db, f))
      await waitForBlockedBy(observer, canceller, creator, tableStatement('CustomerOrder', 'UPDATE'), orderUpdate(f))
      barrier.release()
      await holding
      const created = await creating
      assert.equal(created.status, 'QUEUED'); assert.equal(created.created, true)
      assert.deepEqual(await cancelling, { kind: 'CANCELLED', code: CANCEL_CODE })
      assertWithdrawn(await exactJob(admin.client, f, intent.idempotencyKey, created.printJobId!))
      await assertCancelled(admin.client, f, CANCEL_CODE, created.printJobId!)
      assert.deepEqual(await claim(admin.client, f), { ok: true, job: null })
      assertWithdrawn(await exactJob(admin.client, f, intent.idempotencyKey, created.printJobId!))
    } else {
      const barrier = h.barrier('cancel owns order')
      canceller.setHook(async (event) => { if (event.phase === 'after' && orderUpdate(f)(event)) { assert.equal(event.result.count, 1); await barrier.pause() } })
      const cancelling = h.track(cancelRouteTransaction(canceller.db, f))
      await barrier.entered()
      const creating = h.track(processCustomerOrderFulfillmentIntent(creator.db as any, intent.id, new Date(), runtime))
      await waitForBlockedBy(observer, creator, canceller, tableStatement('CustomerOrder', 'FROM'), orderLock(f))
      barrier.release()
      assert.deepEqual(await cancelling, { kind: 'CANCELLED', code: CANCEL_CODE })
      const result = await creating
      assert.equal(result.status, 'MANUAL_REVIEW'); assert.equal(result.created, false); assert.equal(result.printJobId, null)
      await assertCancelled(admin.client, f, CANCEL_CODE, null)
      assert.equal(await admin.client.eshopTrayPrintJob.count({ where: { tenantId: f.tenantId, storeId: f.storeId, idempotencyKey: intent.idempotencyKey } }), 0)
    }
  }))
}

for (const first of ['claim', 'cancel'] as const) {
  test(`DB claim/cancel: ${first} updates the target job first`, { skip: skipReason, timeout: 90_000 }, async () => withFixture(async (h) => {
    const { fixture: f, admin, observer } = h
    const { intent, job } = await queued(admin.client, f)
    const claimant = await h.worker('claimant'), canceller = await h.worker('canceller')
    const barrier = h.barrier(`${first} owns target job`)
    const leader = first === 'claim' ? claimant : canceller
    leader.setHook(async (event) => { if (event.phase === 'after' && jobUpdate(job.id)(event)) { assert.equal(event.result.count, 1); await barrier.pause() } })
    if (first === 'claim') {
      const claiming = h.track(claim(claimant.db, f))
      await barrier.entered()
      const cancelling = h.track(cancelRouteTransaction(canceller.db, f))
      await waitForBlockedBy(observer, canceller, claimant, tableStatement('EshopTrayPrintJob', 'UPDATE'), jobUpdate(job.id))
      barrier.release()
      const delivery = await claiming
      assert.equal(delivery.ok, true); assert.ok(delivery.job); assert.equal(delivery.job.id, job.id)
      assert.equal(delivery.job.printJobId, intent.idempotencyKey)
      assert.deepEqual(await cancelling, { kind: 'CANCELLED', code: 'V3_CANCEL_MANUAL_REVIEW' })
      const final = await exactJob(admin.client, f, intent.idempotencyKey, job.id)
      assert.equal(final.status, 'PENDING'); assert.match(final.claimTokenHash ?? '', /^[0-9a-f]{64}$/)
      assert.equal(final.claimAttempt, 1); assert.ok(final.leaseExpiresAt)
      assert.equal(final.resultStatus, null); assert.equal(final.completedAt, null)
      await assertCancelled(admin.client, f, 'V3_CANCEL_MANUAL_REVIEW', job.id)
    } else {
      const cancelling = h.track(cancelRouteTransaction(canceller.db, f))
      await barrier.entered()
      const claiming = h.track(claim(claimant.db, f))
      await waitForBlockedBy(observer, claimant, canceller, tableStatement('EshopTrayPrintJob', 'UPDATE'), jobUpdate(job.id))
      barrier.release()
      assert.deepEqual(await cancelling, { kind: 'CANCELLED', code: CANCEL_CODE })
      assert.deepEqual(await claiming, { ok: false, code: 'V3_DELIVERY_RACE' })
      assertWithdrawn(await exactJob(admin.client, f, intent.idempotencyKey, job.id))
      await assertCancelled(admin.client, f, CANCEL_CODE, job.id)
    }
  }))
}

for (const first of ['reprint', 'cancel'] as const) {
  test(`DB reprint/cancel: ${first} holds the actual order lock first`, { skip: skipReason, timeout: 90_000 }, async () => withFixture(async (h) => {
    const { fixture: f, admin, observer } = h
    const { intent, job } = await queued(admin.client, f)
    // Establish the original result through the real claim/report protocol,
    // including its provenance. CROSSED is not proof of physical completion.
    const delivered = await claim(admin.client, f)
    assert.equal(delivered.ok, true)
    if (!delivered.ok || !delivered.job) throw new Error('original kitchen job must be delivered')
    assert.equal(delivered.job.id, job.id)
    assert.equal(delivered.job.printJobId, intent.idempotencyKey)
    const claimed = await exactJob(admin.client, f, intent.idempotencyKey, job.id)
    assert.match(claimed.claimTokenHash ?? '', /^[0-9a-f]{64}$/)
    assert.equal(claimed.claimAttempt, 1)
    const executionId = `db-proof-${randomUUID()}`
    assert.deepEqual(await reportV3Execution(admin.client as any, {
      tenantId: f.tenantId, storeId: f.storeId, deviceId: f.deviceId, batchId: f.batchId,
    }, { printJobId: intent.idempotencyKey, source: 'CLOUD_H5', role: 'KITCHEN',
      executionId, ownerEpoch: 1, reportVersion: 1, outcome: 'CROSSED' }), { ok: true, acknowledged: true })
    const reported = await exactJob(admin.client, f, intent.idempotencyKey, job.id)
    assert.equal(reported.status, 'SUCCEEDED'); assert.equal(reported.resultStatus, 'CROSSED')
    assert.equal(reported.effectBoundary, 'CROSSED')
    assert.equal(reported.resultCode, `V3:${executionId}:1:1:CROSSED`)
    assert.equal(reported.physicalCompletionKnown, false)
    assert.ok(reported.completedAt)
    assert.equal(reported.claimTokenHash, null); assert.equal(reported.leaseExpiresAt, null)
    const payload = parseV3PrintIntent(job.payload)
    assert.ok(payload && payload.payloadKind === 'RAW_BYTES')
    const request = { schemaVersion: 3 as const, requestId: `v3-reprint:kitchen:${randomUUID()}`, orderNo: f.orderNo,
      role: 'KITCHEN' as const, confirmation: 'OPERATOR_CONFIRMED' as const, rendererVersion: 'reprint-raw-v1' as const,
      commandStream: { encoding: 'base64' as const, byteLength: payload.byteLength, sha256: payload.payloadHash, data: payload.payloadBase64 } }
    const reprint = (db: PrismaClient) => enqueueV3ManualReprintWithDb(db, { tenantId: f.tenantId, storeId: f.storeId }, { kind: 'ACCOUNT', userId: f.operator.id, role: 'OWNER' }, request)
    const printer = await h.worker('reprinter'), canceller = await h.worker('canceller')
    const barrier = h.barrier(`${first} owns real order lock`)
    if (first === 'reprint') {
      printer.setHook(async (event) => { if (event.phase === 'after' && orderLock(f)(event)) { assert.equal(event.result[0]?.id, f.orderId); await barrier.pause() } })
      const printing = h.track(reprint(printer.db))
      await barrier.entered()
      const cancelling = h.track(cancelRouteTransaction(canceller.db, f))
      await waitForBlockedBy(observer, canceller, printer, tableStatement('CustomerOrder', 'UPDATE'), orderUpdate(f))
      barrier.release()
      const created = await printing
      assert.equal(created.created, true); assert.equal(created.requestId, request.requestId)
      assert.deepEqual(await cancelling, { kind: 'CANCELLED', code: 'V3_CANCEL_MANUAL_REVIEW' })
      const insert = printer.events.find((event) => event.phase === 'before' && event.model === 'eshopTrayPrintJob'
        && event.method === 'create' && event.args[0].data.idempotencyKey === request.requestId)
      assert.ok(insert)
      assertWithdrawn(await exactJob(admin.client, f, request.requestId, created.jobId, 'CLOUD_REMOTE_REPRINT', insert.args[0].data.requestHash))
    } else {
      canceller.setHook(async (event) => { if (event.phase === 'after' && orderUpdate(f)(event)) { assert.equal(event.result.count, 1); await barrier.pause() } })
      const cancelling = h.track(cancelRouteTransaction(canceller.db, f))
      await barrier.entered()
      const printing = h.track(reprint(printer.db))
      await waitForBlockedBy(observer, printer, canceller, tableStatement('CustomerOrder', 'FROM'), orderLock(f))
      barrier.release()
      assert.deepEqual(await cancelling, { kind: 'CANCELLED', code: 'V3_CANCEL_MANUAL_REVIEW' })
      // The raw transaction still proves the real 40001 rollback; the public
      // function now maps that structured P2010 to its existing 409 contract.
      await assert.rejects(printing, (error: any) => {
        assert.ok(error instanceof V3ReprintError)
        assert.equal(error.code, 'V3_REPRINT_CONCURRENT_STATE_CHANGE')
        assert.equal(error.status, 409)
        return true
      })
      assert.equal(printer.transactionErrors.filter((error) => error.code === 'P2010').length, 1)
      const conflict = printer.transactionErrors.find((error) => error.code === 'P2010')
      assert.equal(conflict.meta?.driverAdapterError?.cause?.originalCode, '40001')
      await assert.rejects(reprint(admin.client), { code: 'V3_REPRINT_CANCELLED_H5_KITCHEN_FORBIDDEN' })
      assert.equal(await admin.client.eshopTrayPrintJob.count({ where: { tenantId: f.tenantId, storeId: f.storeId, idempotencyKey: request.requestId } }), 0)
    }
    await assertCancelled(admin.client, f, 'V3_CANCEL_MANUAL_REVIEW', job.id)
    assert.equal(await admin.client.operationLog.count({ where: {
      tenantId: f.tenantId, storeId: f.storeId, requestId: request.requestId,
      actionType: 'V3_PRINT_MANUAL_REPRINT_REQUESTED',
    } }), first === 'reprint' ? 1 : 0)
    const original = await exactJob(admin.client, f, intent.idempotencyKey, job.id)
    assert.equal(original.status, 'SUCCEEDED'); assert.equal(original.resultStatus, 'CROSSED')
    assert.equal(original.physicalCompletionKnown, false)
    assert.equal(await admin.client.eshopTrayPrintJob.count({ where: {
      tenantId: f.tenantId, storeId: f.storeId, schemaVersion: 3, status: 'PENDING', claimTokenHash: null,
      AND: [{ payload: { path: ['source'], equals: 'CLOUD_REMOTE_REPRINT' } }, { payload: { path: ['orderNo'], equals: f.orderNo } }, { payload: { path: ['role'], equals: 'KITCHEN' } }],
    } }), 0, 'no reliably associated unclaimed reprint remains after cancellation')
  }))
}

for (const collision of ['matching', 'different-role', 'different-order', 'different-version', 'different-bytes'] as const) {
  test(`DB real unique conflict rolls back; process() recovers ${collision}`, { skip: skipReason, timeout: 90_000 }, async () => withFixture(async (h) => {
    const { fixture: f, admin, observer } = h
    const intent = await kitchenIntent(admin.client, f, true)
    const holder = await h.worker('uncommitted-writer'), creator = await h.worker('creator')
    const barrier = h.barrier('same-key insert exists but is uncommitted')
    const payload = customerOrderEnvelopeFromSeal(f.order, 'KITCHEN', sealedBytes)
    const bytes = Buffer.from('different sealed receipt fixture')
    const winnerPayload = collision === 'different-role' ? { ...payload, role: 'FRONT' as const }
      : collision === 'different-order' ? { ...payload, orderNo: `${f.orderNo}-other` }
      : collision === 'different-version' ? { ...payload, rendererVersion: 'different-renderer' }
      : collision === 'different-bytes' ? { ...payload, payloadBase64: bytes.toString('base64'), byteLength: bytes.length, payloadHash: sha(bytes) } : payload
    const inserted = h.track(holder.db.$transaction(async (tx) => {
      const result = await enqueueV3PrintIntent(tx as any, { tenantId: f.tenantId, storeId: f.storeId }, winnerPayload, intent.deadlineAt, { idempotencyConflict: 'THROW' })
      assert.equal(result.created, true)
      await barrier.pause()
      return result.job
    }))
    await barrier.entered()
    const processing = h.track(processCustomerOrderFulfillmentIntent(creator.db as any, intent.id, new Date(), runtime))
    const insertEvent = await waitForBlockedBy(observer, creator, holder, tableStatement('EshopTrayPrintJob', 'INSERT INTO'),
      (event) => event.model === 'eshopTrayPrintJob' && event.method === 'create' && event.args[0].data.idempotencyKey === intent.idempotencyKey
        && event.args[0].data.tenantId === f.tenantId && event.args[0].data.storeId === f.storeId)
    assert.ok(creator.events.some((event) => event.tx === insertEvent.tx && event.phase === 'after'
      && event.model === 'customerOrderFulfillmentIntent' && event.args[0]?.data?.attemptCount?.increment === 1 && event.result.count === 1))
    barrier.release()
    const winner = await inserted
    const persisted = await admin.client.eshopTrayPrintJob.findUniqueOrThrow({ where: jobWhere(f, intent.idempotencyKey) })
    const type = await admin.client.$queryRaw<Array<{ type: string }>>`SELECT pg_typeof("payload")::text AS "type" FROM "EshopTrayPrintJob" WHERE "id" = ${winner.id}`
    assert.equal(type[0]?.type, 'jsonb')
    assert.deepEqual(persisted.payload, winnerPayload, 'jsonb read keeps semantics')
    assert.notEqual(JSON.stringify(persisted.payload), JSON.stringify(winnerPayload), 'exercise actual jsonb key-order normalization')
    const failure = await processing
    assert.equal(failure.status, 'FAILED'); assert.equal(failure.created, false); assert.equal(failure.printJobId, null)
    assert.equal(creator.transactionErrors.filter((error) => error.code === 'P2002').length, 1, 'actual service creation transaction must hit P2002')
    const rolledBack = await admin.client.customerOrderFulfillmentIntent.findUniqueOrThrow({ where: intentWhere(f) })
    assert.equal(rolledBack.printJobId, null); assert.equal(rolledBack.attemptCount, 0, 'attempt increment rolled back with failed INSERT')
    assert.equal(rolledBack.revision, intent.revision + 1, 'only the post-rollback failure update committed')
    assert.equal(rolledBack.state, 'FAILED_RETRYABLE'); assert.ok(rolledBack.lastErrorAt); assert.ok(rolledBack.lastErrorCode)
    assert.ok(rolledBack.nextAttemptAt > intent.nextAttemptAt)
    assert.equal(await admin.client.eshopTrayPrintJob.count({ where: { tenantId: f.tenantId, storeId: f.storeId, idempotencyKey: intent.idempotencyKey } }), 1)
    // Only the production service may associate the winner. The test never
    // writes printJobId or recreates the service's association transaction.
    const recovery = await processCustomerOrderFulfillmentIntent(creator.db as any, intent.id, new Date(), runtime)
    const after = await admin.client.customerOrderFulfillmentIntent.findUniqueOrThrow({ where: intentWhere(f) })
    if (collision === 'matching') {
      assert.deepEqual(recovery, { status: 'ALREADY_PRESENT', created: false, printJobId: winner.id })
      assert.equal(after.state, 'ENQUEUED'); assert.equal(after.printJobId, winner.id); assert.equal(after.attemptCount, 0)
      const stored = await exactJob(admin.client, f, intent.idempotencyKey, winner.id)
      assert.equal(stored.requestHash, sha(JSON.stringify(payload)), 'hash of the original producer input, before jsonb roundtrip')
      assert.equal(after.payloadHash, payload.payloadHash); assert.equal(after.rendererVersion, payload.rendererVersion)
      assert.deepEqual(await processCustomerOrderFulfillmentIntent(creator.db as any, intent.id, new Date(), runtime), recovery)
    } else {
      assert.equal(recovery.status, 'MANUAL_REVIEW'); assert.equal(recovery.created, false); assert.equal(recovery.printJobId, null)
      assert.equal(recovery.error, 'CUSTOMER_ORDER_EXISTING_JOB_IDENTITY_MISMATCH')
      assert.equal(after.state, 'MANUAL_REVIEW'); assert.equal(after.manualReviewReason, recovery.error); assert.equal(after.printJobId, null)
      assert.equal(after.attemptCount, 0)
    }
  }))
}

for (const failure of ['raw-sql', 'insert-length'] as const) {
test(`DB B: ${failure} abort rolls back creation, persists progressive retry counts, and stops at 12`, { skip: skipReason, timeout: 90_000 }, async () => withFixture(async (h) => {
  const { fixture: f, admin } = h
  const intent = await kitchenIntent(admin.client, f, true)
  const creator = await h.worker('sql-failure-creator')
  let injections = 0
  creator.setHook(async (event, tx) => {
    if (event.phase === 'before' && event.model === 'eshopTrayPrintJob' && event.method === 'create') {
      assert.equal(event.args[0].data.idempotencyKey, intent.idempotencyKey)
      assert.equal(event.args[0].data.tenantId, f.tenantId)
      injections += 1
      // Both faults use real SQL in the actual creation transaction after its
      // provisional count update. The length fault reaches the real INSERT.
      if (failure === 'raw-sql') await tx.$queryRaw`SELECT 1 / 0`
      else event.args[0].data.requestHash = 'f'.repeat(65) // PostgreSQL CHAR(64) -> 22001 / Prisma P2000.
    }
  })
  for (let count = 1; count <= 12; count += 1) {
    // Fixture time eligibility only: preserve fixed deadline, revision/count,
    // and every failure-accounting write performed by the production service.
    await admin.client.customerOrderFulfillmentIntent.update({ where: { id: intent.id }, data: { nextAttemptAt: new Date(0) } })
    const before = await admin.client.customerOrderFulfillmentIntent.findUniqueOrThrow({ where: intentWhere(f) })
    const result = await processCustomerOrderFulfillmentIntent(creator.db as any, intent.id, new Date(), runtime)
    const after = await admin.client.customerOrderFulfillmentIntent.findUniqueOrThrow({ where: intentWhere(f) })
    assert.equal(after.attemptCount, count)
    assert.equal(after.revision, before.revision + 1, 'provisional increment rolled back; only fresh failure transaction committed')
    assert.equal(after.state, count === 12 ? 'MANUAL_REVIEW' : 'FAILED_RETRYABLE')
    assert.equal(result.status, count === 12 ? 'MANUAL_REVIEW' : 'FAILED')
    assert.equal(after.printJobId, null); assert.ok(after.lastErrorAt)
    assert.equal(after.deadlineAt.getTime(), intent.deadlineAt.getTime())
    const delay = Math.min(30 * 60_000, 60_000 * 2 ** (count - 1))
    assert.equal(after.nextAttemptAt.getTime(), Math.min(after.deadlineAt.getTime(), after.lastErrorAt.getTime() + delay))
    assert.equal(await admin.client.eshopTrayPrintJob.count({ where: { tenantId: f.tenantId, storeId: f.storeId, idempotencyKey: intent.idempotencyKey } }), 0)
    assert.equal(creator.transactionErrors.filter((error) => failure === 'insert-length' ? error.code === 'P2000'
      : error.code === 'P2010' && error.meta?.driverAdapterError?.cause?.originalCode === '22012').length, count)
  }
  assert.equal((await processCustomerOrderFulfillmentIntent(creator.db as any, intent.id, new Date(), runtime)).status, 'MANUAL_REVIEW')
  assert.equal(injections, 12)
  const final = await admin.client.customerOrderFulfillmentIntent.findUniqueOrThrow({ where: intentWhere(f) })
  assert.equal(final.manualReviewReason, 'CUSTOMER_ORDER_PRINT_ATTEMPTS_EXHAUSTED')
}))
}

test('DB business cancellation failure rolls back order, job and Intent together', { skip: skipReason, timeout: 60_000 }, async () => withFixture(async (h) => {
  const { fixture: f, admin } = h
  const { intent, job } = await queued(admin.client, f)
  await assert.rejects(admin.client.$transaction(async (tx) => {
    assert.equal((await tx.customerOrder.updateMany({ where: { id: f.orderId, tenantId: f.tenantId, storeId: f.storeId, status: 'CONFIRMED' }, data: { status: 'CANCELLED' } })).count, 1)
    assert.deepEqual(await cancelCustomerOrderKitchenIntent(tx as any, f.order, new Date()), { kind: 'CANCELLED', code: CANCEL_CODE })
    throw new Error('rollback after real cancellation')
  }), /rollback after real cancellation/)
  assert.equal((await admin.client.customerOrder.findUniqueOrThrow({ where: { id: f.orderId } })).status, 'CONFIRMED')
  const final = await exactJob(admin.client, f, intent.idempotencyKey, job.id)
  assert.equal(final.status, 'PENDING'); assert.equal(final.resultCode, null); assert.equal(final.completedAt, null)
  const restored = await admin.client.customerOrderFulfillmentIntent.findUniqueOrThrow({ where: intentWhere(f) })
  assert.equal(restored.state, 'ENQUEUED'); assert.equal(restored.printJobId, job.id); assert.equal(restored.cancelResultCode, null)
}))

test('DB >1000 pending records advance across independent scans without omissions', { skip: skipReason, timeout: 180_000 }, async (t) => withFixture(async (h) => {
  const { fixture: f, admin } = h
  const count = 1005, now = f.now
  const orders = Array.from({ length: count }, (_, index) => ({
    id: `${f.orderId}-${index}`, tenantId: f.tenantId, storeId: f.storeId, storeCode: `H5DB${f.tenantId}`,
    orderNo: `${f.orderNo}-${String(index).padStart(4, '0')}`, itemsJson: JSON.stringify(f.order.items),
    totalAmount: '4.50', status: 'CONFIRMED', paymentStatus: 'UNPAID', createdAt: now,
  }))
  await admin.client.customerOrder.createMany({ data: orders })
  await admin.client.customerOrderFulfillmentIntent.createMany({ data: orders.map((order) => intentCreateData({ order: { ...f.order, orderNo: order.orderNo }, role: 'KITCHEN', decision: 'REQUIRED', now })) })
  const first = await runCustomerOrderFulfillmentRecovery(admin.client as any, now)
  assert.equal(first.ok, true); assert.equal(first.summary.scanned, 1000); assert.equal(first.summary.pages, 10)
  const firstIds = new Set((await admin.client.customerOrderFulfillmentIntent.findMany({ where: { tenantId: f.tenantId, lastRecoverySweepAt: { not: null } }, select: { id: true } })).map((row) => row.id))
  assert.equal(firstIds.size, 1000)
  const beforeSecond = await admin.client.customerOrderFulfillmentIntent.findMany({ where: { tenantId: f.tenantId }, select: { id: true, revision: true } })
  const second = await runCustomerOrderFulfillmentRecovery(admin.client as any, now)
  assert.equal(second.ok, true); assert.equal(second.summary.scanned, 5); assert.equal(second.summary.pages, 1)
  const after = await admin.client.customerOrderFulfillmentIntent.findMany({ where: { tenantId: f.tenantId } })
  const beforeRevisions = new Map(beforeSecond.map((row) => [row.id, row.revision]))
  const secondIds = new Set(after.filter((row) => row.revision !== beforeRevisions.get(row.id)).map((row) => row.id))
  assert.equal(secondIds.size, 5); assert.equal([...secondIds].filter((id) => firstIds.has(id)).length, 0)
  assert.equal(new Set([...firstIds, ...secondIds]).size, count)
  assert.equal(after.filter((row) => row.nextAttemptAt <= now || !row.lastRecoverySweepAt).length, 0)
  assert.equal(after.every((row) => row.attemptCount === 0 && row.printJobId === null), true)
  t.diagnostic('database scan accounting: unique=1005, duplicate=0, omitted=0; first=1000, second=5')
}))

const renderOwner = (f: Fixture, id = 'owner-a'): RenderWorker => ({ workerId: id, tenantId: f.tenantId, storeId: f.storeId,
  roles: ['KITCHEN'], profileId: testProfileId, credentialSha256: sha('isolated-only-not-a-service-credential') })

test('DB render: same-owner consumers reserve at most one Intent while the owner lock is held', { skip: skipReason, timeout: 90_000 }, async () => withFixture(async h => {
  const { fixture: f, admin } = h
  const intent = await kitchenIntent(admin.client, f, false), a = await h.worker('render-a'), b = await h.worker('render-b')
  const barrier = h.barrier('first render owner acquired')
  a.setHook(async e => { if (e.phase === 'after' && e.model === '$raw' && rawSql(e).includes('pg_try_advisory_xact_lock') && e.result[0]?.acquired) await barrier.pause() })
  const first = h.track(claimCustomerOrderRender(a.db as any, renderOwner(f), runtime))
  await barrier.entered()
  assert.equal((await claimCustomerOrderRender(b.db as any, renderOwner(f), runtime)).kind, 'BUSY')
  barrier.release()
  const claimed = await first
  assert.equal(claimed.kind, 'CLAIMED')
  const row = await admin.client.customerOrderFulfillmentIntent.findUniqueOrThrow({ where: { id: intent.id } })
  assert.equal(row.renderAttemptCount, 1); assert.equal(row.attemptCount, 0); assert.equal(row.renderLeaseTokenHash, sha(claimed.claim.token))
  assert.equal((await claimCustomerOrderRender(b.db as any, renderOwner(f), runtime)).kind, 'IDLE')
}))

test('DB render: distinct owners skip a locked order without double-claiming it', { skip: skipReason, timeout: 90_000 }, async () => withFixture(async h => {
  const { fixture: f, admin } = h
  const intent = await kitchenIntent(admin.client, f, false), a = await h.worker('render-a'), b = await h.worker('render-b')
  const barrier = h.barrier('renderer owns order')
  a.setHook(async e => { if (e.phase === 'after' && orderLock(f)(e)) await barrier.pause() })
  const first = h.track(claimCustomerOrderRender(a.db as any, renderOwner(f), runtime))
  await barrier.entered()
  assert.equal((await claimCustomerOrderRender(b.db as any, renderOwner(f, 'owner-b'), runtime)).kind, 'IDLE')
  barrier.release()
  assert.equal((await first).kind, 'CLAIMED')
  const row = await admin.client.customerOrderFulfillmentIntent.findUniqueOrThrow({ where: { id: intent.id } })
  assert.equal(row.renderLeaseOwnerId, 'owner-a'); assert.equal(row.renderAttemptCount, 1)
}))

for (const first of ['seal', 'cancel'] as const) {
  test(`DB render seal/cancel: ${first} owns order first; no late result can revive cancellation`, { skip: skipReason, timeout: 90_000 }, async () => withFixture(async h => {
    const { fixture: f, admin, observer } = h
    const intent = await kitchenIntent(admin.client, f, false), owner = renderOwner(f)
    const claimed = await claimCustomerOrderRender(admin.client as any, owner, runtime)
    assert.equal(claimed.kind, 'CLAIMED')
    const reply = { ...claimed.claim, ...sealedBytes }, sealer = await h.worker('sealer'), canceller = await h.worker('cancel-render')
    const barrier = h.barrier(`${first} holds order`)
    if (first === 'seal') {
      sealer.setHook(async e => { if (e.phase === 'after' && orderLock(f)(e)) await barrier.pause() })
      const sealing = h.track(sealCustomerOrderRender(sealer.db as any, owner, reply, runtime))
      await barrier.entered()
      const cancelling = h.track(cancelRouteTransaction(canceller.db, f))
      await waitForBlockedBy(observer, canceller, sealer, tableStatement('CustomerOrder', 'UPDATE'), orderUpdate(f))
      barrier.release()
      assert.equal((await sealing).kind, 'SEALED'); assert.deepEqual(await cancelling, { kind: 'CANCELLED', code: CANCEL_CODE })
    } else {
      canceller.setHook(async e => { if (e.phase === 'after' && orderUpdate(f)(e)) await barrier.pause() })
      const cancelling = h.track(cancelRouteTransaction(canceller.db, f))
      await barrier.entered()
      const sealing = h.track(sealCustomerOrderRender(sealer.db as any, owner, reply, runtime))
      await waitForBlockedBy(observer, sealer, canceller, tableStatement('CustomerOrder', 'FROM'), orderLock(f))
      barrier.release()
      assert.deepEqual(await cancelling, { kind: 'CANCELLED', code: CANCEL_CODE }); assert.equal((await sealing).kind, 'TERMINAL')
    }
    const row = await assertCancelled(admin.client, f, CANCEL_CODE, null)
    assert.equal(Boolean(row.sealedAt), first === 'seal'); assert.equal(row.renderLeaseTokenHash, null)
    assert.equal((await sealCustomerOrderRender(admin.client as any, owner, reply, runtime)).kind, 'TERMINAL')
    assert.equal((await failCustomerOrderRender(admin.client as any, owner, { ...claimed.claim, code: 'RENDER_FAILED' }, runtime)).kind, 'STALE')
    assert.equal(await admin.client.eshopTrayPrintJob.count({ where: jobWhere(f, intent.idempotencyKey).tenantId_storeId_idempotencyKey }), 0)
  }))
}

test('DB render: committed seal survives controller restart; existing V3 bytes associate once', { skip: skipReason, timeout: 90_000 }, async () => withFixture(async h => {
  const { fixture: f, admin } = h
  const intent = await kitchenIntent(admin.client, f, false), owner = renderOwner(f)
  const claim = (await claimCustomerOrderRender(admin.client as any, owner, runtime)).claim
  assert.ok(claim)
  assert.equal((await sealCustomerOrderRender(admin.client as any, owner, { ...claim, ...sealedBytes }, runtime)).kind, 'SEALED')
  const restarted = await h.worker('restarted-controller')
  await claimCustomerOrderRender(restarted.db as any, owner, runtime)
  const row = await admin.client.customerOrderFulfillmentIntent.findUniqueOrThrow({ where: { id: intent.id } })
  assert.equal(row.state, 'ENQUEUED'); assert.equal(row.attemptCount, 1); assert.equal(row.renderAttemptCount, 1); assert.ok(row.printJobId)
  const job = await exactJob(admin.client, f, intent.idempotencyKey, row.printJobId!)
  assert.equal(job.expiresAt.getTime(), intent.deadlineAt.getTime())
  assert.equal((await sealCustomerOrderRender(admin.client as any, owner, { ...claim, ...sealedBytes }, runtime)).kind, 'ALREADY_SEALED')
  assert.equal(await admin.client.eshopTrayPrintJob.count({ where: jobWhere(f, intent.idempotencyKey).tenantId_storeId_idempotencyKey }), 1)
}))

test('DB render: lost claim, failure, late token and exhausted budget persist separately from job attempts', { skip: skipReason, timeout: 90_000 }, async () => withFixture(async h => {
  const { fixture: f, admin } = h
  const intent = await kitchenIntent(admin.client, f, false), owner = renderOwner(f)
  let now = new Date(), prior: any
  const clock = { ...runtime, now: () => now }
  for (let n = 1; n <= 3; n++) {
    const claimed = await claimCustomerOrderRender(admin.client as any, owner, clock)
    assert.equal(claimed.kind, 'CLAIMED')
    if (prior) assert.equal((await sealCustomerOrderRender(admin.client as any, owner, { ...prior, ...sealedBytes }, clock)).kind, 'STALE')
    prior = claimed.claim
    now = new Date(+now + 60_001)
    await claimCustomerOrderRender(admin.client as any, owner, clock)
    const row = await admin.client.customerOrderFulfillmentIntent.findUniqueOrThrow({ where: { id: intent.id } })
    assert.equal(row.renderAttemptCount, n); assert.equal(row.attemptCount, 0); assert.equal(row.renderLeaseTokenHash, null)
    assert.equal(row.state, n === 3 ? 'MANUAL_REVIEW' : 'FAILED_RETRYABLE')
    now = new Date(+row.nextAttemptAt + 1)
  }
  assert.equal(await admin.client.eshopTrayPrintJob.count({ where: jobWhere(f, intent.idempotencyKey).tenantId_storeId_idempotencyKey }), 0)
}))

test('DB render: conditional seal failure rolls back bytes, revision and reservation', { skip: skipReason, timeout: 90_000 }, async () => withFixture(async h => {
  const { fixture: f, admin } = h
  const intent = await kitchenIntent(admin.client, f, false), owner = renderOwner(f)
  const claimed = await claimCustomerOrderRender(admin.client as any, owner, runtime), sealer = await h.worker('failed-sealer')
  const before = await admin.client.customerOrderFulfillmentIntent.findUniqueOrThrow({ where: { id: intent.id } })
  sealer.setHook(async (e, tx) => { if (e.phase === 'after' && e.model === 'customerOrderFulfillmentIntent' && e.method === 'updateMany' && e.args[0].data.sealedAt) await tx.$executeRaw`SELECT 1/0` })
  await assert.rejects(sealCustomerOrderRender(sealer.db as any, owner, { ...claimed.claim, ...sealedBytes }, runtime))
  assert.deepEqual(await admin.client.customerOrderFulfillmentIntent.findUniqueOrThrow({ where: { id: intent.id } }), before)
  assert.equal((await sealCustomerOrderRender(admin.client as any, owner, { ...claimed.claim, ...sealedBytes }, runtime)).kind, 'SEALED')
}))

test('DB render: >1000 unreleased intents and one corrupt snapshot progress across bounded claims', { skip: skipReason, timeout: 180_000 }, async (t) => withFixture(async h => {
  const { fixture: f, admin } = h, count = 1005
  const orders = Array.from({ length: count }, (_, n) => ({ id: `${f.orderId}-${n}`, tenantId: f.tenantId, storeId: f.storeId,
    storeCode: `H5DB${f.tenantId}`, orderNo: `${f.orderNo}-${n}`, itemsJson: JSON.stringify(f.order.items), totalAmount: '4.50', status: 'CONFIRMED', paymentStatus: 'UNPAID', createdAt: f.now }))
  await admin.client.customerOrder.createMany({ data: orders })
  await admin.client.customerOrderFulfillmentIntent.createMany({ data: orders.map(o => intentCreateData({ order: { ...f.order, orderNo: o.orderNo }, role: 'KITCHEN', decision: 'REQUIRED', now: f.now })) })
  const corrupt = await admin.client.customerOrderFulfillmentIntent.findFirstOrThrow({ where: { tenantId: f.tenantId }, orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }] })
  await admin.client.customerOrderFulfillmentIntent.update({ where: { id: corrupt.id }, data: { snapshotHash: '0'.repeat(64) } })
  let processed = 0
  for (let n = 0; n < 51; n++) {
    const result = await claimCustomerOrderRender(admin.client as any, renderOwner(f), { now: () => f.now })
    assert.equal(result.kind, 'IDLE'); assert.ok(result.processed <= 20); processed += result.processed
  }
  const rows = await admin.client.customerOrderFulfillmentIntent.findMany({ where: { tenantId: f.tenantId } })
  assert.equal(processed, count); assert.equal(rows.filter(r => r.revision === 1).length, count)
  assert.equal(rows.filter(r => r.state === 'MANUAL_REVIEW').length, 1)
  assert.equal(rows.filter(r => r.id !== corrupt.id && r.nextAttemptAt > f.now).length, count-1)
  assert.ok(rows.every(r => r.renderAttemptCount === 0 && r.attemptCount === 0 && !r.printJobId))
  t.diagnostic('render queue unique=1005; repeats=0; omitted=0; corrupt=1 isolated; limit=20 per claim')
}))

test('DB render migration: new lease CHECK constraints exist and reject inconsistent writes', { skip: skipReason, timeout: 90_000 }, async () => withFixture(async h => {
  const { fixture: f, admin } = h, intent = await kitchenIntent(admin.client, f, false)
  const constraints = await admin.client.$queryRaw<Array<{ conname: string; definition: string }>>`SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='"CustomerOrderFulfillmentIntent"'::regclass AND contype='c'`
  for (const suffix of ['render_count_check', 'render_lease_check', 'render_token_check']) assert.ok(constraints.some(c => c.conname === `CustomerOrderFulfillmentIntent_${suffix}`))
  for (const data of [{ renderAttemptCount: -1 }, { renderLeaseOwnerId: 'partial' }, { renderLeaseOwnerId: 'owner', renderLeaseTokenHash: 'invalid', renderLeaseExpiresAt: f.deadline }]) {
    await assert.rejects(admin.client.customerOrderFulfillmentIntent.update({ where: { id: intent.id }, data }))
    const row = await admin.client.customerOrderFulfillmentIntent.findUniqueOrThrow({ where: { id: intent.id } })
    assert.equal(row.renderAttemptCount, 0); assert.equal(row.renderLeaseOwnerId, null)
  }
}))

for (const action of ['failure-defer', 'seal-expire'] as const) {
  test(`DB render cron race: ${action} loses revision CAS and reports STALE`, { skip: skipReason, timeout: 90_000 }, async () => withFixture(async h => {
    const { fixture: f, admin } = h, intent = await kitchenIntent(admin.client, f, false), owner = renderOwner(f)
    const claimed = await claimCustomerOrderRender(admin.client as any, owner, { ...runtime, now: () => new Date(+intent.deadlineAt - 30_000) })
    assert.equal(claimed.kind, 'CLAIMED')
    const worker = await h.worker('render-loses-cron'), cron = await h.worker('cron-wins-render')
    const barrier = h.barrier('renderer holds order and read revision, before Intent CAS')
    worker.setHook(async e => {
      if (e.phase === 'before' && e.model === 'customerOrderFulfillmentIntent' && e.method === 'updateMany') await barrier.pause()
    })
    const operation = action === 'failure-defer'
      ? failCustomerOrderRender(worker.db as any, owner, { ...claimed.claim, code: 'RENDER_FAILED' }, { ...runtime, now: () => new Date(+intent.deadlineAt - 1) })
      : sealCustomerOrderRender(worker.db as any, owner, { ...claimed.claim, ...sealedBytes }, { ...runtime, now: () => intent.deadlineAt })
    const rendering = h.track(operation)
    await barrier.entered()
    assert.ok(worker.events.some(e => e.phase === 'after' && orderLock(f)(e)), 'render operation actually owns the order lock')
    const sweep = await runCustomerOrderFulfillmentRecovery(cron.client as any, intent.deadlineAt)
    assert.equal(sweep.summary.expired, 1)
    const winner = await admin.client.customerOrderFulfillmentIntent.findUniqueOrThrow({ where: { id: intent.id } })
    assert.equal(winner.state, 'EXPIRED'); assert.equal(winner.renderLeaseTokenHash, null)
    barrier.release()
    assert.equal((await rendering).kind, 'STALE', 'a zero-row write cannot report that it deferred or expired the row')
    const cas = worker.events.filter(e => e.phase === 'after' && e.model === 'customerOrderFulfillmentIntent' && e.method === 'updateMany')
    assert.equal(cas.length, 1); assert.equal(cas[0].result.count, 0, 'actual database CAS loser, not a fabricated result')
    assert.deepEqual(await admin.client.customerOrderFulfillmentIntent.findUniqueOrThrow({ where: { id: intent.id } }), winner)
  }))
}

function pauseStandaloneIntentUpdate(client: PrismaClient, intentId: string, barrier: ReturnType<typeof gate>, counts: number[]) {
  // Observe the existing non-transactional cron call, without adding a lock or
  // fabricating a count. The original Prisma method executes on its own pool.
  return new Proxy(client, { get(target, key) {
    if (key !== 'customerOrderFulfillmentIntent') { const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value }
    return new Proxy(target.customerOrderFulfillmentIntent, { get(delegate, method: string) {
      if (method === 'updateMany') return async (args: any) => {
        assert.equal(args.where.id, intentId)
        await barrier.pause()
        const result = await delegate.updateMany(args); counts.push(result.count); return result
      }
      const value = (delegate as any)[method]; return typeof value === 'function' ? value.bind(delegate) : value
    } })
  } })
}

test('DB render cron race: stale metadata sweep re-reads a new live claim without clearing it', { skip: skipReason, timeout: 90_000 }, async () => withFixture(async h => {
  const { fixture: f, admin } = h, intent = await kitchenIntent(admin.client, f, false)
  const cron = await h.worker('cron-loses-claim'), renderer = await h.worker('claim-wins-cron'), counts: number[] = []
  const barrier = h.barrier('cron read revision, paused before standalone metadata CAS')
  const sweep = h.track(processCustomerOrderFulfillmentIntent(pauseStandaloneIntentUpdate(cron.client, intent.id, barrier, counts) as any, intent.id, f.now))
  await barrier.entered()
  assert.equal((await claimCustomerOrderRender(renderer.db as any, renderOwner(f), runtime)).kind, 'CLAIMED')
  const winner = await admin.client.customerOrderFulfillmentIntent.findUniqueOrThrow({ where: { id: intent.id } })
  assert.ok(winner.renderLeaseTokenHash); assert.equal(winner.renderAttemptCount, 1)
  barrier.release()
  assert.equal((await sweep).status, 'PROCESSING', 'report the live claim, not a failed stale metadata update')
  assert.deepEqual(counts, [0])
  assert.deepEqual(await admin.client.customerOrderFulfillmentIntent.findUniqueOrThrow({ where: { id: intent.id } }), winner)
}))

test('DB render cron race: zero-row expiration is skipped, not counted as an applied transition', { skip: skipReason, timeout: 90_000 }, async () => withFixture(async h => {
  const { fixture: f, admin } = h, intent = await kitchenIntent(admin.client, f, false), owner = renderOwner(f)
  const nearDeadline = { ...runtime, now: () => new Date(+intent.deadlineAt - 30_000) }
  const claim = (await claimCustomerOrderRender(admin.client as any, owner, nearDeadline)).claim
  assert.ok(claim)
  const cron = await h.worker('cron-expire-loses'), renderer = await h.worker('failure-wins-cron'), counts: number[] = []
  const barrier = h.barrier('cron expiration read revision, before update')
  const sweep = h.track(runCustomerOrderFulfillmentRecovery(pauseStandaloneIntentUpdate(cron.client, intent.id, barrier, counts) as any, intent.deadlineAt))
  await barrier.entered()
  assert.equal((await failCustomerOrderRender(renderer.db as any, owner, { ...claim, code: 'RENDER_FAILED' }, nearDeadline)).kind, 'WAITING')
  const winner = await admin.client.customerOrderFulfillmentIntent.findUniqueOrThrow({ where: { id: intent.id } })
  barrier.release()
  const result = await sweep
  assert.deepEqual(counts, [0]); assert.equal(result.summary.expired, 0); assert.equal(result.summary.skipped, 1)
  assert.deepEqual(await admin.client.customerOrderFulfillmentIntent.findUniqueOrThrow({ where: { id: intent.id } }), winner)
  // The next independent invocation still expires it; the stale skip neither
  // loses the row nor moves its fixed deadline.
  assert.equal((await runCustomerOrderFulfillmentRecovery(cron.client as any, intent.deadlineAt)).summary.expired, 1)
}))

// Independent opt-in migration entry. These two URLs MUST name freshly created
// empty, disposable databases distinct from the business-test database. Missing
// configuration skips explicitly. No unknown/nonempty DB is reset; Prisma's
// migration replay may reset only the explicitly checked disposable shadow.
const migrationUrl = process.env.ES_H5_ORDER_FULFILLMENT_MIGRATION_DATABASE_URL ?? ''
const shadowUrl = process.env.ES_H5_ORDER_FULFILLMENT_SHADOW_DATABASE_URL ?? ''
const migrationSkip = process.env.ES_H5_ORDER_FULFILLMENT_MIGRATION_TEST !== '1'
  ? 'NOT RUN: separate ES_H5_ORDER_FULFILLMENT_MIGRATION_TEST=1 opt-in required'
  : process.env.ES_H5_ORDER_FULFILLMENT_DISPOSABLE !== '1' || !migrationUrl || !shadowUrl
    ? 'NOT RUN: disposable acknowledgment, fresh migration target URL AND independent shadow URL required'
    : disposableUrlError(migrationUrl) || disposableUrlError(shadowUrl) || false

async function requireEmptyDatabase(raw: string) {
  const connection = new pg.Client({ connectionString: raw, connectionTimeoutMillis: 3_000, statement_timeout: 5_000 })
  try {
    await connection.connect()
    const result = await connection.query<{ database: string; objects: number }>(`
      SELECT current_database() AS database, (
        (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema') +
        (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema') +
        (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema') +
        (SELECT count(*) FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname NOT IN ('information_schema', 'public'))
      )::int AS objects`)
    assert.equal(result.rows[0].database, new URL(raw).pathname.slice(1))
    assert.equal(result.rows[0].objects, 0, 'refuse nonempty database; no automatic cleanup/reset is permitted')
  } finally { await connection.end() }
}

test('DB migration: empty target actual chain, live schema diff, independent shadow replay diff', { skip: migrationSkip, timeout: 540_000 }, async (t) => {
  assert.notEqual(process.env.NODE_ENV, 'production')
  const targetName = new URL(migrationUrl).pathname, shadowName = new URL(shadowUrl).pathname
  assert.notEqual(targetName, shadowName, 'migration target and shadow database names must be distinct')
  for (const other of [databaseUrl, process.env.DATABASE_URL, process.env.DIRECT_URL].filter(Boolean) as string[]) {
    assert.notEqual(targetName, new URL(other).pathname, 'target cannot be ordinary business/runtime database')
    assert.notEqual(shadowName, new URL(other).pathname, 'shadow cannot be ordinary business/runtime database')
  }
  await requireEmptyDatabase(migrationUrl)
  await requireEmptyDatabase(shadowUrl)
  const root = process.cwd()
  const version = JSON.parse(await readFile(resolve(root, 'node_modules/prisma/package.json'), 'utf8')).version
  assert.equal(version, '7.6.0', 'CLI contract must be re-audited after a Prisma version change')
  const dir = await mkdtemp(join(tmpdir(), 'h5-migration-config-'))
  const config = join(dir, 'prisma.config.ts')
  const env = { ...process.env, DATABASE_URL: migrationUrl, DIRECT_URL: migrationUrl,
    ES_H5_MIGRATION_TARGET: migrationUrl, ES_H5_MIGRATION_SHADOW: shadowUrl }
  // Absolute paths bind this entry to the actual candidate schema and chain.
  const source = `import { defineConfig } from ${JSON.stringify(resolve(root, 'node_modules/prisma/config.js'))};\nexport default defineConfig({schema:${JSON.stringify(resolve(root, 'prisma/schema.prisma'))},migrations:{path:${JSON.stringify(resolve(root, 'prisma/migrations'))}},datasource:{url:process.env.ES_H5_MIGRATION_TARGET!,shadowDatabaseUrl:process.env.ES_H5_MIGRATION_SHADOW!}});\n`
  const redact = (value: unknown) => String(value ?? '').replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[redacted PostgreSQL URL]')
  const cli = async (args: string[]) => {
    try {
      const result = await promisify(execFile)(process.execPath, [resolve(root, 'node_modules/prisma/build/index.js'), ...args, '--config', config], {
        cwd: root, env, encoding: 'utf8', timeout: 120_000, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024,
      })
      t.diagnostic(`Prisma ${version} ${args.join(' ')}: exit=0\nstdout=${redact(result.stdout)}\nstderr=${redact(result.stderr)}`)
      return result.stdout
    } catch (error: any) {
      throw new Error(`Prisma ${args.join(' ')}: exit=${error.code ?? 'none'}, signal=${error.signal ?? 'none'}, timedOut/killed=${Boolean(error.killed)}\nstdout=${redact(error.stdout)}\nstderr=${redact(error.stderr)}\n${redact(error.message)}`)
    }
  }
  try {
    await writeFile(config, source, { flag: 'wx' })
    const help = await cli(['migrate', 'diff', '--help'])
    for (const flag of ['--from-config-datasource', '--from-migrations', '--to-schema', '--exit-code']) assert.ok(help.includes(flag), `installed CLI missing ${flag}`)
    await cli(['migrate', 'deploy'])
    await cli(['migrate', 'diff', '--from-config-datasource', '--to-schema', resolve(root, 'prisma/schema.prisma'), '--exit-code'])
    await cli(['migrate', 'diff', '--from-migrations', resolve(root, 'prisma/migrations'), '--to-schema', resolve(root, 'prisma/schema.prisma'), '--exit-code'])
  } finally {
    await unlink(config).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
    await rmdir(dir)
  }
})
