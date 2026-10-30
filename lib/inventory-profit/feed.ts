export const INVENTORY_PROFIT_FEED_SCHEMA_VERSION = 1
export const INVENTORY_PROFIT_FEED_LIMIT = 5_000

export type InventoryProfitFeedDataset = 'products' | 'sales' | 'customer-orders' | 'refunds'

const DATASETS = new Set<InventoryProfitFeedDataset>([
  'products',
  'sales',
  'customer-orders',
  'refunds',
])

export function parseFeedDataset(value: string | null): InventoryProfitFeedDataset | null {
  return value && DATASETS.has(value as InventoryProfitFeedDataset)
    ? value as InventoryProfitFeedDataset
    : null
}

export function parseFeedLimit(value: string | null): number {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) return 500
  return Math.min(INVENTORY_PROFIT_FEED_LIMIT, Math.max(1, parsed))
}

export function parseFeedRange(from: string | null, to: string | null): {
  from: Date
  to: Date
} | null {
  if (!from || !to) return null
  const fromDate = new Date(`${from}T00:00:00.000Z`)
  const toDate = new Date(`${to}T23:59:59.999Z`)
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) {
    return null
  }
  const spanDays = Math.floor((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1
  return spanDays <= 35 ? { from: fromDate, to: toDate } : null
}

export function sanitizeCustomerOrderItems(itemsJson: string): Array<{
  productId: string | null
  sku: string | null
  barcode: string | null
  name: string
  quantity: number
  lineAmount: number
}> {
  try {
    const parsed = JSON.parse(itemsJson)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const row = item as Record<string, unknown>
      const quantity = Number(row.quantity)
      const lineAmount = Number(row.lineAmount)
      if (!Number.isFinite(quantity) || !Number.isFinite(lineAmount)) return []
      return [{
        productId: typeof row.productId === 'string' ? row.productId : null,
        sku: typeof row.sku === 'string' ? row.sku : null,
        barcode: typeof row.barcode === 'string' ? row.barcode : null,
        name: typeof row.name === 'string' ? row.name : '',
        quantity,
        lineAmount,
      }]
    })
  } catch {
    return []
  }
}

export function nextFeedCursor<T extends { id: string }>(items: T[], limit: number): string | null {
  return items.length === limit ? items[items.length - 1]?.id ?? null : null
}
