import { execFile, type ExecFileException } from 'node:child_process'
import { createHash } from 'node:crypto'
import { Socket } from 'node:net'
import os from 'node:os'
import { validateNetworkNode } from './networkNodeConfig'
import { createWindowsMetadataReader, type WindowsMetadataReader } from './networkDiscoveryMetadata'

// This is candidate discovery, never printer identification or print authorization.
// RAW 9100 is the discovery default; there is no vendor discovery wire protocol.
export const NETWORK_DISCOVERY_LIMITS = Object.freeze({
  targets: 1024, concurrency: 16, connectTimeoutMs: 600, deadlineMs: 45_000,
  // 15s, not 5s: a fresh powershell.exe running three CIM queries measured
  // 2.44s hot-idle on the V727, so 5s left almost no headroom and any spike
  // pushed the program into an error state. This reader is never inside a
  // claimed job lease (the delivery path uses the persistent reader), so the
  // worst case of 15s plus one retry stays clear of the 30s claim lease.
  metadataTimeoutMs: 15_000, snapshotMaxAgeMs: 60_000, defaultPort: 9100,
})

// Constant local, read-only commands. Never interpolate a host, port or UI input.
export const WINDOWS_NETWORK_METADATA_COMMAND = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$adapters = @(Get-NetAdapter -Physical -ErrorAction Stop | ForEach-Object {
  @{ interfaceIndex = [int]$_.ifIndex; name = [string]$_.Name;
     description = [string]$_.InterfaceDescription; interfaceType = [int]$_.InterfaceType;
     hardwareInterface = [bool]$_.HardwareInterface; virtual = [bool]$_.Virtual;
     status = [string]$_.Status }
})
$addresses = @(Get-NetIPAddress -AddressFamily IPv4 -PolicyStore ActiveStore -ErrorAction Stop | ForEach-Object {
  @{ interfaceIndex = [int]$_.InterfaceIndex; address = [string]$_.IPAddress;
     prefixLength = [int]$_.PrefixLength; addressState = [string]$_.AddressState;
     skipAsSource = [bool]$_.SkipAsSource }
})
$routes = @(Get-NetRoute -AddressFamily IPv4 -PolicyStore ActiveStore -ErrorAction Stop | ForEach-Object {
  @{ interfaceIndex = [int]$_.InterfaceIndex; destinationPrefix = [string]$_.DestinationPrefix;
     nextHop = [string]$_.NextHop; routeMetric = [int]$_.RouteMetric;
     interfaceMetric = [int]$_.InterfaceMetric }
})
@{ adapters = $adapters; addresses = $addresses; routes = $routes } | ConvertTo-Json -Depth 4 -Compress
`.trim()

export class NetworkDiscoveryError extends Error {
  /** `detail` is a truncated local diagnostic excerpt. It is never read by the
   *  status surface (main.ts code() reads only `code`) and never enters a cloud
   *  payload, which carries only NetworkDeliveryError.code. */
  constructor(readonly code: string, readonly detail?: string) { super(code); this.name = 'NetworkDiscoveryError' }
}
export type LocalNetwork = Readonly<{
  interfaceIndex: number; name: string; localAddress: string; prefixLength: number
  networkAddress: string; broadcastAddress: string
}>
export type IPv4Route = Readonly<{
  interfaceIndex: number; destinationPrefix: string; nextHop: string
  routeMetric: number; interfaceMetric: number
}>
export type LocalNetworkSnapshot = Readonly<{
  capturedAt: number; fingerprint: string; networks: readonly LocalNetwork[]
  routes: readonly IPv4Route[]; localAddresses: readonly string[]
}>
export type ValidatedLocalPrinterEndpoint = Readonly<{
  host: string; port: number; localAddress: string; interfaceIndex: number; snapshotFingerprint: string
}>
export type NetworkPrinterCandidate = ValidatedLocalPrinterEndpoint & Readonly<{
  verified: false; discovery: 'TCP_CONNECT_ONLY'
}>
export type NetworkDiscoveryResult = Readonly<{
  status: 'COMPLETE' | 'MANUAL_REQUIRED'; candidates: readonly NetworkPrinterCandidate[]
  attempted: number; totalTargets: number; reason?: string
}>
type Interfaces = ReturnType<typeof os.networkInterfaces>
export interface DiscoverySocket {
  once(event: string, listener: (...args: unknown[]) => void): this
  setTimeout(timeout: number): this
  connect(options: { host: string; port: number; localAddress: string; family: 4 }): this
  destroy(): this
}
export interface NetworkDiscoveryDependencies {
  platform?: () => string
  interfaces?: () => Interfaces
  readMetadata?: (signal?: AbortSignal) => Promise<unknown>
  getSnapshot?: (signal?: AbortSignal) => Promise<LocalNetworkSnapshot>
  createSocket?: () => DiscoverySocket
}

/** Pin a selected direct-LAN adapter, not an IP or a printer model. This is a
 * change detector (MACs can be spoofed), NOT cryptographic printer identity or
 * proof of paper output. It sends one ARP request, no TCP/ESC/POS payload. */
export async function readLocalPrinterHardware(host: unknown, port: unknown, snapshot: LocalNetworkSnapshot,
  dependencies: { platform?: () => string; run?: (script: string) => Promise<string> } = {}): Promise<string> {
  if ((dependencies.platform?.() ?? process.platform) !== 'win32') fail('NETWORK_WINDOWS_REQUIRED')
  const endpoint = validateLocalPrinterEndpoint(host, port, snapshot)
  const uint32 = (value: string) => Buffer.from(value.split('.').map(Number)).readUInt32LE(0)
  // Only already-validated UInt32 decimal integers enter this fixed script;
  // no hostname, port, shell fragment, UI string or credential is interpolated.
  const script = `$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class EshopSelectedArp { [DllImport("iphlpapi.dll", ExactSpelling=true)] public static extern UInt32 SendARP(UInt32 destination, UInt32 source, byte[] address, ref UInt32 length); }'
[byte[]]$bytes = New-Object byte[] 6
[uint32]$length = 6
[uint32]$targetAddress = ${uint32(endpoint.host)}
[uint32]$sourceAddress = ${uint32(endpoint.localAddress)}
$result = [EshopSelectedArp]::SendARP($targetAddress, $sourceAddress, $bytes, [ref]$length)
if ($result -ne 0 -or $length -ne 6) { throw 'ARP_UNAVAILABLE' }
[Console]::WriteLine(([BitConverter]::ToString($bytes)).ToLowerInvariant())`
  const run = dependencies.run ?? ((command: string) => new Promise<string>((resolve, reject) => {
    execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')],
      { windowsHide: true, timeout: 5000, maxBuffer: 1024, encoding: 'utf8' }, (error, stdout) => {
        if (error) reject(new NetworkDiscoveryError('NETWORK_DEVICE_IDENTITY_UNAVAILABLE'))
        else resolve(stdout)
      })
  }))
  const mac = (await run(script)).trim().toLowerCase()
  if (!/^[0-9a-f]{2}(-[0-9a-f]{2}){5}$/.test(mac) || mac === '00-00-00-00-00-00'
    || (parseInt(mac.slice(0, 2), 16) & 1) !== 0) fail('NETWORK_DEVICE_IDENTITY_UNAVAILABLE')
  return mac
}

export async function assertConfirmedPrinter(endpoint: { host: string; port: number },
  confirmation: { networkFingerprint: string; hardwareAddress: string }, snapshot: LocalNetworkSnapshot,
  readHardware: typeof readLocalPrinterHardware = readLocalPrinterHardware,
  refresh: () => Promise<LocalNetworkSnapshot> = getWindowsLocalNetworks): Promise<ValidatedLocalPrinterEndpoint> {
  const selected = validateLocalPrinterEndpoint(endpoint.host, endpoint.port, snapshot)
  if (confirmation.networkFingerprint !== networkContinuityFingerprint(snapshot)) fail('NETWORK_CHANGED')
  if (await readHardware(endpoint.host, endpoint.port, snapshot) !== confirmation.hardwareAddress) fail('NETWORK_DEVICE_CHANGED')
  const after = await refresh()
  if (networkContinuityFingerprint(after) !== networkContinuityFingerprint(snapshot)) fail('NETWORK_CHANGED')
  return validateLocalPrinterEndpoint(selected.host, selected.port, after)
}

function fail(code: string): never { throw new NetworkDiscoveryError(code) }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('NETWORK_METADATA_INVALID')
  return value as Record<string, unknown>
}
function integer(value: unknown, min = 0, max = 0xffffffff): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) fail('NETWORK_METADATA_INVALID')
  return value
}
function text(value: unknown): string {
  if (typeof value !== 'string' || value.length > 256 || /[\x00-\x1f]/.test(value)) fail('NETWORK_METADATA_INVALID')
  return value
}
function array(value: unknown, limit: number): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > limit) fail('NETWORK_METADATA_LIMIT')
  return value.map(object)
}
function ipv4(value: unknown): number {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(value)) fail('NETWORK_IPV4_LITERAL_REQUIRED')
  const parts = value.split('.').map(Number)
  if (parts.some(part => part > 255)) fail('NETWORK_IPV4_LITERAL_REQUIRED')
  return parts.reduce((result, part) => result * 256 + part, 0) >>> 0
}
function address(value: number): string {
  return [24, 16, 8, 0].map(shift => (value >>> shift) & 255).join('.')
}
function mask(prefix: number): number { return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0 }
function privateAddress(value: number): boolean {
  const a = value >>> 24, b = (value >>> 16) & 255
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}
function subnet(value: string): { first: number; last: number; prefix: number } {
  const parts = value.split('/')
  if (parts.length !== 2 || !/^(0|[1-9]\d?)$/.test(parts[1])) fail('NETWORK_METADATA_INVALID')
  const prefix = integer(Number(parts[1]), 0, 32), first = ipv4(parts[0])
  if (((first & mask(prefix)) >>> 0) !== first) fail('NETWORK_METADATA_INVALID')
  return { first, last: (first | ~mask(prefix)) >>> 0, prefix }
}
function sortObjects<T>(values: T[]): T[] {
  return values.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'))
}

/** Integrity/change token only, not a signature. Snapshots must stay in the main process. */
export function snapshotFingerprint(snapshot: Pick<LocalNetworkSnapshot, 'networks' | 'routes' | 'localAddresses'>): string {
  return createHash('sha256').update(JSON.stringify({
    networks: sortObjects([...snapshot.networks]), routes: sortObjects([...snapshot.routes]),
    localAddresses: [...snapshot.localAddresses].sort(),
  })).digest('hex')
}

/** Cross-time continuity, NOT snapshot integrity. Windows can change automatic
 * interface metrics with Wi-Fi link speed without changing the network path.
 * Keep every route's topology: endpoint validation rejects ANY equally/more
 * specific competing route regardless of its cost, then binds the source IP.
 * The complete fingerprint (including both metrics) is still checked first.
 * Domain separation makes pre-upgrade full-hash confirmations fail closed. */
export function networkContinuityFingerprint(snapshot: LocalNetworkSnapshot): string {
  validateSnapshot(snapshot, false)
  return createHash('sha256').update(JSON.stringify({
    domain: 'EShopNetworkDirectLanTopology/v1',
    networks: sortObjects([...snapshot.networks]),
    routes: sortObjects(snapshot.routes.map(({ interfaceIndex, destinationPrefix, nextHop }) =>
      ({ interfaceIndex, destinationPrefix, nextHop }))),
    localAddresses: [...snapshot.localAddresses].sort(),
  })).digest('hex')
}

/** Pure metadata parser, also used by the unit tests; it performs no LAN I/O. */
export function createLocalNetworkSnapshot(metadata: unknown, interfaces: Interfaces, capturedAt = Date.now()): LocalNetworkSnapshot {
  const raw = object(metadata)
  const adapters = array(raw.adapters, 256), addresses = array(raw.addresses, 1024)
  const routes: IPv4Route[] = array(raw.routes, 4096).map(route => {
    const destinationPrefix = text(route.destinationPrefix), nextHop = text(route.nextHop)
    subnet(destinationPrefix); ipv4(nextHop)
    return Object.freeze({ interfaceIndex: integer(route.interfaceIndex, 1), destinationPrefix, nextHop,
      routeMetric: integer(route.routeMetric), interfaceMetric: integer(route.interfaceMetric) })
  })
  const localAddresses = Object.values(interfaces).flatMap(items => items ?? [])
    .filter(item => item.family === 'IPv4').map(item => { ipv4(item.address); return item.address })
  if (localAddresses.length > 1024) fail('NETWORK_METADATA_LIMIT')
  const networks: LocalNetwork[] = []
  const excluded = /vpn|virtual|vEthernet|hyper-v|vmware|virtualbox|loopback|tunnel|wireguard|wintun|tailscale|zerotier|docker|bluetooth|\b(?:tap|tun|ppp|bridge)\b/i
  const seenAdapterIndexes = new Set<number>()
  for (const adapter of adapters) {
    const interfaceIndex = integer(adapter.interfaceIndex, 1), name = text(adapter.name)
    const description = text(adapter.description)
    if (seenAdapterIndexes.has(interfaceIndex)) fail('NETWORK_METADATA_INVALID')
    seenAdapterIndexes.add(interfaceIndex)
    if (adapter.hardwareInterface !== true || adapter.virtual !== false || adapter.status !== 'Up'
      || ![6, 71].includes(integer(adapter.interfaceType)) || excluded.test(`${name} ${description}`)) continue
    for (const entry of addresses.filter(item => item.interfaceIndex === interfaceIndex)) {
      if (entry.addressState !== 'Preferred' || entry.skipAsSource !== false) continue
      const localAddress = text(entry.address), value = ipv4(localAddress)
      const prefixLength = integer(entry.prefixLength, 0, 32)
      if (!privateAddress(value) || prefixLength > 30) continue
      const netmask = mask(prefixLength), first = (value & netmask) >>> 0, last = (first | ~netmask) >>> 0
      if (!privateAddress(first) || !privateAddress(last) || value === first || value === last) continue
      // Match Windows adapter alias, address and mask against Node's actual local interfaces.
      if (!(interfaces[name] ?? []).some(item => item.family === 'IPv4' && !item.internal
        && item.address === localAddress && ipv4(item.netmask) === netmask)) continue
      if (!routes.some(route => route.interfaceIndex === interfaceIndex && route.nextHop === '0.0.0.0'
        && route.destinationPrefix === `${address(first)}/${prefixLength}`)) continue
      networks.push(Object.freeze({ interfaceIndex, name, localAddress, prefixLength,
        networkAddress: address(first), broadcastAddress: address(last) }))
    }
  }
  const content = { networks: Object.freeze(sortObjects(networks)), routes: Object.freeze(sortObjects(routes)),
    localAddresses: Object.freeze([...new Set(localAddresses)].sort()) }
  return Object.freeze({ ...content, capturedAt, fingerprint: snapshotFingerprint(content) })
}

/**
 * Classify one failed metadata read. The four causes used to collapse into a
 * single NETWORK_METADATA_UNAVAILABLE, which made a hot-idle timeout
 * indistinguishable from a missing powershell.exe on the machine.
 *
 * The codes deliberately use the ADDON_ prefix, not NETWORK_. Only a message
 * matching /^NETWORK_[A-Z0-9_]+$/ survives preDelivery() in networkRuntime.ts
 * and becomes a cloud resultCode; an ADDON_ code is replaced there by the
 * generic NETWORK_ENDPOINT_REVALIDATION_FAILED. So these classifications stay
 * local by construction, which is the requirement.
 *
 * Abort is checked before the kill test because an aborted child is also
 * reported as killed.
 */
function classifyMetadataFailure(error: ExecFileException, signal?: AbortSignal): string {
  if (signal?.aborted || error.name === 'AbortError' || error.code === 'ABORT_ERR') return 'ADDON_METADATA_CANCELLED'
  if (error.code === 'ENOENT') return 'ADDON_METADATA_TOOL_MISSING'
  if (error.killed === true) return 'ADDON_METADATA_TIMEOUT'
  if (typeof error.code === 'number' && error.code !== 0) return 'ADDON_METADATA_COMMAND_FAILED'
  return 'NETWORK_METADATA_UNAVAILABLE'
}

/** Local diagnosis only. Never rendered into a cloud payload; see the
 *  classifyMetadataFailure comment for why the prefix keeps that true. */
const METADATA_STDERR_DIAGNOSTIC_LIMIT = 200

function metadataFailure(code: string, stderr: unknown): NetworkDiscoveryError {
  const text = typeof stderr === 'string' ? stderr : ''
  const detail = text.replace(/\s+/g, ' ').trim().slice(0, METADATA_STDERR_DIAGNOSTIC_LIMIT)
  return detail ? new NetworkDiscoveryError(code, detail) : new NetworkDiscoveryError(code)
}

function runWindowsMetadata(signal?: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_NETWORK_METADATA_COMMAND],
      { windowsHide: true, timeout: NETWORK_DISCOVERY_LIMITS.metadataTimeoutMs, maxBuffer: 1024 * 1024,
        encoding: 'utf8', signal }, (error, stdout, stderr) => {
        if (error) { reject(metadataFailure(classifyMetadataFailure(error, signal), stderr)); return }
        try { resolve(JSON.parse(stdout.replace(/^\uFEFF/, '').trim())) }
        catch { reject(metadataFailure('NETWORK_METADATA_INVALID', stderr)) }
      })
  })
}

/**
 * One retry, so a single spike no longer pushes the program into an error
 * state. Only consecutive failures surface.
 *
 * Not retried: a cancelled read (the caller asked to stop, retrying would
 * ignore that) and a missing powershell.exe (deterministic within a session,
 * so a second spawn only adds latency to the same answer).
 *
 * This is the default reader. The delivery path overrides deps.readMetadata
 * with the persistent reader in networkDiscoveryMetadata.ts, so neither the
 * widened timeout nor this retry runs inside a claimed job lease, and the
 * two-fresh-reads contract of withWindowsValidationSnapshots is untouched.
 */
async function readWindowsMetadata(signal?: AbortSignal): Promise<unknown> {
  try { return await runWindowsMetadata(signal) }
  catch (first) {
    const code = first instanceof NetworkDiscoveryError ? first.code : ''
    if (code === 'ADDON_METADATA_CANCELLED' || code === 'ADDON_METADATA_TOOL_MISSING') throw first
    checkAbort(signal)
    return await runWindowsMetadata(signal)
  }
}

export async function getWindowsLocalNetworks(deps: NetworkDiscoveryDependencies = {}, signal?: AbortSignal): Promise<LocalNetworkSnapshot> {
  if ((deps.platform?.() ?? process.platform) !== 'win32') fail('NETWORK_WINDOWS_REQUIRED')
  checkAbort(signal)
  const interfaces = deps.interfaces ?? os.networkInterfaces
  const before = interfaces()
  const metadata = await (deps.readMetadata ?? readWindowsMetadata)(signal)
  checkAbort(signal)
  const first = createLocalNetworkSnapshot(metadata, before)
  const current = createLocalNetworkSnapshot(metadata, interfaces())
  if (first.fingerprint !== current.fingerprint) fail('NETWORK_CHANGED')
  return current
}

/** One prepare/delivery validation, with two fresh reads and no retained
 * snapshot. Cleanup precedes the second read's final Node interface check. */
export async function withWindowsValidationSnapshots<T>(
  operation: (getSnapshot: () => Promise<LocalNetworkSnapshot>) => Promise<T>,
  deps: Pick<NetworkDiscoveryDependencies, 'platform' | 'interfaces'> = {},
): Promise<T> {
  const reader = createWindowsMetadataReader(WINDOWS_NETWORK_METADATA_COMMAND, { platform: deps.platform })
  let reads = 0, completed = 0
  const getSnapshot = async () => {
    const snapshot = await getWindowsLocalNetworks({ ...deps, readMetadata: async signal => {
      if (++reads > 2) fail('NETWORK_METADATA_LIMIT')
      const metadata = await reader.read(signal)
      // Do not let EOF, trailing output or process failures arrive after the
      // final interface check has already authorized this endpoint.
      if (reads === 2) await reader.close()
      return metadata
    } })
    completed++
    return snapshot
  }
  try {
    return await operation(getSnapshot).then(result => {
      if (reads !== 2 || completed !== 2) fail('NETWORK_METADATA_INVALID')
      return result
    })
  }
  finally { await reader.close() }
}

function validateSnapshot(snapshot: LocalNetworkSnapshot, checkAge = true): void {
  if (snapshot.fingerprint !== snapshotFingerprint(snapshot)) fail('NETWORK_SNAPSHOT_INVALID')
  if (!Number.isFinite(snapshot.capturedAt) || (checkAge
    && (Date.now() - snapshot.capturedAt > NETWORK_DISCOVERY_LIMITS.snapshotMaxAgeMs || snapshot.capturedAt > Date.now() + 5000))) {
    fail('NETWORK_SNAPSHOT_STALE')
  }
}

/** Static validation is not permission to print: refresh with assertNetworkSnapshotCurrent before use. */
export function validateLocalPrinterEndpoint(host: unknown, port: unknown, snapshot: LocalNetworkSnapshot): ValidatedLocalPrinterEndpoint {
  validateSnapshot(snapshot)
  const value = ipv4(host)
  if (!privateAddress(value)) fail('NETWORK_RFC1918_REQUIRED')
  if (typeof port === 'string') {
    if (!/^[1-9]\d{0,4}$/.test(port)) fail('NETWORK_INVALID_PORT')
    port = Number(port)
  }
  if (typeof port !== 'number' || !Number.isSafeInteger(port) || port < 1 || port > 65535) fail('NETWORK_INVALID_PORT')
  if (snapshot.localAddresses.includes(host as string)) fail('NETWORK_LOCAL_ADDRESS_REJECTED')
  const matches = snapshot.networks.filter(network => value > ipv4(network.networkAddress) && value < ipv4(network.broadcastAddress))
  if (matches.length !== 1) fail(matches.length ? 'NETWORK_AMBIGUOUS_INTERFACE' : 'NETWORK_DIRECT_PHYSICAL_LAN_REQUIRED')
  const network = matches[0]
  const interfaces: Interfaces = { [network.name]: [{ address: network.localAddress, family: 'IPv4', internal: false,
    netmask: address(mask(network.prefixLength)), mac: '', cidr: `${network.localAddress}/${network.prefixLength}` }] }
  validateNetworkNode({ host, port }, interfaces)
  if (snapshot.routes.some(route => route.nextHop === host)) fail('NETWORK_GATEWAY_REJECTED')
  // Conservatively reject any competing equally/more-specific route, even if its metric loses.
  // A broad VPN default cannot beat the verified connected subnet; a host/split route can.
  for (const route of snapshot.routes) {
    const range = subnet(route.destinationPrefix)
    if (value >= range.first && value <= range.last && range.prefix >= network.prefixLength
      && (route.interfaceIndex !== network.interfaceIndex || route.nextHop !== '0.0.0.0')) fail('NETWORK_ROUTE_ESCAPE')
  }
  return Object.freeze({ host: host as string, port, localAddress: network.localAddress,
    interfaceIndex: network.interfaceIndex, snapshotFingerprint: snapshot.fingerprint })
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason instanceof NetworkDiscoveryError ? signal.reason : new NetworkDiscoveryError('NETWORK_DISCOVERY_CANCELLED')
}
function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  return new Promise((resolve, reject) => {
    const abort = () => { try { checkAbort(signal) } catch (error) { reject(error) } }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    if (signal.aborted) abort()
  })
}

/** A fresh local read, not a cached candidate, must validate TEST/enable/delivery decisions. */
export async function assertNetworkSnapshotCurrent(snapshot: LocalNetworkSnapshot, deps: NetworkDiscoveryDependencies = {}, signal?: AbortSignal): Promise<LocalNetworkSnapshot> {
  validateSnapshot(snapshot, false)
  checkAbort(signal)
  const current = await abortable(deps.getSnapshot ? deps.getSnapshot(signal) : getWindowsLocalNetworks(deps, signal), signal)
  checkAbort(signal)
  validateSnapshot(current)
  if (networkContinuityFingerprint(snapshot) !== networkContinuityFingerprint(current)) fail('NETWORK_CHANGED')
  return current
}

function targets(snapshot: LocalNetworkSnapshot): ValidatedLocalPrinterEndpoint[] | null {
  // Never silently truncate a large subnet, or scan just the first network.
  if (snapshot.networks.reduce((sum, network) => sum + 2 ** (32 - network.prefixLength) - 2, 0) > NETWORK_DISCOVERY_LIMITS.targets) return null
  const result = new Map<string, ValidatedLocalPrinterEndpoint>()
  for (const network of snapshot.networks) {
    for (let value = ipv4(network.networkAddress) + 1; value < ipv4(network.broadcastAddress); value++) {
      try {
        const endpoint = validateLocalPrinterEndpoint(address(value), NETWORK_DISCOVERY_LIMITS.defaultPort, snapshot)
        result.set(endpoint.host, endpoint)
      } catch (error) {
        if (!(error instanceof NetworkDiscoveryError) || !['NETWORK_LOCAL_ADDRESS_REJECTED', 'NETWORK_GATEWAY_REJECTED',
          'NETWORK_ROUTE_ESCAPE', 'NETWORK_AMBIGUOUS_INTERFACE'].includes(error.code)) throw error
      }
    }
  }
  return [...result.values()]
}

function probe(endpoint: ValidatedLocalPrinterEndpoint, signal: AbortSignal, deps: NetworkDiscoveryDependencies): Promise<boolean> {
  return new Promise(resolve => {
    let socket: DiscoverySocket | undefined, done = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const finish = (open: boolean) => {
      if (done) return
      done = true
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      socket?.destroy()
      resolve(open && !signal.aborted)
    }
    const abort = () => finish(false)
    try {
      checkAbort(signal)
      socket = deps.createSocket?.() ?? new Socket()
      socket.once('error', () => finish(false)).once('timeout', () => finish(false))
        .once('close', () => finish(false)).once('connect', () => finish(true))
      signal.addEventListener('abort', abort, { once: true })
      // A wall-clock cap also covers a socket implementation which never emits timeout.
      timeout = setTimeout(() => finish(false), NETWORK_DISCOVERY_LIMITS.connectTimeoutMs)
      socket.setTimeout(NETWORK_DISCOVERY_LIMITS.connectTimeoutMs)
      // No write/end payload, protocol query, hostname lookup, or printer command.
      socket.connect({ host: endpoint.host, port: endpoint.port, localAddress: endpoint.localAddress, family: 4 })
    } catch { finish(false) }
  })
}

let scanActive = false
export async function discoverNetworkPrinters(snapshot: LocalNetworkSnapshot, options: {
  signal?: AbortSignal
  /** Provisional and unverified; clear the UI list if the returned promise rejects. */
  onCandidate?: (candidate: NetworkPrinterCandidate) => void
} = {}, deps: NetworkDiscoveryDependencies = {}): Promise<NetworkDiscoveryResult> {
  if (scanActive) fail('NETWORK_DISCOVERY_BUSY')
  scanActive = true
  const controller = new AbortController()
  let metadataReader: WindowsMetadataReader | undefined
  const cancel = () => controller.abort(new NetworkDiscoveryError('NETWORK_DISCOVERY_CANCELLED'))
  const deadline = setTimeout(() => controller.abort(new NetworkDiscoveryError('NETWORK_DISCOVERY_DEADLINE')), NETWORK_DISCOVERY_LIMITS.deadlineMs)
  options.signal?.addEventListener('abort', cancel, { once: true })
  if (options.signal?.aborted) cancel()
  try {
    validateSnapshot(snapshot)
    checkAbort(controller.signal)
    if (!deps.getSnapshot && !deps.readMetadata) {
      // Only the process/cmdlet imports are reused, never a snapshot. Normal
      // TEST/confirm/enable/receive retain their one-shot metadata reader.
      metadataReader = createWindowsMetadataReader(WINDOWS_NETWORK_METADATA_COMMAND, { platform: deps.platform })
      const reader = metadataReader
      deps = { ...deps, readMetadata: async signal => {
        try { return await reader.read(signal) }
        catch (error) {
          const code = error instanceof Error ? error.message : ''
          throw new NetworkDiscoveryError(/^NETWORK_[A-Z_]+$/.test(code) ? code : 'NETWORK_METADATA_UNAVAILABLE')
        }
      } }
    }
    let current = await assertNetworkSnapshotCurrent(snapshot, deps, controller.signal)
    const endpoints = targets(current)
    if (!endpoints || !endpoints.length) return Object.freeze({ status: 'MANUAL_REQUIRED', candidates: [], attempted: 0,
      totalTargets: 0, reason: endpoints ? 'NETWORK_NO_SUPPORTED_TARGETS' : 'NETWORK_SUBNET_TOO_LARGE' })
    const candidates: NetworkPrinterCandidate[] = []
    let attempted = 0
    for (let offset = 0; offset < endpoints.length; offset += NETWORK_DISCOVERY_LIMITS.concurrency) {
      // Re-read all routes before and after every bounded wave, including failed connections.
      current = await assertNetworkSnapshotCurrent(snapshot, deps, controller.signal)
      const wave = endpoints.slice(offset, offset + NETWORK_DISCOVERY_LIMITS.concurrency)
        .map(endpoint => validateLocalPrinterEndpoint(endpoint.host, endpoint.port, current))
      const open = await Promise.all(wave.map(endpoint => probe(endpoint, controller.signal, deps)))
      attempted += wave.length
      await assertNetworkSnapshotCurrent(snapshot, deps, controller.signal)
      wave.forEach((endpoint, index) => {
        if (!open[index]) return
        checkAbort(controller.signal)
        const candidate: NetworkPrinterCandidate = Object.freeze({ ...endpoint, verified: false, discovery: 'TCP_CONNECT_ONLY' })
        candidates.push(candidate)
        options.onCandidate?.(candidate)
      })
    }
    checkAbort(controller.signal)
    return Object.freeze({ status: 'COMPLETE', candidates: Object.freeze(candidates), attempted, totalTargets: endpoints.length })
  } finally {
    controller.abort()
    clearTimeout(deadline)
    options.signal?.removeEventListener('abort', cancel)
    try { await metadataReader?.close() }
    finally { scanActive = false }
  }
}
