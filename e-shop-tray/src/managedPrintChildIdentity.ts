import { safeStorage } from 'electron'
import { readFile, rename, unlink } from 'node:fs/promises'
import path from 'node:path'

const CHILD_AUDIENCE = 'eshop-managed-print-child' as const
const CHILD_SCHEMA_VERSION = 1 as const
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
}

function handoffPath(appDataPath: string) {
  return path.join(appDataPath, CHILD_DIRECTORY, CHILD_HANDOFF_FILENAME)
}

function parse(value: unknown): Handoff {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PRINT_CHILD_HANDOFF_INVALID')
  const row = value as Record<string, unknown>
  const keys = Object.keys(row).sort().join(',')
  if (keys !== 'audience,childId,deviceSecret,expiresAt,installationId,nonce,schemaVersion,storeCode'
    || row.schemaVersion !== CHILD_SCHEMA_VERSION || row.audience !== CHILD_AUDIENCE
    || typeof row.installationId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(row.installationId)
    || typeof row.deviceSecret !== 'string' || !/^ecc_v1_[A-Za-z0-9_-]{32,128}$/.test(row.deviceSecret)
    || typeof row.childId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(row.childId)
    || typeof row.storeCode !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(row.storeCode)
    || typeof row.expiresAt !== 'string' || !Number.isFinite(Date.parse(row.expiresAt)) || Date.parse(row.expiresAt) <= Date.now()
    || typeof row.nonce !== 'string' || !/^[0-9a-f-]{32,128}$/i.test(row.nonce)) {
    throw new Error('PRINT_CHILD_HANDOFF_INVALID')
  }
  return row as Handoff
}

/** Consume the Desktop-written handoff exactly once; no legacy identity is fabricated. */
export async function consumeManagedPrintChildIdentity(appDataPath: string): Promise<ManagedPrintChildIdentity | null> {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('PRINT_CHILD_SAFE_STORAGE_UNAVAILABLE')
  const source = handoffPath(appDataPath)
  let encrypted: string
  try { encrypted = await readFile(source, 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new Error('PRINT_CHILD_HANDOFF_UNAVAILABLE')
  }
  const consumed = `${source}.consumed-${process.pid}-${Date.now()}`
  try { await rename(source, consumed) }
  catch { throw new Error('PRINT_CHILD_HANDOFF_REPLAYED') }
  try {
    const handoff = parse(JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, 'base64'))))
    return {
      installationId: handoff.installationId,
      deviceSecret: handoff.deviceSecret,
      bindingState: 'CLOUD_BOUND',
      computerId: handoff.childId,
      storeCode: handoff.storeCode,
      boundAt: new Date().toISOString(),
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'PRINT_CHILD_HANDOFF_INVALID') throw error
    throw new Error('PRINT_CHILD_HANDOFF_INVALID')
  } finally {
    await unlink(consumed).catch(() => undefined)
  }
}

export { handoffPath as managedPrintChildHandoffPath }
