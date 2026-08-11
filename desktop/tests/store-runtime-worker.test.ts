import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { HrtCommandRequestPayload, HrtCommandResultPayload } from '@eshop/hrt-contract'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PublicDeviceIdentity } from '../src/main/activation/activationTypes'
import { StoreRuntimeStateStore } from '../src/main/storeRuntime/stateStore'
import type { StoreRuntimeCloudPort, StoreRuntimePrintExecutor } from '../src/main/storeRuntime/worker'
import { StoreRuntimeWorker } from '../src/main/storeRuntime/worker'
import type {
  StoreRuntimeCloudTask,
  StoreRuntimePrinterBinding,
  StoreRuntimeTaskResult,
} from '../src/main/storeRuntime/types'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

const identity: PublicDeviceIdentity = {
  deviceId: 'device-001',
  tenantId: 'tenant-001',
  storeId: 'store-001',
  storeCode: 'STORE-A',
  status: 'ACTIVE',
  tokenExpiresAt: '2027-01-01T00:00:00.000Z',
  credentialVersion: 1,
}

const binding: StoreRuntimePrinterBinding = {
  id: 'binding-001',
  tenantId: identity.tenantId,
  storeId: identity.storeId,
  targetType: 'WINDOWS_QUEUE',
  printerName: 'EPSON TM-T82',
  enabled: true,
  version: 1,
  updatedAt: '2026-08-11T00:00:00.000Z',
}

const receipt = {
  schemaVersion: '1' as const,
  receiptId: 'receipt-001',
  orderNumber: 'ORDER-001',
  storeName: 'E-Shop 测试店',
  storeCode: identity.storeCode,
  timestamp: '2026-08-11T00:00:00.000Z',
  currencyCode: 'USD',
  items: [{ name: 'កាហ្វេ / 咖啡 / Coffee', quantity: 1, unitPrice: 2.5, lineTotal: 2.5 }],
  subtotal: 2.5,
  total: 2.5,
}

function task(patch: Partial<StoreRuntimeCloudTask> = {}): StoreRuntimeCloudTask {
  return {
    id: 'task-0001',
    tenantId: identity.tenantId,
    storeId: identity.storeId,
    taskType: 'PRINT_RECEIPT',
    schemaVersion: 1,
    idempotencyKey: 'receipt:order-0001',
    payload: { receipt },
    printerBinding: {
      id: binding.id,
      version: binding.version,
      targetType: 'WINDOWS_QUEUE',
      printerName: binding.printerName,
    },
    status: 'ACCEPTED',
    claimedByDeviceId: identity.deviceId,
    leaseExpiresAt: '2026-08-11T00:01:00.000Z',
    attemptCount: 1,
    ...patch,
  }
}

async function stateStore() {
  const path = await mkdtemp(join(tmpdir(), 'eshop-store-runtime-worker-'))
  tempDirs.push(path)
  return new StoreRuntimeStateStore(path)
}

function cloudPort(claimedTask: StoreRuntimeCloudTask | null) {
  return {
    bootstrap: vi.fn(async () => ({
      runtime: { device: identity, store: { id: identity.storeId, code: identity.storeCode, name: 'Store A', status: 'ACTIVE' } },
      binding,
    })),
    heartbeat: vi.fn(async () => binding),
    claimTask: vi.fn(async () => ({ binding, task: claimedTask })),
    markExecuting: vi.fn(async () => undefined),
    reportResult: vi.fn(async () => undefined),
  } satisfies StoreRuntimeCloudPort
}

function printExecutor(result?: HrtCommandResultPayload) {
  let printerName: string | null = null
  const executeCommand = vi.fn(async (command: HrtCommandRequestPayload) => result ?? {
    commandId: command.commandId,
    outcome: 'SUCCEEDED',
    effectBoundary: 'CROSSED',
    providerInstanceId: 'provider-001',
  } satisfies HrtCommandResultPayload)
  const executor: StoreRuntimePrintExecutor = {
    setPrinterBinding: vi.fn(async (next: string | null) => { printerName = next }),
    configuredPrinterName: () => printerName,
    isReady: () => printerName !== null,
    executeCommand,
  }
  return { executor, executeCommand }
}

async function initializedWorker(input: {
  cloud: StoreRuntimeCloudPort
  stateStore: StoreRuntimeStateStore
  executor: StoreRuntimePrintExecutor
}) {
  const worker = new StoreRuntimeWorker({
    identity,
    ...input,
    pollIntervalMs: 60_000,
    heartbeatIntervalMs: 60_000,
  })
  await worker.start()
  worker.stop()
  return worker
}

describe('Store Runtime task worker', () => {
  it('moves accepted → executing → Cloud result through the existing provider command path', async () => {
    const cloud = cloudPort(task())
    const local = await stateStore()
    const { executor, executeCommand } = printExecutor()
    const worker = await initializedWorker({ cloud, stateStore: local, executor })

    await worker.runOnceForTest()

    expect(cloud.markExecuting).toHaveBeenCalledWith('task-0001')
    expect(executeCommand).toHaveBeenCalledTimes(1)
    expect(executeCommand.mock.calls[0][0]).toMatchObject({
      commandId: 'task-0001',
      idempotencyKey: 'receipt:order-0001',
      commandType: 'PRINT_RECEIPT',
      params: { receipt },
    })
    expect(cloud.reportResult).toHaveBeenCalledWith('task-0001', {
      state: 'SUCCEEDED',
      resultCode: 'SUBMITTED_TO_WINDOWS_SPOOLER',
      message: 'Windows accepted the print job; physical paper output is not confirmed.',
      effectBoundary: 'CROSSED',
      physicalCompletionKnown: false,
    })
    expect(local.records()).toEqual([expect.objectContaining({ state: 'TERMINAL', reported: true })])
  })

  it('rejects a wrong-store/invalid task before entering the printing boundary', async () => {
    const cloud = cloudPort(task({ storeId: 'other-store' }))
    const local = await stateStore()
    const { executor, executeCommand } = printExecutor()
    const worker = await initializedWorker({ cloud, stateStore: local, executor })

    await worker.runOnceForTest()

    expect(executeCommand).not.toHaveBeenCalled()
    expect(cloud.reportResult).toHaveBeenCalledWith('task-0001', expect.objectContaining({
      state: 'FAILED',
      resultCode: 'STORE_RUNTIME_TASK_SCOPE_MISMATCH',
      effectBoundary: 'NOT_CROSSED',
      physicalCompletionKnown: false,
    }))
  })

  it('reports printer failure and timeout without a false physical-completion claim', async () => {
    const cloud = cloudPort(task())
    const local = await stateStore()
    const { executor, executeCommand } = printExecutor()
    executeCommand.mockRejectedValueOnce(new Error('PRINT_TIMEOUT'))
    const worker = await initializedWorker({ cloud, stateStore: local, executor })

    await worker.runOnceForTest()

    expect(cloud.reportResult).toHaveBeenCalledWith('task-0001', expect.objectContaining({
      state: 'FAILED',
      resultCode: 'PRINT_TIMEOUT',
      effectBoundary: 'CROSSING_UNKNOWN',
      physicalCompletionKnown: false,
    }))
  })

  it('replays a locally persisted terminal result after reconnect without printing twice', async () => {
    const cloud = cloudPort(task())
    const local = await stateStore()
    const terminalResult: StoreRuntimeTaskResult = {
      state: 'FAILED',
      resultCode: 'PRINTER_OFFLINE',
      effectBoundary: 'NOT_CROSSED',
      physicalCompletionKnown: false,
    }
    await local.recordTerminal({
      taskId: 'task-recovery-001',
      idempotencyKey: 'receipt:recovery-001',
      storeId: identity.storeId,
      result: terminalResult,
    })
    const { executor, executeCommand } = printExecutor()
    const worker = await initializedWorker({ cloud, stateStore: local, executor })

    await worker.runOnceForTest()

    expect(cloud.reportResult).toHaveBeenCalledWith('task-recovery-001', terminalResult)
    expect(cloud.claimTask).not.toHaveBeenCalled()
    expect(executeCommand).not.toHaveBeenCalled()
    expect(local.records()[0].reported).toBe(true)
  })

  it('fails an interrupted executing task with an uncertain boundary and never retries it', async () => {
    const cloud = cloudPort(task())
    const local = await stateStore()
    await local.recordExecuting({
      taskId: 'task-interrupted-001',
      idempotencyKey: 'receipt:interrupted-001',
      storeId: identity.storeId,
    })
    const { executor, executeCommand } = printExecutor()
    const worker = await initializedWorker({ cloud, stateStore: local, executor })

    await worker.runOnceForTest()

    expect(cloud.markExecuting).toHaveBeenCalledWith('task-interrupted-001')
    expect(cloud.reportResult).toHaveBeenCalledWith('task-interrupted-001', expect.objectContaining({
      state: 'FAILED',
      resultCode: 'RUNTIME_INTERRUPTED_DURING_EXECUTION',
      effectBoundary: 'CROSSING_UNKNOWN',
      physicalCompletionKnown: false,
    }))
    expect(cloud.claimTask).not.toHaveBeenCalled()
    expect(executeCommand).not.toHaveBeenCalled()
  })

  it('recovers from an offline bootstrap using the cached binding, then resumes Cloud polling', async () => {
    const cloud = cloudPort(task())
    cloud.bootstrap.mockRejectedValueOnce(new Error('CLOUD_NETWORK_ERROR'))
    const local = await stateStore()
    await local.setBinding(binding)
    const { executor, executeCommand } = printExecutor()
    const worker = await initializedWorker({ cloud, stateStore: local, executor })

    await worker.runOnceForTest()

    expect(cloud.heartbeat).toHaveBeenCalledTimes(1)
    expect(cloud.claimTask).toHaveBeenCalledTimes(1)
    expect(executeCommand).toHaveBeenCalledTimes(1)
    expect(cloud.reportResult).toHaveBeenCalledWith('task-0001', expect.objectContaining({
      state: 'SUCCEEDED',
      physicalCompletionKnown: false,
    }))
  })
})
