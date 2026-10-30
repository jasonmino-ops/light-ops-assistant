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

  let lastProductWhere: AnyRecord | null = null
  let lastSaleWhere: AnyRecord | null = null
  let lastOrderWhere: AnyRecord | null = null
  stub('store', 'findUnique', async ({ where }) => {
    assert.deepEqual(where, { id: 'pilot-store' })
    return { id: 'pilot-store', tenantId: 'pilot-tenant', code: 'PILOT', status: 'ACTIVE' }
  })
  stub('product', 'findMany', async ({ where }) => {
    lastProductWhere = where
    return [{
      id: 'product-a', sku: 'SKU-A', barcode: 'BAR-A', name: 'A', status: 'ACTIVE',
      updatedAt: new Date('2026-10-30T10:00:00Z'),
    }]
  })
  stub('saleRecord', 'findMany', async ({ where }) => {
    lastSaleWhere = where
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
    lastOrderWhere = where
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
  assert.equal(lastProductWhere?.tenantId, 'pilot-tenant')
  assert.equal(JSON.stringify(products).includes('pilot-store'), false, 'feed does not echo internal store scope')

  const sales = await (await GET(request('dataset=sales&from=2026-10-30&to=2026-10-30'))).json()
  assert.equal(sales.items[0].lineAmount, 15)
  assert.deepEqual(
    { tenantId: lastSaleWhere?.tenantId, storeId: lastSaleWhere?.storeId, saleType: lastSaleWhere?.saleType },
    { tenantId: 'pilot-tenant', storeId: 'pilot-store', saleType: 'SALE' },
  )

  const customerOrders = await (await GET(request('dataset=customer-orders&from=2026-10-30&to=2026-10-30'))).json()
  assert.equal(customerOrders.items[0].items[0].quantity, 1)
  assert.equal(JSON.stringify(customerOrders).includes('must-not-leak'), false)
  assert.equal(JSON.stringify(customerOrders).includes('customerPhone'), false)
  assert.deepEqual(
    { tenantId: lastOrderWhere?.tenantId, storeId: lastOrderWhere?.storeId, status: lastOrderWhere?.status, paymentStatus: lastOrderWhere?.paymentStatus },
    { tenantId: 'pilot-tenant', storeId: 'pilot-store', status: 'COMPLETED', paymentStatus: 'PAID' },
  )

  const refunds = await (await GET(request('dataset=refunds&from=2026-10-30&to=2026-10-30'))).json()
  assert.equal(refunds.items[0].quantity, 2, 'refund quantity is exported as an explicit positive quantity')
  assert.equal(refunds.items[0].refundAmount, 10)
  assert.equal(lastSaleWhere?.saleType, 'REFUND')

  assert.equal((await GET(request('dataset=sales&from=2026-01-01&to=2026-10-30'))).status, 400, 'feed range is bounded to the weekly 35-day reload window')
  console.log('inventory profit feed tests passed: secret, fixed store isolation, sales, customer orders, refunds and PII exclusion')
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(() => { for (const fn of restore.reverse()) fn() })
