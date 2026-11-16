import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { prisma } from '../lib/prisma'
import { signSession } from '../lib/session'

const database = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/invalid')
const service = new URL(process.env.NATIVE_INVENTORY_UI_TEST_URL ?? 'http://invalid')
const legacyService = new URL(process.env.NATIVE_INVENTORY_LEGACY_TEST_URL ?? 'http://invalid')
assert.equal(process.env.NATIVE_INVENTORY_TEST_DATABASE, '1')
assert.equal(database.pathname, '/native_inventory_test_diamond_phase2_http')
for (const url of [database, service, legacyService]) assert.ok(['localhost', '127.0.0.1'].includes(url.hostname))

test('Diamond admission, first sale, replay, receipt and physical count', async (t) => {
  t.after(() => prisma.$disconnect())
  const store = await prisma.store.findUniqueOrThrow({ where: { code: 'ST883DC00C' } })
  const scope = { tenantId: store.tenantId, storeId: store.id }
  const telegramId = String(BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 12)))
  const owner = await prisma.user.create({ data: {
    tenantId: store.tenantId, username: randomUUID(), displayName: 'Fixture owner', role: 'OWNER', telegramId,
  } })
  await prisma.userStoreRole.create({ data: { ...scope, userId: owner.id, role: 'OWNER' } })
  const authDate = String(Math.floor(Date.now() / 1000))
  const telegramUser = JSON.stringify({ id: Number(telegramId) })
  const secret = createHmac('sha256', 'WebAppData').update(process.env.TELEGRAM_BOT_TOKEN!).digest()
  const hash = createHmac('sha256', secret).update(`auth_date=${authDate}\nuser=${telegramUser}`).digest('hex')
  const headers = {
    cookie: 'auth-session=' + signSession({ ...scope, userId: owner.id, role: 'OWNER' }),
    'content-type': 'application/json',
    'x-telegram-init-data': new URLSearchParams({ auth_date: authDate, user: telegramUser, hash }).toString(),
  }

  async function request(path: string, method: string, status: number, body?: object, key?: string) {
    const response = await fetch(new URL(path, service), {
      method, headers: { ...headers, ...(key ? { 'idempotency-key': key } : {}) }, body: body && JSON.stringify(body),
    })
    const data = await response.json()
    assert.equal(response.status, status, JSON.stringify(data))
    return data
  }
  async function feed(status: number) {
    const res = await fetch(new URL('/api/external/inventory-profit/feed?dataset=products&limit=1', legacyService), {
      headers: { authorization: 'Bearer ' + process.env.INVENTORY_PROFIT_FEED_SECRET },
    })
    const data = await res.json()
    assert.equal(res.status, status, JSON.stringify(data))
    return data
  }
  const createProduct = (name: string) => prisma.product.create({ data: {
    tenantId: store.tenantId, name, barcode: randomUUID(), sellPrice: 12, mainUnitName: 'piece',
  } })
  const [pos, h5, historical] = await Promise.all([
    createProduct('Phase 2 POS'), createProduct('Phase 2 H5'), createProduct('Phase 2 historical'),
  ])
  const sku = (productId: string) => prisma.nativeInventoryItem.findUnique({
    where: { tenantId_storeId_productId: { ...scope, productId } },
  })
  async function journal(productId: string, expectedBalance: number, types: string[]) {
    const item = await sku(productId)
    assert.ok(item)
    assert.equal(item.onHand.toNumber(), expectedBalance)
    const moves = await prisma.nativeInventoryMovement.findMany({ where: { ...scope, itemId: item.id } })
    assert.deepEqual(moves.map((row) => row.type).sort(), [...types].sort())
    return item
  }
  const desktop = (quantity: number) => ({
    storeCode: store.code, items: [{ barcode: pos.barcode, quantity }], paymentMethod: 'CASH',
  })
  const toggle = (enabled: boolean) => prisma.$executeRaw`
    UPDATE public."NativeInventoryStore" SET "salesEnabledAt" = CASE WHEN ${enabled} THEN clock_timestamp() ELSE NULL END
    WHERE "tenantId" = ${scope.tenantId} AND "storeId" = ${scope.storeId}
  `
  await prisma.nativeInventoryStore.upsert({
    where: { tenantId_storeId: scope },
    create: { ...scope, currencyCode: store.currencyCode, enabledAt: new Date() },
    update: { enabledAt: new Date(), currencyCode: store.currencyCode },
  })
  const oldSale = await request('/api/sales', 'POST', 201, {
    saleType: 'SALE', paymentMethod: 'DEFER', items: [{ barcode: historical.barcode, quantity: 1 }],
  })
  await feed(200)
  await assert.rejects(toggle(true), /approved non-Sheets pilot/)
  await assert.rejects(prisma.$executeRaw`
    INSERT INTO native_inventory.sales_pilot (pilot_store_id, sheets_store_id) VALUES (${store.id}, ${store.id})
  `, /verified legacy Feed retirement/)
  await assert.rejects(prisma.$executeRaw`
    INSERT INTO native_inventory.sales_pilot (pilot_store_id, sheets_store_id, sheets_retired_at)
    VALUES (${store.id}, ${store.id}, clock_timestamp() + interval '1 day')
  `, /verified legacy Feed retirement/)
  await prisma.$executeRaw`
    INSERT INTO native_inventory.sales_pilot (pilot_store_id, sheets_store_id, sheets_retired_at)
    VALUES (${store.id}, ${store.id}, clock_timestamp())
  `
  assert.equal((await feed(503)).error, 'FEED_RETIRED')
  await toggle(true)
  await delay(10)
  await request(`/api/orders/${oldSale.orderNo}/checkout`, 'POST', 201, { paymentMethod: 'CASH' })
  assert.equal(await sku(historical.id), null)
  const openingItem = randomUUID()
  await request('/api/native-inventory/items', 'PUT', 200, { id: openingItem, productId: historical.id, baseUnitName: 'piece' })
  const opening = { id: randomUUID(), itemId: openingItem, quantity: '0', expectedOnHand: null, reason: '盘点差异', unitCost: null }
  await request('/api/native-inventory/adjustments', 'PUT', 200, opening)
  await request('/api/native-inventory/adjustments', 'PUT', 200, opening)
  await request('/api/native-inventory/adjustments', 'PUT', 409, { ...opening, id: randomUUID() })
  await journal(historical.id, 0, ['ADJUSTMENT'])
  assert.equal((await request('/api/cashier/sales', 'POST', 409, desktop(4))).error, 'IDEMPOTENCY_KEY_REQUIRED')

  const saleKey = randomUUID()
  const h5Key = randomUUID()
  const [sale, saleReplay, customer] = await Promise.all([
    request('/api/cashier/sales', 'POST', 201, desktop(4), saleKey),
    request('/api/cashier/sales', 'POST', 201, desktop(4), saleKey),
    request('/api/public/orders', 'POST', 200, { storeCode: store.code, items: [{ productId: h5.id, quantity: 2 }] }, h5Key),
  ])
  assert.deepEqual(saleReplay, sale)
  assert.deepEqual(await request('/api/cashier/sales', 'POST', 201, desktop(4), saleKey), sale)
  assert.equal((await request('/api/cashier/sales', 'POST', 409, desktop(3), saleKey)).error, 'IDEMPOTENCY_CONFLICT')
  const posItem = await journal(pos.id, -4, ['SALE'])
  assert.equal(posItem.averageUnitCost, null)
  const customerBody = { storeCode: store.code, items: [{ productId: h5.id, quantity: 2 }] }
  assert.deepEqual(await request('/api/public/orders', 'POST', 200, customerBody, h5Key), customer)
  const source = await prisma.customerOrder.findUniqueOrThrow({ where: { orderNo: customer.orderNo } })
  const customerPath = '/api/customer-orders/' + source.id
  await request(customerPath, 'PATCH', 200, { status: 'CONFIRMED' })
  await request(customerPath, 'PATCH', 200, { status: 'COMPLETED' })
  const pay = () => request(customerPath, 'PATCH', 200, { paymentMethod: 'CASH' })
  await Promise.all([pay(), pay()])
  await journal(h5.id, -2, ['CUSTOMER_SALE'])
  assert.equal(await prisma.paymentIntent.count({ where: { ...scope, orderNo: source.orderNo } }), 1)

  const mobileKey = randomUUID()
  const mobileBody = { saleType: 'SALE', paymentMethod: 'CASH', items: [{ barcode: h5.barcode, quantity: 1 }] }
  const mobile = () => request('/api/sales', 'POST', 201, mobileBody, mobileKey)
  const [mobileSale, mobileReplay] = await Promise.all([mobile(), mobile()])
  assert.deepEqual(mobileSale, mobileReplay)
  await journal(h5.id, -3, ['CUSTOMER_SALE', 'SALE'])
  await prisma.customerOrder.update({ where: { id: source.id }, data: { status: 'CANCELLED' } })
  await journal(h5.id, -3, ['CUSTOMER_SALE', 'SALE'])

  const original = await prisma.saleRecord.findFirstOrThrow({ where: { ...scope, orderNo: sale.orderNo } })
  const refundKey = randomUUID()
  const refundBody = { saleType: 'REFUND', originalSaleRecordId: original.id, refundQty: 1, refundReason: 'Fixture partial refund' }
  const refund = () => request('/api/sales', 'POST', 201, refundBody, refundKey)
  const [a, b] = await Promise.all([refund(), refund()])
  assert.deepEqual(a, b)
  assert.deepEqual(await refund(), a)
  assert.equal((await request('/api/sales', 'POST', 409, { ...refundBody, refundQty: 2 }, refundKey)).error, 'IDEMPOTENCY_CONFLICT')
  assert.equal(await prisma.saleRecord.count({ where: { ...scope, originalSaleRecordId: original.id } }), 1)
  await journal(pos.id, -3, ['SALE', 'REFUND'])

  const adjust = {
    id: randomUUID(), itemId: posItem.id, quantity: '2', expectedOnHand: '-3',
    reason: '盘点差异', unitCost: null,
  }
  await request('/api/native-inventory/adjustments', 'PUT', 200, adjust)
  await request('/api/native-inventory/adjustments', 'PUT', 200, adjust)
  await request('/api/native-inventory/adjustments', 'PUT', 409, { ...adjust, id: randomUUID() })
  await journal(pos.id, -1, ['SALE', 'REFUND', 'ADJUSTMENT'])

  const supplierId = randomUUID()
  const receiptId = randomUUID()
  await request('/api/native-inventory/suppliers', 'PUT', 200, { id: supplierId, name: 'Fixture supplier' })
  await request('/api/native-inventory/receipts', 'PUT', 200, {
    id: receiptId, revision: 0, supplierId, lines: [{ itemId: posItem.id, unitId: 'BASE', quantity: '4', unitPrice: '7' }],
  })
  const receive = () => request('/api/native-inventory/receipt-confirmation', 'PUT', 200, { id: receiptId, revision: 1 })
  await Promise.all([receive(), receive()])
  const afterReceipt = await journal(pos.id, 3, ['SALE', 'REFUND', 'ADJUSTMENT', 'RECEIPT'])
  assert.equal(afterReceipt.averageUnitCost?.toNumber(), 7)
  await toggle(false)
  await request('/api/cashier/sales', 'POST', 201, desktop(1))
  await journal(pos.id, 3, ['SALE', 'REFUND', 'ADJUSTMENT', 'RECEIPT'])
})
