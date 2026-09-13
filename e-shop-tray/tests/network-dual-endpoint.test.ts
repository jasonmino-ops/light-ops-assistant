import { randomUUID } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ColdModeLifecycle } from '../network-addon/coldModeLifecycle'
import { NetworkAddonProfile, type LocalTest } from '../network-addon/profile'
import { NetworkNodeConfig } from '../src/networkNodeConfig'

const protector = {
  protect: (text: string) => Buffer.from(text).toString('base64'),
  unprotect: (text: string) => Buffer.from(text, 'base64').toString(),
}
const identity = { installationId: 'dual-installation', computerId: 'dual-computer', storeCode: 'DUAL-STORE', boundAt: '2026-09-13' }
const interfaces: ReturnType<typeof os.networkInterfaces> = { LAN: [{ address: '10.20.30.1', netmask: '255.255.255.0',
  family: 'IPv4', internal: false, mac: '00:00:00:00:00:01', cidr: '10.20.30.1/24' }] }
const front = { host: '10.20.30.2', port: 9100 }
const kitchen = { host: '10.20.30.3', port: 9100 }
const confirmedTest = (endpoint: typeof front, mode: LocalTest['mode'] = 'SHARED_PRINTER',
  hardwareAddress = '02-11-22-33-44-55'): LocalTest => ({
  id: randomUUID(), mode, endpoint, networkFingerprint: '1'.repeat(64), hardwareAddress,
  outcome: 'CONFIRMED', bytes: 12, sha256: '2'.repeat(64),
})
const pendingTest = (endpoint: typeof front, mode: LocalTest['mode'] = 'SHARED_PRINTER', hardwareAddress?: string) => {
  const { outcome: _outcome, ...test } = confirmedTest(endpoint, mode, hardwareAddress)
  return test
}

async function emptyProfile() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'network-dual-endpoint-'))
  const options = { directory, identity, protector, interfaces: () => interfaces }
  const profile = new NetworkAddonProfile(options)
  await profile.open()
  return { directory, options, profile, fresh: () => new NetworkAddonProfile(options) }
}

async function legacySharedProfile() {
  const fixture = await emptyProfile()
  const test = confirmedTest(front)
  await new NetworkNodeConfig({ ...fixture.options, file: path.join(fixture.directory, 'nodes-1.sealed') })
    .save({ mode: 'SHARED_PRINTER', endpoint: front })
  await writeFile(path.join(fixture.directory, 'profile.sealed'), protector.protect(JSON.stringify({
    schemaVersion: 1, identity, revision: 1, mode: 'SHARED_PRINTER', enabled: false, test,
  })))
  const profile = fixture.fresh()
  await profile.open()
  return { ...fixture, profile, test }
}

describe('FRONT/KITCHEN persistent endpoint setup', () => {
  it('requires and locks two confirmed endpoints for a new shared-printer setup', async () => {
    const f = await emptyProfile()
    const frontTest = await f.profile.beginTest(pendingTest(front))
    await f.profile.finishTest(frontTest.id, 'SUBMITTED')
    await f.profile.confirmTest(frontTest.id, true, false)
    expect(f.profile.snapshot()).toMatchObject({ schemaVersion: 3, mode: 'SHARED_PRINTER',
      test: { endpoint: front, outcome: 'CONFIRMED' }, kitchenTest: null })
    await expect(f.profile.setEnabled(true)).rejects.toThrow('ADDON_ROLE_TEST_CONFIRMATION_REQUIRED')

    const kitchenTest = await f.profile.beginTest(pendingTest(kitchen, 'SHARED_PRINTER', '02-66-77-88-99-aa'), 'KITCHEN')
    await f.profile.finishTest(kitchenTest.id, 'SUBMITTED')
    await f.profile.confirmTest(kitchenTest.id, true, false)
    expect(f.profile.snapshot()).toMatchObject({ revision: 2, enabled: false, coldEnableCheckRequired: true,
      kitchenTest: { endpoint: kitchen, outcome: 'CONFIRMED' } })
    expect(await f.profile.readForRecovery()).toEqual({ mode: 'SHARED_PRINTER', endpoint: front, kitchenEndpoint: kitchen })
    expect(f.profile.confirmedTest('FRONT', front).hardwareAddress).toBe('02-11-22-33-44-55')
    expect(f.profile.confirmedTest('KITCHEN', kitchen).hardwareAddress).toBe('02-66-77-88-99-aa')
    expect(() => f.profile.confirmedTest('KITCHEN', front)).toThrow('NETWORK_CONFIG_CHANGED')
    await expect(f.profile.beginTest(pendingTest(kitchen), 'FRONT')).rejects.toThrow('NETWORK_ROLE_ENDPOINT_DUPLICATE')
    await f.profile.setEnabled(true)
    expect(await f.profile.read()).toEqual({ mode: 'SHARED_PRINTER', endpoint: front, kitchenEndpoint: kitchen })

    const restarted = f.fresh(); await restarted.open()
    expect(restarted.snapshot()).toMatchObject({ enabled: true, test: { endpoint: front }, kitchenTest: { endpoint: kitchen } })
    expect(await restarted.read()).toEqual({ mode: 'SHARED_PRINTER', endpoint: front, kitchenEndpoint: kitchen })
    await expect(restarted.beginTest(pendingTest({ ...kitchen, port: 9101 }), 'KITCHEN'))
      .rejects.toThrow('ADDON_PAUSE_REQUIRED')

    await restarted.setEnabled(false)
    const preflight = vi.fn(async context => {
      expect(context).toMatchObject({ config: { mode: 'SHARED_PRINTER', endpoint: front, kitchenEndpoint: kitchen },
        test: { endpoint: front, outcome: 'CONFIRMED' },
        kitchenTest: { endpoint: kitchen, outcome: 'CONFIRMED' } })
    })
    await restarted.convertMode('FRONT_ONLY', preflight)
    expect(preflight).toHaveBeenCalledTimes(2)
    const frontOnly = f.fresh(); await frontOnly.open()
    expect(await frontOnly.readForRecovery()).toEqual({ mode: 'FRONT_ONLY', endpoint: front })
  })

  it('upgrades an rc.8 legacy shared endpoint without changing its confirmed FRONT identity', async () => {
    const f = await legacySharedProfile()
    expect(await f.profile.readForRecovery()).toEqual({ mode: 'SHARED_PRINTER', endpoint: front })
    const originalFront = structuredClone(f.profile.snapshot().test)
    expect(f.profile.confirmedTest('KITCHEN', front)).toEqual(originalFront)
    await f.profile.setEnabled(true)
    expect(await f.profile.read()).toEqual({ mode: 'SHARED_PRINTER', endpoint: front })
    await f.profile.setEnabled(false)
    const test = await f.profile.beginTest(pendingTest(kitchen), 'KITCHEN')
    await f.profile.finishTest(test.id, 'SUBMITTED')
    await f.profile.confirmTest(test.id, true, false)
    expect(f.profile.snapshot()).toMatchObject({ schemaVersion: 3, revision: 2, test: originalFront,
      kitchenTest: { endpoint: kitchen, outcome: 'CONFIRMED' }, coldEnableCheckRequired: true })
    expect(await f.profile.readForRecovery()).toEqual({ mode: 'SHARED_PRINTER', endpoint: front, kitchenEndpoint: kitchen })
  })

  it('rejects a duplicate role endpoint and preserves the legacy config', async () => {
    const f = await legacySharedProfile()
    const before = f.profile.snapshot()
    await expect(f.profile.beginTest(pendingTest(front), 'KITCHEN')).rejects.toThrow('NETWORK_ROLE_ENDPOINT_DUPLICATE')
    expect(f.profile.snapshot()).toEqual(before)
    expect(await f.profile.readForRecovery()).toEqual({ mode: 'SHARED_PRINTER', endpoint: front })
  })
})

describe('cold safety before adding the KITCHEN endpoint', () => {
  it('requires a paused never-started process, closed cashier tabs, one Agent and an empty queue', async () => {
    const f = await legacySharedProfile()
    const queue = vi.fn(async () => ({ pending: 0, claimed: 0, executing: 0, unknown: 0 }))
    const ports = { client: { networkQueueState: queue }, stopAndWait: vi.fn(async () => {}),
      assertIdentity: vi.fn(async () => {}), validate: vi.fn(async () => {}), start: vi.fn(), exit: vi.fn(async () => {}) }
    const lifecycle = new ColdModeLifecycle({ profile: f.profile, ...ports })
    await expect(lifecycle.prepareEndpointChange({ cashierTabsClosed: false, singleAgentConfirmed: true }))
      .rejects.toThrow('ADDON_COLD_CLOSE_CASHIER_REQUIRED')
    await expect(lifecycle.prepareEndpointChange({ cashierTabsClosed: true, singleAgentConfirmed: false }))
      .rejects.toThrow('ADDON_SINGLE_AGENT_CONFIRMATION_REQUIRED')
    await lifecycle.prepareEndpointChange({ cashierTabsClosed: true, singleAgentConfirmed: true })
    expect(queue).toHaveBeenCalledTimes(1)
    expect(ports.stopAndWait).toHaveBeenCalledTimes(1)

    queue.mockResolvedValueOnce({ pending: 1, claimed: 0, executing: 0, unknown: 0 })
    await expect(lifecycle.prepareEndpointChange({ cashierTabsClosed: true, singleAgentConfirmed: true }))
      .rejects.toThrow('ADDON_COLD_CLOUD_WORK_PENDING')
  })
})
