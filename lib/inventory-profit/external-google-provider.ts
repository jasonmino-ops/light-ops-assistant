import type {
  ExternalSnapshot,
  InventoryItem,
  InventoryListInput,
  ProfitPeriod,
  ReceivingInput,
  ReceivingResult,
  SalesProfit,
} from './contract'
import type { InventoryProfitProvider } from './provider'

type FetchLike = typeof fetch

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function nullableFinite(value: unknown): value is number | null {
  return value === null || finite(value)
}

function salesProfit(value: unknown): SalesProfit | null {
  const item = record(value)
  if (
    !item ||
    !['TODAY', 'WEEK', 'MONTH'].includes(String(item.period)) ||
    !finite(item.netSales) ||
    !nullableFinite(item.costOfGoodsSold) ||
    !nullableFinite(item.grossProfit) ||
    !nullableFinite(item.grossMarginRate) ||
    !finite(item.costCoverageRate) ||
    item.costCoverageRate < 0 ||
    item.costCoverageRate > 1 ||
    item.costMethod !== 'DAILY_PERIODIC_WAC'
  ) return null
  return item as SalesProfit
}

function inventoryItems(value: unknown): InventoryItem[] | null {
  if (!Array.isArray(value) || value.length > 5_000) return null
  for (const valueItem of value) {
    const item = record(valueItem)
    if (
      !item ||
      typeof item.productId !== 'string' || !item.productId ||
      !(item.sku === null || typeof item.sku === 'string') ||
      typeof item.barcode !== 'string' ||
      typeof item.name !== 'string' ||
      !finite(item.currentStock) ||
      !finite(item.minimumStock) ||
      item.minimumStock < 0 ||
      !nullableFinite(item.averageCost) ||
      !nullableFinite(item.inventoryValue) ||
      typeof item.updatedAt !== 'string'
    ) return null
  }
  return value as InventoryItem[]
}

function minimumStockResult(value: unknown): { minimumStock: number } | null {
  const item = record(value)
  return item && Number.isInteger(item.minimumStock) && Number(item.minimumStock) >= 0
    ? { minimumStock: Number(item.minimumStock) }
    : null
}

function receivingResult(value: unknown): ReceivingResult | null {
  const item = record(value)
  if (
    !item ||
    typeof item.requestKey !== 'string' ||
    typeof item.duplicate !== 'boolean' ||
    typeof item.recordedAt !== 'string'
  ) return null
  return item as ReceivingResult
}

export class InventoryProfitExternalError extends Error {
  constructor(public readonly code: 'NOT_CONFIGURED' | 'TIMEOUT' | 'UNAVAILABLE' | 'INVALID_RESPONSE') {
    super(code)
  }
}

type ExternalGoogleProviderOptions = {
  endpoint: string
  secret: string
  timeoutMs?: number
  fetcher?: FetchLike
}

export class ExternalGoogleProvider implements InventoryProfitProvider {
  private readonly timeoutMs: number
  private readonly fetcher: FetchLike

  constructor(private readonly options: ExternalGoogleProviderOptions) {
    this.timeoutMs = options.timeoutMs ?? 8_000
    this.fetcher = options.fetcher ?? fetch
  }

  getSalesProfit(storeId: string, period: ProfitPeriod) {
    return this.request('GET_SALES_PROFIT', { storeId, period }, (value) => {
      const result = salesProfit(value)
      return result?.period === period ? result : null
    })
  }

  listInventory(storeId: string, input: InventoryListInput) {
    return this.request('LIST_INVENTORY', { storeId, ...input }, inventoryItems)
  }

  setMinimumStock(storeId: string, minimumStock: number) {
    return this.request('SET_MINIMUM_STOCK', { storeId, minimumStock }, (value) => {
      const result = minimumStockResult(value)
      return result?.minimumStock === minimumStock ? result : null
    })
  }

  recordReceiving(storeId: string, input: ReceivingInput) {
    return this.request('RECEIVE', { storeId, ...input }, (value) => {
      const result = receivingResult(value)
      return result?.requestKey === input.requestKey ? result : null
    })
  }

  private async request<T>(
    action: string,
    payload: Record<string, unknown>,
    validate: (value: unknown) => T | null,
  ): Promise<ExternalSnapshot<T>> {
    if (!this.options.endpoint || !this.options.secret) {
      throw new InventoryProfitExternalError('NOT_CONFIGURED')
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetcher(this.options.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, secret: this.options.secret, ...payload }),
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!response.ok) throw new InventoryProfitExternalError('UNAVAILABLE')
      const body = await response.json().catch(() => null) as {
        ok?: boolean
        asOf?: unknown
        data?: unknown
      } | null
      const data = body?.ok && typeof body.asOf === 'string' ? validate(body.data) : null
      if (!body?.ok || typeof body.asOf !== 'string' || data === null) {
        throw new InventoryProfitExternalError('INVALID_RESPONSE')
      }
      return { asOf: body.asOf, data }
    } catch (error) {
      if (error instanceof InventoryProfitExternalError) throw error
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw new InventoryProfitExternalError('TIMEOUT')
      }
      throw new InventoryProfitExternalError('UNAVAILABLE')
    } finally {
      clearTimeout(timer)
    }
  }
}
