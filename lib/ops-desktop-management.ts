export const CURRENT_DESKTOP_VERSION = '0.2.0-pilot.2'
export const DESKTOP_ACTIVATION_RUNTIME_VERSION = 'Activation Runtime v1'
export const DESKTOP_OFFLINE_AFTER_MS = 24 * 60 * 60 * 1000

export type DesktopManagementStatus = 'ACTIVE' | 'OFFLINE' | 'BLOCKED' | 'REVOKED'

export function shortDeviceReference(deviceId: string) {
  const compact = deviceId.replace(/[^a-zA-Z0-9]/g, '')
  return compact.slice(-8).toUpperCase() || 'UNKNOWN'
}

export function deriveDesktopManagementStatus(input: {
  sourceStatus: string
  tenantStatus: string
  storeStatus: string
  subscriptionAccessState: string
  tokenExpiresAt: Date
  lastSeenAt: Date | null
  now?: Date
}): DesktopManagementStatus {
  if (input.sourceStatus === 'REVOKED') return 'REVOKED'

  const now = input.now ?? new Date()
  if (
    input.tenantStatus !== 'ACTIVE'
    || input.storeStatus !== 'ACTIVE'
    || input.subscriptionAccessState !== 'ALLOWED'
    || input.tokenExpiresAt.getTime() <= now.getTime()
  ) {
    return 'BLOCKED'
  }

  if (!input.lastSeenAt || now.getTime() - input.lastSeenAt.getTime() > DESKTOP_OFFLINE_AFTER_MS) {
    return 'OFFLINE'
  }
  return 'ACTIVE'
}

export function currentPinStatus(input: { status: string; expiresAt: Date } | null, now = new Date()) {
  if (!input) return 'NONE'
  if (input.status === 'ACTIVE' && input.expiresAt.getTime() <= now.getTime()) return 'EXPIRED'
  return input.status
}

const AUDIT_EVENT_LABELS: Record<string, string> = {
  PIN_CREATED: 'PIN Issued',
  PIN_USED: 'PIN Consumed',
  DEVICE_ACTIVATED: 'Activation Success',
  DEVICE_REACTIVATED: 'Activation Success',
  DESKTOP_VERIFIED: 'Verification',
  DEVICE_REVOKED: 'Revoked',
  DEVICE_REMOVED: 'Device Removed',
  ACTIVATION_DENIED: 'Activation Blocked',
  PIN_CREATE_DENIED: 'Subscription Blocked',
  PIN_EXPIRED: 'PIN Expired',
  PIN_LOCKED: 'PIN Locked',
  PIN_REVOKED: 'PIN Revoked',
  PIN_VERIFY_FAILED: 'PIN Verification Failed',
  TOKEN_ROTATED: 'Credential Rotated',
}

export function desktopAuditEventLabel(eventType: string, reasonCode?: string | null) {
  if (reasonCode === 'SUBSCRIPTION_BLOCKED') return 'Subscription Blocked'
  return AUDIT_EVENT_LABELS[eventType] ?? 'Desktop Event'
}

export function desktopAuditCategory(eventType: string, reasonCode?: string | null) {
  if (reasonCode === 'SUBSCRIPTION_BLOCKED' || eventType === 'PIN_CREATE_DENIED') return 'SUBSCRIPTION'
  if (eventType.startsWith('PIN_')) return 'PIN'
  if (eventType === 'DESKTOP_VERIFIED') return 'VERIFICATION'
  if (eventType.includes('REVOKED') || eventType === 'DEVICE_REMOVED') return 'REVOCATION'
  return 'ACTIVATION'
}
