'use client'

export const CUSTOMER_DISPLAY_REALTIME_CHANNEL = 'light-ops:customer-display:realtime:v1'
export const CUSTOMER_DISPLAY_REALTIME_PROTECT_MS = 5000

export type CustomerDisplayRealtimeItem = {
  productId: string
  name: string
  spec: string | null
  imageUrl?: string | null
  price: number
  qty: number
  lineAmount: number
}

export type CustomerDisplayRealtimeStatus = 'DRAFT' | 'AWAITING_PAYMENT' | 'COMPLETED' | 'CANCELLED'
export type CustomerDisplayRealtimePaymentMethod = 'CASH' | 'KHQR' | null
export type CustomerDisplayRealtimePaymentStatus = 'PENDING' | 'PAID' | null

export type CustomerDisplayRealtimeMessage = {
  type: 'CART_SNAPSHOT' | 'CLEAR'
  storeCode: string
  sentAt: string
  sequence: number
  items: CustomerDisplayRealtimeItem[]
  totalAmount: number
  itemCount: number
  currencyCode: string
  status: CustomerDisplayRealtimeStatus
  paymentMethod: CustomerDisplayRealtimePaymentMethod
  paymentStatus: CustomerDisplayRealtimePaymentStatus
}

export type CustomerDisplayRealtimeGuard = {
  storeCode: string
  sequence: number
  sentAtMs: number
  receivedAtMs: number
  type: CustomerDisplayRealtimeMessage['type']
}

export type CustomerDisplayRealtimeSessionLike = {
  status: string
  items: unknown[]
  totalAmount: number
  itemCount: number
  updatedAt: string
}

export function createCustomerDisplayRealtimeChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null
  try {
    return new BroadcastChannel(CUSTOMER_DISPLAY_REALTIME_CHANNEL)
  } catch (error) {
    console.warn('[customer-display-realtime] channel unavailable', error)
    return null
  }
}

export function isCustomerDisplayRealtimeMessage(value: unknown): value is CustomerDisplayRealtimeMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Partial<CustomerDisplayRealtimeMessage>
  return (message.type === 'CART_SNAPSHOT' || message.type === 'CLEAR')
    && typeof message.storeCode === 'string'
    && typeof message.sentAt === 'string'
    && typeof message.sequence === 'number'
    && Array.isArray(message.items)
    && typeof message.totalAmount === 'number'
    && typeof message.itemCount === 'number'
    && typeof message.currencyCode === 'string'
}

export function shouldApplyCustomerDisplayRealtimeMessage(
  current: CustomerDisplayRealtimeGuard | null,
  message: CustomerDisplayRealtimeMessage,
  storeCode: string,
) {
  if (message.storeCode !== storeCode) return false
  const sentAtMs = Date.parse(message.sentAt)
  if (!Number.isFinite(sentAtMs)) return false
  if (!current) return true
  if (message.sequence < current.sequence) return false
  if (message.sequence === current.sequence && sentAtMs <= current.sentAtMs) return false
  return true
}

export function buildCustomerDisplayRealtimeGuard(
  message: CustomerDisplayRealtimeMessage,
  receivedAtMs = Date.now(),
): CustomerDisplayRealtimeGuard {
  return {
    storeCode: message.storeCode,
    sequence: message.sequence,
    sentAtMs: Date.parse(message.sentAt) || receivedAtMs,
    receivedAtMs,
    type: message.type,
  }
}

export function sessionHasRealtimeOrderContent(session: CustomerDisplayRealtimeSessionLike | null): boolean {
  return Boolean(session && (session.items.length > 0 || session.itemCount > 0 || session.totalAmount > 0))
}

export function shouldIgnoreServerSessionAfterRealtime(
  current: CustomerDisplayRealtimeSessionLike | null,
  next: CustomerDisplayRealtimeSessionLike | null,
  guard: CustomerDisplayRealtimeGuard | null,
  nowMs = Date.now(),
) {
  if (!guard || nowMs - guard.receivedAtMs > CUSTOMER_DISPLAY_REALTIME_PROTECT_MS) return false
  const nextUpdatedAtMs = next?.updatedAt ? Date.parse(next.updatedAt) : 0
  if (nextUpdatedAtMs > guard.sentAtMs) return false

  if (guard.type === 'CLEAR') {
    return Boolean(next && next.status !== 'COMPLETED' && next.status !== 'CANCELLED')
  }

  if (!sessionHasRealtimeOrderContent(current)) return false
  if (!next) return true
  if (next.status === 'COMPLETED' || next.status === 'CANCELLED') return false
  if (next.status === 'DRAFT') return true
  if (!sessionHasRealtimeOrderContent(next)) return true
  return Number(next.totalAmount).toFixed(2) !== Number(current?.totalAmount ?? 0).toFixed(2)
}

export function publishCustomerDisplayRealtimeMessage(
  channel: BroadcastChannel | null,
  message: CustomerDisplayRealtimeMessage,
) {
  if (!channel) return false
  try {
    channel.postMessage(message)
    return true
  } catch (error) {
    console.warn('[customer-display-realtime] publish failed', error)
    return false
  }
}
