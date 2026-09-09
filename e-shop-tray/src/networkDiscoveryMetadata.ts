import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { TextDecoder } from 'node:util'

const MAX_READS = 130
const MAX_LINE_BYTES = 1024 * 1024
const READ_TIMEOUT_MS = 5_000
const LIFETIME_MS = 45_000
const CLOSE_TIMEOUT_MS = 1_000
const EOF_TIMEOUT_MS = 500

export interface WindowsMetadataReader {
  read(signal?: AbortSignal): Promise<unknown>
  close(): Promise<void>
}

function failure(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code })
}

function abortCode(signal?: AbortSignal): string {
  const reason: unknown = signal?.reason
  return reason instanceof Error && reason.name === 'NetworkDiscoveryError'
    && reason.message === 'NETWORK_DISCOVERY_DEADLINE'
    && (reason as Error & { code?: unknown }).code === 'NETWORK_DISCOVERY_DEADLINE'
    ? 'NETWORK_DISCOVERY_DEADLINE' : 'NETWORK_DISCOVERY_CANCELLED'
}

/** Internal, scan-scoped reader. command is the fixed read-only metadata script
 * from networkDiscovery, never UI input. Only the PowerShell process is reused:
 * every SNAPSHOT request executes that script again, including its route reads. */
export function createWindowsMetadataReader(command: string, dependencies: {
  platform?: () => string
  spawn?: typeof spawn
} = {}): WindowsMetadataReader {
  if ((dependencies.platform?.() ?? process.platform) !== 'win32') throw failure('NETWORK_WINDOWS_REQUIRED')
  const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
function Read-EshopNetworkMetadata {
${command}
}
try {
  for ($requestNumber = 1; $requestNumber -le ${MAX_READS}; $requestNumber++) {
    $request = [Console]::ReadLine()
    if ($null -eq $request) { exit 0 }
    if ($request -cne ('SNAPSHOT' + $requestNumber)) { throw 'INVALID_REQUEST' }
    $json = Read-EshopNetworkMetadata
    if ($json -isnot [string] -or $json.Contains([char]10) -or $json.Contains([char]13)) { throw 'INVALID_METADATA' }
    $line = $request + [char]9 + $json
    if ([System.Text.Encoding]::UTF8.GetByteCount($line) + 2 -gt ${MAX_LINE_BYTES}) { throw 'METADATA_LIMIT' }
    [Console]::WriteLine($line)
    [Console]::Out.Flush()
  }
  if ($null -ne [Console]::ReadLine()) { throw 'READ_LIMIT' }
} catch { exit 1 }
`.trim()
  let child: ChildProcessWithoutNullStreams
  try {
    child = (dependencies.spawn ?? spawn)('powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, shell: false, stdio: 'pipe' })
  } catch { throw failure('NETWORK_METADATA_UNAVAILABLE') }

  let count = 0, totalBytes = 0
  let buffer = Buffer.alloc(0)
  let terminalCode: string | undefined
  let faultCode: string | undefined
  let exited = false, closed = false
  let gracefulClose = false, killRequested = false
  let cleanup: Promise<boolean> | undefined
  let cleanupDone: ((closed: boolean) => void) | undefined
  let eofTimer: ReturnType<typeof setTimeout> | undefined
  let lifetime: ReturnType<typeof setTimeout> | undefined
  let pending: {
    id: string
    resolve(value: unknown): void
    reject(error: Error): void
    timer: ReturnType<typeof setTimeout>
    signal?: AbortSignal
    abort(): void
  } | undefined

  function cleanPending() {
    const current = pending
    pending = undefined
    if (current) {
      clearTimeout(current.timer)
      current.signal?.removeEventListener('abort', current.abort)
    }
    return current
  }

  function killChild(): void {
    clearTimeout(eofTimer)
    if (closed || exited || killRequested) return
    killRequested = true
    try { child.stdin.destroy() } catch { /* termination below still runs */ }
    try { child.kill('SIGKILL') } catch { /* close deadline reports failure */ }
  }

  // Normal cleanup sends EOF: a successful exit is unambiguously code 0 with no
  // signal. Faults kill only this owned child. A forced or unobserved shutdown
  // never counts as successful normal cleanup, even when kill() returns true.
  function cleanChild(normalClose: boolean): Promise<boolean> {
    if (cleanup) {
      if (!normalClose) killChild()
      return cleanup
    }
    if (closed) return cleanup = Promise.resolve(true)
    cleanup = new Promise(resolve => {
      const timer = setTimeout(() => { cleanupDone = undefined; resolve(false) }, CLOSE_TIMEOUT_MS)
      cleanupDone = value => {
        clearTimeout(timer); clearTimeout(eofTimer); cleanupDone = undefined; resolve(value)
      }
    })
    if (normalClose && !exited) {
      gracefulClose = true
      eofTimer = setTimeout(() => {
        void stop('NETWORK_METADATA_CLEANUP_FAILED')
      }, EOF_TIMEOUT_MS)
      try { child.stdin.end() } catch { void stop('NETWORK_METADATA_UNAVAILABLE') }
    } else killChild()
    return cleanup
  }

  function stop(code: string, normalClose = false): Promise<boolean> {
    terminalCode ??= code
    if (!normalClose) faultCode ??= code
    clearTimeout(lifetime)
    buffer = Buffer.alloc(0)
    const current = cleanPending()
    const done = cleanChild(normalClose)
    if (current) void done.then(terminated => current.reject(failure(terminated
      ? faultCode ?? terminalCode! : 'NETWORK_METADATA_CLEANUP_FAILED')))
    return done
  }

  const processFault = () => { if (!closed) void stop('NETWORK_METADATA_UNAVAILABLE') }
  child.on('error', processFault)
  child.on('exit', (code, signal) => {
    if (closed) return
    exited = true
    if (!gracefulClose || code !== 0 || signal !== null) void stop('NETWORK_METADATA_UNAVAILABLE')
  })
  child.on('close', (code, signal) => {
    if (closed) return
    const normalExit = gracefulClose && exited && code === 0 && signal === null
    closed = true
    if (!normalExit) void stop('NETWORK_METADATA_UNAVAILABLE')
    cleanupDone?.(true)
  })
  for (const stream of [child.stdin, child.stdout, child.stderr]) {
    stream.on('error', processFault)
  }
  child.stderr.on('data', processFault)
  child.stdout.on('end', () => { if (!gracefulClose) processFault() })
  child.stdout.on('data', (chunk: Buffer | string) => {
    if (closed) return
    if (terminalCode) { void stop('NETWORK_METADATA_INVALID'); return }
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8')
    totalBytes += bytes.length
    if (totalBytes > MAX_READS * MAX_LINE_BYTES || buffer.length + bytes.length > MAX_LINE_BYTES) {
      void stop('NETWORK_METADATA_LIMIT'); return
    }
    if (!pending) { void stop('NETWORK_METADATA_INVALID'); return }
    buffer = Buffer.concat([buffer, bytes])
    const newline = buffer.indexOf(10)
    if (newline === -1) return
    // No queued frames or trailing fragments can carry over to the next read.
    if (newline !== buffer.length - 1) { void stop('NETWORK_METADATA_INVALID'); return }
    try {
      const line = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, newline)).replace(/\r$/, '')
      const prefix = `${pending.id}\t`
      if (!line.startsWith(prefix)) throw failure('NETWORK_METADATA_INVALID')
      const metadata: unknown = JSON.parse(line.slice(prefix.length))
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw failure('NETWORK_METADATA_INVALID')
      buffer = Buffer.alloc(0)
      cleanPending()!.resolve(metadata)
    } catch { void stop('NETWORK_METADATA_INVALID') }
  })
  lifetime = setTimeout(() => { void stop('NETWORK_METADATA_UNAVAILABLE') }, LIFETIME_MS)

  return {
    async read(signal) {
      if (terminalCode || pending || count >= MAX_READS || signal?.aborted) {
        const code = terminalCode ?? (signal?.aborted ? abortCode(signal)
          : count >= MAX_READS ? 'NETWORK_METADATA_LIMIT' : 'NETWORK_METADATA_UNAVAILABLE')
        const terminated = await stop(code)
        throw failure(terminated ? faultCode ?? terminalCode! : 'NETWORK_METADATA_CLEANUP_FAILED')
      }
      return new Promise((resolve, reject) => {
        const id = `SNAPSHOT${++count}`
        const abort = () => { void stop(abortCode(signal)) }
        pending = { id, resolve, reject, signal, abort,
          timer: setTimeout(() => { void stop('NETWORK_METADATA_UNAVAILABLE') }, READ_TIMEOUT_MS) }
        signal?.addEventListener('abort', abort, { once: true })
        if (signal?.aborted) { abort(); return }
        try {
          child.stdin.write(`${id}\n`, error => { if (error) void stop('NETWORK_METADATA_UNAVAILABLE') })
        } catch { void stop('NETWORK_METADATA_UNAVAILABLE') }
      })
    },
    async close() {
      if (!await stop('NETWORK_METADATA_UNAVAILABLE', true)) throw failure('NETWORK_METADATA_CLEANUP_FAILED')
      // A final valid response does not excuse a protocol/process failure that
      // arrives before the caller finishes its scan and awaits this cleanup.
      if (faultCode) throw failure(faultCode)
    },
  }
}
