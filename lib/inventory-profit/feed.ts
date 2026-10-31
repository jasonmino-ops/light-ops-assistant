export const INVENTORY_PROFIT_FEED_SCHEMA_VERSION = 1
export const INVENTORY_PROFIT_FEED_LIMIT = 5_000
const FEED_DAY_MS = 86_400_000

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
  if (!validFeedDate(from) || !validFeedDate(to) || from > to) return null
  const fromDay = Date.parse(`${from}T00:00:00.000Z`)
  const toDay = Date.parse(`${to}T00:00:00.000Z`)
  const spanDays = Math.floor((toDay - fromDay) / FEED_DAY_MS) + 1
  if (spanDays > 35) return null

  // The Pilot reporting calendar is fixed to Asia/Phnom_Penh (+07:00).
  const fromDate = new Date(`${from}T00:00:00.000+07:00`)
  const toDate = new Date(Date.parse(`${to}T00:00:00.000+07:00`) + FEED_DAY_MS - 1)
  if (!Number.isFinite(fromDate.getTime()) || !Number.isFinite(toDate.getTime())) {
    return null
  }
  return { from: fromDate, to: toDate }
}

function validFeedDate(value: string | null): value is string {
  if (!value || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
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
