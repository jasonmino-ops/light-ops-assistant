import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

export const ESHOP_TRAY_QUEUE_NAME = '前台' as const
export const ESHOP_TRAY_MAX_COMMAND_BYTES = 8 * 1024 * 1024

export type PrintDelivery = {
  bytesWritten: number
  durationMs: number
  transport: 'windows-queue'
}

export class PrintDeliveryError extends Error {
  constructor(
    public readonly code:
      | 'TRAY_BUSY'
      | 'WINDOWS_REQUIRED'
      | 'INVALID_COMMAND_STREAM'
      | 'PRINT_TIMEOUT'
      | 'PRINT_DELIVERY_FAILED',
    options?: { cause?: unknown },
  ) {
    super(code, options)
    this.name = 'PrintDeliveryError'
  }
}

export type SpawnPrintProcess = (
  command: string,
  args: readonly string[],
) => ChildProcessWithoutNullStreams

export class WindowsQueueTransport {
  private busy = false

  constructor(private readonly options: {
    scriptPath: string
    platform?: NodeJS.Platform
    timeoutMs?: number
    spawnProcess?: SpawnPrintProcess
  }) {}

  isBusy(): boolean {
    return this.busy
  }

  async deliver(commandStream: Uint8Array, documentName: string): Promise<PrintDelivery> {
    if (this.busy) throw new PrintDeliveryError('TRAY_BUSY')
    if ((this.options.platform ?? process.platform) !== 'win32') {
      throw new PrintDeliveryError('WINDOWS_REQUIRED')
    }
    if (
      !(commandStream instanceof Uint8Array)
      || commandStream.byteLength === 0
      || commandStream.byteLength > ESHOP_TRAY_MAX_COMMAND_BYTES
    ) {
      throw new PrintDeliveryError('INVALID_COMMAND_STREAM')
    }

    this.busy = true
    const startedAt = Date.now()
    try {
      const bytesWritten = await this.writeWithPowerShell(commandStream, documentName)
      return {
        bytesWritten,
        durationMs: Date.now() - startedAt,
        transport: 'windows-queue',
      }
    } finally {
      this.busy = false
    }
  }

  private writeWithPowerShell(commandStream: Uint8Array, documentName: string): Promise<number> {
    const spawnProcess = this.options.spawnProcess ?? ((command, args) => spawn(command, args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    }))
    const child = spawnProcess('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      this.options.scriptPath,
      '-PrinterName',
      ESHOP_TRAY_QUEUE_NAME,
      '-DocumentName',
      documentName.slice(0, 96),
    ])
    const timeoutMs = this.options.timeoutMs ?? 20_000

    return new Promise<number>((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      let settled = false
      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        callback()
      }
      const timer = setTimeout(() => {
        child.kill()
        finish(() => reject(new PrintDeliveryError('PRINT_TIMEOUT')))
      }, timeoutMs)

      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        stdout = (stdout + chunk).slice(-4096)
      })
      child.stderr.on('data', (chunk: string) => {
        stderr = (stderr + chunk).slice(-4096)
      })
      child.once('error', (cause) => {
        finish(() => reject(new PrintDeliveryError('PRINT_DELIVERY_FAILED', { cause })))
      })
      child.once('close', (code) => {
        finish(() => {
          if (code !== 0) {
            reject(new PrintDeliveryError('PRINT_DELIVERY_FAILED', {
              cause: new Error(stderr.trim() || `PowerShell exited with ${code}`),
            }))
            return
          }
          try {
            const result = JSON.parse(stdout.trim()) as { ok?: unknown; bytesWritten?: unknown }
            if (
              result.ok !== true
              || !Number.isInteger(result.bytesWritten)
              || Number(result.bytesWritten) !== commandStream.byteLength
            ) {
              throw new Error('INVALID_PRINT_RESULT')
            }
            resolve(Number(result.bytesWritten))
          } catch (cause) {
            reject(new PrintDeliveryError('PRINT_DELIVERY_FAILED', { cause }))
          }
        })
      })

      child.stdin.end(Buffer.from(commandStream).toString('base64'))
    })
  }
}
