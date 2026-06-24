const SHIFT_START_PREFIX = 'cashier:shiftStart:'
const SHIFT_OPERATOR_PREFIX = 'cashier:shiftOperator:'

function shiftStartKey(storeCode: string) {
  return `${SHIFT_START_PREFIX}${storeCode}`
}

function shiftOperatorKey(storeCode: string) {
  return `${SHIFT_OPERATOR_PREFIX}${storeCode}`
}

function isValidIsoTimestamp(value: string | null) {
  if (!value) return false
  const time = new Date(value).getTime()
  return Number.isFinite(time)
}

export function getOrCreateShiftStart(storeCode: string) {
  const key = shiftStartKey(storeCode)
  const existing = localStorage.getItem(key)
  if (isValidIsoTimestamp(existing)) return existing as string

  const next = new Date().toISOString()
  localStorage.setItem(key, next)
  return next
}

export function getOrCreateShiftOperator(storeCode: string, operatorHint: string) {
  const key = shiftOperatorKey(storeCode)
  const existing = localStorage.getItem(key)?.trim()
  if (existing) return existing

  const next = operatorHint.trim() || 'Desktop POS'
  localStorage.setItem(key, next)
  return next
}

export function clearShiftStart(storeCode: string) {
  localStorage.removeItem(shiftStartKey(storeCode))
}

export function clearShiftOperator(storeCode: string) {
  localStorage.removeItem(shiftOperatorKey(storeCode))
}
