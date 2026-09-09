import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ColdModeLifecycle } from '../network-addon/coldModeLifecycle'
import { NetworkAddonProfile } from '../network-addon/profile'
import type { ReceivedPrintJob } from '../src/cloudRelayClient'
import { RelayPoller } from '../src/relayPoller'

const protector = { protect: (value: string) => Buffer.from(value).toString('base64'), unprotect: (value: string) => Buffer.from(value, 'base64').toString() }
const identity = { installationId: 'test-cold-installation', computerId: 'test-cold-computer', storeCode: 'TEST-COLD', boundAt: '2026-09-09' }
const endpoint = { host: '10.20.30.2', port: 9100 }
const interfaces: ReturnType<typeof os.networkInterfaces> = { LAN: [{ address: '10.20.30.1', netmask: '255.255.255.0',
  family: 'IPv4', internal: false, mac: '00:00:00:00:00:01', cidr: '10.20.30.1/24' }] }
const confirmation = { cashierTabsClosed: true, singleAgentConfirmed: true }
const empty = { pending: 0, claimed: 0, executing: 0, unknown: 0 }
const job = (): ReceivedPrintJob => ({ id: 'job-cold-0001', schemaVersion: 2, idempotencyKey: 'cold-job-0001', requestId: 'cold-job-0001',
  requestHash: '1'.repeat(64), orderNo: 'TEST-COLD-001', documentName: 'FRONT', commandStream: new Uint8Array(),
  claimAttempt: 1, claimToken: `ecp_v1_${'a'.repeat(43)}`, leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
  network: { profile: 'network-v2', requestId: 'cold-job-0001', role: 'FRONT', mode: 'FRONT_ONLY', rendererVersion: 1,
    order: { storeCode: identity.storeCode, storeName: 'TEST', orderNo: 'TEST-COLD-001', createdAt: '2026-09-09', cashierName: 'TEST',
      paymentMethod: 'CASH', currencyCode: 'USD', totalAmount: 1, lang: 'zh', items: [{ name: 'TEST', spec: null, qty: 1, price: 1, lineAmount: 1 }] } } })

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'addon-cold-lifecycle-'))
  const options = { directory, identity, protector, interfaces: () => interfaces }
  const profile = new NetworkAddonProfile(options)
  await profile.open()
  const test = await profile.beginTest({ id: randomUUID(), mode: 'FRONT_ONLY', endpoint,
    networkFingerprint: '1'.repeat(64), hardwareAddress: '02-11-22-33-44-55', bytes: 10, sha256: '2'.repeat(64) })
  await profile.finishTest(test.id, 'SUBMITTED')
  await profile.confirmTest(test.id, true, false)
  const ports = {
    client: { networkQueueState: vi.fn(async () => ({ ...empty })) },
    stopAndWait: vi.fn(async () => {}), assertIdentity: vi.fn(async () => {}),
    validate: vi.fn(async () => {}), start: vi.fn(), exit: vi.fn(async () => {}),
  }
  const lifecycle = new ColdModeLifecycle({ profile, ...ports })
  return { directory, profile, lifecycle, ports, async restart() {
    const next = new NetworkAddonProfile(options); await next.open()
    return { profile: next, lifecycle: new ColdModeLifecycle({ profile: next, ...ports }) }
  } }
}

describe('commercial cold lifecycle used by the main process', () => {
  it('converts without enabling or printing, exits, and requires a new process with an explicit checked enable', async () => {
    const f = await fixture(), beforeJournal = await readFile(f.profile.journal.filePath)
    await f.lifecycle.convertAndExit('SHARED_PRINTER', confirmation)
    expect(f.lifecycle.restartRequired).toBe(true)
    expect(f.ports.exit).toHaveBeenCalledTimes(1)
    expect(f.ports.start).not.toHaveBeenCalled()
    expect(f.ports.client.networkQueueState).toHaveBeenCalled()
    expect(await readFile(f.profile.journal.filePath)).toEqual(beforeJournal)
    await expect(f.lifecycle.enable(confirmation)).rejects.toThrow('ADDON_PROFILE_RESTART_REQUIRED')
    await expect(f.lifecycle.pause()).rejects.toThrow('ADDON_PROFILE_RESTART_REQUIRED')
    const next = await f.restart()
    expect(next.profile.snapshot()).toMatchObject({ mode: 'SHARED_PRINTER', enabled: false, coldEnableCheckRequired: true })
    await next.lifecycle.resumeAtStartup()
    expect(f.ports.start).not.toHaveBeenCalled()
    await expect(next.lifecycle.enable({ ...confirmation, cashierTabsClosed: false })).rejects.toThrow('ADDON_COLD_CLOSE_CASHIER_REQUIRED')
    f.ports.client.networkQueueState.mockClear()
    await next.lifecycle.enable(confirmation)
    expect(f.ports.client.networkQueueState).toHaveBeenCalledTimes(1)
    expect(f.ports.start).toHaveBeenCalledTimes(1)
    expect(next.profile.snapshot()).toMatchObject({ enabled: true, coldEnableCheckRequired: false })
    const ordinary = await f.restart()
    f.ports.client.networkQueueState.mockClear()
    await ordinary.lifecycle.resumeAtStartup()
    expect(f.ports.start).toHaveBeenCalledTimes(2)
    expect(f.ports.client.networkQueueState).not.toHaveBeenCalled()
  })

  it('pause and safe exit preserve configuration and history without claiming that cloud work is empty', async () => {
    const f = await fixture()
    await f.lifecycle.enable(confirmation)
    const journal = await readFile(f.profile.journal.filePath)
    await f.lifecycle.pauseAndExit()
    expect(f.profile.snapshot()).toMatchObject({ mode: 'FRONT_ONLY', enabled: false })
    expect(f.ports.exit).toHaveBeenCalledTimes(1)
    expect(f.ports.client.networkQueueState).not.toHaveBeenCalled()
    expect(await readFile(f.profile.journal.filePath)).toEqual(journal)
    expect(() => f.lifecycle.assertMutable()).toThrow('ADDON_PROFILE_RESTART_REQUIRED')
  })

  it('an ordinary paused enable accepts queued work and permanently closes this process cold gate', async () => {
    const f = await fixture()
    f.ports.client.networkQueueState.mockResolvedValue({ ...empty, pending: 2 })
    await f.lifecycle.enable(confirmation)
    await f.lifecycle.pause()
    expect(f.ports.client.networkQueueState).not.toHaveBeenCalled()
    expect(f.lifecycle.everStartedPoller).toBe(true)
    await expect(f.lifecycle.convertAndExit('SHARED_PRINTER', confirmation)).rejects.toThrow('ADDON_COLD_PROCESS_RESTART_REQUIRED')
    expect(f.ports.exit).not.toHaveBeenCalled()
  })

  it('a process opened enabled cannot convert after validation failed before poller startup', async () => {
    const f = await fixture()
    await f.profile.setEnabled(true)
    const next = await f.restart()
    f.ports.validate.mockRejectedValueOnce(new Error('NETWORK_DEVICE_CHANGED'))
    await expect(next.lifecycle.resumeAtStartup()).rejects.toThrow('NETWORK_DEVICE_CHANGED')
    await next.lifecycle.pause()
    expect(next.lifecycle.everStartedPoller).toBe(false)
    expect(next.lifecycle.initializedPaused).toBe(false)
    await expect(next.lifecycle.convertAndExit('SHARED_PRINTER', confirmation)).rejects.toThrow('ADDON_COLD_PROCESS_RESTART_REQUIRED')
  })

  it('requires another paused boot after a same-process printer configuration change', async () => {
    const f = await fixture()
    const prior = f.profile.snapshot().test!
    const test = await f.profile.beginTest({ ...prior, id: randomUUID() })
    await f.profile.finishTest(test.id, 'SUBMITTED')
    await f.profile.confirmTest(test.id, true, true)
    expect(f.lifecycle.everStartedPoller).toBe(false)
    expect(f.lifecycle.coldProcess).toBe(false)
    await expect(f.lifecycle.convertAndExit('SHARED_PRINTER', confirmation)).rejects.toThrow('ADDON_COLD_PROCESS_RESTART_REQUIRED')
    await f.lifecycle.pauseAndExit()
    const next = await f.restart()
    expect(next.lifecycle.coldProcess).toBe(true)
    await next.lifecycle.convertAndExit('SHARED_PRINTER', confirmation)
  })

  it.each(['cashierTabsClosed', 'singleAgentConfirmed'] as const)('requires the explicit %s conversion confirmation', async field => {
    const f = await fixture(), before = await readFile(path.join(f.directory, 'profile.sealed'))
    await expect(f.lifecycle.convertAndExit('SHARED_PRINTER', { ...confirmation, [field]: false })).rejects.toThrow()
    expect(f.ports.stopAndWait).not.toHaveBeenCalled()
    expect(f.ports.client.networkQueueState).not.toHaveBeenCalled()
    expect(await readFile(path.join(f.directory, 'profile.sealed'))).toEqual(before)
  })

  it('same mode and unsupported targets have no writes, network reads, exit, or output', async () => {
    const f = await fixture(), before = await readFile(path.join(f.directory, 'profile.sealed'))
    await expect(f.lifecycle.convertAndExit('FRONT_ONLY', confirmation)).rejects.toThrow('ADDON_COLD_SAME_MODE')
    await expect(f.lifecycle.convertAndExit('DUAL' as 'FRONT_ONLY', confirmation)).rejects.toThrow('NETWORK_INVALID_MODE')
    expect(f.lifecycle.restartRequired).toBe(false)
    expect(f.ports.validate).not.toHaveBeenCalled()
    expect(f.ports.client.networkQueueState).not.toHaveBeenCalled()
    expect(f.ports.exit).not.toHaveBeenCalled()
    expect(f.ports.start).not.toHaveBeenCalled()
    expect(await readFile(path.join(f.directory, 'profile.sealed'))).toEqual(before)
  })

  it.each(['pending', 'claimed', 'executing', 'unknown'] as const)('refuses cloud %s work without any conversion or output', async field => {
    const f = await fixture(), before = await readFile(path.join(f.directory, 'profile.sealed'))
    f.ports.client.networkQueueState.mockResolvedValue({ ...empty, [field]: 1 })
    await expect(f.lifecycle.convertAndExit('SHARED_PRINTER', confirmation)).rejects.toThrow(field === 'unknown' ? 'ADDON_COLD_CLOUD_UNKNOWN' : 'ADDON_COLD_CLOUD_WORK_PENDING')
    expect(f.ports.exit).not.toHaveBeenCalled()
    expect(f.ports.start).not.toHaveBeenCalled()
    expect(await readFile(path.join(f.directory, 'profile.sealed'))).toEqual(before)
  })

  it.each(['CLAIMED', 'EXECUTING', 'UNACKED', 'QUARANTINED', 'UNKNOWN'] as const)('inspects the full journal and refuses %s, including records omitted by pendingRecords', async kind => {
    const f = await fixture(), current = job()
    await f.profile.journal.recordClaimed(current)
    if (kind === 'EXECUTING') await f.profile.journal.recordExecuting(current, 'NOT_CROSSED')
    if (['UNACKED', 'QUARANTINED', 'UNKNOWN'].includes(kind)) {
      await f.profile.journal.recordTerminal(current, { state: 'FAILED', resultCode: 'TEST_FAILURE',
        effectBoundary: kind === 'UNKNOWN' ? 'CROSSING_UNKNOWN' : 'NOT_CROSSED', physicalCompletionKnown: false })
      if (kind === 'QUARANTINED') await f.profile.journal.markQuarantined(current.id, 1, 'ES_TRAY_02_RESULT_CONFLICT')
      if (kind === 'UNKNOWN') await f.profile.journal.markReported(current.id, 1)
    }
    const before = await readFile(f.profile.journal.filePath)
    await expect(f.lifecycle.convertAndExit('SHARED_PRINTER', confirmation)).rejects.toThrow('ADDON_COLD_LOCAL_WORK_UNSETTLED')
    expect(f.ports.client.networkQueueState).not.toHaveBeenCalled()
    expect(f.ports.exit).not.toHaveBeenCalled()
    expect(await readFile(f.profile.journal.filePath)).toEqual(before)
  })

  it.each(['identity', 'prepare', 'pause', 'cloud', 'convert', 'exit', 'enable'] as const)('fails closed at the actual coordinator %s boundary', async boundary => {
    const f = await fixture(), failure = new Error(`INJECTED_${boundary.toUpperCase()}`)
    if (boundary === 'identity') f.ports.assertIdentity.mockRejectedValueOnce(failure)
    if (boundary === 'prepare') f.ports.validate.mockRejectedValueOnce(failure)
    if (boundary === 'pause') f.ports.stopAndWait.mockRejectedValueOnce(failure)
    if (boundary === 'cloud') f.ports.client.networkQueueState.mockRejectedValueOnce(failure)
    if (boundary === 'convert') vi.spyOn(f.profile, 'convertMode').mockRejectedValueOnce(failure)
    if (boundary === 'exit') f.ports.exit.mockRejectedValueOnce(failure)
    if (boundary === 'enable') vi.spyOn(f.profile, 'setEnabled').mockRejectedValueOnce(failure)
    const operation = boundary === 'enable' ? f.lifecycle.enable(confirmation) : boundary === 'pause'
      ? f.lifecycle.pauseAndExit() : f.lifecycle.convertAndExit('SHARED_PRINTER', confirmation)
    await expect(operation).rejects.toThrow(failure.message)
    expect(f.ports.start).not.toHaveBeenCalled()
    if (boundary !== 'exit') expect(f.ports.exit).not.toHaveBeenCalled()
    if (boundary === 'exit') {
      expect(f.lifecycle.restartRequired).toBe(true)
      await expect(f.lifecycle.enable(confirmation)).rejects.toThrow('ADDON_PROFILE_RESTART_REQUIRED')
      await f.lifecycle.safeExit()
      expect(f.ports.exit).toHaveBeenCalledTimes(2)
      const next = await f.restart()
      expect(next.profile.snapshot()).toMatchObject({ mode: 'SHARED_PRINTER', enabled: false, coldEnableCheckRequired: true })
    }
  })

  it.each(['conversion', 'firstEnable'] as const)('rejects an abandoned crossed record during %s using the shared journal predicate', async stage => {
    const f = await fixture()
    if (stage === 'firstEnable') await f.lifecycle.convertAndExit('SHARED_PRINTER', confirmation)
    const target = stage === 'firstEnable' ? await f.restart() : f
    const current = job()
    await target.profile.journal.recordClaimed(current)
    await target.profile.journal.recordTerminal(current, { state: 'SUCCEEDED', resultCode: 'SUBMITTED_TO_NETWORK_SOCKET',
      effectBoundary: 'CROSSED', physicalCompletionKnown: false })
    await target.profile.journal.markAbandoned(current.id, 1)
    const bytes = await readFile(target.profile.journal.filePath)
    await expect(stage === 'firstEnable' ? target.lifecycle.enable(confirmation)
      : target.lifecycle.convertAndExit('SHARED_PRINTER', confirmation)).rejects.toThrow('ADDON_COLD_LOCAL_WORK_UNSETTLED')
    expect(await readFile(target.profile.journal.filePath)).toEqual(bytes)
    expect(f.ports.start).not.toHaveBeenCalled()
  })

  it.each(['conversion', 'firstEnable'] as const)('rejects conflicting record/result effect evidence during %s without changing the journal', async stage => {
    const f = await fixture()
    if (stage === 'firstEnable') await f.lifecycle.convertAndExit('SHARED_PRINTER', confirmation)
    const target = stage === 'firstEnable' ? await f.restart() : f
    const current = job()
    await target.profile.journal.recordClaimed(current)
    await target.profile.journal.recordTerminal(current, { state: 'FAILED', resultCode: 'NETWORK_TCP_TIMEOUT',
      effectBoundary: 'CROSSING_UNKNOWN', physicalCompletionKnown: false })
    await target.profile.journal.markReported(current.id, 1)
    // Corrupt only this synthetic fixture's duplicated evidence, then exercise
    // the real durable reload in the same coordinator used by the main process.
    const file = JSON.parse(await readFile(target.profile.journal.filePath, 'utf8'))
    file.records[0].effectBoundary = 'NOT_CROSSED'
    await writeFile(target.profile.journal.filePath, JSON.stringify(file))
    const bytes = await readFile(target.profile.journal.filePath)
    await expect(stage === 'firstEnable' ? target.lifecycle.enable(confirmation)
      : target.lifecycle.convertAndExit('SHARED_PRINTER', confirmation)).rejects.toThrow('ADDON_COLD_LOCAL_WORK_UNSETTLED')
    expect(await readFile(target.profile.journal.filePath)).toEqual(bytes)
    expect(f.ports.start).not.toHaveBeenCalled()
  })

  it('permits a reported abandoned claim with no physical effect and preserves its original evidence', async () => {
    const f = await fixture(), current = job()
    await f.profile.journal.recordClaimed(current)
    await f.profile.journal.markAbandoned(current.id, 1)
    const bytes = await readFile(f.profile.journal.filePath)
    await f.lifecycle.convertAndExit('SHARED_PRINTER', confirmation)
    expect(await readFile(f.profile.journal.filePath)).toEqual(bytes)
    const next = await f.restart()
    await next.lifecycle.enable(confirmation)
    expect(f.ports.start).toHaveBeenCalledTimes(1)
  })

  it('rechecks the cloud after restart and blocks late old tasks before the first new-mode start', async () => {
    const f = await fixture()
    await f.lifecycle.convertAndExit('SHARED_PRINTER', confirmation)
    const next = await f.restart()
    f.ports.client.networkQueueState.mockResolvedValueOnce({ ...empty, pending: 1 })
    await expect(next.lifecycle.enable(confirmation)).rejects.toThrow('ADDON_COLD_CLOUD_WORK_PENDING')
    expect(next.profile.snapshot()).toMatchObject({ enabled: false, coldEnableCheckRequired: true })
    expect(f.ports.start).not.toHaveBeenCalled()
    f.ports.client.networkQueueState.mockRejectedValueOnce(new Error('ES_TRAY_02_NETWORK_ERROR'))
    await expect(next.lifecycle.enable(confirmation)).rejects.toThrow('ES_TRAY_02_NETWORK_ERROR')
    expect(f.ports.start).not.toHaveBeenCalled()
  })

  it('does not start after first converted enable persistence fails, and retains the required cold check', async () => {
    const f = await fixture()
    await f.lifecycle.convertAndExit('SHARED_PRINTER', confirmation)
    const next = await f.restart()
    vi.spyOn(next.profile, 'setEnabled').mockRejectedValueOnce(new Error('INJECTED_ENABLE_PERSIST_FAILURE'))
    await expect(next.lifecycle.enable(confirmation)).rejects.toThrow('INJECTED_ENABLE_PERSIST_FAILURE')
    expect(next.profile.snapshot()).toMatchObject({ enabled: false, coldEnableCheckRequired: true })
    expect(f.ports.start).not.toHaveBeenCalled()
    await next.lifecycle.enable(confirmation)
    expect(f.ports.start).toHaveBeenCalledTimes(1)
  })

  it('a partial poller start failure cannot be followed by a same-process cold conversion', async () => {
    const f = await fixture()
    f.ports.start.mockImplementationOnce(() => { throw new Error('INJECTED_START_FAILURE') })
    await expect(f.lifecycle.enable(confirmation)).rejects.toThrow('INJECTED_START_FAILURE')
    expect(f.lifecycle.everStartedPoller).toBe(true)
    await f.lifecycle.pause()
    await expect(f.lifecycle.convertAndExit('SHARED_PRINTER', confirmation)).rejects.toThrow('ADDON_COLD_PROCESS_RESTART_REQUIRED')
    expect(f.ports.exit).not.toHaveBeenCalled()
  })

  it('waits for the real poller prepare failure and terminal ACK before pause and exit', async () => {
    const f = await fixture()
    let entered!: () => void, release!: () => void
    const preparing = new Promise<void>(resolve => { entered = resolve })
    const proceed = new Promise<void>(resolve => { release = resolve })
    const markExecuting = vi.fn(async () => {}), reportResult = vi.fn(async () => {})
    const poller = new RelayPoller({ journal: f.profile.journal,
      client: { receive: vi.fn(async () => job()), markExecuting, reportResult },
      recorder: { record: vi.fn(async () => {}) },
      network: { prepare: async () => { entered(); await proceed; throw new Error('INJECTED_PREPARE_FAILURE') },
        failure: () => ({ resultCode: 'NETWORK_PREPARATION_FAILED', effectBoundary: 'NOT_CROSSED' }) } })
    const lifecycle = new ColdModeLifecycle({ profile: f.profile, ...f.ports, stopAndWait: () => poller.stopAndWait(),
      start: () => { poller.start() } })
    await lifecycle.enable(confirmation)
    await preparing
    const pause = lifecycle.pauseAndExit()
    await new Promise(resolve => setImmediate(resolve))
    expect(f.profile.snapshot().enabled).toBe(true)
    expect(f.ports.exit).not.toHaveBeenCalled()
    release()
    await pause
    expect(reportResult).toHaveBeenCalledTimes(1)
    expect(f.profile.journal.records()).toMatchObject([{ state: 'TERMINAL', reported: true, effectBoundary: 'NOT_CROSSED' }])
    expect(f.profile.snapshot().enabled).toBe(false)
    expect(f.ports.exit).toHaveBeenCalledTimes(1)
    expect(markExecuting).not.toHaveBeenCalled()
  })
})
