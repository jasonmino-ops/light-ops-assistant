import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { NetworkAddonProfile } from '../network-addon/profile'
import { submitLocalNetworkTest, activateNetworkPrinting } from '../src/networkRuntime'
import { assertConfirmedPrinter, createLocalNetworkSnapshot, networkContinuityFingerprint } from '../src/networkDiscovery'
import { NetworkDeliveryError } from '../src/printing/networkRawTcpTransport'
import type { ReceivedPrintJob } from '../src/cloudRelayClient'

const fault = vi.hoisted(() => ({ match: '', hits: 0 }))
vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof import('node:fs/promises')>()
  return { ...actual, open: async (...args: Parameters<typeof actual.open>) => {
    const handle = await actual.open(...args)
    if (fault.match && String(args[0]).includes(fault.match)) {
      handle.sync = async () => { fault.hits++; throw Object.assign(new Error('injected required fsync'), { code: 'EIO' }) }
    }
    return handle
  } }
})
const protector = { protect: (text: string) => Buffer.from(text).toString('base64'), unprotect: (text: string) => Buffer.from(text, 'base64').toString() }
const identity = { installationId: 'test-installation-0001', computerId: 'test-computer', storeCode: 'TEST-STORE', boundAt: '2026-09-09' }
const interfaces: ReturnType<typeof os.networkInterfaces> = { LAN: [{ address: '10.20.30.1', netmask: '255.255.255.0',
  family: 'IPv4', internal: false, mac: '00:00:00:00:00:01', cidr: '10.20.30.1/24' }] }
const endpoint = { host: '10.20.30.2', port: 9100 }
const testInput = (host = endpoint.host) => ({ id: randomUUID(), mode: 'FRONT_ONLY' as const, endpoint: { ...endpoint, host },
  networkFingerprint: '1'.repeat(64), hardwareAddress: '02-11-22-33-44-55', bytes: 12, sha256: '2'.repeat(64) })
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'network-addon-profile-'))
  const options = { directory, identity, protector, interfaces: () => interfaces }
  const profile = new NetworkAddonProfile(options)
  await profile.open()
  return { directory, options, profile, fresh: () => new NetworkAddonProfile(options) }
}
async function configure(profile: NetworkAddonProfile) {
  const test = await profile.beginTest(testInput())
  await profile.finishTest(test.id, 'SUBMITTED')
  await profile.confirmTest(test.id, true, false)
  return test
}
function job(): ReceivedPrintJob {
  return { id: 'job-00001', claimAttempt: 1, claimToken: `ecp_v1_${'a'.repeat(43)}`, leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
    schemaVersion: 2, idempotencyKey: 'test-job-00001', requestId: 'test-job-00001', requestHash: '1'.repeat(64), orderNo: 'TEST-001',
    documentName: 'FRONT', commandStream: new Uint8Array() }
}
describe('commercial profile initialization, TEST and same-device address recovery', () => {
  it('historical full-hash confirmation stays intact but cannot activate until an explicit new TEST and same-printer confirmation', async () => {
    const f = await fixture()
    const snap = createLocalNetworkSnapshot({
      adapters: [{ interfaceIndex: 7, name: 'LAN', description: 'Physical Ethernet', interfaceType: 6,
        hardwareInterface: true, virtual: false, status: 'Up' }],
      addresses: [{ interfaceIndex: 7, address: '10.20.30.1', prefixLength: 24, addressState: 'Preferred', skipAsSource: false }],
      routes: [{ interfaceIndex: 7, destinationPrefix: '10.20.30.0/24', nextHop: '0.0.0.0', routeMetric: 256, interfaceMetric: 50 }],
    }, interfaces)
    const old = await f.profile.beginTest({ ...testInput(), networkFingerprint: snap.fingerprint })
    await f.profile.finishTest(old.id, 'SUBMITTED'); await f.profile.confirmTest(old.id, true, false)
    await f.profile.journal.recordClaimed(job())
    await f.profile.journal.recordTerminal(job(), { state: 'SUCCEEDED', resultCode: 'SUBMITTED_TO_NETWORK_SOCKET', effectBoundary: 'CROSSED', physicalCompletionKnown: false })
    await f.profile.journal.markReported(job().id, 1)
    const beforeProfile = await readFile(path.join(f.directory, 'profile.sealed')), journal = await readFile(f.profile.journal.filePath)
    const next = f.fresh(); await next.open()
    const hardware = vi.fn(async () => old.hardwareAddress), start = vi.fn(), persistEnabled = vi.fn()
    await expect(activateNetworkPrinting({ isEnabled: () => next.snapshot().enabled, stopAndWait: async () => {},
      validate: async () => { await assertConfirmedPrinter(endpoint, next.snapshot().test!, snap, hardware, async () => snap) },
      persistEnabled, start })).rejects.toThrow('NETWORK_CHANGED')
    expect(hardware).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled(); expect(persistEnabled).not.toHaveBeenCalled()
    expect(await readFile(path.join(f.directory, 'profile.sealed'))).toEqual(beforeProfile)
    expect(await readFile(next.journal.filePath)).toEqual(journal)
    const newTest = await next.beginTest({ ...testInput(), networkFingerprint: networkContinuityFingerprint(snap) })
    await expect(next.confirmTest(newTest.id, true, true)).rejects.toThrow('ADDON_TEST_CONFIRMATION_REQUIRED')
    await next.finishTest(newTest.id, 'SUBMITTED')
    await expect(next.confirmTest(newTest.id, true, false)).rejects.toThrow('ADDON_SAME_PHYSICAL_PRINTER_REQUIRED')
    await next.confirmTest(newTest.id, true, true)
    await expect(assertConfirmedPrinter(endpoint, next.snapshot().test!, snap, hardware, async () => snap)).resolves.toMatchObject(endpoint)
    expect(await readFile(next.journal.filePath)).toEqual(journal)
    expect(next.snapshot()).toMatchObject({ enabled: false, revision: 2 })
  })
  it('ARP/identity verification failure after durable intent records NOT_CROSSED, zero delivery, and permits a new explicit TEST', async () => {
    const f = await fixture(), test = await f.profile.beginTest(testInput())
    const deliver = vi.fn(async () => {})
    await expect(submitLocalNetworkTest({ verify: async () => { throw new Error('NETWORK_DEVICE_IDENTITY_UNAVAILABLE') }, deliver,
      finish: outcome => f.profile.finishTest(test.id, outcome) })).rejects.toThrow('NETWORK_DEVICE_IDENTITY_UNAVAILABLE')
    expect(deliver).not.toHaveBeenCalled()
    const restarted = f.fresh(); await restarted.open()
    expect(restarted.snapshot().test?.outcome).toBe('NOT_CROSSED')
    await expect(restarted.beginTest(testInput())).resolves.toMatchObject({ outcome: 'INTENT' })
  })
  it('uncertain actual TEST transport output remains UNKNOWN and cannot be replayed', async () => {
    const f = await fixture(), test = await f.profile.beginTest(testInput())
    await expect(submitLocalNetworkTest({ verify: async () => {},
      deliver: async () => { throw new NetworkDeliveryError('NETWORK_TCP_TIMEOUT', 'CROSSING_UNKNOWN') },
      finish: outcome => f.profile.finishTest(test.id, outcome) })).rejects.toThrow('NETWORK_TCP_TIMEOUT')
    const restarted = f.fresh(); await restarted.open()
    expect(restarted.snapshot().test?.outcome).toBe('UNKNOWN')
    await expect(restarted.beginTest(testInput())).rejects.toThrow('ADDON_TEST_REVIEW_REQUIRED')
  })
  it('zero tasks, exit and repeated startup preserve the same durable empty journal', async () => {
    const f = await fixture()
    const before = await readFile(f.profile.journal.filePath)
    for (let i = 0; i < 2; i++) {
      const restarted = f.fresh(); await restarted.open()
      expect(restarted.snapshot()).toMatchObject({ revision: 0, enabled: false, mode: null })
      expect(restarted.journal.records()).toEqual([])
      expect(await readFile(restarted.journal.filePath)).toEqual(before)
    }
  })
  it.each(['missing', 'corrupt'])('historical %s journal is rejected, never recreated', async condition => {
    const f = await fixture()
    if (condition === 'missing') await rename(f.profile.journal.filePath, `${f.profile.journal.filePath}.preserved`)
    else await writeFile(f.profile.journal.filePath, '{invalid')
    await expect(f.fresh().open()).rejects.toThrow()
    if (condition === 'missing') await expect(readFile(f.profile.journal.filePath)).rejects.toMatchObject({ code: 'ENOENT' })
    else expect(await readFile(f.profile.journal.filePath, 'utf8')).toBe('{invalid')
  })
  it('lost profile with historical journal cannot masquerade as a first install', async () => {
    const f = await fixture()
    const journal = await readFile(f.profile.journal.filePath)
    await rename(path.join(f.directory, 'profile.sealed'), path.join(f.directory, 'profile.preserved'))
    await expect(f.fresh().open()).rejects.toThrow('ADDON_INITIALIZATION_INCOMPLETE_OR_PROFILE_LOST')
    expect(await readFile(f.profile.journal.filePath)).toEqual(journal)
  })
  it('required profile initialization fsync failure leaves evidence, not an initialized profile', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'network-addon-init-fault-'))
    const options = { directory, identity, protector, interfaces: () => interfaces }
    fault.match = 'profile.sealed.'; fault.hits = 0
    try { await expect(new NetworkAddonProfile(options).open()).rejects.toMatchObject({ code: 'EIO' }); expect(fault.hits).toBe(1) }
    finally { fault.match = '' }
    expect((await readdir(directory)).filter(name => name === 'profile.sealed')).toEqual([])
    await expect(new NetworkAddonProfile(options).open()).rejects.toThrow('ADDON_INITIALIZATION_INCOMPLETE_OR_PROFILE_LOST')
  })
  it('cannot enable before physical TEST confirmation or confirm an unsent TEST', async () => {
    const f = await fixture()
    await expect(f.profile.setEnabled(true)).rejects.toThrow('ADDON_TEST_CONFIRMATION_REQUIRED')
    const test = await f.profile.beginTest(testInput())
    await expect(f.profile.confirmTest(test.id, true, false)).rejects.toThrow('ADDON_TEST_CONFIRMATION_REQUIRED')
    await f.profile.finishTest(test.id, 'SUBMITTED')
    await expect(f.profile.confirmTest(test.id, false, false)).rejects.toThrow('ADDON_TEST_CONFIRMATION_REQUIRED')
    await f.profile.confirmTest(test.id, true, false)
    await f.profile.setEnabled(true)
    expect(await f.profile.read()).toEqual({ mode: 'FRONT_ONLY', endpoint })
  })
  it.each(['INTENT', 'UNKNOWN', 'SUBMITTED'] as const)('%s TEST is retained and never replayed after restart', async outcome => {
    const f = await fixture(), test = await f.profile.beginTest(testInput())
    if (outcome !== 'INTENT') await f.profile.finishTest(test.id, outcome)
    const fresh = f.fresh(); await fresh.open()
    expect(fresh.snapshot().test).toMatchObject({ id: test.id, outcome })
    await expect(fresh.beginTest(testInput())).rejects.toThrow('ADDON_TEST_REVIEW_REQUIRED')
    await expect(fresh.setEnabled(true)).rejects.toThrow('ADDON_TEST_CONFIRMATION_REQUIRED')
  })
  it('address recovery retains journal and immutable previous config, and requires same-device paper confirmation', async () => {
    const f = await fixture(); await configure(f.profile); await f.profile.setEnabled(true)
    await f.profile.journal.recordClaimed(job())
    await f.profile.journal.recordTerminal(job(), { state: 'SUCCEEDED', resultCode: 'SUBMITTED_TO_NETWORK_SOCKET', effectBoundary: 'CROSSED', physicalCompletionKnown: false })
    await f.profile.journal.markReported(job().id, 1)
    const journal = await readFile(f.profile.journal.filePath), first = await readFile(path.join(f.directory, 'nodes-1.sealed'))
    await expect(f.profile.beginTest(testInput('10.20.30.3'))).rejects.toThrow('ADDON_PAUSE_REQUIRED')
    await f.profile.setEnabled(false)
    const next = await f.profile.beginTest(testInput('10.20.30.3'))
    await f.profile.finishTest(next.id, 'SUBMITTED')
    await expect(f.profile.confirmTest(next.id, true, false)).rejects.toThrow('ADDON_SAME_PHYSICAL_PRINTER_REQUIRED')
    await f.profile.confirmTest(next.id, true, true)
    expect(await readFile(path.join(f.directory, 'nodes-1.sealed'))).toEqual(first)
    expect(await readFile(f.profile.journal.filePath)).toEqual(journal)
    const fresh = f.fresh(); await fresh.open()
    expect(fresh.snapshot()).toMatchObject({ revision: 2, enabled: false, mode: 'FRONT_ONLY' })
    expect(await fresh.readForRecovery()).toEqual({ mode: 'FRONT_ONLY', endpoint: { ...endpoint, host: '10.20.30.3' } })
  })
  it('moving to another LAN permits only display of old endpoint, not TCP or silent reroute', async () => {
    const f = await fixture(); await configure(f.profile)
    const moved = new NetworkAddonProfile({ ...f.options, interfaces: () => ({}) })
    await moved.open()
    expect((await moved.readForRecovery()).endpoint).toEqual(endpoint)
    await expect(moved.setEnabled(true)).rejects.toThrow('NETWORK_DIRECT_LAN_REQUIRED')
  })
  it('unknown business side effect blocks setup TEST and enable without changing history', async () => {
    const f = await fixture(); await configure(f.profile)
    await f.profile.journal.recordClaimed(job()); await f.profile.journal.recordExecuting(job(), 'CROSSING_UNKNOWN')
    const bytes = await readFile(f.profile.journal.filePath)
    await expect(f.profile.beginTest(testInput())).rejects.toThrow('NETWORK_UNCERTAIN_EFFECT_REQUIRES_REVIEW')
    await expect(f.profile.setEnabled(true)).rejects.toThrow('NETWORK_UNCERTAIN_EFFECT_REQUIRES_REVIEW')
    expect(await readFile(f.profile.journal.filePath)).toEqual(bytes)
  })
  it('binding change and mode change cannot reuse or reset a profile', async () => {
    const f = await fixture(); await configure(f.profile)
    await expect(new NetworkAddonProfile({ ...f.options, identity: { ...identity, storeCode: 'OTHER' } }).open()).rejects.toThrow('ADDON_PROFILE_INVALID_OR_BINDING_CHANGED')
    await expect(f.profile.beginTest({ ...testInput(), mode: 'SHARED_PRINTER' })).rejects.toThrow('ADDON_MODE_LOCKED')
  })
})
