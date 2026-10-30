import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { prisma } from '../lib/prisma'
import { GET } from '../app/api/external/inventory-profit/feed/route'

type AnyRecord = Record<string, any>
const db = prisma as unknown as AnyRecord
const restore: Array<() => void> = []

function stub(model: string, method: string, implementation: (args: AnyRecord) => unknown) {
  const original = db[model][method]
  db[model][method] = implementation
  restore.push(() => { db[model][method] = original })
}

function request(query: string, authorization = 'Bearer feed-test-secret', extraHeaders: Record<string, string> = {}) {
  return new NextRequest(`http://localhost/api/external/inventory-profit/feed?${query}`, {
    headers: { authorization, ...extraHeaders },
  })
}

async function main() {
  const oldSecret = process.env.INVENTORY_PROFIT_FEED_SECRET
  const oldStoreId = process.env.INVENTORY_PROFIT_PILOT_STORE_ID
  process.env.INVENTORY_PROFIT_FEED_SECRET = 'feed-test-secret'
  process.env.INVENTORY_PROFIT_PILOT_STORE_ID = 'pilot-store'
  restore.push(() => {
    if (oldSecret === undefined) delete process.env.INVENTORY_PROFIT_FEED_SECRET
    else process.env.INVENTORY_PROFIT_FEED_SECRET = oldSecret
    if (oldStoreId === undefined) delete process.env.INVENTORY_PROFIT_PILOT_STORE_ID
    else process.env.INVENTORY_PROFIT_PILOT_STORE_ID = oldStoreId
  })

  const productWheres: AnyRecord[] = []
  const saleWheres: AnyRecord[] = []
  const orderWheres: AnyRecord[] = []
  stub('store', 'findUnique', async ({ where }) => {
    assert.deepEqual(where, { id: 'pilot-store' })
    return { id: 'pilot-store', tenantId: 'pilot-tenant', code: 'PILOT', status: 'ACTIVE' }
  })
  stub('product', 'findMany', async ({ where }) => {
    productWheres.push(where)
    return [{
      id: 'product-a', sku: 'SKU-A', barcode: 'BAR-A', name: 'A', status: 'ACTIVE',
      updatedAt: new Date('2026-10-30T10:00:00Z'),
    }]
  })
  stub('saleRecord', 'findMany', async ({ where }) => {
    saleWheres.push(where)
    if (where.saleType === 'REFUND') {
      return [{
        id: 'refund-a', recordNo: 'R-1', orderNo: 'R-1', originalSaleRecordId: 'sale-a',
        productId: 'product-a', barcode: 'BAR-A', productNameSnapshot: 'A', specSnapshot: null,
        unitPrice: { toNumber: () => 5 }, quantity: { toNumber: () => -2 },
        lineAmount: { toNumber: () => -10 }, createdAt: new Date('2026-10-30T11:00:00Z'),
        updatedAt: new Date('2026-10-30T11:00:00Z'),
      }]
    }
    return [{
      id: 'sale-a', recordNo: 'S-1', orderNo: 'O-1', originalSaleRecordId: null,
      productId: 'product-a', barcode: 'BAR-A', productNameSnapshot: 'A', specSnapshot: null,
      unitPrice: { toNumber: () => 5 }, quantity: { toNumber: () => 3 },
      lineAmount: { toNumber: () => 15 }, createdAt: new Date('2026-10-30T09:00:00Z'),
      updatedAt: new Date('2026-10-30T09:00:00Z'),
    }]
  })
  stub('customerOrder', 'findMany', async ({ where }) => {
    orderWheres.push(where)
    return [{
      id: 'customer-order-a', orderNo: 'CO-1',
      itemsJson: JSON.stringify([{
        productId: 'product-a', sku: 'SKU-A', barcode: 'BAR-A', name: 'A', quantity: 1, lineAmount: 5,
        customerName: 'must-not-leak',
      }]),
      totalAmount: { toNumber: () => 5 }, paidAt: new Date('2026-10-30T12:00:00Z'),
      updatedAt: new Date('2026-10-30T12:00:00Z'),
    }]
  })

  delete process.env.INVENTORY_PROFIT_FEED_SECRET
  assert.equal((await GET(request('dataset=products'))).status, 503, 'missing secret must fail closed')
  process.env.INVENTORY_PROFIT_FEED_SECRET = 'feed-test-secret'
  assert.equal((await GET(request('dataset=products', 'Bearer wrong', {
    cookie: 'auth-session=ignored',
    'x-desktop-device-token': 'ignored',
  }))).status, 401, 'cookie and Desktop token never replace the feed bearer secret')

  const products = await (await GET(request('dataset=products&limit=5000'))).json()
  assert.equal(products.items.length, 1)
  assert.equal(productWheres.at(-1)?.tenantId, 'pilot-tenant')
  assert.equal(JSON.stringify(products).includes('pilot-store'), false, 'feed does not echo internal store scope')

  const sales = await (await GET(request('dataset=sales&from=2026-10-30&to=2026-10-30'))).json()
  assert.equal(sales.items[0].lineAmount, 15)
  assert.equal(saleWheres.at(-1)?.createdAt.gte.toISOString(), '2026-10-29T17:00:00.000Z')
  assert.equal(saleWheres.at(-1)?.createdAt.lte.toISOString(), '2026-10-30T16:59:59.999Z', 'feed uses the Asia/Phnom_Penh business-day boundary')
  assert.deepEqual(
    { tenantId: saleWheres.at(-1)?.tenantId, storeId: saleWheres.at(-1)?.storeId, saleType: saleWheres.at(-1)?.saleType },
    { tenantId: 'pilot-tenant', storeId: 'pilot-store', saleType: 'SALE' },
  )

  const customerOrders = await (await GET(request('dataset=customer-orders&from=2026-10-30&to=2026-10-30'))).json()
  assert.equal(customerOrders.items[0].items[0].quantity, 1)
  assert.equal(JSON.stringify(customerOrders).includes('must-not-leak'), false)
  assert.equal(JSON.stringify(customerOrders).includes('customerPhone'), false)
  assert.deepEqual(
    { tenantId: orderWheres.at(-1)?.tenantId, storeId: orderWheres.at(-1)?.storeId, status: orderWheres.at(-1)?.status, paymentStatus: orderWheres.at(-1)?.paymentStatus },
    { tenantId: 'pilot-tenant', storeId: 'pilot-store', status: 'COMPLETED', paymentStatus: 'PAID' },
  )

  const refunds = await (await GET(request('dataset=refunds&from=2026-10-30&to=2026-10-30'))).json()
  assert.equal(refunds.items[0].quantity, 2, 'refund quantity is exported as an explicit positive quantity')
  assert.equal(refunds.items[0].refundAmount, 10)
  assert.equal(saleWheres.at(-1)?.saleType, 'REFUND')

  assert.equal((await GET(request('dataset=sales&from=2026-01-01&to=2026-10-30'))).status, 400, 'feed range is bounded to the weekly 35-day reload window')
  assert.equal((await GET(request('dataset=sales&from=2026-02-31&to=2026-02-31'))).status, 400, 'invalid calendar dates fail closed')
  console.log('inventory profit feed tests passed: secret, fixed store isolation, Phnom Penh range, sales, customer orders, refunds and PII exclusion')
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(() => { for (const fn of restore.reverse()) fn() })
