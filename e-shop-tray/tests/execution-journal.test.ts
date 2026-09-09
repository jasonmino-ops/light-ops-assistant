import { mkdtemp, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExecutionJournal, ExecutionJournalError } from '../src/executionJournal'
import type { ReceivedPrintJob } from '../src/cloudRelayClient'

const filesystem = vi.hoisted(() => ({
  filePath: '',
  directoryPath: '',
  events: [] as string[],
  failure: undefined as { operation: string; error: NodeJS.ErrnoException } | undefined,
  syncBarrier: undefined as { operation: string; entered: () => void; release: Promise<void> } | undefined,
}))

// Wrap real filesystem operations; the journal implementation and its snapshots remain real.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const record = (operation: string) => {
    filesystem.events.push(operation)
    if (filesystem.failure?.operation === operation) throw filesystem.failure.error
  }
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const [file, flags] = args
      const target = String(file) === filesystem.filePath ? 'final'
        : String(file).startsWith(`${filesystem.filePath}.tmp-`) ? 'temp'
          : String(file) === filesystem.directoryPath ? 'directory' : undefined
      if (target) record(`${target}:open:${flags}`)
      const handle = await actual.open(...args)
      if (!target) return handle
      const writeFile = handle.writeFile.bind(handle)
      const sync = handle.sync.bind(handle)
      const close = handle.close.bind(handle)
      handle.writeFile = async (...writeArgs: Parameters<typeof handle.writeFile>) => {
        record(`${target}:write`)
        return writeFile(...writeArgs)
      }
      handle.sync = async () => {
        record(`${target}:sync`)
        // Windows FlushFileBuffers rejects the readonly handle that worked on macOS/Linux.
        if (process.platform === 'win32' && target === 'final' && flags === 'r') {
          throw Object.assign(new Error('EPERM: fsync on a readonly Windows handle'), { code: 'EPERM', syscall: 'fsync' })
        }
        if (filesystem.syncBarrier?.operation === `${target}:sync`) {
          filesystem.syncBarrier.entered()
          await filesystem.syncBarrier.release
        }
        return sync()
      }
      handle.close = async () => {
        record(`${target}:close`)
        return close()
      }
      return handle
    },
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (String(args[1]) === filesystem.filePath) record('rename')
      return actual.rename(...args)
    },
  }
})

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!

afterEach(() => {
  vi.restoreAllMocks()
  Object.defineProperty(process, 'platform', platformDescriptor)
  filesystem.filePath = ''
  filesystem.directoryPath = ''
  filesystem.events = []
  filesystem.failure = undefined
  filesystem.syncBarrier = undefined
})

function trackFilesystem(file: string, platform: 'win32' | 'darwin') {
  filesystem.filePath = file
  filesystem.directoryPath = path.dirname(file)
  filesystem.events = []
  Object.defineProperty(process, 'platform', { ...platformDescriptor, value: platform })
}

function persistenceOperations(platform: 'win32' | 'darwin') {
  return [
    'temp:open:wx', 'temp:write', 'temp:sync', 'temp:close', 'rename',
    `final:open:${platform === 'win32' ? 'r+' : 'r'}`, 'final:sync', 'final:close',
    ...(platform === 'win32' ? [] : ['directory:open:r', 'directory:sync', 'directory:close']),
  ]
}

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
  it('preserves legacy load on ENOENT and requires explicit first-entry creation', async () => {
    const file = await journalPath()
    await new ExecutionJournal(file, protector).load()
    await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(new ExecutionJournal(file, protector).ensureInitialized()).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_MISSING' })
    await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(['win32', 'darwin'] as const)('initializes once and preserves empty bytes/mtime across zero-job restarts on %s', async (platform) => {
    const file = await journalPath()
    trackFilesystem(file, platform)
    const first = new ExecutionJournal(file, protector)
    await first.ensureInitialized({ allowCreate: true })
    expect(filesystem.events).toEqual(persistenceOperations(platform))
    const raw = await readFile(file, 'utf8')
    const modified = (await stat(file)).mtimeMs
    expect(JSON.parse(raw)).toMatchObject({ schemaVersion: 1, records: [] })
    for (const instance of [first, new ExecutionJournal(file, protector)]) {
      filesystem.events = []
      await instance.ensureInitialized()
      expect(await instance.pendingRecords()).toEqual([])
      expect(await readFile(file, 'utf8')).toBe(raw)
      expect((await stat(file)).mtimeMs).toBe(modified)
      expect(filesystem.events).toEqual(persistenceOperations(platform).slice(5))
    }
  })

  it.each(['temp:sync', 'final:sync'])('initialization awaits %s without claiming success early', async (operation) => {
    const file = await journalPath()
    trackFilesystem(file, 'win32')
    let entered!: () => void, release!: () => void
    const waiting = new Promise<void>(resolve => { entered = resolve })
    filesystem.syncBarrier = { operation, entered, release: new Promise<void>(resolve => { release = resolve }) }
    let settled = false
    const pending = new ExecutionJournal(file, protector).ensureInitialized({ allowCreate: true }).finally(() => { settled = true })
    try {
      await Promise.race([waiting, pending])
      expect(settled).toBe(false)
    } finally { release() }
    await pending
    expect(filesystem.events).toEqual(persistenceOperations('win32'))
  })

  describe.each(['win32', 'darwin'] as const)('%s initialization fail-closed', platform => {
    it.each(['temp:open:wx', 'temp:write', 'temp:sync', 'rename',
      `final:open:${platform === 'win32' ? 'r+' : 'r'}`, 'final:sync',
      ...(platform === 'darwin' ? ['directory:sync'] : []),
    ])('rejects %s; retry performs every remaining durability barrier', async operation => {
      const initialTime = Date.now()
      const clock = vi.spyOn(Date, 'now').mockReturnValue(initialTime)
      const file = await journalPath()
      trackFilesystem(file, platform)
      const error = Object.assign(new Error('EIO: injected initialization failure'), { code: 'EIO' })
      filesystem.failure = { operation, error }
      const first = new ExecutionJournal(file, protector)
      await expect(first.ensureInitialized({ allowCreate: true })).rejects.toBe(error)
      const afterRename = operation.startsWith('final:') || operation.startsWith('directory:')
      const surviving = afterRename ? await readFile(file, 'utf8') : null
      if (!afterRename) await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' })
      // Existing bytes after a failed final sync are not a shortcut to success.
      if (operation.endsWith(':sync') && afterRename) {
        await expect(first.ensureInitialized({ allowCreate: true })).rejects.toBe(error)
      }
      filesystem.failure = undefined
      filesystem.events = []
      // Simulated restart stays in this test process. Advance the timestamp so
      // retained failed-write evidence cannot collide with its temp filename.
      clock.mockReturnValue(initialTime + 1)
      const restarted = new ExecutionJournal(file, protector)
      await restarted.ensureInitialized({ allowCreate: true })
      expect(filesystem.events).toEqual(persistenceOperations(platform).slice(afterRename ? 5 : 0))
      expect(await restarted.pendingRecords()).toEqual([])
      if (surviving) expect(await readFile(file, 'utf8')).toBe(surviving)
    })
  })

  it('never recreates missing observed history, including on an already initialized instance', async () => {
    const file = await journalPath()
    const first = new ExecutionJournal(file, protector)
    await first.ensureInitialized({ allowCreate: true })
    await unlink(file)
    await expect(first.ensureInitialized({ allowCreate: true })).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_MISSING' })
    await expect(new ExecutionJournal(file, protector).ensureInitialized()).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_MISSING' })
    await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves history that appears after cached ENOENT instead of replacing cached empty data', async () => {
    const file = await journalPath()
    const cached = new ExecutionJournal(file, protector)
    await cached.load()
    await new ExecutionJournal(file, protector).recordClaimed(job())
    const raw = await readFile(file, 'utf8')
    await cached.ensureInitialized({ allowCreate: true })
    expect(await readFile(file, 'utf8')).toBe(raw)
    expect(await cached.pendingRecords()).toMatchObject([{ jobId: job().id, state: 'CLAIMED' }])
  })

  it('does not forget observed history when its sync fails and the file subsequently disappears', async () => {
    const file = await journalPath()
    await new ExecutionJournal(file, protector).recordClaimed(job())
    trackFilesystem(file, 'win32')
    const next = new ExecutionJournal(file, protector)
    const error = Object.assign(new Error('EIO'), { code: 'EIO' })
    filesystem.failure = { operation: 'final:sync', error }
    await expect(next.ensureInitialized({ allowCreate: true })).rejects.toBe(error)
    filesystem.failure = undefined
    await unlink(file)
    await expect(next.ensureInitialized({ allowCreate: true })).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_MISSING' })
    await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('revalidates corruption after load and leaves malformed bytes untouched', async () => {
    const file = await journalPath()
    const journal = new ExecutionJournal(file, protector)
    await journal.ensureInitialized({ allowCreate: true })
    await writeFile(file, '{interrupted')
    for (const instance of [journal, new ExecutionJournal(file, protector)]) {
      await expect(instance.ensureInitialized({ allowCreate: true })).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_CORRUPT' })
      expect(await readFile(file, 'utf8')).toBe('{interrupted')
    }
  })

  it('initialization never prunes or changes claimed, UNKNOWN, terminal/reported or quarantined history', async () => {
    const file = await journalPath()
    const prior = new ExecutionJournal(file, protector)
    for (const id of ['claimed', 'unknown', 'reported', 'quarantined']) await prior.recordClaimed({ ...job(), id })
    await prior.recordExecuting({ id: 'unknown', claimAttempt: 1 }, 'CROSSING_UNKNOWN')
    const result = { state: 'SUCCEEDED' as const, resultCode: 'BYTES_SUBMITTED', effectBoundary: 'CROSSED' as const, physicalCompletionKnown: false as const }
    await prior.recordTerminal({ id: 'reported', claimAttempt: 1 }, result)
    await prior.markReported('reported', 1)
    await prior.recordTerminal({ id: 'quarantined', claimAttempt: 1 }, result)
    await prior.markQuarantined('quarantined', 1, 'CLAIM_INVALID')
    const raw = await readFile(file, 'utf8')
    const restarted = new ExecutionJournal(file, protector)
    await restarted.ensureInitialized({ allowCreate: true })
    expect(await readFile(file, 'utf8')).toBe(raw)
    expect(restarted.records()).toEqual(prior.records())
    expect((await restarted.pendingRecords()).map(record => record.jobId).sort()).toEqual(['claimed', 'unknown'])
  })

  it.each(['temp:sync', 'final:sync'])('does not resolve or advance past a pending %s', async (operation) => {
    const file = await journalPath()
    trackFilesystem(file, 'win32')
    let entered!: () => void
    let release!: () => void
    const waiting = new Promise<void>((resolve) => { entered = resolve })
    filesystem.syncBarrier = {
      operation,
      entered,
      release: new Promise<void>((resolve) => { release = resolve }),
    }
    let settled = false
    const journal = new ExecutionJournal(file, protector)
    const pending = journal.recordClaimed(job()).finally(() => { settled = true })

    try {
      await Promise.race([waiting, pending])
      expect(settled).toBe(false)
      const expected = persistenceOperations('win32')
      expect(filesystem.events).toEqual(expected.slice(0, expected.indexOf(operation) + 1))
    } finally {
      release()
    }
    await pending
    expect(filesystem.events).toEqual(persistenceOperations('win32'))
  })

  it.each(['win32', 'darwin'] as const)('waits for the complete durable write sequence on %s', async (platform) => {
    const file = await journalPath()
    trackFilesystem(file, platform)
    const journal = new ExecutionJournal(file, protector)

    await journal.recordClaimed(job())

    expect(filesystem.events).toEqual(persistenceOperations(platform))
    const raw = await readFile(file, 'utf8')
    expect(raw).not.toContain(job().claimToken)
    expect(JSON.parse(raw)).toMatchObject({
      schemaVersion: 1,
      records: [{ state: 'CLAIMED', effectBoundary: 'NOT_CROSSED', reported: false }],
    })
    filesystem.events = []
    const restarted = new ExecutionJournal(file, protector)
    expect(await restarted.pendingRecords()).toMatchObject([{ claimToken: job().claimToken }])
    expect(filesystem.events).toEqual([])
  })

  describe.each(['win32', 'darwin'] as const)('%s persistence failures', (platform) => {
    it.each([
      ['temp:sync', 'EPERM'], ['temp:sync', 'EIO'],
      ['rename', 'EPERM'], ['rename', 'EIO'],
      ['final:sync', 'EPERM'], ['final:sync', 'EIO'],
    ])('rejects %s / %s unchanged and safely reads the surviving snapshot', async (operation, code) => {
      const file = await journalPath()
      trackFilesystem(file, platform)
      const journal = new ExecutionJournal(file, protector)
      await journal.recordClaimed(job())
      const previous = await readFile(file, 'utf8')
      const error = Object.assign(new Error(`${code}: injected ${operation}`), { code })
      filesystem.events = []
      filesystem.failure = { operation, error }

      await expect(journal.recordExecuting(job(), 'CROSSING_UNKNOWN')).rejects.toBe(error)

      const expected = persistenceOperations(platform)
      const failureIndex = expected.indexOf(operation)
      expect(filesystem.events).toEqual([
        ...expected.slice(0, failureIndex + 1),
        ...(operation.endsWith(':sync') ? [operation.replace(':sync', ':close')] : []),
      ])
      const raw = await readFile(file, 'utf8')
      const replaced = operation === 'final:sync'
      if (!replaced) expect(raw).toBe(previous)
      expect(raw).not.toContain(job().claimToken)
      filesystem.failure = undefined
      filesystem.events = []
      // A rejected write can mutate the live instance. Recovery must inspect the actual file.
      const restarted = new ExecutionJournal(file, protector)
      expect(await restarted.pendingRecords()).toMatchObject([{
        jobId: job().id,
        claimAttempt: 1,
        claimToken: job().claimToken,
        state: replaced ? 'EXECUTING' : 'CLAIMED',
        effectBoundary: replaced ? 'CROSSING_UNKNOWN' : 'NOT_CROSSED',
        reported: false,
      }])
      expect(filesystem.events).toEqual([])
    })
  })

  it('rejects a final open failure after rename and recovers CROSSING_UNKNOWN', async () => {
    const file = await journalPath()
    trackFilesystem(file, 'win32')
    const journal = new ExecutionJournal(file, protector)
    await journal.recordClaimed(job())
    const error = Object.assign(new Error('EPERM: final open denied'), { code: 'EPERM' })
    filesystem.events = []
    filesystem.failure = { operation: 'final:open:r+', error }

    await expect(journal.recordExecuting(job(), 'CROSSING_UNKNOWN')).rejects.toBe(error)

    expect(filesystem.events).toEqual(persistenceOperations('win32').slice(0, 6))
    filesystem.failure = undefined
    const restarted = new ExecutionJournal(file, protector)
    expect(await restarted.pendingRecords()).toMatchObject([{
      state: 'EXECUTING', effectBoundary: 'CROSSING_UNKNOWN', reported: false,
    }])
  })

  it('still rejects a non-Windows directory fsync failure and closes its handle', async () => {
    const file = await journalPath()
    trackFilesystem(file, 'darwin')
    const error = Object.assign(new Error('EIO: directory fsync failed'), { code: 'EIO' })
    filesystem.failure = { operation: 'directory:sync', error }
    const journal = new ExecutionJournal(file, protector)

    await expect(journal.recordClaimed(job())).rejects.toBe(error)

    expect(filesystem.events).toEqual(persistenceOperations('darwin'))
    filesystem.failure = undefined
    const restarted = new ExecutionJournal(file, protector)
    expect(await restarted.pendingRecords()).toMatchObject([{
      state: 'CLAIMED', effectBoundary: 'NOT_CROSSED', reported: false,
    }])
  })

  it('keeps an unacknowledged terminal result recoverable when final fsync fails', async () => {
    const file = await journalPath()
    trackFilesystem(file, 'win32')
    const journal = new ExecutionJournal(file, protector)
    await journal.recordClaimed(job())
    await journal.recordExecuting(job(), 'CROSSING_UNKNOWN')
    const result = {
      state: 'FAILED' as const,
      resultCode: 'RUNTIME_INTERRUPTED_DURING_EXECUTION',
      effectBoundary: 'CROSSING_UNKNOWN' as const,
      physicalCompletionKnown: false as const,
    }
    const error = Object.assign(new Error('EPERM: final fsync failed'), { code: 'EPERM' })
    filesystem.failure = { operation: 'final:sync', error }

    await expect(journal.recordTerminal(job(), result)).rejects.toBe(error)

    filesystem.failure = undefined
    const restarted = new ExecutionJournal(file, protector)
    expect(await restarted.pendingRecords()).toMatchObject([{
      state: 'TERMINAL', effectBoundary: 'CROSSING_UNKNOWN', result, reported: false,
    }])
    await restarted.markReported(job().id, job().claimAttempt)
    expect(await new ExecutionJournal(file, protector).pendingRecords()).toEqual([])
  })

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
