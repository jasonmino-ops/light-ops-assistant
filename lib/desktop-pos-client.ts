const POS_DEVICE_TOKEN_PREFIX = 'cashier:posDeviceToken:'
const POS_DEVICE_ID_KEY = 'cashier:deviceId'
const COMPUTER_LAUNCH_STORE_KEY = 'cashier:computerLaunchStoreCode'
const DESKTOP_OPERATOR_SELECTION_PREFIX = 'cashier:desktopOperatorSelection:'

export type DesktopOperatorSelection = 'ACCOUNT' | 'DEVICE'

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

export function getDesktopOperatorSelection(storeCode: string | null | undefined): DesktopOperatorSelection | null {
  if (!storeCode) return null
  try {
    const value = sessionStorage.getItem(`${DESKTOP_OPERATOR_SELECTION_PREFIX}${storeCode}`)
    return value === 'ACCOUNT' || value === 'DEVICE' ? value : null
  } catch {
    return null
  }
}

export function saveDesktopOperatorSelection(
  storeCode: string,
  selection: DesktopOperatorSelection,
) {
  try {
    sessionStorage.setItem(`${DESKTOP_OPERATOR_SELECTION_PREFIX}${storeCode}`, selection)
  } catch {}
}

/** Launch Ticket 兑换页与最终 /cashier 之间的一次性同标签页接力。 */
export function setComputerLaunchStoreCode(storeCode: string) {
  sessionStorage.setItem(COMPUTER_LAUNCH_STORE_KEY, storeCode)
}

export function takeComputerLaunchStoreCode(): string {
  try {
    const storeCode = sessionStorage.getItem(COMPUTER_LAUNCH_STORE_KEY)?.trim() ?? ''
    sessionStorage.removeItem(COMPUTER_LAUNCH_STORE_KEY)
    return storeCode
  } catch {
    return ''
  }
}

export function posDeviceHeaders(storeCode: string | null | undefined): Record<string, string> {
  const deviceId = getPosDeviceId()
  const token = getPosDeviceToken(storeCode)
  const desktopContext = isDesktopPosRequestContext()
  const operatorSelection = desktopContext ? getDesktopOperatorSelection(storeCode) : null
  return {
    'x-pos-device-id': deviceId,
    ...(desktopContext ? {
      'x-lightops-client': 'desktop-pos',
      // The server treats DEVICE as the safe Desktop default. ACCOUNT is
      // emitted only after the explicit startup boundary choice.
      'x-pos-operator-source': operatorSelection ?? 'DEVICE',
    } : {}),
    ...(token ? { 'x-pos-device-token': token } : {}),
  }
}

function isDesktopPosRequestContext() {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  return window.location.pathname === '/desktop/pos' ||
    params.get('from') === 'desktop' ||
    params.get('mode') === 'pos'
}

export function isPosUnauthorized(body: unknown, status?: number) {
  return status === 403 &&
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    body.error === 'POS_DEVICE_UNAUTHORIZED'
}
