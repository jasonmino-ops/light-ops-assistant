import type {
  CloudRelayClient,
  ReceivedPrintJob,
  TerminalResult,
} from './cloudRelayClient'
import {
  CloudRelayError,
  ES_TRAY_POLL_INTERVAL_MS,
  isPermanentTerminalRejection,
} from './cloudRelayClient'
import type { ExecutionJournal, RecoveredJournalRecord } from './executionJournal'
import type { RelayEventRecorder } from './resultLog'
import { PrintDeliveryError, type WindowsQueueTransport } from './printing/windowsQueueTransport'

type RelayClientPort = Pick<CloudRelayClient, 'receive' | 'markExecuting' | 'reportResult'>
type QueueTransport = Pick<WindowsQueueTransport, 'deliver'>

function jobReference(record: RecoveredJournalRecord) {
  return { id: record.jobId, claimAttempt: record.claimAttempt, claimToken: record.claimToken }
}

function safeResultCode(error: unknown) {
  return error instanceof PrintDeliveryError
    ? error.code
    : 'TRAY_EXECUTION_FAILED'
}

export class RelayPoller {
  private timer: NodeJS.Timeout | null = null
  private stopped = true
  private running = false

  constructor(private readonly options: {
    client: RelayClientPort
    transport: QueueTransport
    journal: ExecutionJournal
    recorder: RelayEventRecorder
    intervalMs?: number
    now?: () => number
  }) {}

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.schedule(0)
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  async runOnceForTest(): Promise<void> {
    await this.runOnce()
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return
    this.timer = setTimeout(() => { void this.loop() }, delayMs)
  }

  private async loop(): Promise<void> {
    if (this.running || this.stopped) return
    this.running = true
    try {
      await this.runOnce()
    } catch {
      // Journal state remains durable. The next bounded poll retries only the
      // network acknowledgement, never an uncertain physical side effect.
    } finally {
      this.running = false
      this.schedule(this.options.intervalMs ?? ES_TRAY_POLL_INTERVAL_MS)
    }
  }

  private async runOnce(): Promise<void> {
    if (await this.flushRecoveryJournal()) return
    const job = await this.options.client.receive()
    if (!job) return
    await this.process(job)
  }

  private async process(job: ReceivedPrintJob) {
    await this.options.journal.recordClaimed(job)
    await this.record({ event: 'JOB_CLAIMED', jobId: job.id, claimAttempt: job.claimAttempt })

    // Persist intent before asking the server to cross into EXECUTING.
    await this.options.journal.recordExecuting(job, 'NOT_CROSSED')
    try {
      await this.options.client.markExecuting(job)
    } catch {
      const result: TerminalResult = {
        state: 'FAILED',
        resultCode: 'MARK_EXECUTING_FAILED',
        effectBoundary: 'NOT_CROSSED',
        physicalCompletionKnown: false,
      }
      await this.finish(job, result)
      return
    }

    // This durable write is the final action before invoking Winspool.
    await this.options.journal.recordExecuting(job, 'CROSSING_UNKNOWN')
    await this.record({
      event: 'WINDOWS_RAW_START',
      jobId: job.id,
      claimAttempt: job.claimAttempt,
      effectBoundary: 'CROSSING_UNKNOWN',
      commandBytes: job.commandStream.byteLength,
    })

    let result: TerminalResult
    try {
      const delivery = await this.options.transport.deliver(job.commandStream, job.documentName)
      result = {
        state: 'SUCCEEDED',
        resultCode: 'SUBMITTED_TO_WINDOWS_SPOOLER',
        resultMessage: 'Winspool accepted the complete RAW command stream; physical paper output is not confirmed.',
        effectBoundary: 'CROSSED',
        physicalCompletionKnown: false,
      }
      await this.record({
        event: 'WINDOWS_RAW_ACCEPTED',
        jobId: job.id,
        claimAttempt: job.claimAttempt,
        effectBoundary: delivery.effectBoundary,
        bytesWritten: delivery.bytesWritten,
        durationMs: delivery.durationMs,
      })
    } catch (error) {
      result = {
        state: 'FAILED',
        resultCode: safeResultCode(error),
        effectBoundary: error instanceof PrintDeliveryError
          ? error.effectBoundary
          : 'CROSSING_UNKNOWN',
        physicalCompletionKnown: false,
      }
    }
    await this.finish(job, result)
  }

  private async finish(
    job: Pick<ReceivedPrintJob, 'id' | 'claimAttempt' | 'claimToken'>,
    result: TerminalResult,
  ) {
    await this.options.journal.recordTerminal(job, result)
    await this.ackTerminal(job, result)
  }

  private async flushRecoveryJournal(): Promise<boolean> {
    const pending = await this.options.journal.pendingRecords()
    const record = pending[0]
    if (!record) return false
    const job = jobReference(record)

    if (record.state === 'TERMINAL' && record.result) {
      await this.ackTerminal(job, record.result)
      return true
    }

    if (record.state === 'EXECUTING') {
      const result: TerminalResult = record.effectBoundary === 'CROSSING_UNKNOWN'
        ? {
            state: 'FAILED',
            resultCode: 'RUNTIME_INTERRUPTED_DURING_EXECUTION',
            effectBoundary: 'CROSSING_UNKNOWN',
            physicalCompletionKnown: false,
          }
        : {
            state: 'FAILED',
            resultCode: 'RUNTIME_INTERRUPTED_BEFORE_EXECUTION',
            effectBoundary: 'NOT_CROSSED',
            physicalCompletionKnown: false,
      }
      await this.options.journal.recordTerminal(job, result)
      await this.ackTerminal(job, result)
      return true
    }

    if (record.state === 'CLAIMED') {
      const now = this.options.now?.() ?? Date.now()
      if (Date.parse(record.leaseExpiresAt) > now) return true
      await this.options.journal.markAbandoned(record.jobId, record.claimAttempt)
      return false
    }

    return false
  }

  private async ackTerminal(
    job: { id: string; claimAttempt: number; claimToken: string },
    result: TerminalResult,
  ) {
    try {
      await this.options.client.reportResult(job, result)
      await this.options.journal.markReported(job.id, job.claimAttempt)
      await this.record({
        event: 'RESULT_ACKNOWLEDGED',
        jobId: job.id,
        claimAttempt: job.claimAttempt,
        status: result.state,
        resultCode: result.resultCode,
        effectBoundary: result.effectBoundary,
      })
    } catch (error) {
      if (!isPermanentTerminalRejection(error)) throw error
      const errorCode = error instanceof CloudRelayError
        ? error.code
        : 'TERMINAL_ACK_REJECTED'
      await this.options.journal.markQuarantined(job.id, job.claimAttempt, errorCode)
      await this.record({
        event: 'RESULT_ACK_REJECTED',
        jobId: job.id,
        claimAttempt: job.claimAttempt,
        status: result.state,
        resultCode: errorCode,
        effectBoundary: result.effectBoundary,
      })
    }
  }

  private async record(event: Parameters<RelayEventRecorder['record']>[0]) {
    try {
      await this.options.recorder.record(event)
    } catch {
      // Bounded observability must never alter delivery state.
    }
  }
}
