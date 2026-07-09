const POS_DEVICE_TOKEN_PREFIX = 'cashier:posDeviceToken:'
const POS_DEVICE_ID_KEY = 'cashier:deviceId'

function randomId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `pos-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function getPosDeviceId(): string {
  try {
    const existing = localStorage.getItem(POS_DEVICE_ID_KEY)?.trim()
    if (existing) return existing
    const next = randomId()
    localStorage.setItem(POS_DEVICE_ID_KEY, next)
    return next
  } catch {
    return randomId()
  }
}

export function getPosDeviceToken(storeCode: string | null | undefined): string {
  if (!storeCode) return ''
  try {
    return localStorage.getItem(`${POS_DEVICE_TOKEN_PREFIX}${storeCode}`)?.trim() ?? ''
  } catch {
    return ''
  }
}

export function savePosDeviceToken(storeCode: string, token: string) {
  localStorage.setItem(`${POS_DEVICE_TOKEN_PREFIX}${storeCode}`, token)
}

export function clearPosDeviceToken(storeCode: string) {
  try {
    localStorage.removeItem(`${POS_DEVICE_TOKEN_PREFIX}${storeCode}`)
  } catch {}
}

export function posDeviceHeaders(storeCode: string | null | undefined): Record<string, string> {
  const deviceId = getPosDeviceId()
  const token = getPosDeviceToken(storeCode)
  return {
    'x-pos-device-id': deviceId,
    ...(token ? { 'x-pos-device-token': token } : {}),
  }
}

export function isPosUnauthorized(body: unknown, status?: number) {
  return status === 403 &&
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    body.error === 'POS_DEVICE_UNAUTHORIZED'
}
