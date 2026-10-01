import { mkdtemp, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ControlPlaneProjection, ExecutionBatchProjection, V3ControlPlaneClient } from '../src/main/printing/controlPlaneClient'
import { V3ControlPlaneRuntime } from '../src/main/printing/controlPlaneRuntime'
import { createExecutionLedger } from '../src/main/printing/executionLedger'
import { hasDurableCrossingUnknown, V3PrintingRuntime } from '../src/main/printing/v3PrintingRuntime'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const batch = {
  id: 'batch-a', controlPlaneId: 'plane-a', tenantId: 'tenant-a', storeId: 'store-a', ownerDeviceId: 'device-a',
  ownerEpoch: 3, stateVersion: 7, leaseId: 'lease-a', mode: 'V3_ACTIVE' as const,
  expiresAt: '2099-01-01T00:00:00.000Z', revokedAt: null, createdAt: '2026-01-01T00:00:00.000Z',
}

const input = {
  source: 'LOCAL_DESKTOP' as const,
  orderNo: 'ORDER-1',
  role: 'FRONT' as const,
  identity: {
    printJobId: 'job-front-1', requestHash: 'a'.repeat(64), rendererVersion: 'renderer-1', expiresAt: '2099-01-01T00:00:00.000Z',
  },
  payload: new Uint8Array([1]),
}

function runtime(execute: () => Promise<any>) {
  const complete = vi.fn(async (_input: { releaseSafe: boolean }) => undefined)
  const controlPlane = {
    current: vi.fn(() => ({ status: 'V3_OWNER', controlPlane: { mode: 'V3_ACTIVE' }, batch })),
    beginExecutionLifecycle: vi.fn((_batch: typeof batch) => ({ ok: true as const, guard: { complete } })),
  }
  const coordinator = { execute: vi.fn(execute) }
  const endpoints = { configuredForRecovery: vi.fn(async () => ({ ok: true as const, endpoints: [
    { role: 'FRONT' as const, endpointKey: '192.168.1.10:9100' },
    { role: 'KITCHEN' as const, endpointKey: '192.168.1.11:9100' },
  ] })) }
  const endpointReadiness = { check: vi.fn(async () => ({ ok: true as const, roles: { FRONT: true, KITCHEN: true } })) }
  const instance = new (V3PrintingRuntime as any)(
    {}, coordinator, controlPlane, endpoints, {}, null, 60_000, { dispose: vi.fn() }, false, endpointReadiness,
  ) as V3PrintingRuntime
  ;(instance as any).running = true
  ;(instance as any).lifecycleGeneration = 1
  return { instance, controlPlane, coordinator, complete }
}

function rolePumpHarness(
  readiness: Array<{ FRONT: boolean; KITCHEN: boolean }>,
  initialJobs: Partial<Record<'FRONT' | 'KITCHEN', Array<{ printJobId: string }>>>,
  freshReadiness: Array<{ FRONT: boolean; KITCHEN: boolean }> = [],
) {
  const jobs = {
    FRONT: [...(initialJobs.FRONT ?? [])],
    KITCHEN: [...(initialJobs.KITCHEN ?? [])],
  }
  const controlPlane = {
    current: vi.fn(() => ({ status: 'V3_OWNER', controlPlane: { mode: 'V3_ACTIVE' }, batch })),
    validateExecution: vi.fn(() => ({ ok: true as const })),
    beginExecutionLifecycle: vi.fn(() => ({ ok: true as const, guard: { complete: vi.fn(async () => undefined) } })),
  }
  const endpoints = {
    configuredForRecovery: vi.fn(async () => ({ ok: true as const, endpoints: [
      { role: 'FRONT' as const, endpointKey: '192.168.1.10:9100' },
      { role: 'KITCHEN' as const, endpointKey: '192.168.1.11:9100' },
    ] })),
    resolve: vi.fn(async (role: 'FRONT' | 'KITCHEN') => ({ ok: true as const,
      endpointKey: role === 'FRONT' ? '192.168.1.10:9100' : '192.168.1.11:9100' })),
  }
  let activeReadiness = { FRONT: false, KITCHEN: false }
  const endpointReadiness = { check: vi.fn(async (probed: Array<{ role: 'FRONT' | 'KITCHEN' }>) => {
    if (probed.length > 1) activeReadiness = readiness.shift() ?? { FRONT: false, KITCHEN: false }
    const current = probed.length === 1 && freshReadiness.length > 0 ? freshReadiness.shift()! : activeReadiness
    return { ok: true as const, roles: { ...current } }
  }) }
  const receive = vi.fn(async (_batch: typeof batch, role: 'FRONT' | 'KITCHEN') => {
    const selected = jobs[role].shift()
    return selected ? { ok: true as const, job: {
      printJobId: selected.printJobId, source: 'CLOUD_H5' as const, role,
      rendererVersion: 'renderer-1', expiresAt: batch.expiresAt,
      payloadKind: 'RAW_BYTES' as const, payload: new Uint8Array([role === 'FRONT' ? 1 : 2]),
    } } : { ok: true as const, job: null }
  })
  const cloud = { receive, report: vi.fn(), holdLocal: vi.fn() }
  const coordinator = { execute: vi.fn(async (_value: { role: 'FRONT' | 'KITCHEN' }) => ({
    status: 'CROSSED', record: { state: 'CROSSED' },
  })) }
  const instance = new (V3PrintingRuntime as any)(
    { close: vi.fn(async () => ({ ok: true as const })) }, coordinator, controlPlane, endpoints,
    { listReportable: vi.fn(() => []) }, cloud, 60_000, { dispose: vi.fn() }, false, endpointReadiness, 0,
  ) as V3PrintingRuntime
  ;(instance as any).running = true
  ;(instance as any).lifecycleGeneration = 1
  const pump = async () => {
    await (instance as any).pump()
  }
  return { instance, jobs, receive, coordinator, endpointReadiness, pump }
}

describe('V3PrintingRuntime execution lifecycle', () => {
  it('recovers store authority independently and receives only a ready FRONT role while KITCHEN is unavailable', async () => {
    let readiness!: () => Promise<{ ok: true } | { ok: false; reason: string }>
    const complete = vi.fn(async () => undefined)
    const controlPlane = {
      current: vi.fn(() => ({ status: 'V3_OWNER', controlPlane: { mode: 'V3_ACTIVE' }, batch })),
      validateExecution: vi.fn(() => ({ ok: true as const })),
      markExecutionLifecycleReady: vi.fn(async (inputValue: any) => { readiness = inputValue.expiredSelfRecoveryReadiness }),
      beginExecutionLifecycle: vi.fn(() => ({ ok: true as const, guard: { complete } })),
    }
    const endpoints = {
      configuredForRecovery: vi.fn(async () => ({ ok: true as const, endpoints: [
        { role: 'FRONT' as const, endpointKey: '192.168.1.10:9100' },
        { role: 'KITCHEN' as const, endpointKey: '192.168.1.11:9100' },
      ] })),
      resolve: vi.fn(async (role: 'FRONT' | 'KITCHEN') => ({ ok: true as const,
        endpointKey: role === 'FRONT' ? '192.168.1.10:9100' : '192.168.1.11:9100' })),
    }
    const endpointReadiness = { check: vi.fn(async () => ({
      ok: true as const, roles: { FRONT: true, KITCHEN: false },
    })) }
    let delivered = false
    const cloud = {
      receive: vi.fn(async (_batch: typeof batch, role: 'FRONT' | 'KITCHEN') => {
        if (role !== 'FRONT' || delivered) return { ok: true as const, job: null }
        delivered = true
        return { ok: true as const, job: {
          printJobId: 'job-front-ready', source: 'CLOUD_H5' as const, role: 'FRONT' as const,
          rendererVersion: 'renderer-1', expiresAt: batch.expiresAt,
          payloadKind: 'RAW_BYTES' as const, payload: new Uint8Array([1]),
        } }
      }),
      report: vi.fn(), holdLocal: vi.fn(),
    }
    const coordinator = { execute: vi.fn(async () => ({ status: 'CROSSED', record: { state: 'CROSSED' } })) }
    const instance = new (V3PrintingRuntime as any)(
      { close: vi.fn(async () => ({ ok: true as const })) }, coordinator, controlPlane, endpoints,
      { listReportable: vi.fn(() => []) }, cloud, 60_000, { dispose: vi.fn() }, false, endpointReadiness,
    ) as V3PrintingRuntime

    await instance.start()
    await expect(readiness()).resolves.toEqual({ ok: true })
    await vi.waitFor(() => expect(coordinator.execute).toHaveBeenCalledTimes(1))
    expect(cloud.receive).toHaveBeenCalledTimes(1)
    expect(cloud.receive).toHaveBeenCalledWith(batch, 'FRONT')
    expect(cloud.receive).not.toHaveBeenCalledWith(batch, 'KITCHEN')
    expect(coordinator.execute).toHaveBeenCalledWith(expect.objectContaining({ role: 'FRONT' }))
    expect(endpointReadiness.check).toHaveBeenCalledWith([
      { role: 'FRONT', endpointKey: '192.168.1.10:9100' },
      { role: 'KITCHEN', endpointKey: '192.168.1.11:9100' },
    ])
    await instance.close()
  })

  it('blocks expired-self recovery before endpoint loading when local effect ambiguity exists', async () => {
    let readiness!: () => Promise<{ ok: true } | { ok: false; reason: string }>
    const controlPlane = {
      current: vi.fn(() => ({ status: 'FENCED', controlPlane: { mode: 'V3_ACTIVE' }, batch: null })),
      validateExecution: vi.fn(() => ({ ok: false as const })),
      markExecutionLifecycleReady: vi.fn(async (inputValue: any) => { readiness = inputValue.expiredSelfRecoveryReadiness }),
    }
    const endpoints = { configuredForRecovery: vi.fn() }
    const endpointReadiness = { check: vi.fn() }
    const instance = new (V3PrintingRuntime as any)(
      { close: vi.fn(async () => ({ ok: true as const })) }, { execute: vi.fn() }, controlPlane, endpoints,
      { listReportable: vi.fn(() => []) }, null, 60_000, { dispose: vi.fn() }, true, endpointReadiness,
    ) as V3PrintingRuntime
    await instance.start()
    await expect(readiness()).resolves.toEqual({ ok: false, reason: 'LOCAL_EFFECT_AMBIGUITY' })
    expect(endpoints.configuredForRecovery).not.toHaveBeenCalled()
    expect(endpointReadiness.check).not.toHaveBeenCalled()
    await instance.close()
  })

  it('cancels an in-flight role-readiness result when printing closes', async () => {
    let readiness!: () => Promise<{ ok: true } | { ok: false; reason: string }>
    let finishProbe!: () => void
    const controlPlane = {
      current: vi.fn(() => ({ status: 'FENCED', controlPlane: { mode: 'V3_ACTIVE' }, batch: null })),
      validateExecution: vi.fn(() => ({ ok: false as const })),
      markExecutionLifecycleReady: vi.fn(async (inputValue: any) => { readiness = inputValue.expiredSelfRecoveryReadiness }),
    }
    const endpoints = { configuredForRecovery: vi.fn(async () => ({ ok: true as const, endpoints: [
      { role: 'FRONT' as const, endpointKey: '192.168.1.10:9100' },
    ] })) }
    const endpointReadiness = { check: vi.fn(() => new Promise<{ ok: true; roles: { FRONT: boolean; KITCHEN: boolean } }>((resolve) => {
      finishProbe = () => resolve({ ok: true, roles: { FRONT: true, KITCHEN: false } })
    })) }
    const ledger = { close: vi.fn(async () => ({ ok: true as const })) }
    const instance = new (V3PrintingRuntime as any)(
      ledger, { execute: vi.fn() }, controlPlane, endpoints, { listReportable: vi.fn(() => []) },
      null, 60_000, { dispose: vi.fn() }, false, endpointReadiness,
    ) as V3PrintingRuntime

    const starting = instance.start()
    await vi.waitFor(() => expect(endpointReadiness.check).toHaveBeenCalledTimes(1))
    const closing = instance.close()
    finishProbe()

    await Promise.all([starting, closing])
    await expect(readiness()).resolves.toEqual({ ok: false, reason: 'RUNTIME_STOPPED' })
    expect((instance as any).roleReadiness).toEqual({ FRONT: false, KITCHEN: false })
    expect(ledger.close).toHaveBeenCalledTimes(1)
  })

  it('allows KITCHEN to execute while FRONT is unavailable and leaves FRONT unclaimed', async () => {
    const harness = rolePumpHarness(
      [{ FRONT: false, KITCHEN: true }],
      { FRONT: [{ printJobId: 'job-front-pending' }], KITCHEN: [{ printJobId: 'job-kitchen-ready' }] },
    )
    await harness.pump()
    expect(harness.receive).toHaveBeenCalledTimes(1)
    expect(harness.receive).toHaveBeenCalledWith(batch, 'KITCHEN')
    expect(harness.coordinator.execute).toHaveBeenCalledWith(expect.objectContaining({ role: 'KITCHEN' }))
    expect(harness.jobs.FRONT).toHaveLength(1)
  })

  it('does not claim a role when its endpoint drops after cached readiness but before receive', async () => {
    const harness = rolePumpHarness(
      [{ FRONT: true, KITCHEN: false }],
      { FRONT: [{ printJobId: 'job-front-readiness-race' }] },
      [{ FRONT: false, KITCHEN: false }],
    )
    await harness.pump()
    expect(harness.receive).not.toHaveBeenCalled()
    expect(harness.coordinator.execute).not.toHaveBeenCalled()
    expect(harness.jobs.FRONT).toHaveLength(1)
  })

  it('prints FRONT once, then executes only the pending KITCHEN effect after KITCHEN becomes ready', async () => {
    const harness = rolePumpHarness(
      [{ FRONT: true, KITCHEN: false }, { FRONT: true, KITCHEN: true }],
      { FRONT: [{ printJobId: 'job-front-once' }], KITCHEN: [{ printJobId: 'job-kitchen-later' }] },
    )
    await harness.pump()
    expect(harness.coordinator.execute.mock.calls.map(([value]) => value.role)).toEqual(['FRONT'])
    expect(harness.receive.mock.calls.map(([, role]) => role)).toEqual(['FRONT'])

    await harness.pump()
    expect(harness.coordinator.execute.mock.calls.map(([value]) => value.role)).toEqual(['FRONT', 'KITCHEN'])
    expect(harness.coordinator.execute.mock.calls.filter(([value]) => value.role === 'FRONT')).toHaveLength(1)
    expect(harness.jobs.FRONT).toHaveLength(0)
    expect(harness.jobs.KITCHEN).toHaveLength(0)
  })

  it('preserves normal FRONT and KITCHEN execution when both roles are ready', async () => {
    const harness = rolePumpHarness(
      [{ FRONT: true, KITCHEN: true }],
      { FRONT: [{ printJobId: 'job-front-both' }], KITCHEN: [{ printJobId: 'job-kitchen-both' }] },
    )
    await harness.pump()
    expect(harness.coordinator.execute.mock.calls.map(([value]) => value.role)).toEqual(['FRONT', 'KITCHEN'])
  })

  it('keeps store authority valid but performs no receive when both roles are unavailable', async () => {
    const harness = rolePumpHarness(
      [{ FRONT: false, KITCHEN: false }],
      { FRONT: [{ printJobId: 'job-front-offline' }], KITCHEN: [{ printJobId: 'job-kitchen-offline' }] },
    )
    await harness.pump()
    expect(harness.receive).not.toHaveBeenCalled()
    expect(harness.coordinator.execute).not.toHaveBeenCalled()
    expect(harness.jobs.FRONT).toHaveLength(1)
    expect(harness.jobs.KITCHEN).toHaveLength(1)
  })

  it('does not poll an unavailable flapping KITCHEN role or duplicate its completed execution', async () => {
    const harness = rolePumpHarness(
      [
        { FRONT: false, KITCHEN: false },
        { FRONT: false, KITCHEN: true },
        { FRONT: false, KITCHEN: false },
      ],
      { KITCHEN: [{ printJobId: 'job-kitchen-flap' }] },
    )
    await harness.pump()
    await harness.pump()
    await harness.pump()
    expect(harness.receive).toHaveBeenCalledTimes(1)
    expect(harness.receive).toHaveBeenCalledWith(batch, 'KITCHEN')
    expect(harness.coordinator.execute).toHaveBeenCalledTimes(1)
  })

  it.each(['FRONT', 'KITCHEN'] as const)('durably HOLDS no-batch local %s admission without starting physical execution', async (role) => {
    const cloud = { holdLocal: vi.fn(async () => 'DURABLY_HELD' as const) }
    const controlPlane = {
      current: vi.fn(() => ({ status: 'FENCED', controlPlane: { mode: 'V3_ACTIVE' }, batch: null })),
      beginExecutionLifecycle: vi.fn(),
    }
    const coordinator = { execute: vi.fn() }
    const endpoints = { resolve: vi.fn() }
    const instance = new (V3PrintingRuntime as any)(
      {}, coordinator, controlPlane, endpoints, {}, cloud, 60_000, { dispose: vi.fn() },
    ) as V3PrintingRuntime

    await expect(instance.execute({ ...input, role })).resolves.toEqual({
      status: 'HELD', admission: 'DURABLY_ACCEPTED', durability: 'DURABLY_HELD',
    })
    expect(cloud.holdLocal).toHaveBeenCalledWith(expect.objectContaining({
      orderNo: input.orderNo, printJobId: input.identity.printJobId, role,
    }))
    expect(endpoints.resolve).not.toHaveBeenCalled()
    expect(controlPlane.beginExecutionLifecycle).not.toHaveBeenCalled()
    expect(coordinator.execute).not.toHaveBeenCalled()
  })

  it('issues operator recovery proof only when the exact canonical job has no local ledger record', async () => {
    const orderNo = 'ORDER-RECOVERY-001'
    const role = 'KITCHEN' as const
    const originalJobId = `network:${createHash('sha256').update(`cashier-network-v2:${orderNo}:${role}`).digest('hex')}`
    const proof = `v3orp1.${Buffer.from('{}').toString('base64url')}.${'a'.repeat(64)}`
    const ledger = { get: vi.fn(async () => ({ ok: true as const, value: { found: false as const } })) }
    const cloud = { readOperatorRecoveryProof: vi.fn(async () => proof) }
    const instance = new (V3PrintingRuntime as any)(
      ledger, {}, {}, {}, {}, cloud, 60_000, { dispose: vi.fn() },
    ) as V3PrintingRuntime
    ;(instance as any).running = true

    await expect(instance.readOperatorRecoveryProof({ orderNo, originalJobId, role })).resolves.toEqual({
      state: 'DEFINITELY_NOT_PRINTED', recoveryProof: proof,
    })
    expect(cloud.readOperatorRecoveryProof).toHaveBeenCalledWith({ orderNo, originalJobId, role })
  })

  it('keeps existing local execution evidence ambiguous and never requests a server proof', async () => {
    const orderNo = 'ORDER-RECOVERY-002'
    const role = 'FRONT' as const
    const originalJobId = `network:${createHash('sha256').update(`cashier-network-v2:${orderNo}:${role}`).digest('hex')}`
    const ledger = { get: vi.fn(async () => ({ ok: true as const, value: { found: true as const, record: { state: 'CROSSED' } } })) }
    const cloud = { readOperatorRecoveryProof: vi.fn() }
    const instance = new (V3PrintingRuntime as any)(
      ledger, {}, {}, {}, {}, cloud, 60_000, { dispose: vi.fn() },
    ) as V3PrintingRuntime
    ;(instance as any).running = true

    await expect(instance.readOperatorRecoveryProof({ orderNo, originalJobId, role })).resolves.toEqual({ state: 'AMBIGUOUS' })
    expect(cloud.readOperatorRecoveryProof).not.toHaveBeenCalled()
  })

  it('recovers a durable UNKNOWN across restart before control-plane release can become ready', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'v3-printing-runtime-'))
    roots.push(directory)
    expect(await hasDurableCrossingUnknown(directory)).toBe(false)
    const ledger = createExecutionLedger({ userDataPath: directory })
    expect((await ledger.open()).ok).toBe(true)
    const accepted = await ledger.accept({
      printJobId: 'job-restart-unknown', requestHash: 'a'.repeat(64), rendererVersion: 'renderer-1', expiresAt: '2099-01-01T00:00:00.000Z',
    })
    expect(accepted.ok).toBe(true)
    if (accepted.ok) {
      expect((await ledger.beginCrossing({
        printJobId: accepted.value.record.printJobId,
        expectedExecutionId: accepted.value.record.executionId,
        expectedStateVersion: accepted.value.record.stateVersion,
      })).ok).toBe(true)
    }
    expect((await ledger.close()).ok).toBe(true)
    expect(await hasDurableCrossingUnknown(directory)).toBe(true)
  })

  it('signals real execution start and safe completion without changing the normal V3 result', async () => {
    const record = { printJobId: input.identity.printJobId, executionId: 'execution-a', state: 'CROSSED', stateVersion: 3, physicalCompletionKnown: false }
    const harness = runtime(async () => ({ status: 'CROSSED', record }))

    await expect(harness.instance.execute(input)).resolves.toEqual({ status: 'CROSSED', record, admission: 'DURABLY_ACCEPTED' })
    expect(harness.controlPlane.beginExecutionLifecycle).toHaveBeenCalledWith(batch)
    expect(harness.coordinator.execute).toHaveBeenCalledTimes(1)
    expect(harness.complete).toHaveBeenCalledWith({ releaseSafe: true })
  })

  it('keeps the exact admitted KITCHEN batch valid at second pre-effect validation across renewal', async () => {
    const authorityN: ControlPlaneProjection = {
      id: 'plane-a', tenantId: 'tenant-a', storeId: 'store-a', ownerDeviceId: 'device-a', ownerEpoch: 3,
      leaseId: 'lease-a', leaseExpiresAt: batch.expiresAt, mode: 'V3_ACTIVE', stateVersion: 7,
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const authorityN1 = { ...authorityN, stateVersion: 8, updatedAt: '2026-01-01T00:00:30.000Z' }
    const projection = (controlPlane: ControlPlaneProjection, id: string): ExecutionBatchProjection => ({
      ...batch, id, stateVersion: controlPlane.stateVersion,
    })
    const api = {
      read: vi.fn(async () => ({ ok: true as const, controlPlane: authorityN })),
      acquire: vi.fn(),
      renew: vi.fn(async (controlPlane: ControlPlaneProjection) => ({ ok: true as const, controlPlane })),
      release: vi.fn(async (controlPlane: ControlPlaneProjection) => ({ ok: true as const, controlPlane })),
      issueBatch: vi.fn(async (controlPlane: ControlPlaneProjection) => ({
        ok: true as const,
        batch: projection(controlPlane, controlPlane.stateVersion === 7 ? 'batch-n' : 'batch-n-plus-1'),
      })),
    }
    const controlPlane = new V3ControlPlaneRuntime(api as unknown as V3ControlPlaneClient, 'device-a', 60_000)
    await controlPlane.start()
    await controlPlane.markExecutionLifecycleReady()

    let executionStarted!: () => void
    let continueExecution!: () => void
    const started = new Promise<void>((resolve) => { executionStarted = resolve })
    const continueAfterRenewal = new Promise<void>((resolve) => { continueExecution = resolve })
    const coordinator = { execute: vi.fn(async ({ authority }: any) => {
      expect(controlPlane.validateAdmittedExecution(authority).ok).toBe(true)
      executionStarted()
      await continueAfterRenewal
      expect(controlPlane.validateAdmittedExecution(authority).ok).toBe(true)
      return { status: 'CROSSED', record: { state: 'CROSSED' } }
    }) }
    const endpoints = { configuredForRecovery: vi.fn(async () => ({ ok: true as const, endpoints: [
      { role: 'KITCHEN' as const, endpointKey: '192.168.1.11:9100' },
    ] })) }
    const endpointReadiness = { check: vi.fn(async () => ({ ok: true as const, roles: { FRONT: false, KITCHEN: true } })) }
    const instance = new (V3PrintingRuntime as any)(
      {}, coordinator, controlPlane, endpoints,
      {}, null, 60_000, { dispose: vi.fn() }, false, endpointReadiness,
    ) as V3PrintingRuntime
    ;(instance as any).running = true
    ;(instance as any).lifecycleGeneration = 1
    const kitchenInput = {
      ...input,
      role: 'KITCHEN' as const,
      identity: { ...input.identity, printJobId: 'job-kitchen-field-regression' },
    }
    const execution = instance.execute(kitchenInput)
    await started

    api.read.mockResolvedValueOnce({ ok: true, controlPlane: authorityN })
    api.renew.mockResolvedValueOnce({ ok: true, controlPlane: authorityN1 })
    await (controlPlane as any).reconcile()
    expect(controlPlane.current().batch?.id).toBe('batch-n')

    continueExecution()
    await expect(execution).resolves.toMatchObject({ status: 'CROSSED', admission: 'DURABLY_ACCEPTED' })
    expect(controlPlane.current().batch?.id).toBe('batch-n-plus-1')

    await instance.execute({
      ...kitchenInput,
      identity: { ...kitchenInput.identity, printJobId: 'job-kitchen-after-renewal' },
    })
    expect(coordinator.execute).toHaveBeenLastCalledWith(expect.objectContaining({
      authority: expect.objectContaining({ batchId: 'batch-n-plus-1' }),
    }))
    await controlPlane.stop()
  })

  it('does not signal completion until coordinator.execute has actually exited', async () => {
    let resolve!: (value: unknown) => void
    const pending = new Promise((done) => { resolve = done })
    const harness = runtime(async () => pending)
    const execution = harness.instance.execute(input)

    await vi.waitFor(() => expect(harness.coordinator.execute).toHaveBeenCalledTimes(1))
    expect(harness.complete).not.toHaveBeenCalled()
    resolve({ status: 'FAILED_NOT_CROSSED', record: { state: 'FAILED_NOT_CROSSED' } })
    await execution
    expect(harness.complete).toHaveBeenCalledWith({ releaseSafe: true })
  })

  it('exits the lifecycle guard but remains fail closed when coordinator.execute throws', async () => {
    const failure = new Error('coordinator failed')
    const harness = runtime(async () => { throw failure })

    await expect(harness.instance.execute(input)).rejects.toBe(failure)
    expect(harness.complete).toHaveBeenCalledTimes(1)
    expect(harness.complete).toHaveBeenCalledWith({ releaseSafe: false })
  })

  it('preserves CROSSING_UNKNOWN and marks it unsafe for owner release', async () => {
    const record = { printJobId: input.identity.printJobId, executionId: 'execution-a', state: 'CROSSING_UNKNOWN', stateVersion: 2, physicalCompletionKnown: false }
    const harness = runtime(async () => ({ status: 'CROSSING_UNKNOWN', record, reason: 'TIMEOUT' }))

    await expect(harness.instance.execute(input)).resolves.toEqual({
      status: 'CROSSING_UNKNOWN', record, reason: 'TIMEOUT', admission: 'DURABLY_ACCEPTED',
    })
    expect(harness.complete).toHaveBeenCalledWith({ releaseSafe: false })
  })

  it('keeps an existing UNKNOWN tombstone unsafe when execution is deduplicated as NOT_EXECUTED', async () => {
    const record = { printJobId: input.identity.printJobId, executionId: 'execution-a', state: 'CROSSING_UNKNOWN', stateVersion: 2, physicalCompletionKnown: false }
    const harness = runtime(async () => ({ status: 'NOT_EXECUTED', record, reason: 'EXISTING_NON_EXECUTABLE' }))

    await expect(harness.instance.execute(input)).resolves.toMatchObject({
      status: 'NOT_EXECUTED', record: { state: 'CROSSING_UNKNOWN' }, admission: 'DURABLY_ACCEPTED',
    })
    expect(harness.complete).toHaveBeenCalledWith({ releaseSafe: false })
  })

  it('rejects before coordinator admission when the lifecycle guard is fenced', async () => {
    const harness = runtime(async () => ({ status: 'CROSSED' }))
    harness.controlPlane.beginExecutionLifecycle.mockReturnValueOnce({
      ok: false as const,
      error: { code: 'CONTROL_PLANE_FENCED', message: 'fenced' },
    } as never)

    await expect(harness.instance.execute(input)).resolves.toEqual({
      status: 'AUTHORITY_REJECTED', mode: 'FENCED', reason: 'CONTROL_PLANE_FENCED',
    })
    expect(harness.coordinator.execute).not.toHaveBeenCalled()
    expect(harness.complete).not.toHaveBeenCalled()
  })
})
