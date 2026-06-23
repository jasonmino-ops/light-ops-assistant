const SHIFT_START_PREFIX = 'cashier:shiftStart:'

function shiftStartKey(storeCode: string) {
  return `${SHIFT_START_PREFIX}${storeCode}`
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

export function clearShiftStart(storeCode: string) {
  localStorage.removeItem(shiftStartKey(storeCode))
}
