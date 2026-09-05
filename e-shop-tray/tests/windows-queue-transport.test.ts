import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import {
  ESHOP_TRAY_QUEUE_NAME,
  PrintDeliveryError,
  WindowsQueueTransport,
} from '../src/printing/windowsQueueTransport'

function fakeProcess(result: { code: number; stdout?: string; stderr?: string }) {
  const emitter = new EventEmitter()
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  stdin.on('finish', () => {
    setImmediate(() => {
      if (result.stdout) stdout.write(result.stdout)
      if (result.stderr) stderr.write(result.stderr)
      emitter.emit('close', result.code)
    })
  })
  return Object.assign(emitter, {
    stdin,
    stdout,
    stderr,
    kill: vi.fn(),
  }) as unknown as ChildProcessWithoutNullStreams
}

describe('fixed Windows RAW queue transport regression', () => {
  it('keeps the existing 前台 / Write-RawPrint.ps1 path and honest success boundary', async () => {
    const args: Array<readonly string[]> = []
    const transport = new WindowsQueueTransport({
      platform: 'win32',
      scriptPath: 'C:\\Program Files\\E-Shop Tray\\resources\\Write-RawPrint.ps1',
      spawnProcess: (_command, actualArgs) => {
        args.push(actualArgs)
        return fakeProcess({ code: 0, stdout: JSON.stringify({ ok: true, bytesWritten: 2 }) })
      },
    })
    const result = await transport.deliver(Uint8Array.from([0x1b, 0x40]), 'receipt')
    expect(ESHOP_TRAY_QUEUE_NAME).toBe('前台')
    expect(args[0].some((value) => value.endsWith('Write-RawPrint.ps1'))).toBe(true)
    expect(args[0]).toContain('前台')
    expect(result).toMatchObject({ effectBoundary: 'CROSSED', physicalCompletionKnown: false, bytesWritten: 2 })
  })

  it('does not call PowerShell for invalid preconditions', async () => {
    const spawnProcess = vi.fn()
    const transport = new WindowsQueueTransport({ platform: 'darwin', scriptPath: 'unused', spawnProcess })
    await expect(transport.deliver(Uint8Array.from([1]), 'receipt')).rejects.toMatchObject({
      code: 'WINDOWS_REQUIRED',
      effectBoundary: 'NOT_CROSSED',
    })
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('classifies process failure after spawn as CROSSING_UNKNOWN', async () => {
    const transport = new WindowsQueueTransport({
      platform: 'win32',
      scriptPath: 'Write-RawPrint.ps1',
      spawnProcess: () => fakeProcess({ code: 1, stderr: 'WritePrinter failed' }),
    })
    await expect(transport.deliver(Uint8Array.from([1]), 'receipt')).rejects.toEqual(expect.objectContaining({
      code: 'PRINT_DELIVERY_FAILED',
      effectBoundary: 'CROSSING_UNKNOWN',
    } satisfies Partial<PrintDeliveryError>))
  })
})
