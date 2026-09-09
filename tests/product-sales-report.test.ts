import assert from 'node:assert/strict'
import fs from 'node:fs'
import { Prisma } from '@prisma/client'
import { businessWindow, localDate, reportRange } from '../lib/product-sales/dates'
import { createAccumulator } from '../lib/product-sales/aggregate'
import { parseSelection, ReportError } from '../lib/product-sales/contract'
import { canReadReport, selectedStores } from '../lib/product-sales/service'
import { scheduledAuthorization, generateDailyReports } from '../lib/product-sales/daily'
import { reportPrintHtml } from '../lib/product-sales/print'
import type { OwnerStoreAccess } from '../lib/owner-store-hub'

const now = new Date('2026-09-09T10:00:00Z') // Wednesday 17:00 Cambodia
const contains = (range: ReturnType<typeof reportRange>, instant: string) => range.windows.some((window) => Date.parse(instant) >= Date.parse(window.from) && Date.parse(instant) < Date.parse(window.to))
const range = reportRange({ period: 'TODAY' }, now)
assert.deepEqual(businessWindow('2026-09-09'), { from: '2026-09-08T23:00:00.000Z', to: '2026-09-09T17:00:00.000Z' })
assert.equal(contains(range, '2026-09-09T05:59:59.999+07:00'), false)
assert.equal(contains(range, '2026-09-09T06:00:00+07:00'), true)
assert.equal(contains(range, '2026-09-09T23:59:59.999+07:00'), true)
assert.equal(contains(range, '2026-09-10T00:00:00+07:00'), false)
assert.equal(localDate(new Date('2026-09-08T17:00:00Z')), '2026-09-09')
assert.equal(reportRange({ period: 'YESTERDAY' }, now).dateFrom, '2026-09-08')
const week = reportRange({ period: 'WEEK' }, now)
assert.equal(week.windows[0].from, '2026-09-06T23:00:00.000Z')
assert.equal(week.windows[0].to, now.toISOString())
assert.equal(contains(week, '2026-09-08T03:00:00+07:00'), true, 'Founder specified continuous week/month windows')
assert.equal(contains(week, now.toISOString()), false, 'query end is exclusive')
assert.equal(reportRange({ period: 'WEEK' }, new Date('2026-09-07T05:00:00+07:00')).windows.length, 0)
assert.equal(reportRange({ period: 'MONTH' }, now).windows[0].from, '2026-08-31T23:00:00.000Z')
const custom = reportRange({ period: 'CUSTOM', dateFrom: '2026-09-07', dateTo: '2026-09-09' }, now)
assert.equal(custom.windows.length, 3)
for (const date of ['2026-09-07', '2026-09-08', '2026-09-09']) {
  assert.equal(contains(custom, `${date}T00:00:00+07:00`), false)
  assert.equal(contains(custom, `${date}T05:59:59+07:00`), false)
  assert.equal(contains(custom, `${date}T06:00:00+07:00`), true)
}
assert.equal(reportRange({ period: 'CUSTOM', dateFrom: '2024-02-28', dateTo: '2024-03-01' }, now).windows.length, 3)
for (const dates of [['2026-02-30', '2026-03-01'], ['2026-09-09', '2026-09-08'], ['2026-09-09', '2026-09-10'], ['2024-01-01', '2026-09-09']]) {
  assert.throws(() => reportRange({ period: 'CUSTOM', dateFrom: dates[0], dateTo: dates[1] }, now), ReportError)
}
assert.throws(() => reportRange({ period: 'FOREVER' }, now), ReportError)
assert.throws(() => parseSelection({ products: [] }), ReportError)
assert.throws(() => parseSelection({ products: [{ tenantId: 't', productId: 'p' }, { tenantId: 't', productId: 'p' }] }), /DUPLICATE_PRODUCT/)
assert.throws(() => parseSelection({ products: Array.from({ length: 101 }, (_, index) => ({ tenantId: 't', productId: `p${index}` })) }), ReportError)
assert.throws(() => parseSelection({ products: [{ tenantId: 't', productId: '../secret' }] }), ReportError)
const stores: OwnerStoreAccess[] = [
  { tenantId: 'a', storeId: 'one', storeName: 'Shop A', currencyCode: 'USD', userId: 'owner-a', createdAt: now },
  { tenantId: 'a', storeId: 'two', storeName: 'Shop B', currencyCode: 'USD', userId: 'owner-a', createdAt: now },
  { tenantId: 'b', storeId: 'three', storeName: 'Shop C', currencyCode: 'XAF', userId: 'owner-b', createdAt: now },
]
const products = [{ tenantId: 'a', productId: 'p1', name: '<script>bad()</script>', barcode: 'SAME' }, { tenantId: 'a', productId: 'p2', name: 'Coffee', barcode: '2' }, { tenantId: 'b', productId: 'p3', name: 'Coffee', barcode: 'SAME' }]
const selection = parseSelection({ products: products.map(({ tenantId, productId }) => ({ tenantId, productId })), storeId: null })
assert.throws(() => selectedStores({ ...selection, storeId: 'foreign' }, stores), /STORE_ACCESS_DENIED/)
assert.throws(() => selectedStores({ ...selection, storeId: 'one' }, stores), /PRODUCT_ACCESS_DENIED/)
const accumulator = createAccumulator(products, stores, range, now)
accumulator.sale({ tenantId: 'a', storeId: 'one', productId: 'p1', saleType: 'SALE', quantity: new Prisma.Decimal(2), lineAmount: new Prisma.Decimal(10) })
// Coupon affects order total, not persisted product lines: keep 10 + 20 = 30.
accumulator.customer({ tenantId: 'a', storeId: 'one', itemsJson: JSON.stringify([{ productId: 'p1', quantity: 1, price: 999, lineAmount: 10 }, { productId: 'p2', quantity: 2, price: 999, lineAmount: 20 }]) })
accumulator.sale({ tenantId: 'a', storeId: 'one', productId: null, saleType: 'REFUND', quantity: -1, lineAmount: -4, originalSaleRecord: { tenantId: 'a', productId: 'p1' } })
accumulator.sale({ tenantId: 'b', storeId: 'three', productId: 'p3', saleType: 'SALE', quantity: 1, lineAmount: 500 })
accumulator.sale({ tenantId: 'a', storeId: 'two', productId: 'p1', saleType: 'SALE', quantity: '0.50', lineAmount: '0.30' })
accumulator.customer({ tenantId: 'a', storeId: 'two', itemsJson: JSON.stringify([{ productId: 'p1', quantity: 3, lineAmount: 0.1 * 3 }]) })
accumulator.sale({ tenantId: 'a', storeId: 'one', productId: null, saleType: 'SALE', quantity: 1, lineAmount: 99 })
accumulator.sale({ tenantId: 'a', storeId: 'one', productId: null, saleType: 'REFUND', quantity: -1, lineAmount: -3 })
const report = accumulator.finish()
assert.equal(report.rows.length, 5, 'include zero-sales selected products per applicable store')
assert.deepEqual(report.totals, [
  { currencyCode: 'USD', quantity: '8.50', salesAmount: '40.60', refundAmount: '4.00' },
  { currencyCode: 'XAF', quantity: '1.00', salesAmount: '500.00', refundAmount: '0.00' },
])
assert.equal(report.unidentifiedSales, 1)
assert.equal(report.unidentifiedRefunds, 1)
assert.equal(report.rows.find((row) => row.storeId === 'two' && row.productId === 'p2')?.salesAmount, '0.00')
assert.throws(() => accumulator.sale({ tenantId: 'foreign', storeId: 'one', productId: 'p1', saleType: 'SALE', quantity: 1, lineAmount: 3 }), /SOURCE_SCOPE_MISMATCH/)
assert.throws(() => accumulator.customer({ tenantId: 'a', storeId: 'one', itemsJson: 'broken' }), /INCOMPLETE_SALES_DATA/)
assert.throws(() => accumulator.customer({ tenantId: 'a', storeId: 'one', itemsJson: JSON.stringify([{ productId: 'p1', quantity: 1, price: 10 }]) }), /INCOMPLETE_SALES_DATA/, 'do not reconstruct missing line amounts')
assert.throws(() => accumulator.sale({ tenantId: 'a', storeId: 'one', productId: 'p1', saleType: 'REFUND', quantity: -1, lineAmount: -1, originalSaleRecord: { tenantId: 'b', productId: 'p1' } }), /INCOMPLETE_REFUND_DATA/)
assert.equal(canReadReport(report, stores), true)
assert.equal(canReadReport(report, stores.slice(0, 2)), false, 'revocation blocks entire saved report')
const html = reportPrintHtml(report, 'zh')
assert.equal(html.includes('<script>bad()</script>'), false)
assert.ok(html.includes('&lt;script&gt;bad()&lt;/script&gt;'))
assert.ok(html.includes('商品销售额'))
assert.ok(html.includes('40.60'))
assert.ok(!Object.keys(report).includes('netRevenue'))
assert.equal(scheduledAuthorization(null, undefined), false)
assert.equal(scheduledAuthorization('Bearer undefined', undefined), false)
assert.equal(scheduledAuthorization('Bearer short', 'short'), false)
assert.equal(scheduledAuthorization('Bearer 0123456789abcdef', '0123456789abcdef'), true)
assert.equal(scheduledAuthorization('Bearer 0123456789abcdeg', '0123456789abcdef'), false)
const migration = fs.readFileSync('prisma/migrations/20260909150000_add_product_sales_reports/migration.sql', 'utf8')
assert.equal((migration.match(/CREATE TABLE/g) ?? []).length, 2)
assert.match(migration, /CREATE UNIQUE INDEX.*\("groupId", "reportDate"\)/)
assert.equal((migration.match(/ENABLE ROW LEVEL SECURITY/g) ?? []).length, 2)
assert.doesNotMatch(migration, /(?:ALTER|UPDATE|DELETE FROM|INSERT INTO) "(?:SaleRecord|CustomerOrder|Product|Store|Tenant|PaymentIntent)"/)

async function main() {
  const calls: string[] = []
  const groups = Array.from({ length: 53 }, (_, i) => ({ id: String(i).padStart(3, '0') }))
  const client = { productSalesGroup: { findMany: async (args: { where: { id?: { gt: string }; enabled: boolean } }) => {
    assert.equal(args.where.enabled, true)
    return groups.filter((group) => !args.where.id || group.id > args.where.id.gt).slice(0, 50)
  } } } as unknown as Parameters<typeof generateDailyReports>[1]
  const originalError = console.error
  console.error = () => {}
  try {
    const outcome = await generateDailyReports(now, client, async (id) => {
      calls.push(id)
      if (id === '002') throw new ReportError('INCOMPLETE_SALES_DATA', 422)
      return id === '001' ? 'existing' : 'created'
    })
    assert.deepEqual(outcome, { created: 51, existing: 1, skipped: 0, failed: 1 })
    assert.equal(new Set(calls).size, 53, 'failed group does not stop other groups or pagination')
  } finally { console.error = originalError }
  console.log('product sales dates, recorded money, isolation, rendering and scheduler tests passed')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
