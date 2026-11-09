import { safeStorage } from 'electron'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { ActivationSecretSafeStorage } from '../activation/activationTypes'
import { parseWindowsUsbEndpoint, windowsUsbEndpointKey, type WindowsUsbEndpoint } from './windowsUsbEndpoint'

export type PrinterRole = 'FRONT' | 'KITCHEN'
export type LocalEndpointIdentity = { storeId: string; deviceId: string }
export type LocalEndpoint = { host: string; port: number } | WindowsUsbEndpoint
export type ConfiguredLocalEndpoint = { role: PrinterRole; endpointKey: string }
type EndpointDocument = {
  schemaVersion: 1
  identity: LocalEndpointIdentity
  revision: number
  endpoints: Partial<Record<PrinterRole, LocalEndpoint>>
}
type EncryptedFile = { schemaVersion: 1; encryption: 'electron.safeStorage'; ciphertextBase64: string }

const ROLES = new Set<PrinterRole>(['FRONT', 'KITCHEN'])
const IPV4 = /^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
export function parsePrivateTcpEndpoint(value: unknown): { host: string; port: number } | null {
  const row = record(value)
  if (!row || Object.keys(row).sort().join(',') !== 'host,port' || typeof row.host !== 'string' ||
    !IPV4.test(row.host) || row.host.split('.').some((part) => Number(part) > 255) ||
    !Number.isInteger(row.port) || Number(row.port) < 1 || Number(row.port) > 65535) return null
  const [a, b] = row.host.split('.').map(Number)
  if (!(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))) return null
  return { host: row.host, port: Number(row.port) }
}
function endpointKey(endpoint: LocalEndpoint): string {
  return 'kind' in endpoint ? windowsUsbEndpointKey(endpoint) : `${endpoint.host}:${endpoint.port}`
}

function document(value: unknown): EndpointDocument | null {
  const row = record(value), identity = record(row?.identity), endpoints = record(row?.endpoints)
  if (!row || Object.keys(row).sort().join(',') !== 'endpoints,identity,revision,schemaVersion' || row.schemaVersion !== 1 ||
    !identity || Object.keys(identity).sort().join(',') !== 'deviceId,storeId' || typeof identity.storeId !== 'string' ||
    typeof identity.deviceId !== 'string' || !Number.isInteger(row.revision) || Number(row.revision) < 1 || !endpoints ||
    Object.keys(endpoints).some((role) => !ROLES.has(role as PrinterRole))) return null
  const parsed: Partial<Record<PrinterRole, LocalEndpoint>> = {}
  for (const role of ROLES) {
    if (!(role in endpoints)) continue
    const tcp = parsePrivateTcpEndpoint(endpoints[role])
    const value = tcp ?? (role === 'FRONT'
      ? parseWindowsUsbEndpoint(endpoints[role]) : null)
    if (!value) return null
    parsed[role] = value
  }
  return { schemaVersion: 1, identity: { storeId: identity.storeId, deviceId: identity.deviceId }, revision: Number(row.revision), endpoints: parsed }
}

export class LocalEndpointAuthority {
  private readonly directory: string
  private readonly file: string
  public constructor(userDataPath: string, private readonly identity: LocalEndpointIdentity,
    private readonly storage: ActivationSecretSafeStorage = safeStorage) {
    this.directory = join(userDataPath, 'v3-printing')
    this.file = join(this.directory, 'endpoints.json')
  }

  public async resolve(role: PrinterRole): Promise<{ ok: true; endpointKey: string } | { ok: false; code: string }> {
    if (!ROLES.has(role)) return { ok: false, code: 'ENDPOINT_ROLE_INVALID' }
    const loaded = await this.read()
    if (!loaded.ok) return loaded
    const selected = loaded.value.endpoints[role]
    return selected ? { ok: true, endpointKey: endpointKey(selected) } : { ok: false, code: `ENDPOINT_${role}_MISSING` }
  }

  public async configuredForRecovery(): Promise<
    { ok: true; endpoints: ConfiguredLocalEndpoint[] } | { ok: false; code: string }
  > {
    const loaded = await this.read()
    if (!loaded.ok) return loaded
    const endpoints = [...ROLES].flatMap((role) => {
      const selected = loaded.value.endpoints[role]
      return selected ? [{ role, endpointKey: endpointKey(selected) }] : []
    })
    return endpoints.length > 0 ? { ok: true, endpoints } : { ok: false, code: 'ENDPOINT_CONFIG_EMPTY' }
  }

  public async readSettings(): Promise<
    { ok: true; revision: number; endpoints: EndpointDocument['endpoints'] } | { ok: false; code: string }
  > {
    const loaded = await this.read(true)
    if (loaded.ok) return { ok: true, revision: loaded.value.revision, endpoints: loaded.value.endpoints }
    if (loaded.code === 'ENDPOINT_CONFIG_MISSING') return { ok: true, revision: 0, endpoints: {} }
    return loaded
  }

  public async provision(input: { revision: number; endpoints: Partial<Record<PrinterRole, LocalEndpoint>> },
    settings?: { expectedRevision: number; beforeCommit: () => void },
  ): Promise<void> {
    const validated = document({ schemaVersion: 1, identity: this.identity, revision: input.revision, endpoints: input.endpoints })
    if (!validated) throw new Error('ENDPOINT_CONFIG_INVALID')
    if (!this.storage.isEncryptionAvailable()) throw new Error('ENDPOINT_SECURE_STORAGE_UNAVAILABLE')
    const existing = await this.read(Boolean(settings))
    if (settings && !existing.ok && existing.code !== 'ENDPOINT_CONFIG_MISSING') throw new Error(existing.code)
    if (settings && settings.expectedRevision !== (existing.ok ? existing.value.revision : 0)) {
      throw new Error('ENDPOINT_CONFIG_REVISION_STALE')
    }
    if (existing.ok && input.revision <= existing.value.revision) throw new Error('ENDPOINT_CONFIG_REVISION_STALE')
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const encrypted: EncryptedFile = { schemaVersion: 1, encryption: 'electron.safeStorage', ciphertextBase64: this.storage.encryptString(JSON.stringify(validated)).toString('base64') }
    const temporary = `${this.file}.${process.pid}.tmp`
    const handle = await open(temporary, 'wx', 0o600)
    try {
      try { await handle.writeFile(`${JSON.stringify(encrypted)}\n`, 'utf8'); await handle.sync() } finally { await handle.close() }
      settings?.beforeCommit()
      await rename(temporary, this.file)
    } catch (error) {
      await unlink(temporary).catch(() => undefined)
      throw error
    }
  }

  private async read(distinguishMissing = false): Promise<{ ok: true; value: EndpointDocument } | { ok: false; code: string }> {
    if (!this.storage.isEncryptionAvailable()) return { ok: false, code: 'ENDPOINT_SECURE_STORAGE_UNAVAILABLE' }
    try {
      const outer = record(JSON.parse(await readFile(this.file, 'utf8')))
      if (!outer || Object.keys(outer).sort().join(',') !== 'ciphertextBase64,encryption,schemaVersion' || outer.schemaVersion !== 1 ||
        outer.encryption !== 'electron.safeStorage' || typeof outer.ciphertextBase64 !== 'string') return { ok: false, code: 'ENDPOINT_CONFIG_CORRUPT' }
      const parsed = document(JSON.parse(this.storage.decryptString(Buffer.from(outer.ciphertextBase64, 'base64'))))
      if (!parsed) return { ok: false, code: 'ENDPOINT_CONFIG_CORRUPT' }
      if (parsed.identity.storeId !== this.identity.storeId || parsed.identity.deviceId !== this.identity.deviceId) return { ok: false, code: 'ENDPOINT_IDENTITY_MISMATCH' }
      return { ok: true, value: parsed }
    } catch (error) {
      return { ok: false, code: distinguishMissing && (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? 'ENDPOINT_CONFIG_MISSING' : 'ENDPOINT_CONFIG_UNAVAILABLE' }
    }
  }
}
