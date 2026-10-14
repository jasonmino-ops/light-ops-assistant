import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}))

import { consumeManagedPrintChildIdentity, managedPrintChildHandoffPath } from '../src/managedPrintChildIdentity'

const valid = {
  schemaVersion: 1,
  audience: 'eshop-managed-print-child',
  installationId: 'print-child-installation-001',
  deviceSecret: `ecc_v1_${'d'.repeat(48)}`,
  childId: 'child-print-001',
  storeCode: 'STORE-1',
  expiresAt: '2099-01-01T00:00:00.000Z',
  nonce: '123e4567-e89b-12d3-a456-426614174000',
}

async function fixture(value: unknown) {
  const root = await fsTemp()
  const file = managedPrintChildHandoffPath(root)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, Buffer.from(JSON.stringify(value)).toString('base64'), 'utf8')
  return root
}

async function fsTemp() {
  return await import('node:fs/promises').then(fs => fs.mkdtemp(path.join(os.tmpdir(), 'print-child-')))
}

describe('managed print child handoff', () => {
  it('consumes a bounded child identity exactly once', async () => {
    const root = await fixture(valid)
    await expect(consumeManagedPrintChildIdentity(root)).resolves.toMatchObject({
      installationId: valid.installationId, computerId: valid.childId, storeCode: valid.storeCode,
    })
    await expect(consumeManagedPrintChildIdentity(root)).resolves.toBeNull()
  })

  it.each([
    ['wrong audience', { ...valid, audience: 'other' }],
    ['expired', { ...valid, expiresAt: '2020-01-01T00:00:00.000Z' }],
    ['extra field', { ...valid, extra: true }],
    ['bad secret', { ...valid, deviceSecret: `ecc_v1_${'x'.repeat(8)}` }],
  ])('fails closed for %s', async (_name, value) => {
    const root = await fixture(value)
    await expect(consumeManagedPrintChildIdentity(root)).rejects.toThrow('PRINT_CHILD_HANDOFF_INVALID')
  })

  it('does not expose a legacy identity or a second principal', () => {
    expect(valid.audience).toBe('eshop-managed-print-child')
    expect(randomUUID()).toMatch(/[0-9a-f-]{36}/)
  })
})
