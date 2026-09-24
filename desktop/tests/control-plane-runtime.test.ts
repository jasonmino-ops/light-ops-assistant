import { describe, expect, it, vi } from 'vitest'
import type { V3ControlPlaneClient, ControlPlaneProjection, ExecutionBatchProjection } from '../src/main/printing/controlPlaneClient'
import { V3ControlPlaneRuntime } from '../src/main/printing/controlPlaneRuntime'

const future = '2099-01-01T00:00:00.000Z'
function plane(overrides: Partial<ControlPlaneProjection> = {}): ControlPlaneProjection {
  return {
    id: 'plane-a', tenantId: 'tenant-a', storeId: 'store-a', ownerDeviceId: null,
    ownerEpoch: 0, leaseId: null, leaseExpiresAt: null, mode: 'V2_ACTIVE', stateVersion: 1,
    updatedAt: '2026-01-01T00:00:00.000Z', ...overrides,
  }
}
function batch(controlPlane: ControlPlaneProjection): ExecutionBatchProjection {
  return {
    id: 'batch-a', controlPlaneId: controlPlane.id, tenantId: controlPlane.tenantId, storeId: controlPlane.storeId,
    ownerDeviceId: controlPlane.ownerDeviceId!, ownerEpoch: controlPlane.ownerEpoch, stateVersion: controlPlane.stateVersion,
    leaseId: controlPlane.leaseId!, mode: 'V3_ACTIVE', expiresAt: future, revokedAt: null, createdAt: '2026-01-01T00:00:00.000Z',
  }
}

function client(initial: ControlPlaneProjection, acquired = initial) {
  const api = {
    read: vi.fn(async () => ({ ok: true as const, controlPlane: initial })),
    acquire: vi.fn(async () => ({ ok: true as const, controlPlane: acquired })),
    renew: vi.fn(async () => ({ ok: true as const, controlPlane: acquired })),
    release: vi.fn(async (authority: ControlPlaneProjection) => ({ ok: true as const, controlPlane: {
      ...authority, ownerDeviceId: null, leaseId: null, leaseExpiresAt: null, mode: 'BLOCKED_UNKNOWN' as const,
      stateVersion: authority.stateVersion + 1,
    } })),
    issueBatch: vi.fn(async () => ({ ok: true as const, batch: batch(acquired) })),
  }
  return api as unknown as V3ControlPlaneClient & typeof api
}

describe('V3ControlPlaneRuntime', () => {
  it('preserves authoritative V2 mode without trying to acquire V3', async () => {
    const api = client(plane())
    const runtime = new V3ControlPlaneRuntime(api, 'device-a', 60_000)
    await runtime.start()
    await runtime.markExecutionLifecycleReady()
    expect(runtime.current().status).toBe('V2_ACTIVE')
    expect(api.acquire).not.toHaveBeenCalled()
    await runtime.stop()
  })

  it('acquires only an unowned V3 state and requires an owner-scoped batch', async () => {
    const owned = plane({ ownerDeviceId: 'device-a', ownerEpoch: 1, leaseId: 'lease-a', leaseExpiresAt: future, mode: 'V3_ACTIVE', stateVersion: 2 })
    const api = client(plane({ mode: 'V3_ACTIVE' }), owned)
    const runtime = new V3ControlPlaneRuntime(api, 'device-a', 60_000)
    await runtime.start()
    await runtime.markExecutionLifecycleReady()
    expect(api.acquire).toHaveBeenCalledTimes(1)
    expect(runtime.current()).toMatchObject({ status: 'V3_OWNER', controlPlane: { ownerEpoch: 1 }, batch: { ownerEpoch: 1 } })
    expect(runtime.validateExecution().ok).toBe(true)
    await runtime.stop()
    expect(api.release).toHaveBeenCalledTimes(1)
  })

  it('fails closed for another owner and never acquires over it', async () => {
    const api = client(plane({ ownerDeviceId: 'device-b', ownerEpoch: 4, leaseId: 'lease-b', leaseExpiresAt: future, mode: 'V3_ACTIVE', stateVersion: 8 }))
    const runtime = new V3ControlPlaneRuntime(api, 'device-a', 60_000)
    await runtime.start()
    await runtime.markExecutionLifecycleReady()
    expect(runtime.current().status).toBe('FENCED')
    expect(api.acquire).not.toHaveBeenCalled()
    expect(runtime.validateExecution()).toMatchObject({ ok: false, error: { code: 'CONTROL_PLANE_FENCED' } })
    await runtime.stop()
  })

  it('restart reconciles the same owner through fenced renewal before issuing a batch', async () => {
    const owned = plane({ ownerDeviceId: 'device-a', ownerEpoch: 7, leaseId: 'lease-a', leaseExpiresAt: future, mode: 'V3_ACTIVE', stateVersion: 12 })
    const api = client(owned)
    const runtime = new V3ControlPlaneRuntime(api, 'device-a', 60_000)
    await runtime.start()
    await runtime.markExecutionLifecycleReady()
    expect(api.renew).toHaveBeenCalledWith(owned)
    expect(api.issueBatch).toHaveBeenCalledTimes(1)
    expect(runtime.current().status).toBe('V3_OWNER')
    await runtime.stop()
  })

  it('keeps an already issued execution batch through a short lease renewal failure until Grace expires', async () => {
    const owned = plane({ ownerDeviceId: 'device-a', ownerEpoch: 7, leaseId: 'lease-a', leaseExpiresAt: future, mode: 'V3_ACTIVE', stateVersion: 12 })
    const api = client(owned)
    const runtime = new V3ControlPlaneRuntime(api, 'device-a', 60_000)
    await runtime.start()
    await runtime.markExecutionLifecycleReady()
    api.renew.mockResolvedValueOnce({ ok: false, code: 'AUTHORITY_STALE_OR_EXPIRED' } as never)
    await (runtime as any).reconcile()
    expect(runtime.current().status).toBe('V3_OWNER')
    expect(runtime.validateExecution().ok).toBe(true)
    await runtime.stop()
  })

  it('fences admission and releases a current owner on V3_DRAINING when no execution is in flight', async () => {
    const owned = plane({ ownerDeviceId: 'device-a', ownerEpoch: 2, leaseId: 'lease-a', leaseExpiresAt: future, mode: 'V3_DRAINING', stateVersion: 5 })
    const api = client(owned)
    const runtime = new V3ControlPlaneRuntime(api, 'device-a', 60_000)
    await runtime.start()
    expect(api.release).not.toHaveBeenCalled()
    expect(runtime.validateExecution().ok).toBe(false)
    await runtime.markExecutionLifecycleReady()
    expect(api.release).toHaveBeenCalledTimes(1)
    expect(runtime.current()).toMatchObject({ status: 'BLOCKED_UNKNOWN', controlPlane: { ownerDeviceId: null, mode: 'BLOCKED_UNKNOWN' }, batch: null })
    await runtime.stop()
  })

  it('waits for the real in-flight execution lifecycle before releasing while draining', async () => {
    const owned = plane({ ownerDeviceId: 'device-a', ownerEpoch: 3, leaseId: 'lease-a', leaseExpiresAt: future, mode: 'V3_ACTIVE', stateVersion: 6 })
    const draining = { ...owned, mode: 'V3_DRAINING' as const, stateVersion: 7 }
    const api = client(owned)
    const runtime = new V3ControlPlaneRuntime(api, 'device-a', 60_000)
    await runtime.start()
    await runtime.markExecutionLifecycleReady()
    const lifecycle = runtime.beginExecutionLifecycle()
    expect(lifecycle.ok).toBe(true)

    api.read.mockResolvedValueOnce({ ok: true, controlPlane: draining })
    await (runtime as any).reconcile()
    expect(api.release).not.toHaveBeenCalled()
    expect(runtime.validateExecution().ok).toBe(false)
    expect(runtime.beginExecutionLifecycle().ok).toBe(false)

    if (lifecycle.ok) await lifecycle.guard.complete({ releaseSafe: true })
    expect(api.release).toHaveBeenCalledTimes(1)
    await runtime.stop()
  })

  it('releases only after the final concurrent execution exits', async () => {
    const owned = plane({ ownerDeviceId: 'device-a', ownerEpoch: 4, leaseId: 'lease-a', leaseExpiresAt: future, mode: 'V3_ACTIVE', stateVersion: 8 })
    const api = client(owned)
    const runtime = new V3ControlPlaneRuntime(api, 'device-a', 60_000)
    await runtime.start()
    await runtime.markExecutionLifecycleReady()
    const first = runtime.beginExecutionLifecycle()
    const second = runtime.beginExecutionLifecycle()
    expect(first.ok && second.ok).toBe(true)

    api.read.mockResolvedValueOnce({ ok: true, controlPlane: { ...owned, mode: 'V3_DRAINING', stateVersion: 9 } })
    await (runtime as any).reconcile()
    if (first.ok) await first.guard.complete({ releaseSafe: true })
    expect(api.release).not.toHaveBeenCalled()
    if (second.ok) await second.guard.complete({ releaseSafe: true })
    expect(api.release).toHaveBeenCalledTimes(1)
    await runtime.stop()
  })

  it('removes a completed guard but remains fail closed after an unsafe or ambiguous completion', async () => {
    const owned = plane({ ownerDeviceId: 'device-a', ownerEpoch: 5, leaseId: 'lease-a', leaseExpiresAt: future, mode: 'V3_ACTIVE', stateVersion: 10 })
    const api = client(owned)
    const runtime = new V3ControlPlaneRuntime(api, 'device-a', 60_000)
    await runtime.start()
    await runtime.markExecutionLifecycleReady()
    const lifecycle = runtime.beginExecutionLifecycle()
    expect(lifecycle.ok).toBe(true)

    api.read.mockResolvedValueOnce({ ok: true, controlPlane: { ...owned, mode: 'V3_DRAINING', stateVersion: 11 } })
    await (runtime as any).reconcile()
    if (lifecycle.ok) {
      await lifecycle.guard.complete({ releaseSafe: false })
      await lifecycle.guard.complete({ releaseSafe: true })
    }
    expect(api.release).not.toHaveBeenCalled()
    expect(runtime.beginExecutionLifecycle().ok).toBe(false)
    await runtime.stop()
    expect(api.release).not.toHaveBeenCalled()
  })

  it('restart in V3_DRAINING never reacquires and releases only after printing lifecycle recovery is ready', async () => {
    const draining = plane({ ownerDeviceId: 'device-a', ownerEpoch: 6, leaseId: 'lease-a', leaseExpiresAt: future, mode: 'V3_DRAINING', stateVersion: 12 })
    const api = client(draining)
    const runtime = new V3ControlPlaneRuntime(api, 'device-a', 60_000)
    await runtime.start()
    expect(api.acquire).not.toHaveBeenCalled()
    expect(api.renew).not.toHaveBeenCalled()
    expect(api.issueBatch).not.toHaveBeenCalled()
    expect(api.release).not.toHaveBeenCalled()
    await runtime.markExecutionLifecycleReady()
    expect(api.release).toHaveBeenCalledTimes(1)
    await runtime.stop()
  })

  it('restart preserves a recovered durable UNKNOWN as a release blocker', async () => {
    const draining = plane({ ownerDeviceId: 'device-a', ownerEpoch: 6, leaseId: 'lease-a', leaseExpiresAt: future, mode: 'V3_DRAINING', stateVersion: 12 })
    const api = client(draining)
    const runtime = new V3ControlPlaneRuntime(api, 'device-a', 60_000)
    await runtime.start()
    await runtime.markExecutionLifecycleReady({ releaseBlocked: true })
    expect(api.release).not.toHaveBeenCalled()
    expect(runtime.validateExecution().ok).toBe(false)
    await runtime.stop()
    expect(api.release).not.toHaveBeenCalled()
  })

  it('fences admission synchronously while stop waits for authoritative release', async () => {
    const owned = plane({ ownerDeviceId: 'device-a', ownerEpoch: 8, leaseId: 'lease-a', leaseExpiresAt: future, mode: 'V3_ACTIVE', stateVersion: 15 })
    const api = client(owned)
    let finishRelease!: (value: any) => void
    api.release.mockImplementationOnce(() => new Promise((resolve) => { finishRelease = resolve }) as never)
    const runtime = new V3ControlPlaneRuntime(api, 'device-a', 60_000)
    await runtime.start()
    await runtime.markExecutionLifecycleReady()

    const stopping = runtime.stop()
    await vi.waitFor(() => expect(api.release).toHaveBeenCalledTimes(1))
    expect(runtime.validateExecution().ok).toBe(false)
    expect(runtime.beginExecutionLifecycle().ok).toBe(false)
    finishRelease({ ok: true, controlPlane: { ...owned, ownerDeviceId: null, leaseId: null, leaseExpiresAt: null, mode: 'BLOCKED_UNKNOWN' } })
    await stopping
    expect(runtime.current().status).toBe('STOPPED')
  })

  it('does not release absent, foreign, or stale authority while draining', async () => {
    for (const authority of [
      plane({ mode: 'V3_DRAINING', stateVersion: 2 }),
      plane({ ownerDeviceId: 'device-b', ownerEpoch: 2, leaseId: 'lease-b', leaseExpiresAt: future, mode: 'V3_DRAINING', stateVersion: 3 }),
    ]) {
      const api = client(authority)
      const runtime = new V3ControlPlaneRuntime(api, 'device-a', 60_000)
      await runtime.start()
      await runtime.markExecutionLifecycleReady()
      expect(api.release).not.toHaveBeenCalled()
      await runtime.stop()
    }

    const stale = plane({ ownerDeviceId: 'device-a', ownerEpoch: 7, leaseId: 'lease-a', leaseExpiresAt: future, mode: 'V3_DRAINING', stateVersion: 14 })
    const api = client(stale)
    api.release.mockResolvedValue({ ok: false, error: 'AUTHORITY_STALE' } as never)
    const runtime = new V3ControlPlaneRuntime(api, 'device-a', 60_000)
    await runtime.start()
    await runtime.markExecutionLifecycleReady()
    expect(api.release).toHaveBeenCalledWith(stale)
    expect(runtime.current()).toMatchObject({ status: 'BLOCKED_UNKNOWN', controlPlane: { ownerDeviceId: 'device-a', ownerEpoch: 7 } })
    await runtime.stop()
  })
})
