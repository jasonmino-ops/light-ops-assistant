import { createHash } from 'node:crypto'
import type { WindowsQueueTransport } from '../printing/windowsQueueTransport'
import type { CloudRelayClient } from './cloudClient'
import type { CloudRelayStateStore, JournalRecord } from './stateStore'
import { FIELD_QUEUE_NAME, FIELD_STORE_CODE, type CloudTask, type TaskResult, type WorkerPublicStatus } from './types'

export type CloudRelayWorkerOptions = {
  token: string
  client: Pick<CloudRelayClient, 'bootstrap' | 'claim' | 'markExecuting' | 'report'>
  stateStore: CloudRelayStateStore
  transport: Pick<WindowsQueueTransport, 'deliver'>
  pollIntervalMs?: number
  onStatus?: (status: WorkerPublicStatus) => void
}

function failed(code: string, boundary: TaskResult['effectBoundary'], message?: string): TaskResult {
  return { state: 'FAILED', resultCode: code, ...(message ? { message: message.slice(0, 240) } : {}), effectBoundary: boundary, physicalCompletionKnown: false }
}

export class CloudRelayWorker {
  private timer: NodeJS.Timeout | null = null
  private stopped = true
  private running = false
  private status: WorkerPublicStatus = { connection: 'disconnected', lastJob: null, lastResult: null }

  constructor(private readonly options: CloudRelayWorkerOptions) {}

  publicStatus() { return { ...this.status } }

  async start() {
    this.stopped = false
    await this.options.stateStore.load()
    try {
      await this.options.client.bootstrap(this.options.token)
      this.setStatus({ connection: 'connected' })
    } catch {
      this.setStatus({ connection: 'disconnected' })
    }
    this.schedule(0)
  }

  stop() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.setStatus({ connection: 'disconnected' })
  }

  async runOnceForTest() { await this.runOnce() }

  private schedule(delay: number) {
    if (this.stopped) return
    this.timer = setTimeout(() => { void this.loop() }, delay)
  }

  private async loop() {
    if (this.running || this.stopped) return
    this.running = true
    try {
      await this.runOnce()
      this.setStatus({ connection: 'connected' })
    } catch {
      this.setStatus({ connection: 'disconnected' })
    } finally {
      this.running = false
      this.schedule(this.options.pollIntervalMs ?? 2_000)
    }
  }

  private async runOnce() {
    if (await this.replayRecovery()) return
    const task = await this.options.client.claim(this.options.token)
    if (!task) return
    this.setStatus({ lastJob: task.id })
    await this.options.stateStore.recordAccepted({ taskId: task.id, idempotencyKey: task.idempotencyKey, storeId: task.storeId })

    try {
      await this.options.client.markExecuting(this.options.token, task.id)
    } catch {
      const result = failed('CLOUD_EXECUTION_TRANSITION_UNKNOWN', 'NOT_CROSSED')
      await this.options.stateStore.recordTerminal({ taskId: task.id, idempotencyKey: task.idempotencyKey, storeId: task.storeId, result })
      await this.report(task.id, result)
      return
    }

    await this.options.stateStore.recordExecuting({ taskId: task.id, idempotencyKey: task.idempotencyKey, storeId: task.storeId })
    let result: TaskResult
    try {
      const command = this.validateTask(task)
      const delivery = await this.options.transport.deliver(command, task.payload.documentName)
      result = {
        state: 'SUCCEEDED',
        resultCode: 'SUBMITTED_TO_WINDOWS_SPOOLER',
        message: `${delivery.bytesWritten} bytes accepted by Windows queue; physical paper output is not confirmed.`,
        effectBoundary: 'CROSSED',
        physicalCompletionKnown: false,
      }
    } catch (error) {
      const code = error instanceof Error && /^[A-Z0-9_]{3,80}$/.test(error.message) ? error.message : 'PRINT_EXECUTION_FAILED'
      const beforePrintBoundary = code.startsWith('FIELD_TASK_') || ['TRAY_BUSY', 'WINDOWS_REQUIRED', 'INVALID_COMMAND_STREAM'].includes(code)
      result = failed(code, beforePrintBoundary ? 'NOT_CROSSED' : 'CROSSING_UNKNOWN')
    }
    await this.options.stateStore.recordTerminal({ taskId: task.id, idempotencyKey: task.idempotencyKey, storeId: task.storeId, result })
    await this.report(task.id, result)
  }

  private validateTask(task: CloudTask): Uint8Array {
    if (task.storeCode !== FIELD_STORE_CODE || task.payload.storeCode !== FIELD_STORE_CODE) throw new Error('FIELD_TASK_STORE_MISMATCH')
    if (task.target.name !== FIELD_QUEUE_NAME || task.payload.target.name !== FIELD_QUEUE_NAME) throw new Error('FIELD_TASK_TARGET_MISMATCH')
    if (task.claimedByDeviceId.length < 1) throw new Error('FIELD_TASK_DEVICE_MISSING')
    const stream = task.payload.commandStream
    const bytes = Buffer.from(stream.data, 'base64')
    if (stream.encoding !== 'base64' || bytes.byteLength !== stream.byteLength || bytes.byteLength < 1 || bytes.byteLength > 3 * 1024 * 1024) {
      throw new Error('FIELD_TASK_COMMAND_INVALID')
    }
    if (createHash('sha256').update(bytes).digest('hex') !== stream.sha256) throw new Error('FIELD_TASK_DIGEST_MISMATCH')
    return Uint8Array.from(bytes)
  }

  private async replayRecovery(): Promise<boolean> {
    const pending = this.options.stateStore.records().find((record) =>
      (record.state === 'TERMINAL' && !record.reported) || record.state === 'EXECUTING',
    )
    if (!pending) return false
    let terminal: JournalRecord = pending
    if (pending.state === 'EXECUTING') {
      const result = failed('RUNTIME_INTERRUPTED_DURING_EXECUTION', 'CROSSING_UNKNOWN')
      await this.options.stateStore.recordTerminal({
        taskId: pending.taskId,
        idempotencyKey: pending.idempotencyKey,
        storeId: pending.storeId,
        result,
      })
      terminal = { ...pending, state: 'TERMINAL', result, reported: false }
    }
    if (!terminal.result) return false
    await this.report(terminal.taskId, terminal.result)
    return true
  }

  private async report(taskId: string, result: TaskResult) {
    await this.options.client.report(this.options.token, taskId, result)
    await this.options.stateStore.markReported(taskId)
    this.setStatus({ lastResult: `${result.state} · ${result.resultCode}` })
  }

  private setStatus(patch: Partial<WorkerPublicStatus>) {
    this.status = { ...this.status, ...patch }
    this.options.onStatus?.(this.publicStatus())
  }
}
