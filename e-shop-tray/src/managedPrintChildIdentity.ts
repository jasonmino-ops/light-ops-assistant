import { unsealPrintChildHandoff } from './windowsPrintChildProtection'
import { randomUUID } from 'node:crypto'
import { lstat, readFile, rename, unlink } from 'node:fs/promises'
import path from 'node:path'

const CHILD_AUDIENCE = 'eshop-managed-print-child' as const
const CHILD_SCHEMA_VERSION = 2 as const
const CHILD_DIRECTORY = 'E-Shop-Network-Print-Addon'
const CHILD_HANDOFF_FILENAME = 'managed-print-child-handoff.bin'

export type ManagedPrintChildIdentity = {
  installationId: string
  deviceSecret: string
  bindingState: 'CLOUD_BOUND'
  computerId: string
  storeCode: string
  boundAt: string
}

type Handoff = {
  schemaVersion: typeof CHILD_SCHEMA_VERSION
  audience: typeof CHILD_AUDIENCE
  installationId: string
  deviceSecret: string
  childId: string
  storeCode: string
  expiresAt: string
  nonce: string
  boundAt: string
}

function handoffPath(appDataPath: string) {
  return path.join(appDataPath, CHILD_DIRECTORY, CHILD_HANDOFF_FILENAME)
}

function parse(value: unknown): Handoff {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PRINT_CHILD_HANDOFF_INVALID')
  const row = value as Record<string, unknown>
  const keys = Object.keys(row).sort().join(',')
  if (keys !== 'audience,boundAt,childId,deviceSecret,expiresAt,installationId,nonce,schemaVersion,storeCode'
    || typeof row.boundAt !== 'string' || !Number.isFinite(Date.parse(row.boundAt)) || Date.parse(row.boundAt) > Date.now()
    || row.schemaVersion !== CHILD_SCHEMA_VERSION || row.audience !== CHILD_AUDIENCE
    || typeof row.installationId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(row.installationId)
    || typeof row.deviceSecret !== 'string' || !/^ecc_v1_[A-Za-z0-9_-]{32,128}$/.test(row.deviceSecret)
    || typeof row.childId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(row.childId)
    || typeof row.storeCode !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(row.storeCode)
    || typeof row.expiresAt !== 'string' || !Number.isFinite(Date.parse(row.expiresAt)) || Date.parse(row.expiresAt) <= Date.now()
    || Date.parse(row.expiresAt) > Date.now() + 60_000
    || typeof row.nonce !== 'string' || !/^[0-9a-f-]{32,128}$/i.test(row.nonce)) {
    throw new Error('PRINT_CHILD_HANDOFF_INVALID')
  }
  return row as Handoff
}

/** Consume the Desktop-written handoff exactly once; no legacy identity is fabricated. */
export async function consumeManagedPrintChildIdentity(appDataPath: string): Promise<ManagedPrintChildIdentity | null> {
  const source = handoffPath(appDataPath)
  try {
    const directory = await lstat(path.dirname(source))
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('PRINT_CHILD_HANDOFF_INVALID')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  const consumed = `${source}.consumed-${randomUUID()}`
  try { await rename(source, consumed) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new Error('PRINT_CHILD_HANDOFF_REPLAYED')
  }
  try {
    // Claim the file first, then read exactly the claimed bytes. Reading the
    // public pathname before rename could execute an older handoff twice.
    const info = await lstat(consumed)
    if (!info.isFile() || info.isSymbolicLink() || info.size === 0 || info.size > 32_768) throw new Error('PRINT_CHILD_HANDOFF_INVALID')
    const encrypted = await readFile(consumed, 'utf8')
    const handoff = parse(JSON.parse(await unsealPrintChildHandoff(encrypted)))
    return {
      installationId: handoff.installationId,
      deviceSecret: handoff.deviceSecret,
      bindingState: 'CLOUD_BOUND',
      computerId: handoff.childId,
      storeCode: handoff.storeCode,
      boundAt: handoff.boundAt,
    }
  } catch (error) {
    if (error instanceof Error && ['PRINT_CHILD_HANDOFF_INVALID', 'PRINT_CHILD_DPAPI_TIMEOUT',
      'PRINT_CHILD_DPAPI_UNAVAILABLE', 'PRINT_CHILD_DPAPI_FAILED', 'PRINT_CHILD_DPAPI_INVALID_RESPONSE',
      'PRINT_CHILD_WINDOWS_REQUIRED'].includes(error.message)) throw error
    throw new Error('PRINT_CHILD_HANDOFF_INVALID')
  } finally {
    await unlink(consumed).catch(() => undefined)
  }
}

export { handoffPath as managedPrintChildHandoffPath }
