import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const protection = vi.hoisted(() => ({ failure: undefined as string | undefined }))
afterEach(() => { protection.failure = undefined })

vi.mock('../src/windowsPrintChildProtection', () => ({
  unsealPrintChildHandoff: async (value: string) => {
    if (protection.failure) throw new Error(protection.failure)
    if (!value.startsWith('TEST-TRANSPORT:')) throw new Error('PRINT_CHILD_HANDOFF_INVALID')
    return Buffer.from(value.slice('TEST-TRANSPORT:'.length), 'base64').toString()
  },
}))

import { consumeManagedPrintChildIdentity, managedPrintChildHandoffPath } from '../src/managedPrintChildIdentity'

const valid = {
  schemaVersion: 2,
  boundAt: '2026-11-01T00:00:00.000Z',
  audience: 'eshop-managed-print-child',
  installationId: 'print-child-installation-001',
  deviceSecret: `ecc_v1_${'d'.repeat(48)}`,
  childId: 'child-print-001',
  storeCode: 'STORE-1',
  expiresAt: new Date(Date.now() + 59_000).toISOString(),
  nonce: '123e4567-e89b-12d3-a456-426614174000',
}

async function fixture(value: unknown) {
  const root = await fsTemp()
  const file = managedPrintChildHandoffPath(root)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, 'TEST-TRANSPORT:' + Buffer.from(JSON.stringify(value)).toString('base64'), 'utf8')
  return root
}

async function fsTemp() {
  return await import('node:fs/promises').then(fs => fs.mkdtemp(path.join(os.tmpdir(), 'print-child-')))
}

describe('managed print child handoff', () => {
  it('consumes a bounded child identity exactly once', async () => {
    const root = await fixture(valid)
    await expect(consumeManagedPrintChildIdentity(root)).resolves.toMatchObject({
      installationId: valid.installationId, computerId: valid.childId, storeCode: valid.storeCode, boundAt: valid.boundAt,
    })
    await expect(consumeManagedPrintChildIdentity(root)).resolves.toBeNull()
  })

  it.each([
    ['obsolete schema', { ...valid, schemaVersion: 1 }],
    ['invalid binding timestamp', { ...valid, boundAt: 'invalid' }],
    ['future binding timestamp', { ...valid, boundAt: '2099-01-01T00:00:00.000Z' }],
    ['wrong audience', { ...valid, audience: 'other' }],
    ['expired', { ...valid, expiresAt: '2020-01-01T00:00:00.000Z' }],
    ['extra field', { ...valid, extra: true }],
    ['bad secret', { ...valid, deviceSecret: `ecc_v1_${'x'.repeat(8)}` }],
    ['unbounded lifetime', { ...valid, expiresAt: '2099-01-01T00:00:00.000Z' }],
  ])('fails closed for %s', async (_name, value) => {
    const root = await fixture(value)
    await expect(consumeManagedPrintChildIdentity(root)).rejects.toThrow('PRINT_CHILD_HANDOFF_INVALID')
  })

  it.each(['PRINT_CHILD_DPAPI_TIMEOUT', 'PRINT_CHILD_DPAPI_UNAVAILABLE', 'PRINT_CHILD_DPAPI_FAILED', 'PRINT_CHILD_DPAPI_INVALID_RESPONSE'])('retains finite safe %s diagnostics and still consumes once', async failure => {
    const root = await fixture(valid); protection.failure = failure
    await expect(consumeManagedPrintChildIdentity(root)).rejects.toThrow(failure)
    await expect(consumeManagedPrintChildIdentity(root)).resolves.toBeNull()
  })

  it('redacts an unknown native error and removes its claimed capability', async () => {
    const root = await fixture(valid); protection.failure = 'unknown native implementation detail'
    await expect(consumeManagedPrintChildIdentity(root)).rejects.toThrow('PRINT_CHILD_HANDOFF_INVALID')
    await expect(consumeManagedPrintChildIdentity(root)).resolves.toBeNull()
  })

  it('does not expose a legacy identity or a second principal', () => {
    expect(valid.audience).toBe('eshop-managed-print-child')
    expect(randomUUID()).toMatch(/[0-9a-f-]{36}/)
  })

  it('allows only one consumer to claim a handoff under concurrent starts', async () => {
    const root = await fixture(valid)
    const results = await Promise.all(Array.from({ length: 12 }, () => consumeManagedPrintChildIdentity(root)))
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(results.filter(value => value === null)).toHaveLength(11)
  })

  it('rejects oversized capability files without leaving a usable handoff', async () => {
    const root = await fixture(valid)
    await writeFile(managedPrintChildHandoffPath(root), 'x'.repeat(32_769))
    await expect(consumeManagedPrintChildIdentity(root)).rejects.toThrow('PRINT_CHILD_HANDOFF_INVALID')
    await expect(consumeManagedPrintChildIdentity(root)).resolves.toBeNull()
  })
})
