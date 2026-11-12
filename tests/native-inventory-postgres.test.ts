import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { NextRequest } from 'next/server'
import { GET, PUT } from '../app/api/native-inventory/[resource]/route'
import { signSession } from '../lib/session'
import { prisma } from '../lib/prisma'
import { issuePosDeviceSession } from '../lib/desktop-pos-auth'
import { createDesktopDeviceToken } from '../lib/desktop-activation/crypto'

const database = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/invalid')
const localFixture = process.env.NATIVE_INVENTORY_TEST_DATABASE === '1' &&
  ['127.0.0.1', 'localhost'].includes(database.hostname) &&
  /^\/native_inventory_test_[a-z0-9_]+$/.test(database.pathname) && !database.search
if (!localFixture) throw new Error('Set NATIVE_INVENTORY_TEST_DATABASE=1 and use a disposable loopback native_inventory_test_* database')

test('native inventory posts receipts and sale transitions in isolated PostgreSQL', async (t) => {
  t.after(async () => prisma.$disconnect())
  if (process.env.NATIVE_INVENTORY_REQUIRE_NON_SUPERUSER === '1') {
    const [role] = await prisma.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolsuper, rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = current_user
    `
    assert.deepEqual(role, { rolsuper: false, rolbypassrls: false })
  }
  const botToken = 'inventory-test-telegram-token'
  process.env.TELEGRAM_BOT_TOKEN = botToken
  process.env.DESKTOP_DEVICE_TOKEN_SECRET = 'inventory-test-desktop-secret'
  process.env.DESKTOP_ACTIVATION_PIN_SECRET = 'inventory-test-pin-secret'
  const first = await prisma.tenant.create({ data: { name: 'Inventory tenant 1' } })
  const second = await prisma.tenant.create({ data: { name: 'Inventory tenant 2' } })
  const shop = (tenantId: string) => prisma.store.create({ data: { name: 'Inventory fixture', code: randomUUID(), tenantId } })
  const [store, peer, other, disabled] = await Promise.all([shop(first.id), shop(first.id), shop(second.id), shop(first.id)])
  const user = (tenantId: string, role: 'OWNER' | 'STAFF') => prisma.user.create({
    data: { tenantId, role, username: randomUUID(), displayName: 'Inventory fixture', telegramId: randomUUID() },
  })
  const [owner, receiver, denied, otherOwner] = await Promise.all([
    user(first.id, 'OWNER'), user(first.id, 'STAFF'), user(first.id, 'STAFF'), user(second.id, 'OWNER'),
  ])
  await prisma.userStoreRole.createMany({ data: [
    { tenantId: first.id, storeId: store.id, userId: owner.id, role: 'OWNER' },
    { tenantId: first.id, storeId: peer.id, userId: owner.id, role: 'OWNER' },
    { tenantId: first.id, storeId: disabled.id, userId: owner.id, role: 'OWNER' },
    { tenantId: first.id, storeId: store.id, userId: receiver.id, role: 'STAFF' },
    { tenantId: first.id, storeId: store.id, userId: denied.id, role: 'STAFF' },
    { tenantId: second.id, storeId: other.id, userId: otherOwner.id, role: 'OWNER' },
  ] })
  const product = await prisma.product.create({ data: {
    tenantId: first.id, name: 'Inventory product', barcode: randomUUID(), sellPrice: 10,
    mainUnitName: 'piece', auxEnabled: true, auxUnitName: 'box', auxBarcode: randomUUID(), auxConversionFactor: 12, auxSellPrice: 100,
  } })

  const sale = (shopId: string, overrides: {
    status?: 'COMPLETED' | 'PENDING_PAYMENT' | 'CANCELLED'
    saleType?: 'SALE' | 'REFUND'
    quantity?: number
    lineAmount?: number
    originalSaleRecordId?: string
  } = {}) => prisma.saleRecord.create({ data: {
    tenantId: first.id, storeId: shopId, operatorUserId: owner.id, productId: product.id, saleType: 'SALE',
    recordNo: randomUUID(), barcode: product.barcode, productNameSnapshot: product.name,
    unitPrice: 100, quantity: 12, lineAmount: 100, sellingUnitType: 'AUX', sellingUnitNameSnapshot: 'box', sellingQuantity: 1, sellingConversionFactor: 12,
    ...overrides,
  } })
  const historical = await sale(store.id)

  await prisma.nativeInventoryStore.createMany({
    data: [store, peer, other].map((s) => ({ tenantId: s.tenantId, storeId: s.id, currencyCode: s.currencyCode, enabledAt: new Date() })),
  })

  type Person = typeof owner
  const session = (person: Person, storeId: string) => signSession({
    tenantId: person.tenantId, userId: person.id, storeId, role: person.role,
  })
  function personProof(person: Person, ageSeconds = 0) {
    const authDate = String(Math.floor(Date.now() / 1000) - ageSeconds)
    const identity = JSON.stringify({ id: person.telegramId })
    const secret = createHmac('sha256', 'WebAppData').update(botToken).digest()
    const hash = createHmac('sha256', secret).update(`auth_date=${authDate}\nuser=${identity}`).digest('hex')
    return new URLSearchParams({ auth_date: authDate, user: identity, hash }).toString()
  }
  async function api(
    resource: string,
    options: { person?: Person | null; shopId?: string; body?: object; query?: string; headers?: Record<string, string> } = {},
  ) {
    const person = options.person === undefined ? owner : options.person
    const req = new NextRequest(`http://localhost/api/native-inventory/${resource}${options.query ?? ''}`, {
      method: options.body ? 'PUT' : 'GET',
      headers: {
        ...(person ? { cookie: `auth-session=${session(person, options.shopId ?? store.id)}`, 'x-telegram-init-data': personProof(person) } : {}),
        ...options.headers,
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    })
    const response = await (options.body ? PUT : GET)(req, { params: Promise.resolve({ resource }) })
    return { status: response.status, ...await response.json() }
  }
  const receiptId = randomUUID()
  const supplierId = randomUUID()
  const balance = async (itemId: string) => prisma.nativeInventoryItem.findUniqueOrThrow({
    where: { tenantId_storeId_id: { tenantId: first.id, storeId: store.id, id: itemId } },
  })

  assert.equal((await api('access', { person: denied })).error, 'RECEIVING_ACCESS_DENIED')
  assert.equal((await api('access', { shopId: disabled.id })).error, 'NATIVE_INVENTORY_DISABLED')
  assert.equal((await api('access', { person: otherOwner })).error, 'STORE_ACCESS_DENIED')
  assert.equal((await api('access', { person: null })).status, 401)
  assert.equal((await api('access', { headers: { 'x-telegram-init-data': '' } })).error, 'PERSON_PROOF_REQUIRED')
  const desktopHeaders = { 'x-lightops-client': 'desktop-pos', 'x-pos-operator-source': 'ACCOUNT' }
  assert.equal((await api('access', { headers: desktopHeaders })).error, 'DESKTOP_DEVICE_REQUIRED')
  assert.equal((await api('access', { headers: { authorization: 'Bearer unmanaged' } })).error, 'DESKTOP_DEVICE_REQUIRED')
  await prisma.tenantSubscription.create({ data: { tenantId: first.id, status: 'ACTIVE' } })
  async function issueTerminal() {
    const { token, ...credential } = createDesktopDeviceToken()
    const terminal = await prisma.desktopDevice.create({ data: {
      tenantId: first.id, storeId: store.id, installationIdHash: randomUUID(), ...credential,
    } })
    return { token, terminal }
  }
  const { token: nativeToken, terminal } = await issueTerminal()
  const { token: otherNativeToken } = await issueTerminal()
  const browserId = `desktop-${terminal.id}`
  const device = await prisma.$transaction((tx) => issuePosDeviceSession(tx, {
    tenantId: first.id, storeId: store.id, storeCode: store.code, browserDeviceId: browserId,
    issuedBy: 'DESKTOP_DEVICE', issuedByUserId: null, displayName: 'Inventory test desktop',
  }))
  const deviceHeaders = { ...desktopHeaders, 'x-pos-device-token': device.token, 'x-pos-device-id': browserId }
  assert.equal((await api('access', { headers: deviceHeaders })).outcome, 'SUCCESS')
  assert.equal((await api('access', { headers: { ...deviceHeaders, authorization: `Bearer ${nativeToken}` } })).status, 200)
  assert.equal((await api('access', { headers: { ...deviceHeaders, authorization: `Bearer ${otherNativeToken}` } })).error, 'DESKTOP_DEVICE_REQUIRED')
  assert.equal((await api('access', { headers: { authorization: `Bearer ${nativeToken}` } })).error, 'DESKTOP_DEVICE_REQUIRED')

  assert.equal((await api('access', { headers: deviceHeaders, shopId: peer.id })).status, 403)
  assert.equal((await api('access', { headers: deviceHeaders, person: denied })).status, 403)
  assert.equal((await api('access', { headers: deviceHeaders, person: null })).status, 401)
  assert.equal((await api('access', { headers: { ...deviceHeaders, 'x-telegram-init-data': personProof(owner, 901) } })).error, 'PERSON_PROOF_INVALID')
  assert.equal((await api('access', { headers: { ...deviceHeaders, 'x-telegram-init-data': personProof(denied) } })).error, 'PERSON_PROOF_INVALID')
  await prisma.desktopDevice.update({ where: { id: terminal.id }, data: { tokenExpiresAt: new Date(Date.now() - 1000) } })
  assert.equal((await api('access', { headers: deviceHeaders })).error, 'DESKTOP_DEVICE_REQUIRED')
  await prisma.desktopDevice.update({ where: { id: terminal.id }, data: { status: 'REVOKED', tokenExpiresAt: new Date(Date.now() + 60000) } })
  assert.equal((await api('access', { headers: deviceHeaders })).error, 'DESKTOP_DEVICE_REQUIRED')
  await prisma.desktopDevice.update({ where: { id: terminal.id }, data: { status: 'ACTIVE' } })
  await prisma.browserPosDevice.update({ where: { id: device.sessionId }, data: { status: 'REVOKED' } })
  assert.equal((await api('access', { headers: deviceHeaders })).error, 'DESKTOP_DEVICE_REQUIRED')

  assert.equal((await api('receivers', { body: { userId: receiver.id, enabled: true } })).status, 200)
  assert.equal((await api('profit', { person: receiver })).error, 'OWNER_REQUIRED')
  const itemInput = { id: randomUUID(), productId: product.id, lowStockAt: '6' }
  const item = (await api('items', { body: itemInput })).data
  assert.deepEqual((await api('items', { body: itemInput })).data, item)
  const material = (await api('items', { body: {
    id: randomUUID(), materialName: 'Syrup', baseUnitName: 'litre',
    units: [{ name: 'bottle', factor: '0.75', barcode: 'syrup-fixture' }],
  } })).data
  assert.equal((await api('items', { person: otherOwner, shopId: other.id, body: { id: randomUUID(), productId: product.id } })).error, 'PRODUCT_NOT_FOUND')
  assert.equal((await api('items', { person: receiver, query: `?q=${product.auxBarcode}&mode=barcode` })).data[0].id, item.id)
  assert.equal((await api('items', { person: receiver, query: '?q=syrup-fixture&mode=barcode' })).data[0].id, material.id)
  assert.equal((await api('items', { person: receiver })).data[0].averageUnitCost, undefined)
  const materialUnit = (await api('items', { query: '?q=syrup-fixture&mode=barcode' })).data[0].units[1].id
  const imports = await api('import-preview', { person: receiver, body: { rows: [
    { barcode: product.auxBarcode, quantity: '2.0', unitPrice: '48' },
    { barcode: 'syrup-fixture', quantity: '0', unitPrice: '1' },
    { barcode: 'unknown', quantity: '1', unitPrice: '1' },
  ] } })
  assert.deepEqual(imports.data.map((row: { itemId?: string; unitId?: string; error?: string }) => [row.itemId, row.unitId, row.error]), [
    [item.id, 'AUX', undefined], [undefined, undefined, 'INVALID_DECIMAL'], [undefined, undefined, 'ITEM_NOT_FOUND'],
  ])
  assert.equal((await api('suppliers', { person: receiver, body: { id: supplierId, name: 'Supplier' } })).status, 200)
  assert.equal((await api('suppliers', { person: receiver, body: { id: supplierId, name: 'Different' } })).status, 403)

  const draft = {
    id: receiptId, supplierId, revision: 0,
    lines: [
      { itemId: item.id, unitId: 'AUX', quantity: '2', unitPrice: '48' },
      { itemId: material.id, unitId: materialUnit, quantity: '4', unitPrice: '1.50' },
    ],
  }
  assert.equal((await api('receipts', { person: receiver, body: draft })).data.total, '102')
  assert.equal((await api('receipts', { person: receiver, body: draft })).data.revision, 1)
  assert.equal((await api('receipts', { person: receiver, body: { ...draft, lines: draft.lines.slice(1) } })).status, 409)
  assert.equal((await balance(item.id)).onHand.toString(), '0')
  assert.equal((await api('receipts', { shopId: peer.id, query: `?id=${receiptId}` })).status, 404)
  assert.equal((await api('receipt-confirmation', { person: otherOwner, shopId: other.id, body: { id: receiptId, revision: 1 } })).status, 404)

  const confirm = { person: receiver, body: { id: receiptId, revision: 1 } }
  const results = await Promise.all([api('receipt-confirmation', confirm), api('receipt-confirmation', confirm)])
  assert.equal(results[0].outcome, 'SUCCESS')
  assert.equal(results[0].data.postedAt, results[1].data.postedAt)
  assert.equal((await api('receipts', { person: receiver, query: `?id=${receiptId}` })).data.postedAt, results[0].data.postedAt)
  assert.equal((await balance(item.id)).onHand.toString(), '24')
  assert.equal((await balance(material.id)).onHand.toString(), '3')
  assert.equal((await balance(item.id)).averageUnitCost?.toString(), '4')
  assert.equal((await api('suppliers', { query: `?id=${supplierId}` })).data.totals[0]._sum.total, '102')

  const precisionItem = (await api('items', {
    body: { id: randomUUID(), materialName: 'Precision sample', baseUnitName: 'kg' },
  })).data
  await prisma.nativeInventoryItem.update({
    where: { tenantId_storeId_id: { tenantId: first.id, storeId: store.id, id: precisionItem.id } },
    data: { onHand: '2', averageUnitCost: null },
  })
  const precisionReceiptId = randomUUID()
  const tinyDraft = await api('receipts', { body: {
    id: precisionReceiptId, supplierId, revision: 0,
    lines: [{ itemId: precisionItem.id, unitId: 'BASE', quantity: '0.1', unitPrice: '0.04' }],
  } })
  assert.equal(tinyDraft.data.total, '0')
  assert.equal((await api('receipt-confirmation', { body: { id: precisionReceiptId, revision: 1 } })).status, 200)
  assert.equal((await balance(precisionItem.id)).onHand.toString(), '2.1')
  assert.equal((await balance(precisionItem.id)).averageUnitCost?.toString(), '0.04')
  const costSnapshot = await prisma.nativeInventoryMovement.findFirstOrThrow({
    where: { tenantId: first.id, storeId: store.id, sourceId: `${precisionReceiptId}:1`, type: 'RECEIPT' },
  })
  assert.equal(costSnapshot.unitCost?.toString(), '0.04')
  const batchId = randomUUID()
  const batchDraft = await api('receipts', { body: {
    id: batchId, supplierId, revision: 0,
    lines: Array.from({ length: 100 }, () => ({ itemId: precisionItem.id, unitId: 'BASE', quantity: '0.1', unitPrice: '0.04' })),
  } })
  assert.equal(batchDraft.status, 200)
  assert.equal((await api('receipt-confirmation', { body: { id: batchId, revision: 1 } })).status, 200)
  const batchMoves = await prisma.nativeInventoryMovement.findMany({ where: {
    tenantId: first.id, storeId: store.id, sourceId: { startsWith: `${batchId}:` }, type: 'RECEIPT',
  } })
  assert.equal(batchMoves.length, 100)
  assert.equal(batchMoves.find((move) => move.sourceId === `${batchId}:1`)?.balance.toString(), '2.2')
  assert.equal(batchMoves.find((move) => move.sourceId === `${batchId}:100`)?.balance.toString(), '12.1')
  assert.equal((await balance(precisionItem.id)).averageUnitCost?.toString(), '0.04')


  const secondDraft = { ...draft, id: randomUUID(), lines: [{ itemId: item.id, unitId: 'BASE', quantity: '6', unitPrice: '9' }] }
  assert.equal((await api('receipts', { body: secondDraft })).status, 200)
  assert.equal((await api('receipt-confirmation', { body: { id: secondDraft.id, revision: 1 } })).status, 200)
  assert.equal((await balance(item.id)).averageUnitCost?.toString(), '5')

  const pending = await sale(store.id, { status: 'PENDING_PAYMENT' })
  const pendingCancelled = await sale(store.id, { status: 'PENDING_PAYMENT' })
  await prisma.saleRecord.update({ where: { id: pendingCancelled.id }, data: { status: 'CANCELLED' } })
  await sale(disabled.id)
  await sale(store.id, { saleType: 'REFUND', quantity: -1, originalSaleRecordId: historical.id, lineAmount: -10 })
  assert.equal((await balance(item.id)).onHand.toString(), '30')

  await prisma.saleRecord.update({ where: { id: pending.id }, data: { status: 'COMPLETED' } })
  await prisma.saleRecord.update({ where: { id: pending.id }, data: { status: 'COMPLETED' } })
  assert.equal((await balance(item.id)).onHand.toString(), '18')
  const nextReceipt = { ...secondDraft, id: randomUUID(), lines: [{ ...secondDraft.lines[0], unitPrice: '10' }] }
  assert.equal((await api('receipts', { body: nextReceipt })).status, 200)
  assert.equal((await api('receipt-confirmation', { body: { id: nextReceipt.id, revision: 1 } })).status, 200)
  const refund = await sale(peer.id, { saleType: 'REFUND', quantity: -3, originalSaleRecordId: pending.id, lineAmount: -25 })
  assert.equal((await balance(item.id)).onHand.toString(), '27')
  const range = `?from=${new Date(Date.now() - 60000).toISOString()}&until=${new Date(Date.now() + 60000).toISOString()}`
  const [profit] = (await api('profit', { query: range })).data
  assert.deepEqual([profit.revenue, profit.cost, profit.profit, profit.marginPercent], ['75', '45', '30', '40'])
  assert.deepEqual((await api('profit', { query: range, shopId: peer.id })).data, [])

  await prisma.saleRecord.update({ where: { id: refund.id }, data: { status: 'CANCELLED' } })
  assert.equal((await balance(item.id)).onHand.toString(), '24')
  assert.equal((await balance(item.id)).averageUnitCost?.toDecimalPlaces(8).toString(), '6.25')
  await prisma.saleRecord.update({ where: { id: pending.id }, data: { status: 'CANCELLED' } })
  await prisma.saleRecord.update({ where: { id: pending.id }, data: { status: 'CANCELLED' } })
  assert.equal((await balance(item.id)).onHand.toString(), '36')
  assert.deepEqual(await prisma.saleRecord.findUnique({ where: { id: historical.id } }), historical)

  const adjustment = { id: randomUUID(), itemId: item.id, quantity: '-30', reason: 'Count' }
  assert.equal((await api('adjustments', { body: adjustment })).status, 200)
  assert.equal((await api('adjustments', { body: adjustment })).status, 200)
  assert.equal((await api('adjustments', { body: { ...adjustment, quantity: '-29' } })).status, 409)
  assert.equal((await api('items', { query: `?q=${product.barcode}` })).data[0].lowStock, true)

  await prisma.nativeInventoryItem.update({
    where: { tenantId_storeId_id: { tenantId: first.id, storeId: store.id, id: material.id } },
    data: { onHand: `${'9'.repeat(314)}.999999` },
  })
  const failsAfterFirstLine = { ...draft, id: randomUUID() }
  assert.equal((await api('receipts', { body: failsAfterFirstLine })).status, 200)
  assert.equal((await api('receipt-confirmation', { body: { id: failsAfterFirstLine.id, revision: 1 } })).outcome, 'UNKNOWN')
  assert.equal((await balance(item.id)).onHand.toString(), '6')
  assert.equal((await api('receipts', { query: `?id=${failsAfterFirstLine.id}` })).data.postedAt, null)

  await prisma.nativeInventoryItem.update({
    where: { tenantId_storeId_id: { tenantId: first.id, storeId: store.id, id: material.id } },
    data: { onHand: '3' },
  })
  assert.equal((await api('receipt-confirmation', { body: { id: failsAfterFirstLine.id, revision: 1 } })).outcome, 'SUCCESS')
  assert.equal((await balance(item.id)).onHand.toString(), '30')

  const qrOrderNo = randomUUID()
  await prisma.$transaction(async (tx) => {
    await tx.saleRecord.create({ data: {
      tenantId: first.id, storeId: store.id, operatorUserId: owner.id, productId: product.id, saleType: 'SALE',
      recordNo: qrOrderNo, orderNo: qrOrderNo, barcode: product.barcode, productNameSnapshot: product.name,
      unitPrice: 10, quantity: 2, lineAmount: 20, status: 'COMPLETED',
    } })
    await tx.paymentIntent.create({ data: {
      tenantId: first.id, storeId: store.id, operatorUserId: owner.id, orderNo: qrOrderNo, status: 'PENDING',
      paymentMethod: 'KHQR', amount: 20,
    } })
  })
  assert.equal((await balance(item.id)).onHand.toString(), '30')
  const qrSale = await prisma.saleRecord.findUniqueOrThrow({ where: { recordNo: qrOrderNo } })
  const earlyRefund = await sale(store.id, { saleType: 'REFUND', quantity: -1, originalSaleRecordId: qrSale.id, lineAmount: -10 })
  assert.equal(await prisma.nativeInventoryMovement.count({ where: { sourceId: earlyRefund.id } }), 0)
  await prisma.paymentIntent.update({ where: { orderNo: qrOrderNo }, data: { status: 'PAID' } })
  await prisma.paymentIntent.update({ where: { orderNo: qrOrderNo }, data: { status: 'PAID' } })
  assert.equal((await balance(item.id)).onHand.toString(), '29')
  assert.equal(await prisma.nativeInventoryMovement.count({ where: { sourceId: earlyRefund.id, type: 'REFUND' } }), 1)
  await prisma.saleRecord.update({ where: { id: earlyRefund.id }, data: { status: 'CANCELLED' } })
  assert.equal((await balance(item.id)).onHand.toString(), '28')

  const h5 = await prisma.customerOrder.create({ data: {
    tenantId: first.id, storeId: store.id, storeCode: store.code, orderNo: randomUUID(),
    status: 'COMPLETED', paymentStatus: 'UNPAID', totalAmount: '15',
    itemsJson: JSON.stringify([{ productId: product.id, quantity: 2, lineAmount: 20 }]),
  } })
  assert.equal((await balance(item.id)).onHand.toString(), '28')
  await prisma.customerOrder.update({ where: { id: h5.id }, data: { paymentStatus: 'PAID' } })
  await prisma.customerOrder.update({ where: { id: h5.id }, data: { paymentStatus: 'PAID' } })
  assert.equal((await balance(item.id)).onHand.toString(), '26')
  const h5Movement = await prisma.nativeInventoryMovement.findFirstOrThrow({ where: { originalId: h5.id, type: 'CUSTOMER_SALE' } })
  assert.equal(h5Movement.revenue?.toString(), '15')
  await prisma.customerOrder.update({ where: { id: h5.id }, data: { status: 'CANCELLED' } })
  assert.equal((await balance(item.id)).onHand.toString(), '28')

  await prisma.store.update({ where: { id: store.id }, data: { currencyCode: 'XAF' } })
  assert.equal((await api('access')).error, 'INVENTORY_CURRENCY_MISMATCH')
  const differentCurrency = await sale(store.id, { quantity: 1, lineAmount: 2000 })
  assert.equal((await balance(item.id)).onHand.toString(), '27')
  const excluded = await prisma.nativeInventoryMovement.findFirstOrThrow({ where: { sourceId: differentCurrency.id } })
  assert.equal(excluded.revenue, null)
  assert.equal(excluded.reason, 'CURRENCY_MISMATCH')
  await prisma.store.update({ where: { id: store.id }, data: { currencyCode: 'USD' } })
  assert.equal((await api('profit', { query: range })).data[0].currencyMismatchCount, 1)
  assert.equal((await api('profit', { query: range })).data[0].profit, null)
  const beforeOversale = await balance(item.id)
  const oversale = await sale(store.id, { quantity: 30, lineAmount: 300 })
  assert.equal((await balance(item.id)).onHand.toString(), '-3')
  const oversaleMovement = await prisma.nativeInventoryMovement.findFirstOrThrow({ where: { sourceId: oversale.id } })
  assert.equal(oversaleMovement.unitCost, null)
  await prisma.saleRecord.update({ where: { id: oversale.id }, data: { status: 'CANCELLED' } })
  assert.equal((await balance(item.id)).onHand.toString(), beforeOversale.onHand.toString())
  assert.equal((await balance(item.id)).averageUnitCost?.toString(), beforeOversale.averageUnitCost?.toString())

  const overdrawnH5 = await prisma.customerOrder.create({ data: {
    tenantId: first.id, storeId: store.id, storeCode: store.code, orderNo: randomUUID(),
    status: 'COMPLETED', paymentStatus: 'PAID', totalAmount: '310',
    itemsJson: JSON.stringify([
      { productId: product.id, quantity: 30, lineAmount: 300 },
      { productId: product.id, quantity: 1, lineAmount: 10 },
    ]),
  } })
  assert.equal((await balance(item.id)).onHand.toString(), '-4')
  await prisma.customerOrder.update({ where: { id: overdrawnH5.id }, data: { status: 'CANCELLED' } })
  assert.equal((await balance(item.id)).onHand.toString(), beforeOversale.onHand.toString())
  assert.equal((await balance(item.id)).averageUnitCost?.toString(), beforeOversale.averageUnitCost?.toString())

  const retiring = await prisma.product.create({ data: {
    tenantId: first.id, name: 'Archived stock name', barcode: randomUUID(), sellPrice: 10, mainUnitName: 'piece',
  } })
  const retiringItem = (await api('items', { body: { id: randomUUID(), productId: retiring.id } })).data
  await prisma.product.delete({ where: { id: retiring.id } })
  assert.equal((await balance(retiringItem.id)).productId, null)
  assert.equal((await api('items', { query: '?q=Archived%20stock%20name' })).data[0].name, 'Archived stock name')

  const peerItem = (await api('items', { shopId: peer.id, body: { id: randomUUID(), productId: product.id } })).data
  const freeLines = [{ productId: product.id, quantity: 1e308, lineAmount: 0 }, { productId: product.id, quantity: 1e308, lineAmount: 0 }]
  const freeOrder = await prisma.customerOrder.create({ data: {
    tenantId: first.id, storeId: peer.id, storeCode: peer.code, orderNo: randomUUID(),
    status: 'COMPLETED', paymentStatus: 'PAID', totalAmount: '0', itemsJson: JSON.stringify(freeLines),
  } })
  assert.equal(await prisma.nativeInventoryMovement.count({ where: { originalId: freeOrder.id, type: 'CUSTOMER_SALE' } }), 2)
  const peerBalance = await prisma.nativeInventoryItem.findUniqueOrThrow({
    where: { tenantId_storeId_id: { tenantId: first.id, storeId: peer.id, id: peerItem.id } },
  })
  assert.equal(peerBalance.onHand.toString(), '-2e+308')

  assert.equal((await api('receivers', { body: { userId: receiver.id, enabled: false } })).status, 200)
  assert.equal((await api('receipts', { person: receiver })).status, 403)
})
