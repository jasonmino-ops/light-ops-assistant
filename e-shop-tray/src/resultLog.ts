import { appendFile, mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_MAX_LOG_BYTES = 1024 * 1024

export type RelayLogEvent = {
  event: string
  jobId?: string
  claimAttempt?: number
  status?: string
  resultCode?: string
  effectBoundary?: string
  commandBytes?: number
  bytesWritten?: number
  durationMs?: number
}

export type RelayEventRecorder = { record(event: RelayLogEvent): Promise<void> }

/** Bounded operational evidence. Credentials and claim tokens are never accepted. */
export class RelayResultLog implements RelayEventRecorder {
  constructor(
    public readonly filePath: string,
    private readonly maxBytes = DEFAULT_MAX_LOG_BYTES,
  ) {}

  async record(event: RelayLogEvent): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 })
    const line = `${JSON.stringify({ at: new Date().toISOString(), productionContract: true, ...event })}\n`
    let currentBytes = 0
    try {
      currentBytes = (await stat(this.filePath)).size
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (currentBytes + Buffer.byteLength(line) > this.maxBytes) {
      await writeFile(this.filePath, line, { encoding: 'utf8', mode: 0o600 })
      return
    }
    await appendFile(this.filePath, line, { encoding: 'utf8', mode: 0o600 })
  }
}
