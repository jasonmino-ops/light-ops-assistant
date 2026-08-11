import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import type { DeviceIdentity } from './types'

type CredentialFile = { schemaVersion: 1; encryption: 'electron.safeStorage'; ciphertextBase64: string; updatedAt: string }
type Credential = { schemaVersion: 1; deviceToken: string }
type Installation = { schemaVersion: 1; installationId: string; createdAt: string }

async function atomicWrite(path: string, value: unknown) {
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`
  const handle = await open(temp, 'w', 0o600)
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8'); await handle.sync() } finally { await handle.close() }
  await rename(temp, path)
}

export class FieldCredentialStore {
  private readonly dir: string
  private readonly installationPath: string
  private readonly credentialPath: string
  private readonly metadataPath: string

  constructor(userDataPath: string) {
    this.dir = join(userDataPath, 'field-cloud-relay')
    this.installationPath = join(this.dir, 'installation.json')
    this.credentialPath = join(this.dir, 'credential.json')
    this.metadataPath = join(this.dir, 'metadata.json')
  }

  isEncryptionAvailable() {
    try { return safeStorage.isEncryptionAvailable() } catch { return false }
  }

  async installationId(): Promise<string> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 })
    try {
      const value = JSON.parse(await readFile(this.installationPath, 'utf8')) as Partial<Installation>
      if (value.schemaVersion === 1 && typeof value.installationId === 'string' && value.installationId.length >= 8) return value.installationId
    } catch { /* create a fresh FIELD installation id */ }
    const installation: Installation = { schemaVersion: 1, installationId: randomUUID(), createdAt: new Date().toISOString() }
    await atomicWrite(this.installationPath, installation)
    return installation.installationId
  }

  async readToken(): Promise<string | null> {
    if (!this.isEncryptionAvailable()) return null
    try {
      const file = JSON.parse(await readFile(this.credentialPath, 'utf8')) as Partial<CredentialFile>
      if (file.schemaVersion !== 1 || file.encryption !== 'electron.safeStorage' || typeof file.ciphertextBase64 !== 'string') return null
      const value = JSON.parse(safeStorage.decryptString(Buffer.from(file.ciphertextBase64, 'base64'))) as Partial<Credential>
      return value.schemaVersion === 1 && typeof value.deviceToken === 'string' && value.deviceToken.length >= 24 ? value.deviceToken : null
    } catch { return null }
  }

  async writeToken(deviceToken: string, device: DeviceIdentity): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 })
    if (!this.isEncryptionAvailable()) throw new Error('SAFE_STORAGE_UNAVAILABLE')
    const ciphertext = safeStorage.encryptString(JSON.stringify({ schemaVersion: 1, deviceToken } satisfies Credential))
    await atomicWrite(this.credentialPath, {
      schemaVersion: 1,
      encryption: 'electron.safeStorage',
      ciphertextBase64: ciphertext.toString('base64'),
      updatedAt: new Date().toISOString(),
    } satisfies CredentialFile)
    await atomicWrite(this.metadataPath, {
      schemaVersion: 1,
      deviceId: device.deviceId,
      storeCode: device.storeCode,
      credentialVersion: device.credentialVersion,
      tokenExpiresAt: device.tokenExpiresAt,
      updatedAt: new Date().toISOString(),
    })
  }
}
