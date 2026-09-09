import { Prisma } from '@prisma/client'
import { ReportError, productKey, type ProductRef, type ProductSalesResult, type ReportRange, type ReportStore } from './contract'

export type SelectedProduct = ProductRef & { name: string; barcode: string }
export type SaleLine = {
  tenantId: string; storeId: string; productId: string | null; saleType: string
  quantity: unknown; lineAmount: unknown
  originalSaleRecord?: { tenantId: string; productId: string | null } | null
}
function decimal(value: unknown) {
  if (typeof value !== 'number' && typeof value !== 'string' && !(value instanceof Prisma.Decimal)) throw new ReportError('INCOMPLETE_SALES_DATA', 422)
  try {
    const result = new Prisma.Decimal(value)
    if (!result.isFinite() || result.abs().greaterThan('99999999999999')) throw new Error('invalid')
    // Amounts in the existing database have two decimal places. CustomerOrder
    // JSON can retain JS multiplication noise (e.g. 0.30000000000000004).
    return result.toDecimalPlaces(2)
  } catch { throw new ReportError('INCOMPLETE_SALES_DATA', 422) }
}

export function createAccumulator(products: SelectedProduct[], stores: ReportStore[], range: ReportRange, now: Date) {
  const zero = () => new Prisma.Decimal(0)
  const rows = new Map<string, { product: SelectedProduct; store: ReportStore; quantity: Prisma.Decimal; salesAmount: Prisma.Decimal; refundAmount: Prisma.Decimal }>()
  for (const store of stores) for (const product of products) {
    if (product.tenantId !== store.tenantId) continue
    rows.set(`${store.storeId}:${productKey(product)}`, { product, store, quantity: zero(), salesAmount: zero(), refundAmount: zero() })
  }
  let unidentifiedSales = 0
  let unidentifiedRefunds = 0
  function authorized(tenantId: string, storeId: string) {
    if (!stores.some((store) => store.tenantId === tenantId && store.storeId === storeId)) throw new ReportError('SOURCE_SCOPE_MISMATCH', 403)
  }
  function sale(line: SaleLine) {
    authorized(line.tenantId, line.storeId)
    if (line.saleType !== 'SALE' && line.saleType !== 'REFUND') throw new ReportError('INCOMPLETE_SALES_DATA', 422)
    let productId = line.productId
    if (line.saleType === 'REFUND' && line.originalSaleRecord?.productId) {
      const original = line.originalSaleRecord
      if (original.tenantId !== line.tenantId || (productId && productId !== original.productId)) {
        throw new ReportError('INCOMPLETE_REFUND_DATA', 422)
      }
      productId = original.productId
    }
    if (!productId) {
      if (line.saleType === 'SALE') unidentifiedSales++
      else unidentifiedRefunds++
      return
    }
    const row = rows.get(`${line.storeId}:${productKey({ tenantId: line.tenantId, productId })}`)
    if (!row) return // A valid, identifiable unselected product.
    const qty = decimal(line.quantity)
    const amount = decimal(line.lineAmount)
    if (line.saleType === 'SALE') {
      if (!qty.greaterThan(0) || amount.lessThan(0)) throw new ReportError('INCOMPLETE_SALES_DATA', 422)
      row.quantity = row.quantity.plus(qty)
      row.salesAmount = row.salesAmount.plus(amount)
    } else {
      if (!qty.lessThan(0) || amount.greaterThan(0)) throw new ReportError('INCOMPLETE_REFUND_DATA', 422)
      row.refundAmount = row.refundAmount.plus(amount.abs())
    }
  }
  function customer(order: { tenantId: string; storeId: string; itemsJson: string }) {
    authorized(order.tenantId, order.storeId)
    let items: unknown
    try { items = JSON.parse(order.itemsJson) } catch { throw new ReportError('INCOMPLETE_SALES_DATA', 422) }
    if (!Array.isArray(items) || items.length === 0) throw new ReportError('INCOMPLETE_SALES_DATA', 422)
    for (const item of items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ReportError('INCOMPLETE_SALES_DATA', 422)
      const line = item as Record<string, unknown>
      sale({ tenantId: order.tenantId, storeId: order.storeId, productId: typeof line.productId === 'string' && line.productId ? line.productId : null, saleType: 'SALE', quantity: line.quantity, lineAmount: line.lineAmount })
    }
  }
  function finish(): ProductSalesResult {
    const totals = new Map<string, { quantity: Prisma.Decimal; salesAmount: Prisma.Decimal; refundAmount: Prisma.Decimal }>()
    for (const row of rows.values()) {
      const total = totals.get(row.store.currencyCode) ?? { quantity: zero(), salesAmount: zero(), refundAmount: zero() }
      total.quantity = total.quantity.plus(row.quantity)
      total.salesAmount = total.salesAmount.plus(row.salesAmount)
      total.refundAmount = total.refundAmount.plus(row.refundAmount)
      totals.set(row.store.currencyCode, total)
    }
    return {
      range, generatedAt: now.toISOString(), stores, unidentifiedSales, unidentifiedRefunds,
      rows: [...rows.values()].map((row) => ({ ...row.product, storeId: row.store.storeId, quantity: row.quantity.toFixed(2), salesAmount: row.salesAmount.toFixed(2), refundAmount: row.refundAmount.toFixed(2) })),
      totals: [...totals].map(([currencyCode, value]) => ({ currencyCode, quantity: value.quantity.toFixed(2), salesAmount: value.salesAmount.toFixed(2), refundAmount: value.refundAmount.toFixed(2) })),
    }
  }
  return { sale, customer, finish }
}
