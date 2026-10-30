export type ProfitPeriod = 'TODAY' | 'WEEK' | 'MONTH'

export type ExternalSnapshot<T> = {
  asOf: string
  data: T
}

export type SalesProfit = {
  period: ProfitPeriod
  netSales: number
  costOfGoodsSold: number | null
  grossProfit: number | null
  grossMarginRate: number | null
  costCoverageRate: number
  costMethod: 'DAILY_PERIODIC_WAC'
}

export type InventoryAlert = 'NEGATIVE' | 'OUT_OF_STOCK' | 'LOW_STOCK'

export type InventoryItem = {
  productId: string
  sku: string | null
  barcode: string
  name: string
  currentStock: number
  minimumStock: number
  averageCost: number | null
  inventoryValue: number | null
  updatedAt: string
}

export type InventoryListInput = {
  query?: string
  alertsOnly?: boolean
}

export type ReceivingInput = {
  requestKey: string
  productId: string
  quantity: number
  unitCost: number
  date: string
}

export type ReceivingResult = {
  requestKey: string
  duplicate: boolean
  recordedAt: string
}

export function inventoryAlert(item: Pick<InventoryItem, 'currentStock' | 'minimumStock'>): InventoryAlert | null {
  if (item.currentStock < 0) return 'NEGATIVE'
  if (item.currentStock === 0) return 'OUT_OF_STOCK'
  if (item.currentStock <= item.minimumStock) return 'LOW_STOCK'
  return null
}

export function matchesInventorySearch(item: Pick<InventoryItem, 'name' | 'barcode' | 'sku'>, query: string) {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return true
  return [item.name, item.barcode, item.sku ?? '']
    .some((value) => value.toLocaleLowerCase().includes(normalized))
}

export function normalizeProfit(profit: SalesProfit): SalesProfit {
  const coverage = Math.min(1, Math.max(0, profit.costCoverageRate))
  if (coverage < 1) {
    return {
      ...profit,
      costCoverageRate: coverage,
      costOfGoodsSold: null,
      grossProfit: null,
      grossMarginRate: null,
      costMethod: 'DAILY_PERIODIC_WAC',
    }
  }
  return { ...profit, costCoverageRate: coverage, costMethod: 'DAILY_PERIODIC_WAC' }
}

export function isSnapshotStale(asOf: string, now = Date.now(), maxAgeMinutes = 120) {
  const value = Date.parse(asOf)
  return !Number.isFinite(value) || value > now + 60_000 || now - value > maxAgeMinutes * 60_000
}
