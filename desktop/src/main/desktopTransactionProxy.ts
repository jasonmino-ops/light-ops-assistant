import type { CredentialStore } from './activation/credentialStore'
import type {
  DesktopTransactionOperation,
  DesktopTransactionRequest,
  DesktopTransactionResponse,
} from '../shared/transactionBridge'

const MAX_REQUEST_BYTES = 256 * 1024
const MAX_RESPONSE_BYTES = 512 * 1024
const REQUEST_TIMEOUT_MS = 15_000

type SanitizedRequest = { path: string; method: 'GET' | 'POST' | 'PATCH'; body?: unknown }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function string(value: unknown, max = 160): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized && normalized.length <= max ? normalized : null
}

function storeCode(value: unknown): string | null {
  const code = string(value, 80)
  return code && /^[A-Za-z0-9_-]+$/.test(code) ? code : null
}

function itemList(value: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) return null
  const items: Array<Record<string, unknown>> = []
  for (const candidate of value) {
    if (!isRecord(candidate)) return null
    const barcode = string(candidate.barcode, 160)
    const quantity = typeof candidate.quantity === 'number' ? candidate.quantity : Number(candidate.quantity)
    if (!barcode || !Number.isFinite(quantity) || quantity <= 0 || quantity > 10_000) return null
    items.push({
      barcode,
      quantity,
      ...(typeof candidate.sugar === 'string' && candidate.sugar.length <= 80 ? { sugar: candidate.sugar } : {}),
    })
  }
  return items
}

function queryString(value: unknown, allowed: readonly string[]) {
  if (!isRecord(value)) return null
  const query = new URLSearchParams()
  for (const key of allowed) {
    const raw = value[key]
    if (raw === undefined || raw === null) continue
    const normalized = string(raw, 80)
    if (!normalized) return null
    query.set(key, normalized)
  }
  return query.toString()
}

function sanitize(operation: DesktopTransactionOperation, payload: unknown): SanitizedRequest | null {
  if (!isRecord(payload)) return null
  const code = storeCode(payload.storeCode)
  switch (operation) {
    case 'POS_SALE_CREATE': {
      const items = itemList(payload.items)
      const paymentMethod = payload.paymentMethod === 'CASH' || payload.paymentMethod === 'KHQR' ? payload.paymentMethod : null
      if (!code || !items || !paymentMethod) return null
      return {
        path: '/api/cashier/sales', method: 'POST', body: {
          storeCode: code, items, paymentMethod,
          ...(payload.manualPaymentConfirmed === true ? { manualPaymentConfirmed: true } : {}),
        },
      }
    }
    case 'POS_MEMBER_BALANCE_PAY': {
      const items = itemList(payload.items)
      const memberId = string(payload.memberId, 120)
      if (!code || !items || !memberId) return null
      return { path: '/api/cashier/member-balance-pay', method: 'POST', body: { storeCode: code, memberId, items } }
    }
    case 'POS_OFFLINE_SYNC': {
      const storeId = string(payload.storeId, 120)
      const deviceId = string(payload.deviceId, 160)
      const orders = Array.isArray(payload.orders) && payload.orders.length > 0 && payload.orders.length <= 20 ? payload.orders : null
      if (!code || !storeId || !deviceId || !orders) return null
      return { path: '/api/cashier/offline-sync', method: 'POST', body: { storeCode: code, storeId, deviceId, orders } }
    }
    case 'POS_ORDER_UPDATE': {
      const id = string(payload.id, 120)
      const status = payload.status === 'CONFIRMED' || payload.status === 'COMPLETED' || payload.status === 'CANCELLED' ? payload.status : null
      if (!code || !id || !status) return null
      return { path: `/api/cashier/orders/${encodeURIComponent(id)}?storeCode=${encodeURIComponent(code)}`, method: 'PATCH', body: { status } }
    }
    case 'POS_ORDERS_READ': {
      if (!code) return null
      return { path: `/api/cashier/orders?storeCode=${encodeURIComponent(code)}`, method: 'GET' }
    }
    case 'POS_RECORDS_READ': {
      const query = queryString(payload, ['storeCode', 'from', 'saleType', 'dateFrom', 'dateTo', 'pageSize', 'page'])
      if (!query || !code || !query.includes(`storeCode=${encodeURIComponent(code)}`)) return null
      return { path: `/api/records?${query}`, method: 'GET' }
    }
    case 'POS_RECEIPT_READ': {
      const id = string(payload.id, 120)
      if (!code || !id) return null
      return { path: `/api/cashier/sale-records/${encodeURIComponent(id)}/receipt?storeCode=${encodeURIComponent(code)}`, method: 'GET' }
    }
  }
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.length > MAX_RESPONSE_BYTES) return { error: 'DESKTOP_PROXY_RESPONSE_TOO_LARGE' }
  if (!text) return null
  try { return JSON.parse(text) } catch { return { error: 'DESKTOP_PROXY_MALFORMED_RESPONSE' } }
}

export class DesktopTransactionProxy {
  constructor(
    private readonly options: {
      credentialStore: CredentialStore
      baseUrl: string
      fetchImpl?: typeof fetch
      onDesktopAuthorizationFailure?: (errorCode: string) => void
    },
  ) {}

  async request(input: DesktopTransactionRequest): Promise<DesktopTransactionResponse> {
    const serialized = JSON.stringify(input)
    if (serialized.length > MAX_REQUEST_BYTES) {
      return { ok: false, status: 400, body: { error: 'DESKTOP_PROXY_REQUEST_TOO_LARGE' }, error: 'DESKTOP_PROXY_REQUEST_TOO_LARGE' }
    }
    const route = sanitize(input.operation, input.payload)
    if (!route) {
      return { ok: false, status: 400, body: { error: 'DESKTOP_PROXY_OPERATION_REJECTED' }, error: 'DESKTOP_PROXY_OPERATION_REJECTED' }
    }
    const credential = await this.options.credentialStore.readCredential()
    if (!credential.ok) {
      this.options.onDesktopAuthorizationFailure?.('DESKTOP_DEVICE_UNAUTHORIZED')
      return { ok: false, status: 401, body: { error: 'DESKTOP_DEVICE_UNAUTHORIZED' }, error: 'DESKTOP_DEVICE_UNAUTHORIZED' }
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await (this.options.fetchImpl ?? fetch)(`${this.options.baseUrl.replace(/\/+$/, '')}${route.path}`, {
        method: route.method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${credential.credential.deviceToken}`,
          ...(route.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: route.body === undefined ? undefined : JSON.stringify(route.body),
        signal: controller.signal,
      })
      const body = await parseResponse(response)
      const error = isRecord(body) && typeof body.error === 'string' ? body.error : 'DESKTOP_PROXY_HTTP_ERROR'
      if (!response.ok && /^(DESKTOP_|SUBSCRIPTION_BLOCKED|TENANT_INACTIVE|STORE_INACTIVE|DEVICE_STORE_MISMATCH)/.test(error)) {
        this.options.onDesktopAuthorizationFailure?.(error)
      }
      return { ok: response.ok, status: response.status, body, ...(response.ok ? {} : { error }) }
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === 'AbortError'
      return {
        ok: false,
        status: 0,
        body: { error: isTimeout ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR' },
        error: isTimeout ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR',
      }
    } finally {
      clearTimeout(timer)
    }
  }
}
