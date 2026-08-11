export const FIELD_STORE_CODE = 'ST169E7000' as const
export const FIELD_QUEUE_NAME = '前台' as const

export type DeviceIdentity = {
  deviceId: string
  tenantId: string
  storeId: string
  storeCode: string
  status: string
  tokenExpiresAt: string
  credentialVersion: number
}

export type CloudCommandStream = { encoding: 'base64'; byteLength: number; sha256: string; data: string }
export type CloudTask = {
  id: string
  taskId: string
  storeId: string
  storeCode: string
  taskType: 'PRINT_ESC_POS'
  schemaVersion: 1
  idempotencyKey: string
  payload: {
    storeCode: string
    documentName: string
    target: { type: 'WINDOWS_QUEUE'; name: string }
    commandStream: CloudCommandStream
  }
  target: { type: 'WINDOWS_QUEUE'; name: string }
  status: 'CLAIMED'
  claimedByDeviceId: string
  leaseExpiresAt: string
  attemptCount: number
}

export type TaskResult = {
  state: 'SUCCEEDED' | 'FAILED'
  resultCode: string
  message?: string
  effectBoundary: 'NOT_CROSSED' | 'CROSSING_UNKNOWN' | 'CROSSED'
  physicalCompletionKnown: false
}

export type WorkerPublicStatus = {
  connection: 'connected' | 'disconnected'
  lastJob: string | null
  lastResult: string | null
}
