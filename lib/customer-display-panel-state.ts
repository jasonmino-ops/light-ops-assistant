export const CUSTOMER_DISPLAY_COMPLETION_LINGER_MS = 5_000
export const CUSTOMER_DISPLAY_DRAFT_TIMEOUT_MS = 5 * 60 * 1_000
export const CUSTOMER_DISPLAY_CHECKOUT_TIMEOUT_MS = 10 * 60 * 1_000

export type CustomerDisplayPanelSession = {
  status: string
  displayStatus?: string | null
  paymentMethod: 'CASH' | 'KHQR' | null
  items: readonly unknown[]
  itemCount: number
  totalAmount: number
  completedAt: string | null
  updatedAt: string
}

export type CustomerDisplayPanelState = 'IDLE' | 'ORDER' | 'CASH' | 'KHQR' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED'
export type CustomerDisplayOrderPanelView = 'EMPTY' | 'CART' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED'

function validTime(value: string | null | undefined) {
  const time = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(time) ? time : 0
}

export function sessionHasCustomerDisplayOrder(session: CustomerDisplayPanelSession | null) {
  return Boolean(session && (session.items.length > 0 || session.itemCount > 0 || session.totalAmount > 0))
}

export function customerDisplayPanelLingerUntil(session: CustomerDisplayPanelSession | null) {
  if (!session) return 0
  if (session.status === 'COMPLETED' || session.status === 'CANCELLED') {
    const completedAtMs = validTime(session.completedAt)
    return completedAtMs ? completedAtMs + CUSTOMER_DISPLAY_COMPLETION_LINGER_MS : 0
  }
  const updatedAtMs = validTime(session.updatedAt)
  if (session.displayStatus === 'EXPIRED_DRAFT') {
    return updatedAtMs ? updatedAtMs + CUSTOMER_DISPLAY_DRAFT_TIMEOUT_MS + CUSTOMER_DISPLAY_COMPLETION_LINGER_MS : 0
  }
  if (session.displayStatus === 'EXPIRED_CHECKOUT') {
    return updatedAtMs ? updatedAtMs + CUSTOMER_DISPLAY_CHECKOUT_TIMEOUT_MS + CUSTOMER_DISPLAY_COMPLETION_LINGER_MS : 0
  }
  return 0
}

export function deriveCustomerDisplayPanelState(session: CustomerDisplayPanelSession | null, nowMs = Date.now()): CustomerDisplayPanelState {
  const lingerUntil = customerDisplayPanelLingerUntil(session)
  if (session?.status === 'COMPLETED') return lingerUntil > nowMs ? 'COMPLETED' : 'IDLE'
  if (session?.status === 'CANCELLED') return lingerUntil > nowMs ? 'CANCELLED' : 'IDLE'
  if (session?.displayStatus === 'EXPIRED_DRAFT' || session?.displayStatus === 'EXPIRED_CHECKOUT') {
    return lingerUntil > nowMs ? 'EXPIRED' : 'IDLE'
  }
  if (!sessionHasCustomerDisplayOrder(session)) return 'IDLE'
  if (session?.paymentMethod === 'KHQR') return 'KHQR'
  if (session?.paymentMethod === 'CASH') return 'CASH'
  return 'ORDER'
}

export function deriveCustomerDisplayOrderPanelView(
  state: CustomerDisplayPanelState,
  session: CustomerDisplayPanelSession | null,
): CustomerDisplayOrderPanelView {
  if (state === 'COMPLETED') return session ? 'COMPLETED' : 'EMPTY'
  if (state === 'CANCELLED') return 'CANCELLED'
  if (state === 'EXPIRED') return 'EXPIRED'
  if ((state === 'ORDER' || state === 'CASH' || state === 'KHQR') && sessionHasCustomerDisplayOrder(session)) return 'CART'
  return 'EMPTY'
}

export function customerDisplayEntryPath(storeCode: string) {
  return `/m/${encodeURIComponent(storeCode)}`
}
