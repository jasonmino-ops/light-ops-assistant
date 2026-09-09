import { EventEmitter } from 'node:events'
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { PassThrough } from 'node:stream'
import type os from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReceivedPrintJob } from '../src/cloudRelayClient'
import { NETWORK_PROFILE, type NetworkRequest } from '../src/networkContract'
import { createGuardedNetworkClient, createNetworkStrategy } from '../src/networkRuntime'
import {
  assertNetworkSnapshotCurrent, createLocalNetworkSnapshot, discoverNetworkPrinters, getWindowsLocalNetworks,
  NETWORK_DISCOVERY_LIMITS, snapshotFingerprint, validateLocalPrinterEndpoint, WINDOWS_NETWORK_METADATA_COMMAND,
  readLocalPrinterHardware, assertConfirmedPrinter, networkContinuityFingerprint, withWindowsValidationSnapshots,
  type DiscoverySocket, type LocalNetworkSnapshot, type NetworkDiscoveryDependencies,
} from '../src/networkDiscovery'

vi.mock('node:child_process', () => ({ execFile: vi.fn(), spawn: vi.fn() }))

type Interfaces = ReturnType<typeof os.networkInterfaces>
function metadata(prefix = 24, local = '192.168.18.41', network = '192.168.18.0') {
  return {
    adapters: [{ interfaceIndex: 7, name: 'Ethernet', description: 'Realtek PCIe GbE', interfaceType: 6,
      hardwareInterface: true, virtual: false, status: 'Up' }],
    addresses: [{ interfaceIndex: 7, address: local, prefixLength: prefix, addressState: 'Preferred', skipAsSource: false }],
    routes: [{ interfaceIndex: 7, destinationPrefix: `${network}/${prefix}`, nextHop: '0.0.0.0', routeMetric: 256, interfaceMetric: 10 },
      { interfaceIndex: 7, destinationPrefix: '0.0.0.0/0', nextHop: '192.168.18.1', routeMetric: 0, interfaceMetric: 10 }],
  }
}
function interfaces(prefix = 24, local = '192.168.18.41'): Interfaces {
  const mask = (0xffffffff << (32 - prefix)) >>> 0
  return { Ethernet: [{ address: local, netmask: [24, 16, 8, 0].map(shift => (mask >>> shift) & 255).join('.'),
    family: 'IPv4', internal: false, mac: '', cidr: `${local}/${prefix}` }] }
}
function snapshot(prefix = 24, local = '192.168.18.41', network = '192.168.18.0') {
  return createLocalNetworkSnapshot(metadata(prefix, local, network), interfaces(prefix, local))
}
function fakeDependencies(snap: LocalNetworkSnapshot, behavior: 'open' | 'closed' | 'timeout' | 'hang' = 'open') {
  const sockets: FakeSocket[] = [], connects: Parameters<DiscoverySocket['connect']>[0][] = []
  let active = 0, maximum = 0
  class FakeSocket extends EventEmitter implements DiscoverySocket {
    destroyed = false
    timeout = 0
    // An accidental payload or protocol query causes an immediate test failure.
    write = vi.fn(() => { throw new Error('Discovery must not write application bytes') })
    end = vi.fn(() => { throw new Error('Discovery must destroy without an application payload') })
    setTimeout(timeout: number) { this.timeout = timeout; return this }
    connect(options: Parameters<DiscoverySocket['connect']>[0]) {
      connects.push(options); active++; maximum = Math.max(maximum, active)
      if (behavior !== 'hang') queueMicrotask(() => {
        if (!this.destroyed) this.emit(behavior === 'open' ? 'connect' : behavior === 'closed' ? 'error' : 'timeout')
      })
      return this
    }
    destroy() { if (!this.destroyed) { this.destroyed = true; active--; this.emit('close') }; return this }
  }
  const deps: NetworkDiscoveryDependencies = {
    getSnapshot: vi.fn(async () => snap),
    createSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket },
  }
  return { deps, sockets, connects, maximum: () => maximum, active: () => active }
}

function fakeMetadataProcess(raw: ReturnType<typeof metadata> | ((read: number) => ReturnType<typeof metadata>),
  lateFault: 'none' | 'stderr' | 'stdout' | 'exit' | 'hang' | 'unclosed' = 'none', delay = 0,
  options: { readTimeoutAt?: number; onCleanup?: () => void } = {}) {
  const child = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> }
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough()
  let closed = false
  const requests: string[] = []
  const finish = (exit: number | null, signal: string | null) => {
    if (closed) return
    closed = true; child.emit('exit', exit, signal); child.emit('close', exit, signal)
  }
  child.kill = vi.fn(() => { if (lateFault !== 'unclosed') queueMicrotask(() => finish(null, 'SIGKILL')); return true })
  child.stdin.on('data', chunk => {
    const request = String(chunk).trim(); requests.push(request)
    if (requests.length === options.readTimeoutAt) return
    const reply = () => { if (!closed) child.stdout.write(`${request}\t${JSON.stringify(typeof raw === 'function' ? raw(requests.length) : raw)}\r\n`) }
    if (delay) setTimeout(reply, delay); else queueMicrotask(reply)
  })
  child.stdin.on('finish', () => queueMicrotask(() => {
    options.onCleanup?.()
    if (lateFault === 'hang' || lateFault === 'unclosed') return
    if (lateFault === 'stderr') child.stderr.write('unexpected local metadata failure')
    if (lateFault === 'stdout') child.stdout.write('unexpected late frame\n')
    finish(lateFault === 'exit' ? 1 : 0, null)
  }))
  vi.mocked(spawn).mockReturnValueOnce(child as unknown as ChildProcessWithoutNullStreams)
  return { child, requests, finish }
}

afterEach(() => vi.useRealTimers())

describe('physical Windows LAN metadata and endpoint restrictions', () => {
  it('different confirmed topology rejects before even reading selected-device hardware', async () => {
    const snap = snapshot(), read = vi.fn(async () => '02-11-22-33-44-55')
    await expect(assertConfirmedPrinter({ host: '192.168.18.53', port: 9100 },
      { networkFingerprint: 'b'.repeat(64), hardwareAddress: '02-11-22-33-44-55' }, snap, read)).rejects.toThrow('NETWORK_CHANGED')
    expect(read).not.toHaveBeenCalled()
  })
  it('identical topology and private IP with a different physical MAC still cannot print', async () => {
    const snap = snapshot(), read = vi.fn(async () => '02-99-88-77-66-55')
    const proof = { networkFingerprint: networkContinuityFingerprint(snap), hardwareAddress: '02-11-22-33-44-55' }
    await expect(assertConfirmedPrinter({ host: '192.168.18.53', port: 9100 }, proof, snap, read)).rejects.toThrow('NETWORK_DEVICE_CHANGED')
    read.mockResolvedValueOnce(proof.hardwareAddress)
    expect(await assertConfirmedPrinter({ host: '192.168.18.53', port: 9100 }, proof, snap, read, async () => snap)).toMatchObject({ host: '192.168.18.53' })
  })
  it('rejects a route change while waiting for selected-device ARP, even when the MAC matches', async () => {
    const before = snapshot(), changed = metadata()
    changed.routes.push({ interfaceIndex: 99, destinationPrefix: '192.168.18.53/32', nextHop: '0.0.0.0', routeMetric: 1, interfaceMetric: 1 })
    const after = createLocalNetworkSnapshot(changed, interfaces())
    let release!: () => void
    const wait = new Promise<void>(resolve => { release = resolve })
    const read = vi.fn(async () => { await wait; return '02-11-22-33-44-55' })
    const pending = assertConfirmedPrinter({ host: '192.168.18.53', port: 9100 },
      { networkFingerprint: networkContinuityFingerprint(before), hardwareAddress: '02-11-22-33-44-55' }, before, read, async () => after)
    release()
    await expect(pending).rejects.toThrow('NETWORK_CHANGED')
  })
  it('selected-device ARP uses only validated numeric source/destination, not a hostname or TCP payload', async () => {
    const run = vi.fn(async (_script: string) => '02-11-22-33-44-55\r\n')
    expect(await readLocalPrinterHardware('192.168.18.53', 9100, snapshot(), { platform: () => 'win32', run })).toBe('02-11-22-33-44-55')
    expect(run.mock.calls[0][0]).toContain('SendARP')
    expect(run.mock.calls[0][0]).not.toContain('192.168.18.53')
    expect(run.mock.calls[0][0]).not.toMatch(/socket|tcp|escpos|http|Remove-Net|Set-Net/i)
    await expect(readLocalPrinterHardware('printer.example;exit', 9100, snapshot(), { platform: () => 'win32', run })).rejects.toThrow()
    expect(run).toHaveBeenCalledTimes(1)
  })
  it.each(['', 'ff-ff-ff-ff-ff-ff', '00-00-00-00-00-00', '01-11-22-33-44-55', 'not-a-mac'])('rejects unavailable or special hardware identity %s', async value => {
    await expect(readLocalPrinterHardware('192.168.18.53', 9100, snapshot(), { platform: () => 'win32', run: async () => value })).rejects.toThrow('NETWORK_DEVICE_IDENTITY_UNAVAILABLE')
  })
  it('uses constant local PowerShell metadata commands without remote sessions or target interpolation', () => {
    expect(WINDOWS_NETWORK_METADATA_COMMAND).toContain('Get-NetAdapter -Physical')
    expect(WINDOWS_NETWORK_METADATA_COMMAND).toContain('Get-NetRoute -AddressFamily IPv4 -PolicyStore ActiveStore')
    expect(WINDOWS_NETWORK_METADATA_COMMAND).toContain('Get-NetIPAddress -AddressFamily IPv4')
    expect(WINDOWS_NETWORK_METADATA_COMMAND).not.toMatch(/CimSession|ComputerName|Invoke-Expression|Test-NetConnection|Resolve-DnsName|Send|SCAN|PJL|SNMP|http/i)
  })

  it('executes exactly one bounded constant PowerShell command without a shell', async () => {
    vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
      const callback = args[3] as (error: null, stdout: string, stderr: string) => void
      callback(null, JSON.stringify(metadata()), '')
      return {} as ReturnType<typeof execFile>
    })
    const snap = await getWindowsLocalNetworks({ platform: () => 'win32', interfaces: () => interfaces() })
    expect(snap.networks).toHaveLength(1)
    expect(execFile).toHaveBeenCalledWith('powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_NETWORK_METADATA_COMMAND],
      expect.objectContaining({ windowsHide: true, timeout: 5000, maxBuffer: 1024 * 1024, encoding: 'utf8' }), expect.any(Function))
    expect(vi.mocked(execFile).mock.calls.at(-1)?.[2]).not.toHaveProperty('shell')
  })

  it('accepts a physical Ethernet adapter, freezes metadata and supports strict manual ports', () => {
    const snap = snapshot()
    expect(snap.networks).toHaveLength(1)
    expect(Object.isFrozen(snap.routes)).toBe(true)
    expect(Object.isFrozen(snap.networks[0])).toBe(true)
    expect(validateLocalPrinterEndpoint('192.168.18.53', '9200', snap)).toEqual({
      host: '192.168.18.53', port: 9200, localAddress: '192.168.18.41', interfaceIndex: 7, snapshotFingerprint: snap.fingerprint,
    })
    for (const port of [1, 65535]) expect(validateLocalPrinterEndpoint('192.168.18.53', port, snap).port).toBe(port)
  })

  it('accepts an actual physical Wi-Fi interface with matching Node alias and address', () => {
    const raw = metadata(); raw.adapters[0].interfaceType = 71; raw.adapters[0].name = 'Wi-Fi'
    const snap = createLocalNetworkSnapshot(raw, { 'Wi-Fi': interfaces().Ethernet })
    expect(validateLocalPrinterEndpoint('192.168.18.53', 9100, snap).interfaceIndex).toBe(7)
  })

  it.each(['printer.local', 'localhost', '192.168.018.53', '192.168.18.53 ', ' 192.168.18.53',
    '3232240181', '0xc0a81235', '192.168.18.256', '::1', '192.168.18.53;whoami', '192.168.18.53/24'])('rejects noncanonical IPv4 %s', host => {
    expect(() => validateLocalPrinterEndpoint(host, 9100, snapshot())).toThrow('NETWORK_IPV4_LITERAL_REQUIRED')
  })

  it.each(['0', '09100', '9100 ', '9.1e3', '9100;whoami', '-1', '', 0, 65536, 9100.5, NaN, null])('rejects invalid manual port %s', port => {
    expect(() => validateLocalPrinterEndpoint('192.168.18.53', port, snapshot())).toThrow('NETWORK_INVALID_PORT')
  })

  it.each(['127.0.0.1', '169.254.1.4', '8.8.8.8', '224.0.0.1', '255.255.255.255', '100.64.1.1', '172.32.1.4'])('rejects non-RFC1918 %s', host => {
    expect(() => validateLocalPrinterEndpoint(host, 9100, snapshot())).toThrow('NETWORK_RFC1918_REQUIRED')
  })

  it('rejects self, gateways, network/broadcast addresses and other subnets', () => {
    for (const host of ['192.168.18.41', '192.168.18.1', '192.168.18.0', '192.168.18.255', '192.168.19.53', '10.0.0.5']) {
      expect(() => validateLocalPrinterEndpoint(host, 9100, snapshot())).toThrow()
    }
    const snap = snapshot(25, '192.168.18.41', '192.168.18.0')
    expect(() => validateLocalPrinterEndpoint('192.168.18.127', 9100, snap)).toThrow('NETWORK_DIRECT_PHYSICAL_LAN_REQUIRED')
  })

  it.each([
    { hardwareInterface: false }, { virtual: true }, { status: 'Disconnected' }, { interfaceType: 131 },
    { name: 'Tailscale' }, { description: 'WireGuard Tunnel' }, { description: 'Hyper-V Virtual Ethernet' },
    { description: 'Bluetooth PAN' }, { description: 'TAP-Windows Adapter' },
  ])('excludes virtual, VPN or unavailable adapters %j', override => {
    const raw = metadata(); Object.assign(raw.adapters[0], override)
    expect(createLocalNetworkSnapshot(raw, interfaces()).networks).toEqual([])
  })

  it('rejects missing direct route, Node mismatch, tentative or skip-as-source address', () => {
    const noRoute = metadata(); noRoute.routes.shift()
    expect(createLocalNetworkSnapshot(noRoute, interfaces()).networks).toEqual([])
    expect(createLocalNetworkSnapshot(metadata(), interfaces(24, '192.168.18.42')).networks).toEqual([])
    const notReady = metadata(); notReady.addresses[0].addressState = 'Tentative'
    expect(createLocalNetworkSnapshot(notReady, interfaces()).networks).toEqual([])
    notReady.addresses[0].addressState = 'Preferred'; notReady.addresses[0].skipAsSource = true
    expect(createLocalNetworkSnapshot(notReady, interfaces()).networks).toEqual([])
  })

  it.each([
    { destinationPrefix: '192.168.18.53/32', interfaceIndex: 99, nextHop: '0.0.0.0' },
    { destinationPrefix: '192.168.18.0/25', interfaceIndex: 7, nextHop: '192.168.18.2' },
    { destinationPrefix: '192.168.18.0/24', interfaceIndex: 99, nextHop: '0.0.0.0' },
  ])('rejects specific routes that leave the direct physical interface %j', override => {
    const raw = metadata(); raw.routes.push({ ...raw.routes[0], ...override })
    const snap = createLocalNetworkSnapshot(raw, interfaces())
    expect(() => validateLocalPrinterEndpoint('192.168.18.53', 9100, snap)).toThrow('NETWORK_ROUTE_ESCAPE')
  })

  it('does not mistake a less-specific default route for a route escaping the connected subnet', () => {
    const raw = metadata(); raw.routes.push({ ...raw.routes[0], interfaceIndex: 99, destinationPrefix: '128.0.0.0/1' })
    expect(validateLocalPrinterEndpoint('192.168.18.53', 9100, createLocalNetworkSnapshot(raw, interfaces())).host).toBe('192.168.18.53')
  })

  it('rejects ambiguous overlapping physical interfaces', () => {
    const raw = metadata()
    raw.adapters.push({ ...raw.adapters[0], interfaceIndex: 8, name: 'Wi-Fi', interfaceType: 71 })
    raw.addresses.push({ ...raw.addresses[0], interfaceIndex: 8, address: '192.168.18.42' })
    raw.routes.push({ ...raw.routes[0], interfaceIndex: 8 })
    const snap = createLocalNetworkSnapshot(raw, { ...interfaces(), 'Wi-Fi': interfaces(24, '192.168.18.42').Ethernet })
    expect(() => validateLocalPrinterEndpoint('192.168.18.53', 9100, snap)).toThrow('NETWORK_AMBIGUOUS_INTERFACE')
  })

  it('bounds malformed metadata and refuses duplicate adapter identities', () => {
    expect(() => createLocalNetworkSnapshot({}, interfaces())).toThrow('NETWORK_METADATA_LIMIT')
    const raw = metadata(); raw.adapters.push({ ...raw.adapters[0] })
    expect(() => createLocalNetworkSnapshot(raw, interfaces())).toThrow('NETWORK_METADATA_INVALID')
    raw.adapters.pop(); raw.routes[0].destinationPrefix = '192.168.18.41/24'
    expect(() => createLocalNetworkSnapshot(raw, interfaces())).toThrow('NETWORK_METADATA_INVALID')
    expect(() => createLocalNetworkSnapshot({ ...metadata(), routes: Array(4097).fill(metadata().routes[0]) }, interfaces())).toThrow('NETWORK_METADATA_LIMIT')
  })

  it('fingerprint ignores enumeration order and time, but includes local IP and route changes', () => {
    const raw = metadata(), first = createLocalNetworkSnapshot(raw, interfaces())
    raw.routes.reverse()
    expect(createLocalNetworkSnapshot(raw, interfaces(), first.capturedAt + 1000).fingerprint).toBe(first.fingerprint)
    raw.routes[0].routeMetric++
    expect(createLocalNetworkSnapshot(raw, interfaces()).fingerprint).not.toBe(first.fingerprint)
    expect(snapshotFingerprint(first)).toBe(first.fingerprint)
    expect(() => validateLocalPrinterEndpoint('192.168.18.53', 9100, { ...first, fingerprint: '0'.repeat(64) })).toThrow('NETWORK_SNAPSHOT_INVALID')
    expect(() => validateLocalPrinterEndpoint('192.168.18.53', 9100, { ...first, capturedAt: Date.now() - 60_001 })).toThrow('NETWORK_SNAPSHOT_STALE')
  })

  it('loads only Windows local metadata and detects Node interfaces changing during metadata capture', async () => {
    const readMetadata = vi.fn(async () => metadata())
    await expect(getWindowsLocalNetworks({ platform: () => 'darwin', readMetadata })).rejects.toThrow('NETWORK_WINDOWS_REQUIRED')
    expect(readMetadata).not.toHaveBeenCalled()
    const local = vi.fn().mockReturnValueOnce(interfaces()).mockReturnValueOnce(interfaces(24, '192.168.18.42'))
    await expect(getWindowsLocalNetworks({ platform: () => 'win32', interfaces: local, readMetadata })).rejects.toThrow('NETWORK_CHANGED')
    const snap = await getWindowsLocalNetworks({ platform: () => 'win32', interfaces: () => interfaces(), readMetadata })
    expect(snap.networks).toHaveLength(1)
  })

  it('refreshes an aged snapshot, but rejects changed routes before TEST or runtime reuse', async () => {
    const original = snapshot(), aged = { ...original, capturedAt: Date.now() - 90_000 }
    await expect(assertNetworkSnapshotCurrent(aged, { getSnapshot: async () => original })).resolves.toEqual(original)
    const raw = metadata(); raw.routes[1].nextHop = '192.168.18.2'
    await expect(assertNetworkSnapshotCurrent(original, { getSnapshot: async () => createLocalNetworkSnapshot(raw, interfaces()) })).rejects.toThrow('NETWORK_CHANGED')
  })

  it('native Wi-Fi automatic metric drift changes full integrity SHA, not direct-path continuity', async () => {
    const raw = metadata(); raw.routes.forEach(route => { route.interfaceMetric = 50 })
    const before = createLocalNetworkSnapshot(raw, interfaces())
    raw.routes.forEach(route => { route.interfaceMetric = 45; route.routeMetric++ })
    const after = createLocalNetworkSnapshot(raw, interfaces())
    expect(before.fingerprint).not.toBe(after.fingerprint)
    expect(networkContinuityFingerprint(before)).toBe(networkContinuityFingerprint(after))
    await expect(assertNetworkSnapshotCurrent(before, { getSnapshot: async () => after })).resolves.toBe(after)
    const read = vi.fn(async () => '02-11-22-33-44-55')
    const proof = { networkFingerprint: networkContinuityFingerprint(before), hardwareAddress: '02-11-22-33-44-55' }
    await expect(assertConfirmedPrinter({ host: '192.168.18.53', port: 9100 }, proof, after, read, async () => before)).resolves.toMatchObject({ localAddress: '192.168.18.41' })
    expect(read).toHaveBeenCalledTimes(1)
  })

  it.each([-1, 0.5, NaN, Infinity, 0x100000000, '45'])('still rejects invalid metrics %s before continuity', value => {
    for (const field of ['routeMetric', 'interfaceMetric'] as const) {
      const raw = metadata(); (raw.routes[0] as Record<string, unknown>)[field] = value
      expect(() => createLocalNetworkSnapshot(raw, interfaces())).toThrow('NETWORK_METADATA_INVALID')
    }
  })

  it('metric tampering without a new full integrity checksum still fails before hardware lookup', async () => {
    const before = snapshot(), forged = { ...before, routes: before.routes.map(route => ({ ...route, interfaceMetric: 45 })) }
    expect(() => networkContinuityFingerprint(forged)).toThrow('NETWORK_SNAPSHOT_INVALID')
    const read = vi.fn(async () => '02-11-22-33-44-55')
    await expect(assertConfirmedPrinter({ host: '192.168.18.53', port: 9100 },
      { networkFingerprint: networkContinuityFingerprint(before), hardwareAddress: '02-11-22-33-44-55' }, forged, read))
      .rejects.toThrow('NETWORK_SNAPSHOT_INVALID')
    expect(read).not.toHaveBeenCalled()
  })

  it.each(['add', 'remove', 'nextHop', 'interface', 'prefix', 'localIp'] as const)('continuity rejects actual %s topology changes', async change => {
    const before = snapshot(), raw = metadata()
    if (change === 'add') raw.routes.push({ ...raw.routes[0] })
    if (change === 'remove') raw.routes.pop()
    if (change === 'nextHop') raw.routes[1].nextHop = '192.168.18.2'
    if (change === 'interface') raw.routes[1].interfaceIndex = 99
    if (change === 'prefix') raw.routes[1].destinationPrefix = '0.0.0.0/1'
    const after = change === 'localIp' ? snapshot(24, '192.168.18.42') : createLocalNetworkSnapshot(raw, interfaces())
    await expect(assertNetworkSnapshotCurrent(before, { getSnapshot: async () => after })).rejects.toThrow('NETWORK_CHANGED')
  })

  it.each([0, 0xffffffff])('never prefers a competing route by favorable or unfavorable metric %s', metric => {
    const raw = metadata()
    raw.routes.push({ interfaceIndex: 99, destinationPrefix: '192.168.18.53/32', nextHop: '0.0.0.0', routeMetric: metric, interfaceMetric: metric })
    expect(() => validateLocalPrinterEndpoint('192.168.18.53', 9100, createLocalNetworkSnapshot(raw, interfaces())))
      .toThrow('NETWORK_ROUTE_ESCAPE')
  })

  it('does not silently accept a pre-upgrade full-hash confirmation', async () => {
    const snap = snapshot(), read = vi.fn(async () => '02-11-22-33-44-55')
    expect(networkContinuityFingerprint(snap)).not.toBe(snap.fingerprint)
    await expect(assertConfirmedPrinter({ host: '192.168.18.53', port: 9100 },
      { networkFingerprint: snap.fingerprint, hardwareAddress: '02-11-22-33-44-55' }, snap, read)).rejects.toThrow('NETWORK_CHANGED')
    expect(read).not.toHaveBeenCalled()
  })
})

describe('validation-scoped fresh Windows snapshots (real reader, fake process only)', () => {
  const endpoint = { host: '192.168.18.53', port: 9100 }
  const hardwareAddress = '02-11-22-33-44-55'
  const deps = { platform: () => 'win32', interfaces: () => interfaces() }
  const confirmation = () => ({ networkFingerprint: networkContinuityFingerprint(snapshot()), hardwareAddress })
  const validate = (readHardware: typeof readLocalPrinterHardware = async () => hardwareAddress,
    overrides: Partial<typeof deps> = {}) => withWindowsValidationSnapshots(async getSnapshot => {
    const before = await getSnapshot()
    return assertConfirmedPrinter(endpoint, confirmation(), before, readHardware, getSnapshot)
  }, { ...deps, ...overrides })

  function runtime() {
    const request: NetworkRequest = { profile: NETWORK_PROFILE, requestId: 'network-validation-0001', role: 'FRONT',
      mode: 'SHARED_PRINTER', rendererVersion: 1, order: { storeCode: 'STORE-A', storeName: 'Test', orderNo: 'ORDER-001',
        createdAt: '2026-09-07T00:00:00.000Z', cashierName: 'Cashier', paymentMethod: 'CASH', currencyCode: 'USD',
        totalAmount: 3, lang: 'zh', items: [{ name: '小票', spec: null, qty: 1, price: 3, lineAmount: 3 }] } }
    const job: ReceivedPrintJob = { id: 'network-validation-job', schemaVersion: 2, requestId: request.requestId,
      idempotencyKey: request.requestId, requestHash: 'a'.repeat(64), orderNo: request.order.orderNo, documentName: 'FRONT',
      commandStream: new Uint8Array(), network: request, claimAttempt: 1, claimToken: `ecp_v1_${'a'.repeat(43)}`,
      leaseExpiresAt: new Date(Date.now() + 30000).toISOString() }
    vi.mocked(execFile).mockClear()
    vi.mocked(spawn).mockClear()
    vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
      const command = args[1] as string[]
      const callback = args[3] as (error: null, stdout: string, stderr: string) => void
      if (command.includes('-Command')) callback(null, JSON.stringify(metadata()), '')
      else {
        expect(Buffer.from(command.at(-1)!, 'base64').toString('utf16le')).toContain('SendARP')
        callback(null, `${hardwareAddress}\r\n`, '')
      }
      return {} as ReturnType<typeof execFile>
    })
    // Same composition as the commercial entry: receive keeps the default
    // one-shot validator; only prepare and delivery supply the scoped reader.
    const validateEndpoint = async (selected: typeof endpoint, getSnapshot = () => getWindowsLocalNetworks(deps)) =>
      assertConfirmedPrinter(selected, confirmation(), await getSnapshot(),
        (host, port, current) => readLocalPrinterHardware(host, port, current, { platform: deps.platform }), getSnapshot)
    const bytes = new Uint8Array([27, 64, 29, 86, 0])
    const options = { assertIdentity: vi.fn(async () => {}), identity: { storeCode: 'STORE-A' },
      nodes: { read: vi.fn(async () => ({ mode: 'SHARED_PRINTER' as const, endpoint })) }, validateEndpoint,
      journal: { records: () => [] }, client: { receive: vi.fn(async (): Promise<ReceivedPrintJob | null> => job), markExecuting: vi.fn(), reportResult: vi.fn() },
      render: vi.fn(async () => bytes), recorder: { record: vi.fn(async () => {}) },
      transport: { deliver: vi.fn(async () => ({ bytesWritten: bytes.length, durationMs: 1,
        effectBoundary: 'CROSSED' as const, physicalCompletionKnown: false as const })) } }
    return { options, guarded: createGuardedNetworkClient(options),
      strategy: createNetworkStrategy({ ...options,
        validateEndpoint: selected => withWindowsValidationSnapshots(getSnapshot => validateEndpoint(selected, getSnapshot), deps) }) }
  }

  it('keeps receive at three one-shot processes, and composes one job with seven total processes', async () => {
    const h = runtime()
    const received = await h.guarded.receive()
    expect(execFile).toHaveBeenCalledTimes(3)
    expect(spawn).not.toHaveBeenCalled()
    const workers = [fakeMetadataProcess(metadata()), fakeMetadataProcess(metadata())]
    const deliver = await h.strategy.prepare(received!)
    expect(h.options.transport.deliver).not.toHaveBeenCalled()
    await expect(deliver()).resolves.toMatchObject({ physicalCompletionKnown: false })
    expect(execFile).toHaveBeenCalledTimes(5)
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(workers.map(worker => worker.requests)).toEqual([['SNAPSHOT1', 'SNAPSHOT2'], ['SNAPSHOT1', 'SNAPSHOT2']])
    expect(h.options.transport.deliver).toHaveBeenCalledWith(new Uint8Array([27, 64, 29, 86, 0]), endpoint, '192.168.18.41')
    h.options.client.receive.mockResolvedValueOnce(null)
    await expect(h.guarded.receive()).resolves.toBeNull()
    expect(execFile).toHaveBeenCalledTimes(8)
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it.each(['prepare', 'delivery'] as const)('actual runtime %s blocks transport when scoped cleanup fails', async stage => {
    vi.useFakeTimers()
    const h = runtime(), received = await h.guarded.receive()
    if (stage === 'delivery') fakeMetadataProcess(metadata())
    const failed = fakeMetadataProcess(metadata(), 'unclosed')
    const run = stage === 'prepare' ? h.strategy.prepare(received!) : (await h.strategy.prepare(received!))()
    const rejected = stage === 'prepare' ? expect(run).rejects.toThrow('NETWORK_METADATA_CLEANUP_FAILED')
      : expect(run).rejects.toMatchObject({ code: 'NETWORK_METADATA_CLEANUP_FAILED', effectBoundary: 'NOT_CROSSED' })
    await vi.advanceTimersByTimeAsync(1000)
    await rejected
    expect(failed.requests).toEqual(['SNAPSHOT1', 'SNAPSHOT2'])
    expect(h.options.transport.deliver).not.toHaveBeenCalled()
    expect(h.options.render).toHaveBeenCalledTimes(stage === 'prepare' ? 0 : 1)
    expect(execFile).toHaveBeenCalledTimes(stage === 'prepare' ? 4 : 5)
    expect(spawn).toHaveBeenCalledTimes(stage === 'prepare' ? 1 : 2)
  })

  it('awaits the entire validator and closes before the last Node interface check or permission', async () => {
    const events: string[] = [], worker = fakeMetadataProcess(metadata(), 'hang', 0,
      { onCleanup: () => { events.push('cleanup-start') } })
    let releaseHardware!: () => void
    const waitHardware = new Promise<void>(resolve => { releaseHardware = resolve })
    const readHardware = vi.fn(async () => { events.push('arp'); await waitHardware; return hardwareAddress })
    worker.child.stdin.on('data', chunk => events.push(String(chunk).trim()))
    worker.child.on('close', () => events.push('cleanup-done'))
    const local = vi.fn(() => { events.push('interfaces'); return interfaces() })
    const permission = vi.fn()
    const pending = validate(readHardware, { interfaces: local }).then(permission)
    await vi.waitFor(() => expect(readHardware).toHaveBeenCalledTimes(1))
    expect(worker.child.stdin.writableEnded).toBe(false)
    expect(worker.requests).toEqual(['SNAPSHOT1'])
    releaseHardware()
    await vi.waitFor(() => expect(events).toContain('cleanup-start'))
    expect(local).toHaveBeenCalledTimes(3)
    expect(permission).not.toHaveBeenCalled()
    worker.finish(0, null)
    await pending
    expect(events).toEqual(['interfaces', 'SNAPSHOT1', 'interfaces', 'arp', 'interfaces', 'SNAPSHOT2',
      'cleanup-start', 'cleanup-done', 'interfaces'])
    expect(permission).toHaveBeenCalledWith(expect.objectContaining({ localAddress: '192.168.18.41' }))
    expect(worker.child.kill).not.toHaveBeenCalled()
  })

  it('uses a new process per validation, executes both fresh reads and accepts metric-only drift', async () => {
    const workerCount = vi.mocked(spawn).mock.calls.length
    const workers = [fakeMetadataProcess(read => {
      const raw = metadata(); raw.routes.forEach(route => { route.interfaceMetric = read === 1 ? 50 : 45 }); return raw
    }), fakeMetadataProcess(metadata())]
    const first = await validate(), second = await validate()
    expect(first.snapshotFingerprint).not.toBe(second.snapshotFingerprint)
    expect(vi.mocked(spawn).mock.calls.length - workerCount).toBe(2)
    for (const worker of workers) {
      expect(worker.requests).toEqual(['SNAPSHOT1', 'SNAPSHOT2'])
      expect(worker.child.stdin.writableEnded).toBe(true)
      expect(worker.child.kill).not.toHaveBeenCalled()
    }
  })

  it.each([0, 1, 3])('does not permit a successful callback after %s snapshots', async count => {
    const worker = fakeMetadataProcess(metadata())
    await expect(withWindowsValidationSnapshots(async getSnapshot => {
      for (let read = 0; read < count; read++) await getSnapshot()
      return endpoint
    }, deps)).rejects.toThrow(count === 3 ? 'NETWORK_METADATA_LIMIT' : 'NETWORK_METADATA_INVALID')
    expect(worker.requests).toHaveLength(Math.min(count, 2))
    expect(worker.child.stdin.writableEnded).toBe(true)
  })

  it('preserves a validator failure and awaits cleanup even before its first snapshot', async () => {
    const worker = fakeMetadataProcess(metadata(), 'hang')
    const settled = vi.fn()
    const rejected = withWindowsValidationSnapshots(async () => { throw new Error('NETWORK_CHANGED') }, deps)
      .catch(error => { settled(); throw error })
    const assertion = expect(rejected).rejects.toThrow('NETWORK_CHANGED')
    await vi.waitFor(() => expect(worker.child.stdin.writableFinished).toBe(true))
    expect(settled).not.toHaveBeenCalled()
    worker.finish(0, null)
    await assertion
    expect(worker.requests).toEqual([])
  })

  it('rejects a changed route from the second fresh read after ARP', async () => {
    const worker = fakeMetadataProcess(read => {
      const raw = metadata()
      if (read === 2) raw.routes.push({ interfaceIndex: 99, destinationPrefix: '192.168.18.53/32',
        nextHop: '0.0.0.0', routeMetric: 1, interfaceMetric: 1 })
      return raw
    })
    await expect(validate()).rejects.toThrow('NETWORK_CHANGED')
    expect(worker.requests).toEqual(['SNAPSHOT1', 'SNAPSHOT2'])
    expect(worker.child.stdin.writableEnded).toBe(true)
  })

  it('rejects a changed MAC without taking a second snapshot and still awaits cleanup', async () => {
    const worker = fakeMetadataProcess(metadata())
    await expect(validate(async () => '02-99-88-77-66-55')).rejects.toThrow('NETWORK_DEVICE_CHANGED')
    expect(worker.requests).toEqual(['SNAPSHOT1'])
    expect(worker.child.stdin.writableEnded).toBe(true)
  })

  it.each([2, 3, 4])('rejects Node interface changes at interface observation %s', async observation => {
    const worker = fakeMetadataProcess(metadata())
    let observations = 0
    await expect(validate(undefined, { interfaces: () => ++observations < observation ? interfaces() : interfaces(24, '192.168.18.42') }))
      .rejects.toThrow('NETWORK_CHANGED')
    expect(worker.child.stdin.writableEnded).toBe(true)
  })

  it('detects a Node interface change during successful EOF cleanup', async () => {
    let local = interfaces()
    const worker = fakeMetadataProcess(metadata(), 'none', 0, { onCleanup: () => { local = interfaces(24, '192.168.18.42') } })
    await expect(validate(undefined, { interfaces: () => local })).rejects.toThrow('NETWORK_CHANGED')
    expect(worker.requests).toEqual(['SNAPSHOT1', 'SNAPSHOT2'])
    expect(worker.child.kill).not.toHaveBeenCalled()
  })

  it.each(['stderr', 'stdout', 'exit', 'hang', 'unclosed'] as const)('does not permit output after cleanup %s failure or retry one-shot', async fault => {
    vi.useFakeTimers()
    const oneShots = vi.mocked(execFile).mock.calls.length, starts = vi.mocked(spawn).mock.calls.length
    const worker = fakeMetadataProcess(metadata(), fault)
    const rejected = expect(validate()).rejects.toThrow(fault === 'stdout' ? 'NETWORK_METADATA_INVALID'
      : fault === 'hang' || fault === 'unclosed' ? 'NETWORK_METADATA_CLEANUP_FAILED' : 'NETWORK_METADATA_UNAVAILABLE')
    await vi.advanceTimersByTimeAsync(1000)
    await rejected
    expect(worker.requests).toEqual(['SNAPSHOT1', 'SNAPSHOT2'])
    expect(vi.mocked(execFile).mock.calls.length).toBe(oneShots)
    expect(vi.mocked(spawn).mock.calls.length - starts).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([1, 2])('fails closed on fresh read %s timeout and does not start a fallback process', async readTimeoutAt => {
    vi.useFakeTimers()
    const oneShots = vi.mocked(execFile).mock.calls.length, starts = vi.mocked(spawn).mock.calls.length
    const worker = fakeMetadataProcess(metadata(), 'none', 0, { readTimeoutAt })
    const rejected = expect(validate()).rejects.toThrow('NETWORK_METADATA_UNAVAILABLE')
    await vi.advanceTimersByTimeAsync(5000)
    await rejected
    expect(worker.requests).toHaveLength(readTimeoutAt)
    expect(worker.child.kill).toHaveBeenCalledTimes(1)
    expect(vi.mocked(execFile).mock.calls.length).toBe(oneShots)
    expect(vi.mocked(spawn).mock.calls.length - starts).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('bounded zero-payload candidate discovery (fake sockets only)', () => {
  it.each(['none', 'stderr', 'stdout', 'exit'] as const)('actual discovery awaits metadata EOF cleanup and handles late %s', async fault => {
    const raw = metadata(30, '192.168.18.41', '192.168.18.40'), snap = createLocalNetworkSnapshot(raw, interfaces(30))
    const h = fakeDependencies(snap), worker = fakeMetadataProcess(raw, fault)
    const { getSnapshot: _unused, ...sockets } = h.deps
    const result = discoverNetworkPrinters(snap, {}, { ...sockets, platform: () => 'win32', interfaces: () => interfaces(30) })
    if (fault === 'none') await expect(result).resolves.toMatchObject({ status: 'COMPLETE', attempted: 1 })
    else await expect(result).rejects.toThrow(fault === 'stdout' ? 'NETWORK_METADATA_INVALID' : 'NETWORK_METADATA_UNAVAILABLE')
    expect(worker.requests).toEqual(['SNAPSHOT1', 'SNAPSHOT2', 'SNAPSHOT3'])
    expect(h.connects).toHaveLength(1); expect(h.active()).toBe(0)
    expect(h.sockets.every(socket => !socket.write.mock.calls.length && !socket.end.mock.calls.length)).toBe(true)
  })

  it('actual metadata worker preserves the 45-second discovery deadline during an outstanding fresh read', async () => {
    vi.useFakeTimers()
    const raw = metadata(22, '192.168.16.41', '192.168.16.0'), local = interfaces(22, '192.168.16.41')
    const snap = createLocalNetworkSnapshot(raw, local), h = fakeDependencies(snap), worker = fakeMetadataProcess(raw, 'none', 400)
    const { getSnapshot: _unused, ...sockets } = h.deps
    const rejected = expect(discoverNetworkPrinters(snap, {}, { ...sockets, platform: () => 'win32', interfaces: () => local }))
      .rejects.toThrow('NETWORK_DISCOVERY_DEADLINE')
    await vi.advanceTimersByTimeAsync(45_000)
    await rejected
    expect(worker.child.kill).toHaveBeenCalledTimes(1)
    expect(h.active()).toBe(0)
    expect(worker.requests.length).toBeGreaterThan(1)
  })
  it('connects at most 16 at once to 9100, binds the source IP and marks every result unverified', async () => {
    const snap = snapshot(), h = fakeDependencies(snap), onCandidate = vi.fn()
    const result = await discoverNetworkPrinters(snap, { onCandidate }, h.deps)
    expect(result.status).toBe('COMPLETE')
    expect(result.attempted).toBe(252) // /24 minus network, broadcast, local IP and gateway
    expect(result.totalTargets).toBe(result.attempted)
    expect(h.maximum()).toBe(16); expect(h.active()).toBe(0)
    expect(onCandidate).toHaveBeenCalledTimes(252)
    expect(h.connects.every(item => item.port === 9100 && item.family === 4 && item.localAddress === '192.168.18.41')).toBe(true)
    expect(h.sockets.every(item => item.timeout === 600 && item.destroyed && item.write.mock.calls.length === 0 && item.end.mock.calls.length === 0)).toBe(true)
    expect(result.candidates.every(item => item.verified === false && item.discovery === 'TCP_CONNECT_ONLY' && item.snapshotFingerprint === snap.fingerprint)).toBe(true)
  })

  it.each(['closed', 'timeout'] as const)('closes %s sockets and returns no candidates', async behavior => {
    const snap = snapshot(30, '192.168.18.41', '192.168.18.40'), h = fakeDependencies(snap, behavior)
    const result = await discoverNetworkPrinters(snap, {}, h.deps)
    expect(result.attempted).toBe(1); expect(result.candidates).toEqual([])
    expect(h.sockets.every(socket => socket.destroyed)).toBe(true)
  })

  it('destroys a stuck connection at the 600ms hard limit even without socket events', async () => {
    vi.useFakeTimers()
    const snap = snapshot(30, '192.168.18.41', '192.168.18.40'), h = fakeDependencies(snap, 'hang')
    const running = discoverNetworkPrinters(snap, {}, h.deps)
    await vi.advanceTimersByTimeAsync(0)
    expect(h.connects).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(599)
    expect(h.active()).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect((await running).candidates).toEqual([])
    expect(h.active()).toBe(0)
  })

  it('returns manual fallback for a /21 without probing a truncated prefix', async () => {
    const snap = snapshot(21, '192.168.18.41', '192.168.16.0'), h = fakeDependencies(snap)
    const result = await discoverNetworkPrinters(snap, {}, h.deps)
    expect(result).toMatchObject({ status: 'MANUAL_REQUIRED', reason: 'NETWORK_SUBNET_TOO_LARGE', attempted: 0 })
    expect(h.connects).toEqual([])
    expect(validateLocalPrinterEndpoint('192.168.18.53', 9200, snap).port).toBe(9200)
  })

  it('caps the sum of all subnets at 1024 instead of scanning each one independently', async () => {
    const raw = metadata(22, '192.168.16.41', '192.168.16.0'), local = interfaces(22, '192.168.16.41')
    raw.adapters.push({ ...raw.adapters[0], interfaceIndex: 8, name: 'Wi-Fi', interfaceType: 71 })
    raw.addresses.push({ ...raw.addresses[0], interfaceIndex: 8, address: '192.168.20.41' })
    raw.routes.push({ ...raw.routes[0], interfaceIndex: 8, destinationPrefix: '192.168.20.0/22' })
    const snap = createLocalNetworkSnapshot(raw, { ...local, 'Wi-Fi': interfaces(22, '192.168.20.41').Ethernet }), h = fakeDependencies(snap)
    expect((await discoverNetworkPrinters(snap, {}, h.deps)).status).toBe('MANUAL_REQUIRED')
    expect(h.connects).toHaveLength(0)
  })

  it('skips targets with a specific VPN route without reaching that socket', async () => {
    const raw = metadata(30, '192.168.18.41', '192.168.18.40')
    raw.routes.push({ ...raw.routes[0], destinationPrefix: '192.168.18.42/32', interfaceIndex: 99 })
    const snap = createLocalNetworkSnapshot(raw, interfaces(30)), h = fakeDependencies(snap)
    expect((await discoverNetworkPrinters(snap, {}, h.deps)).status).toBe('MANUAL_REQUIRED')
    expect(h.connects).toHaveLength(0)
  })

  it('aborts when metadata changes after connection and emits no stale candidate', async () => {
    const snap = snapshot(30, '192.168.18.41', '192.168.18.40'), h = fakeDependencies(snap), onCandidate = vi.fn()
    const changed = metadata(30, '192.168.18.41', '192.168.18.40'); changed.routes[1].nextHop = '192.168.18.2'
    h.deps.getSnapshot = vi.fn().mockResolvedValueOnce(snap).mockResolvedValueOnce(snap)
      .mockResolvedValue(createLocalNetworkSnapshot(changed, interfaces(30)))
    await expect(discoverNetworkPrinters(snap, { onCandidate }, h.deps)).rejects.toThrow('NETWORK_CHANGED')
    expect(onCandidate).not.toHaveBeenCalled(); expect(h.active()).toBe(0)
  })

  it('freshly reads before and after every wave while accepting metric-only drift without payload', async () => {
    const snap = snapshot(), h = fakeDependencies(snap)
    let reads = 0
    h.deps.getSnapshot = vi.fn(async () => {
      const raw = metadata(), metric = (++reads % 2) ? 45 : 50
      raw.routes.forEach(route => { route.interfaceMetric = metric })
      return createLocalNetworkSnapshot(raw, interfaces())
    })
    const result = await discoverNetworkPrinters(snap, {}, h.deps)
    expect(result.status).toBe('COMPLETE')
    expect(h.deps.getSnapshot).toHaveBeenCalledTimes(1 + 2 * Math.ceil(252 / 16))
    expect(h.maximum()).toBe(16)
    expect(h.sockets.every(socket => socket.destroyed && !socket.write.mock.calls.length && !socket.end.mock.calls.length)).toBe(true)
  })

  it('rejects an already aborted signal without reading metadata or opening sockets', async () => {
    const snap = snapshot(), h = fakeDependencies(snap), controller = new AbortController(); controller.abort()
    await expect(discoverNetworkPrinters(snap, { signal: controller.signal }, h.deps)).rejects.toThrow('NETWORK_DISCOVERY_CANCELLED')
    expect(h.deps.getSnapshot).not.toHaveBeenCalled(); expect(h.connects).toHaveLength(0)
  })

  it('cancels active sockets, disallows a concurrent scan, then releases the scan lock', async () => {
    const snap = snapshot(), h = fakeDependencies(snap, 'hang'), controller = new AbortController()
    const running = discoverNetworkPrinters(snap, { signal: controller.signal }, h.deps)
    await vi.waitFor(() => expect(h.connects).toHaveLength(16))
    await expect(discoverNetworkPrinters(snap, {}, h.deps)).rejects.toThrow('NETWORK_DISCOVERY_BUSY')
    controller.abort()
    await expect(running).rejects.toThrow('NETWORK_DISCOVERY_CANCELLED')
    expect(h.active()).toBe(0)
    const next = snapshot(30, '192.168.18.41', '192.168.18.40')
    await expect(discoverNetworkPrinters(next, {}, fakeDependencies(next).deps)).resolves.toMatchObject({ status: 'COMPLETE' })
  })

  it('enforces a 45 second deadline even if metadata never completes', async () => {
    vi.useFakeTimers()
    const snap = snapshot(), h = fakeDependencies(snap)
    h.deps.getSnapshot = () => new Promise(() => {})
    const running = discoverNetworkPrinters(snap, {}, h.deps)
    const rejected = expect(running).rejects.toThrow('NETWORK_DISCOVERY_DEADLINE')
    await vi.advanceTimersByTimeAsync(NETWORK_DISCOVERY_LIMITS.deadlineMs)
    await rejected
    expect(h.connects).toHaveLength(0)
  })
})
