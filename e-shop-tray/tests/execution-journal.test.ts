import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ExecutionJournal, ExecutionJournalError } from '../src/executionJournal'
import type { ReceivedPrintJob } from '../src/cloudRelayClient'

const protector = {
  protect: (value: string) => `sealed:${Buffer.from(value).toString('base64')}`,
  unprotect: (value: string) => Buffer.from(value.slice('sealed:'.length), 'base64').toString(),
}

function job(attempt = 1): ReceivedPrintJob {
  return {
    id: 'relay-job-0001',
    schemaVersion: 1,
    idempotencyKey: 'request-0001',
    requestHash: 'a'.repeat(64),
    requestId: 'request-0001',
    orderNo: 'ORDER-001',
    documentName: 'receipt',
    commandStream: Uint8Array.from([0x1b, 0x40]),
    claimAttempt: attempt,
    claimToken: `ecp_v1_${'z'.repeat(43)}`,
    leaseExpiresAt: new Date(Date.now() + 30_000).toISOString(),
  }
}

async function journalPath() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'e-shop-tray-journal-'))
  return path.join(directory, 'journal.json')
}

describe('durable local execution journal', () => {
  it('persists the claim before execution without plaintext claim tokens', async () => {
    const file = await journalPath()
    const journal = new ExecutionJournal(file, protector)
    await journal.recordClaimed(job())
    const raw = await readFile(file, 'utf8')
    expect(raw).not.toContain(job().claimToken)
    expect((await journal.pendingRecords())[0].claimToken).toBe(job().claimToken)
  })

  it('recovers CROSSING_UNKNOWN and terminal results across restart', async () => {
    const file = await journalPath()
    const first = new ExecutionJournal(file, protector)
    await first.recordClaimed(job())
    await first.recordExecuting(job(), 'CROSSING_UNKNOWN')

    const restarted = new ExecutionJournal(file, protector)
    const unknown = (await restarted.pendingRecords())[0]
    expect(unknown.state).toBe('EXECUTING')
    expect(unknown.effectBoundary).toBe('CROSSING_UNKNOWN')

    await restarted.recordTerminal(job(), {
      state: 'FAILED',
      resultCode: 'RUNTIME_INTERRUPTED_DURING_EXECUTION',
      effectBoundary: 'CROSSING_UNKNOWN',
      physicalCompletionKnown: false,
    })
    const secondRestart = new ExecutionJournal(file, protector)
    expect((await secondRestart.pendingRecords())[0].state).toBe('TERMINAL')
  })

  it('fails closed on a corrupt journal instead of discarding unknown work', async () => {
    const file = await journalPath()
    const journal = new ExecutionJournal(file, protector)
    await journal.recordClaimed(job())
    const raw = await readFile(file, 'utf8')
    const corrupted = raw.replace('"schemaVersion":1', '"schemaVersion":99')
    await import('node:fs/promises').then(({ writeFile }) => writeFile(file, corrupted))
    const restarted = new ExecutionJournal(file, protector)
    await expect(restarted.load()).rejects.toBeInstanceOf(ExecutionJournalError)
  })
})
