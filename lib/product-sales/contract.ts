// Feature-specific Cambodia reporting contract. Does not change other reports.
export const REPORT_TIMEZONE = 'Asia/Phnom_Penh'
export const MAX_PRODUCTS = 100
export const MAX_DAYS = 366
export type Period = 'TODAY' | 'YESTERDAY' | 'WEEK' | 'MONTH' | 'CUSTOM'
export type ProductRef = { tenantId: string; productId: string }
export type Selection = { products: ProductRef[]; storeId: string | null }
export type QueryInput = Selection & { period: Period; dateFrom?: string; dateTo?: string }
export type Window = { from: string; to: string }
export type ReportRange = {
  period: Period; dateFrom: string; dateTo: string; windows: Window[]
  continuous: boolean; timezone: typeof REPORT_TIMEZONE
}
export type ReportStore = { tenantId: string; storeId: string; storeName: string; currencyCode: string }
export type ReportRow = ProductRef & {
  storeId: string; name: string; barcode: string; quantity: string; salesAmount: string; refundAmount: string
}
export type ProductSalesResult = {
  range: ReportRange; generatedAt: string; groupName?: string
  stores: ReportStore[]; rows: ReportRow[]
  totals: Array<{ currencyCode: string; quantity: string; salesAmount: string; refundAmount: string }>
  unidentifiedSales: number; unidentifiedRefunds: number
}
export type GroupView = {
  id: string; name: string; selection: Selection; enabled: boolean; createdAt: string; updatedAt: string
}
export class ReportError extends Error {
  constructor(public code: string, public status = 400) { super(code) }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ReportError('INVALID_INPUT')
  return value as Record<string, unknown>
}
export function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new ReportError('INVALID_ID')
  return value
}
export function parseSelection(value: unknown): Selection {
  const body = object(value)
  if (!Array.isArray(body.products) || body.products.length < 1 || body.products.length > MAX_PRODUCTS) {
    throw new ReportError('SELECT_1_TO_100_PRODUCTS')
  }
  const products = body.products.map((item) => {
    const ref = object(item)
    return { tenantId: identifier(ref.tenantId), productId: identifier(ref.productId) }
  }).sort((a, b) => productKey(a).localeCompare(productKey(b)))
  if (new Set(products.map(productKey)).size !== products.length) throw new ReportError('DUPLICATE_PRODUCT')
  return { products, storeId: body.storeId == null ? null : identifier(body.storeId) }
}
export function productKey(ref: ProductRef) { return `${ref.tenantId}:${ref.productId}` }
