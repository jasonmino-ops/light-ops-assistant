import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, open, readFile, link, unlink, lstat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { exactObject, parseNetworkMode, type NetworkMode, type NetworkRequest } from './networkContract'
import type { DesktopBindingIdentity } from './desktopBindingIdentity'
import type { ClaimTokenProtector } from './executionJournal'

export type NetworkNode = Readonly<{ host: string; port: number }>
export type NetworkPrinterConfig = Readonly<{ mode: NetworkMode; endpoint: NetworkNode }>
export function resolveNetworkEndpoint(config: NetworkPrinterConfig, request: NetworkRequest): NetworkNode {
  if (config.mode !== request.mode || (config.mode === 'FRONT_ONLY' && request.role !== 'FRONT')) {
    throw new Error('NETWORK_MODE_MISMATCH')
  }
  return config.endpoint
}
type Interfaces = ReturnType<typeof os.networkInterfaces>
function ip(value: string): number {
  if (!/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(value)) throw new Error('NETWORK_IPV4_LITERAL_REQUIRED')
  const bytes = value.split('.').map(Number)
  if (bytes.some(b => b > 255)) throw new Error('NETWORK_INVALID_IPV4')
  return bytes.reduce((result, byte) => (result * 256 + byte) >>> 0, 0)
}
/** Structural validation only, for displaying an old address during recovery.
 * This never authorizes connecting; every transport still calls validateNetworkNode. */
export function validateNetworkLiteral(value: unknown): NetworkNode {
  const node = exactObject(value, ['host', 'port'])
  if (typeof node.host !== 'string' || !Number.isSafeInteger(node.port) || Number(node.port) < 1 || Number(node.port) > 65535) {
    throw new Error('NETWORK_INVALID_ENDPOINT')
  }
  const address = ip(node.host)
  const [a, b] = node.host.split('.').map(Number)
  if (!(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))) {
    throw new Error('NETWORK_RFC1918_REQUIRED')
  }
  return Object.freeze({ host: node.host, port: Number(node.port) })
}
export function validateNetworkNode(value: unknown, interfaces: Interfaces = os.networkInterfaces()): NetworkNode {
  const node = validateNetworkLiteral(value)
  const address = ip(node.host)
  // V0.1: directly connected private LAN only. A /25 broadcast can end in .127.
  const matches = Object.values(interfaces).flatMap(items => items ?? [])
    .filter(item => !item.internal && item.family === 'IPv4')
    .filter(item => (ip(item.address) & ip(item.netmask)) === (address & ip(item.netmask)))
  if (!matches.length) throw new Error('NETWORK_DIRECT_LAN_REQUIRED')
  for (const item of matches) {
    const mask = ip(item.netmask)
    const inverse = (~mask) >>> 0
    if (inverse < 3 || ((inverse + 1) & inverse) !== 0
      || address === ip(item.address) || (address & inverse) === 0 || (address & inverse) === inverse) {
      throw new Error('NETWORK_SPECIAL_ADDRESS_REJECTED')
    }
  }
  return Object.freeze({ host: node.host, port: Number(node.port) })
}

export async function protectNetworkDirectory(directory: string) {
  if (process.platform !== 'win32') throw new Error('NETWORK_WINDOWS_REQUIRED')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('NETWORK_CONFIG_LINK_REJECTED')
  const run = promisify(execFile)
  const user = await run('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true })
  const sid = user.stdout.match(/S-1-5-[0-9-]+/)?.[0]
  if (!sid) throw new Error('NETWORK_ACL_IDENTITY_UNAVAILABLE')
  // Clear stale explicit grants on this application's directory, then remove inheritance.
  await run('icacls.exe', [directory, '/reset'], { windowsHide: true })
  await run('icacls.exe', [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { windowsHide: true })
}

export class NetworkNodeConfig {
  constructor(private readonly options: {
    file: string
    identity: Pick<DesktopBindingIdentity, 'installationId' | 'computerId' | 'storeCode' | 'boundAt'>
    protector: ClaimTokenProtector
    interfaces?: () => Interfaces
  }) {}

  private config(value: unknown): NetworkPrinterConfig {
    // A single physical endpoint is explicit. Two ports are never pseudo-nodes.
    const config = exactObject(value, ['mode', 'endpoint'])
    const interfaces = this.options.interfaces?.() ?? os.networkInterfaces()
    return Object.freeze({ mode: parseNetworkMode(config.mode), endpoint: validateNetworkNode(config.endpoint, interfaces) })
  }

  async save(value: unknown) {
    const config = this.config(value)
    // V0.1 chooses one mode/physical endpoint at initial setup. Re-imports are
    // idempotent, not live routing changes: a restart or the gap between FRONT
    // ACK and KITCHEN must never redirect the remainder of an existing order.
    let existing: NetworkPrinterConfig | undefined
    try { existing = await this.read() }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (existing) {
      if (existing.mode !== config.mode || existing.endpoint.host !== config.endpoint.host
        || existing.endpoint.port !== config.endpoint.port) throw new Error('NETWORK_INITIAL_CONFIG_LOCKED')
      return
    }
    const document = { schemaVersion: 2, identity: this.options.identity, config }
    const sealed = this.options.protector.protect(JSON.stringify(document))
    const temporary = `${this.options.file}.${process.pid}.tmp`
    const handle = await open(temporary, 'wx', 0o600)
    try { await handle.writeFile(sealed, 'utf8'); await handle.sync() } finally { await handle.close() }
    // Publish complete encrypted bytes atomically without replacing a winner
    // from a concurrent initializer. NTFS hard-link creation fails on EEXIST.
    await link(temporary, this.options.file)
    await unlink(temporary)
  }

  async read(): Promise<NetworkPrinterConfig> {
    return this.config(await this.readForRecovery())
  }

  /** Read an identity-protected old endpoint even after moving to another LAN.
   * For recovery UI only; read() retains the original direct-LAN enforcement. */
  async readForRecovery(): Promise<NetworkPrinterConfig> {
    const info = await lstat(this.options.file)
    if (!info.isFile() || info.isSymbolicLink() || info.size > 32768) throw new Error('NETWORK_CONFIG_INVALID')
    const raw = await readFile(this.options.file, 'utf8')
    const document = exactObject(JSON.parse(this.options.protector.unprotect(raw)), ['schemaVersion', 'identity', 'config'])
    const identity = exactObject(document.identity, ['installationId', 'computerId', 'storeCode', 'boundAt'])
    if (document.schemaVersion !== 2 || Object.entries(this.options.identity).some(([key, value]) => identity[key] !== value)) {
      throw new Error('NETWORK_CONFIG_IDENTITY_MISMATCH')
    }
    const config = exactObject(document.config, ['mode', 'endpoint'])
    return Object.freeze({ mode: parseNetworkMode(config.mode), endpoint: validateNetworkLiteral(config.endpoint) })
  }
}
