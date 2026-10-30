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
    this.timeoutMs = options.timeoutMs ?? 5_000
    this.fetcher = options.fetcher ?? fetch
  }

  getSalesProfit(storeId: string, period: ProfitPeriod) {
    return this.request<SalesProfit>('GET_SALES_PROFIT', { storeId, period })
  }

  listInventory(storeId: string, input: InventoryListInput) {
    return this.request<InventoryItem[]>('LIST_INVENTORY', { storeId, ...input })
  }

  setMinimumStock(storeId: string, minimumStock: number) {
    return this.request<{ minimumStock: number }>('SET_MINIMUM_STOCK', { storeId, minimumStock })
  }

  recordReceiving(storeId: string, input: ReceivingInput) {
    return this.request<ReceivingResult>('RECEIVE', { storeId, ...input })
  }

  private async request<T>(action: string, payload: Record<string, unknown>): Promise<ExternalSnapshot<T>> {
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
      if (!body?.ok || typeof body.asOf !== 'string' || body.data === undefined) {
        throw new InventoryProfitExternalError('INVALID_RESPONSE')
      }
      return { asOf: body.asOf, data: body.data as T }
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
