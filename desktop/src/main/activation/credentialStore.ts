import { safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  access,
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  readdir,
} from 'node:fs/promises'
import { basename, join } from 'node:path'
import type {
  ActivationCredentialV1,
  ActivationMetadataV1,
  ActivationSecretSafeStorage,
  EncryptedCredentialFileV1,
  InstallationRecordV1,
  PublicDeviceIdentity,
} from './activationTypes'

const ACTIVATION_DIR = 'activation'
const INSTALLATION_FILE = 'installation.json'
const METADATA_FILE = 'metadata.json'
const CREDENTIAL_FILE = 'credential.json'
const TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000

export type CredentialReadResult =
  | { ok: true; credential: ActivationCredentialV1 }
  | { ok: false; reason: 'missing' | 'safe-storage-unavailable' | 'corrupt' | 'decrypt-failed' | 'schema-mismatch' }

export type CredentialWriteResult =
  | { ok: true }
  | { ok: false; reason: 'safe-storage-unavailable' | 'encrypt-failed' | 'write-failed' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function parseJsonRecord(raw: string): Record<string, unknown> | null {
  if (!raw.trim()) return null
  try {
    const parsed = JSON.parse(raw)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function parseInstallation(raw: string): InstallationRecordV1 | null {
  const parsed = parseJsonRecord(raw)
  if (
    parsed?.schemaVersion === 1 &&
    typeof parsed.installationId === 'string' &&
    isUuid(parsed.installationId) &&
    typeof parsed.createdAt === 'string'
  ) {
    return {
      schemaVersion: 1,
      installationId: parsed.installationId,
      createdAt: parsed.createdAt,
    }
  }
  return null
}

function parseMetadata(raw: string): ActivationMetadataV1 | null {
  const parsed = parseJsonRecord(raw)
  if (parsed?.schemaVersion !== 1) return null
  const out: ActivationMetadataV1 = { schemaVersion: 1 }
  if (typeof parsed.storeCodeHint === 'string') out.storeCodeHint = parsed.storeCodeHint
  if (typeof parsed.deviceId === 'string') out.deviceId = parsed.deviceId
  if (typeof parsed.credentialVersion === 'number') out.credentialVersion = parsed.credentialVersion
  if (typeof parsed.tokenExpiresAt === 'string') out.tokenExpiresAt = parsed.tokenExpiresAt
  if (typeof parsed.lastVerifiedAt === 'string') out.lastVerifiedAt = parsed.lastVerifiedAt
  return out
}

function parseCredentialFile(raw: string): EncryptedCredentialFileV1 | null {
  const parsed = parseJsonRecord(raw)
  if (
    parsed?.schemaVersion === 1 &&
    parsed.encryption === 'electron.safeStorage' &&
    typeof parsed.ciphertextBase64 === 'string' &&
    parsed.ciphertextBase64.length > 0 &&
    typeof parsed.updatedAt === 'string'
  ) {
    return {
      schemaVersion: 1,
      encryption: 'electron.safeStorage',
      ciphertextBase64: parsed.ciphertextBase64,
      updatedAt: parsed.updatedAt,
    }
  }
  return null
}

function parseCredential(raw: string): ActivationCredentialV1 | null {
  const parsed = parseJsonRecord(raw)
  if (
    parsed?.schemaVersion === 1 &&
    typeof parsed.deviceToken === 'string' &&
    parsed.deviceToken.length >= 24
  ) {
    return { schemaVersion: 1, deviceToken: parsed.deviceToken }
  }
  return null
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function bestEffortChmod(path: string, mode: number) {
  try {
    await chmod(path, mode)
  } catch {
    // Windows uses profile/DPAPI protection here; POSIX chmod is best effort only.
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function renameWithRetry(from: string, to: string) {
  const delays = process.platform === 'win32' ? [25, 75, 150, 300] : [0]
  let lastError: unknown
  for (const delay of delays) {
    if (delay) await wait(delay)
    try {
      await rename(from, to)
      return
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('rename failed')
}

async function atomicWriteJson(path: string, value: unknown) {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const serialized = `${JSON.stringify(value, null, 2)}\n`
  const handle = await open(tmp, 'w', 0o600)
  try {
    await handle.writeFile(serialized, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await bestEffortChmod(tmp, 0o600)
  await renameWithRetry(tmp, path)
}

export class CredentialStore {
  readonly dir: string
  private readonly installationPath: string
  private readonly metadataPath: string
  private readonly credentialPath: string

  constructor(
    userDataDir: string,
    private readonly secretStorage: ActivationSecretSafeStorage = safeStorage,
  ) {
    this.dir = join(userDataDir, ACTIVATION_DIR)
    this.installationPath = join(this.dir, INSTALLATION_FILE)
    this.metadataPath = join(this.dir, METADATA_FILE)
    this.credentialPath = join(this.dir, CREDENTIAL_FILE)
  }

  isEncryptionAvailable(): boolean {
    try {
      return this.secretStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  async ensureReady() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 })
    await bestEffortChmod(this.dir, 0o700)
    await this.cleanupTempFiles()
  }

  async ensureInstallation(): Promise<InstallationRecordV1> {
    await this.ensureReady()
    if (await exists(this.installationPath)) {
      const existing = parseInstallation(await readFile(this.installationPath, 'utf8'))
      if (existing) return existing
      await this.quarantineFile(this.installationPath, 'corrupt-installation')
    }
    const record: InstallationRecordV1 = {
      schemaVersion: 1,
      installationId: randomUUID(),
      createdAt: new Date().toISOString(),
    }
    await atomicWriteJson(this.installationPath, record)
    return record
  }

  async readMetadata(): Promise<ActivationMetadataV1 | null> {
    await this.ensureReady()
    if (!(await exists(this.metadataPath))) return null
    const metadata = parseMetadata(await readFile(this.metadataPath, 'utf8'))
    if (!metadata) {
      await this.quarantineFile(this.metadataPath, 'corrupt-metadata')
      return null
    }
    return metadata
  }

  async readCredential(): Promise<CredentialReadResult> {
    await this.ensureReady()
    if (!(await exists(this.credentialPath))) return { ok: false, reason: 'missing' }
    if (!this.isEncryptionAvailable()) return { ok: false, reason: 'safe-storage-unavailable' }

    const parsed = parseCredentialFile(await readFile(this.credentialPath, 'utf8'))
    if (!parsed) {
      await this.quarantineFile(this.credentialPath, 'corrupt-credential-json')
      return { ok: false, reason: 'corrupt' }
    }

    let decrypted: string
    try {
      decrypted = this.secretStorage.decryptString(Buffer.from(parsed.ciphertextBase64, 'base64'))
    } catch {
      await this.quarantineFile(this.credentialPath, 'decrypt-failed')
      return { ok: false, reason: 'decrypt-failed' }
    }

    const credential = parseCredential(decrypted)
    if (!credential) {
      await this.quarantineFile(this.credentialPath, 'credential-schema-mismatch')
      return { ok: false, reason: 'schema-mismatch' }
    }
    return { ok: true, credential }
  }

  async writeCredential(
    credential: ActivationCredentialV1,
    metadata: ActivationMetadataV1,
  ): Promise<CredentialWriteResult> {
    await this.ensureReady()
    if (!this.isEncryptionAvailable()) return { ok: false, reason: 'safe-storage-unavailable' }

    let ciphertext: Buffer
    try {
      ciphertext = this.secretStorage.encryptString(JSON.stringify(credential))
    } catch {
      return { ok: false, reason: 'encrypt-failed' }
    }

    const encryptedFile: EncryptedCredentialFileV1 = {
      schemaVersion: 1,
      encryption: 'electron.safeStorage',
      ciphertextBase64: ciphertext.toString('base64'),
      updatedAt: new Date().toISOString(),
    }

    let credentialReplaced = false
    try {
      await atomicWriteJson(this.credentialPath, encryptedFile)
      credentialReplaced = true
      await atomicWriteJson(this.metadataPath, metadata)
      return { ok: true }
    } catch {
      if (credentialReplaced) await this.quarantineCredential('metadata-write-failed')
      return { ok: false, reason: 'write-failed' }
    }
  }

  async updateVerifiedMetadata(device: PublicDeviceIdentity) {
    const previous = await this.readMetadata()
    const metadata: ActivationMetadataV1 = {
      schemaVersion: 1,
      storeCodeHint: device.storeCode,
      deviceId: device.deviceId,
      credentialVersion: device.credentialVersion,
      tokenExpiresAt: device.tokenExpiresAt,
      lastVerifiedAt: new Date().toISOString(),
      ...(previous?.storeCodeHint && !device.storeCode ? { storeCodeHint: previous.storeCodeHint } : {}),
    }
    await atomicWriteJson(this.metadataPath, metadata)
  }

  async resetLocalActivation() {
    await this.ensureReady()
    await rm(this.credentialPath, { force: true })
    await rm(this.metadataPath, { force: true })
  }

  async quarantineCredential(reason: string) {
    await this.quarantineFile(this.credentialPath, reason)
  }

  async cleanupTempFiles(maxAgeMs = TEMP_MAX_AGE_MS) {
    await mkdir(this.dir, { recursive: true, mode: 0o700 })
    const entries = await readdir(this.dir, { withFileTypes: true })
    const now = Date.now()
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isFile() || !entry.name.includes('.tmp-')) return
      const parts = entry.name.split('.tmp-')
      if (parts.length !== 2) return
      const maybeTimestamp = Number(parts[1].split('-')[1])
      if (!Number.isFinite(maybeTimestamp) || now - maybeTimestamp < maxAgeMs) return
      await rm(join(this.dir, entry.name), { force: true })
    }))
  }

  private async quarantineFile(path: string, reason: string) {
    if (!(await exists(path))) return
    const safeReason = reason.replace(/[^a-z0-9-]/gi, '-').slice(0, 48)
    const target = join(this.dir, `${basename(path)}.quarantine-${safeReason}-${Date.now()}`)
    try {
      await renameWithRetry(path, target)
    } catch {
      await rm(path, { force: true })
    }
  }
}
