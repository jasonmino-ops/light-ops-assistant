import { mkdir, open, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import type { TaskResult } from './types'

export type JournalRecord = {
  taskId: string
  idempotencyKey: string
  storeId: string
  state: 'ACCEPTED' | 'EXECUTING' | 'TERMINAL'
  result?: TaskResult
  reported: boolean
  updatedAt: string
}

type JournalFile = { schemaVersion: 1; records: JournalRecord[] }

async function atomicWrite(path: string, value: unknown) {
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`
  const handle = await open(temp, 'w', 0o600)
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8'); await handle.sync() } finally { await handle.close() }
  await rename(temp, path)
}

export class CloudRelayStateStore {
  readonly path: string
  private data: JournalFile = { schemaVersion: 1, records: [] }

  constructor(userDataPath: string) {
    this.path = join(userDataPath, 'field-cloud-relay', 'recovery-journal.json')
  }

  async load() {
    await mkdir(join(this.path, '..'), { recursive: true, mode: 0o700 })
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8')) as Partial<JournalFile>
      if (value.schemaVersion === 1 && Array.isArray(value.records)) this.data = { schemaVersion: 1, records: value.records as JournalRecord[] }
    } catch { this.data = { schemaVersion: 1, records: [] } }
  }

  records() { return this.data.records.map((record) => ({ ...record, result: record.result ? { ...record.result } : undefined })) }

  async recordAccepted(input: { taskId: string; idempotencyKey: string; storeId: string }) {
    await this.upsert({ ...input, state: 'ACCEPTED', reported: false, updatedAt: new Date().toISOString() })
  }

  async recordExecuting(input: { taskId: string; idempotencyKey: string; storeId: string }) {
    await this.upsert({ ...input, state: 'EXECUTING', reported: false, updatedAt: new Date().toISOString() })
  }

  async recordTerminal(input: { taskId: string; idempotencyKey: string; storeId: string; result: TaskResult }) {
    await this.upsert({ ...input, state: 'TERMINAL', result: input.result, reported: false, updatedAt: new Date().toISOString() })
  }

  async markReported(taskId: string) {
    const record = this.data.records.find((entry) => entry.taskId === taskId)
    if (!record) return
    record.reported = true
    record.updatedAt = new Date().toISOString()
    await this.save()
  }

  private async upsert(record: JournalRecord) {
    const index = this.data.records.findIndex((entry) => entry.taskId === record.taskId)
    if (index >= 0) this.data.records[index] = record
    else this.data.records.push(record)
    this.data.records = this.data.records.slice(-500)
    await this.save()
  }

  private async save() {
    await mkdir(join(this.path, '..'), { recursive: true, mode: 0o700 })
    await atomicWrite(this.path, this.data)
  }
}
