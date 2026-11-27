import { randomBytes, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { safeStorage } from 'electron'
import { sealPrintChildHandoff } from './windowsPrintChildProtection'

const CHILD_AUDIENCE = 'eshop-managed-print-child' as const
const CHILD_SCHEMA_VERSION = 1 as const
const CHILD_DIRECTORY = 'E-Shop-Network-Print-Addon'
const CHILD_IDENTITY_FILENAME = 'managed-print-child.bin'
const CHILD_HANDOFF_FILENAME = 'managed-print-child-handoff.bin'
const MAX_HANDOFF_AGE_MS = 60_000
const MAX_FILE_BYTES = 32_768
const pending = new Map<string, Promise<void>>()

export type ManagedPrintChildSession = {
  browserDeviceId: string
  storeCode: string
  token: string
  expiresAt: string
}

type ManagedPrintChildLocalIdentity = {
  schemaVersion: typeof CHILD_SCHEMA_VERSION
  audience: typeof CHILD_AUDIENCE
  installationId: string
  deviceSecret: string
  storeCode?: string
  boundAt?: string
}

type ManagedPrintChildHandoff = Omit<ManagedPrintChildLocalIdentity, 'schemaVersion'> & {
  schemaVersion: 2
  boundAt: string
  childId: string
  storeCode: string
  expiresAt: string
  nonce: string
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>

function childPath(appDataPath: string, filename: string) {
  return path.join(appDataPath, CHILD_DIRECTORY, filename)
}

function validInstallationId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value)
}

function validDeviceSecret(value: unknown): value is string {
  return typeof value === 'string' && /^ecc_v1_[A-Za-z0-9_-]{32,128}$/.test(value)
}

function parseLocal(value: unknown): ManagedPrintChildLocalIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PRINT_CHILD_IDENTITY_INVALID')
  const row = value as Record<string, unknown>
  if (!['audience,deviceSecret,installationId,schemaVersion', 'audience,deviceSecret,installationId,schemaVersion,storeCode', 'audience,boundAt,deviceSecret,installationId,schemaVersion,storeCode'].includes(Object.keys(row).sort().join(','))
    || row.schemaVersion !== CHILD_SCHEMA_VERSION || row.audience !== CHILD_AUDIENCE
    || !validInstallationId(row.installationId) || !validDeviceSecret(row.deviceSecret)
    || (row.storeCode !== undefined && (typeof row.storeCode !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(row.storeCode)))
    || (row.boundAt !== undefined && (typeof row.boundAt !== 'string' || !Number.isFinite(Date.parse(row.boundAt)) || Date.parse(row.boundAt) > Date.now()))) {
    throw new Error('PRINT_CHILD_IDENTITY_INVALID')
  }
  return { schemaVersion: CHILD_SCHEMA_VERSION, audience: CHILD_AUDIENCE,
    installationId: row.installationId, deviceSecret: row.deviceSecret,
    ...(typeof row.storeCode === 'string' ? { storeCode: row.storeCode } : {}),
    ...(typeof row.boundAt === 'string' ? { boundAt: row.boundAt } : {}) }
}

async function atomicEncryptedWrite(destination: string, value: string, handoff = false) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('PRINT_CHILD_SAFE_STORAGE_UNAVAILABLE')
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
  const directory = await lstat(path.dirname(destination))
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('PRINT_CHILD_DIRECTORY_INVALID')
  const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`
  const handle = await open(temporary, 'wx', 0o600)
  try {
    try {
      const ciphertext = handoff ? await sealPrintChildHandoff(value) : safeStorage.encryptString(value).toString('base64')
      await handle.writeFile(ciphertext, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, destination)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

async function readLocalIdentity(appDataPath: string): Promise<ManagedPrintChildLocalIdentity | null> {
  const source = childPath(appDataPath, CHILD_IDENTITY_FILENAME)
  let encrypted: string
  try {
    const info = await lstat(source)
    if (!info.isFile() || info.isSymbolicLink() || info.size === 0 || info.size > MAX_FILE_BYTES) throw new Error('PRINT_CHILD_IDENTITY_INVALID')
    encrypted = await readFile(source, 'utf8')
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new Error('PRINT_CHILD_IDENTITY_UNAVAILABLE')
  }
  try {
    return parseLocal(JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, 'base64'))))
  } catch (error) {
    if (error instanceof Error && error.message === 'PRINT_CHILD_IDENTITY_INVALID') throw error
    throw new Error('PRINT_CHILD_IDENTITY_INVALID')
  }
}

async function localIdentity(appDataPath: string) {
  const existing = await readLocalIdentity(appDataPath)
  if (existing) return existing
  const created: ManagedPrintChildLocalIdentity = {
    schemaVersion: CHILD_SCHEMA_VERSION,
    audience: CHILD_AUDIENCE,
    installationId: `print-child-${randomUUID()}`,
    deviceSecret: `ecc_v1_${randomBytes(48).toString('base64url')}`,
  }
  await atomicEncryptedWrite(childPath(appDataPath, CHILD_IDENTITY_FILENAME), JSON.stringify(created))
  return created
}

/**
 * Uses the already server-issued Desktop-derived POS session only as a
 * bounded proof to provision/recover the hidden child. The Desktop credential
 * never leaves the existing main-process CredentialStore path.
 */
async function provisionHandoff(
  appDataPath: string,
  session: ManagedPrintChildSession,
  options: { baseUrl?: string; fetchImpl?: FetchLike } = {},
): Promise<void> {
  // A rejected refresh must never leave an older capability available for a
  // later settings-only launch. Server-side parent/store checks remain authoritative.
  const destination = childPath(appDataPath, CHILD_HANDOFF_FILENAME)
  try {
    const directory = await lstat(path.dirname(destination))
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('PRINT_CHILD_DIRECTORY_INVALID')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await unlink(destination).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(session.storeCode) || !session.browserDeviceId || !session.token
    || !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= Date.now()) {
    throw new Error('PRINT_CHILD_SESSION_EXPIRED')
  }
  const identity = await localIdentity(appDataPath)
  if (identity.storeCode !== undefined && identity.storeCode !== session.storeCode) throw new Error('PRINT_CHILD_STORE_MISMATCH')
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const response = await fetchImpl(`${(options.baseUrl ?? 'https://elifekh.com').replace(/\/+$/, '')}/api/desktop/print-child`, {
    method: 'POST',
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-pos-device-id': session.browserDeviceId,
      'x-pos-device-token': session.token,
    },
    body: JSON.stringify({ installationId: identity.installationId, deviceSecret: identity.deviceSecret, agentVersion: 'managed-print-child-v1' }),
  })
  const body = await response.json().catch(() => null) as Record<string, unknown> | null
  if (!response.ok || !body || body.ok !== true || typeof body.childId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(body.childId)
    || body.storeCode !== session.storeCode || typeof body.credentialExpiresAt !== 'string'
    || !Number.isFinite(Date.parse(body.credentialExpiresAt)) || Date.parse(body.credentialExpiresAt) <= Date.now()) {
    throw new Error('PRINT_CHILD_PROVISION_REJECTED')
  }
  const expiresAt = Math.min(Date.parse(session.expiresAt), Date.parse(body.credentialExpiresAt), Date.now() + MAX_HANDOFF_AGE_MS)
  if (expiresAt <= Date.now()) throw new Error('PRINT_CHILD_SESSION_EXPIRED')
  const boundAt = identity.boundAt ?? new Date().toISOString()
  await atomicEncryptedWrite(childPath(appDataPath, CHILD_IDENTITY_FILENAME), JSON.stringify({ ...identity, storeCode: session.storeCode, boundAt }))
  const handoff: ManagedPrintChildHandoff = {
    schemaVersion: 2,
    boundAt,
    audience: identity.audience,
    installationId: identity.installationId,
    deviceSecret: identity.deviceSecret,
    childId: body.childId,
    storeCode: session.storeCode,
    expiresAt: new Date(expiresAt).toISOString(),
    nonce: randomUUID(),
  }
  await atomicEncryptedWrite(destination, JSON.stringify(handoff), true)
}

export async function writeManagedPrintChildHandoff(
  appDataPath: string,
  session: ManagedPrintChildSession,
  options: { baseUrl?: string; fetchImpl?: FetchLike } = {},
): Promise<void> {
  const key = path.resolve(appDataPath)
  const previous = pending.get(key) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(() => provisionHandoff(key, session, options))
  pending.set(key, next)
  try { await next }
  finally { if (pending.get(key) === next) pending.delete(key) }
}

export const managedPrintChildHandoffPath = (appDataPath: string) => childPath(appDataPath, CHILD_HANDOFF_FILENAME)
export const managedPrintChildIdentityPath = (appDataPath: string) => childPath(appDataPath, CHILD_IDENTITY_FILENAME)
