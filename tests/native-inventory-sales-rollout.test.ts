import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { prisma } from '../lib/prisma'
import { signSession } from '../lib/session'

const database = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/invalid')
const service = new URL(process.env.NATIVE_INVENTORY_UI_TEST_URL ?? 'http://invalid')
const darkService = new URL(process.env.NATIVE_INVENTORY_DARK_TEST_URL ?? 'http://invalid')
const priorService = new URL(process.env.NATIVE_INVENTORY_PRIOR_TEST_URL ?? 'http://invalid')
assert.equal(process.env.NATIVE_INVENTORY_TEST_DATABASE, '1')
assert.match(database.pathname, /^\/native_inventory_test_[a-z0-9_]+$/)
for (const endpoint of [database, service, darkService, priorService]) assert.ok(['localhost', '127.0.0.1'].includes(endpoint.hostname))

test('manual inventory, automatic journal cutoff, and retry identities survive a store rollout', async (t) => {
  t.after(() => prisma.$disconnect())
  const tenant = await prisma.tenant.create({ data: { name: 'Isolated rollout test' } })
  const telegramId = String(BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 12)))
  const owner = await prisma.user.create({ data: {
    tenantId: tenant.id, username: randomUUID(), displayName: 'Rollout owner', role: 'OWNER', telegramId,
  } })
  const store = await prisma.store.create({ data: {
    tenantId: tenant.id, name: 'Rollout pilot', code: randomUUID(), currencyCode: 'USD',
  } })
  const scope = { tenantId: tenant.id, storeId: store.id }
  await prisma.userStoreRole.create({ data: { ...scope, userId: owner.id, role: 'OWNER' } })
  const product = await prisma.product.create({ data: {
    tenantId: tenant.id, name: 'Rollout product', barcode: randomUUID(), sellPrice: 12, mainUnitName: 'piece',
  } })
  await prisma.nativeInventoryStore.create({ data: { ...scope, currencyCode: 'USD', enabledAt: new Date() } })
  const item = await prisma.nativeInventoryItem.create({ data: {
    ...scope, productId: product.id, productTenantId: tenant.id, productName: product.name, baseUnitName: 'piece',
  } })
  await prisma.nativeInventoryUnit.create({ data: { ...scope, itemId: item.id, id: 'MAIN', name: 'piece', factor: 1 } })
  const sheets = await prisma.store.findUnique({ where: { code: 'ST883DC00C' } })
    ?? await prisma.store.create({ data: { tenantId: tenant.id, name: 'Isolated legacy Sheets', code: 'ST883DC00C' } })
  await prisma.nativeInventoryStore.upsert({
    where: { tenantId_storeId: { tenantId: sheets.tenantId, storeId: sheets.id } },
    create: { tenantId: sheets.tenantId, storeId: sheets.id, currencyCode: sheets.currencyCode },
    update: {},
  })

  const authDate = String(Math.floor(Date.now() / 1000))
  const telegramUser = JSON.stringify({ id: Number(telegramId) })
  const secret = createHmac('sha256', 'WebAppData').update(process.env.TELEGRAM_BOT_TOKEN!).digest()
  const hash = createHmac('sha256', secret).update(`auth_date=${authDate}\nuser=${telegramUser}`).digest('hex')
  const headers = {
    cookie: 'auth-session=' + signSession({ ...scope, userId: owner.id, role: 'OWNER' }),
    'content-type': 'application/json',
    'x-telegram-init-data': new URLSearchParams({ auth_date: authDate, user: telegramUser, hash }).toString(),
  }
  async function request(path: string, method: string, body?: object, extra = {}, endpoint = service) {
    const response = await fetch(new URL(path, endpoint), {
      method, headers: { ...headers, ...extra }, body: body && JSON.stringify(body),
    })
    return { status: response.status, data: await response.json() }
  }
  async function expectStatus(promise: ReturnType<typeof request>, status: number) {
    const result = await promise
    assert.equal(result.status, status, JSON.stringify(result.data))
    return result.data
  }
  const balance = async () => (await prisma.nativeInventoryItem.findUniqueOrThrow({
    where: { tenantId_storeId_id: { ...scope, id: item.id } },
  })).onHand.toNumber()
  const movementCount = () => prisma.nativeInventoryMovement.count({ where: scope })
  const sale = (paymentMethod: 'DEFER' | 'CASH') => request('/api/sales', 'POST', {
    saleType: 'SALE', paymentMethod, displayedCurrency: 'USD', items: [{ barcode: product.barcode, quantity: 1 }],
  })
  const h5 = (key: string, endpoint = service) => request('/api/public/orders', 'POST', {
    storeCode: store.code, displayedCurrency: 'USD', items: [{ productId: product.id, quantity: 1 }],
  }, { 'idempotency-key': key }, endpoint)
  async function h5Paid(orderNo: string, concurrent = false) {
    const order = await prisma.customerOrder.findUniqueOrThrow({ where: { orderNo } })
    const path = '/api/customer-orders/' + order.id
    for (const status of ['CONFIRMED', 'COMPLETED']) await expectStatus(request(path, 'PATCH', { status }), 200)
    const pay = () => expectStatus(request(path, 'PATCH', { paymentMethod: 'CASH', displayedCurrency: 'USD' }), 200)
    await Promise.all(concurrent ? [pay(), pay()] : [pay()])
    assert.equal(await prisma.paymentIntent.count({ where: { ...scope, orderNo } }), 1)
  }
  const toggle = (active: boolean) => prisma.$executeRaw`
    UPDATE public."NativeInventoryStore" SET "salesEnabledAt" =
      CASE WHEN ${active} THEN clock_timestamp() ELSE NULL END
    WHERE "tenantId" = ${tenant.id} AND "storeId" = ${store.id}
  `
  const refund = (originalSaleRecordId: string) => request('/api/sales', 'POST', {
    saleType: 'REFUND', originalSaleRecordId, refundQty: 1, refundReason: 'fixture', displayedCurrency: 'USD',
  })

  await assert.rejects(toggle(true), /approved non-Sheets pilot/)
  await assert.rejects(prisma.$executeRaw`
    INSERT INTO native_inventory.sales_pilot (pilot_store_id, sheets_store_id) VALUES (${sheets.id}, ${sheets.id})
  `, /sales_pilot/)
  await prisma.$executeRaw`
    INSERT INTO native_inventory.sales_pilot (pilot_store_id, sheets_store_id) VALUES (${store.id}, ${sheets.id})
  `
  await assert.rejects(prisma.$executeRaw`
    UPDATE public."NativeInventoryStore" SET "salesEnabledAt" = clock_timestamp() WHERE "storeId" = ${sheets.id}
  `, /approved non-Sheets pilot/)
  await assert.rejects(prisma.$executeRaw`DELETE FROM native_inventory.sales_pilot`, /binding is immutable/)

  const supplierId = randomUUID()
  const receiptId = randomUUID()
  await expectStatus(request('/api/native-inventory/suppliers', 'PUT', { id: supplierId, name: 'Fixture supplier' }), 200)
  await expectStatus(request('/api/native-inventory/receipts', 'PUT', {
    id: receiptId, revision: 0, supplierId, lines: [{ itemId: item.id, unitId: 'MAIN', quantity: '10', unitPrice: '4' }],
  }), 200)
  const postReceipt = () => expectStatus(request('/api/native-inventory/receipt-confirmation', 'PUT', { id: receiptId, revision: 1 }), 200)
  await Promise.all([postReceipt(), postReceipt()])
  await expectStatus(request('/api/native-inventory/items', 'GET'), 200)
  assert.deepEqual([await balance(), await movementCount()], [10, 1])

  const manualSale = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "storeId" FROM public."NativeInventoryStore" WHERE "storeId" = ${store.id} FOR UPDATE`
    // A committed manual-only state must not queue inventory work at checkout.
    return expectStatus(sale('CASH'), 201)
  }, { timeout: 5000 })
  const manualRecord = await prisma.saleRecord.findFirstOrThrow({ where: { ...scope, orderNo: manualSale.orderNo } })
  await expectStatus(refund(manualRecord.id), 201)
  const pendingPos = await expectStatus(sale('DEFER'), 201)
  const pendingKey = randomUUID()
  const pendingH5 = await expectStatus(h5(pendingKey, darkService), 200)
  assert.deepEqual(await expectStatus(h5(pendingKey), 200), pendingH5)
  assert.deepEqual([await balance(), await movementCount()], [10, 1])

  await toggle(true)
  const activeSince = (await prisma.nativeInventoryStore.findUniqueOrThrow({ where: { tenantId_storeId: scope } })).salesEnabledAt
  await delay(5)
  await toggle(true)
  assert.deepEqual((await prisma.nativeInventoryStore.findUniqueOrThrow({ where: { tenantId_storeId: scope } })).salesEnabledAt, activeSince)
  await expectStatus(request(`/api/orders/${pendingPos.orderNo}/checkout`, 'POST', { paymentMethod: 'CASH', displayedCurrency: 'USD' }), 201)
  await h5Paid(pendingH5.orderNo)
  assert.deepEqual([await balance(), await movementCount()], [10, 1])

  // The real Desktop handler can backdate some display timestamps. Force
  // one such line across the epoch while pricing and settling the same order.
  const secondProduct = await prisma.product.create({ data: {
    tenantId: tenant.id, name: 'Second rollout product', barcode: randomUUID(), sellPrice: 12, mainUnitName: 'piece',
  } })
  const secondItem = await prisma.nativeInventoryItem.create({ data: {
    ...scope, productId: secondProduct.id, productTenantId: tenant.id, productName: secondProduct.name,
    baseUnitName: 'piece', onHand: 10,
  } })
  assert.match(secondProduct.id, /^[a-z0-9]+$/)
  await prisma.$executeRawUnsafe(`CREATE FUNCTION public.rollout_fixture_display_date() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW."productId" = '${secondProduct.id}' THEN NEW."createdAt" := timestamp '2000-01-01'; END IF;
      RETURN NEW;
    END;
  $$`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER rollout_fixture_display_date BEFORE INSERT ON "SaleRecord"
    FOR EACH ROW EXECUTE FUNCTION public.rollout_fixture_display_date()`)
  let multiLine: { orderNo: string }
  try {
    multiLine = await expectStatus(request('/api/cashier/sales', 'POST', {
      storeCode: store.code, paymentMethod: 'CASH', displayedCurrency: 'USD',
      items: [{ barcode: product.barcode, quantity: 1 }, { barcode: secondProduct.barcode, quantity: 1 }],
    }), 201)
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER rollout_fixture_display_date ON "SaleRecord"')
    await prisma.$executeRawUnsafe('DROP FUNCTION public.rollout_fixture_display_date()')
  }
  const recorded = await prisma.saleRecord.findMany({ where: { ...scope, orderNo: multiLine.orderNo } })
  assert.equal(recorded.length, 2)
  assert.equal(await prisma.nativeInventoryMovement.count({ where: {
    ...scope, type: 'SALE', sourceId: { in: recorded.map(line => line.id) },
  } }), 2)
  assert.equal((await prisma.nativeInventoryItem.findUniqueOrThrow({
    where: { tenantId_storeId_id: { ...scope, id: secondItem.id } },
  })).onHand.toNumber(), 9)

  // Restore the synthetic backdated line so legacy daily receipt numbering
  // remains representative for subsequent orders in this test.
  await prisma.saleRecord.updateMany({
    where: { ...scope, orderNo: multiLine.orderNo, productId: secondProduct.id },
    data: { createdAt: new Date() },
  })

  const priorKey = randomUUID()
  const prior = await expectStatus(h5(priorKey, priorService), 200)
  assert.deepEqual(await expectStatus(h5(priorKey, darkService), 200), prior)
  assert.deepEqual(await expectStatus(h5(priorKey), 200), prior)
  const changedCart = await request('/api/public/orders', 'POST', {
    storeCode: store.code, displayedCurrency: 'USD', items: [{ productId: product.id, quantity: 2 }],
  }, { 'idempotency-key': priorKey })
  assert.deepEqual([changedCart.status, changedCart.data.error], [409, 'IDEMPOTENCY_KEY_CONFLICT'])

  const activeKey = randomUUID()
  const [activePos, activeH5] = await Promise.all([expectStatus(sale('CASH'), 201), expectStatus(h5(activeKey), 200)])
  const activePosToRefundAfterPause = await expectStatus(sale('CASH'), 201)
  await h5Paid(activeH5.orderNo, true)
  assert.deepEqual(await expectStatus(h5(activeKey, darkService), 200), activeH5)
  const refundRecord = await prisma.saleRecord.findFirstOrThrow({ where: { ...scope, orderNo: activePos.orderNo } })
  const competing = await Promise.all([refund(refundRecord.id), refund(refundRecord.id)])
  assert.equal(competing.filter(result => result.status === 201).length, 1)
  assert.equal(competing.find(result => result.status !== 201)?.data.error, 'REFUND_QTY_EXCEEDED')
  assert.deepEqual([await balance(), await movementCount()], [7, 7])

  const pendingAcrossPause = await expectStatus(sale('DEFER'), 201)
  let pausedSale: ReturnType<typeof sale> | undefined
  await prisma.$transaction(async (tx) => {
    const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
    await tx.$executeRaw`
      UPDATE public."NativeInventoryStore" SET "salesEnabledAt" = NULL WHERE "tenantId" = ${tenant.id} AND "storeId" = ${store.id}
    `
    pausedSale = sale('CASH')
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const [{ waiting }] = await tx.$queryRaw<{ waiting: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM pg_stat_activity a WHERE ${pid} = ANY(pg_blocking_pids(a.pid))) AS waiting
      `
      if (waiting) return
      await delay(25)
    }
    assert.fail('POS must wait on the concurrent pause before its journal decision')
  }, { timeout: 5000 })
  await expectStatus(pausedSale!, 201)
  const pausedRefundRecord = await prisma.saleRecord.findFirstOrThrow({ where: { ...scope, orderNo: activePosToRefundAfterPause.orderNo } })
  await expectStatus(refund(pausedRefundRecord.id), 201)
  const pauseKey = randomUUID()
  const pausedOrder = await expectStatus(h5(pauseKey), 200)
  assert.deepEqual(await expectStatus(h5(pauseKey, darkService), 200), pausedOrder)
  assert.deepEqual([await balance(), await movementCount()], [7, 7])

  await toggle(true)
  await delay(5)
  await expectStatus(request(`/api/orders/${pendingAcrossPause.orderNo}/checkout`, 'POST', {
    paymentMethod: 'CASH', displayedCurrency: 'USD',
  }), 201)
  await h5Paid(prior.orderNo)
  assert.deepEqual([await balance(), await movementCount()], [7, 7])

  await toggle(false)
  let updated!: () => void
  let commitActivation!: () => void
  const updateReady = new Promise<void>(resolve => { updated = resolve })
  const mayCommit = new Promise<void>(resolve => { commitActivation = resolve })
  const activation = prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE public."NativeInventoryStore" SET "salesEnabledAt" = clock_timestamp()
      WHERE "tenantId" = ${tenant.id} AND "storeId" = ${store.id}
    `
    updated()
    await mayCommit
  }, { timeout: 5000 })
  const splitOrderNo = randomUUID()
  try {
    await Promise.race([activation, updateReady])
    await delay(5)
    await prisma.$transaction(async (tx) => {
      const addLine = async () => tx.saleRecord.create({ data: {
        ...scope, operatorUserId: owner.id, productId: product.id, barcode: product.barcode,
        productNameSnapshot: product.name, quantity: 1, unitPrice: 12, lineAmount: 12,
        saleType: 'SALE', status: 'PENDING_PAYMENT', orderNo: splitOrderNo, recordNo: randomUUID(),
      } })
      await addLine()
      commitActivation()
      await activation
      await addLine()
    }, { timeout: 5000 })
  } finally {
    commitActivation()
    await activation
  }
  await expectStatus(request(`/api/orders/${splitOrderNo}/checkout`, 'POST', {
    paymentMethod: 'CASH', displayedCurrency: 'USD',
  }), 201)
  assert.deepEqual([await balance(), await movementCount()], [7, 7])

})
