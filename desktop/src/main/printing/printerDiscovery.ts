import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { Socket } from 'node:net'
import os from 'node:os'
import { join } from 'node:path'

// Reused RC10 discovery limits and zero-payload scan semantics. Desktop uses
// Node interface metadata plus the Windows arp.exe inbox utility; it never
// invokes PowerShell and never sends ESC/POS bytes during discovery.
export const PRINTER_DISCOVERY_LIMITS = Object.freeze({
  targets: 1024,
  concurrency: 16,
  connectTimeoutMs: 600,
  verifyTimeoutMs: 3_000,
  deadlineMs: 45_000,
  defaultPort: 9100,
})

export type PrinterCandidate = Readonly<{
  id: string
  ip: string
  port: number
  hardwareAddress: string
  interfaceName: string
  localAddress: string
}>

export type PrinterDiscoveryResult = Readonly<{
  status: 'COMPLETE' | 'MANUAL_REQUIRED'
  candidates: readonly PrinterCandidate[]
  attempted: number
  totalTargets: number
  reason?: string
}>

type Network = Readonly<{
  name: string
  localAddress: string
  first: number
  last: number
}>

export interface DiscoverySocket {
  once(event: string, listener: (...args: any[]) => void): this
  setTimeout(timeout: number): this
  connect(options: { host: string; port: number; localAddress: string; family: 4 }): this
  destroy(): this
}

export type PrinterDiscoveryDependencies = {
  platform?: () => NodeJS.Platform
  interfaces?: typeof os.networkInterfaces
  createSocket?: () => DiscoverySocket
  readHardwareAddress?: (host: string, localAddress: string) => Promise<string | null>
}

const IPV4 = /^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/
const EXCLUDED_INTERFACE = /vpn|virtual|vethernet|hyper-v|vmware|virtualbox|loopback|tunnel|wireguard|wintun|tailscale|zerotier|docker|bluetooth|\b(?:tap|tun|ppp|bridge)\b/i

function ipv4(value: string): number | null {
  if (!IPV4.test(value)) return null
  const parts = value.split('.').map(Number)
  if (parts.some((part) => part > 255)) return null
  return parts.reduce((result, part) => ((result << 8) | part) >>> 0, 0) >>> 0
}

function address(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.')
}

function privateAddress(value: number): boolean {
  const a = value >>> 24
  const b = (value >>> 16) & 255
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

function prefixFromNetmask(value: string): number | null {
  const parsed = ipv4(value)
  if (parsed == null) return null
  const inverted = (~parsed) >>> 0
  if ((inverted & (inverted + 1)) !== 0) return null
  return 32 - Math.log2(inverted + 1)
}

function normalizeMac(value: string): string | null {
  const mac = value.trim().replaceAll(':', '-').toLowerCase()
  if (!/^[0-9a-f]{2}(-[0-9a-f]{2}){5}$/.test(mac) || mac === '00-00-00-00-00-00') return null
  return (Number.parseInt(mac.slice(0, 2), 16) & 1) === 0 ? mac : null
}

export function parseWindowsArp(output: string, host: string): string | null {
  if (ipv4(host) == null) return null
  for (const line of output.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/)
    if (columns[0] !== host || !columns[1]) continue
    const normalized = normalizeMac(columns[1])
    if (normalized) return normalized
  }
  return null
}

export async function readWindowsArpHardwareAddress(host: string, localAddress: string): Promise<string | null> {
  if (process.platform !== 'win32' || ipv4(host) == null || ipv4(localAddress) == null) return null
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  return new Promise((resolve) => {
    // -N binds the neighbor lookup to the same physical local address used by
    // the zero-payload TCP probe; argv is validated and never shell-expanded.
    execFile(join(systemRoot, 'System32', 'arp.exe'), ['-a', host, '-N', localAddress], {
      windowsHide: true,
      timeout: PRINTER_DISCOVERY_LIMITS.verifyTimeoutMs,
      maxBuffer: 64 * 1024,
      encoding: 'utf8',
    }, (error, stdout) => resolve(error ? null : parseWindowsArp(stdout, host)))
  })
}

export function listDirectPrivateNetworks(interfaces: ReturnType<typeof os.networkInterfaces>): readonly Network[] {
  const networks: Network[] = []
  for (const [name, values] of Object.entries(interfaces)) {
    if (EXCLUDED_INTERFACE.test(name)) continue
    for (const value of values ?? []) {
      if (value.internal || value.family !== 'IPv4') continue
      const local = ipv4(value.address)
      const prefix = prefixFromNetmask(value.netmask)
      if (local == null || prefix == null || prefix > 30 || !privateAddress(local)) continue
      const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
      const first = (local & mask) >>> 0
      const last = (first | (~mask >>> 0)) >>> 0
      if (!privateAddress(first) || !privateAddress(last) || local === first || local === last) continue
      networks.push(Object.freeze({ name, localAddress: value.address, first, last }))
    }
  }
  return Object.freeze(networks.sort((left, right) => left.localAddress.localeCompare(right.localAddress, 'en')))
}

function networkFingerprint(networks: readonly Network[]): string {
  return createHash('sha256').update(JSON.stringify(networks)).digest('hex')
}

function targetList(networks: readonly Network[]): Array<{ host: string; localAddress: string; interfaceName: string }> | null {
  const count = networks.reduce((sum, network) => sum + Math.max(0, network.last - network.first - 1), 0)
  if (count === 0 || count > PRINTER_DISCOVERY_LIMITS.targets) return null
  const unique = new Map<string, { host: string; localAddress: string; interfaceName: string } | null>()
  for (const network of networks) {
    const local = ipv4(network.localAddress)!
    for (let value = network.first + 1; value < network.last; value += 1) {
      if (value === local) continue
      const host = address(value)
      unique.set(host, unique.has(host) ? null : { host, localAddress: network.localAddress, interfaceName: network.name })
    }
  }
  return [...unique.values()].filter((value): value is NonNullable<typeof value> => value !== null)
}

function zeroPayloadProbe(
  endpoint: { host: string; port: number; localAddress: string },
  timeoutMs: number,
  createSocket: () => DiscoverySocket,
  signal?: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    let socket: DiscoverySocket | null = null
    const timer = setTimeout(() => finish(false), timeoutMs)
    const finish = (open: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      socket?.destroy()
      resolve(open && !signal?.aborted)
    }
    const abort = () => finish(false)
    try {
      if (signal?.aborted) return finish(false)
      socket = createSocket()
      socket.once('connect', () => finish(true))
      socket.once('timeout', () => finish(false))
      socket.once('error', () => finish(false))
      socket.once('close', () => finish(false))
      socket.setTimeout(timeoutMs)
      signal?.addEventListener('abort', abort, { once: true })
      socket.connect({ host: endpoint.host, port: endpoint.port, localAddress: endpoint.localAddress, family: 4 })
    } catch {
      finish(false)
    }
  })
}

export class LanPrinterDiscovery {
  private active = false

  constructor(private readonly dependencies: PrinterDiscoveryDependencies = {}) {}

  async discover(): Promise<PrinterDiscoveryResult> {
    if (this.active) throw new Error('PRINTER_DISCOVERY_BUSY')
    if ((this.dependencies.platform?.() ?? process.platform) !== 'win32') throw new Error('PRINTER_DISCOVERY_WINDOWS_REQUIRED')
    this.active = true
    const controller = new AbortController()
    const deadline = setTimeout(() => controller.abort(), PRINTER_DISCOVERY_LIMITS.deadlineMs)
    try {
      const readInterfaces = this.dependencies.interfaces ?? os.networkInterfaces
      const networks = listDirectPrivateNetworks(readInterfaces())
      const fingerprint = networkFingerprint(networks)
      const targets = targetList(networks)
      if (!targets) return Object.freeze({
        status: 'MANUAL_REQUIRED', candidates: [], attempted: 0, totalTargets: 0,
        reason: networks.length === 0 ? 'PRINTER_DISCOVERY_NO_SUPPORTED_NETWORK' : 'PRINTER_DISCOVERY_SUBNET_TOO_LARGE',
      })
      const createSocket = this.dependencies.createSocket ?? (() => new Socket())
      const readHardware = this.dependencies.readHardwareAddress ?? readWindowsArpHardwareAddress
      const candidates: PrinterCandidate[] = []
      let attempted = 0
      for (let offset = 0; offset < targets.length; offset += PRINTER_DISCOVERY_LIMITS.concurrency) {
        if (controller.signal.aborted) throw new Error('PRINTER_DISCOVERY_DEADLINE')
        const wave = targets.slice(offset, offset + PRINTER_DISCOVERY_LIMITS.concurrency)
        const open = await Promise.all(wave.map((target) => zeroPayloadProbe(
          { ...target, port: PRINTER_DISCOVERY_LIMITS.defaultPort },
          PRINTER_DISCOVERY_LIMITS.connectTimeoutMs,
          createSocket,
          controller.signal,
        )))
        attempted += wave.length
        const identities = await Promise.all(wave.map((target, index) =>
          open[index] ? readHardware(target.host, target.localAddress) : null))
        wave.forEach((target, index) => {
          const hardwareAddress = identities[index] ? normalizeMac(identities[index]!) : null
          if (!open[index] || !hardwareAddress) return
          candidates.push(Object.freeze({
            id: `${target.host}:${PRINTER_DISCOVERY_LIMITS.defaultPort}@${hardwareAddress}`,
            ip: target.host,
            port: PRINTER_DISCOVERY_LIMITS.defaultPort,
            hardwareAddress,
            interfaceName: target.interfaceName,
            localAddress: target.localAddress,
          }))
        })
      }
      if (networkFingerprint(listDirectPrivateNetworks(readInterfaces())) !== fingerprint) {
        throw new Error('PRINTER_DISCOVERY_NETWORK_CHANGED')
      }
      candidates.sort((left, right) => left.ip.localeCompare(right.ip, 'en'))
      return Object.freeze({ status: 'COMPLETE', candidates: Object.freeze(candidates), attempted, totalTargets: targets.length })
    } finally {
      controller.abort()
      clearTimeout(deadline)
      this.active = false
    }
  }

  async validate(candidate: PrinterCandidate): Promise<boolean> {
    if ((this.dependencies.platform?.() ?? process.platform) !== 'win32') return false
    const networks = listDirectPrivateNetworks((this.dependencies.interfaces ?? os.networkInterfaces)())
    const match = networks.find((network) => candidate.localAddress === network.localAddress && candidate.interfaceName === network.name &&
      ipv4(candidate.ip)! > network.first && ipv4(candidate.ip)! < network.last)
    if (!match) return false
    const open = await zeroPayloadProbe({ host: candidate.ip, port: candidate.port, localAddress: candidate.localAddress }, PRINTER_DISCOVERY_LIMITS.verifyTimeoutMs,
      this.dependencies.createSocket ?? (() => new Socket()))
    if (!open) return false
    const observed = await (this.dependencies.readHardwareAddress ?? readWindowsArpHardwareAddress)(candidate.ip, candidate.localAddress)
    return observed != null && normalizeMac(observed) === candidate.hardwareAddress
  }
}
