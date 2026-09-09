import { EventEmitter } from 'node:events'
import type { ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWindowsMetadataReader } from '../src/networkDiscoveryMetadata'

// Only the process boundary is fake. The real reader handles all framing,
// correlation, cancellation, deadlines and owned-process cleanup below.
class FakeChild extends EventEmitter {
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  requests: string[] = []
  autoClose = true
  kill = vi.fn((_signal?: string) => {
    if (this.autoClose) queueMicrotask(() => this.finish())
    return true
  })
  constructor() {
    super()
    this.stdin.on('data', chunk => this.requests.push(String(chunk)))
    this.stdin.on('finish', () => { if (this.autoClose) queueMicrotask(() => this.finish()) })
  }
  finish() { this.emit('exit', 0, null); this.emit('close', 0, null) }
  reply(id = this.requests.at(-1)?.trim(), value: unknown = { routes: [] }) {
    this.stdout.write(`${id}\t${JSON.stringify(value)}\r\n`)
  }
}

const FIXED_COMMAND = '$metadata = @{ routes = @(Get-NetRoute -AddressFamily IPv4 -PolicyStore ActiveStore) }; $metadata | ConvertTo-Json -Compress'
function setup() {
  const child = new FakeChild()
  const spawnChild = vi.fn(() => child as unknown as ChildProcessWithoutNullStreams)
  const reader = createWindowsMetadataReader(FIXED_COMMAND, { platform: () => 'win32', spawn: spawnChild as unknown as typeof spawn })
  return { child, reader, spawnChild }
}

afterEach(() => vi.useRealTimers())

describe('scan-scoped Windows metadata process', () => {
  it('starts one constant command without a shell and executes the read-only script inside every exact request', async () => {
    const { child, reader, spawnChild } = setup()
    const [executable, args, options] = (spawnChild.mock.calls as unknown[][])[0]
    expect(executable).toBe('powershell.exe')
    expect(options).toEqual({ windowsHide: true, shell: false, stdio: 'pipe' })
    expect((args as string[]).slice(0, 4)).toEqual(['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand'])
    const script = Buffer.from((args as string[])[4], 'base64').toString('utf16le')
    expect(script).toContain(`function Read-EshopNetworkMetadata {\n${FIXED_COMMAND}\n}`)
    expect(script).toContain('for ($requestNumber = 1; $requestNumber -le 130; $requestNumber++)')
    expect(script.indexOf('$json = Read-EshopNetworkMetadata')).toBeGreaterThan(script.indexOf('for ($requestNumber'))
    expect(script).toContain("$request -cne ('SNAPSHOT' + $requestNumber)")
    expect(script).not.toMatch(/Invoke-Expression|ScriptBlock|Start-Process|\b(?:Set|Remove|New)-Net|socket|http|registry|Get-Credential/i)
    const first = reader.read()
    child.reply(undefined, { routes: [{ nextHop: '192.168.18.1' }] })
    expect(await first).toEqual({ routes: [{ nextHop: '192.168.18.1' }] })
    const second = reader.read()
    child.reply(undefined, { routes: [{ nextHop: '192.168.18.2' }] })
    expect(await second).toEqual({ routes: [{ nextHop: '192.168.18.2' }] })
    expect(child.requests).toEqual(['SNAPSHOT1\n', 'SNAPSHOT2\n'])
    expect(spawnChild).toHaveBeenCalledTimes(1)
    await reader.close()
    expect(child.kill).not.toHaveBeenCalled()
    expect(child.stdin.writableEnded).toBe(true)
  })

  it('assembles split UTF-8 chunks and CRLF without resolving an incomplete frame', async () => {
    const { child, reader } = setup()
    const result = reader.read(), settled = vi.fn()
    void result.then(settled)
    const frame = Buffer.from('SNAPSHOT1\t{"name":"柬埔寨","routes":[]}\r\n')
    const split = frame.indexOf(Buffer.from('柬')) + 1
    child.stdout.write(frame.subarray(0, split))
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    child.stdout.write(frame.subarray(split, frame.length - 1))
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    child.stdout.write(frame.subarray(-1))
    expect(await result).toEqual({ name: '柬埔寨', routes: [] })
    await reader.close()
  })

  it.each([
    'SNAPSHOT2\t{}\n', 'SNAPSHOT01\t{}\n', 'SNAPSHOT1\tbad json\n',
    'SNAPSHOT1\t[]\n', 'SNAPSHOT1\tnull\n', '\n', '\uFEFFSNAPSHOT1\t{}\n',
    'SNAPSHOT1\t{}\nSNAPSHOT2\t{}\n', 'SNAPSHOT1\t{}\ntrailing fragment',
  ])('fails closed on malformed, mismatched or queued output %j', async output => {
    const { child, reader, spawnChild } = setup()
    const failed = expect(reader.read()).rejects.toThrow('NETWORK_METADATA_INVALID')
    child.stdout.write(output)
    await failed
    await expect(reader.read()).rejects.toThrow('NETWORK_METADATA_INVALID')
    await expect(reader.close()).rejects.toThrow('NETWORK_METADATA_INVALID')
    expect(child.kill).toHaveBeenCalledTimes(1)
    expect(spawnChild).toHaveBeenCalledTimes(1)
    expect(child.requests).toEqual(['SNAPSHOT1\n'])
  })

  it('rejects invalid UTF-8 bytes instead of accepting replacement characters', async () => {
    const { child, reader } = setup()
    const failed = expect(reader.read()).rejects.toThrow('NETWORK_METADATA_INVALID')
    child.stdout.write(Buffer.concat([Buffer.from('SNAPSHOT1\t{"name":"'), Buffer.from([0xff]), Buffer.from('"}\n')]))
    await failed
    await expect(reader.close()).rejects.toThrow('NETWORK_METADATA_INVALID')
  })

  it('unsolicited output poisons an idle worker and is never a cached next response', async () => {
    const { child, reader } = setup()
    child.stdout.write('SNAPSHOT1\t{}\n')
    await expect(reader.read()).rejects.toThrow('NETWORK_METADATA_INVALID')
    expect(child.requests).toEqual([])
    await expect(reader.close()).rejects.toThrow('NETWORK_METADATA_INVALID')
  })

  it('rejects a duplicate old response while the next request is pending', async () => {
    const { child, reader } = setup()
    const first = reader.read()
    child.reply('SNAPSHOT1', { sequence: 1 })
    expect(await first).toEqual({ sequence: 1 })
    const failed = expect(reader.read()).rejects.toThrow('NETWORK_METADATA_INVALID')
    child.reply('SNAPSHOT1', { sequence: 1 })
    await failed
    child.reply('SNAPSHOT2', { sequence: 2 })
    await expect(reader.read()).rejects.toThrow('NETWORK_METADATA_INVALID')
    await expect(reader.close()).rejects.toThrow('NETWORK_METADATA_INVALID')
  })

  it('bounds even an unterminated line by bytes and ignores output after termination', async () => {
    const { child, reader } = setup()
    const failed = expect(reader.read()).rejects.toThrow('NETWORK_METADATA_LIMIT')
    child.stdout.write(Buffer.alloc(1024 * 1024, 65))
    expect(child.kill).not.toHaveBeenCalled()
    child.stdout.write('A')
    await failed
    child.reply('SNAPSHOT1')
    await expect(reader.read()).rejects.toThrow('NETWORK_METADATA_LIMIT')
    await expect(reader.close()).rejects.toThrow('NETWORK_METADATA_LIMIT')
  })

  it('never queues concurrent reads or starts a replacement worker', async () => {
    const { child, reader, spawnChild } = setup()
    const first = expect(reader.read()).rejects.toThrow('NETWORK_METADATA_UNAVAILABLE')
    const second = expect(reader.read()).rejects.toThrow('NETWORK_METADATA_UNAVAILABLE')
    await Promise.all([first, second])
    expect(child.requests).toEqual(['SNAPSHOT1\n'])
    expect(spawnChild).toHaveBeenCalledTimes(1)
    await expect(reader.close()).rejects.toThrow('NETWORK_METADATA_UNAVAILABLE')
  })

  it('enforces the read count across fresh replies without retrying or retaining metadata', async () => {
    const { child, reader, spawnChild } = setup()
    for (let sequence = 1; sequence <= 130; sequence++) {
      const result = reader.read()
      child.reply(undefined, { sequence })
      expect(await result).toEqual({ sequence })
    }
    await expect(reader.read()).rejects.toThrow('NETWORK_METADATA_LIMIT')
    expect(child.requests).toHaveLength(130)
    expect(spawnChild).toHaveBeenCalledTimes(1)
    await expect(reader.close()).rejects.toThrow('NETWORK_METADATA_LIMIT')
  })

  it.each(['child', 'stdin', 'stdout', 'stderr', 'stdout-end', 'stderr-data', 'exit'])('closes on %s failure and hides raw diagnostic text', async event => {
    const { child, reader } = setup()
    const failed = expect(reader.read()).rejects.toThrow(/^NETWORK_METADATA_UNAVAILABLE$/)
    if (event === 'child') child.emit('error', new Error('raw private diagnostic'))
    else if (event === 'stdout-end') child.stdout.emit('end')
    else if (event === 'stderr-data') child.stderr.write('raw private diagnostic')
    else if (event === 'exit') child.finish()
    else child[event as 'stdin' | 'stdout' | 'stderr'].emit('error', new Error('raw private diagnostic'))
    await failed
    await expect(reader.close()).rejects.toThrow('NETWORK_METADATA_UNAVAILABLE')
    expect(child.kill).toHaveBeenCalledTimes(event === 'exit' ? 0 : 1)
  })

  it('normalizes a synchronous spawn failure and refuses non-Windows creation', () => {
    const spawnChild = vi.fn(() => { throw new Error('private spawn detail') }) as unknown as typeof spawn
    expect(() => createWindowsMetadataReader(FIXED_COMMAND, { platform: () => 'win32', spawn: spawnChild })).toThrow(/^NETWORK_METADATA_UNAVAILABLE$/)
    expect(() => createWindowsMetadataReader(FIXED_COMMAND, { platform: () => 'darwin', spawn: spawnChild })).toThrow('NETWORK_WINDOWS_REQUIRED')
    expect(spawnChild).toHaveBeenCalledTimes(1)
  })

  it('normalizes stdin write callback and synchronous failures', async () => {
    for (const synchronous of [false, true]) {
      const { child, reader } = setup()
      vi.spyOn(child.stdin, 'write').mockImplementation((...args: unknown[]) => {
        if (synchronous) throw new Error('private write detail')
        ;(args[1] as (error: Error) => void)(new Error('private write detail'))
        return false
      })
      await expect(reader.read()).rejects.toThrow(/^NETWORK_METADATA_UNAVAILABLE$/)
      await expect(reader.close()).rejects.toThrow('NETWORK_METADATA_UNAVAILABLE')
    }
  })

  it.each([false, true])('aborts %s-before-read without accepting later data', async alreadyAborted => {
    const { child, reader } = setup(), controller = new AbortController()
    if (alreadyAborted) controller.abort(new Error('private abort reason'))
    const failed = expect(reader.read(controller.signal)).rejects.toThrow(/^NETWORK_DISCOVERY_CANCELLED$/)
    if (!alreadyAborted) controller.abort(new Error('private abort reason'))
    child.reply('SNAPSHOT1')
    await failed
    expect(child.requests).toHaveLength(alreadyAborted ? 0 : 1)
    await expect(reader.read()).rejects.toThrow('NETWORK_DISCOVERY_CANCELLED')
    await expect(reader.close()).rejects.toThrow('NETWORK_DISCOVERY_CANCELLED')
  })

  it('removes a completed read abort listener before the next read', async () => {
    const { child, reader } = setup(), controller = new AbortController()
    const first = reader.read(controller.signal)
    child.reply()
    await first
    controller.abort()
    const second = reader.read()
    child.reply(undefined, { sequence: 2 })
    expect(await second).toEqual({ sequence: 2 })
    await reader.close()
  })

  it('enforces five seconds per read, including incomplete output, and awaits child close', async () => {
    vi.useFakeTimers()
    const { child, reader } = setup()
    child.autoClose = false
    const failed = expect(reader.read()).rejects.toThrow('NETWORK_METADATA_UNAVAILABLE')
    child.stdout.write('SNAPSHOT1\t{')
    await vi.advanceTimersByTimeAsync(4999)
    expect(child.kill).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(child.kill).toHaveBeenCalledTimes(1)
    child.finish()
    await failed
    await expect(reader.close()).rejects.toThrow('NETWORK_METADATA_UNAVAILABLE')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('enforces a single 45-second lifetime even when successful reads continue', async () => {
    vi.useFakeTimers()
    const { child, reader } = setup()
    for (let sequence = 0; sequence < 9; sequence++) {
      const result = reader.read()
      child.reply(undefined, { sequence })
      await result
      await vi.advanceTimersByTimeAsync(4999)
    }
    expect(child.kill).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(9)
    expect(child.kill).toHaveBeenCalledTimes(1)
    await expect(reader.read()).rejects.toThrow('NETWORK_METADATA_UNAVAILABLE')
    await expect(reader.close()).rejects.toThrow('NETWORK_METADATA_UNAVAILABLE')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('close is idempotent, rejects an outstanding read, and waits for actual child close', async () => {
    const { child, reader } = setup()
    child.autoClose = false
    const failed = expect(reader.read()).rejects.toThrow('NETWORK_METADATA_UNAVAILABLE')
    const finished = vi.fn(), close = reader.close().then(finished), again = reader.close()
    await Promise.resolve()
    expect(finished).not.toHaveBeenCalled()
    expect(child.kill).not.toHaveBeenCalled()
    expect(child.stdin.writableEnded).toBe(true)
    child.emit('exit', 0, null)
    await Promise.resolve()
    expect(finished).not.toHaveBeenCalled()
    child.emit('close', 0, null)
    await Promise.all([close, again, failed])
    await reader.close()
    child.reply('SNAPSHOT1')
    await expect(reader.read()).rejects.toThrow('NETWORK_METADATA_UNAVAILABLE')
  })

  it.each(['stdout', 'stderr', 'child-error', 'stdin-error', 'stdout-error', 'stderr-error', 'exit-code', 'exit-signal', 'close-code', 'missing-exit'])(
    'rejects %s after close starts but before the owned child closes', async event => {
      const { child, reader } = setup()
      child.autoClose = false
      const result = reader.read()
      child.reply()
      await result
      const closed = expect(reader.close()).rejects.toThrow(event === 'stdout'
        ? 'NETWORK_METADATA_INVALID' : 'NETWORK_METADATA_UNAVAILABLE')
      if (event === 'stdout') child.stdout.write('unexpected trailing output')
      else if (event === 'stderr') child.stderr.write('private late diagnostic')
      else if (event === 'child-error') child.emit('error', new Error('private child error'))
      else if (event.endsWith('-error')) child[event.split('-')[0] as 'stdin' | 'stdout' | 'stderr'].emit('error', new Error('private stream error'))
      else if (event === 'exit-code') child.emit('exit', 1, null)
      else if (event === 'exit-signal') child.emit('exit', null, 'SIGTERM')
      else if (event === 'close-code') child.emit('exit', 0, null)
      if (!event.startsWith('exit-') && event !== 'close-code' && event !== 'missing-exit') child.emit('exit', 0, null)
      child.emit('close', event === 'close-code' ? 1 : 0, null)
      await closed
      await expect(reader.close()).rejects.toThrow(event === 'stdout'
        ? 'NETWORK_METADATA_INVALID' : 'NETWORK_METADATA_UNAVAILABLE')
    },
  )

  it('accepts clean EOF, exit and stream-end events during repeated normal close calls', async () => {
    const { child, reader } = setup()
    child.autoClose = false
    const first = reader.read()
    child.reply()
    await first
    const close = reader.close(), again = reader.close()
    child.stdout.emit('end')
    child.emit('exit', 0, null)
    child.emit('close', 0, null)
    await Promise.all([close, again, reader.close()])
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('fails cleanup if graceful EOF stalls, even when the fallback kill subsequently closes the child', async () => {
    vi.useFakeTimers()
    const { child, reader } = setup()
    child.autoClose = false
    const closed = expect(reader.close()).rejects.toThrow('NETWORK_METADATA_CLEANUP_FAILED')
    await vi.advanceTimersByTimeAsync(499)
    expect(child.kill).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(child.kill).toHaveBeenCalledTimes(1)
    child.finish()
    await closed
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([false, true])('preserves the exact internal deadline reason (already aborted: %s)', async alreadyAborted => {
    const { child, reader } = setup(), controller = new AbortController()
    const reason = Object.assign(new Error('NETWORK_DISCOVERY_DEADLINE'), {
      name: 'NetworkDiscoveryError', code: 'NETWORK_DISCOVERY_DEADLINE',
    })
    if (alreadyAborted) controller.abort(reason)
    const failed = expect(reader.read(controller.signal)).rejects.toThrow(/^NETWORK_DISCOVERY_DEADLINE$/)
    if (!alreadyAborted) controller.abort(reason)
    child.reply('SNAPSHOT1')
    await failed
    await expect(reader.close()).rejects.toThrow(/^NETWORK_DISCOVERY_DEADLINE$/)
  })

  it.each([
    { name: 'NetworkDiscoveryError', message: 'NETWORK_DISCOVERY_DEADLINE', code: 'NETWORK_DISCOVERY_DEADLINE' },
    Object.assign(new Error('private deadline detail'), { name: 'NetworkDiscoveryError', code: 'NETWORK_DISCOVERY_DEADLINE' }),
    Object.assign(new Error('NETWORK_DISCOVERY_DEADLINE'), { name: 'WrongError', code: 'NETWORK_DISCOVERY_DEADLINE' }),
    Object.assign(new Error('NETWORK_DISCOVERY_DEADLINE'), { name: 'NetworkDiscoveryError', code: 'WRONG_CODE' }),
  ])('normalizes nonmatching abort reasons without exposing raw text', async reason => {
    const { reader } = setup(), controller = new AbortController()
    controller.abort(reason)
    await expect(reader.read(controller.signal)).rejects.toThrow(/^NETWORK_DISCOVERY_CANCELLED$/)
    await expect(reader.close()).rejects.toThrow(/^NETWORK_DISCOVERY_CANCELLED$/)
  })

  it.each(['unsolicited', 'exit'])('close rejects %s arriving after the final valid response', async event => {
    const { child, reader } = setup()
    const result = reader.read()
    child.reply()
    expect(await result).toEqual({ routes: [] })
    if (event === 'unsolicited') child.reply('SNAPSHOT2')
    else child.finish()
    await expect(reader.close()).rejects.toThrow(event === 'unsolicited'
      ? 'NETWORK_METADATA_INVALID' : 'NETWORK_METADATA_UNAVAILABLE')
  })

  it.each(['no-close', 'kill-false', 'kill-throws'])('reports bounded cleanup failure for %s rather than claiming termination', async behavior => {
    vi.useFakeTimers()
    const { child, reader } = setup()
    child.autoClose = false
    if (behavior === 'kill-false') child.kill.mockReturnValue(false)
    if (behavior === 'kill-throws') child.kill.mockImplementation(() => { throw new Error('private kill detail') })
    const failed = expect(reader.read()).rejects.toThrow('NETWORK_METADATA_CLEANUP_FAILED')
    const close = expect(reader.close()).rejects.toThrow('NETWORK_METADATA_CLEANUP_FAILED')
    await vi.advanceTimersByTimeAsync(1000)
    await Promise.all([failed, close])
    expect(child.kill).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    child.finish()
    await expect(reader.read()).rejects.toThrow('NETWORK_METADATA_CLEANUP_FAILED')
  })
})
