import { mkdtemp, rm } from 'node:fs/promises'
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
  const endpoints = { resolve: vi.fn(async () => ({ ok: true as const, endpointKey: '192.168.1.10:9100' })) }
  const instance = new (V3PrintingRuntime as any)(
    {}, coordinator, controlPlane, endpoints, {}, null, 60_000, { dispose: vi.fn() },
  ) as V3PrintingRuntime
  return { instance, controlPlane, coordinator, complete }
}

describe('V3PrintingRuntime execution lifecycle', () => {
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
    const instance = new (V3PrintingRuntime as any)(
      {}, coordinator, controlPlane,
      { resolve: vi.fn(async () => ({ ok: true as const, endpointKey: '192.168.1.11:9100' })) },
      {}, null, 60_000, { dispose: vi.fn() },
    ) as V3PrintingRuntime
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
