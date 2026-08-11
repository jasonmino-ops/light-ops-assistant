import { HrtCommandRequestPayload, HrtCommandResultPayload, HrtJsonValue } from '@eshop/hrt-contract'
import type { PublicDeviceIdentity } from '../activation/activationTypes'
import { logger } from '../logger'
import { getHealthSnapshot, updateHealth } from '../runtimeHealth'
import type { StoreRuntimeCloudClient } from './cloudClient'
import type { StoreRuntimeStateStore } from './stateStore'
import type {
  StoreRuntimeCloudTask,
  StoreRuntimePrinterBinding,
  StoreRuntimeTaskResult,
} from './types'
import { validateRuntimeReceiptPayload } from '../../shared/printerPayload'

const POLL_INTERVAL_MS = 2_000
const HEARTBEAT_INTERVAL_MS = 30_000
const MAX_BACKOFF_MS = 30_000

export interface StoreRuntimePrintExecutor {
  setPrinterBinding(printerName: string | null): Promise<void>
  configuredPrinterName(): string | null
  isReady(): boolean
  executeCommand(command: HrtCommandRequestPayload, timeoutMs?: number): Promise<HrtCommandResultPayload>
}

export interface StoreRuntimeCloudPort {
  bootstrap(): ReturnType<StoreRuntimeCloudClient['bootstrap']>
  heartbeat(): ReturnType<StoreRuntimeCloudClient['heartbeat']>
  claimTask(): ReturnType<StoreRuntimeCloudClient['claimTask']>
  markExecuting(taskId: string): Promise<void>
  reportResult(taskId: string, result: StoreRuntimeTaskResult): Promise<void>
}

export class StoreRuntimeWorker {
  private running = false
  private ticking = false
  private timer: NodeJS.Timeout | null = null
  private failureCount = 0
  private lastHeartbeatAtMs = 0
  private binding: StoreRuntimePrinterBinding | null = null

  constructor(private readonly options: {
    identity: PublicDeviceIdentity
    cloud: StoreRuntimeCloudPort
    stateStore: StoreRuntimeStateStore
    executor: StoreRuntimePrintExecutor
    pollIntervalMs?: number
    heartbeatIntervalMs?: number
  }) {}

  async start(): Promise<void> {
    if (this.running) return
    await this.options.stateStore.load()
    this.binding = this.options.stateStore.binding()
    this.publishHealth({
      state: 'starting',
      storeId: this.options.identity.storeId,
      storeCode: this.options.identity.storeCode,
      deviceId: this.options.identity.deviceId,
      bindingVersion: this.binding?.version ?? null,
    })
    if (this.binding?.enabled) await this.options.executor.setPrinterBinding(this.binding.printerName)
    try {
      const bootstrap = await this.options.cloud.bootstrap()
      this.assertIdentity(bootstrap.runtime.device)
      await this.applyBinding(bootstrap.binding)
      this.failureCount = 0
      this.lastHeartbeatAtMs = Date.now()
      this.publishHealth({
        state: 'ok',
        cloudConnection: 'ok',
        lastHeartbeatAt: new Date().toISOString(),
        lastError: null,
      })
    } catch (error) {
      this.recordCloudFailure(error)
    }
    this.running = true
    this.schedule(0)
  }

  stop(): void {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.publishHealth({ state: 'closed' })
  }

  async runOnceForTest(): Promise<void> {
    await this.tick()
  }

  private schedule(delayMs: number) {
    if (!this.running) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.tick().finally(() => {
        const base = this.options.pollIntervalMs ?? POLL_INTERVAL_MS
        const backoff = Math.min(base * 2 ** this.failureCount, MAX_BACKOFF_MS)
        this.schedule(this.failureCount ? backoff : base)
      })
    }, delayMs)
  }

  private async tick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      if (await this.flushRecoveryJournal()) {
        this.failureCount = 0
        return
      }
      const heartbeatInterval = this.options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS
      if (Date.now() - this.lastHeartbeatAtMs >= heartbeatInterval) {
        const binding = await this.options.cloud.heartbeat()
        await this.applyBinding(binding)
        this.lastHeartbeatAtMs = Date.now()
        this.publishHealth({
          cloudConnection: 'ok',
          lastHeartbeatAt: new Date().toISOString(),
          lastError: null,
        })
      }
      if (!this.binding?.enabled || !this.options.executor.isReady()) {
        this.publishHealth({
          state: this.binding?.enabled ? 'degraded' : 'error',
          lastError: this.binding?.enabled ? 'PRINTER_EXECUTOR_NOT_READY' : 'PRINTER_NOT_CONFIGURED',
        })
        this.failureCount = 0
        return
      }
      const claimed = await this.options.cloud.claimTask()
      if (claimed.binding) await this.applyBinding(claimed.binding)
      if (!claimed.task) {
        this.failureCount = 0
        this.publishHealth({ state: 'ok', cloudConnection: 'ok', lastError: null })
        return
      }
      await this.processTask(claimed.task)
      this.failureCount = 0
      this.publishHealth({ state: 'ok', cloudConnection: 'ok', lastError: null })
    } catch (error) {
      this.recordCloudFailure(error)
    } finally {
      this.ticking = false
    }
  }

  private async processTask(task: StoreRuntimeCloudTask) {
    logger.info('store-runtime.task.accepted', {
      taskId: task.id,
      attemptCount: task.attemptCount,
      bindingVersion: task.printerBinding.version,
    })
    this.publishHealth({ lastTaskId: task.id, lastTaskStatus: 'ACCEPTED', lastError: null })
    await this.options.stateStore.recordAccepted({
      taskId: task.id,
      idempotencyKey: task.idempotencyKey,
      storeId: task.storeId,
    })

    let validationFailure: string | null = null
    try {
      this.validateTask(task)
    } catch (error) {
      validationFailure = error instanceof Error ? error.message : 'STORE_RUNTIME_TASK_INVALID'
    }

    await this.options.stateStore.recordExecuting({
      taskId: task.id,
      idempotencyKey: task.idempotencyKey,
      storeId: task.storeId,
    })
    await this.options.cloud.markExecuting(task.id)
    this.publishHealth({ lastTaskStatus: 'EXECUTING' })

    let result: StoreRuntimeTaskResult
    if (validationFailure) {
      result = {
        state: 'FAILED',
        resultCode: validationFailure,
        message: 'Task validation failed before the printing boundary.',
        effectBoundary: 'NOT_CROSSED',
        physicalCompletionKnown: false,
      }
    } else {
      result = await this.executeTask(task)
    }
    await this.options.stateStore.recordTerminal({
      taskId: task.id,
      idempotencyKey: task.idempotencyKey,
      storeId: task.storeId,
      result,
    })
    await this.options.cloud.reportResult(task.id, result)
    await this.options.stateStore.markReported(task.id)
    logger.info('store-runtime.task.completed', {
      taskId: task.id,
      state: result.state,
      resultCode: result.resultCode,
      effectBoundary: result.effectBoundary,
      physicalCompletionKnown: result.physicalCompletionKnown,
    })
    this.publishHealth({
      lastTaskStatus: result.state,
      lastResultCode: result.resultCode,
      lastError: result.state === 'FAILED' ? result.resultCode : null,
    })
  }

  private async executeTask(task: StoreRuntimeCloudTask): Promise<StoreRuntimeTaskResult> {
    const command: HrtCommandRequestPayload = {
      commandId: task.id,
      idempotencyKey: task.idempotencyKey,
      device: { deviceId: 'receipt-printer', deviceKind: 'PRINTER', slotId: 'receipt-printer' },
      commandType: 'PRINT_RECEIPT',
      params: { receipt: task.payload.receipt as unknown as HrtJsonValue },
    }
    try {
      const providerResult = await this.options.executor.executeCommand(command, 30_000)
      if (providerResult.outcome === 'SUCCEEDED' && providerResult.effectBoundary === 'CROSSED') {
        return {
          state: 'SUCCEEDED',
          resultCode: 'SUBMITTED_TO_WINDOWS_SPOOLER',
          message: 'Windows accepted the print job; physical paper output is not confirmed.',
          effectBoundary: 'CROSSED',
          physicalCompletionKnown: false,
        }
      }
      return {
        state: 'FAILED',
        resultCode: providerResult.errorCode ?? `PROVIDER_${providerResult.outcome}`,
        message: 'Windows printing provider reported a failure.',
        effectBoundary: providerResult.effectBoundary,
        physicalCompletionKnown: false,
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : 'PROVIDER_EXECUTION_FAILED'
      return {
        state: 'FAILED',
        resultCode: code.slice(0, 80),
        message: 'Print execution failed before a confirmed physical completion.',
        effectBoundary: code === 'PRINT_TIMEOUT' ? 'CROSSING_UNKNOWN' : 'NOT_CROSSED',
        physicalCompletionKnown: false,
      }
    }
  }

  private async flushRecoveryJournal(): Promise<boolean> {
    const pending = this.options.stateStore.records().filter((record) => !record.reported)
    const terminal = pending.find((record) => record.state === 'TERMINAL' && record.result)
    if (terminal?.result) {
      await this.options.cloud.reportResult(terminal.taskId, terminal.result)
      await this.options.stateStore.markReported(terminal.taskId)
      this.publishHealth({
        lastTaskId: terminal.taskId,
        lastTaskStatus: terminal.result.state,
        lastResultCode: terminal.result.resultCode,
      })
      return true
    }
    const uncertain = pending.find((record) => record.state === 'EXECUTING')
    if (!uncertain) return false
    await this.options.cloud.markExecuting(uncertain.taskId)
    const result: StoreRuntimeTaskResult = {
      state: 'FAILED',
      resultCode: 'RUNTIME_INTERRUPTED_DURING_EXECUTION',
      message: 'Runtime restarted with an unfinished task; the printing boundary is uncertain and the task was not retried.',
      effectBoundary: 'CROSSING_UNKNOWN',
      physicalCompletionKnown: false,
    }
    await this.options.stateStore.recordTerminal({
      taskId: uncertain.taskId,
      idempotencyKey: uncertain.idempotencyKey,
      storeId: uncertain.storeId,
      result,
    })
    await this.options.cloud.reportResult(uncertain.taskId, result)
    await this.options.stateStore.markReported(uncertain.taskId)
    this.publishHealth({
      lastTaskId: uncertain.taskId,
      lastTaskStatus: 'FAILED',
      lastResultCode: result.resultCode,
      lastError: result.resultCode,
    })
    return true
  }

  private validateTask(task: StoreRuntimeCloudTask) {
    if (
      task.tenantId !== this.options.identity.tenantId ||
      task.storeId !== this.options.identity.storeId ||
      task.claimedByDeviceId !== this.options.identity.deviceId
    ) throw new Error('STORE_RUNTIME_TASK_SCOPE_MISMATCH')
    if (task.taskType !== 'PRINT_RECEIPT' || task.schemaVersion !== 1) throw new Error('STORE_RUNTIME_TASK_TYPE_INVALID')
    if (
      !this.binding ||
      task.printerBinding.id !== this.binding.id ||
      task.printerBinding.version !== this.binding.version ||
      task.printerBinding.printerName !== this.binding.printerName ||
      this.options.executor.configuredPrinterName() !== this.binding.printerName
    ) throw new Error('STORE_RUNTIME_BINDING_MISMATCH')
    validateRuntimeReceiptPayload(task.payload.receipt)
    if (task.payload.receipt.storeCode !== this.options.identity.storeCode) throw new Error('STORE_RUNTIME_RECEIPT_STORE_MISMATCH')
  }

  private assertIdentity(device: PublicDeviceIdentity) {
    if (
      device.tenantId !== this.options.identity.tenantId ||
      device.storeId !== this.options.identity.storeId ||
      device.deviceId !== this.options.identity.deviceId ||
      device.storeCode !== this.options.identity.storeCode
    ) throw new Error('STORE_RUNTIME_IDENTITY_MISMATCH')
  }

  private async applyBinding(binding: StoreRuntimePrinterBinding | null) {
    if (binding && (binding.tenantId !== this.options.identity.tenantId || binding.storeId !== this.options.identity.storeId)) {
      throw new Error('STORE_RUNTIME_BINDING_SCOPE_MISMATCH')
    }
    const changed =
      this.binding?.id !== binding?.id ||
      this.binding?.version !== binding?.version ||
      this.binding?.printerName !== binding?.printerName ||
      this.binding?.enabled !== binding?.enabled
    this.binding = binding
    if (changed) {
      await this.options.stateStore.setBinding(binding)
      await this.options.executor.setPrinterBinding(binding?.enabled ? binding.printerName : null)
    }
    this.publishHealth({
      bindingVersion: binding?.version ?? null,
      lastError: binding?.enabled ? null : 'PRINTER_NOT_CONFIGURED',
    })
  }

  private recordCloudFailure(error: unknown) {
    this.failureCount = Math.min(this.failureCount + 1, 4)
    const code = error instanceof Error ? error.message : 'STORE_RUNTIME_CLOUD_ERROR'
    logger.warn('store-runtime.cloud.failed', { errorCode: code.slice(0, 120), failureCount: this.failureCount })
    this.publishHealth({
      state: 'degraded',
      cloudConnection: 'error',
      lastError: code.slice(0, 120),
    })
  }

  private publishHealth(patch: Partial<ReturnType<typeof getHealthSnapshot>['storeRuntime']>) {
    const current = getHealthSnapshot().storeRuntime
    updateHealth({ storeRuntime: { ...current, ...patch } }, 'store-runtime.updated')
  }
}
