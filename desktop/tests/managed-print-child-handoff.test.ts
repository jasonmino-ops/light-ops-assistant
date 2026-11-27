import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => ({ available: true, failEncrypt: false }))
vi.mock('electron', () => ({ safeStorage: {
  isEncryptionAvailable: () => storage.available,
  encryptString: (value: string) => { if (storage.failEncrypt) throw new Error('fixture encryption failure'); return Buffer.from(value) },
  decryptString: (value: Buffer) => value.toString(),
} }))

vi.mock('../src/main/windowsPrintChildProtection', () => ({
  sealPrintChildHandoff: async (value: string) => 'TEST-TRANSPORT:' + Buffer.from(value).toString('base64'),
}))

import { managedPrintChildHandoffPath, managedPrintChildIdentityPath, writeManagedPrintChildHandoff } from '../src/main/managedPrintChildHandoff'

const roots: string[] = []
async function fixture() { const root = await mkdtemp(path.join(os.tmpdir(), 'commercial-child-')); roots.push(root); return root }
const session = () => ({ browserDeviceId: 'desktop-browser-fixture', storeCode: 'STORE-A', token: 'fixture-token', expiresAt: new Date(Date.now() + 300_000).toISOString() })
const reply = (storeCode = 'STORE-A') => ({ ok: true, childId: 'child-fixture-001', storeCode, credentialExpiresAt: '2099-01-01T00:00:00.000Z' })
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
async function decoded(file: string) { const raw = await readFile(file, 'utf8'); return JSON.parse(Buffer.from(raw.replace(/^TEST-TRANSPORT:/, ''), 'base64').toString()) }
afterEach(async () => { storage.available = true; storage.failEncrypt = false; await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('commercial managed Print Child writer', () => {
  it('binds identity to the verified store and bounds the encrypted one-use handoff to the session and 60 seconds', async () => {
    const root = await fixture(); const input = session(); const before = Date.now()
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.redirect).toBe('error'); expect(init.signal).toBeInstanceOf(AbortSignal)
      expect(JSON.parse(String(init.body))).not.toHaveProperty('storeCode')
      return response(reply())
    })
    await writeManagedPrintChildHandoff(root, input, { fetchImpl })
    const h = await decoded(managedPrintChildHandoffPath(root))
    expect(Object.keys(h).sort()).toEqual(['audience', 'boundAt', 'childId', 'deviceSecret', 'expiresAt', 'installationId', 'nonce', 'schemaVersion', 'storeCode'])
    expect(h.schemaVersion).toBe(2); expect(Number.isFinite(Date.parse(h.boundAt))).toBe(true)
    expect(h.storeCode).toBe('STORE-A'); expect(Date.parse(h.expiresAt)).toBeGreaterThan(before)
    expect(Date.parse(h.expiresAt)).toBeLessThanOrEqual(Date.now() + 60_000)
    expect(Date.parse(h.expiresAt)).toBeLessThanOrEqual(Date.parse(input.expiresAt))
    expect(await decoded(managedPrintChildIdentityPath(root))).toMatchObject({ storeCode: 'STORE-A', installationId: h.installationId })
    expect(h).not.toHaveProperty('token'); expect(h).not.toHaveProperty('browserDeviceId')
  })

  it('refuses cross-store reuse before another request and removes the previous handoff', async () => {
    const root = await fixture(); const fetchImpl = vi.fn(async () => response(reply()))
    await writeManagedPrintChildHandoff(root, session(), { fetchImpl })
    await expect(writeManagedPrintChildHandoff(root, { ...session(), storeCode: 'STORE-B' }, { fetchImpl })).rejects.toThrow('PRINT_CHILD_STORE_MISMATCH')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await expect(readFile(managedPrintChildHandoffPath(root))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('serializes concurrent refreshes without creating multiple identities', async () => {
    const root = await fixture(); const identities: string[] = []; let concurrent = 0; let maximum = 0
    const fetchImpl = async (_url: string, init: RequestInit) => {
      concurrent++; maximum = Math.max(maximum, concurrent); identities.push(JSON.parse(String(init.body)).installationId)
      await new Promise(resolve => setTimeout(resolve, 5)); concurrent--; return response(reply())
    }
    await Promise.all(Array.from({ length: 5 }, () => writeManagedPrintChildHandoff(root, session(), { fetchImpl })))
    expect(new Set(identities).size).toBe(1); expect(maximum).toBe(1)
  })

  it.each([
    ['wrong store', { ...reply(), storeCode: 'STORE-B' }, 200],
    ['invalid child', { ...reply(), childId: '' }, 200],
    ['expired child', { ...reply(), credentialExpiresAt: '2020-01-01T00:00:00.000Z' }, 200],
    ['authentication rejected', { ok: false, error: 'fixture rejected' }, 403],
  ])('does not retain a capability after %s', async (_name, body, status) => {
    const root = await fixture()
    await writeManagedPrintChildHandoff(root, session(), { fetchImpl: async () => response(reply()) })
    await expect(writeManagedPrintChildHandoff(root, session(), { fetchImpl: async () => response(body, status) })).rejects.toThrow('PRINT_CHILD_PROVISION_REJECTED')
    await expect(readFile(managedPrintChildHandoffPath(root))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('binds legacy local identity only after server-side recovery verifies it', async () => {
    const root = await fixture(); const file = managedPrintChildIdentityPath(root)
    await mkdir(path.dirname(file), { recursive: true })
    const identity = { schemaVersion: 1, audience: 'eshop-managed-print-child', installationId: 'legacy-installation-fixture', deviceSecret: `ecc_v1_${'f'.repeat(48)}` }
    await writeFile(file, Buffer.from(JSON.stringify(identity)).toString('base64'))
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body)).installationId).toBe(identity.installationId); return response(reply())
    })
    await writeManagedPrintChildHandoff(root, session(), { fetchImpl })
    expect(await decoded(file)).toMatchObject({ ...identity, storeCode: 'STORE-A' })
  })

  it('fails closed without secure storage and cleans a failed encrypted temporary write', async () => {
    const root = await fixture(); storage.failEncrypt = true
    await expect(writeManagedPrintChildHandoff(root, session(), { fetchImpl: async () => response(reply()) })).rejects.toThrow()
    expect(await readdir(path.dirname(managedPrintChildIdentityPath(root)))).toEqual([])
    storage.available = false
    await expect(writeManagedPrintChildHandoff(root, session(), { fetchImpl: async () => response(reply()) })).rejects.toThrow('PRINT_CHILD_SAFE_STORAGE_UNAVAILABLE')
  })
  it('retains one binding timestamp across repeated successful handoffs without rewriting a profile', async () => {
    const root = await fixture(); const fetchImpl = async () => response(reply())
    await writeManagedPrintChildHandoff(root, session(), { fetchImpl })
    const first = await decoded(managedPrintChildHandoffPath(root))
    await new Promise(resolve => setTimeout(resolve, 5))
    await writeManagedPrintChildHandoff(root, session(), { fetchImpl })
    const second = await decoded(managedPrintChildHandoffPath(root))
    expect(second.boundAt).toBe(first.boundAt)
    expect(second.installationId).toBe(first.installationId)
    expect(second.nonce).not.toBe(first.nonce)
  })

})
