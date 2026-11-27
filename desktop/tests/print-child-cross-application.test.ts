import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ safeStorage: {
  isEncryptionAvailable: () => true,
  encryptString: (plain: string) => Buffer.from('DESKTOP-OWN-PROFILE:' + plain),
  decryptString: (cipher: Buffer) => {
    if (!cipher.toString().startsWith('DESKTOP-OWN-PROFILE:')) throw new Error('wrong own-profile key')
    return cipher.toString().slice('DESKTOP-OWN-PROFILE:'.length)
  },
} }))
vi.mock('../src/main/windowsPrintChildProtection', () => ({
  sealPrintChildHandoff: async (plain: string) => 'MOCK-CURRENT-USER:' + Buffer.from(plain).toString('base64'),
}))
vi.mock('../../e-shop-tray/src/windowsPrintChildProtection', () => ({
  unsealPrintChildHandoff: async (value: string) => {
    if (!value.startsWith('MOCK-CURRENT-USER:')) throw new Error('PRINT_CHILD_HANDOFF_INVALID')
    return Buffer.from(value.slice('MOCK-CURRENT-USER:'.length), 'base64').toString()
  },
}))
import { writeManagedPrintChildHandoff } from '../src/main/managedPrintChildHandoff'
import { consumeManagedPrintChildIdentity } from '../../e-shop-tray/src/managedPrintChildIdentity'
import { NetworkAddonProfile } from '../../e-shop-tray/network-addon/profile'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const tuple = (value: NonNullable<Awaited<ReturnType<typeof consumeManagedPrintChildIdentity>>>) => ({
  installationId: value.installationId, computerId: value.computerId, storeCode: value.storeCode, boundAt: value.boundAt,
})

describe('actual writer/reader/profile contract with isolated OS crypto ports', () => {
  it('reopens the same protected profile after a fresh one-use handoff without replacing identity or journal', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'print-child-two-apps-')); roots.push(root)
    const session = { browserDeviceId: 'desktop-synthetic', storeCode: 'SYNTH_STORE', token: 'not-a-real-proof', expiresAt: new Date(Date.now() + 120000).toISOString() }
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, childId: 'synthetic-child-0001', storeCode: session.storeCode, credentialExpiresAt: '2099-01-01T00:00:00.000Z' })))
    await writeManagedPrintChildHandoff(root, session, { fetchImpl })
    const first = (await consumeManagedPrintChildIdentity(root))!
    expect(first.storeCode).toBe(session.storeCode)
    expect(await consumeManagedPrintChildIdentity(root)).toBeNull()
    const directory = path.join(root, 'synthetic-addon-profile')
    const protector = { protect: (value: string) => Buffer.from('ADDON-OWN-PROFILE:' + value).toString('base64'),
      unprotect: (value: string) => Buffer.from(value, 'base64').toString().slice('ADDON-OWN-PROFILE:'.length) }
    const profile = new NetworkAddonProfile({ directory, identity: tuple(first), protector }); await profile.open()
    const before = await readFile(path.join(directory, 'profile.sealed'))
    await new Promise(resolve => setTimeout(resolve, 5))
    await writeManagedPrintChildHandoff(root, session, { fetchImpl })
    const second = (await consumeManagedPrintChildIdentity(root))!
    expect(tuple(second)).toEqual(tuple(first))
    const reopened = new NetworkAddonProfile({ directory, identity: tuple(second), protector }); await reopened.open()
    expect(reopened.snapshot()).toMatchObject({ enabled: false, revision: 0 })
    expect(reopened.journal.records()).toEqual([])
    expect(await readFile(path.join(directory, 'profile.sealed'))).toEqual(before)
    expect(fetchImpl).toHaveBeenCalledTimes(2) // Explicit synthetic provisioning, no real API.
  })
})
