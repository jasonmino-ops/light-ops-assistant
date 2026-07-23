/** Fixed Desktop POS operations. This is intentionally not a URL/method proxy contract. */
export const DESKTOP_TRANSACTION_OPERATIONS = [
  'POS_SALE_CREATE',
  'POS_MEMBER_BALANCE_PAY',
  'POS_OFFLINE_SYNC',
  'POS_ORDER_UPDATE',
  'POS_ORDERS_READ',
  'POS_RECORDS_READ',
  'POS_RECEIPT_READ',
] as const

export type DesktopTransactionOperation = (typeof DESKTOP_TRANSACTION_OPERATIONS)[number]

export type DesktopTransactionRequest = {
  operation: DesktopTransactionOperation
  payload: unknown
}

export type DesktopTransactionResponse = {
  ok: boolean
  status: number
  body: unknown
  error?: string
}

export function isDesktopTransactionOperation(value: unknown): value is DesktopTransactionOperation {
  return typeof value === 'string' && (DESKTOP_TRANSACTION_OPERATIONS as readonly string[]).includes(value)
}
