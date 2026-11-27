import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HRT_CONTRACT_VERSION, HrtFrame } from '@eshop/hrt-contract'
import { WindowsProviderSupervisor } from '../src/main/provider/providerSupervisor'
import { WindowsProviderPipeClient } from '../src/main/provider/namedPipeClient'
import { encodeProviderEnvelope } from '../src/main/provider/providerTransportFraming'

const mocks = vi.hoisted(() => ({ connect: vi.fn(), spawn: vi.fn(), info: vi.fn(),
  warn: vi.fn(), update: vi.fn(), error: vi.fn() }))
vi.mock('node:net', () => ({ default: { connect: mocks.connect } }))
vi.mock('../src/main/logger', () => ({ logger: { info: mocks.info, warn: mocks.warn } }))
vi.mock('../src/main/runtimeHealth', () => ({ updateHealth: mocks.update, recordHealthError: mocks.error }))
vi.mock('../src/main/provider/providerProcess', () => ({
  resolveWindowsProviderEntry: () => ({ entryPath: 'synthetic/provider.js', source: 'resources' }),
  generateSupervisorToken: () => 'synthetic-supervisor-token', spawnWindowsProvider: mocks.spawn,
}))

// No Electron, real pipe, Provider process, network, disk or printer is used.
class Socket extends EventEmitter {
  destroyed = false
  writes: Buffer[] = []
  write(value: Buffer) {
    this.writes.push(value)
    if (writeError && this.writes.length === writeErrorAt) throw Object.assign(new Error(writeError), { code: writeError })
    return true
  }
  destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('close') }; return this }
}
class Child extends EventEmitter {
  pid = 1234
  killed = false
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  kill = vi.fn(() => { this.killed = true; return true })
}
let sockets: Socket[]
let child: Child
let listenAt: number
let outcome: ((attempt: number) => string) | undefined
let maxActive: number
let writeError: string | undefined
let writeErrorAt: number
const frames = () => sockets.flatMap(socket => socket.writes.map(bytes => JSON.parse(bytes.subarray(4).toString())))
const requests = (type: string) => frames().filter(envelope => envelope.frame.messageType === type)
const latest = () => mocks.update.mock.calls.at(-1)?.[0].providerRuntime
const failures = () => mocks.update.mock.calls.filter(call => call[1] === 'provider.connect-failed')
const receive = (socket: Socket, messageType: HrtFrame['messageType'], payload: unknown) => socket.emit('data',
  encodeProviderEnvelope({ frame: { contractVersion: HRT_CONTRACT_VERSION, messageType, correlationId: 'fixture',
    instanceId: 'provider-test', sequence: 1, timestamp: '2026-11-03T00:00:00.000Z', payload } }))
const registration = { providerId: 'windows-provider', providerInstanceId: 'provider-test', providerVersion: '0.1.0',
  contractVersion: HRT_CONTRACT_VERSION, supportedCapabilities: [], capabilityDescriptors: [],
  platform: { os: 'win32', arch: 'x64', runtime: 'node' }, process: { pid: 1234, startedAt: '2026-11-03T00:00:00.000Z' } }
function ready(socket = sockets.at(-1)!) {
  receive(socket, 'provider.handshake.response', { readyTransition: 'RUNTIME_AUTHORIZED', provider: registration })
  receive(socket, 'provider.register', registration)
  receive(socket, 'health.snapshot', { providerHealth: 'READY', providerInstanceId: 'provider-test', devices: [] })
}
async function stop(supervisor: WindowsProviderSupervisor) {
  const stopping = supervisor.stop()
  await vi.advanceTimersByTimeAsync(100)
  await stopping
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(0)
  vi.clearAllMocks()
  sockets = []; child = new Child(); listenAt = 0; outcome = undefined; maxActive = 0; writeError = undefined; writeErrorAt = 1
  mocks.spawn.mockReturnValue(child)
  mocks.connect.mockImplementation(() => {
    const socket = new Socket(); sockets.push(socket)
    maxActive = Math.max(maxActive, sockets.filter(item => !item.destroyed).length)
    const result = outcome?.(sockets.length) ?? (Date.now() >= listenAt ? 'CONNECT' : 'ENOENT')
    queueMicrotask(() => {
      if (socket.destroyed) return
      if (result === 'CONNECT') socket.emit('connect')
      else if (result !== 'PENDING') socket.emit('error', Object.assign(new Error(result), { code: result }))
    })
    return socket
  })
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('bounded Provider startup ENOENT recovery', () => {
  it('connects immediately without the old 250ms wait and preserves the authenticated handshake and health request', async () => {
    const supervisor = new WindowsProviderSupervisor({ runtimeInstanceId: 'desktop-test' })
    await supervisor.start()
    expect(Date.now()).toBe(0)
    expect(mocks.spawn).toHaveBeenCalledTimes(1)
    expect(mocks.connect).toHaveBeenCalledTimes(1)
    expect(requests('runtime.handshake.request')).toHaveLength(1)
    expect(requests('runtime.handshake.request')[0]).toMatchObject({ supervisorToken: 'synthetic-supervisor-token',
      frame: { instanceId: 'desktop-test', payload: { initiatedBy: 'RUNTIME', requiredContractVersion: HRT_CONTRACT_VERSION,
        requiredCapabilities: [], compatibilityMatrix: { providerId: 'windows-provider' } } } })
    expect(requests('health.snapshot')).toHaveLength(1)
    expect(requests('health.snapshot')[0].frame.payload).toEqual({ request: true })
    ready()
    expect(latest()).toMatchObject({ state: 'ok', lastError: null, providerInstanceId: 'provider-test' })
    expect(mocks.info.mock.calls.some(call => call[0] === 'provider.registered')).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    await stop(supervisor)
  })

  it.each([[35, 50], [353, 750], [303, 350], [637, 750]])(
    'recovers when listening starts at %ims, with one successful connection at %ims', async (listen, success) => {
      listenAt = listen
      const supervisor = new WindowsProviderSupervisor()
      const starting = supervisor.start()
      await vi.advanceTimersByTimeAsync(success)
      await starting
      ready()
      expect(latest().state).toBe('ok')
      expect(mocks.spawn).toHaveBeenCalledTimes(1)
      expect(maxActive).toBe(1)
      expect(requests('runtime.handshake.request')).toHaveLength(1)
      expect(requests('health.snapshot')).toHaveLength(1)
      expect(sockets.slice(0, -1).every(socket => socket.destroyed)).toBe(true)
      expect(failures()).toHaveLength(0)
      expect(vi.getTimerCount()).toBe(0)
      expect(JSON.stringify(mocks.info.mock.calls)).not.toContain('synthetic-supervisor-token')
      await stop(supervisor)
    })

  it('ends persistent ENOENT at 5000ms, without a last attempt at the deadline or any later reconnect', async () => {
    listenAt = Infinity
    const supervisor = new WindowsProviderSupervisor()
    const starting = supervisor.start()
    await vi.advanceTimersByTimeAsync(5_000)
    await starting
    expect(failures()).toHaveLength(1)
    expect(latest()).toMatchObject({ state: 'error', lastError: 'CONNECT_TIMEOUT' })
    expect(mocks.connect).toHaveBeenCalledTimes(13)
    expect(sockets.every(socket => socket.destroyed)).toBe(true)
    expect(requests('runtime.handshake.request')).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(mocks.connect).toHaveBeenCalledTimes(13)
    expect(vi.getTimerCount()).toBe(0)
    await stop(supervisor)
  })

  it.each(['EACCES', 'ECONNREFUSED', 'EPIPE'])('does not retry %s', async code => {
    outcome = () => code
    const supervisor = new WindowsProviderSupervisor()
    await supervisor.start()
    await vi.advanceTimersByTimeAsync(6_000)
    expect(mocks.connect).toHaveBeenCalledTimes(1)
    expect(failures()).toHaveLength(1)
    expect(latest()).toMatchObject({ state: 'error', lastError: 'CONNECT_FAILED' })
    expect(sockets[0].destroyed).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    await stop(supervisor)
  })

  it('includes a pending connect in the 5s deadline and ignores its late events', async () => {
    outcome = () => 'PENDING'
    const supervisor = new WindowsProviderSupervisor()
    const starting = supervisor.start()
    await vi.advanceTimersByTimeAsync(5_000)
    await starting
    expect(latest().lastError).toBe('CONNECT_TIMEOUT')
    expect(sockets[0].destroyed).toBe(true)
    expect(() => { sockets[0].emit('connect'); sockets[0].emit('error', new Error('late')); sockets[0].emit('close'); ready(sockets[0]) }).not.toThrow()
    expect(requests('runtime.handshake.request')).toHaveLength(0)
    expect(latest().lastError).toBe('CONNECT_TIMEOUT')
    expect(vi.getTimerCount()).toBe(0)
    await stop(supervisor)
  })

  it.each([4_999, 5_000])('handles a pending connection completing at %ims without extending the deadline', async at => {
    outcome = () => 'PENDING'
    const supervisor = new WindowsProviderSupervisor()
    const starting = supervisor.start()
    await vi.advanceTimersByTimeAsync(0)
    setTimeout(() => sockets[0].emit('connect'), at)
    await vi.advanceTimersByTimeAsync(at)
    await starting
    expect(requests('runtime.handshake.request')).toHaveLength(at < 5_000 ? 1 : 0)
    expect(failures()).toHaveLength(at < 5_000 ? 0 : 1)
    expect(vi.getTimerCount()).toBe(0)
    await stop(supervisor)
  })

  it('counts the optional initial delay inside the deadline', async () => {
    const supervisor = new WindowsProviderSupervisor({ connectDelayMs: 6_000 })
    const starting = supervisor.start()
    await vi.advanceTimersByTimeAsync(5_000)
    await starting
    expect(mocks.connect).not.toHaveBeenCalled()
    expect(latest().lastError).toBe('CONNECT_TIMEOUT')
    expect(vi.getTimerCount()).toBe(0)
    await stop(supervisor)
  })

  it('rejects overdue I/O success even when the deadline timer has not run yet', async () => {
    outcome = () => 'PENDING'
    const supervisor = new WindowsProviderSupervisor()
    const starting = supervisor.start()
    await vi.advanceTimersByTimeAsync(0)
    vi.spyOn(performance, 'now').mockReturnValue(5_001)
    sockets[0].emit('connect')
    await starting
    expect(latest().lastError).toBe('CONNECT_TIMEOUT')
    expect(requests('runtime.handshake.request')).toHaveLength(0)
    expect(sockets[0].destroyed).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    await stop(supervisor)
  })

  it('does not dispatch an overdue retry when its wait resolves before the deadline timer', async () => {
    listenAt = Infinity
    const supervisor = new WindowsProviderSupervisor()
    const starting = supervisor.start()
    await vi.advanceTimersByTimeAsync(0)
    vi.spyOn(performance, 'now').mockReturnValue(5_001)
    await vi.advanceTimersByTimeAsync(50)
    await starting
    expect(mocks.connect).toHaveBeenCalledTimes(1)
    expect(latest().lastError).toBe('CONNECT_TIMEOUT')
    expect(vi.getTimerCount()).toBe(0)
    await stop(supervisor)
  })

  it('reserves one startup flight for concurrent and repeated starts', async () => {
    listenAt = 353
    const supervisor = new WindowsProviderSupervisor()
    const first = supervisor.start(), second = supervisor.start()
    expect(first).toBe(second)
    await vi.advanceTimersByTimeAsync(750)
    await Promise.all([first, second, supervisor.start()])
    expect(mocks.spawn).toHaveBeenCalledTimes(1)
    expect(maxActive).toBe(1)
    expect(requests('runtime.handshake.request')).toHaveLength(1)
    await stop(supervisor)
  })

  it('cancels before the initial startup microtask and cannot be restarted after stop', async () => {
    const supervisor = new WindowsProviderSupervisor()
    const starting = supervisor.start()
    await stop(supervisor)
    await starting
    await supervisor.start()
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(mocks.connect).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['initial delay', 'retry wait', 'pending connect'])('quit cancels during %s and clears all waits', async stage => {
    listenAt = Infinity
    if (stage === 'pending connect') outcome = () => 'PENDING'
    const supervisor = new WindowsProviderSupervisor({ connectDelayMs: stage === 'initial delay' ? 1_000 : 0 })
    const starting = supervisor.start()
    await vi.advanceTimersByTimeAsync(0)
    const attempts = mocks.connect.mock.calls.length
    const firstStop = supervisor.stop(), secondStop = supervisor.stop()
    expect(firstStop).toBe(secondStop)
    await vi.advanceTimersByTimeAsync(6_000)
    await Promise.all([starting, firstStop])
    expect(mocks.connect).toHaveBeenCalledTimes(attempts)
    expect(sockets.every(socket => socket.destroyed)).toBe(true)
    expect(frames()).toHaveLength(0)
    expect(child.kill).toHaveBeenCalledTimes(1)
    expect(failures()).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['retry wait', 'pending connect'])('child exit cancels %s without a respawn', async stage => {
    listenAt = Infinity
    if (stage === 'pending connect') outcome = () => 'PENDING'
    const supervisor = new WindowsProviderSupervisor()
    const starting = supervisor.start()
    await vi.advanceTimersByTimeAsync(0)
    const attempts = mocks.connect.mock.calls.length
    child.emit('exit', 1, null)
    await starting
    await vi.advanceTimersByTimeAsync(6_000)
    expect(mocks.spawn).toHaveBeenCalledTimes(1)
    expect(mocks.connect).toHaveBeenCalledTimes(attempts)
    expect(sockets.every(socket => socket.destroyed)).toBe(true)
    expect(failures()).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
    await stop(supervisor)
  })

  it('does not let retired socket events overwrite successful readiness or send a second handshake', async () => {
    listenAt = 35
    const supervisor = new WindowsProviderSupervisor()
    const starting = supervisor.start()
    await vi.advanceTimersByTimeAsync(50)
    await starting
    ready()
    const count = mocks.update.mock.calls.length
    expect(() => { sockets[0].emit('connect'); sockets[0].emit('error', new Error('late')); sockets[0].emit('close'); ready(sockets[0]) }).not.toThrow()
    expect(mocks.update).toHaveBeenCalledTimes(count)
    expect(latest().state).toBe('ok')
    expect(requests('runtime.handshake.request')).toHaveLength(1)
    await stop(supervisor)
  })

  it('does not retry ENOENT raised by a handshake write after the socket has connected', async () => {
    writeError = 'ENOENT'
    const supervisor = new WindowsProviderSupervisor()
    await supervisor.start()
    await vi.advanceTimersByTimeAsync(6_000)
    expect(mocks.connect).toHaveBeenCalledTimes(1)
    expect(requests('runtime.handshake.request')).toHaveLength(1)
    expect(requests('health.snapshot')).toHaveLength(0)
    expect(latest()).toMatchObject({ state: 'error', lastError: 'CONNECT_FAILED' })
    expect(mocks.error.mock.calls.at(-1)?.[1]).toContain('Provider handshake failed')
    expect(sockets[0].destroyed).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    writeError = undefined
    await stop(supervisor)
  })

  it('does not retry ENOENT raised by the health request after a successful connection', async () => {
    writeError = 'ENOENT'; writeErrorAt = 2
    const supervisor = new WindowsProviderSupervisor()
    await supervisor.start()
    await vi.advanceTimersByTimeAsync(6_000)
    expect(mocks.connect).toHaveBeenCalledTimes(1)
    expect(requests('runtime.handshake.request')).toHaveLength(1)
    expect(requests('health.snapshot')).toHaveLength(1)
    expect(sockets[0].destroyed).toBe(true)
    expect(latest()).toMatchObject({ state: 'error', lastError: 'CONNECT_FAILED' })
    expect(vi.getTimerCount()).toBe(0)
    writeError = undefined
    await stop(supervisor)
  })

  it.each([false, true])('handles child process errors fail-closed, connected=%s, without uncaught errors or respawn', async connected => {
    if (!connected) outcome = () => 'PENDING'
    const supervisor = new WindowsProviderSupervisor()
    const starting = supervisor.start()
    await vi.advanceTimersByTimeAsync(0)
    if (connected) { await starting; ready() }
    expect(() => child.emit('error', new Error('synthetic child failure'))).not.toThrow()
    await starting
    await vi.advanceTimersByTimeAsync(6_000)
    expect(latest()).toMatchObject({ state: 'error', lastError: 'PROVIDER_PROCESS_ERROR' })
    expect(mocks.spawn).toHaveBeenCalledTimes(1)
    expect(mocks.connect).toHaveBeenCalledTimes(1)
    expect(sockets.every(socket => socket.destroyed)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    await stop(supervisor)
  })

  it.each(['close', 'error', 'rejected handshake', 'invalid frame'])('never retries after a successful connection followed by %s', async event => {
    const supervisor = new WindowsProviderSupervisor()
    await supervisor.start()
    ready()
    if (event === 'close') sockets[0].emit('close')
    if (event === 'error') expect(() => sockets[0].emit('error', new Error('after connection'))).not.toThrow()
    if (event === 'rejected handshake') receive(sockets[0], 'provider.handshake.response', {
      readyTransition: 'REJECTED', provider: registration })
    if (event === 'invalid frame') sockets[0].emit('data', Buffer.alloc(4))
    expect(latest().state).not.toBe('ok')
    await vi.advanceTimersByTimeAsync(6_000)
    await supervisor.start()
    expect(mocks.spawn).toHaveBeenCalledTimes(1)
    expect(mocks.connect).toHaveBeenCalledTimes(1)
    expect(requests('runtime.handshake.request')).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
    await stop(supervisor)
  })
})

describe('pipe client single-flight and cancellation', () => {
  it('sends one handshake for repeated connect calls', async () => {
    const client = new WindowsProviderPipeClient({ supervisorToken: 'synthetic-supervisor-token', runtimeInstanceId: 'test' })
    const first = client.connect(), second = client.connect()
    expect(first).toBe(second)
    await Promise.all([first, second, client.connect()])
    expect(mocks.connect).toHaveBeenCalledTimes(1)
    expect(requests('runtime.handshake.request')).toHaveLength(1)
    client.destroy()
  })

  it('never dispatches an already aborted connection', async () => {
    const controller = new AbortController(); controller.abort()
    const client = new WindowsProviderPipeClient({ supervisorToken: 'synthetic-supervisor-token', runtimeInstanceId: 'test' })
    await expect(client.connect(controller.signal)).rejects.toBeInstanceOf(Error)
    expect(mocks.connect).not.toHaveBeenCalled()
  })

  it('destroy settles a pending connection and absorbs late events without an uncaught exception', async () => {
    outcome = () => 'PENDING'
    const client = new WindowsProviderPipeClient({ supervisorToken: 'synthetic-supervisor-token', runtimeInstanceId: 'test' })
    const rejected = expect(client.connect()).rejects.toMatchObject({ code: 'PROVIDER_CONNECT_CANCELLED' })
    client.destroy()
    await rejected
    expect(sockets[0].destroyed).toBe(true)
    expect(() => { sockets[0].emit('connect'); sockets[0].emit('error', new Error('late')); sockets[0].emit('close') }).not.toThrow()
    expect(frames()).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
