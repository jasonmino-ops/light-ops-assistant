import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { safeStorage } from 'electron'

const CHILD_AUDIENCE = 'eshop-managed-print-child' as const
const CHILD_SCHEMA_VERSION = 1 as const
const CHILD_DIRECTORY = 'E-Shop-Network-Print-Addon'
const CHILD_IDENTITY_FILENAME = 'managed-print-child.bin'
const CHILD_HANDOFF_FILENAME = 'managed-print-child-handoff.bin'

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
}

type ManagedPrintChildHandoff = ManagedPrintChildLocalIdentity & {
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
  if (row.schemaVersion !== CHILD_SCHEMA_VERSION || row.audience !== CHILD_AUDIENCE
    || !validInstallationId(row.installationId) || !validDeviceSecret(row.deviceSecret)) {
    throw new Error('PRINT_CHILD_IDENTITY_INVALID')
  }
  return { schemaVersion: CHILD_SCHEMA_VERSION, audience: CHILD_AUDIENCE,
    installationId: row.installationId, deviceSecret: row.deviceSecret }
}

async function atomicEncryptedWrite(destination: string, value: string) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('PRINT_CHILD_SAFE_STORAGE_UNAVAILABLE')
  await mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`
  const handle = await open(temporary, 'w')
  try {
    await handle.writeFile(safeStorage.encryptString(value).toString('base64'), 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporary, destination)
}

async function readLocalIdentity(appDataPath: string): Promise<ManagedPrintChildLocalIdentity | null> {
  const source = childPath(appDataPath, CHILD_IDENTITY_FILENAME)
  let encrypted: string
  try { encrypted = await readFile(source, 'utf8') }
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
export async function writeManagedPrintChildHandoff(
  appDataPath: string,
  session: ManagedPrintChildSession,
  options: { baseUrl?: string; fetchImpl?: FetchLike } = {},
): Promise<void> {
  if (!Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= Date.now()) {
    throw new Error('PRINT_CHILD_SESSION_EXPIRED')
  }
  const identity = await localIdentity(appDataPath)
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const response = await fetchImpl(`${(options.baseUrl ?? 'https://elifekh.com').replace(/\/+$/, '')}/api/desktop/print-child`, {
    method: 'POST',
    redirect: 'error',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-pos-device-id': session.browserDeviceId,
      'x-pos-device-token': session.token,
    },
    body: JSON.stringify({ installationId: identity.installationId, deviceSecret: identity.deviceSecret, agentVersion: 'managed-print-child-v1' }),
  })
  const body = await response.json().catch(() => null) as Record<string, unknown> | null
  if (!response.ok || !body || body.ok !== true || typeof body.childId !== 'string'
    || body.storeCode !== session.storeCode || typeof body.credentialExpiresAt !== 'string'
    || !Number.isFinite(Date.parse(body.credentialExpiresAt)) || Date.parse(body.credentialExpiresAt) <= Date.now()) {
    throw new Error(typeof body?.error === 'string' ? body.error : 'PRINT_CHILD_PROVISION_REJECTED')
  }
  const handoff: ManagedPrintChildHandoff = {
    ...identity,
    childId: body.childId,
    storeCode: session.storeCode,
    expiresAt: body.credentialExpiresAt,
    nonce: randomUUID(),
  }
  await atomicEncryptedWrite(childPath(appDataPath, CHILD_HANDOFF_FILENAME), JSON.stringify(handoff))
}

export const managedPrintChildHandoffPath = (appDataPath: string) => childPath(appDataPath, CHILD_HANDOFF_FILENAME)
export const managedPrintChildIdentityPath = (appDataPath: string) => childPath(appDataPath, CHILD_IDENTITY_FILENAME)
