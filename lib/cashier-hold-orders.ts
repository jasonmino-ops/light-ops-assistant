export type HoldOrder<CartLine = unknown, DesktopCheckoutStep extends string = string> = {
  id: string
  storeCode: string
  createdAt: string
  cart: CartLine[]
  checkoutStep: DesktopCheckoutStep
}

const HOLD_ORDER_PREFIX = 'cashier:holdOrders:'

function storageKey(storeCode: string) {
  return `${HOLD_ORDER_PREFIX}${storeCode}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isHoldOrderRecord(value: unknown, storeCode: string): value is HoldOrder<unknown, string> {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.storeCode === storeCode &&
    typeof value.createdAt === 'string' &&
    Array.isArray(value.cart) &&
    typeof value.checkoutStep === 'string'
  )
}

function createHoldOrderId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `hold-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function listHoldOrders<CartLine, DesktopCheckoutStep extends string>(
  storeCode: string,
): HoldOrder<CartLine, DesktopCheckoutStep>[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey(storeCode)) || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item) => isHoldOrderRecord(item, storeCode))
      .map((item) => item as HoldOrder<CartLine, DesktopCheckoutStep>)
  } catch {
    return []
  }
}

export function saveHoldOrder<CartLine, DesktopCheckoutStep extends string>(input: {
  storeCode: string
  cart: CartLine[]
  checkoutStep: DesktopCheckoutStep
}) {
  const order: HoldOrder<CartLine, DesktopCheckoutStep> = {
    id: createHoldOrderId(),
    storeCode: input.storeCode,
    createdAt: new Date().toISOString(),
    cart: input.cart,
    checkoutStep: input.checkoutStep,
  }
  const nextOrders = [order, ...listHoldOrders<CartLine, DesktopCheckoutStep>(input.storeCode)]
  localStorage.setItem(storageKey(input.storeCode), JSON.stringify(nextOrders))
  return nextOrders
}

export function removeHoldOrder<CartLine, DesktopCheckoutStep extends string>(storeCode: string, id: string) {
  const nextOrders = listHoldOrders<CartLine, DesktopCheckoutStep>(storeCode).filter(order => order.id !== id)
  localStorage.setItem(storageKey(storeCode), JSON.stringify(nextOrders))
  return nextOrders
}
