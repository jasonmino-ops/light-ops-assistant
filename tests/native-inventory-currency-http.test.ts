import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { prisma } from '../lib/prisma'
import { signSession } from '../lib/session'

const runtime = new URL(process.env.NATIVE_INVENTORY_UI_TEST_URL ?? 'http://invalid')
const database = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/invalid')
if (process.env.NATIVE_INVENTORY_TEST_DATABASE !== '1' || !['127.0.0.1', 'localhost'].includes(runtime.hostname) ||
    !['127.0.0.1', 'localhost'].includes(database.hostname) || !/^\/native_inventory_test_[a-z0-9_]+$/.test(database.pathname)) {
  throw new Error('A loopback Next.js server and an isolated native_inventory_test_* database are required')
}

test('native inventory pins order and settlement currency across real concurrent POS and H5 requests', async (t) => {
  t.after(() => prisma.$disconnect())
  const tenant = await prisma.tenant.create({ data: { name: 'Native inventory currency HTTP' } })
  const store = await prisma.store.create({ data: {
    tenantId: tenant.id, code: randomUUID(), name: 'Currency fixture', currencyCode: 'USD', checkoutMode: 'DEFERRED_PAYMENT',
  } })
  const scope = { tenantId: tenant.id, storeId: store.id }
  const user = await prisma.user.create({ data: { tenantId: tenant.id, username: randomUUID(), role: 'OWNER', displayName: 'Owner' } })
  await prisma.userStoreRole.create({ data: { ...scope, userId: user.id, role: 'OWNER' } })
  const product = await prisma.product.create({ data: {
    tenantId: tenant.id, name: 'Currency item', barcode: randomUUID(), sellPrice: 12, mainUnitName: 'piece',
  } })
  await prisma.nativeInventoryStore.create({ data: { ...scope, enabledAt: new Date(), currencyCode: 'USD' } })
  const item = await prisma.nativeInventoryItem.create({ data: {
    ...scope, productId: product.id, productTenantId: tenant.id, productName: product.name, baseUnitName: 'piece', onHand: 20, averageUnitCost: 4,
  } })
  const cookie = 'auth-session=' + signSession({ ...scope, userId: user.id, role: 'OWNER' })
  async function call(method: string, path: string, body: object, extraHeaders: Record<string, string> = {}) {
    const response = await fetch(new URL(path, runtime), {
      method, headers: { 'content-type': 'application/json', cookie, ...extraHeaders }, body: JSON.stringify(body),
    })
    return { status: response.status, data: await response.json() }
  }

  const setCurrency = (currencyCode: string) => prisma.store.update({ where: { id: store.id }, data: { currencyCode } })
  const directPos = () => call('POST', '/api/cashier/sales', {
    storeCode: store.code, paymentMethod: 'KHQR', displayedCurrency: 'USD', manualPaymentConfirmed: true,
    items: [{ barcode: product.barcode, quantity: 1 }],
  })
  const key = randomUUID()
  const h5Order = (idempotencyKey: string, displayedCurrency: string) => call('POST', '/api/public/orders', {
    storeCode: store.code, displayedCurrency, items: [{ productId: product.id, quantity: 1 }],
  }, { 'idempotency-key': idempotencyKey })

  // The scoped trigger makes the switch occur after the application chose a
  // denomination, while the real INSERT is in progress.
  async function switchDuringInsert(relation: 'SaleRecord' | 'CustomerOrder', submit: typeof directPos) {
    const lockId = 71_000_000 + Math.floor(Math.random() * 1_000_000)
    const routine = 'native_m1_currency_' + lockId
    assert.match(store.id, /^[a-z0-9]+$/)
    await prisma.$executeRawUnsafe(`CREATE FUNCTION public.${routine}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."storeId" = '${store.id}' THEN PERFORM pg_advisory_xact_lock(${lockId}); END IF;
        RETURN NEW;
      END;
    $$`)
    await prisma.$executeRawUnsafe(`CREATE TRIGGER ${routine} BEFORE INSERT ON "${relation}" FOR EACH ROW EXECUTE FUNCTION public.${routine}()`)
    try {
      let response: ReturnType<typeof submit> | undefined
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(${lockId}::bigint)::text`
        response = submit()
        let waiting = false
        for (let attempt = 0; attempt < 80; attempt += 1) {
          const [lock] = await tx.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (
            SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=0 AND objid=${lockId}::oid AND NOT granted
          ) AS waiting`
          if (lock.waiting) { waiting = true; break }
          await delay(25)
        }
        assert.equal(waiting, true, 'HTTP request must reach its INSERT before the store changes')
        await tx.store.update({ where: { id: store.id }, data: { currencyCode: 'XAF' } })
      }, { timeout: 4000 })
      return await response!
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER ${routine} ON "${relation}"`)
      await prisma.$executeRawUnsafe(`DROP FUNCTION public.${routine}()`)
    }
  }

  const direct = await switchDuringInsert('SaleRecord', directPos)
  assert.equal(direct.status, 201, JSON.stringify(direct.data))
  assert.equal((await directPos()).status, 422)
  const directSale = await prisma.saleRecord.findFirstOrThrow({ where: { ...scope, orderNo: direct.data.orderNo } })
  const directMove = await prisma.nativeInventoryMovement.findFirstOrThrow({ where: { ...scope, sourceId: directSale.id } })
  assert.equal(directMove.revenue?.toString(), '12')
  assert.equal(directMove.unitCost?.toString(), '4')

  await setCurrency('USD')
  const h5 = await switchDuringInsert('CustomerOrder', () => h5Order(key, 'USD'))
  assert.equal(h5.status, 200, JSON.stringify(h5.data))
  assert.equal((await h5Order(key, 'USD')).data.orderNo, h5.data.orderNo)
  const stale = await h5Order(randomUUID(), 'USD')
  assert.deepEqual([stale.status, stale.data.error], [409, 'ORDER_CURRENCY_CHANGED'])
  const customer = await prisma.customerOrder.findUniqueOrThrow({ where: { orderNo: h5.data.orderNo } })
  for (const status of ['CONFIRMED', 'COMPLETED']) {
    const result = await call('PATCH', '/api/customer-orders/' + customer.id, { status })
    assert.equal(result.status, 200, JSON.stringify(result.data))
  }
  const captures = await Promise.all(Array.from({ length: 2 }, () =>
    call('PATCH', '/api/customer-orders/' + customer.id, { paymentMethod: 'CASH', displayedCurrency: 'XAF' })))
  for (const result of captures) assert.equal(result.status, 200, JSON.stringify(result.data))
  const movements = await prisma.nativeInventoryMovement.findMany({ where: { ...scope, originalId: customer.id } })
  assert.equal(movements.length, 1)
  assert.deepEqual([movements[0].quantity.toString(), movements[0].revenue, movements[0].unitCost, movements[0].reason],
    ['-1', null, null, 'CURRENCY_MISMATCH'])
  assert.equal(await prisma.paymentIntent.count({ where: { ...scope, orderNo: customer.orderNo } }), 1)

  const deferred = await call('POST', '/api/sales', {
    saleType: 'SALE', paymentMethod: 'DEFER', displayedCurrency: 'XAF', items: [{ barcode: product.barcode, quantity: 1 }],
  })
  assert.equal(deferred.status, 201, JSON.stringify(deferred.data))
  await setCurrency('USD')
  const settlement = await Promise.all(Array.from({ length: 2 }, () =>
    call('POST', '/api/orders/' + encodeURIComponent(deferred.data.orderNo) + '/checkout', { paymentMethod: 'CASH', displayedCurrency: 'USD' })))
  assert.equal(settlement.filter(({ status }) => status === 201).length, 1)
  assert.ok(settlement.every(({ status }) => [201, 404, 409].includes(status)), JSON.stringify(settlement))
  const deferredSale = await prisma.saleRecord.findFirstOrThrow({ where: { ...scope, orderNo: deferred.data.orderNo } })
  const deferredMoves = await prisma.nativeInventoryMovement.findMany({ where: { ...scope, sourceId: deferredSale.id } })
  assert.equal(deferredMoves.length, 1)
  assert.deepEqual([deferredMoves[0].quantity.toString(), deferredMoves[0].revenue, deferredMoves[0].unitCost, deferredMoves[0].reason],
    ['-1', null, null, 'CURRENCY_MISMATCH'])
  assert.equal(await prisma.paymentIntent.count({ where: { ...scope, orderNo: deferred.data.orderNo } }), 1)
  assert.equal((await prisma.nativeInventoryItem.findUniqueOrThrow({
    where: { tenantId_storeId_id: { ...scope, id: item.id } },
  })).onHand.toString(), '17')

  const stalePos = await call('POST', '/api/cashier/sales', {
    storeCode: store.code, paymentMethod: 'CASH', displayedCurrency: 'XAF',
    items: [{ barcode: product.barcode, quantity: 1 }],
  })
  assert.equal(stalePos.status, 201, JSON.stringify(stalePos.data))
  const staleSale = await prisma.saleRecord.findFirstOrThrow({ where: { ...scope, orderNo: stalePos.data.orderNo } })
  const staleMovement = await prisma.nativeInventoryMovement.findFirstOrThrow({ where: { ...scope, sourceId: staleSale.id } })
  assert.deepEqual([staleMovement.revenue, staleMovement.unitCost, staleMovement.reason], [null, null, 'CURRENCY_MISMATCH'])

  const legacyH5 = await call('POST', '/api/public/orders', {
    storeCode: store.code, items: [{ productId: product.id, quantity: 1 }],
  }, { 'idempotency-key': randomUUID() })
  assert.equal(legacyH5.status, 200, JSON.stringify(legacyH5.data))
  const [legacyEvidence] = await prisma.$queryRaw<{ recorded: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM native_inventory.order_currency c JOIN "CustomerOrder" o ON o.id=c.source_id
      WHERE c.tenant_id=${tenant.id} AND c.store_id=${store.id} AND c.source_kind='H5'
        AND o."orderNo"=${legacyH5.data.orderNo}
    ) AS recorded
  `
  assert.equal(legacyEvidence.recorded, false)

  async function pendingSale() {
    const created = await call('POST', '/api/sales', {
      saleType: 'SALE', paymentMethod: 'DEFER', displayedCurrency: 'USD', items: [{ barcode: product.barcode, quantity: 1 }],
    })
    assert.equal(created.status, 201, JSON.stringify(created.data))
    return prisma.saleRecord.findFirstOrThrow({ where: { ...scope, orderNo: created.data.orderNo } })
  }

  const disputed = await pendingSale()
  const orderPath = '/api/orders/' + encodeURIComponent(disputed.orderNo!)
  const [checkout, cancel] = await Promise.all([
    call('POST', orderPath + '/checkout', { paymentMethod: 'CASH', displayedCurrency: 'USD' }),
    call('POST', orderPath + '/cancel', {}),
  ])
  assert.equal(Number(checkout.status === 201) + Number(cancel.status === 200), 1, JSON.stringify([checkout, cancel]))
  const current = await prisma.saleRecord.findUniqueOrThrow({ where: { id: disputed.id } })
  const booked = await prisma.nativeInventoryMovement.count({ where: { ...scope, sourceId: disputed.id } })
  assert.equal(current.status, checkout.status === 201 ? 'COMPLETED' : 'CANCELLED')
  assert.equal(booked, checkout.status === 201 ? 1 : 0)
  assert.equal(await prisma.paymentIntent.count({ where: { ...scope, orderNo: disputed.orderNo! } }), booked)

  const otherStore = await prisma.store.create({ data: {
    tenantId: tenant.id, code: randomUUID(), name: 'Disabled inventory store', currencyCode: 'USD',
  } })
  await prisma.userStoreRole.create({ data: { tenantId: tenant.id, storeId: otherStore.id, userId: user.id, role: 'OWNER' } })
  async function staffCookie(storeId: string) {
    const staff = await prisma.user.create({ data: { tenantId: tenant.id, username: randomUUID(), role: 'STAFF', displayName: 'Staff' } })
    await prisma.userStoreRole.create({ data: { tenantId: tenant.id, storeId, userId: staff.id, role: 'STAFF' } })
    return 'auth-session=' + signSession({ tenantId: tenant.id, storeId, userId: staff.id, role: 'STAFF' })
  }
  const scopedStaff = { cookie: await staffCookie(store.id) }
  const unrelatedStaff = { cookie: await staffCookie(otherStore.id) }
  async function legacyPending() {
    const sale = await pendingSale()
    const intent = await prisma.paymentIntent.create({ data: {
      tenantId: tenant.id, storeId: otherStore.id, operatorUserId: user.id, orderNo: sale.orderNo!,
      paymentMethod: 'KHQR', status: 'PENDING', amount: sale.lineAmount,
    } })
    return { sale, intent }
  }
  const { sale: legacy, intent: legacyIntent } = await legacyPending()
  const paymentPath = '/api/payments/' + legacyIntent.id
  const legacyOrderPath = '/api/orders/' + encodeURIComponent(legacy.orderNo!)
  for (const action of ['/confirm', '/cancel']) {
    assert.equal((await call('POST', paymentPath + action, {}, unrelatedStaff)).status, 404)
  }
  const existingCheckout = await call('POST', legacyOrderPath + '/checkout', { paymentMethod: 'CASH' }, scopedStaff)
  assert.deepEqual([existingCheckout.status, existingCheckout.data.paymentIntentId], [409, legacyIntent.id])
  const khqrReplay = () => call('POST', legacyOrderPath + '/checkout', { paymentMethod: 'KHQR' }, scopedStaff)
  const withoutConfig = await khqrReplay()
  assert.deepEqual([withoutConfig.status, withoutConfig.data.paymentIntentId], [409, legacyIntent.id])
  await setCurrency('XAF')
  const afterCurrencyChange = await khqrReplay()
  assert.deepEqual([afterCurrencyChange.status, afterCurrencyChange.data.paymentIntentId], [409, legacyIntent.id])
  await setCurrency('USD')
  const legacyConfirmation = await call('POST', paymentPath + '/confirm', {}, scopedStaff)
  assert.equal(legacyConfirmation.status, 200, JSON.stringify(legacyConfirmation.data))
  assert.equal((await prisma.saleRecord.findUniqueOrThrow({ where: { id: legacy.id } })).status, 'COMPLETED')
  assert.equal(await prisma.nativeInventoryMovement.count({ where: { ...scope, sourceId: legacy.id } }), 1)
  assert.equal((await call('POST', paymentPath + '/confirm', {}, unrelatedStaff)).status, 404)

  const toCancel = await legacyPending()
  const cancelledLegacy = await call('POST', '/api/orders/' + encodeURIComponent(toCancel.sale.orderNo!) + '/cancel', {}, scopedStaff)
  assert.equal(cancelledLegacy.status, 200, JSON.stringify(cancelledLegacy.data))
  assert.equal((await prisma.paymentIntent.findUniqueOrThrow({ where: { id: toCancel.intent.id } })).status, 'CANCELLED')
  assert.equal(await prisma.nativeInventoryMovement.count({ where: { ...scope, sourceId: toCancel.sale.id } }), 0)

  const paymentRace = await legacyPending()
  const payPath = '/api/payments/' + paymentRace.intent.id
  const [confirmed, paymentCancelled] = await Promise.all([
    call('POST', payPath + '/confirm', {}, scopedStaff), call('POST', payPath + '/cancel', {}, scopedStaff),
  ])
  assert.deepEqual([confirmed.status, paymentCancelled.status].sort(), [200, 422])
  const raceResult = await prisma.saleRecord.findUniqueOrThrow({ where: { id: paymentRace.sale.id } })
  assert.equal(raceResult.status, confirmed.status === 200 ? 'COMPLETED' : 'CANCELLED')
  assert.equal(await prisma.nativeInventoryMovement.count({ where: { ...scope, sourceId: paymentRace.sale.id } }),
    confirmed.status === 200 ? 1 : 0)

  const refundCookie = 'auth-session=' + signSession({ tenantId: tenant.id, storeId: otherStore.id, userId: user.id, role: 'OWNER' })
  const refunds = await Promise.all(Array.from({ length: 2 }, () => call('POST', '/api/sales', {
    saleType: 'REFUND', originalSaleRecordId: directSale.id, refundQty: 1, refundReason: 'Fixture', displayedCurrency: 'USD',
  }, { cookie: refundCookie })))
  assert.equal(refunds.filter(({ status }) => status === 201).length, 1, JSON.stringify(refunds))
  assert.equal(refunds.find(({ status }) => status !== 201)?.data.error, 'REFUND_QTY_EXCEEDED')
  const returns = await prisma.nativeInventoryMovement.findMany({ where: { ...scope, originalId: directSale.id, type: 'REFUND' } })
  assert.equal(returns.length, 1)
  assert.deepEqual([returns[0].quantity.toString(), returns[0].revenue?.toString(), returns[0].unitCost?.toString()], ['1', '-12', '4'])

  const cancelledH5 = await h5Order(randomUUID(), 'USD')
  assert.equal(cancelledH5.status, 200, JSON.stringify(cancelledH5.data))
  const cancelledOrder = await prisma.customerOrder.findUniqueOrThrow({ where: { orderNo: cancelledH5.data.orderNo } })
  const prepareCancellation = await call('PATCH', '/api/customer-orders/' + cancelledOrder.id, { status: 'CONFIRMED' })
  assert.equal(prepareCancellation.status, 200, JSON.stringify(prepareCancellation.data))
  assert.ok(await prisma.customerOrderFulfillmentIntent.count({ where: { ...scope, orderNo: cancelledOrder.orderNo } }))
  const cancelled = await call('PATCH', '/api/customer-orders/' + cancelledOrder.id, { status: 'CANCELLED' })
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data))
  assert.equal((await prisma.customerOrder.findUniqueOrThrow({ where: { id: cancelledOrder.id } })).status, 'CANCELLED')

  const printed = await call('POST', '/api/cashier/sales', {
    storeCode: store.code, paymentMethod: 'CASH', displayedCurrency: 'USD',
    items: [{ barcode: product.barcode, quantity: 1 }],
    printing: { profile: 'network-v2', mode: 'FRONT_ONLY', lang: 'zh' },
  })
  assert.equal(printed.status, 201, JSON.stringify(printed.data))
  assert.equal(printed.data.printing?.jobs?.length, 1)

})
