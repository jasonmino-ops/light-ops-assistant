import assert from 'node:assert/strict'
import test from 'node:test'
import { AsyncLocalStorage } from 'node:async_hooks'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { customerOrderJobEvidence } from '../lib/customer-order-fulfillment'
import { signSession } from '../lib/session'

test('KHQR signed-session route restricts STAFF to active same-tenant/store binding; read is mutation-free', async () => {
  await ensureNextRuntime()
  const { GET } = await import('../app/api/customer-orders/[id]/khqr/route')
  const db = prisma as any, undo: Array<() => void> = []
  const replace = (obj: any, key: string, fn: any) => { const old = obj[key]; obj[key] = fn; undo.push(() => { obj[key] = old }) }
  const previousDisable = process.env.ESHOP_DISABLE_DEV_HEADERS
  process.env.ESHOP_DISABLE_DEV_HEADERS = '1'
  let bound = true, userActive = true, configured = true
  replace(db.tenant, 'findUnique', async () => ({ status: 'ACTIVE' }))
  replace(db.user, 'findUnique', async () => ({ status: userActive ? 'ACTIVE' : 'DISABLED' }))
  replace(db.userStoreRole, 'findFirst', async ({ where }: any) => {
    assert.equal(where.role, 'STAFF'); assert.equal(where.status, 'ACTIVE'); assert.equal(where.user.status, 'ACTIVE')
    assert.equal(where.user.tenantId, where.tenantId); assert.equal(where.store.tenantId, where.tenantId)
    return bound && where.tenantId === 'tenant-a' && where.storeId === 'store-a' ? { id: 'binding' } : null
  })
  replace(db.customerOrder, 'findFirst', async ({ where }: any) => where.id === 'order-a' && where.tenantId === 'tenant-a'
    && (!where.storeId || where.storeId === 'store-a') ? { id: 'order-a', orderNo: 'SYNTHETIC-QR', storeId: 'store-a', totalAmount: new Prisma.Decimal(3) } : null)
  replace(db.merchantPaymentConfig, 'findFirst', async ({ where }: any) => {
    assert.equal(where.tenantId, 'tenant-a'); assert.ok(where.storeId === 'store-a' || where.storeId === null)
    return configured ? { id: 'config', khqrImageUrl: 'data:image/png;base64,synthetic', khqrEnabled: true } : null
  })
  for (const model of ['customerOrder', 'paymentIntent', 'saleRecord', 'eshopTrayPrintJob']) {
    for (const operation of ['create', 'update', 'updateMany']) replace(db[model], operation, () => { throw new Error('READ_MUST_NOT_MUTATE') })
  }
  async function call(overrides: Row = {}, cookie: string | null | undefined = undefined, id = 'order-a') {
    const token = cookie === undefined ? signSession({ tenantId: 'tenant-a', userId: 'staff-a', storeId: 'store-a', role: 'STAFF', ...overrides }) : cookie
    return GET(new NextRequest(`https://example.test/api/customer-orders/${id}/khqr`, { headers: token ? { cookie: `auth-session=${token}` } : {} }), { params: Promise.resolve({ id }) })
  }
  try {
    assert.equal((await call()).status, 200)
    assert.equal((await call({}, null, 'other-order')).status, 401)
    assert.equal((await call({}, 'invalid')).status, 401)
    assert.equal((await call({ storeId: '' })).status, 403)
    assert.equal((await call({}, undefined, 'cross-store-order')).status, 404)
    bound = false; assert.equal((await call()).status, 403)
    assert.equal((await call({ role: 'OWNER' })).status, 200)
    assert.equal((await call({ role: 'OWNER', tenantId: 'other-tenant' })).status, 404)
    bound = true; userActive = false; assert.equal((await call()).status, 401)
    userActive = true; configured = false; assert.equal((await call()).status, 400)
  } finally {
    undo.reverse().forEach(f => f())
    if (previousDisable === undefined) delete process.env.ESHOP_DISABLE_DEV_HEADERS; else process.env.ESHOP_DISABLE_DEV_HEADERS = previousDisable
  }
})

;(globalThis as any).AsyncLocalStorage = AsyncLocalStorage
let NextRequest: any
let workAsyncStorage: any
let PATCH: any

async function ensureNextRuntime() {
  if (PATCH) return
  ;({ NextRequest } = await import('next/server'))
  ;({ workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external'))
  ;({ PATCH } = await import('../app/api/customer-orders/[id]/route'))
}

type Row = Record<string, any>

function decimal(value: number) {
  return { toString: () => value.toFixed(2), toNumber: () => value }
}

function request(id: string, body: Row) {
  return new NextRequest(`https://example.test/api/customer-orders/${id}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': 'tenant-a',
      'x-user-id': 'owner-a',
      'x-store-id': 'store-a',
      'x-role': 'OWNER',
    },
    body: JSON.stringify(body),
  })
}

async function patchOrder(id: string, body: Row, afterCallbacks: Array<() => unknown> = []) {
  await ensureNextRuntime()
  return workAsyncStorage.run({ afterContext: { after: (callback: () => unknown) => { afterCallbacks.push(callback) } } } as any, () => PATCH(
    request(id, body), { params: Promise.resolve({ id }) },
  ))
}

function fixture() {
  const orders = new Map<string, Row>()
  const paymentIntents = new Map<string, Row>()
  const intents = new Map<string, Row>()
  const jobs: Row[] = []
  let controlPlaneMode: string | null = 'V3_ACTIVE'
  let kitchenEnabled = true
  let storeLookupCount = 0
  let failPostCommitStoreLookup = false
  let failNextTransaction = false
  let transactionTail = Promise.resolve()

  const addOrder = (id: string, orderNo: string, overrides: Row = {}) => {
    orders.set(id, {
      id,
      tenantId: 'tenant-a',
      storeId: 'store-a',
      orderNo,
      status: 'PENDING',
      paymentStatus: 'UNPAID',
      paymentMethod: null,
      paidAt: null,
      paidAmount: null,
      transactionActorType: null,
      transactionActorId: null,
      authorizedByUserId: null,
      createdAt: new Date('2026-09-30T03:00:00.000Z'),
      tableNo: 'A1',
      remark: null,
      totalAmount: decimal(4.5),
      itemsJson: JSON.stringify([
        { productId: 'p-kitchen', name: '厨房饮品', spec: null, originalPrice: 4.5, price: 4.5, quantity: 1, lineAmount: 4.5, printKitchenTicket: true },
      ]),
      customerTelegramId: null,
      customerLang: null,
      ...overrides,
    })
  }
  addOrder('order-a', 'H5-ORDER-A')

  const db = prisma as unknown as Row
  const originals: Array<() => void> = []
  function stub(model: string, method: string, fn: (...args: any[]) => any) {
    const target = db[model] as Row
    const original = target[method]
    target[method] = fn
    originals.push(() => { target[method] = original })
  }
  const matchesScope = (row: Row, where: Row) => row.id === where.id && row.tenantId === where.tenantId
    && (!where.storeId || row.storeId === where.storeId)
    && (!where.status || row.status === where.status)
    && (!where.paymentStatus || row.paymentStatus === where.paymentStatus)

  stub('customerOrder', 'findFirst', async ({ where }: Row) => {
    const row = orders.get(where.id)
    return row && matchesScope(row, where) ? row : null
  })
  stub('customerOrder', 'updateMany', async ({ where, data }: Row) => {
    const row = orders.get(where.id)
    if (!row || !matchesScope(row, where)) return { count: 0 }
    Object.assign(row, data)
    return { count: 1 }
  })
  stub('store', 'findFirst', async () => {
    storeLookupCount += 1
    if (failPostCommitStoreLookup && storeLookupCount > 1) throw new Error('STORE_LOOKUP_AFTER_COMMIT_FAILED')
    return { name: '测试门店', currencyCode: 'USD', printKitchenTicket: kitchenEnabled }
  })
  stub('paymentIntent', 'findUnique', async ({ where }: Row) => paymentIntents.get(where.orderNo) ?? null)
  stub('paymentIntent', 'create', async ({ data }: Row) => {
    if (paymentIntents.has(data.orderNo)) {
      throw new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002', clientVersion: '7.6.0', meta: { target: ['orderNo'], modelName: 'PaymentIntent' },
      })
    }
    const row = { id: `pi-${paymentIntents.size + 1}`, ...data }
    paymentIntents.set(data.orderNo, row)
    return row
  })
  stub('customerOrderFulfillmentIntent', 'findUnique', async ({ where }: Row) => {
    if (failPostCommitStoreLookup && intents.size > 0) throw new Error('RECEIPT_LOOKUP_AFTER_COMMIT_FAILED')
    if (where.id) return [...intents.values()].find((intent) => intent.id === where.id) ?? null
    const key = where.tenantId_storeId_orderNo_role
    return intents.get(`${key.tenantId}:${key.storeId}:${key.orderNo}:${key.role}`) ?? null
  })
  stub('customerOrderFulfillmentIntent', 'create', async ({ data }: Row) => {
    const key = `${data.tenantId}:${data.storeId}:${data.orderNo}:${data.role}`
    if (intents.has(key)) throw new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7.6.0', meta: { modelName: 'CustomerOrderFulfillmentIntent', target: ['tenantId', 'storeId', 'orderNo', 'role'] } })
    const row = { id: `intent-${intents.size + 1}`, ...data }
    intents.set(key, row)
    return row
  })
  stub('customerOrderFulfillmentIntent', 'update', async ({ where, data }: Row) => {
    const row = [...intents.values()].find((intent) => intent.id === where.id)
    if (!row) throw new Error('intent missing')
    for (const [key, value] of Object.entries(data)) row[key] = (value as any)?.increment != null ? row[key] + (value as any).increment : value
    return row
  })
  stub('customerOrderFulfillmentIntent', 'updateMany', async ({ where, data }: Row) => {
    const row = [...intents.values()].find((intent) => intent.id === where.id)
    if (!row) return { count: 0 }
    for (const [key, value] of Object.entries(data)) row[key] = (value as any)?.increment != null ? row[key] + (value as any).increment : value
    return { count: 1 }
  })
  stub('v3PrintControlPlane', 'findUnique', async () => controlPlaneMode ? { tenantId: 'tenant-a', mode: controlPlaneMode } : null)
  stub('eshopTrayPrintJob', 'create', async ({ data }: Row) => {
    if (jobs.some((job) => job.tenantId === data.tenantId && job.storeId === data.storeId && job.idempotencyKey === data.idempotencyKey)) {
      throw new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002', clientVersion: '7.6.0', meta: { target: ['tenantId', 'storeId', 'idempotencyKey'], modelName: 'EshopTrayPrintJob' },
      })
    }
    const row = { id: `job-${jobs.length + 1}`, ...data }
    jobs.push(row)
    return row
  })
  stub('eshopTrayPrintJob', 'findUnique', async ({ where }: Row) => jobs.find((job) => job.tenantId === where.tenantId_storeId_idempotencyKey.tenantId
    && job.storeId === where.tenantId_storeId_idempotencyKey.storeId
    && job.idempotencyKey === where.tenantId_storeId_idempotencyKey.idempotencyKey) ?? null)
  stub('eshopTrayPrintJob', 'findMany', async () => jobs)
  stub('eshopTrayPrintJob', 'updateMany', async () => ({ count: 1 }))
  const originalQueryRaw = db.$queryRaw
  db.$queryRaw = async () => [{ status: 'CONFIRMED' }]
  originals.push(() => { db.$queryRaw = originalQueryRaw })
  const originalTransaction = db.$transaction
  db.$transaction = (operation: (tx: Row) => Promise<unknown>) => {
    if (failNextTransaction) {
      failNextTransaction = false
      return Promise.reject(new Error('TRANSACTION_FAILED_BEFORE_COMMIT'))
    }
    const run = transactionTail.then(() => operation(db))
    transactionTail = run.then(() => undefined, () => undefined)
    return run
  }
  originals.push(() => { db.$transaction = originalTransaction })

  return {
    orders,
    paymentIntents,
    intents,
    jobs,
    addOrder,
    setControlPlaneMode: (mode: string | null) => { controlPlaneMode = mode },
    setKitchenEnabled: (enabled: boolean) => { kitchenEnabled = enabled },
    setPostCommitStoreLookupFailure: (enabled: boolean) => { failPostCommitStoreLookup = enabled },
    failNextTransaction: () => { failNextTransaction = true },
    restore: () => originals.reverse().forEach((restore) => restore()),
  }
}

test('H5 route confirms once, records payment separately, and never reprints kitchen on collection', async () => {
  const f = fixture()
  try {
    const confirmed = await patchOrder('order-a', { status: 'CONFIRMED' })
    assert.equal(confirmed.status, 200)
    assert.equal((await confirmed.json()).printStatus, 'PROCESSING')
    assert.equal(f.jobs.length, 0)
    assert.equal(f.orders.get('order-a')!.paymentStatus, 'UNPAID')

    const repeatedConfirmation = await patchOrder('order-a', { status: 'CONFIRMED' })
    assert.equal(repeatedConfirmation.status, 200)
    assert.equal((await repeatedConfirmation.json()).printStatus, 'PROCESSING')
    assert.equal(f.intents.size, 1)
    assert.equal(f.jobs.length, 0)

    const completed = await patchOrder('order-a', { status: 'COMPLETED' })
    assert.equal(completed.status, 200)
    assert.equal(f.jobs.length, 0)

    const collected = await patchOrder('order-a', { paymentMethod: 'CASH' })
    const collectedBody = await collected.json()
    assert.equal(collected.status, 200)
    assert.equal(collectedBody.paymentStatus, 'PAID')
    assert.equal(collectedBody.printStatus, 'PROCESSING')
    assert.equal(f.orders.get('order-a')!.paymentStatus, 'PAID')
    assert.equal(f.paymentIntents.get('H5-ORDER-A')!.paymentMethod, 'CASH')
    assert.equal(f.paymentIntents.get('H5-ORDER-A')!.transactionActorType, 'H5_CUSTOMER_ORDER')
    assert.equal(f.jobs.length, 0)

    const duplicate = await patchOrder('order-a', { paymentMethod: 'CASH' })
    assert.equal(duplicate.status, 200)
    assert.equal((await duplicate.json()).printStatus, 'PROCESSING')
    assert.equal(f.jobs.length, 0)
  } finally {
    f.restore()
  }
})

test('confirmed H5 status schedules a real cashier notification after commit', async () => {
  const f = fixture()
  const previousEnabled = process.env.NEXT_PUBLIC_CASHIER_REALTIME_ENABLED
  const previousGateway = process.env.CASHIER_REALTIME_GATEWAY_URL
  const previousSecret = process.env.CASHIER_REALTIME_NOTIFY_SECRET
  const previousFetch = globalThis.fetch
  const requests: Array<{ url: string; body: Row }> = []
  process.env.NEXT_PUBLIC_CASHIER_REALTIME_ENABLED = '1'
  process.env.CASHIER_REALTIME_GATEWAY_URL = 'http://127.0.0.1:8787'
  process.env.CASHIER_REALTIME_NOTIFY_SECRET = 'cashier-realtime-test-secret-0123456789'
  globalThis.fetch = (async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) })
    return new Response(null, { status: 202 })
  }) as typeof fetch
  try {
    const callbacks: Array<() => unknown> = []
    const response = await patchOrder('order-a', { status: 'CONFIRMED' }, callbacks)
    assert.equal(response.status, 200)
    assert.equal(callbacks.length, 1)
    await callbacks[0]()
    assert.equal(requests.length, 1)
    assert.equal(requests[0].url, 'http://127.0.0.1:8787/notify')
    assert.deepEqual(requests[0].body, {
      version: 1,
      tenantId: 'tenant-a',
      storeId: 'store-a',
      type: 'orders_changed',
      timestamp: requests[0].body.timestamp,
      eventId: requests[0].body.eventId,
    })
  } finally {
    f.restore()
    if (previousEnabled == null) delete process.env.NEXT_PUBLIC_CASHIER_REALTIME_ENABLED
    else process.env.NEXT_PUBLIC_CASHIER_REALTIME_ENABLED = previousEnabled
    if (previousGateway == null) delete process.env.CASHIER_REALTIME_GATEWAY_URL
    else process.env.CASHIER_REALTIME_GATEWAY_URL = previousGateway
    if (previousSecret == null) delete process.env.CASHIER_REALTIME_NOTIFY_SECRET
    else process.env.CASHIER_REALTIME_NOTIFY_SECRET = previousSecret
    globalThis.fetch = previousFetch
  }
})

test('cancel and idempotent status updates notify only after a committed transition', async () => {
  const f = fixture()
  const previousEnabled = process.env.NEXT_PUBLIC_CASHIER_REALTIME_ENABLED
  const previousGateway = process.env.CASHIER_REALTIME_GATEWAY_URL
  const previousSecret = process.env.CASHIER_REALTIME_NOTIFY_SECRET
  const previousFetch = globalThis.fetch
  const requests: unknown[] = []
  process.env.NEXT_PUBLIC_CASHIER_REALTIME_ENABLED = '1'
  process.env.CASHIER_REALTIME_GATEWAY_URL = 'http://127.0.0.1:8787'
  process.env.CASHIER_REALTIME_NOTIFY_SECRET = 'cashier-realtime-test-secret-0123456789'
  globalThis.fetch = (async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)))
    return new Response(null, { status: 202 })
  }) as typeof fetch
  try {
    const confirmedCallbacks: Array<() => unknown> = []
    const confirmed = await patchOrder('order-a', { status: 'CONFIRMED' }, confirmedCallbacks)
    assert.equal(confirmed.status, 200)
    assert.equal(confirmedCallbacks.length, 1)
    const confirmedNotification = await confirmedCallbacks[0]() as any
    assert.equal(confirmedNotification.ok, true)

    const repeatedCallbacks: Array<() => unknown> = []
    const repeated = await patchOrder('order-a', { status: 'CONFIRMED' }, repeatedCallbacks)
    assert.equal(repeated.status, 200)
    assert.equal(repeatedCallbacks.length, 0)

    const cancelledCallbacks: Array<() => unknown> = []
    const cancelled = await patchOrder('order-a', { status: 'CANCELLED' }, cancelledCallbacks)
    assert.equal(cancelled.status, 200)
    assert.equal(cancelledCallbacks.length, 1)
    const cancelledNotification = await cancelledCallbacks[0]() as any
    assert.equal(cancelledNotification.ok, true)
    assert.equal(requests.length, 2)

    f.failNextTransaction()
    const failedCallbacks: Array<() => unknown> = []
    await assert.rejects(patchOrder('order-a', { status: 'CONFIRMED' }, failedCallbacks), /TRANSACTION_FAILED_BEFORE_COMMIT/)
    assert.equal(failedCallbacks.length, 0)
  } finally {
    f.restore()
    if (previousEnabled == null) delete process.env.NEXT_PUBLIC_CASHIER_REALTIME_ENABLED
    else process.env.NEXT_PUBLIC_CASHIER_REALTIME_ENABLED = previousEnabled
    if (previousGateway == null) delete process.env.CASHIER_REALTIME_GATEWAY_URL
    else process.env.CASHIER_REALTIME_GATEWAY_URL = previousGateway
    if (previousSecret == null) delete process.env.CASHIER_REALTIME_NOTIFY_SECRET
    else process.env.CASHIER_REALTIME_NOTIFY_SECRET = previousSecret
    globalThis.fetch = previousFetch
  }
})

test('concurrent collection is idempotent and V3 failure does not roll back the payment fact', async () => {
  const f = fixture()
  f.addOrder('order-b', 'H5-ORDER-B', { status: 'COMPLETED' })
  f.addOrder('order-c', 'H5-ORDER-C', { status: 'COMPLETED' })
  try {
    const firstCallbacks: Array<() => unknown> = []
    const secondCallbacks: Array<() => unknown> = []
    const responses = await Promise.all([
      patchOrder('order-b', { paymentMethod: 'QR' }, firstCallbacks),
      patchOrder('order-b', { paymentMethod: 'QR' }, secondCallbacks),
    ])
    assert.deepEqual(responses.map((response) => response.status), [200, 200])
    assert.equal(f.paymentIntents.get('H5-ORDER-B')!.paymentMethod, 'KHQR')
    assert.equal(f.jobs.filter((job) => job.payload.role === 'FRONT').length, 0)
    assert.equal(firstCallbacks.length, 0)
    assert.equal(secondCallbacks.length, 0)

    f.setControlPlaneMode(null)
    const unavailable = await patchOrder('order-c', { paymentMethod: 'CASH' })
    const body = await unavailable.json()
    assert.equal(unavailable.status, 200)
    assert.equal(body.businessStatus, 'SUCCEEDED')
    assert.equal(body.printStatus, 'PROCESSING')
    assert.equal(f.orders.get('order-c')!.paymentStatus, 'PAID')
    assert.equal(f.paymentIntents.has('H5-ORDER-C'), true)
    assert.equal(f.jobs.filter((job) => job.payload.orderNo === 'H5-ORDER-C').length, 0)
  } finally {
    f.restore()
  }
})

test('post-commit store or receipt lookup failure still returns the committed collection', async () => {
  const f = fixture()
  f.addOrder('order-post-commit-print-error', 'H5-POST-COMMIT-PRINT-ERROR', { status: 'COMPLETED' })
  f.setPostCommitStoreLookupFailure(true)
  const previousEnabled = process.env.NEXT_PUBLIC_CASHIER_REALTIME_ENABLED
  const previousGateway = process.env.CASHIER_REALTIME_GATEWAY_URL
  const previousSecret = process.env.CASHIER_REALTIME_NOTIFY_SECRET
  const previousFetch = globalThis.fetch
  let notifyCount = 0
  process.env.NEXT_PUBLIC_CASHIER_REALTIME_ENABLED = '1'
  process.env.CASHIER_REALTIME_GATEWAY_URL = 'http://127.0.0.1:8787'
  process.env.CASHIER_REALTIME_NOTIFY_SECRET = 'cashier-realtime-test-secret-0123456789'
  globalThis.fetch = (async () => {
    notifyCount += 1
    return new Response(null, { status: 202 })
  }) as typeof fetch
  try {
    const callbacks: Array<() => unknown> = []
    const response = await patchOrder('order-post-commit-print-error', { paymentMethod: 'CASH' }, callbacks)
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(body.businessStatus, 'SUCCEEDED')
    assert.equal(body.paymentStatus, 'PAID')
    assert.equal(body.printStatus, 'FAILED')
    assert.equal(f.orders.get('order-post-commit-print-error')!.paymentStatus, 'PAID')
    // Pure collection is intentionally not a cashier wake event. The
    // existing frozen semantics only notify for a qualifying order-state
    // transition; print failure must not add a new notification side effect.
    assert.equal(callbacks.length, 0)
    assert.equal(notifyCount, 0)
  } finally {
    f.restore()
    if (previousEnabled == null) delete process.env.NEXT_PUBLIC_CASHIER_REALTIME_ENABLED
    else process.env.NEXT_PUBLIC_CASHIER_REALTIME_ENABLED = previousEnabled
    if (previousGateway == null) delete process.env.CASHIER_REALTIME_GATEWAY_URL
    else process.env.CASHIER_REALTIME_GATEWAY_URL = previousGateway
    if (previousSecret == null) delete process.env.CASHIER_REALTIME_NOTIFY_SECRET
    else process.env.CASHIER_REALTIME_NOTIFY_SECRET = previousSecret
    globalThis.fetch = previousFetch
  }
})

test('expired and manual-review cancellation evidence is stable across the first and repeated request', async () => {
  const f = fixture()
  f.addOrder('order-expired-cancel', 'H5-EXPIRED-CANCEL')
  f.addOrder('order-manual-cancel', 'H5-MANUAL-CANCEL')
  try {
    await patchOrder('order-expired-cancel', { status: 'CONFIRMED' })
    f.intents.get('tenant-a:store-a:H5-EXPIRED-CANCEL:KITCHEN')!.state = 'EXPIRED'
    const expiredFirst = await patchOrder('order-expired-cancel', { status: 'CANCELLED' })
    const expiredRepeat = await patchOrder('order-expired-cancel', { status: 'CANCELLED' })
    assert.equal((await expiredFirst.json()).printStatus, 'EXPIRED')
    assert.equal((await expiredRepeat.json()).printStatus, 'EXPIRED')

    await patchOrder('order-manual-cancel', { status: 'CONFIRMED' })
    const manualIntent = f.intents.get('tenant-a:store-a:H5-MANUAL-CANCEL:KITCHEN')!
    manualIntent.state = 'MANUAL_REVIEW'
    manualIntent.manualReviewReason = 'CUSTOMER_ORDER_KITCHEN_ROUTE_MARKER_MISSING'
    const manualFirst = await patchOrder('order-manual-cancel', { status: 'CANCELLED' })
    const manualRepeat = await patchOrder('order-manual-cancel', { status: 'CANCELLED' })
    assert.equal((await manualFirst.json()).printStatus, 'MANUAL_REVIEW')
    assert.equal((await manualRepeat.json()).printStatus, 'MANUAL_REVIEW')
  } finally {
    f.restore()
  }
})

test('expired claimed jobs are unknown while expired unclaimed jobs are definitely expired', async () => {
  const now = new Date('2026-10-05T00:00:00.000Z')
  assert.equal(customerOrderJobEvidence({
    status: 'PENDING', resultStatus: null, claimTokenHash: 'claimed', expiresAt: new Date(now.getTime() - 1), completedAt: null, effectBoundary: null,
  }, now), 'RESULT_UNKNOWN')
  assert.equal(customerOrderJobEvidence({
    status: 'PENDING', resultStatus: null, claimTokenHash: null, expiresAt: new Date(now.getTime() - 1), completedAt: null, effectBoundary: null,
  }, now), 'EXPIRED')
  assert.equal(customerOrderJobEvidence({
    status: 'FAILED', resultStatus: 'CROSSING_UNKNOWN', claimTokenHash: null, expiresAt: new Date(now.getTime() - 1), completedAt: null, effectBoundary: 'CROSSING_UNKNOWN',
  }, now), 'RESULT_UNKNOWN')
})

test('confirmation succeeds without a kitchen job when the store is disabled or the snapshot has no routed items', async () => {
  const f = fixture()
  f.addOrder('order-no-kitchen-setting', 'H5-NO-KITCHEN-SETTING')
  f.addOrder('order-no-kitchen-items', 'H5-NO-KITCHEN-ITEMS', {
    itemsJson: JSON.stringify([{ productId: 'p-front', name: '前台商品', spec: null, originalPrice: 4.5, price: 4.5, quantity: 1, lineAmount: 4.5, printKitchenTicket: false }]),
  })
  try {
    f.setKitchenEnabled(false)
    const disabled = await patchOrder('order-no-kitchen-setting', { status: 'CONFIRMED' })
    const disabledBody = await disabled.json()
    assert.equal(disabled.status, 200)
    assert.equal(disabledBody.businessStatus, 'SUCCEEDED')
    assert.equal(disabledBody.printStatus, 'NOT_REQUIRED')
    assert.equal(f.jobs.length, 0)

    f.setKitchenEnabled(true)
    const noItems = await patchOrder('order-no-kitchen-items', { status: 'CONFIRMED' })
    const noItemsBody = await noItems.json()
    assert.equal(noItems.status, 200)
    assert.equal(noItemsBody.printStatus, 'NOT_REQUIRED')
    assert.equal(f.jobs.length, 0)

    const cancelled = await patchOrder('order-no-kitchen-setting', { status: 'CANCELLED' })
    assert.equal(cancelled.status, 200)
    assert.equal((await cancelled.json()).printStatus, 'NOT_REQUIRED')
  } finally {
    f.restore()
  }
})

test('legacy orders without an explicit kitchen marker are confirmed but require manual review', async () => {
  const f = fixture()
  f.addOrder('order-legacy', 'H5-LEGACY', {
    itemsJson: JSON.stringify([{ productId: 'p-old', name: '旧商品', spec: null, originalPrice: 2, price: 2, quantity: 1, lineAmount: 2 }]),
  })
  try {
    const response = await patchOrder('order-legacy', { status: 'CONFIRMED' })
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(body.businessStatus, 'SUCCEEDED')
    assert.equal(body.printStatus, 'MANUAL_REVIEW')
    assert.equal(f.orders.get('order-legacy')!.status, 'CONFIRMED')
    assert.equal(f.jobs.length, 0)
  } finally {
    f.restore()
  }
})

test('cancelling an unclaimed H5 kitchen intent marks it terminal and remains idempotent', async () => {
  const f = fixture()
  try {
    const confirmed = await patchOrder('order-a', { status: 'CONFIRMED' })
    assert.equal(confirmed.status, 200)
    const cancelled = await patchOrder('order-a', { status: 'CANCELLED' })
    const body = await cancelled.json()
    assert.equal(cancelled.status, 200)
    assert.equal(body.printStatus, 'NOT_REQUIRED')
    assert.equal(f.intents.get('tenant-a:store-a:H5-ORDER-A:KITCHEN')!.state, 'CANCELLED')
    assert.equal(f.jobs.length, 0)
    const repeated = await patchOrder('order-a', { status: 'CANCELLED' })
    assert.equal(repeated.status, 200)
    assert.equal((await repeated.json()).printStatus, 'NOT_REQUIRED')

    // A persisted claimed/unknown result must survive a duplicate CANCELLED
    // request; it must not be downgraded to "no kitchen print".
    const kitchenIntent = f.intents.get('tenant-a:store-a:H5-ORDER-A:KITCHEN')!
    kitchenIntent.cancelResultCode = 'KITCHEN_TASK_REQUIRES_MANUAL_VERIFICATION'
    kitchenIntent.manualReviewReason = 'KITCHEN_TASK_REQUIRES_MANUAL_VERIFICATION'
    f.orders.get('order-a')!.status = 'CANCELLED'
    const repeatedUnknown = await patchOrder('order-a', { status: 'CANCELLED' })
    assert.equal(repeatedUnknown.status, 200)
    assert.equal((await repeatedUnknown.json()).printStatus, 'MANUAL_REVIEW')
  } finally {
    f.restore()
  }
})
