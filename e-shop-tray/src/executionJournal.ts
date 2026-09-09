import { mkdir, open, readFile, rename } from 'node:fs/promises'
import path from 'node:path'
import type { ReceivedPrintJob, RelayEffectBoundary, TerminalResult } from './cloudRelayClient'

const MAX_RETAINED_RECORDS = 500

export type ClaimTokenProtector = {
  protect(value: string): string
  unprotect(value: string): string
}

export type JournalState = 'CLAIMED' | 'EXECUTING' | 'TERMINAL' | 'ABANDONED' | 'QUARANTINED'

export type JournalRecord = {
  jobId: string
  claimAttempt: number
  protectedClaimToken: string
  leaseExpiresAt: string
  state: JournalState
  effectBoundary: RelayEffectBoundary
  result?: TerminalResult
  ackErrorCode?: string
  reported: boolean
  createdAt: string
  updatedAt: string
}

export type RecoveredJournalRecord = JournalRecord & { claimToken: string }

type JournalFile = {
  schemaVersion: 1
  records: JournalRecord[]
  updatedAt: string
}

export class ExecutionJournalError extends Error {
  constructor(public readonly code: string, options?: { cause?: unknown }) {
    super(code, options)
    this.name = 'ExecutionJournalError'
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function validResult(value: unknown): value is TerminalResult {
  const result = object(value)
  if (!result) return false
  return (result.state === 'SUCCEEDED' || result.state === 'FAILED')
    && typeof result.resultCode === 'string'
    && (result.resultMessage === undefined || typeof result.resultMessage === 'string')
    && ['NOT_CROSSED', 'CROSSING_UNKNOWN', 'CROSSED'].includes(String(result.effectBoundary))
    && result.physicalCompletionKnown === false
}

function parseJournal(raw: string): JournalFile {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (cause) {
    throw new ExecutionJournalError('EXECUTION_JOURNAL_CORRUPT', { cause })
  }
  const file = object(value)
  if (file?.schemaVersion !== 1 || !Array.isArray(file.records) || typeof file.updatedAt !== 'string') {
    throw new ExecutionJournalError('EXECUTION_JOURNAL_CORRUPT')
  }
  const records: JournalRecord[] = []
  for (const entryValue of file.records) {
    const entry = object(entryValue)
    if (
      !entry
      || typeof entry.jobId !== 'string'
      || !Number.isSafeInteger(entry.claimAttempt)
      || Number(entry.claimAttempt) < 1
      || typeof entry.protectedClaimToken !== 'string'
      || entry.protectedClaimToken.length < 1
      || entry.protectedClaimToken.length > 2048
      || typeof entry.leaseExpiresAt !== 'string'
      || !Number.isFinite(Date.parse(entry.leaseExpiresAt))
      || !['CLAIMED', 'EXECUTING', 'TERMINAL', 'ABANDONED', 'QUARANTINED'].includes(String(entry.state))
      || !['NOT_CROSSED', 'CROSSING_UNKNOWN', 'CROSSED'].includes(String(entry.effectBoundary))
      || typeof entry.reported !== 'boolean'
      || typeof entry.createdAt !== 'string'
      || typeof entry.updatedAt !== 'string'
      || ((entry.state === 'TERMINAL' || entry.state === 'QUARANTINED') && !validResult(entry.result))
      || (entry.state === 'QUARANTINED' && (
        typeof entry.ackErrorCode !== 'string'
        || !/^[A-Z0-9_:-]{3,160}$/.test(entry.ackErrorCode)
      ))
    ) throw new ExecutionJournalError('EXECUTION_JOURNAL_CORRUPT')
    records.push(entryValue as JournalRecord)
  }
  return { schemaVersion: 1, records, updatedAt: file.updatedAt }
}

function recordKey(record: Pick<JournalRecord, 'jobId' | 'claimAttempt'>) {
  return `${record.jobId}:${record.claimAttempt}`
}

export class ExecutionJournal {
  private file: JournalFile = { schemaVersion: 1, records: [], updatedAt: new Date(0).toISOString() }
  private loaded = false
  private initializationObservedFile = false

  constructor(
    public readonly filePath: string,
    private readonly protector: ClaimTokenProtector,
  ) {}

  async load() {
    if (this.loaded) return
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 })
    try {
      this.file = parseJournal(await readFile(this.filePath, 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    this.loaded = true
  }

  // Candidate first-entry only, under its existing single-instance lock. The
  // caller must establish absence of runtime history before allowing creation.
  // Unlike load(), this explicitly completes durability before returning.
  async ensureInitialized({ allowCreate = false }: { allowCreate?: boolean } = {}) {
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 })
    let existing: JournalFile
    try {
      // Never use a cached empty snapshot to replace a file that appeared, or
      // conceal corruption/deletion since an earlier observation.
      const raw = await readFile(this.filePath, 'utf8')
      this.initializationObservedFile = true
      existing = parseJournal(raw)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      if (!allowCreate || this.loaded || this.initializationObservedFile) {
        throw new ExecutionJournalError('EXECUTION_JOURNAL_MISSING', { cause: error })
      }
      await this.persist()
      this.loaded = true
      return
    }
    // A previous initialization may have stopped after rename but before the
    // final sync. Finish that barrier without rewriting/pruning existing bytes.
    await this.syncPersistedFile()
    this.file = existing
    this.loaded = true
  }

  records(): JournalRecord[] {
    return this.file.records.map((record) => ({
      ...record,
      ...(record.result ? { result: { ...record.result } } : {}),
    }))
  }

  async pendingRecords(): Promise<RecoveredJournalRecord[]> {
    await this.load()
    return this.file.records
      .filter((record) => !record.reported && record.state !== 'ABANDONED' && record.state !== 'QUARANTINED')
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((record) => {
        try {
          return { ...record, claimToken: this.protector.unprotect(record.protectedClaimToken) }
        } catch (cause) {
          throw new ExecutionJournalError('EXECUTION_JOURNAL_TOKEN_UNAVAILABLE', { cause })
        }
      })
  }

  async recordClaimed(job: ReceivedPrintJob) {
    const now = new Date().toISOString()
    await this.upsert({
      jobId: job.id,
      claimAttempt: job.claimAttempt,
      protectedClaimToken: this.protector.protect(job.claimToken),
      leaseExpiresAt: job.leaseExpiresAt,
      state: 'CLAIMED',
      effectBoundary: 'NOT_CROSSED',
      reported: false,
      createdAt: now,
      updatedAt: now,
    })
  }

  async recordExecuting(job: Pick<ReceivedPrintJob, 'id' | 'claimAttempt'>, effectBoundary: 'NOT_CROSSED' | 'CROSSING_UNKNOWN') {
    await this.mutate(job.id, job.claimAttempt, (record) => ({
      ...record,
      state: 'EXECUTING',
      effectBoundary,
      updatedAt: new Date().toISOString(),
    }))
  }

  async recordTerminal(
    job: Pick<ReceivedPrintJob, 'id' | 'claimAttempt'>,
    result: TerminalResult,
  ) {
    await this.mutate(job.id, job.claimAttempt, (record) => ({
      ...record,
      state: 'TERMINAL',
      effectBoundary: result.effectBoundary,
      result: { ...result },
      reported: false,
      updatedAt: new Date().toISOString(),
    }))
  }

  async markReported(jobId: string, claimAttempt: number) {
    await this.mutate(jobId, claimAttempt, (record) => ({
      ...record,
      reported: true,
      updatedAt: new Date().toISOString(),
    }))
  }

  async markAbandoned(jobId: string, claimAttempt: number) {
    await this.mutate(jobId, claimAttempt, (record) => ({
      ...record,
      state: 'ABANDONED',
      reported: true,
      updatedAt: new Date().toISOString(),
    }))
  }

  async markQuarantined(jobId: string, claimAttempt: number, ackErrorCode: string) {
    await this.mutate(jobId, claimAttempt, (record) => ({
      ...record,
      state: 'QUARANTINED',
      ackErrorCode,
      reported: true,
      updatedAt: new Date().toISOString(),
    }))
  }

  private async mutate(
    jobId: string,
    claimAttempt: number,
    change: (record: JournalRecord) => JournalRecord,
  ) {
    await this.load()
    const index = this.file.records.findIndex((record) => record.jobId === jobId && record.claimAttempt === claimAttempt)
    if (index < 0) throw new ExecutionJournalError('EXECUTION_JOURNAL_RECORD_NOT_FOUND')
    this.file.records[index] = change(this.file.records[index])
    await this.persist()
  }

  private async upsert(record: JournalRecord) {
    await this.load()
    const key = recordKey(record)
    const index = this.file.records.findIndex((item) => recordKey(item) === key)
    if (index >= 0) this.file.records[index] = record
    else this.file.records.push(record)
    await this.persist()
  }

  private async persist() {
    const unreported = this.file.records.filter((record) => !record.reported)
    const retained = this.file.records
      .filter((record) => record.reported)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, Math.max(0, MAX_RETAINED_RECORDS - unreported.length))
    this.file.records = [...unreported, ...retained]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    this.file.updatedAt = new Date().toISOString()

    const tempPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`
    const handle = await open(tempPath, 'wx', 0o600)
    try {
      await handle.writeFile(`${JSON.stringify(this.file)}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(tempPath, this.filePath)
    await this.syncPersistedFile()
  }

  private async syncPersistedFile() {
    // Windows fsync requires a writable handle. Keep both durability barriers;
    // an open/sync failure must still reject before any print side effect.
    const finalHandle = await open(this.filePath, process.platform === 'win32' ? 'r+' : 'r')
    try {
      await finalHandle.sync()
    } finally {
      await finalHandle.close()
    }
    if (process.platform !== 'win32') {
      const directoryHandle = await open(path.dirname(this.filePath), 'r')
      try {
        await directoryHandle.sync()
      } finally {
        await directoryHandle.close()
      }
    }
  }
}
