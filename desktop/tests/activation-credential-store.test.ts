import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { CredentialStore } from '../src/main/activation/credentialStore'
import type { ActivationSecretSafeStorage } from '../src/main/activation/activationTypes'

function adapter(options: { available?: boolean; encryptThrow?: boolean; decryptThrow?: boolean } = {}): ActivationSecretSafeStorage {
  return {
    isEncryptionAvailable: () => options.available ?? true,
    encryptString: (value: string) => {
      if (options.encryptThrow) throw new Error('encrypt failed')
      return Buffer.from(`wrapped:${value}`, 'utf8')
    },
    decryptString: (encrypted: Buffer) => {
      if (options.decryptThrow) throw new Error('decrypt failed')
      const value = encrypted.toString('utf8')
      if (!value.startsWith('wrapped:')) throw new Error('bad wrapper')
      return value.slice('wrapped:'.length)
    },
  }
}

async function tempStore(storage = adapter()) {
  const dir = await mkdtemp(join(tmpdir(), 'activation-store-'))
  return { dir, store: new CredentialStore(dir, storage) }
}

describe('activation credential store', () => {
  it('generates a stable random installation id without hardware input', async () => {
    const { store } = await tempStore()
    const first = await store.ensureInstallation()
    const second = await store.ensureInstallation()
    expect(first.installationId).toBe(second.installationId)
    expect(first.installationId).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it('reports missing credential without treating it as corruption', async () => {
    const { store } = await tempStore()
    await store.ensureInstallation()
    expect(await store.readCredential()).toEqual({ ok: false, reason: 'missing' })
  })

  it('encrypts and decrypts credential files through safeStorage only', async () => {
    const { dir, store } = await tempStore()
    const token = 'test-device-token-value-222222222222'
    await expect(store.writeCredential(
      { schemaVersion: 1, deviceToken: token },
      { schemaVersion: 1, storeCodeHint: 'STORE-A' },
    )).resolves.toEqual({ ok: true })
    const raw = await readFile(join(dir, 'activation', 'credential.json'), 'utf8')
    expect(raw).not.toContain(token)
    await expect(store.readCredential()).resolves.toEqual({
      ok: true,
      credential: { schemaVersion: 1, deviceToken: token },
    })
  })

  it('fails closed when safeStorage is unavailable or encryption throws', async () => {
    const unavailable = await tempStore(adapter({ available: false }))
    expect(await unavailable.store.writeCredential(
      { schemaVersion: 1, deviceToken: 'test-device-token-value-333333333333' },
      { schemaVersion: 1 },
    )).toEqual({ ok: false, reason: 'safe-storage-unavailable' })

    const throwing = await tempStore(adapter({ encryptThrow: true }))
    expect(await throwing.store.writeCredential(
      { schemaVersion: 1, deviceToken: 'test-device-token-value-444444444444' },
      { schemaVersion: 1 },
    )).toEqual({ ok: false, reason: 'encrypt-failed' })
  })

  it('quarantines corrupted JSON and decrypt failures', async () => {
    const { dir, store } = await tempStore()
    await store.ensureReady()
    await writeFile(join(dir, 'activation', 'credential.json'), '{bad json', 'utf8')
    expect(await store.readCredential()).toEqual({ ok: false, reason: 'corrupt' })

    const failing = new CredentialStore(dir, adapter({ decryptThrow: true }))
    await failing.writeCredential(
      { schemaVersion: 1, deviceToken: 'test-device-token-value-555555555555' },
      { schemaVersion: 1 },
    )
    expect(await failing.readCredential()).toEqual({ ok: false, reason: 'decrypt-failed' })
  })

  it('detects schema mismatch after decrypt', async () => {
    const { dir, store } = await tempStore()
    await store.ensureReady()
    const ciphertextBase64 = Buffer.from('wrapped:{"schemaVersion":1,"wrong":"shape"}').toString('base64')
    await writeFile(join(dir, 'activation', 'credential.json'), JSON.stringify({
      schemaVersion: 1,
      encryption: 'electron.safeStorage',
      ciphertextBase64,
      updatedAt: new Date().toISOString(),
    }), 'utf8')
    expect(await store.readCredential()).toEqual({ ok: false, reason: 'schema-mismatch' })
  })

  it('replaces an existing token atomically and resets local activation state', async () => {
    const { store } = await tempStore()
    await store.writeCredential(
      { schemaVersion: 1, deviceToken: 'test-device-token-value-old-000000' },
      { schemaVersion: 1, storeCodeHint: 'STORE-A' },
    )
    await store.writeCredential(
      { schemaVersion: 1, deviceToken: 'test-device-token-value-new-000000' },
      { schemaVersion: 1, storeCodeHint: 'STORE-A', credentialVersion: 2 },
    )
    expect(await store.readCredential()).toMatchObject({
      ok: true,
      credential: { deviceToken: 'test-device-token-value-new-000000' },
    })
    await store.resetLocalActivation()
    expect(await store.readCredential()).toEqual({ ok: false, reason: 'missing' })
  })

  it('cleans stale temp files without deleting current credential', async () => {
    const { dir, store } = await tempStore()
    await store.ensureReady()
    await writeFile(join(dir, 'activation', `credential.json.tmp-1-${Date.now() - 99_999}-abc`), 'old', 'utf8')
    await store.writeCredential(
      { schemaVersion: 1, deviceToken: 'test-device-token-value-666666666666' },
      { schemaVersion: 1 },
    )
    await store.cleanupTempFiles(1)
    expect(await store.readCredential()).toMatchObject({ ok: true })
  })
})
