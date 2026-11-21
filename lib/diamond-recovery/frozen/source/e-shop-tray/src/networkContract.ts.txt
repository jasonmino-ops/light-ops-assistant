/** Shared by the cloud producer and Tray. No Electron, network or database dependency. */
export const NETWORK_PROFILE = 'network-v2' as const
export const NETWORK_CLIENT_VERSION = 'network-0.1.1' as const
// Guarded receives deliberately use a new version: an older server must
// reject before claiming, not ignore a newly added optional header.
export const NETWORK_MODE_GUARD_CLIENT_VERSION = 'network-0.1.2' as const
export const NETWORK_SCHEMA = 2 as const
export const NETWORK_MAX_BYTES = 3 * 1024 * 1024
export type NetworkRole = 'FRONT' | 'KITCHEN'
export type NetworkMode = 'FRONT_ONLY' | 'SHARED_PRINTER'
export type NetworkSnapshot = {
  storeCode: string
  storeName: string
  orderNo: string
  createdAt: string
  cashierName: string
  paymentMethod: 'CASH' | 'KHQR'
  currencyCode: string
  totalAmount: number
  lang: 'zh' | 'en' | 'km'
  items: { name: string; spec: string | null; qty: number; price: number; lineAmount: number }[]
}
export type NetworkRequest = {
  profile: typeof NETWORK_PROFILE
  requestId: string
  role: NetworkRole
  mode: NetworkMode
  rendererVersion: 1
  order: NetworkSnapshot
}

export function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) {
    throw new Error('NETWORK_INVALID_OBJECT')
  }
  return value as Record<string, unknown>
}
export function parseNetworkMode(value: unknown): NetworkMode {
  if (value !== 'FRONT_ONLY' && value !== 'SHARED_PRINTER') throw new Error('NETWORK_INVALID_MODE')
  return value
}
function text(value: unknown, max: number, pattern?: RegExp): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) || (pattern && !pattern.test(value))) {
    throw new Error('NETWORK_INVALID_TEXT')
  }
  return value
}
function amount(value: unknown, positive = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e10
    || (positive && value === 0)) throw new Error('NETWORK_INVALID_AMOUNT')
  return value
}
export function parseNetworkRequest(value: unknown): NetworkRequest {
  if (JSON.stringify(value)?.length > 512 * 1024) throw new Error('NETWORK_PAYLOAD_TOO_LARGE')
  const request = exactObject(value, ['profile', 'requestId', 'role', 'mode', 'rendererVersion', 'order'])
  const mode = parseNetworkMode(request.mode)
  if (request.profile !== NETWORK_PROFILE || request.rendererVersion !== 1
    || (request.role !== 'FRONT' && request.role !== 'KITCHEN')) throw new Error('NETWORK_INVALID_PROFILE')
  if (mode === 'FRONT_ONLY' && request.role !== 'FRONT') throw new Error('NETWORK_MODE_ROLE_MISMATCH')
  const order = exactObject(request.order, [
    'storeCode', 'storeName', 'orderNo', 'createdAt', 'cashierName', 'paymentMethod',
    'currencyCode', 'totalAmount', 'lang', 'items',
  ])
  if (!['zh', 'en', 'km'].includes(String(order.lang))
    || !['CASH', 'KHQR'].includes(String(order.paymentMethod))) throw new Error('NETWORK_INVALID_ORDER')
  const createdAt = text(order.createdAt, 30)
  if (!Number.isFinite(Date.parse(createdAt)) || new Date(createdAt).toISOString() !== createdAt) {
    throw new Error('NETWORK_INVALID_DATE')
  }
  if (!Array.isArray(order.items) || !order.items.length || order.items.length > 500) {
    throw new Error('NETWORK_INVALID_ITEMS')
  }
  const items = order.items.map(value => {
    const item = exactObject(value, ['name', 'spec', 'qty', 'price', 'lineAmount'])
    return {
      name: text(item.name, 300), spec: item.spec === null ? null : text(item.spec, 500),
      qty: amount(item.qty, true), price: amount(item.price), lineAmount: amount(item.lineAmount),
    }
  })
  return {
    profile: NETWORK_PROFILE,
    requestId: text(request.requestId, 128, /^[A-Za-z0-9._:-]{8,128}$/),
    role: request.role,
    mode,
    rendererVersion: 1,
    order: {
      storeCode: text(order.storeCode, 80, /^[A-Za-z0-9_-]+$/),
      storeName: text(order.storeName, 300), orderNo: text(order.orderNo, 128, /^[A-Za-z0-9._:-]+$/),
      createdAt, cashierName: text(order.cashierName, 200),
      paymentMethod: order.paymentMethod as NetworkSnapshot['paymentMethod'],
      currencyCode: text(order.currencyCode, 3, /^[A-Z]{3}$/), totalAmount: amount(order.totalAmount),
      lang: order.lang as NetworkSnapshot['lang'], items,
    },
  }
}
