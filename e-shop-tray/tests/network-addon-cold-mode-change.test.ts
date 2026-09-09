import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NetworkAddonProfile, type LocalTest } from '../network-addon/profile'
import type { ReceivedPrintJob } from '../src/cloudRelayClient'

// Inject errors into the real filesystem calls used by the production helper;
// no duplicate transaction implementation or synthetic success fixture.
const fault = vi.hoisted(() => ({ operation: '', match: '', skip: 0, hits: 0, persistent: false }))
vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof import('node:fs/promises')>()
  const fail = (operation: string, target: unknown) => {
    if (fault.operation !== operation || !(fault.match.startsWith('=')
      ? String(target) === fault.match.slice(1) : String(target).includes(fault.match))) return
    if (fault.skip > 0) { fault.skip--; return }
    fault.hits++
    if (!fault.persistent) fault.operation = ''
    throw Object.assign(new Error(`injected ${operation}`), { code: 'EIO' })
  }
  return { ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => { fail('rename', args[1]); return actual.rename(...args) },
    link: async (...args: Parameters<typeof actual.link>) => { fail('link', args[1]); return actual.link(...args) },
    mkdir: async (...args: Parameters<typeof actual.mkdir>) => { fail('mkdir', args[0]); return actual.mkdir(...args) },
    open: async (...args: Parameters<typeof actual.open>) => {
      fail('open', args[0])
      const handle = await actual.open(...args)
      const sync = handle.sync.bind(handle), write = handle.writeFile.bind(handle)
      handle.sync = async () => { fail('sync', args[0]); await sync() }
      handle.writeFile = async (...params: Parameters<typeof handle.writeFile>) => { fail('write', args[0]); return write(...params) }
      return handle
    },
  }
})
afterEach(() => { fault.operation = ''; fault.match = ''; fault.skip = 0; fault.hits = 0; fault.persistent = false })
const protector = { protect: (text: string) => Buffer.from(text).toString('base64'), unprotect: (text: string) => Buffer.from(text, 'base64').toString() }
const identity = { installationId: 'cold-installation-01', computerId: 'cold-computer', storeCode: 'TEST-STORE', boundAt: '2026-09-09' }
const interfaces: ReturnType<typeof os.networkInterfaces> = { LAN: [{ address: '10.20.30.1', netmask: '255.255.255.0',
  family: 'IPv4', internal: false, mac: '00:00:00:00:00:01', cidr: '10.20.30.1/24' }] }
const endpoint = { host: '10.20.30.2', port: 9100 }
const testInput = (mode: LocalTest['mode']) => ({ id: randomUUID(), mode, endpoint, networkFingerprint: '1'.repeat(64),
  hardwareAddress: '02-11-22-33-44-55', bytes: 12, sha256: '2'.repeat(64) })
async function fixture(mode: LocalTest['mode'] = 'FRONT_ONLY') {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'network-cold-mode-'))
  const options = { directory, identity, protector, interfaces: () => interfaces }
  const profile = new NetworkAddonProfile(options)
  await profile.open()
  const test = await profile.beginTest(testInput(mode))
  await profile.finishTest(test.id, 'SUBMITTED'); await profile.confirmTest(test.id, true, false)
  return { directory, options, profile, fresh: () => new NetworkAddonProfile(options) }
}
function job(): ReceivedPrintJob {
  return { id: 'cold-job-00001', claimAttempt: 1, claimToken: `ecp_v1_${'a'.repeat(43)}`, leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
    schemaVersion: 2, idempotencyKey: 'cold-job-00001', requestId: 'cold-job-00001', requestHash: '1'.repeat(64), orderNo: 'TEST-001',
    documentName: 'FRONT', commandStream: new Uint8Array() }
}
async function terminal(profile: NetworkAddonProfile, boundary: 'CROSSED' | 'CROSSING_UNKNOWN' = 'CROSSED') {
  await profile.journal.recordClaimed(job())
  await profile.journal.recordTerminal(job(), { state: 'SUCCEEDED', resultCode: 'SUBMITTED_TO_NETWORK_SOCKET', effectBoundary: boundary, physicalCompletionKnown: false })
}
async function evidence(f: Awaited<ReturnType<typeof fixture>>) {
  return { profile: await readFile(path.join(f.directory, 'profile.sealed'), 'utf8'),
    node: await readFile(path.join(f.directory, 'nodes-1.sealed'), 'utf8'),
    journal: await readFile(f.profile.journal.filePath, 'utf8') }
}
async function expectOldOrBlocked(f: Awaited<ReturnType<typeof fixture>>, mode: LocalTest['mode']) {
  const fresh = f.fresh()
  try {
    await fresh.open()
  } catch (error) {
    expect(fresh.restartRequired).toBe(true)
    await expect(fresh.read()).rejects.toThrow('ADDON_PROFILE_RESTART_REQUIRED')
    await expect(fresh.readForRecovery()).rejects.toThrow('ADDON_PROFILE_RESTART_REQUIRED')
    expect(error).toBeInstanceOf(Error)
    return
  }
  expect(fresh.snapshot()).toMatchObject({ mode, enabled: false })
  expect(await fresh.readForRecovery()).toEqual({ mode, endpoint })
  await expect(fresh.read()).rejects.toThrow('ADDON_PAUSED_OR_UNCONFIGURED')
}

describe('cold single-printer mode conversion and retained evidence', () => {
  it.each(['FRONT_ONLY', 'SHARED_PRINTER'] as const)('%s conversion retains exact originals and TEST, requires restart/enable once, then normal daily boots', async originalMode => {
    const f = await fixture(originalMode)
    await terminal(f.profile); await f.profile.journal.markReported(job().id, 1)
    const before = await evidence(f), test = f.profile.snapshot().test
    const nextMode = originalMode === 'FRONT_ONLY' ? 'SHARED_PRINTER' : 'FRONT_ONLY'
    const preflight = vi.fn(async context => { expect(context).toEqual({ identity, config: { mode: originalMode, endpoint }, test }) })
    await f.profile.convertMode(nextMode, preflight)
    expect(preflight).toHaveBeenCalledTimes(2)
    expect(f.profile.restartRequired).toBe(true)
    expect(() => f.profile.snapshot()).toThrow('ADDON_PROFILE_RESTART_REQUIRED')
    await expect(f.profile.read()).rejects.toThrow('ADDON_PROFILE_RESTART_REQUIRED')
    await expect(f.profile.readForRecovery()).rejects.toThrow('ADDON_PROFILE_RESTART_REQUIRED')
    await expect(f.profile.setEnabled(true)).rejects.toThrow('ADDON_PROFILE_BUSY_OR_FAULTED')
    const fresh = f.fresh(); await fresh.open()
    expect(fresh.snapshot()).toMatchObject({ schemaVersion: 2, mode: nextMode, enabled: false, coldEnableCheckRequired: true, test })
    expect(await fresh.readForRecovery()).toEqual({ mode: nextMode, endpoint })
    const id = fresh.snapshot().conversion!.id
    for (const [name, contents] of [['profile.sealed', before.profile], ['nodes-1.sealed', before.node], ['execution-journal.json', before.journal]]) {
      expect(await readFile(path.join(f.directory, id, `${name}.original`), 'utf8')).toBe(contents)
    }
    expect(await readFile(fresh.journal.filePath, 'utf8')).toBe(before.journal)
    expect(await readFile(path.join(f.directory, 'nodes-1.sealed'), 'utf8')).toBe(before.node)
    await fresh.setEnabled(true)
    expect(fresh.snapshot().coldEnableCheckRequired).toBe(false)
    for (let count = 0; count < 2; count++) {
      const dailyBoot = f.fresh(); await dailyBoot.open()
      expect(dailyBoot.snapshot()).toMatchObject({ enabled: true, coldEnableCheckRequired: false, test })
      expect(await dailyBoot.read()).toEqual({ mode: nextMode, endpoint })
    }
  })

  it('round trip preserves historic TEST mode/id/hash and a recursively anchored conversion chain', async () => {
    const f = await fixture(), original = f.profile.snapshot().test
    await f.profile.convertMode('SHARED_PRINTER', async () => {})
    const second = f.fresh(); await second.open()
    const prior = second.snapshot().conversion!.id
    await second.convertMode('FRONT_ONLY', async () => {})
    const third = f.fresh(); await third.open()
    expect(third.snapshot()).toMatchObject({ revision: 3, mode: 'FRONT_ONLY', enabled: false, test: original,
      conversion: { fromMode: 'SHARED_PRINTER', toMode: 'FRONT_ONLY', previousConversionId: prior } })
    expect(await third.readForRecovery()).toEqual({ mode: 'FRONT_ONLY', endpoint })
  })

  it('same-mode no-op leaves every byte and restart flag unchanged', async () => {
    const f = await fixture(), before = await evidence(f)
    const preflight = vi.fn(async () => {})
    await expect(f.profile.convertMode('FRONT_ONLY', preflight)).rejects.toThrow('ADDON_COLD_SAME_MODE')
    expect(await evidence(f)).toEqual(before); expect(f.profile.restartRequired).toBe(false)
    expect(preflight).not.toHaveBeenCalled()
  })

  it.each(['CLAIMED', 'EXECUTING', 'UNACKED', 'QUARANTINED', 'UNKNOWN'] as const)('refuses %s local work before any external preflight or node write', async state => {
    const f = await fixture()
    await f.profile.journal.recordClaimed(job())
    if (state === 'EXECUTING') await f.profile.journal.recordExecuting(job(), 'NOT_CROSSED')
    if (['UNACKED', 'QUARANTINED', 'UNKNOWN'].includes(state)) {
      await f.profile.journal.recordTerminal(job(), { state: 'SUCCEEDED', resultCode: 'SUBMITTED_TO_NETWORK_SOCKET', effectBoundary: state === 'UNKNOWN' ? 'CROSSING_UNKNOWN' : 'CROSSED', physicalCompletionKnown: false })
      if (state === 'QUARANTINED') await f.profile.journal.markQuarantined(job().id, 1, 'RELAY_ACK_REJECTED')
      if (state === 'UNKNOWN') await f.profile.journal.markReported(job().id, 1)
    }
    const before = await evidence(f), preflight = vi.fn(async () => {})
    await expect(f.profile.convertMode('SHARED_PRINTER', preflight)).rejects.toThrow('ADDON_COLD_LOCAL_WORK_UNSETTLED')
    expect(preflight).not.toHaveBeenCalled(); expect(await evidence(f)).toEqual(before)
    expect((await readdir(f.directory)).some(name => name === 'nodes-2.sealed')).toBe(false)
  })

  it.each([false, true])('known abandoned NOT_CROSSED history (terminal result %s) is settled and retained', async hasResult => {
    const f = await fixture()
    await f.profile.journal.recordClaimed(job())
    if (hasResult) await f.profile.journal.recordTerminal(job(), { state: 'FAILED', resultCode: 'NETWORK_NOT_SUBMITTED', effectBoundary: 'NOT_CROSSED', physicalCompletionKnown: false })
    await f.profile.journal.markAbandoned(job().id, 1)
    const original = await readFile(f.profile.journal.filePath, 'utf8')
    await f.profile.convertMode('SHARED_PRINTER', async () => {})
    const fresh = f.fresh(); await fresh.open()
    expect(fresh.snapshot().mode).toBe('SHARED_PRINTER')
    expect(await readFile(f.profile.journal.filePath, 'utf8')).toBe(original)
  })

  it.each(['ABANDONED', 'TERMINAL'] as const)('%s with disagreeing record/result boundaries fails closed', async state => {
    const f = await fixture()
    await terminal(f.profile)
    if (state === 'ABANDONED') await f.profile.journal.markAbandoned(job().id, 1)
    else await f.profile.journal.markReported(job().id, 1)
    const raw = JSON.parse(await readFile(f.profile.journal.filePath, 'utf8'))
    raw.records[0].effectBoundary = 'NOT_CROSSED'
    await writeFile(f.profile.journal.filePath, JSON.stringify(raw))
    const before = await evidence(f), preflight = vi.fn(async () => {})
    await expect(f.profile.convertMode('SHARED_PRINTER', preflight)).rejects.toThrow('ADDON_COLD_LOCAL_WORK_UNSETTLED')
    expect(preflight).not.toHaveBeenCalled(); expect(await evidence(f)).toEqual(before)
  })

  it.each(['IDENTITY_MISMATCH', 'NETWORK_DEVICE_IDENTITY_CHANGED', 'CLOUD_QUEUE_UNSETTLED'])('refuses %s without changing profile/journal', async error => {
    const f = await fixture(), before = await evidence(f)
    await expect(f.profile.convertMode('SHARED_PRINTER', async () => { throw new Error(error) })).rejects.toThrow(error)
    expect(await evidence(f)).toEqual(before); expect(f.profile.restartRequired).toBe(true)
  })

  it.each(['INTENT', 'SUBMITTED', 'UNKNOWN', 'NOT_CROSSED'] as const)('an outstanding %s TEST never authorizes conversion', async outcome => {
    const f = await fixture(), input = await f.profile.beginTest(testInput('FRONT_ONLY'))
    if (outcome !== 'INTENT') await f.profile.finishTest(input.id, outcome)
    const before = await evidence(f), preflight = vi.fn(async () => {})
    await expect(f.profile.convertMode('SHARED_PRINTER', preflight)).rejects.toThrow('ADDON_COLD_SETTLED_TEST_REQUIRED')
    expect(preflight).not.toHaveBeenCalled(); expect(await evidence(f)).toEqual(before)
  })

  it('an enabled profile cannot convert or create a backup/node transaction', async () => {
    const f = await fixture(); await f.profile.setEnabled(true)
    const before = await evidence(f), preflight = vi.fn(async () => {})
    await expect(f.profile.convertMode('SHARED_PRINTER', preflight)).rejects.toThrow('ADDON_COLD_PAUSE_REQUIRED')
    expect(preflight).not.toHaveBeenCalled(); expect(await evidence(f)).toEqual(before)
    expect((await readdir(f.directory)).some(name => name.startsWith('cold-transaction-'))).toBe(false)
  })

  it('legacy schema 1 is still exact, with no undeclared conversion field or coerced version accepted', async () => {
    for (const alteration of [{ conversion: {} }, { coldEnableCheckRequired: true }, { schemaVersion: '1' }]) {
      const f = await fixture()
      const file = path.join(f.directory, 'profile.sealed')
      const state = JSON.parse(protector.unprotect(await readFile(file, 'utf8')))
      await writeFile(file, protector.protect(JSON.stringify({ ...state, ...alteration })))
      await expect(f.fresh().open()).rejects.toThrow()
    }
  })

  it('second cloud preflight failure restores original and does not discard staged node evidence', async () => {
    const f = await fixture(), before = await evidence(f)
    let calls = 0
    await expect(f.profile.convertMode('SHARED_PRINTER', async () => { if (++calls === 2) throw new Error('CLOUD_QUEUE_UNSETTLED') })).rejects.toThrow('CLOUD_QUEUE_UNSETTLED')
    expect(await evidence(f)).toEqual(before)
    expect((await readdir(f.directory))).toContain('nodes-2.sealed')
    await expectOldOrBlocked(f, 'FRONT_ONLY')
    const oldMode = f.fresh(); await oldMode.open()
    await oldMode.setEnabled(true)
    const daily = f.fresh(); await daily.open()
    expect(daily.snapshot()).toMatchObject({ schemaVersion: 1, enabled: true, mode: 'FRONT_ONLY' })
  })

  it('a new local claim during cloud preflight blocks publication and keeps job evidence', async () => {
    const f = await fixture(), before = await evidence(f)
    let calls = 0
    await expect(f.profile.convertMode('SHARED_PRINTER', async () => {
      if (++calls === 2) await f.profile.journal.recordClaimed(job())
    })).rejects.toThrow('ADDON_COLD_LOCAL_WORK_UNSETTLED')
    expect(await readFile(path.join(f.directory, 'profile.sealed'), 'utf8')).toBe(before.profile)
    expect(JSON.parse(await readFile(f.profile.journal.filePath, 'utf8')).records).toHaveLength(1)
  })
})

describe('real filesystem fault barriers and interrupted recovery', () => {
  it.each([
    ['mkdir', 'cold-transaction-', 0],
    ['open', 'profile.sealed.original', 0], ['write', 'profile.sealed.original', 0], ['sync', 'profile.sealed.original', 0],
    ['write', 'execution-journal.json.original', 0], ['sync', 'execution-journal.json.original', 0],
    ['write', 'intent.sealed', 0], ['sync', 'intent.sealed', 0],
    ['write', 'nodes-2.sealed.', 0], ['sync', 'nodes-2.sealed.', 0], ['link', 'nodes-2.sealed', 0], ['sync', 'nodes-2.sealed', 1],
    ['write', '/profile.sealed.', 1], ['rename', '/profile.sealed', 0], ['sync', '/profile.sealed', 2],
    ['sync', 'decision-', 0], ['rename', '/decision.sealed', 0],
  ])('%s failure at %s (skip %i) never activates a reported failed conversion', async (operation, match, skip) => {
    const f = await fixture(), before = await evidence(f)
    Object.assign(fault, { operation, match, skip, hits: 0 })
    await expect(f.profile.convertMode('SHARED_PRINTER', async () => {})).rejects.toThrow()
    expect(fault.hits).toBeGreaterThan(0); fault.operation = ''
    expect(await readFile(path.join(f.directory, 'profile.sealed'), 'utf8')).toBe(before.profile)
    expect(await readFile(f.profile.journal.filePath, 'utf8')).toBe(before.journal)
    expect(f.profile.restartRequired).toBe(true)
    await expect(f.profile.readForRecovery()).rejects.toThrow('ADDON_PROFILE_RESTART_REQUIRED')
    await expectOldOrBlocked(f, 'FRONT_ONLY')
  })

  it.each([1, 2, 5, 6])('required directory sync failure %i is reported and restores original', async skip => {
    const f = await fixture(), before = await evidence(f)
    Object.assign(fault, { operation: 'sync', match: `=${f.directory}`, skip })
    await expect(f.profile.convertMode('SHARED_PRINTER', async () => {})).rejects.toThrow()
    expect(fault.hits).toBe(1); fault.operation = ''
    expect(await readFile(path.join(f.directory, 'profile.sealed'), 'utf8')).toBe(before.profile)
    await expectOldOrBlocked(f, 'FRONT_ONLY')
  })

  it('critical original journal fsync must succeed before preflight or any new node', async () => {
    const f = await fixture(), before = await evidence(f), preflight = vi.fn(async () => {})
    Object.assign(fault, { operation: 'sync', match: `=${f.profile.journal.filePath}` })
    await expect(f.profile.convertMode('SHARED_PRINTER', preflight)).rejects.toThrow('injected sync')
    expect(preflight).not.toHaveBeenCalled()
    expect(await evidence(f)).toEqual(before)
    expect((await readdir(f.directory))).not.toContain('nodes-2.sealed')
  })

  it('persistent final profile fsync failure retains a recoverable original; restart rolls it back', async () => {
    const f = await fixture(), before = await evidence(f)
    Object.assign(fault, { operation: 'sync', match: '/profile.sealed', skip: 2, persistent: true })
    await expect(f.profile.convertMode('SHARED_PRINTER', async () => {})).rejects.toThrow('ADDON_COLD_TRANSACTION_BLOCKED')
    fault.operation = ''; fault.persistent = false
    const fresh = f.fresh(); await fresh.open()
    expect(fresh.recoveryPaused).toBe(true)
    expect(fresh.snapshot()).toMatchObject({ mode: 'FRONT_ONLY', enabled: false })
    expect(await readFile(path.join(f.directory, 'profile.sealed'), 'utf8')).toBe(before.profile)
  })

  it('conversion missing its final authority selector restores old bytes even when new profile exists', async () => {
    const f = await fixture(), before = await evidence(f)
    await f.profile.convertMode('SHARED_PRINTER', async () => {})
    const transaction = (await readdir(f.directory)).find(name => name.startsWith('cold-transaction-'))!
    await rename(path.join(f.directory, transaction, 'decision.sealed'), path.join(f.directory, transaction, 'decision.interrupted-evidence'))
    const fresh = f.fresh(); await fresh.open()
    expect(fresh.snapshot()).toMatchObject({ mode: 'FRONT_ONLY', enabled: false })
    expect(fresh.recoveryPaused).toBe(true)
    expect(await readFile(path.join(f.directory, 'profile.sealed'), 'utf8')).toBe(before.profile)
  })

  it.each(['selector-sync', 'profile-sync', 'node-sync', 'corrupt-selector', 'corrupt-original', 'missing-original'])('%s on restart blocks all configuration reads and polling', async stage => {
    const f = await fixture(); await f.profile.convertMode('SHARED_PRINTER', async () => {})
    const id = (await readdir(f.directory)).find(name => name.startsWith('cold-transaction-'))!
    if (stage === 'selector-sync') Object.assign(fault, { operation: 'sync', match: '/decision.sealed', skip: 0 })
    if (stage === 'profile-sync') Object.assign(fault, { operation: 'sync', match: '/profile.sealed', skip: 0 })
    if (stage === 'node-sync') Object.assign(fault, { operation: 'sync', match: '/nodes-2.sealed', skip: 0 })
    if (stage === 'corrupt-selector') await writeFile(path.join(f.directory, id, 'decision.sealed'), 'broken')
    if (stage === 'corrupt-original') await writeFile(path.join(f.directory, id, 'profile.sealed.original'), 'broken')
    if (stage === 'missing-original') await rename(path.join(f.directory, id, 'profile.sealed.original'), path.join(f.directory, id, 'profile.saved-evidence'))
    const fresh = f.fresh(); await expect(fresh.open()).rejects.toThrow()
    await expect(fresh.read()).rejects.toThrow('ADDON_PROFILE_RESTART_REQUIRED')
    await expect(fresh.readForRecovery()).rejects.toThrow('ADDON_PROFILE_RESTART_REQUIRED')
  })

  it.each(['profile-final-sync', 'decision-sync', 'decision-rename'])('first manual enable %s failure cannot become auto-enabled on restart', async stage => {
    const f = await fixture(); await f.profile.convertMode('SHARED_PRINTER', async () => {})
    const paused = f.fresh(); await paused.open()
    const before = await readFile(path.join(f.directory, 'profile.sealed'), 'utf8')
    Object.assign(fault, stage === 'profile-final-sync' ? { operation: 'sync', match: '/profile.sealed', skip: 2 }
      : stage === 'decision-sync' ? { operation: 'sync', match: 'decision-', skip: 0 }
        : { operation: 'rename', match: '/decision.sealed', skip: 0 })
    await expect(paused.setEnabled(true)).rejects.toThrow()
    expect(fault.hits).toBe(1); fault.operation = ''
    expect(await readFile(path.join(f.directory, 'profile.sealed'), 'utf8')).toBe(before)
    const fresh = f.fresh(); await fresh.open()
    expect(fresh.snapshot()).toMatchObject({ enabled: false, coldEnableCheckRequired: true })
    await expect(fresh.read()).rejects.toThrow('ADDON_PAUSED_OR_UNCONFIGURED')
    await fresh.setEnabled(true)
    const daily = f.fresh(); await daily.open()
    expect(daily.snapshot()).toMatchObject({ enabled: true, coldEnableCheckRequired: false })
  })
})
