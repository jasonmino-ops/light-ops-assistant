import assert from 'node:assert/strict'
import test from 'node:test'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'

;(globalThis as any).AsyncLocalStorage = AsyncLocalStorage
type Row = Record<string, any>
let POST: any, NextRequest: any, workAsyncStorage: any
async function runtime() {
  if (POST) return
  ;({ NextRequest } = await import('next/server'))
  ;({ workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external'))
  ;({ POST } = await import('../app/api/public/orders/route'))
}

// In-process transaction simulation: rollback/notification behavior, NOT evidence
// of PostgreSQL locks, isolation or unique constraints. Real DB cases live in the DB lane.
function fixture() {
  const rows: Row[] = [], redemptions: Row[] = [], callbacks: Array<() => unknown> = [], productQueries: Row[] = []
  const store = { id: 's', tenantId: 't', code: 'SYNTH-A', name: 'Synthetic', status: 'ACTIVE' }
  const coupon = { id: 'c', name: 'Synthetic coupon', type: 'AMOUNT_OFF', amountOff: 1, percentOff: 0, minSpend: new Prisma.Decimal(0), expiresAt: new Date('2099-01-01'), status: 'AVAILABLE' }
  let price = 5, max = BigInt(0), failRedemption = false, couponClaimLost = false, failOwner = false, failTx: any = null, rollbackCount = 0, findAfterFailure = 0
  let discountEnabled = false, discountPrice: number | null = null
  const additionalProducts: Row[] = []
  const db = prisma as any, undo: Array<() => void> = []
  const replace = (object: any, key: string, fn: any) => { const before = object[key]; object[key] = fn; undo.push(() => { object[key] = before }) }
  replace(db.store, 'findUnique', async ({ where }: Row) => where.code === store.code ? store : null)
  replace(db.store, 'findFirst', async () => store)
  replace(db.product, 'findMany', async (query: Row) => {
    productQueries.push(query)
    assert.equal(query.where.tenantId, store.tenantId)
    assert.equal(query.where.status, 'ACTIVE')
    const products = [{ id: 'p', name: 'Synthetic tea', spec: null, sellPrice: new Prisma.Decimal(price), discountEnabled,
      discountPrice: discountPrice === null ? null : new Prisma.Decimal(discountPrice), printKitchenTicket: true }, ...additionalProducts]
    // Emulate projection rather than returning fields omitted by the real query.
    return products.filter(p => query.where.id.in.includes(p.id)).map(p => Object.fromEntries(
      Object.keys(query.select).filter(k => query.select[k] === true).map(k => [k, p[k]])))
  })
  replace(db.customerOrder, 'findUnique', async ({ where }: Row) => {
    if (rollbackCount) findAfterFailure++
    const k = where.tenantId_storeId_submissionKey
    return rows.find(r => r.tenantId === k.tenantId && r.storeId === k.storeId && r.submissionKey === k.submissionKey) ?? null
  })
  replace(db.customerOrder, 'create', async ({ data }: Row) => { const r = { id: `o-${rows.length}`, ...data }; rows.push(r); max++; return r })
  replace(db.customerCoupon, 'findFirst', async () => coupon.status === 'AVAILABLE' ? coupon : null)
  replace(db.customerCoupon, 'updateMany', async () => { if (couponClaimLost || coupon.status !== 'AVAILABLE') return { count: 0 }; coupon.status = 'USED'; return { count: 1 } })
  replace(db.couponRedemption, 'create', async ({ data }: Row) => { if (failRedemption) throw new Error('SYNTHETIC_REDEMPTION_FAILURE'); redemptions.push(data); return data })
  replace(db.user, 'findFirst', async () => { if (failOwner) throw new Error('SYNTHETIC_NOTIFY_FAILURE'); return null })
  replace(db, '$queryRaw', async (sql: TemplateStringsArray) => sql.join('').includes('MAX(') ? [{ max: max.toString() }] : [{ locked: true }])
  replace(db, '$transaction', async (fn: any) => {
    const count = rows.length, redemptionCount = redemptions.length, status = coupon.status, oldMax = max
    try { if (failTx) { const e = failTx; failTx = null; throw e }; return await fn(db) }
    catch (e) { rows.splice(count); redemptions.splice(redemptionCount); coupon.status = status; max = oldMax; rollbackCount++; throw e }
  })
  const submit = async (body: Row, key: string | null = randomUUID(), rejectAfter = false) => {
    await runtime()
    const req = new NextRequest('https://synthetic.test/api/public/orders', { method: 'POST', headers: { 'content-type': 'application/json', ...(key === null ? {} : { 'idempotency-key': key }) }, body: JSON.stringify(body) })
    const res = await workAsyncStorage.run({ afterContext: { after: (fn: () => unknown) => { if (rejectAfter) throw new Error('AFTER_CONTEXT_FAILURE'); callbacks.push(fn) } } }, () => POST(req))
    return { status: res.status, body: await res.json() }
  }
  return { rows, redemptions, coupon, store, callbacks, productQueries, additionalProducts, submit,
    body: { storeCode: store.code, items: [{ productId: 'p', quantity: 1 }], lang: 'en' },
    price: (n: number) => { price = n }, max: (n: bigint) => { max = n },
    productDiscount: (enabled: boolean, amount: number | null) => { discountEnabled = enabled; discountPrice = amount },
    redemptionFailure: (v: boolean) => { failRedemption = v }, couponClaimLost: () => { couponClaimLost = true }, notificationFailure: () => { failOwner = true },
    txFailure: (e: unknown) => { failTx = e }, failures: () => ({ rollbackCount, findAfterFailure }), restore: () => undo.reverse().forEach(fn => fn()),
  }
}

test('real public POST preserves original/discount prices, quantities and kitchen fields with coupons and immutable retries', async () => {
  const f = fixture(); try {
    f.price(10); f.productDiscount(true, 7.5); f.coupon.amountOff = 2
    f.additionalProducts.push({ id: 'p2', name: 'Synthetic side', spec: 'Large', sellPrice: new Prisma.Decimal(3),
      discountEnabled: false, discountPrice: new Prisma.Decimal(1), printKitchenTicket: false })
    const key = randomUUID(), body = { ...f.body, items: [{ productId: 'p', quantity: 2 }, { productId: 'p2', quantity: 1 }],
      couponId: 'c', customerTelegramId: 'synthetic-customer' }
    const result = await f.submit(body, key)
    assert.equal(result.status, 200)
    assert.equal(result.body.subtotal, 23); assert.equal(result.body.discountAmount, 7)
    assert.equal(result.body.totalAmount, 16); assert.equal(result.body.payableAmount, 16); assert.equal(result.body.itemCount, 3)
    assert.equal(f.rows.length, 1); assert.equal(f.rows[0].totalAmount, '16.00')
    assert.deepEqual(f.rows[0].submissionResponse, result.body)
    assert.deepEqual(JSON.parse(f.rows[0].itemsJson), [
      { productId: 'p', name: 'Synthetic tea', spec: null, originalPrice: 10, price: 7.5, quantity: 2, lineAmount: 15, printKitchenTicket: true },
      { productId: 'p2', name: 'Synthetic side', spec: 'Large', originalPrice: 3, price: 3, quantity: 1, lineAmount: 3, printKitchenTicket: false },
    ])
    assert.equal(f.redemptions.length, 1); assert.equal(f.redemptions[0].discountAmount, '2.00')
    assert.equal(f.rows[0].status, 'PENDING'); assert.equal(f.rows[0].paymentMethod, undefined)
    assert.equal(f.productQueries[0].select.discountPrice, true); assert.equal(f.productQueries[0].select.discountEnabled, true)
    const savedItems = f.rows[0].itemsJson
    f.price(99); f.productDiscount(true, 50)
    assert.deepEqual(await f.submit(body, key), result)
    assert.equal(f.rows[0].itemsJson, savedItems); assert.equal(f.productQueries.length, 1)
    assert.equal(f.redemptions.length, 1); assert.equal(f.callbacks.length, 1)
  } finally { f.restore() }
})

test('real public POST uses full price when discount is disabled or absent and caps coupon at the discounted subtotal', async () => {
  for (const [enabled, amount] of [[false, 1], [true, null]] as const) {
    const f = fixture(); try {
      f.price(5); f.productDiscount(enabled, amount)
      const result = await f.submit({ ...f.body, items: [{ productId: 'p', quantity: 2 }] })
      assert.equal(result.status, 200); assert.equal(result.body.totalAmount, 10); assert.equal(result.body.discountAmount, 0)
      assert.equal(JSON.parse(f.rows[0].itemsJson)[0].price, 5)
      assert.deepEqual(f.rows[0].submissionResponse, result.body)
    } finally { f.restore() }
  }
  const f = fixture(); try {
    f.price(10); f.productDiscount(true, 6); f.coupon.amountOff = 50
    const result = await f.submit({ ...f.body, couponId: 'c', customerTelegramId: 'synthetic-customer' })
    assert.equal(result.status, 200); assert.equal(result.body.subtotal, 10)
    assert.equal(result.body.discountAmount, 10); assert.equal(result.body.payableAmount, 0)
    assert.equal(f.rows[0].totalAmount, '0.00'); assert.equal(f.redemptions[0].discountAmount, '6.00')
  } finally { f.restore() }
})

test('real public POST applies percentage and minimum-spend rules to the discounted subtotal, not the original subtotal', async () => {
  const f = fixture(); try {
    f.price(10); f.productDiscount(true, 6); f.coupon.type = 'PERCENT_OFF'; f.coupon.percentOff = 25
    const body = { ...f.body, couponId: 'c', customerTelegramId: 'synthetic-customer' }, key = randomUUID()
    f.coupon.minSpend = new Prisma.Decimal(8)
    const denied = await f.submit(body, key)
    assert.equal(denied.status, 400); assert.equal(denied.body.error, 'COUPON_MIN_NOT_MET')
    assert.equal(f.rows.length, 0); assert.equal(f.redemptions.length, 0); assert.equal(f.callbacks.length, 0)
    f.coupon.minSpend = new Prisma.Decimal(6)
    const result = await f.submit(body, key)
    assert.equal(result.status, 200); assert.equal(result.body.subtotal, 10)
    assert.equal(result.body.discountAmount, 5.5); assert.equal(result.body.payableAmount, 4.5)
    assert.equal(f.rows[0].totalAmount, '4.50'); assert.equal(f.redemptions[0].discountAmount, '1.50')
  } finally { f.restore() }
})

test('public submission requires UUID key before any database call', async () => {
  const f = fixture(); try { assert.equal((await f.submit(f.body, null)).status, 400); assert.equal((await f.submit(f.body, 'guess')).status, 400); assert.equal(f.rows.length, 0) } finally { f.restore() }
})

test('coupon CAS conflict is explicitly not committed, unlike an accepted-key identity conflict', async () => {
  const f = fixture(); try {
    const key = randomUUID()
    f.couponClaimLost()
    const rejected = await f.submit({ ...f.body, couponId: 'c', customerTelegramId: 'synthetic-customer' }, key)
    assert.equal(rejected.status, 409)
    assert.equal(rejected.body.error, 'COUPON_ALREADY_USED')
    assert.equal(rejected.body.submissionState, 'NOT_COMMITTED')
    assert.equal(f.rows.length, 0); assert.equal(f.redemptions.length, 0); assert.equal(f.callbacks.length, 0)
    const freshKey = randomUUID(), fresh = await f.submit(f.body, freshKey)
    assert.equal(fresh.status, 200); assert.equal(f.rows.length, 1)
    const conflict = await f.submit({ ...f.body, tableNo: 'changed' }, freshKey)
    assert.equal(conflict.status, 409); assert.equal(conflict.body.error, 'IDEMPOTENCY_KEY_CONFLICT')
    assert.equal(f.rows.length, 1)
  } finally { f.restore() }
})

test('same normalized request and reordered object keys replay immutable receipt; fresh key permits additional order', async () => {
  const f = fixture(); try {
    const key = randomUUID(), first = await f.submit(f.body, key)
    assert.equal(first.status, 200); f.price(99); f.store.status = 'DISABLED'
    const retry = await f.submit({ lang: 'en', items: [{ quantity: 1, productId: 'p', sugar: null }], storeCode: ' SYNTH-A ', remark: '' }, key)
    assert.deepEqual(retry, first); assert.equal(f.rows.length, 1); assert.equal(f.callbacks.length, 1)
    assert.equal((await f.submit(f.body)).status, 404)
    f.store.status = 'ACTIVE'; assert.equal((await f.submit(f.body)).status, 200); assert.equal(f.rows.length, 2)
    assert.equal(f.rows[0].status, 'PENDING'); assert.equal(f.rows[0].paymentMethod, undefined)
  } finally { f.restore() }
})

test('same key rejects changed consumed fields without mutation or repeat notifications', async () => {
  const f = fixture(); try {
    const key = randomUUID(); assert.equal((await f.submit(f.body, key)).status, 200)
    for (const changed of [{ items: [{ productId: 'p', quantity: 2 }] }, { remark: 'changed' }, { tableNo: 'B2' }, { couponId: 'c' }, { customerPhone: '123' }, { deliveryLat: 11 }, { lang: 'km' }, { campaignCode: 'campaign' }]) {
      const r = await f.submit({ ...f.body, ...changed }, key)
      assert.equal(r.status, 409); assert.equal(r.body.error, 'IDEMPOTENCY_KEY_CONFLICT')
    }
    assert.equal(f.rows.length, 1); assert.equal(f.callbacks.length, 1)
  } finally { f.restore() }
})

test('coupon, receipt and order roll back together; retry reuses key; committed coupon replay is not re-redeemed', async () => {
  const f = fixture(); try {
    const key = randomUUID(), body = { ...f.body, couponId: 'c', customerTelegramId: 'synthetic-customer' }
    f.redemptionFailure(true); assert.equal((await f.submit(body, key)).status, 500)
    assert.equal(f.rows.length, 0); assert.equal(f.coupon.status, 'AVAILABLE'); assert.equal(f.callbacks.length, 0)
    f.redemptionFailure(false); const result = await f.submit(body, key); assert.equal(result.status, 200); assert.equal(result.body.totalAmount, 4)
    assert.deepEqual(await f.submit(body, key), result); assert.equal(f.redemptions.length, 1); assert.equal(f.callbacks.length, 1)
  } finally { f.restore() }
})

test('post-commit scheduling/owner failures do not turn accepted order into 500', async () => {
  const f = fixture(); try {
    f.notificationFailure(); const key = randomUUID(), accepted = await f.submit(f.body, key, true)
    assert.equal(accepted.status, 200); assert.equal(f.rows.length, 1); assert.deepEqual(await f.submit(f.body, key), accepted)
  } finally { f.restore() }
})

test('numeric sequence preserves >9999 without wrap; orderNo P2002 retries outside failed transaction', async () => {
  const f = fixture(); try {
    f.max(BigInt(9999)); f.txFailure(new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7.6.0', meta: { target: ['orderNo'] } }))
    const r = await f.submit(f.body); assert.equal(r.status, 200); assert.match(r.body.orderNo, /-10000$/)
    assert.equal(f.failures().rollbackCount, 1); assert.ok(f.failures().findAfterFailure > 0)
    assert.match((await f.submit(f.body)).body.orderNo, /-10001$/)
  } finally { f.restore() }
})

test('structured retryable errors preserve same-key instruction; unrelated SQL errors stay failures', async () => {
  const f = fixture(); try {
    for (const code of ['40001', '40P01', '55P03', '23514']) {
      f.txFailure(new Prisma.PrismaClientKnownRequestError('synthetic SQL', { code: 'P2010', clientVersion: '7.6.0', meta: { code } }))
      const r = await f.submit(f.body); assert.equal(r.status, code === '23514' ? 500 : 503); assert.equal(r.body.retryWithSameKey, true)
    }
    assert.equal(f.rows.length, 0); assert.equal(f.callbacks.length, 0)
  } finally { f.restore() }
})

test('submission-key unique conflict without a verifiable receipt is not invented success; unknown constraints not swallowed', async () => {
  const f = fixture(); try {
    f.txFailure(new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7.6.0', meta: { target: ['tenantId', 'storeId', 'submissionKey'] } }))
    assert.equal((await f.submit(f.body)).status, 503)
    // Captured from real Prisma 7.6 adapter-pg / PostgreSQL 16 isolated test.
    f.txFailure(new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7.6.0', meta: {
      modelName: 'CustomerOrder', driverAdapterError: { cause: { originalCode: '23505', kind: 'UniqueConstraintViolation', constraint: { fields: ['"tenantId"', '"storeId"', '"submissionKey"'] } } },
    } }))
    assert.equal((await f.submit(f.body)).status, 503)
    f.txFailure(new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7.6.0', meta: { target: ['unrelated'] } }))
    assert.equal((await f.submit(f.body)).status, 500); assert.equal(f.rows.length, 0)
  } finally { f.restore() }
})
