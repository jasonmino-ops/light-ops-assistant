import { EventEmitter } from 'node:events'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HrtProviderSupervision } from '../src/main/hrt/providerSupervision'
import {
  WindowsProviderSupervisor,
  type WindowsProviderPipeClientLike,
} from '../src/main/provider/providerSupervisor'

function child(pid: number): ChildProcessWithoutNullStreams {
  const process = new EventEmitter() as ChildProcessWithoutNullStreams
  Object.assign(process, {
    pid,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: new EventEmitter(),
    stdio: [],
    killed: false,
    exitCode: null,
    signalCode: null,
    connected: false,
    kill: vi.fn(function (this: ChildProcessWithoutNullStreams) {
      ;(this as unknown as { killed: boolean }).killed = true
      queueMicrotask(() => this.emit('exit', null, 'SIGTERM'))
      return true
    }),
  })
  return process
}

function client(): WindowsProviderPipeClientLike {
  return {
    connect: vi.fn(async () => undefined),
    requestHealth: vi.fn(),
    shutdown: vi.fn(),
    destroy: vi.fn(),
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('WindowsProviderSupervisor recovery', () => {
  it('actually respawns one child at a time with bounded exponential backoff', async () => {
    vi.useFakeTimers()
    const children: ChildProcessWithoutNullStreams[] = []
    const clients: WindowsProviderPipeClientLike[] = []
    let now = 1_000
    const supervisor = new WindowsProviderSupervisor({
      connectDelayMs: 0,
      connectRetryMs: 0,
      maxConnectAttempts: 1,
      now: () => now,
      resolveEntry: () => ({ entryPath: 'C:\\Program Files\\E-Shop\\resources\\eshop-windows-provider\\dist\\index.js', source: 'resources' }),
      spawnProvider: vi.fn(() => {
        const value = child(100 + children.length)
        children.push(value)
        return value
      }),
      clientFactory: vi.fn(() => {
        const value = client()
        clients.push(value)
        return value
      }),
      supervision: new HrtProviderSupervision({
        initialBackoffMs: 100,
        backoffMultiplier: 2,
        maxBackoffMs: 1_000,
        maxRestartAttempts: 2,
        restartWindowMs: 60_000,
      }),
    })

    const starting = supervisor.start()
    await vi.runAllTimersAsync()
    await starting
    expect(children).toHaveLength(1)
    expect(clients).toHaveLength(1)

    children[0].emit('exit', 9, null)
    expect(children).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(99)
    expect(children).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(children).toHaveLength(2)

    now += 1_000
    children[1].emit('exit', 9, null)
    await vi.advanceTimersByTimeAsync(199)
    expect(children).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(children).toHaveLength(3)

    now += 1_000
    children[2].emit('exit', 9, null)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(children).toHaveLength(3)
    expect(clients.every((value) => vi.mocked(value.destroy).mock.calls.length === 1)).toBe(true)
  })

  it('turns a permanently closed pipe into the same supervised exit path', async () => {
    vi.useFakeTimers()
    const children: ChildProcessWithoutNullStreams[] = []
    let close: (() => void) | undefined
    const supervisor = new WindowsProviderSupervisor({
      connectDelayMs: 0,
      maxConnectAttempts: 1,
      resolveEntry: () => ({ entryPath: 'C:\\installed\\resources\\eshop-windows-provider\\dist\\index.js', source: 'resources' }),
      spawnProvider: vi.fn(() => {
        const value = child(200 + children.length)
        children.push(value)
        return value
      }),
      clientFactory: vi.fn((options) => {
        close = () => options.onClose?.('pipe_closed')
        return client()
      }),
    })

    const starting = supervisor.start()
    await vi.runAllTimersAsync()
    await starting
    close?.()
    await vi.runAllTimersAsync()
    expect(vi.mocked(children[0].kill)).toHaveBeenCalledTimes(1)
    expect(children).toHaveLength(2)
  })

  it('does not kill the Provider when an initial pipe attempt closes before a retry succeeds', async () => {
    vi.useFakeTimers()
    const children: ChildProcessWithoutNullStreams[] = []
    let attempt = 0
    const supervisor = new WindowsProviderSupervisor({
      connectDelayMs: 0,
      connectRetryMs: 10,
      maxConnectAttempts: 2,
      resolveEntry: () => ({ entryPath: 'C:\\installed\\provider.js', source: 'resources' }),
      spawnProvider: vi.fn(() => {
        const value = child(250 + children.length)
        children.push(value)
        return value
      }),
      clientFactory: vi.fn((options) => {
        attempt += 1
        if (attempt === 1) return {
          ...client(),
          connect: vi.fn(async () => {
            options.onClose?.('pipe_closed')
            throw new Error('ENOENT')
          }),
        }
        return client()
      }),
    })

    const starting = supervisor.start()
    await vi.runAllTimersAsync()
    await starting
    expect(attempt).toBe(2)
    expect(children).toHaveLength(1)
    expect(vi.mocked(children[0].kill)).not.toHaveBeenCalled()
  })

  it('cancels a scheduled respawn during Desktop shutdown', async () => {
    vi.useFakeTimers()
    const children: ChildProcessWithoutNullStreams[] = []
    const supervisor = new WindowsProviderSupervisor({
      connectDelayMs: 0,
      maxConnectAttempts: 1,
      resolveEntry: () => ({ entryPath: 'C:\\installed\\provider.js', source: 'resources' }),
      spawnProvider: vi.fn(() => {
        const value = child(300 + children.length)
        children.push(value)
        return value
      }),
      clientFactory: vi.fn(() => client()),
    })

    const starting = supervisor.start()
    await vi.runAllTimersAsync()
    await starting
    children[0].emit('exit', 1, null)
    const stopping = supervisor.stop()
    await vi.runAllTimersAsync()
    await stopping
    expect(children).toHaveLength(1)
  })
})
