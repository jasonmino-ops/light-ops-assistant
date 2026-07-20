export type DesktopStore = {
  storeId: string
  storeCode: string
  storeName: string
  storeStatus: string
  tenantId: string
  tenantName: string
  tenantStatus: string
  subscription: {
    status: string
    accessState: string
    trialEndsAt: string | null
    currentPeriodEndsAt: string | null
  }
  desktopCount: number
  activeDesktopCount: number
  activationStatus: string
  lastVerification: string | null
  currentPinStatus: string
  currentRuntimeVersion: string
  currentDesktopVersion: string
}

export type StoresResponse = {
  stores: DesktopStore[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export type DesktopDevice = {
  deviceRef: string
  deviceName: string
  storeCode: string
  storeName: string
  tenantName: string
  subscriptionStatus: string
  status: 'ACTIVE' | 'OFFLINE' | 'BLOCKED' | 'REVOKED'
  activatedAt: string
  lastVerification: string | null
  desktopVersion: string | null
  windowsVersion: string | null
  revokedAt: string | null
  canRevoke: boolean
}

export type DevicesResponse = {
  devices: DesktopDevice[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export type DesktopAuditEvent = {
  eventKey: string
  eventType: string
  category: string
  label: string
  result: string
  reasonCode: string | null
  createdAt: string
  storeCode: string
  storeName: string
  tenantName: string
  deviceRef: string | null
  actor: string
  derived: boolean
}

export type AuditResponse = {
  events: DesktopAuditEvent[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export type RuntimeResponse = {
  runtimeVersion: string
  currentDesktopVersion: string
  deviceCount: number
  statusCounts: Record<'ACTIVE' | 'OFFLINE' | 'BLOCKED' | 'REVOKED', number>
  lastVerification: string | null
  desktopTelemetry: string
  windowsTelemetry: string
}
