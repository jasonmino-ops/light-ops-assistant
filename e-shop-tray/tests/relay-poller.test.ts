import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ReceivedPrintJob } from '../src/cloudRelayClient'
import { CloudRelayError } from '../src/cloudRelayClient'
import { ExecutionJournal } from '../src/executionJournal'
import { RelayPoller } from '../src/relayPoller'

const protector = {
  protect: (value: string) => `protected:${value}`,
  unprotect: (value: string) => value.slice('protected:'.length),
}

function job(overrides: Partial<ReceivedPrintJob> = {}): ReceivedPrintJob {
  return {
    id: 'relay-job-0001',
    schemaVersion: 1,
    idempotencyKey: 'request-0001',
    requestHash: 'a'.repeat(64),
    requestId: 'request-0001',
    orderNo: 'ORDER-001',
    documentName: 'receipt',
    commandStream: Uint8Array.from([0x1b, 0x40]),
    claimAttempt: 1,
    claimToken: `ecp_v1_${'x'.repeat(43)}`,
    leaseExpiresAt: new Date(Date.now() + 30_000).toISOString(),
    ...overrides,
  }
}

async function harness(overrides: {
  receive?: ReturnType<typeof vi.fn>
  markExecuting?: ReturnType<typeof vi.fn>
  reportResult?: ReturnType<typeof vi.fn>
  deliver?: ReturnType<typeof vi.fn>
  now?: () => number
} = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'e-shop-tray-poller-'))
  const journal = new ExecutionJournal(path.join(directory, 'journal.json'), protector)
  const client = {
    receive: overrides.receive ?? vi.fn(async () => null),
    markExecuting: overrides.markExecuting ?? vi.fn(async () => undefined),
    reportResult: overrides.reportResult ?? vi.fn(async () => undefined),
  }
  const transport = {
    deliver: overrides.deliver ?? vi.fn(async (stream: Uint8Array) => ({
      transport: 'windows-queue' as const,
      bytesWritten: stream.byteLength,
      durationMs: 1,
      effectBoundary: 'CROSSED' as const,
      physicalCompletionKnown: false as const,
    })),
  }
  const poller = new RelayPoller({
    client,
    transport,
    journal,
    recorder: { record: vi.fn(async () => undefined) },
    now: overrides.now,
  })
  return { poller, client, transport, journal }
}

describe('Tray 0.1.3 reliable relay poller', () => {
  it('persists, marks EXECUTING, prints once, and ACKs the terminal result', async () => {
    const claimed = job()
    const calls: string[] = []
    const h = await harness({
      receive: vi.fn(async () => { calls.push('receive'); return claimed }),
      markExecuting: vi.fn(async () => { calls.push('executing') }),
      deliver: vi.fn(async () => {
        calls.push('print')
        return { transport: 'windows-queue' as const, bytesWritten: 2, durationMs: 1, effectBoundary: 'CROSSED' as const, physicalCompletionKnown: false as const }
      }),
      reportResult: vi.fn(async () => { calls.push('result') }),
    })
    await h.poller.runOnceForTest()
    expect(calls).toEqual(['receive', 'executing', 'print', 'result'])
    expect(h.transport.deliver).toHaveBeenCalledTimes(1)
    expect((await h.journal.pendingRecords())).toEqual([])
  })

  it('a crash before EXECUTING is reported failed and never printed', async () => {
    const h = await harness()
    await h.journal.recordClaimed(job())
    await h.journal.recordExecuting(job(), 'NOT_CROSSED')
    await h.poller.runOnceForTest()
    expect(h.transport.deliver).not.toHaveBeenCalled()
    expect(h.client.reportResult).toHaveBeenCalledWith(
      expect.objectContaining({ id: job().id }),
      expect.objectContaining({ resultCode: 'RUNTIME_INTERRUPTED_BEFORE_EXECUTION', effectBoundary: 'NOT_CROSSED' }),
    )
  })

  it('a crash after EXECUTING is CROSSING_UNKNOWN and never auto-reprinted', async () => {
    const h = await harness()
    await h.journal.recordClaimed(job())
    await h.journal.recordExecuting(job(), 'CROSSING_UNKNOWN')
    await h.poller.runOnceForTest()
    await h.poller.runOnceForTest()
    expect(h.transport.deliver).not.toHaveBeenCalled()
    expect(h.client.reportResult).toHaveBeenCalledTimes(1)
    expect(h.client.reportResult).toHaveBeenCalledWith(
      expect.objectContaining({ id: job().id }),
      expect.objectContaining({ resultCode: 'RUNTIME_INTERRUPTED_DURING_EXECUTION', effectBoundary: 'CROSSING_UNKNOWN' }),
    )
  })

  it('retries only an unacknowledged terminal result after restart', async () => {
    const h = await harness()
    await h.journal.recordClaimed(job())
    await h.journal.recordTerminal(job(), {
      state: 'FAILED',
      resultCode: 'PRINT_DELIVERY_FAILED',
      effectBoundary: 'CROSSING_UNKNOWN',
      physicalCompletionKnown: false,
    })
    await h.poller.runOnceForTest()
    expect(h.transport.deliver).not.toHaveBeenCalled()
    expect(h.client.reportResult).toHaveBeenCalledTimes(1)
    expect((await h.journal.pendingRecords())).toEqual([])
  })

  it('quarantines a permanently rejected stale ACK without printing or blocking receive', async () => {
    const receive = vi.fn(async () => null)
    const h = await harness({
      receive,
      reportResult: vi.fn(async () => {
        throw new CloudRelayError('ES_TRAY_02_STALE_CLAIM', { httpStatus: 409 })
      }),
    })
    await h.journal.recordClaimed(job())
    await h.journal.recordTerminal(job(), {
      state: 'FAILED',
      resultCode: 'PRINT_DELIVERY_FAILED',
      effectBoundary: 'CROSSING_UNKNOWN',
      physicalCompletionKnown: false,
    })
    await h.poller.runOnceForTest()
    await h.poller.runOnceForTest()
    expect(h.transport.deliver).not.toHaveBeenCalled()
    expect(h.client.reportResult).toHaveBeenCalledTimes(1)
    expect(receive).toHaveBeenCalledTimes(1)
    expect(h.journal.records()[0]).toMatchObject({
      state: 'QUARANTINED',
      reported: true,
      ackErrorCode: 'ES_TRAY_02_STALE_CLAIM',
    })
  })

  it('keeps transient ACK failures pending and fail-closed', async () => {
    const receive = vi.fn(async () => null)
    const h = await harness({
      receive,
      reportResult: vi.fn(async () => {
        throw new CloudRelayError('ES_TRAY_02_SERVER_ERROR', { httpStatus: 500 })
      }),
    })
    await h.journal.recordClaimed(job())
    await h.journal.recordTerminal(job(), {
      state: 'FAILED',
      resultCode: 'PRINT_DELIVERY_FAILED',
      effectBoundary: 'CROSSING_UNKNOWN',
      physicalCompletionKnown: false,
    })
    await expect(h.poller.runOnceForTest()).rejects.toMatchObject({ code: 'ES_TRAY_02_SERVER_ERROR' })
    expect(receive).not.toHaveBeenCalled()
    expect((await h.journal.pendingRecords())).toHaveLength(1)
  })

  it('abandons an expired pre-execution claim and lets the server reissue it', async () => {
    const expired = job({ leaseExpiresAt: new Date(0).toISOString() })
    const receive = vi.fn(async () => null)
    const h = await harness({ receive, now: () => Date.now() })
    await h.journal.recordClaimed(expired)
    await h.poller.runOnceForTest()
    expect(receive).toHaveBeenCalledTimes(1)
    expect(h.transport.deliver).not.toHaveBeenCalled()
    expect((await h.journal.pendingRecords())).toEqual([])
  })

  it('mark-executing failure is terminalized without entering Winspool', async () => {
    const h = await harness({
      receive: vi.fn(async () => job()),
      markExecuting: vi.fn(async () => { throw new Error('network') }),
    })
    await h.poller.runOnceForTest()
    expect(h.transport.deliver).not.toHaveBeenCalled()
    expect(h.client.reportResult).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ resultCode: 'MARK_EXECUTING_FAILED', effectBoundary: 'NOT_CROSSED' }),
    )
  })
})
