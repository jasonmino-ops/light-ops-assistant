import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { Socket, createServer, type Server } from 'node:net'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdtemp, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { NETWORK_PROFILE, parseNetworkRequest, type NetworkMode, type NetworkRequest } from '../src/networkContract'
import { NetworkNodeConfig, validateNetworkNode, resolveNetworkEndpoint } from '../src/networkNodeConfig'
import { NetworkDeliveryError, NetworkRawTcpTransport } from '../src/printing/networkRawTcpTransport'
import { CloudRelayClient, CloudRelayError, type ReceivedPrintJob, type TerminalResult } from '../src/cloudRelayClient'
import { RelayPoller } from '../src/relayPoller'
import { ExecutionJournal } from '../src/executionJournal'
import { createGuardedNetworkClient, createNetworkStrategy } from '../src/networkRuntime'
import { NetworkAddonProfile } from '../network-addon/profile'

// Inject only the selected real FileHandle.sync call; the actual journal,
// rename, poller and preparation closure continue to execute unchanged.
const syncFault = vi.hoisted(() => ({ file: '', write: 0, count: 0,
  phase: '' as '' | 'temporary' | 'final', code: 'EPERM', hits: 0 }))
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, open: async (...args: Parameters<typeof actual.open>) => {
    const handle = await actual.open(...args)
    const file = String(args[0])
    const temporary = syncFault.file && file.startsWith(`${syncFault.file}.tmp-`)
    if (temporary) syncFault.count++
    if (syncFault.file && syncFault.count === syncFault.write &&
      (syncFault.phase === 'temporary' ? temporary : file === syncFault.file)) {
      const sync = handle.sync.bind(handle)
      handle.sync = async () => {
        syncFault.hits++
        if (syncFault.phase) throw Object.assign(new Error('injected required fsync failure'), { code: syncFault.code })
        return sync()
      }
    }
    return handle
  } }
})

const interfaces: ReturnType<typeof os.networkInterfaces> = { LAN: [{
  family: 'IPv4', address: '10.20.30.1', netmask: '255.255.255.0', internal: false, mac: '00:00:00:00:00:00', cidr: '10.20.30.1/24',
}] }
const node = { host: '10.20.30.2', port: 9100 }
const request: NetworkRequest = { profile: NETWORK_PROFILE, requestId: 'network-test-0001', role: 'FRONT', mode: 'SHARED_PRINTER', rendererVersion: 1,
  order: { storeCode: 'STORE-A', storeName: 'Test', orderNo: 'ORDER-001', createdAt: '2026-09-07T00:00:00.000Z',
    cashierName: 'Cashier', paymentMethod: 'CASH', currencyCode: 'USD', totalAmount: 3, lang: 'zh',
    items: [{ name: '小票', spec: null, qty: 1, price: 3, lineAmount: 3 }] } }
const protector = { protect: (v: string) => Buffer.from(v).toString('base64'), unprotect: (v: string) => Buffer.from(v, 'base64').toString() }
function claimed(): ReceivedPrintJob {
  return { id: 'network-job-0001', schemaVersion: 2, requestId: request.requestId,
    idempotencyKey: request.requestId, requestHash: createHash('sha256').update(JSON.stringify(parseNetworkRequest(request))).digest('hex'),
    orderNo: request.order.orderNo, documentName: 'FRONT', commandStream: new Uint8Array(), network: request,
    claimAttempt: 1, claimToken: `ecp_v1_${'a'.repeat(43)}`, leaseExpiresAt: new Date(Date.now() + 30000).toISOString() }
}
function clientResponse() {
  const job = claimed()
  return { productionContract: true, schemaVersion: 2, bindingId: 'binding-A', storeCode: 'STORE-A', job: {
    id: job.id, schemaVersion: 2, idempotencyKey: job.idempotencyKey, requestHash: job.requestHash,
    claimAttempt: job.claimAttempt, claimToken: job.claimToken, leaseExpiresAt: job.leaseExpiresAt, request,
  } }
}
describe('Network V0.1 contract and local authority', () => {
  it('uses exact roles and rejects endpoint injection anywhere in the contract', () => {
    expect(parseNetworkRequest(request)).toEqual(request)
    expect(parseNetworkRequest({ ...request, role: 'KITCHEN' }).role).toBe('KITCHEN')
    expect(parseNetworkRequest({ ...request, mode: 'FRONT_ONLY' }).mode).toBe('FRONT_ONLY')
    for (const value of [{ ...request, role: 'ANY' }, { ...request, host: node.host },
      { ...request, mode: undefined }, { ...request, mode: 'DUAL_PRINTER' },
      { ...request, mode: 'FRONT_ONLY', role: 'KITCHEN' },
      { ...request, order: { ...request.order, port: 9100 } },
      { ...request, order: { ...request.order, items: [{ ...request.order.items[0], host: node.host }] } }]) {
      expect(() => parseNetworkRequest(value)).toThrow()
    }
  })
  it.each(['localhost', '10.20.30.02', '0x0a141e02', '169090562', '10.20.30.2:9100', '10.20.30.256',
    '127.0.0.1', '169.254.1.2', '224.0.0.1', '255.255.255.255', '8.8.8.8', '172.32.1.1', '10.20.30.0', '10.20.30.255', '10.20.30.1', '10.21.30.2'])('rejects unsafe endpoint %s', host => {
    expect(() => validateNetworkNode({ host, port: 9100 }, interfaces)).toThrow()
  })
  it('rejects non-/24 broadcast and invalid ports; accepts non-default private TCP port', () => {
    expect(() => validateNetworkNode({ host: '10.20.30.127', port: 9100 }, {
      LAN: [{ ...interfaces.LAN![0], netmask: '255.255.255.128', cidr: '10.20.30.1/25' }],
    })).toThrow()
    for (const port of [0, -1, 65536, 1.5, '9100']) expect(() => validateNetworkNode({ ...node, port }, interfaces)).toThrow()
    expect(validateNetworkNode({ ...node, port: 12345 }, interfaces).port).toBe(12345)
  })
  it('local config is sealed and invalidated by store, installation or binding changes', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'network-config-test-'))
    const file = path.join(directory, 'nodes.sealed')
    const identity = { installationId: 'installation-A', computerId: 'binding-A', storeCode: 'STORE-A', boundAt: '2026-09-07' }
    const config = new NetworkNodeConfig({ file, identity, protector, interfaces: () => interfaces })
    await config.save({ mode: 'SHARED_PRINTER', endpoint: node })
    expect((await readFile(file, 'utf8')).includes(node.host)).toBe(false)
    const shared = await config.read()
    expect(shared.mode).toBe('SHARED_PRINTER')
    expect(resolveNetworkEndpoint(shared, request)).toEqual(node)
    expect(resolveNetworkEndpoint(shared, { ...request, role: 'KITCHEN' })).toEqual(node)
    for (const key of Object.keys(identity)) {
      await expect(new NetworkNodeConfig({ file, identity: { ...identity, [key]: 'changed' }, protector, interfaces: () => interfaces }).read()).rejects.toThrow()
    }
    await expect(config.save({ FRONT: node, KITCHEN: node })).rejects.toThrow()
    await expect(config.save({ FRONT: node, KITCHEN: { ...node, port: 9101 } })).rejects.toThrow()
    await expect(config.save({ mode: 'DUAL_PRINTER', endpoint: node })).rejects.toThrow()
    await expect(config.save({ mode: 'SHARED_PRINTER', endpoint: node, KITCHEN: node })).rejects.toThrow()
    await expect(config.save({ mode: 'FRONT_ONLY', endpoint: node })).rejects.toThrow('NETWORK_INITIAL_CONFIG_LOCKED')
    // Each mode uses an independent initial profile/binding/store, never a live switch.
    const frontConfig = new NetworkNodeConfig({ file: path.join(directory, 'front-only.sealed'),
      identity: { ...identity, installationId: 'installation-front', computerId: 'binding-front', storeCode: 'STORE-FRONT' },
      protector, interfaces: () => interfaces })
    await frontConfig.save({ mode: 'FRONT_ONLY', endpoint: node })
    const front = await frontConfig.read()
    expect(resolveNetworkEndpoint(front, { ...request, mode: 'FRONT_ONLY' })).toEqual(node)
    expect(() => resolveNetworkEndpoint(front, request)).toThrow('NETWORK_MODE_MISMATCH')
    expect(() => resolveNetworkEndpoint(front, { ...request, mode: 'FRONT_ONLY', role: 'KITCHEN' })).toThrow()
    expect(() => resolveNetworkEndpoint(shared, { ...request, mode: 'FRONT_ONLY' })).toThrow()
    // Old, missing-mode and corrupt profiles cannot be reinterpreted or overwritten by import.
    for (const raw of [
      JSON.stringify({ schemaVersion: 1, identity, nodes: { FRONT: node, KITCHEN: node } }),
      JSON.stringify({ schemaVersion: 2, identity, config: { endpoint: node } }),
      'corrupt profile: not JSON',
    ]) {
      const sealed = protector.protect(raw)
      await writeFile(file, sealed)
      await expect(config.read()).rejects.toThrow()
      await expect(config.save({ mode: 'SHARED_PRINTER', endpoint: node })).rejects.toThrow()
      expect(await readFile(file, 'utf8')).toBe(sealed)
    }
  })
  it('a stale concurrent initializer cannot atomically overwrite the first published endpoint', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'network-config-race-'))
    const file = path.join(directory, 'nodes.sealed')
    const temporary = `${file}.${process.pid}.tmp`
    const identity = { installationId: 'installation-race', computerId: 'binding-race', storeCode: 'STORE-RACE', boundAt: '2026-09-07' }
    const options = { file, identity, protector, interfaces: () => interfaces }
    const winner = new NetworkNodeConfig(options), loser = new NetworkNodeConfig(options)
    const missing = () => Object.assign(new Error('initial config was absent'), { code: 'ENOENT' })
    const loserReading = deferred(), winnerPublished = deferred()
    // Only the two initial reads are controlled. open/write/fsync/link/unlink are real.
    const winnerRead = vi.spyOn(winner, 'read').mockRejectedValueOnce(missing())
    const loserRead = vi.spyOn(loser, 'read').mockImplementationOnce(async () => {
      loserReading.resolve()
      await winnerPublished.promise
      throw missing()
    })
    const different = { mode: 'SHARED_PRINTER', endpoint: { ...node, host: '10.20.30.3' } }
    const losingSave = loser.save(different).then(() => undefined, (error: unknown) => error)
    try {
      await loserReading.promise
      await winner.save({ mode: 'SHARED_PRINTER', endpoint: node })
      const sealed = await readFile(file)
      await expect(lstat(temporary)).rejects.toMatchObject({ code: 'ENOENT' })
      winnerPublished.resolve()
      expect(await losingSave).toMatchObject({ code: 'EEXIST', syscall: 'link', path: temporary, dest: file })
      // The loser successfully opened and wrote a new temp file; publication itself refused to replace the winner.
      expect(JSON.parse(protector.unprotect(await readFile(temporary, 'utf8'))).config).toEqual(different)
      expect(await readFile(file)).toEqual(sealed)
      expect(winnerRead).toHaveBeenCalledTimes(1)
      expect(loserRead).toHaveBeenCalledTimes(1)
      expect(await winner.read()).toEqual({ mode: 'SHARED_PRINTER', endpoint: node })
      expect(await loser.read()).toEqual({ mode: 'SHARED_PRINTER', endpoint: node })
      expect(await readFile(file)).toEqual(sealed)
    } finally {
      winnerPublished.resolve()
      await losingSave
      winnerRead.mockRestore(); loserRead.mockRestore()
    }
  })
  it('Network client verifies binding, store, version and full snapshot hash', async () => {
    const response = clientResponse()
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(response), { status: 200 }))
    const client = new CloudRelayClient({ config: { baseUrl: 'https://relay.example' },
      credential: { installationId: 'installation-A', deviceSecret: 'test' }, network: { bindingId: 'binding-A', storeCode: 'STORE-A' }, fetchImpl })
    expect((await client.receive())?.network?.role).toBe('FRONT')
    expect(fetchImpl.mock.calls[0]).toBeDefined()
    response.job.requestHash = '0'.repeat(64)
    await expect(client.receive()).rejects.toThrow()
    response.job.requestHash = claimed().requestHash
    response.storeCode = 'STORE-B'
    await expect(client.receive()).rejects.toThrow()
    response.storeCode = 'STORE-A'; response.schemaVersion = 1
    await expect(client.receive()).rejects.toThrow()
    const legacy = new CloudRelayClient({ config: { baseUrl: 'https://relay.example' }, credential: { installationId: 'a', deviceSecret: 'b' }, fetchImpl })
    response.schemaVersion = 2
    await expect(legacy.receive()).rejects.toThrow()
  })
})

class FakeSocket extends EventEmitter {
  chunks: Buffer[] = []
  constructor(private mode: 'ok' | 'connect-fail' | 'timeout' | 'partial' | 'backpressure' | 'write-timeout') { super() }
  setNoDelay() { return this }
  connect() { queueMicrotask(() => {
    if (this.mode === 'connect-fail') this.emit('error', new Error('off'))
    else if (this.mode !== 'timeout') this.emit('connect')
  }); return this }
  write(bytes: Uint8Array, callback: (error?: Error) => void) {
    this.chunks.push(Buffer.from(bytes))
    if (this.mode === 'partial') { queueMicrotask(() => this.emit('close')); return true }
    if (this.mode === 'write-timeout') return false
    queueMicrotask(() => { callback(); if (this.mode === 'backpressure') this.emit('drain') })
    return this.mode !== 'backpressure'
  }
  end(callback: () => void) { queueMicrotask(callback); return this }
  destroy() { this.emit('close'); return this }
}
describe('bytes-only TCP transport', () => {
  it('waits for callbacks AND drain without duplicating chunks', async () => {
    const socket = new FakeSocket('backpressure')
    const transport = new NetworkRawTcpTransport({ interfaces, socketFactory: () => socket as unknown as Socket })
    const bytes = Uint8Array.from({ length: 50000 }, (_, i) => i % 256)
    const result = await transport.deliver(bytes, node)
    expect(Buffer.concat(socket.chunks)).toEqual(Buffer.from(bytes))
    expect(result).toMatchObject({ bytesWritten: bytes.length, effectBoundary: 'CROSSED', physicalCompletionKnown: false })
  })
  it.each([
    ['connect-fail', 'NOT_CROSSED'], ['timeout', 'NOT_CROSSED'],
    ['partial', 'CROSSING_UNKNOWN'], ['write-timeout', 'CROSSING_UNKNOWN'],
  ] as const)('classifies %s as %s', async (mode, boundary) => {
    const transport = new NetworkRawTcpTransport({ interfaces, timeoutMs: 20, socketFactory: () => new FakeSocket(mode) as unknown as Socket })
    await expect(transport.deliver(new Uint8Array([27, 64]), node)).rejects.toMatchObject({ effectBoundary: boundary })
  })
  it('real fake server receives identical length/SHA and survives adapter power-off/restart simulation', async () => {
    const payload = Buffer.alloc(60000, 0x37)
    let received: Buffer[] = []
    let finishReceive: () => void = () => {}
    let receivedAll = new Promise<void>(resolve => { finishReceive = resolve })
    const makeServer = () => createServer(socket => {
      socket.on('data', bytes => received.push(bytes))
      socket.on('end', () => finishReceive())
    })
    const listen = (server: Server, port = 0) => new Promise<void>((resolve, reject) => {
      server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve())
    })
    const close = (server: Server) => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    let server = makeServer(); await listen(server)
    const port = (server.address() as { port: number }).port
    // Only test connector maps already validated private endpoints to loopback fake hardware.
    const factory = () => {
      const socket = new Socket()
      const connect = socket.connect.bind(socket)
      socket.connect = (() => connect({ port, host: '127.0.0.1' })) as typeof socket.connect
      return socket
    }
    const transport = new NetworkRawTcpTransport({ interfaces, socketFactory: factory, timeoutMs: 1000 })
    try {
      await transport.deliver(payload, node); await receivedAll
      const actual = Buffer.concat(received)
      expect(actual.length).toBe(payload.length)
      expect(createHash('sha256').update(actual).digest('hex')).toBe(createHash('sha256').update(payload).digest('hex'))
      await close(server)
      await expect(transport.deliver(payload, node)).rejects.toMatchObject({ effectBoundary: 'NOT_CROSSED' })
      received = []; receivedAll = new Promise(resolve => { finishReceive = resolve })
      server = makeServer(); await listen(server, port)
      await transport.deliver(payload, node); await receivedAll
      expect(Buffer.concat(received)).toEqual(payload)
    } finally { if (server.listening) await close(server) }
  })
})

describe('shared poller/journal Network strategy', () => {
  async function harness() {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'network-journal-test-'))
    const journal = new ExecutionJournal(path.join(directory, 'journal.json'), protector)
    const delivery = vi.fn(async () => ({ bytesWritten: 2, durationMs: 1, effectBoundary: 'CROSSED' as const }))
    const prepare = vi.fn(async (_job: ReceivedPrintJob) => delivery)
    const client = { receive: vi.fn().mockResolvedValueOnce(claimed()).mockResolvedValue(null),
      markExecuting: vi.fn(async () => {}), reportResult: vi.fn(async (_job: unknown, _result: unknown) => {}) }
    const options = { client, journal, recorder: { record: vi.fn(async () => {}) }, network: { prepare,
      failure: (error: unknown) => ({ resultCode: error instanceof NetworkDeliveryError ? error.code : 'NETWORK_FAILED',
        effectBoundary: 'CROSSING_UNKNOWN' as const }) } }
    return { options, client, journal, prepare, delivery, poller: new RelayPoller(options) }
  }
  it('ACK loss and process restart replay only ACK, never bytes', async () => {
    const h = await harness()
    h.client.reportResult.mockRejectedValueOnce(new Error('lost ACK'))
    await expect(h.poller.runOnceForTest()).rejects.toThrow('lost ACK')
    const restarted = new RelayPoller({ ...h.options, journal: new ExecutionJournal(h.journal.filePath, protector) })
    await restarted.runOnceForTest(); await restarted.runOnceForTest()
    expect(h.delivery).toHaveBeenCalledTimes(1)
    expect(h.client.reportResult).toHaveBeenCalledTimes(2)
    expect(h.client.reportResult.mock.calls[1]?.[1]).toMatchObject({ resultCode: 'SUBMITTED_TO_NETWORK_SOCKET', physicalCompletionKnown: false })
  })
  it('CROSSING_UNKNOWN journal restart never prepares or writes again', async () => {
    const h = await harness()
    await h.journal.recordClaimed(claimed()); await h.journal.recordExecuting(claimed(), 'CROSSING_UNKNOWN')
    await new RelayPoller({ ...h.options, journal: new ExecutionJournal(h.journal.filePath, protector) }).runOnceForTest()
    expect(h.prepare).not.toHaveBeenCalled(); expect(h.delivery).not.toHaveBeenCalled()
    expect(h.client.reportResult.mock.calls[0]?.[1]).toMatchObject({ effectBoundary: 'CROSSING_UNKNOWN' })
  })
  it('render/config preparation failure stays before the TCP effect boundary', async () => {
    const h = await harness(); h.prepare.mockRejectedValueOnce(new Error('render failed'))
    await h.poller.runOnceForTest()
    expect(h.client.markExecuting).not.toHaveBeenCalled(); expect(h.delivery).not.toHaveBeenCalled()
    expect(h.client.reportResult.mock.calls[0]?.[1]).toMatchObject({ effectBoundary: 'NOT_CROSSED' })
  })
  it('v1 never reaches the Network transport and partial delivery is terminal', async () => {
    const h = await harness()
    h.client.receive.mockReset().mockResolvedValueOnce({ ...claimed(), schemaVersion: 1, network: undefined }).mockResolvedValueOnce(claimed()).mockResolvedValue(null)
    await h.poller.runOnceForTest(); expect(h.prepare).not.toHaveBeenCalled()
    h.delivery.mockRejectedValueOnce(new NetworkDeliveryError('NETWORK_TCP_CLOSED', 'CROSSING_UNKNOWN'))
    await h.poller.runOnceForTest(); await h.poller.runOnceForTest()
    expect(h.delivery).toHaveBeenCalledTimes(1)
  })
})

// Exercise the real shared runtime exports, with only I/O boundaries injected.
async function actualNetworkPrepare(dependencies: Parameters<typeof createNetworkStrategy>[0] & Record<string, unknown>) {
  return createNetworkStrategy(dependencies).prepare
}

async function actualNetworkGuardedClient(dependencies: Parameters<typeof createGuardedNetworkClient>[0] & Record<string, unknown>) {
  return createGuardedNetworkClient(dependencies)
}

function roleJob(role: NetworkRequest['role'], mode: NetworkMode = 'SHARED_PRINTER'): ReceivedPrintJob {
  const network = { ...request, role, mode, requestId: `${request.order.orderNo}-${mode}-${role}` }
  return { ...claimed(), id: `job-${mode}-${role}`, requestId: network.requestId, idempotencyKey: network.requestId,
    requestHash: createHash('sha256').update(JSON.stringify(network)).digest('hex'), documentName: role, network }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(complete => { resolve = complete })
  return { promise, resolve }
}

describe('single physical printer: shared runtime, timer poller, durable journal and TCP', () => {
  async function harness(jobs = [roleJob('FRONT'), roleJob('KITCHEN')], mode: NetworkMode = 'SHARED_PRINTER', pauseFirstWrite = false) {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'network-single-printer-'))
    // FRONT_ONLY and SHARED_PRINTER have distinct test identities and profile directories.
    const identity = { installationId: `installation-${mode}`, computerId: `binding-${mode}`, storeCode: `STORE-${mode}`, boundAt: '2026-09-07' }
    jobs = jobs.map(job => {
      const network = { ...job.network!, order: { ...job.network!.order, storeCode: identity.storeCode } }
      return { ...job, network, requestHash: createHash('sha256').update(JSON.stringify(network)).digest('hex') }
    })
    const configFile = path.join(directory, 'nodes.sealed')
    const nodeOptions = { file: configFile, identity, protector, interfaces: () => interfaces }
    const nodes = new NetworkNodeConfig(nodeOptions)
    await nodes.save({ mode, endpoint: node })
    const journalPath = path.join(directory, 'journal.json')
    const events: string[] = []
    const received: Buffer[][] = []
    const ended: number[] = []
    const sockets = new Set<Socket>()
    let activeConnections = 0, maximumConnections = 0
    const server = createServer(socket => {
      sockets.add(socket)
      const index = received.length
      received.push([])
      maximumConnections = Math.max(maximumConnections, ++activeConnections)
      socket.on('data', bytes => received[index].push(Buffer.from(bytes)))
      socket.on('end', () => { ended.push(index); activeConnections-- })
      socket.on('close', () => sockets.delete(socket))
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject); server.listen(0, '127.0.0.1', resolve)
    })
    const port = (server.address() as { port: number }).port
    const firstWrite = deferred()
    const targets: { host: string; port: number }[] = []
    let firstChunk = true
    const transport = new NetworkRawTcpTransport({ interfaces, timeoutMs: 2000, socketFactory: () => {
      const socket = new Socket(), connect = socket.connect.bind(socket), write = socket.write.bind(socket)
      const writeWithGate = ((bytes: Uint8Array, callback: (error?: Error | null) => void) => {
        const hold = pauseFirstWrite && firstChunk && bytes.byteLength > 0
        if (bytes.byteLength > 0) firstChunk = false
        return write(bytes, error => {
          if (hold) void firstWrite.promise.then(() => callback(error))
          else callback(error)
        })
      }) as typeof socket.write
      // Substitute only the physical connector, after production endpoint validation.
      socket.connect = ((target: { host: string; port: number }) => {
        targets.push({ host: target.host, port: target.port })
        const connecting = connect({ host: '127.0.0.1', port })
        // Node resets .write in connect(); install the callback gate afterwards.
        socket.write = writeWithGate
        return connecting
      }) as typeof socket.connect
      return socket
    } })
    const deliver = vi.spyOn(transport, 'deliver')
    const bytes = {
      FRONT: Uint8Array.from({ length: 50001 }, (_, i) => (i * 17 + 3) % 256),
      KITCHEN: Uint8Array.from({ length: 33003 }, (_, i) => (i * 13 + 11) % 256),
    }
    const render = vi.fn(async (value: NetworkRequest) => bytes[value.role])
    const pending = [...jobs]
    const role = (id?: string) => jobs.find(job => job.id === id)?.network?.role ?? 'UNKNOWN'
    const client = {
      receive: vi.fn(async () => {
        const job = pending.shift() ?? null
        if (job) events.push(`RECEIVE:${role(job.id)}`)
        return job
      }),
      markExecuting: vi.fn(async (job: Pick<ReceivedPrintJob, 'id'>) => { events.push(`EXECUTING:${role(job.id)}`) }),
      reportResult: vi.fn(async (job: Pick<ReceivedPrintJob, 'id'>, _result: TerminalResult) => { events.push(`ACK:${role(job.id)}`) }),
    }
    const recorder = { record: vi.fn(async (event: { event: string; jobId?: string }) => {
      events.push(`${event.event}:${role(event.jobId)}`)
    }) }
    const pollers: RelayPoller[] = []
    const session = async () => {
      const sessionNodes = new NetworkNodeConfig(nodeOptions)
      const journal = new ExecutionJournal(journalPath, protector)
      await journal.load() // The real main loads before creating guardedClient.
      const dependencies = { assertIdentity: async () => {}, identity, nodes: sessionNodes, journal, client,
        render, recorder, createHash, NetworkDeliveryError, transport, resolveNetworkEndpoint, validateEndpoint: async () => {} }
      const guardedClient = await actualNetworkGuardedClient(dependencies)
      const prepare = await actualNetworkPrepare(dependencies)
      const poller = new RelayPoller({ client: guardedClient, journal, recorder, intervalMs: 5, network: { prepare,
        failure: (error: unknown) => error instanceof NetworkDeliveryError
          ? { resultCode: error.code, effectBoundary: error.effectBoundary }
          : { resultCode: 'NETWORK_EXECUTION_FAILED', effectBoundary: 'CROSSING_UNKNOWN' },
      } })
      pollers.push(poller)
      return { nodes: sessionNodes, journal, guardedClient, prepare, poller }
    }
    return { nodes, configFile, identity, bytes, render, transport, deliver, client, received, ended, targets, events, firstWrite, session,
      maximumConnections: () => maximumConnections,
      async close() {
        for (const poller of pollers) poller.stop()
        firstWrite.resolve()
        for (const socket of sockets) socket.destroy()
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      },
    }
  }

  function expectIndependentBytes(h: Awaited<ReturnType<typeof harness>>) {
    expect(h.received).toHaveLength(2)
    expect(h.ended).toEqual([0, 1])
    expect(h.maximumConnections()).toBe(1)
    expect(h.targets).toEqual([node, node])
    const actual = h.received.map(chunks => Buffer.concat(chunks))
    const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')
    expect(actual.map(bytes => bytes.length)).toEqual([h.bytes.FRONT.length, h.bytes.KITCHEN.length])
    expect(actual.map(hash)).toEqual([hash(h.bytes.FRONT), hash(h.bytes.KITCHEN)])
    expect(hash(actual[0])).not.toBe(hash(actual[1]))
    expect(h.deliver.mock.calls.map(([, endpoint]) => endpoint)).toEqual([node, node])
  }

  it('FRONT_ONLY actual preparation prints FRONT once and rejects KITCHEN or mode mismatch before TCP', async () => {
    for (const [job, mode, accepted] of [
      [roleJob('FRONT', 'FRONT_ONLY'), 'FRONT_ONLY', true],
      [roleJob('KITCHEN', 'FRONT_ONLY'), 'FRONT_ONLY', false],
      [roleJob('KITCHEN'), 'FRONT_ONLY', false],
      [roleJob('FRONT'), 'FRONT_ONLY', false],
      [roleJob('FRONT', 'FRONT_ONLY'), 'SHARED_PRINTER', false],
    ] as const) {
      const h = await harness([job], mode)
      try {
        const runtime = await h.session()
        await runtime.poller.runOnceForTest()
        expect(h.render).toHaveBeenCalledTimes(accepted ? 1 : 0)
        expect(h.client.markExecuting).toHaveBeenCalledTimes(accepted ? 1 : 0)
        expect(h.deliver).toHaveBeenCalledTimes(accepted ? 1 : 0)
        if (accepted) {
          await vi.waitFor(() => expect(h.ended).toEqual([0]))
          expect(Buffer.concat(h.received[0])).toEqual(Buffer.from(h.bytes.FRONT))
          expect(h.targets).toEqual([node])
        } else {
          expect(h.received).toHaveLength(0)
          expect(h.targets).toHaveLength(0)
        }
        expect(h.client.reportResult).toHaveBeenCalledWith(expect.objectContaining({ id: job.id }), expect.objectContaining({
          state: accepted ? 'SUCCEEDED' : 'FAILED', effectBoundary: accepted ? 'CROSSED' : 'NOT_CROSSED',
          physicalCompletionKnown: false,
        }))
      } finally { await h.close() }
    }
  })

  it('timer polling waits for complete FRONT bytes and its ACK before independent KITCHEN bytes at one endpoint', async () => {
    const h = await harness(undefined, 'SHARED_PRINTER', true)
    const acknowledgeFront = deferred()
    h.client.reportResult.mockImplementationOnce(async () => { await acknowledgeFront.promise; h.events.push('ACK:FRONT') })
    try {
      const runtime = await h.session()
      runtime.poller.start(); runtime.poller.start()
      await vi.waitFor(() => expect(Buffer.concat(h.received[0] ?? []).length).toBe(16384))
      // Six normal polling intervals pass while a real TCP write callback is pending.
      await new Promise(resolve => setTimeout(resolve, 30))
      expect(h.client.receive).toHaveBeenCalledTimes(1)
      expect(h.render).toHaveBeenCalledTimes(1)
      expect(h.deliver).toHaveBeenCalledTimes(1)
      expect(h.client.reportResult).not.toHaveBeenCalled()
      h.firstWrite.resolve()
      await vi.waitFor(() => expect(h.client.reportResult).toHaveBeenCalledTimes(1))
      await vi.waitFor(() => expect(h.ended).toEqual([0]))
      await new Promise(resolve => setTimeout(resolve, 30))
      expect(h.client.receive).toHaveBeenCalledTimes(1)
      expect(h.deliver).toHaveBeenCalledTimes(1)
      expect(runtime.journal.records()[0]).toMatchObject({ state: 'TERMINAL', reported: false, effectBoundary: 'CROSSED' })
      acknowledgeFront.resolve()
      await vi.waitFor(() => expect(h.events).toContain('RESULT_ACKNOWLEDGED:KITCHEN'))
      runtime.poller.stop()
      expect(runtime.journal.records().filter(record => record.reported)).toHaveLength(2)
      await vi.waitFor(() => expect(h.ended).toEqual([0, 1]))
      expectIndependentBytes(h)
      expect(h.events.filter(event => /^(RECEIVE|NETWORK_RAW_ACCEPTED|ACK|RESULT_ACKNOWLEDGED):/.test(event))).toEqual([
        'RECEIVE:FRONT', 'NETWORK_RAW_ACCEPTED:FRONT', 'ACK:FRONT', 'RESULT_ACKNOWLEDGED:FRONT',
        'RECEIVE:KITCHEN', 'NETWORK_RAW_ACCEPTED:KITCHEN', 'ACK:KITCHEN', 'RESULT_ACKNOWLEDGED:KITCHEN',
      ])
      expect(runtime.journal.records().map(record => record.jobId).sort()).toEqual([roleJob('FRONT').id, roleJob('KITCHEN').id].sort())
    } finally { acknowledgeFront.resolve(); await h.close() }
  })

  it('lost FRONT ACK and a fresh main/journal/poller replay only ACK, then print KITCHEN once', async () => {
    const h = await harness()
    h.client.reportResult.mockRejectedValueOnce(new Error('lost FRONT ACK'))
    try {
      const first = await h.session()
      await expect(first.poller.runOnceForTest()).rejects.toThrow('lost FRONT ACK')
      await vi.waitFor(() => expect(h.ended).toEqual([0]))
      expect(first.journal.records()[0]).toMatchObject({ state: 'TERMINAL', reported: false, effectBoundary: 'CROSSED' })
      const restarted = await h.session()
      expect(restarted.journal).not.toBe(first.journal)
      await restarted.poller.runOnceForTest()
      expect(h.client.receive).toHaveBeenCalledTimes(1)
      expect(h.render).toHaveBeenCalledTimes(1)
      expect(h.deliver).toHaveBeenCalledTimes(1)
      expect(h.client.reportResult.mock.calls[1]?.[0]).toMatchObject({ id: roleJob('FRONT').id })
      expect(h.client.reportResult.mock.calls[1]?.[1]).toEqual(h.client.reportResult.mock.calls[0]?.[1])
      await restarted.poller.runOnceForTest(); await restarted.poller.runOnceForTest()
      await vi.waitFor(() => expect(h.ended).toEqual([0, 1]))
      expectIndependentBytes(h)
      expect(h.render.mock.calls.map(([value]) => value.role)).toEqual(['FRONT', 'KITCHEN'])
      expect(h.client.reportResult.mock.calls.map(([job]) => job.id)).toEqual([roleJob('FRONT').id, roleJob('FRONT').id, roleJob('KITCHEN').id])
      expect(restarted.journal.records()).toHaveLength(2)
      expect(restarted.journal.records().every(record => record.reported)).toBe(true)
      expect(h.events.indexOf('RESULT_ACKNOWLEDGED:FRONT')).toBeLessThan(h.events.indexOf('RECEIVE:KITCHEN'))
    } finally { await h.close() }
  })

  it('locks the initial profile across FRONT ACK and restart so KITCHEN keeps the original endpoint', async () => {
    const h = await harness()
    try {
      const first = await h.session()
      await first.poller.runOnceForTest()
      await vi.waitFor(() => expect(h.ended).toEqual([0]))
      expect(first.journal.records()[0]).toMatchObject({ jobId: roleJob('FRONT').id,
        state: 'TERMINAL', reported: true, effectBoundary: 'CROSSED' })
      const sealed = await readFile(h.configFile)
      const originalFile = await stat(h.configFile)
      const assertLocked = async (nodes: NetworkNodeConfig) => {
        await nodes.save({ mode: 'SHARED_PRINTER', endpoint: { ...node } })
        expect(await readFile(h.configFile)).toEqual(sealed)
        const reimportedFile = await stat(h.configFile)
        expect(reimportedFile.ino).toBe(originalFile.ino)
        expect(reimportedFile.mtimeMs).toBe(originalFile.mtimeMs)
        for (const changed of [
          { mode: 'FRONT_ONLY', endpoint: node },
          { mode: 'SHARED_PRINTER', endpoint: { ...node, host: '10.20.30.3' } },
          { mode: 'SHARED_PRINTER', endpoint: { ...node, port: 9101 } },
        ]) {
          await expect(nodes.save(changed)).rejects.toThrow('NETWORK_INITIAL_CONFIG_LOCKED')
          expect(await readFile(h.configFile)).toEqual(sealed)
        }
        expect(await nodes.read()).toEqual({ mode: 'SHARED_PRINTER', endpoint: node })
      }
      await assertLocked(first.nodes)
      expect(h.client.receive).toHaveBeenCalledTimes(1)
      expect(h.deliver).toHaveBeenCalledTimes(1)
      const restarted = await h.session()
      expect(restarted.nodes).not.toBe(first.nodes)
      expect(restarted.journal).not.toBe(first.journal)
      expect(restarted.guardedClient).not.toBe(first.guardedClient)
      expect(restarted.poller).not.toBe(first.poller)
      await assertLocked(restarted.nodes)
      await restarted.poller.runOnceForTest()
      await vi.waitFor(() => expect(h.ended).toEqual([0, 1]))
      expectIndependentBytes(h)
      expect(h.render.mock.calls.map(([value]) => value.role)).toEqual(['FRONT', 'KITCHEN'])
      expect(h.client.reportResult.mock.calls.map(([job]) => job.id)).toEqual([roleJob('FRONT').id, roleJob('KITCHEN').id])
      expect(restarted.journal.records()).toHaveLength(2)
      expect(restarted.journal.records().every(record => record.reported && record.effectBoundary === 'CROSSED')).toBe(true)
      expect(await readFile(h.configFile)).toEqual(sealed)
    } finally { await h.close() }
  })

  it('actual commercial profile refuses new setup after journal history and config loss', async () => {
    const h = await harness([roleJob('KITCHEN')])
    try {
      const directory = path.join(path.dirname(h.configFile), 'commercial-profile')
      const options = { directory, identity: h.identity, protector, interfaces: () => interfaces }
      const first = new NetworkAddonProfile(options)
      await first.open()
      const test = { id: randomUUID(), mode: 'SHARED_PRINTER' as const, endpoint: node,
        networkFingerprint: 'a'.repeat(64), hardwareAddress: '02-11-22-33-44-55', bytes: h.bytes.FRONT.byteLength,
        sha256: createHash('sha256').update(h.bytes.FRONT).digest('hex') }
      // Synthetic confirmed TEST state only; no socket/physical printer is used to establish the fixture.
      await first.beginTest(test)
      await first.finishTest(test.id, 'SUBMITTED')
      await first.confirmTest(test.id, true, false)
      const front = roleJob('FRONT')
      await first.journal.recordClaimed(front)
      await first.journal.recordTerminal(front, { state: 'FAILED', resultCode: 'NETWORK_PREPARATION_FAILED',
        effectBoundary: 'NOT_CROSSED', physicalCompletionKnown: false })
      await first.journal.markReported(front.id, front.claimAttempt)
      const journalBytes = await readFile(first.journal.filePath)
      const configFile = path.join(directory, 'nodes-1.sealed'), profileFile = path.join(directory, 'profile.sealed')
      const originalConfig = await readFile(configFile), originalProfile = await readFile(profileFile)
      // Preserve the fixture file while simulating its disappearance from the active profile.
      await rename(configFile, `${configFile}.lost-preserved`)
      const restarted = new NetworkAddonProfile(options)
      await expect(restarted.open()).rejects.toMatchObject({ code: 'ENOENT' })
      expect(restarted.journal.records()).toHaveLength(1)
      expect(await restarted.journal.pendingRecords()).toEqual([])
      const replacement = { ...test, id: randomUUID(), endpoint: { ...node, host: '10.20.30.3' } }
      // A failed profile open now latches the process closed; subsequent setup
      // cannot bypass that failure by reaching the missing node file again.
      await expect(restarted.beginTest(replacement)).rejects.toThrow('ADDON_PROFILE_BUSY_OR_FAULTED')
      const dependencies = { assertIdentity: async () => {}, identity: h.identity, nodes: restarted,
        journal: restarted.journal, client: h.client, render: h.render, recorder: { record: async () => {} },
        transport: h.transport, validateEndpoint: async () => {} }
      const guardedClient = createGuardedNetworkClient(dependencies)
      const poller = new RelayPoller({ client: guardedClient, journal: restarted.journal,
        recorder: dependencies.recorder, network: createNetworkStrategy(dependencies) })
      await expect(guardedClient.receive()).rejects.toThrow('ADDON_PROFILE_RESTART_REQUIRED')
      await expect(poller.runOnceForTest()).rejects.toThrow('ADDON_PROFILE_RESTART_REQUIRED')
      await expect(lstat(configFile)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(lstat(path.join(directory, 'nodes-2.sealed'))).rejects.toMatchObject({ code: 'ENOENT' })
      expect(h.client.receive).not.toHaveBeenCalled()
      expect(h.client.reportResult).not.toHaveBeenCalled()
      expect(h.render).not.toHaveBeenCalled()
      expect(h.deliver).not.toHaveBeenCalled()
      expect(h.targets).toHaveLength(0)
      expect(h.received).toHaveLength(0)
      expect(await readFile(`${configFile}.lost-preserved`)).toEqual(originalConfig)
      expect(await readFile(profileFile)).toEqual(originalProfile)
      expect(await readFile(restarted.journal.filePath)).toEqual(journalBytes)
    } finally { await h.close() }
  })

  it.each(['TERMINAL', 'QUARANTINED'] as const)('actual guardedClient blocks receive after reported %s CROSSING_UNKNOWN, including restart', async state => {
    const h = await harness([roleJob('KITCHEN')])
    try {
      const first = await h.session()
      const front = roleJob('FRONT')
      await first.journal.recordClaimed(front)
      await first.journal.recordExecuting(front, 'CROSSING_UNKNOWN')
      if (state === 'QUARANTINED') h.client.reportResult.mockRejectedValueOnce(new CloudRelayError('ES_TRAY_02_STALE_CLAIM', { httpStatus: 409 }))
      await first.poller.runOnceForTest()
      expect(first.journal.records()[0]).toMatchObject({ state, reported: true, effectBoundary: 'CROSSING_UNKNOWN' })
      expect(await first.journal.pendingRecords()).toEqual([])
      await expect(first.guardedClient.receive()).rejects.toThrow('NETWORK_UNCERTAIN_EFFECT_REQUIRES_REVIEW')
      await expect(first.poller.runOnceForTest()).rejects.toThrow('NETWORK_UNCERTAIN_EFFECT_REQUIRES_REVIEW')
      const restarted = await h.session()
      expect(restarted.journal.records()[0]).toMatchObject({ state, reported: true, effectBoundary: 'CROSSING_UNKNOWN' })
      await expect(restarted.guardedClient.receive()).rejects.toThrow('NETWORK_UNCERTAIN_EFFECT_REQUIRES_REVIEW')
      await expect(restarted.poller.runOnceForTest()).rejects.toThrow('NETWORK_UNCERTAIN_EFFECT_REQUIRES_REVIEW')
      expect(h.client.receive).not.toHaveBeenCalled()
      expect(h.client.reportResult).toHaveBeenCalledTimes(1)
      expect(h.render).not.toHaveBeenCalled()
      expect(h.deliver).not.toHaveBeenCalled()
      expect(h.received).toHaveLength(0)
    } finally { await h.close() }
  })

  it.each(['mode', 'host', 'port'] as const)('changing sealed config %s after rendering prevents any TCP delivery', async changed => {
    const h = await harness([roleJob('FRONT')])
    h.render.mockImplementationOnce(async () => {
      // Simulate an out-of-band disk change with the test protector; save() must never permit this switch.
      await writeFile(h.configFile, protector.protect(JSON.stringify({ schemaVersion: 2, identity: h.identity, config: {
        mode: changed === 'mode' ? 'FRONT_ONLY' : 'SHARED_PRINTER',
        endpoint: { host: changed === 'host' ? '10.20.30.3' : node.host, port: changed === 'port' ? 9101 : node.port },
      } })))
      return h.bytes.FRONT
    })
    try {
      const runtime = await h.session()
      await runtime.poller.runOnceForTest()
      expect(h.render).toHaveBeenCalledTimes(1)
      expect(h.client.markExecuting).toHaveBeenCalledTimes(1)
      expect(h.deliver).not.toHaveBeenCalled()
      expect(h.targets).toHaveLength(0)
      expect(h.received).toHaveLength(0)
      expect(h.client.reportResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        state: 'FAILED', resultCode: 'NETWORK_CONFIG_CHANGED', effectBoundary: 'NOT_CROSSED', physicalCompletionKnown: false,
      }))
      expect(runtime.journal.records()[0]).toMatchObject({ state: 'TERMINAL', reported: true, effectBoundary: 'NOT_CROSSED' })
    } finally { await h.close() }
  })
})

describe('actual shared preparation: diagnostic failure versus mandatory journal', () => {
  async function harness(role: 'FRONT' | 'KITCHEN', logCode?: string) {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'network-r3-journal-'))
    const journal = new ExecutionJournal(path.join(directory, 'journal.json'), protector)
    const socket = new FakeSocket('backpressure')
    const transport = new NetworkRawTcpTransport({ interfaces, socketFactory: () => socket as unknown as Socket })
    const deliver = vi.spyOn(transport, 'deliver')
    const bytes = Uint8Array.from({ length: 20000 }, (_, i) => i % 256)
    const render = vi.fn(async () => bytes)
    const recorder = { record: vi.fn(async (_event: { event: string }) => {
      if (logCode) throw Object.assign(new Error('injected diagnostic failure'), { code: logCode })
    }) }
    const prepare = await actualNetworkPrepare({
      assertIdentity: async () => {}, identity: { storeCode: request.order.storeCode },
      nodes: { read: async () => ({ mode: 'SHARED_PRINTER', endpoint: node }) },
      render, recorder, createHash, NetworkDeliveryError, transport, resolveNetworkEndpoint, validateEndpoint: async () => {},
    })
    const client = { receive: vi.fn().mockResolvedValueOnce({ ...claimed(), network: { ...request, role } }).mockResolvedValue(null),
      markExecuting: vi.fn(async () => {}), reportResult: vi.fn(async (_job: unknown, _result: unknown) => {}) }
    const options = { client, journal, recorder, network: { prepare,
      failure: (error: unknown) => ({ resultCode: error instanceof NetworkDeliveryError ? error.code : 'NETWORK_EXECUTION_FAILED',
        effectBoundary: error instanceof NetworkDeliveryError ? error.effectBoundary : 'CROSSING_UNKNOWN' as const }) } }
    return { ...options, options, socket, bytes, render, deliver, poller: new RelayPoller(options) }
  }

  it.each([
    ['FRONT', 'EACCES'], ['KITCHEN', 'EACCES'], ['FRONT', 'ENOSPC'], ['KITCHEN', 'ENOSPC'],
  ] as const)('%s still submits once when actual preparation logging throws %s', async (role, code) => {
    const h = await harness(role, code)
    await h.poller.runOnceForTest()
    expect(h.recorder.record).toHaveBeenCalledWith(expect.objectContaining({ event: `NETWORK_PREPARED_${role}` }))
    expect(h.deliver).toHaveBeenCalledTimes(1)
    expect(h.deliver.mock.calls[0]?.[1]).toEqual(node)
    expect(Buffer.concat(h.socket.chunks)).toEqual(Buffer.from(h.bytes))
    expect(h.client.reportResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      state: 'SUCCEEDED', resultCode: 'SUBMITTED_TO_NETWORK_SOCKET', effectBoundary: 'CROSSED', physicalCompletionKnown: false,
    }))
    expect(h.journal.records()[0]).toMatchObject({ state: 'TERMINAL', reported: true })
  })

  it.each(['CLAIMED', 'NOT_CROSSED', 'CROSSING_UNKNOWN'] as const)('journal persist failure at %s still prevents TCP delivery', async stage => {
    const h = await harness('FRONT', 'EACCES')
    // Make the journal parent unavailable immediately before the selected durable write.
    // This exercises real ExecutionJournal filesystem persistence, not only a rejected mock.
    const { rename } = await import('node:fs/promises')
    const block = async () => {
      const parent = path.dirname(h.journal.filePath)
      await rename(parent, `${parent}-preserved`)
      await writeFile(parent, 'injected non-directory journal parent')
    }
    if (stage === 'CLAIMED') {
      await h.journal.load()
      await block()
    } else {
      const executing = h.journal.recordExecuting.bind(h.journal)
      vi.spyOn(h.journal, 'recordExecuting').mockImplementation(async (job, boundary) => {
        if (boundary === stage) await block()
        return executing(job, boundary)
      })
    }
    await expect(h.poller.runOnceForTest()).rejects.toThrow()
    expect(h.deliver).not.toHaveBeenCalled()
    expect(h.socket.chunks).toHaveLength(0)
    expect(h.client.reportResult).not.toHaveBeenCalled()
    expect(h.client.markExecuting).toHaveBeenCalledTimes(stage === 'CROSSING_UNKNOWN' ? 1 : 0)
  })

  it('diagnostic failure plus ACK loss/restart repeats only ACK, never actual preparation or bytes', async () => {
    const h = await harness('FRONT', 'EACCES')
    h.client.reportResult.mockRejectedValueOnce(new Error('lost ACK'))
    await expect(h.poller.runOnceForTest()).rejects.toThrow('lost ACK')
    const restarted = new RelayPoller({ ...h.options, journal: new ExecutionJournal(h.journal.filePath, protector) })
    await restarted.runOnceForTest(); await restarted.runOnceForTest()
    expect(h.render).toHaveBeenCalledTimes(1)
    expect(h.deliver).toHaveBeenCalledTimes(1)
    expect(h.client.reportResult).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['CLAIMED', 1], ['NOT_CROSSED', 2], ['CROSSING_UNKNOWN', 3],
  ] as const)('required fsync failure at %s prevents TCP even after a final-file rename', async (_stage, write) => {
    for (const phase of ['temporary', 'final'] as const) {
      for (const code of ['EPERM', 'EIO']) {
        const h = await harness('FRONT', 'EACCES')
        Object.assign(syncFault, { file: h.journal.filePath, write, count: 0, phase, code, hits: 0 })
        try {
          await expect(h.poller.runOnceForTest()).rejects.toMatchObject({ code })
          expect(syncFault.hits).toBe(1)
          expect(h.deliver).not.toHaveBeenCalled()
          expect(h.socket.chunks).toHaveLength(0)
          expect(h.client.reportResult).not.toHaveBeenCalled()
          expect(h.client.markExecuting).toHaveBeenCalledTimes(write === 3 ? 1 : 0)
        } finally { syncFault.file = ''; syncFault.phase = '' }
        // A fresh process must recover the last fully written record, never
        // regenerate bytes for work which may have crossed the effect boundary.
        const recovered = new ExecutionJournal(h.journal.filePath, protector)
        const records = await recovered.pendingRecords()
        if (write === 1 && phase === 'temporary') expect(records).toHaveLength(0)
        else {
          expect(records).toHaveLength(1)
          const crossed = write === 3 && phase === 'final'
          if (crossed) expect(records[0]).toMatchObject({ state: 'EXECUTING', effectBoundary: 'CROSSING_UNKNOWN' })
          // This fresh-instance restart shares the test PID. Advance its clock
          // so a failed temp file from the same millisecond is not reused;
          // a real restarted process has a new PID. Preserve the failed file.
          const restartClock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000)
          try { await new RelayPoller({ ...h.options, journal: recovered }).runOnceForTest() }
          finally { restartClock.mockRestore() }
          expect(h.deliver).not.toHaveBeenCalled()
          expect(h.socket.chunks).toHaveLength(0)
          if (crossed) expect(h.client.reportResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            state: 'FAILED', effectBoundary: 'CROSSING_UNKNOWN', physicalCompletionKnown: false,
          }))
        }
      }
    }
  })

  it('actual preparation still rejects rendering errors before TCP', async () => {
    const h = await harness('FRONT', 'EACCES')
    h.render.mockRejectedValueOnce(new Error('render failed'))
    await h.poller.runOnceForTest()
    expect(h.deliver).not.toHaveBeenCalled()
    expect(h.client.markExecuting).not.toHaveBeenCalled()
    expect(h.client.reportResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      state: 'FAILED', resultCode: 'NETWORK_PREPARATION_FAILED', effectBoundary: 'NOT_CROSSED',
    }))
  })
})

it.skipIf(!process.env.NETWORK_RENDER_SMOKE_BUNDLE)('real sandboxed Electron shared renderer → fake TCP bytes match for both roles', async () => {
  const bundle = process.env.NETWORK_RENDER_SMOKE_BUNDLE!
  const directory = await mkdtemp(path.join(os.tmpdir(), 'network-render-smoke-'))
  const harness = path.join(directory, 'main.cjs')
  await writeFile(harness, `
    const {app,BrowserWindow,ipcMain}=require('electron');
    const path=require('node:path');
    app.setPath('userData',${JSON.stringify(path.join(directory, 'userData'))});
    const results=[]; let role=0; const roles=['FRONT','KITCHEN'];
    const request=${JSON.stringify(request)};
    const timer=setTimeout(()=>{console.error('RENDER_SMOKE_TIMEOUT');app.exit(1)},20000);
    app.whenReady().then(async()=>{
      const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,
        backgroundThrottling:false,preload:path.join(${JSON.stringify(bundle)},'network-render.cjs')}});
      win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>cb({cancel:true}));
      win.webContents.on('console-message',(_e,_level,message)=>console.error(message));
      win.webContents.on('preload-error',(_e,_p,error)=>console.error(error));
      const send=()=>win.webContents.send('network:render',{renderId:'00000000-0000-0000-0000-000000000001',request:{...request,role:roles[role]}});
      ipcMain.on('network:rendered',(event,value)=>{
        if(event.sender!==win.webContents)return;
        if(value.error){console.error(value.error);app.exit(1);return}
        results.push({role:roles[role],bytes:Buffer.from(value.bytes).toString('base64')});
        role++; if(role<roles.length)send();else{clearTimeout(timer);console.log('NETWORK_RENDER_SMOKE '+JSON.stringify(results));app.exit(0)}
      });
      await win.loadFile(path.join(${JSON.stringify(bundle)},'network-render.html'));send();
    }).catch(error=>{console.error(error);app.exit(1)});
  `)
  const binary = createRequire(path.resolve(__dirname, '../package.json'))('electron') as string
  const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE
  const { stdout } = await promisify(execFile)(binary, [harness], { env: environment, timeout: 30000, maxBuffer: 4 * 1024 * 1024 })
  const line = stdout.split('\n').find(line => line.startsWith('NETWORK_RENDER_SMOKE '))
  expect(line).toBeDefined()
  const outputs = JSON.parse(line!.slice('NETWORK_RENDER_SMOKE '.length)) as { role: string; bytes: string }[]
  expect(outputs.map(output => output.role)).toEqual(['FRONT', 'KITCHEN'])
  for (const output of outputs) {
    const expected = Buffer.from(output.bytes, 'base64')
    expect([...expected.subarray(0, 2)]).toEqual([27, 64])
    expect([...expected.subarray(-3)]).toEqual([29, 86, 0])
    const received: Buffer[] = []
    let done: () => void = () => {}
    const complete = new Promise<void>(resolve => { done = resolve })
    const server = createServer(socket => { socket.on('data', bytes => received.push(bytes)); socket.on('end', done) })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    try {
      const transport = new NetworkRawTcpTransport({ interfaces, socketFactory: () => {
        const socket = new Socket(), connect = socket.connect.bind(socket)
        socket.connect = (() => connect({ host: '127.0.0.1', port })) as typeof socket.connect
        return socket
      } })
      await transport.deliver(expected, node); await complete
      const digest = createHash('sha256').update(expected).digest('hex')
      expect(Buffer.concat(received).length).toBe(expected.length)
      expect(createHash('sha256').update(Buffer.concat(received)).digest('hex')).toBe(digest)
      console.log(`${output.role} Renderer → TCP: ${expected.length} bytes SHA256=${digest}`)
    } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
  }
}, 35000)
