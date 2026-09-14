import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { POST } from '../app/api/sales/route'
import { prisma } from '../lib/prisma'

const databaseUrl = new URL(process.env.DATABASE_URL ?? 'http://invalid')
if (
  process.env.SALES_TRANSACTION_TIMEOUT_TEST_DATABASE !== '1'
  || !['127.0.0.1', 'localhost'].includes(databaseUrl.hostname)
) {
  throw new Error(
    'SALES_TRANSACTION_TIMEOUT_TEST_DATABASE=1 with an isolated localhost DATABASE_URL is required',
  )
}

const tenantId = 'sales-tx-timeout-tenant'
const storeId = 'sales-tx-timeout-store'
const userId = 'sales-tx-timeout-user'
const productAId = 'sales-tx-timeout-product-a'
const productBId = 'sales-tx-timeout-product-b'
const merchantConfigId = 'sales-tx-timeout-khqr'
const productA = { barcode: 'SALES-TX-A', price: 2.5 }
const productB = { barcode: 'SALES-TX-B', price: 1.25 }

async function removeTestTriggers() {
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS sales_tx_test_sale_delay ON "SaleRecord"')
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS sales_tx_test_log_delay ON "OperationLog"')
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS sales_tx_test_log_failure ON "OperationLog"')
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS public.sales_tx_test_delay()')
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS public.sales_tx_test_failure()')
}

async function clearSales() {
  await prisma.operationLog.deleteMany({ where: { tenantId } })
  await prisma.paymentIntent.deleteMany({ where: { tenantId } })
  await prisma.saleRecord.deleteMany({ where: { tenantId } })
}

async function resetFixture() {
  await removeTestTriggers()
  await clearSales()
  await prisma.merchantPaymentConfig.deleteMany({ where: { tenantId } })
  await prisma.product.deleteMany({ where: { tenantId } })
  await prisma.store.deleteMany({ where: { tenantId } })
  await prisma.user.deleteMany({ where: { tenantId } })
  await prisma.tenant.deleteMany({ where: { id: tenantId } })

  await prisma.tenant.create({ data: { id: tenantId, name: 'Sales Transaction Timeout Test' } })
  await prisma.store.create({
    data: {
      id: storeId,
      tenantId,
      code: 'SALESTX',
      name: 'Sales Transaction Timeout Store',
      currencyCode: 'USD',
    },
  })
  await prisma.user.create({
    data: {
      id: userId,
      tenantId,
      username: 'sales-tx-timeout',
      displayName: 'Sales Transaction Timeout User',
      role: 'OWNER',
    },
  })
  await prisma.product.createMany({
    data: [
      { id: productAId, tenantId, barcode: productA.barcode, name: 'Product A', sellPrice: productA.price },
      { id: productBId, tenantId, barcode: productB.barcode, name: 'Product B', sellPrice: productB.price },
    ],
  })
  await prisma.merchantPaymentConfig.create({
    data: {
      id: merchantConfigId,
      tenantId,
      storeId,
      provider: 'BAKONG_KHQR',
      merchantName: 'Sales TX Test',
      merchantAccountRef: '85500000000',
      currency: 'USD',
      khqrEnabled: true,
      isActive: true,
    },
  })
}

function saleRequest(
  items: Array<{ barcode: string; quantity: number }>,
  paymentMethod: 'CASH' | 'KHQR' = 'CASH',
) {
  return new NextRequest('http://localhost/api/sales', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': tenantId,
      'x-store-id': storeId,
      'x-user-id': userId,
      'x-role': 'OWNER',
    },
    body: JSON.stringify({ saleType: 'SALE', paymentMethod, items }),
  })
}

async function runSale(
  items: Array<{ barcode: string; quantity: number }>,
  paymentMethod: 'CASH' | 'KHQR' = 'CASH',
) {
  const startedAt = performance.now()
  const response = await POST(saleRequest(items, paymentMethod))
  const elapsedMs = Math.round(performance.now() - startedAt)
  return { response, elapsedMs, body: await response.json() }
}

async function readOrderState() {
  const [sales, logs, payments, printJobCount] = await Promise.all([
    prisma.saleRecord.findMany({ where: { tenantId }, orderBy: { recordNo: 'asc' } }),
    prisma.operationLog.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } }),
    prisma.paymentIntent.findMany({ where: { tenantId } }),
    prisma.eshopTrayPrintJob.count({ where: { tenantId } }),
  ])
  return { sales, logs, payments, printJobCount }
}

async function installStatementDelay() {
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION public.sales_tx_test_delay()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM pg_sleep(0.32);
      RETURN NULL;
    END
    $$
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER sales_tx_test_sale_delay
    BEFORE INSERT ON "SaleRecord"
    FOR EACH STATEMENT EXECUTE FUNCTION public.sales_tx_test_delay()
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER sales_tx_test_log_delay
    BEFORE INSERT ON "OperationLog"
    FOR EACH STATEMENT EXECUTE FUNCTION public.sales_tx_test_delay()
  `)
}

async function installOperationLogFailure() {
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION public.sales_tx_test_failure()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'SALES_TX_TEST_FAILURE';
    END
    $$
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER sales_tx_test_log_failure
    BEFORE INSERT ON "OperationLog"
    FOR EACH STATEMENT EXECUTE FUNCTION public.sales_tx_test_failure()
  `)
}

async function main() {
  await resetFixture()

  const single = await runSale([{ barcode: productA.barcode, quantity: 1 }])
  assert.equal(single.response.status, 201, 'single-item CASH sale succeeds')
  let state = await readOrderState()
  assert.equal(state.sales.length, 1)
  assert.equal(state.logs.length, 1)
  assert.equal(state.payments.length, 1)
  assert.equal(state.payments[0].status, 'PAID')
  assert.equal(state.payments[0].paymentMethod, 'CASH')
  assert.equal(state.payments[0].amount.toNumber(), productA.price)
  assert.ok(state.payments[0].paidAt)
  assert.equal(state.logs[0].saleRecordId, state.sales[0].id)
  assert.equal(state.printJobCount, 0, 'generic /api/sales PrintJob behavior remains unchanged')

  await clearSales()
  const mixedItems = Array.from({ length: 8 }, (_, index) => ({
    barcode: index % 2 === 0 ? productA.barcode : productB.barcode,
    quantity: 1,
  }))
  const multi = await runSale(mixedItems)
  assert.equal(multi.response.status, 201, 'multi-item CASH sale succeeds')
  state = await readOrderState()
  assert.equal(state.sales.length, mixedItems.length)
  assert.equal(state.logs.length, mixedItems.length)
  assert.equal(state.payments.length, 1)
  assert.equal(state.payments[0].status, 'PAID')
  assert.equal(state.payments[0].amount.toNumber(), 15)
  assert.equal(new Set(state.sales.map((sale) => sale.recordNo)).size, mixedItems.length)
  assert.equal(new Set(state.logs.map((log) => log.saleRecordId)).size, mixedItems.length)
  assert.deepEqual(
    new Set(state.logs.map((log) => log.saleRecordId)),
    new Set(state.sales.map((sale) => sale.id)),
  )
  assert.equal(state.printJobCount, 0)

  await clearSales()
  const khqr = await runSale([{ barcode: productB.barcode, quantity: 2 }], 'KHQR')
  assert.equal(khqr.response.status, 201, 'KHQR sale succeeds')
  state = await readOrderState()
  assert.equal(state.sales.length, 1)
  assert.equal(state.logs.length, 1)
  assert.equal(state.payments.length, 1)
  assert.equal(state.payments[0].status, 'PENDING')
  assert.equal(state.payments[0].paymentMethod, 'KHQR')
  assert.equal(state.payments[0].amount.toNumber(), productB.price * 2)
  assert.equal(state.payments[0].paidAt, null)
  assert.match(state.payments[0].khqrPayload ?? '', /^KHQR\|/)
  assert.equal(state.printJobCount, 0)

  await clearSales()
  await installStatementDelay()
  const delayed = await runSale(mixedItems)
  assert.equal(delayed.response.status, 201, 'eight-line sale survives production-like statement latency')
  assert.ok(delayed.elapsedMs < 5_000, `transaction must finish below 5000ms, got ${delayed.elapsedMs}ms`)
  state = await readOrderState()
  assert.equal(state.sales.length, mixedItems.length)
  assert.equal(state.logs.length, mixedItems.length)
  assert.equal(state.payments.length, 1)
  assert.equal(state.printJobCount, 0)
  await removeTestTriggers()

  await clearSales()
  await installOperationLogFailure()
  const failed = await (async () => {
    const originalConsoleError = console.error
    console.error = () => undefined
    try {
      return await runSale(mixedItems.slice(0, 3))
    } finally {
      console.error = originalConsoleError
    }
  })()
  assert.equal(failed.response.status, 500, 'mid-transaction OperationLog failure surfaces as 500')
  state = await readOrderState()
  assert.equal(state.sales.length, 0, 'SaleRecord batch rolls back')
  assert.equal(state.logs.length, 0, 'OperationLog batch rolls back')
  assert.equal(state.payments.length, 0, 'PaymentIntent is not left behind')
  assert.equal(state.printJobCount, 0, 'no PrintJob is introduced on rollback')

  console.log(JSON.stringify({
    result: 'PASS',
    singleItemMs: single.elapsedMs,
    multiItemMs: multi.elapsedMs,
    delayedEightLineMs: delayed.elapsedMs,
    delayedEightLineStatus: delayed.response.status,
    transactionWriteProfile: '4 database calls independent of line count',
  }))
}

main()
  .finally(async () => {
    try {
      await removeTestTriggers()
      await clearSales()
      await prisma.merchantPaymentConfig.deleteMany({ where: { tenantId } })
      await prisma.product.deleteMany({ where: { tenantId } })
      await prisma.store.deleteMany({ where: { tenantId } })
      await prisma.user.deleteMany({ where: { tenantId } })
      await prisma.tenant.deleteMany({ where: { id: tenantId } })
    } finally {
      await prisma.$disconnect()
    }
  })
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
