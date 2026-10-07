import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { Prisma } from '@prisma/client'
import {
  buildCustomerOrderPrintIntent,
  cancelCustomerOrderKitchenIntent,
  customerOrderPaymentIntentData,
  customerOrderKitchenDisposition,
  enqueueCustomerOrderPrintJob,
  paymentIntentMethod,
  processCustomerOrderFulfillmentIntent,
  recordCustomerOrderIntent,
} from '../lib/customer-order-fulfillment'
import { enqueueV3PrintIntent } from '../lib/v3-print-job-adapter'
import { customerOrderEnvelopeFromSeal, type CustomerOrderPrintOrder } from '../lib/customer-order-fulfillment-renderer'
import { encodeRgbaToEscPosEscStar24 } from '../lib/qzEscPosBitImage'

const testProfileId = createHash('sha256').update('isolated-renderer-fixture-v1').digest('hex')
const raster = Buffer.from(encodeRgbaToEscPosEscStar24({ width: 576, height: 24, rgba: new Uint8ClampedArray(576 * 24 * 4).fill(255) }))
function sealedFixture(intent: any) {
  Object.assign(intent, { payloadBase64: raster.toString('base64'), payloadHash: createHash('sha256').update(raster).digest('hex'),
    byteLength: raster.length, rendererVersion: testProfileId, renderProfileId: testProfileId, sealedAt: new Date(), state: 'PENDING', revision: 1 })
}

const createdAt = new Date('2026-09-30T03:00:00.000Z')

function order(overrides: Partial<CustomerOrderPrintOrder> = {}): CustomerOrderPrintOrder {
  return {
    tenantId: 'tenant-a',
    storeId: 'store-a',
    orderNo: 'H5-ORDER-001',
    storeName: '测试门店',
    currencyCode: 'USD',
    createdAt,
    paidAt: null,
    tableNo: 'A1',
    remark: '少冰',
    totalAmount: 4.5,
    paymentStatus: 'UNPAID',
    paymentMethod: null,
    items: [
      { productId: 'p-kitchen', name: '厨房饮品', spec: null, originalPrice: 2.5, price: 2.5, quantity: 1, lineAmount: 2.5, printKitchenTicket: true },
      { productId: 'p-legacy', name: '历史商品', spec: null, originalPrice: 2, price: 2, quantity: 1, lineAmount: 2 },
    ],
    ...overrides,
  }
}

function fakeDb(mode: string | null = 'V3_ACTIVE') {
  const jobs: any[] = []
  const intents: any[] = []
  const db: any = {
    customerOrder: {
      findFirst: async ({ where }: any) => where.orderNo === 'H5-ORDER-001'
        ? { ...order({}), status: 'CONFIRMED', tenantId: 'tenant-a', storeId: 'store-a', orderNo: 'H5-ORDER-001', paymentStatus: 'UNPAID' }
        : null,
    },
    v3PrintControlPlane: {
      findUnique: async () => mode ? { tenantId: 'tenant-a', mode } : null,
    },
    eshopTrayPrintJob: {
      create: async ({ data }: any) => {
        const duplicate = jobs.some((job) => job.tenantId === data.tenantId && job.storeId === data.storeId && job.idempotencyKey === data.idempotencyKey)
        if (duplicate) {
          throw new Prisma.PrismaClientKnownRequestError('duplicate', {
            code: 'P2002',
            clientVersion: '7.6.0',
            meta: { modelName: 'EshopTrayPrintJob', target: ['tenantId', 'storeId', 'idempotencyKey'] },
          })
        }
        const job = { id: `job-${jobs.length + 1}`, status: 'PENDING', completedAt: null, ...data }
        jobs.push(job)
        return job
      },
      findUnique: async ({ where }: any) => jobs.find((job) => job.tenantId === where.tenantId_storeId_idempotencyKey.tenantId
        && job.storeId === where.tenantId_storeId_idempotencyKey.storeId
        && job.idempotencyKey === where.tenantId_storeId_idempotencyKey.idempotencyKey) ?? null,
      findMany: async () => jobs,
      updateMany: async ({ where, data }: any) => {
        const job = jobs.find((row) => row.id === where.id && row.schemaVersion === where.schemaVersion && row.status === where.status)
        if (!job) return { count: 0 }
        Object.assign(job, data)
        return { count: 1 }
      },
    },
    customerOrderFulfillmentIntent: {
      findUnique: async ({ where }: any) => {
        if (where.id) return structuredClone(intents.find((intent) => intent.id === where.id) ?? null)
        const key = where.tenantId_storeId_orderNo_role
        return structuredClone(intents.find((intent) => intent.tenantId === key.tenantId && intent.storeId === key.storeId && intent.orderNo === key.orderNo && intent.role === key.role) ?? null)
      },
      create: async ({ data }: any) => {
        const duplicate = intents.some((intent) => intent.tenantId === data.tenantId && intent.storeId === data.storeId && intent.orderNo === data.orderNo && intent.role === data.role)
        if (duplicate) throw new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7.6.0', meta: { modelName: 'CustomerOrderFulfillmentIntent', target: ['tenantId', 'storeId', 'orderNo', 'role'] } })
        const intent = { id: `intent-${intents.length + 1}`, printJobId: null, ...data }
        intents.push(intent)
        return intent
      },
      update: async ({ where, data }: any) => {
        const intent = intents.find((row) => row.id === where.id)
        if (!intent) throw new Error('intent missing')
        for (const [key, value] of Object.entries(data)) intent[key] = (value as any)?.increment != null ? intent[key] + (value as any).increment : value
        return intent
      },
      updateMany: async ({ where, data }: any) => {
        const intent = intents.find((row) => Object.entries(where).every(([key, value]: [string, any]) => {
          if (value && typeof value === 'object') {
            if ('in' in value) return value.in.includes(row[key])
            if ('lte' in value) return row[key] <= value.lte
          }
          return row[key] === value
        }))
        if (!intent) return { count: 0 }
        for (const [key, value] of Object.entries(data)) intent[key] = (value as any)?.increment != null ? intent[key] + (value as any).increment : value
        return { count: 1 }
      },
    },
  }
  db.$queryRaw = async () => []
  // Sequential transactional substitute only; not evidence of PostgreSQL locks.
  db.$transaction = async (operation: (tx: any) => Promise<unknown>) => {
    const saved = structuredClone({ jobs, intents })
    let aborted: unknown
    const tx = { ...db, eshopTrayPrintJob: { ...db.eshopTrayPrintJob, create: async (args: any) => {
      try { return await db.eshopTrayPrintJob.create(args) } catch (error) { aborted = error; throw error }
    } }, customerOrderFulfillmentIntent: { ...db.customerOrderFulfillmentIntent } }
    for (const method of ['update', 'updateMany']) tx.customerOrderFulfillmentIntent[method] = async (args: any) => {
      if (aborted) throw aborted
      return db.customerOrderFulfillmentIntent[method](args)
    }
    try { const result = await operation(tx); if (aborted) throw aborted; return result } catch (error) {
      jobs.splice(0, jobs.length, ...saved.jobs)
      intents.splice(0, intents.length, ...saved.intents)
      throw error
    }
  }
  return { db, jobs, intents }
}

test('kitchen intent is unpaid, explicit-route only, and hash/length use the same bytes', () => {
  const intent = buildCustomerOrderPrintIntent(order(), 'KITCHEN')
  const bytes = Buffer.from(intent.payloadBase64, 'base64')
  const text = bytes.toString('utf8')
  assert.equal(intent.source, 'CLOUD_H5')
  assert.equal(intent.payloadKind, 'RAW_BYTES')
  assert.equal(intent.byteLength, bytes.byteLength)
  assert.equal(intent.payloadHash, createHash('sha256').update(bytes).digest('hex'))
  assert.match(text, /KITCHEN/)
  assert.match(text, /UNPAID/)
  assert.doesNotMatch(text, /付款方式:|CASH|KHQR/)
  assert.match(text, /厨房饮品/)
  assert.doesNotMatch(text, /历史商品/)
})

test('kitchen decision separates the store switch from immutable item markers', () => {
  assert.equal(customerOrderKitchenDisposition(order(), false), 'NOT_REQUIRED')
  assert.equal(customerOrderKitchenDisposition(order(), true), 'MANUAL_REVIEW')
  assert.equal(customerOrderKitchenDisposition(order({ items: [order().items[0]] }), true), 'REQUIRED')
  assert.equal(customerOrderKitchenDisposition(order({ items: [{ ...order().items[0], printKitchenTicket: false }] }), true), 'NOT_REQUIRED')
})

test('front intent refuses unpaid orders and maps QR only to the canonical KHQR label', () => {
  assert.throws(() => buildCustomerOrderPrintIntent(order(), 'FRONT'), /CUSTOMER_ORDER_FRONT_PAYMENT_REQUIRED/)
  const intent = buildCustomerOrderPrintIntent(order({ paymentStatus: 'PAID', paymentMethod: 'QR', paidAt: new Date('2026-09-30T03:05:00.000Z') }), 'FRONT')
  const text = Buffer.from(intent.payloadBase64, 'base64').toString('utf8')
  assert.match(text, /FRONT/)
  assert.match(text, /PAID/)
  assert.match(text, /KHQR/)
  assert.doesNotMatch(text, /付款方式: QR/)
})

test('PaymentIntent payload preserves offline H5 actor and canonical payment semantics', () => {
  const paidAt = new Date('2026-09-30T03:05:00.000Z')
  const data = customerOrderPaymentIntentData({
    tenantId: 'tenant-a', storeId: 'store-a', operatorUserId: 'staff-a', orderNo: 'H5-ORDER-001', orderId: 'order-a', amount: '4.50', paymentMethod: 'QR', paidAt,
  })
  assert.equal(paymentIntentMethod('QR'), 'KHQR')
  assert.equal(data.paymentMethod, 'KHQR')
  assert.equal(data.status, 'PAID')
  assert.equal(data.transactionActorType, 'H5_CUSTOMER_ORDER')
  assert.equal(data.transactionActorId, 'order-a')
  assert.equal(data.khqrPayload, null)
  assert.equal(data.provider, null)
  assert.equal(data.amount, '4.50')
})

test('renderer gate keeps durable intent visible and prevents unapproved delivery', async () => {
  const active = fakeDb('V3_ACTIVE')
  const explicitOrder = order({ items: [order().items[0]] })
  await recordCustomerOrderIntent(active.db, explicitOrder, 'KITCHEN', 'REQUIRED', new Date())
  const first = await enqueueCustomerOrderPrintJob(active.db, explicitOrder, 'KITCHEN')
  const second = await enqueueCustomerOrderPrintJob(active.db, explicitOrder, 'KITCHEN')
  assert.equal(first.status, 'NOT_READY')
  assert.equal(first.error, 'CUSTOMER_ORDER_RENDERER_NOT_RELEASED')
  assert.equal(first.printJobId, null)
  assert.equal(second.status, 'NOT_READY')
  assert.equal(second.created, false)
  assert.equal(active.jobs.length, 0)
  assert.equal(active.intents.length, 1)

  const held = fakeDb('V2_ACTIVE')
  await recordCustomerOrderIntent(held.db, explicitOrder, 'KITCHEN', 'REQUIRED', new Date())
  const heldResult = await enqueueCustomerOrderPrintJob(held.db, explicitOrder, 'KITCHEN')
  assert.equal(heldResult.status, 'NOT_READY')
  assert.equal(heldResult.error, 'CUSTOMER_ORDER_V3_NOT_ACTIVE')
  assert.equal(heldResult.printJobId, null)
  assert.equal(held.jobs.length, 0)

  const unavailable = fakeDb(null)
  await recordCustomerOrderIntent(unavailable.db, explicitOrder, 'KITCHEN', 'REQUIRED', new Date())
  const unavailableResult = await enqueueCustomerOrderPrintJob(unavailable.db, explicitOrder, 'KITCHEN')
  assert.equal(unavailableResult.status, 'NOT_READY')
  assert.equal(unavailableResult.printJobId, null)
  assert.equal(unavailable.jobs.length, 0)
})

test('terminal no-print intents are not misreported as cancellation races', async () => {
  const f = fakeDb('V3_ACTIVE')
  const noPrintOrder = order({ items: [{ ...order().items[0], printKitchenTicket: false }] })
  await recordCustomerOrderIntent(f.db, noPrintOrder, 'KITCHEN', 'NOT_REQUIRED', new Date())
  const notRequired = await cancelCustomerOrderKitchenIntent(f.db, noPrintOrder)
  assert.deepEqual(notRequired, { kind: 'CANCELLED', code: 'NOT_REQUIRED' })

  const expiredOrder = order({ orderNo: 'H5-EXPIRED' })
  await recordCustomerOrderIntent(f.db, expiredOrder, 'KITCHEN', 'REQUIRED', new Date())
  f.intents.find((intent) => intent.orderNo === 'H5-EXPIRED')!.state = 'EXPIRED'
  const expired = await cancelCustomerOrderKitchenIntent(f.db, expiredOrder)
  assert.deepEqual(expired, { kind: 'CANCELLED', code: 'CUSTOMER_ORDER_FULFILLMENT_DEADLINE_EXPIRED' })
})

test('test-only presealed raster exercises create, cancel, and repeat idempotency', async () => {
  const previousNodeEnv = process.env.NODE_ENV
  const previousTestRenderer = process.env.ES_H5_ORDER_FULFILLMENT_TEST_RENDERER
  ;(process.env as Record<string, string | undefined>).NODE_ENV = 'test'
  process.env.ES_H5_ORDER_FULFILLMENT_TEST_RENDERER = '1'
  const active = fakeDb('V3_ACTIVE')
  const explicitOrder = order({ items: [order().items[0]] })
  try {
    const eventAt = new Date()
    const intent = await recordCustomerOrderIntent(active.db, explicitOrder, 'KITCHEN', 'REQUIRED', eventAt)
    sealedFixture(intent)
    const first = await enqueueCustomerOrderPrintJob(active.db, explicitOrder, 'KITCHEN', { testProfileId })
    assert.equal(first.status, 'QUEUED', first.error)
    assert.equal(active.jobs.length, 1)
    assert.equal(active.intents[0].printJobId, active.jobs[0].id)
    assert.equal(active.jobs[0].idempotencyKey, intent.idempotencyKey)
    const repeated = await enqueueCustomerOrderPrintJob(active.db, explicitOrder, 'KITCHEN', { testProfileId })
    assert.equal(repeated.status, 'ALREADY_PRESENT')
    assert.equal(active.jobs.length, 1)
    const cancelled = await cancelCustomerOrderKitchenIntent(active.db, explicitOrder, new Date(eventAt.getTime() + 60_000))
    assert.equal(cancelled.kind, 'CANCELLED')
    assert.equal(active.jobs[0].status, 'FAILED')
    assert.equal(active.jobs[0].resultStatus, 'FAILED_NOT_CROSSED')
    assert.equal(active.jobs[0].effectBoundary, 'NOT_CROSSED')
  } finally {
    if (previousNodeEnv === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV
    else ;(process.env as Record<string, string | undefined>).NODE_ENV = previousNodeEnv
    if (previousTestRenderer === undefined) delete process.env.ES_H5_ORDER_FULFILLMENT_TEST_RENDERER
    else process.env.ES_H5_ORDER_FULFILLMENT_TEST_RENDERER = previousTestRenderer
  }
})

test('home consumes business and print outcomes without exposing raw queue diagnostics', () => {
  const source = readFileSync('app/home/page.tsx', 'utf8')
  assert.match(source, /customerOrderPrintMessage\(body\.printStatus/)
  assert.match(source, /NOT_REQUIRED/)
  assert.match(source, /RECONCILIATION_REQUIRED/)
  assert.match(source, /MANUAL_REVIEW/)
  assert.match(source, /customerOrderActionMessage\(body\.error/)
})

async function withReleasedFixture(run: (f: ReturnType<typeof fakeDb>, input: CustomerOrderPrintOrder, id: string) => Promise<void>) {
  const saved = process.env.ES_H5_ORDER_FULFILLMENT_TEST_RENDERER
  process.env.ES_H5_ORDER_FULFILLMENT_TEST_RENDERER = '1'
  try {
    const f = fakeDb(), input = order({ items: [order().items[0]] })
    const intent = await recordCustomerOrderIntent(f.db, input, 'KITCHEN', 'REQUIRED', new Date())
    sealedFixture(intent)
    await run(f, input, intent.id)
  } finally {
    if (saved === undefined) delete process.env.ES_H5_ORDER_FULFILLMENT_TEST_RENDERER
    else process.env.ES_H5_ORDER_FULFILLMENT_TEST_RENDERER = saved
  }
}
const releasedRuntime = { testProfileId }

test('C: JSON key order changes do not change producer identity or association', async () => withReleasedFixture(async (f, input, id) => {
  const sent = customerOrderEnvelopeFromSeal(input, 'KITCHEN', f.intents[0])
  const created = await enqueueV3PrintIntent(f.db, input, sent, f.intents[0].deadlineAt)
  const originalHash = created.job.requestHash
  f.jobs[0].payload = Object.fromEntries(Object.entries(sent).reverse())
  assert.notEqual(JSON.stringify(f.jobs[0].payload), JSON.stringify(sent))
  const result = await processCustomerOrderFulfillmentIntent(f.db, id, new Date(), releasedRuntime)
  assert.deepEqual(result, { status: 'ALREADY_PRESENT', created: false, printJobId: created.job.id })
  assert.equal(f.intents[0].attemptCount, 0)
  assert.equal(f.jobs[0].requestHash, originalHash)
  assert.equal(f.jobs.length, 1)
}))

const jobMutations: Record<string, (job: any) => void> = {
  tenant: (job) => { job.tenantId = 'other-tenant' },
  store: (job) => { job.storeId = 'other-store' },
  key: (job) => { job.idempotencyKey = 'other-key' },
  schema: (job) => { job.schemaVersion = 2 },
  order: (job) => { job.payload.orderNo = 'other-order' },
  role: (job) => { job.payload.role = 'FRONT' },
  source: (job) => { job.payload.source = 'CLOUD_REMOTE_REPRINT' },
  payloadKey: (job) => { job.payload.printJobId = 'other-key' },
  payloadSchema: (job) => { job.payload.schemaVersion = 2 },
  payloadVersion: (job) => { job.payload.rendererVersion = 'other-renderer' },
  payloadKind: (job) => { job.payload.payloadKind = 'LEGACY' },
  bytes: (job) => { const bytes = Buffer.from('different'); Object.assign(job.payload, { payloadBase64: bytes.toString('base64'), byteLength: bytes.length, payloadHash: createHash('sha256').update(bytes).digest('hex') }) },
  length: (job) => { job.payload.byteLength += 1 },
  sha: (job) => { job.payload.payloadHash = 'f'.repeat(64) },
  base64: (job) => { job.payload.payloadBase64 += '\n' },
  requestHash: (job) => { job.requestHash = 'f'.repeat(64) },
}
for (const [label, mutate] of Object.entries(jobMutations)) {
  test(`C: existing job rejects changed ${label}`, async () => withReleasedFixture(async (f, input, id) => {
    await enqueueV3PrintIntent(f.db, input, customerOrderEnvelopeFromSeal(input, 'KITCHEN', f.intents[0]), f.intents[0].deadlineAt)
    mutate(f.jobs[0])
    if (label !== 'requestHash') f.jobs[0].requestHash = createHash('sha256').update(JSON.stringify(f.jobs[0].payload)).digest('hex')
    // Even a corrupt/mis-scoped read must not bypass the explicit identity checks.
    f.db.eshopTrayPrintJob.findUnique = async () => f.jobs[0]
    const result = await processCustomerOrderFulfillmentIntent(f.db, id, new Date(), releasedRuntime)
    assert.equal(result.status, 'MANUAL_REVIEW')
    assert.equal(result.error, 'CUSTOMER_ORDER_EXISTING_JOB_IDENTITY_MISMATCH')
    assert.equal(f.intents[0].printJobId, null)
    assert.equal(f.intents[0].attemptCount, 0)
  }))
}

test('B: rollback failures persist increasing backoff once per creation and stop at 12', async () => withReleasedFixture(async (f, _input, id) => {
  let inserts = 0
  f.db.eshopTrayPrintJob.create = async () => { inserts += 1; throw new Prisma.PrismaClientKnownRequestError('SQL failure', { code: 'P2010', clientVersion: '7.6.0', meta: { driverAdapterError: { cause: { originalCode: '22012' } } } }) }
  for (let count = 1; count <= 12; count += 1) {
    f.intents[0].nextAttemptAt = new Date(0) // Make the fixture due without changing its fixed deadline/count.
    const result = await processCustomerOrderFulfillmentIntent(f.db, id, new Date(), releasedRuntime)
    const row = f.intents[0]
    assert.equal(row.attemptCount, count)
    assert.equal(row.state, count === 12 ? 'MANUAL_REVIEW' : 'FAILED_RETRYABLE')
    assert.equal(result.status, count === 12 ? 'MANUAL_REVIEW' : 'FAILED')
    const delay = Math.min(30 * 60_000, 60_000 * 2 ** (count - 1))
    assert.equal(row.nextAttemptAt.getTime(), Math.min(row.deadlineAt.getTime(), row.lastErrorAt.getTime() + delay))
    assert.equal(row.printJobId, null)
    assert.equal(f.jobs.length, 0)
  }
  assert.equal((await processCustomerOrderFulfillmentIntent(f.db, id, new Date(), releasedRuntime)).status, 'MANUAL_REVIEW')
  assert.equal(inserts, 12)
  assert.equal(f.intents[0].manualReviewReason, 'CUSTOMER_ORDER_PRINT_ATTEMPTS_EXHAUSTED')
}))

test('B: P2002 rolls back provisional attempt and only defers identity reconciliation', async () => withReleasedFixture(async (f, _input, id) => {
  f.db.eshopTrayPrintJob.create = async () => { throw new Prisma.PrismaClientKnownRequestError('collision', { code: 'P2002', clientVersion: '7.6.0', meta: { modelName: 'EshopTrayPrintJob', target: ['tenantId', 'storeId', 'idempotencyKey'] } }) }
  assert.equal((await processCustomerOrderFulfillmentIntent(f.db, id, new Date(), releasedRuntime)).status, 'FAILED')
  assert.equal(f.intents[0].attemptCount, 0)
  assert.equal(f.intents[0].state, 'FAILED_RETRYABLE')
  assert.equal(f.intents[0].revision, 2, 'seal + one post-rollback update only')
}))

for (const change of ['linked', 'cancelled', 'revision'] as const) {
  test(`B: rollback accounting cannot overwrite another worker's ${change} result`, async () => withReleasedFixture(async (f, _input, id) => {
    f.db.eshopTrayPrintJob.create = async () => { throw new Error('injected create failure') }
    const transaction = f.db.$transaction
    let intervened = false, saved: any
    f.db.$transaction = async (fn: any) => {
      try { return await transaction(fn) } catch (error) {
        if (!intervened) {
          intervened = true
          Object.assign(f.intents[0], { revision: f.intents[0].revision + 1,
            ...(change === 'linked' ? { state: 'ENQUEUED', printJobId: 'winner' } : change === 'cancelled' ? { state: 'CANCELLED', cancelResultCode: 'CUSTOMER_ORDER_CANCELLED_BEFORE_CLAIM' } : {}) })
          saved = structuredClone(f.intents[0])
        }
        throw error
      }
    }
    const result = await processCustomerOrderFulfillmentIntent(f.db, id, new Date(), releasedRuntime)
    assert.deepEqual(f.intents[0], saved)
    if (change === 'linked') assert.deepEqual(result, { status: 'ALREADY_PRESENT', created: false, printJobId: 'winner' })
  }))
}

test('B: unavailable failure-accounting transaction stays a runtime failure', async () => withReleasedFixture(async (f, _input, id) => {
  const transaction = f.db.$transaction
  let failed = false
  f.db.eshopTrayPrintJob.create = async () => { throw new Error('create aborted') }
  f.db.$transaction = async (fn: any) => {
    if (failed) throw new Error('database unwritable')
    try { return await transaction(fn) } catch (error) { failed = true; throw error }
  }
  await assert.rejects(processCustomerOrderFulfillmentIntent(f.db, id, new Date(), releasedRuntime), /database unwritable/)
  assert.equal(f.intents[0].attemptCount, 0, 'no claim of durable accounting on an unwritable database')
}))

test('B: deadline crossing during a failed attempt expires without refreshing the deadline', async (t) => withReleasedFixture(async (f, _input, id) => {
  const deadline = f.intents[0].deadlineAt.getTime()
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  f.db.eshopTrayPrintJob.create = async () => { t.mock.timers.tick(31 * 60_000); throw new Error('late SQL failure') }
  const result = await processCustomerOrderFulfillmentIntent(f.db, id, new Date(), releasedRuntime)
  assert.equal(result.status, 'EXPIRED')
  assert.equal(f.intents[0].attemptCount, 1)
  assert.equal(f.intents[0].state, 'EXPIRED')
  assert.equal(f.intents[0].deadlineAt.getTime(), deadline)
  assert.equal(f.intents[0].nextAttemptAt.getTime(), deadline)
}))

test('B: association CAS failure rolls the inserted job back before failure accounting', async () => withReleasedFixture(async (f, _input, id) => {
  const update = f.db.customerOrderFulfillmentIntent.updateMany
  f.db.customerOrderFulfillmentIntent.updateMany = async (args: any) => args.data.printJobId ? { count: 0 } : update(args)
  const result = await processCustomerOrderFulfillmentIntent(f.db, id, new Date(), releasedRuntime)
  assert.equal(result.status, 'FAILED')
  assert.equal(result.error, 'CUSTOMER_ORDER_PRINT_ASSOCIATION_RACE')
  assert.equal(f.jobs.length, 0)
  assert.equal(f.intents[0].printJobId, null)
  assert.equal(f.intents[0].attemptCount, 1)
}))
