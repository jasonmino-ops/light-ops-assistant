import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import {
  ESHOP_TRAY_QUEUE_NAME,
  PrintDeliveryError,
  WindowsQueueTransport,
  type SpawnPrintProcess,
} from '../src/printing/windowsQueueTransport'

type FakeProcess = ChildProcessWithoutNullStreams & EventEmitter

function fakeSpawn(onInput: (input: string, args: readonly string[]) => void, delayMs = 0): SpawnPrintProcess {
  return (_command, args) => {
    const child = new EventEmitter() as FakeProcess
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    child.stdin = stdin
    child.stdout = stdout
    child.stderr = stderr
    child.kill = (() => true) as FakeProcess['kill']
    let input = ''
    stdin.setEncoding('utf8')
    stdin.on('data', (chunk: string) => { input += chunk })
    stdin.on('finish', () => {
      onInput(input, args)
      setTimeout(() => {
        stdout.end(JSON.stringify({ ok: true, bytesWritten: Buffer.from(input, 'base64').byteLength }))
        child.emit('close', 0)
      }, delayMs)
    })
    return child
  }
}

describe('fixed Windows queue transport', () => {
  it('passes the exact bytes to the single frozen queue without a shell', async () => {
    const original = Uint8Array.from([0x1b, 0x40, 0, 255, 0x1d, 0x56, 0])
    let received: Uint8Array | undefined
    let receivedArgs: readonly string[] = []
    const transport = new WindowsQueueTransport({
      platform: 'win32',
      scriptPath: 'C:\\Program Files\\E-Shop Tray\\Write-RawPrint.ps1',
      spawnProcess: fakeSpawn((input, args) => {
        received = Uint8Array.from(Buffer.from(input, 'base64'))
        receivedArgs = args
      }),
    })
    const result = await transport.deliver(original, 'test')
    expect(received).toEqual(original)
    expect(receivedArgs).toContain(ESHOP_TRAY_QUEUE_NAME)
    expect(result).toMatchObject({ transport: 'windows-queue', bytesWritten: original.byteLength })
  })

  it('is Windows-only and rejects concurrent requests rather than creating a task queue', async () => {
    const nonWindows = new WindowsQueueTransport({ scriptPath: 'unused', platform: 'darwin' })
    await expect(nonWindows.deliver(Uint8Array.from([1]), 'test')).rejects.toMatchObject({
      code: 'WINDOWS_REQUIRED',
    } satisfies Partial<PrintDeliveryError>)

    const transport = new WindowsQueueTransport({
      platform: 'win32',
      scriptPath: 'write.ps1',
      spawnProcess: fakeSpawn(() => {}, 25),
    })
    const first = transport.deliver(Uint8Array.from([1]), 'first')
    await expect(transport.deliver(Uint8Array.from([2]), 'second')).rejects.toMatchObject({ code: 'TRAY_BUSY' })
    await first
  })
})
