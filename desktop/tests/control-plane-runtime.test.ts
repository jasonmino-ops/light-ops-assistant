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
    release: vi.fn(async () => ({ ok: true as const, controlPlane: { ...acquired, ownerDeviceId: null, leaseId: null, leaseExpiresAt: null, mode: 'BLOCKED_UNKNOWN' as const } })),
    issueBatch: vi.fn(async () => ({ ok: true as const, batch: batch(acquired) })),
  }
  return api as unknown as V3ControlPlaneClient & typeof api
}

describe('V3ControlPlaneRuntime', () => {
  it('preserves authoritative V2 mode without trying to acquire V3', async () => {
    const api = client(plane())
    const runtime = new V3ControlPlaneRuntime(api, 'device-a', 60_000)
    await runtime.start()
    expect(runtime.current().status).toBe('V2_ACTIVE')
    expect(api.acquire).not.toHaveBeenCalled()
    await runtime.stop()
  })

  it('acquires only an unowned V3 state and requires an owner-scoped batch', async () => {
    const owned = plane({ ownerDeviceId: 'device-a', ownerEpoch: 1, leaseId: 'lease-a', leaseExpiresAt: future, mode: 'V3_ACTIVE', stateVersion: 2 })
    const api = client(plane({ mode: 'V3_ACTIVE' }), owned)
    const runtime = new V3ControlPlaneRuntime(api, 'device-a', 60_000)
    await runtime.start()
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
    api.renew.mockResolvedValueOnce({ ok: false, code: 'AUTHORITY_STALE_OR_EXPIRED' } as never)
    await (runtime as any).reconcile()
    expect(runtime.current().status).toBe('V3_OWNER')
    expect(runtime.validateExecution().ok).toBe(true)
    await runtime.stop()
  })
})
