import { mkdir, open, readFile, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  StoreRuntimeJournalRecord,
  StoreRuntimePrinterBinding,
  StoreRuntimeTaskResult,
} from './types'

const MAX_JOURNAL_RECORDS = 500

type StoreRuntimeLocalState = {
  schemaVersion: 1
  binding: StoreRuntimePrinterBinding | null
  records: StoreRuntimeJournalRecord[]
  updatedAt: string
}

function initialState(): StoreRuntimeLocalState {
  return { schemaVersion: 1, binding: null, records: [], updatedAt: new Date().toISOString() }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseState(raw: string): StoreRuntimeLocalState | null {
  try {
    const value = JSON.parse(raw) as unknown
    if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.records)) return null
    const records: StoreRuntimeJournalRecord[] = []
    for (const entry of value.records) {
      if (!isRecord(entry)) return null
      if (
        typeof entry.taskId !== 'string' ||
        typeof entry.idempotencyKey !== 'string' ||
        typeof entry.storeId !== 'string' ||
        !['ACCEPTED', 'EXECUTING', 'TERMINAL'].includes(String(entry.state)) ||
        typeof entry.reported !== 'boolean' ||
        typeof entry.updatedAt !== 'string'
      ) return null
      records.push(entry as unknown as StoreRuntimeJournalRecord)
    }
    const binding = value.binding === null || isRecord(value.binding)
      ? value.binding as StoreRuntimePrinterBinding | null
      : null
    return {
      schemaVersion: 1,
      binding,
      records: records.slice(-MAX_JOURNAL_RECORDS),
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
    }
  } catch {
    return null
  }
}

async function atomicWrite(path: string, value: StoreRuntimeLocalState) {
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`
  const handle = await open(temp, 'w', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temp, path)
}

export class StoreRuntimeStateStore {
  readonly path: string
  private state = initialState()
  private loaded = false

  constructor(userDataDir: string) {
    this.path = join(userDataDir, 'store-runtime', 'state.json')
  }

  async load() {
    if (this.loaded) return
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    try {
      const parsed = parseState(await readFile(this.path, 'utf8'))
      if (parsed) this.state = parsed
      else await rename(this.path, `${this.path}.corrupt-${Date.now()}`)
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : ''
      if (code !== 'ENOENT') throw error
    }
    this.loaded = true
  }

  binding(): StoreRuntimePrinterBinding | null {
    return this.state.binding ? { ...this.state.binding } : null
  }

  records(): StoreRuntimeJournalRecord[] {
    return this.state.records.map((record) => ({ ...record, result: record.result ? { ...record.result } : undefined }))
  }

  async setBinding(binding: StoreRuntimePrinterBinding | null) {
    await this.load()
    this.state.binding = binding ? { ...binding } : null
    await this.persist()
  }

  async recordAccepted(input: { taskId: string; idempotencyKey: string; storeId: string }) {
    await this.upsert({ ...input, state: 'ACCEPTED', reported: false, updatedAt: new Date().toISOString() })
  }

  async recordExecuting(input: { taskId: string; idempotencyKey: string; storeId: string }) {
    await this.upsert({ ...input, state: 'EXECUTING', reported: false, updatedAt: new Date().toISOString() })
  }

  async recordTerminal(input: {
    taskId: string
    idempotencyKey: string
    storeId: string
    result: StoreRuntimeTaskResult
  }) {
    await this.upsert({ ...input, state: 'TERMINAL', reported: false, updatedAt: new Date().toISOString() })
  }

  async markReported(taskId: string) {
    await this.load()
    const record = this.state.records.find((entry) => entry.taskId === taskId)
    if (!record) return
    record.reported = true
    record.updatedAt = new Date().toISOString()
    await this.persist()
  }

  private async upsert(record: StoreRuntimeJournalRecord) {
    await this.load()
    const index = this.state.records.findIndex((entry) => entry.taskId === record.taskId)
    if (index >= 0) this.state.records[index] = record
    else this.state.records.push(record)
    this.state.records = this.state.records
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .slice(-MAX_JOURNAL_RECORDS)
    await this.persist()
  }

  private async persist() {
    this.state.updatedAt = new Date().toISOString()
    await atomicWrite(this.path, this.state)
  }
}
