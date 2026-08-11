import type { HrtCommandResultPayload } from '@eshop/hrt-contract'
import type { PublicDeviceIdentity } from '../activation/activationTypes'
import type { RuntimeReceiptPayload } from '../../shared/printerPayload'

export type StoreRuntimePrinterBinding = {
  id: string
  tenantId: string
  storeId: string
  targetType: 'WINDOWS_QUEUE'
  printerName: string
  enabled: boolean
  version: number
  updatedAt: string
}

export type StoreRuntimeCloudTask = {
  id: string
  tenantId: string
  storeId: string
  taskType: 'PRINT_RECEIPT'
  schemaVersion: 1
  idempotencyKey: string
  payload: { receipt: RuntimeReceiptPayload }
  printerBinding: {
    id: string
    version: number
    targetType: 'WINDOWS_QUEUE'
    printerName: string
  }
  status: 'ACCEPTED'
  claimedByDeviceId: string
  leaseExpiresAt: string
  attemptCount: number
}

export type StoreRuntimeBootstrap = {
  runtime: {
    device: PublicDeviceIdentity
    store: { id: string; code: string; name: string; status: string }
  }
  binding: StoreRuntimePrinterBinding | null
}

export type StoreRuntimeTaskResult = {
  state: 'SUCCEEDED' | 'FAILED'
  resultCode: string
  message?: string
  effectBoundary: HrtCommandResultPayload['effectBoundary']
  physicalCompletionKnown: false
}

export type StoreRuntimeJournalRecord = {
  taskId: string
  idempotencyKey: string
  storeId: string
  state: 'ACCEPTED' | 'EXECUTING' | 'TERMINAL'
  result?: StoreRuntimeTaskResult
  reported: boolean
  updatedAt: string
}
