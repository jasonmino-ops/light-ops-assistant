import assert from 'node:assert/strict'
import test from 'node:test'
import {
  acquireV3Authority, controlledV3OwnerHandoff, issueV3ExecutionBatch,
  releaseV3Authority, renewV3Authority, transitionV3PrintMode, type V3ControlPlaneDb,
} from '../lib/v3-print-control-plane'

const now = new Date('2026-01-01T00:00:00.000Z')

function fakeDb(initial: Partial<any> = {}, options: { failAudit?: boolean } = {}) {
  let plane: any = {
    id: 'plane-a', tenantId: 'tenant-a', storeId: 'store-a', ownerDeviceId: null, ownerEpoch: 0,
    leaseId: null, leaseExpiresAt: null, mode: 'V3_ACTIVE', stateVersion: 1,
    handoffRequestedAt: null, handoffQuarantineUntil: null, lastReconciledAt: null, createdAt: now, updatedAt: now, ...initial,
  }
  const batches: any[] = []
  const audits: any[] = []
  const matches = (where: any) => Object.entries(where).every(([key, expected]: any) => {
    const actual = plane[key]
    if (expected && typeof expected === 'object' && 'gt' in expected) return actual instanceof Date && actual > expected.gt
    return actual === expected
  })
  const apply = (data: any) => {
    for (const [key, value] of Object.entries(data) as any) {
      plane[key] = value && typeof value === 'object' && 'increment' in value ? plane[key] + value.increment : value
    }
    plane.updatedAt = now
  }
  const tx: any = {
    v3PrintControlPlane: {
      upsert: async () => plane,
      findUnique: async () => plane,
      updateMany: async ({ where, data }: any) => {
        if (!matches(where)) return { count: 0 }
        apply(data)
        const ownerShapeValid = (plane.ownerDeviceId === null && plane.leaseId === null && plane.leaseExpiresAt === null) ||
          (plane.ownerDeviceId !== null && plane.leaseId !== null && plane.leaseExpiresAt !== null)
        if (!ownerShapeValid) throw new Error('V3PrintControlPlane_owner_shape_check')
        return { count: 1 }
      },
    },
    v3PrintExecutionBatch: {
      create: async ({ data }: any) => {
        const row = { id: `batch-${batches.length + 1}`, revokedAt: null, createdAt: now, ...data }
        batches.push(row)
        return row
      },
      findFirst: async () => batches.filter(row => !row.revokedAt && row.expiresAt > now).sort((a, b) => b.expiresAt.getTime() - a.expiresAt.getTime())[0] ?? null,
      updateMany: async ({ data }: any) => {
        for (const row of batches) if (!row.revokedAt) Object.assign(row, data)
        return { count: batches.length }
      },
    },
    desktopDevice: { findFirst: async ({ where }: any) => ({ id: where.id }) },
    operationLog: {
      create: async ({ data }: any) => {
        if (options.failAudit) throw new Error('AUDIT_WRITE_FAILED')
        const row = { id: `audit-${audits.length + 1}`, ...data }; audits.push(row); return row
      },
      findFirst: async ({ where }: any) => [...audits].reverse().find(row => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null,
    },
    eshopTrayPrintJob: {
      findMany: async () => [],
      findUnique: async () => null,
      updateMany: async () => ({ count: 0 }),
      create: async () => { throw new Error('UNEXPECTED_JOB_CREATE') },
    },
  }
  const db: V3ControlPlaneDb = { ...tx, $transaction: async (operation: any) => {
    const beforePlane = structuredClone(plane)
    const beforeBatches = structuredClone(batches)
    const beforeAudits = structuredClone(audits)
    try {
      return await operation(tx)
    } catch (error) {
      plane = beforePlane
      batches.splice(0, batches.length, ...beforeBatches)
      audits.splice(0, audits.length, ...beforeAudits)
      throw error
    }
  } }
  return { db, plane: () => ({ ...plane }), batches, audits }
}

test('concurrent acquisition creates one owner and monotonically advances epoch', async () => {
  const state = fakeDb()
  const identity = { tenantId: 'tenant-a', storeId: 'store-a', deviceId: 'device-a' }
  const [first, second] = await Promise.all([
    acquireV3Authority(state.db, identity, { now }),
    acquireV3Authority(state.db, { ...identity, deviceId: 'device-b' }, { now }),
  ])
  assert.equal([first, second].filter((value) => value.ok).length, 1)
  assert.equal(state.plane().ownerEpoch, 1)
  assert.equal(state.plane().ownerDeviceId, 'device-a')
})

test('expired owner is ambiguous and timeout never promotes ownerEpoch', async () => {
  const state = fakeDb({ ownerDeviceId: 'device-old', ownerEpoch: 9, leaseId: 'lease-old', leaseExpiresAt: new Date(now.getTime() - 1) })
  const result = await acquireV3Authority(state.db, { tenantId: 'tenant-a', storeId: 'store-a', deviceId: 'device-new' }, { now })
  assert.deepEqual(result, { ok: false, code: 'OWNER_LIVENESS_AMBIGUOUS' })
  assert.equal(state.plane().ownerEpoch, 9)
  assert.equal(state.plane().ownerDeviceId, 'device-old')
})

test('renewal and batch issuance require every fencing value and live lease', async () => {
  const leaseExpiresAt = new Date(now.getTime() + 120_000)
  const state = fakeDb({ ownerDeviceId: 'device-a', ownerEpoch: 3, leaseId: 'lease-a', leaseExpiresAt, stateVersion: 5 })
  const stale = await renewV3Authority(state.db, {
    tenantId: 'tenant-a', storeId: 'store-a', deviceId: 'device-a', ownerEpoch: 2, leaseId: 'lease-a', stateVersion: 5,
  }, { now })
  assert.equal(stale.ok, false)
  const renewed = await renewV3Authority(state.db, {
    tenantId: 'tenant-a', storeId: 'store-a', deviceId: 'device-a', ownerEpoch: 3, leaseId: 'lease-a', stateVersion: 5,
  }, { now })
  assert.equal(renewed.ok, true)
  const batch = await issueV3ExecutionBatch(state.db, {
    tenantId: 'tenant-a', storeId: 'store-a', deviceId: 'device-a', ownerEpoch: 3, leaseId: 'lease-a', stateVersion: 6,
  }, { now })
  assert.equal(batch.ok, true)
  assert.equal(state.batches[0].ownerEpoch, 3)
  assert.equal(state.batches[0].expiresAt.getTime() - now.getTime(), 15 * 60_000)
  assert.ok(state.batches[0].expiresAt > leaseExpiresAt, 'execution Grace remains independent of the short control-plane lease')
})

test('mode transitions require BLOCKED_UNKNOWN and controlled handoff quarantines before epoch advance', async () => {
  const state = fakeDb({ mode: 'V2_ACTIVE' })
  const illegal = await transitionV3PrintMode(state.db, { tenantId: 'tenant-a', storeId: 'store-a', expectedStateVersion: 1, nextMode: 'V3_ACTIVE' }, now)
  assert.deepEqual(illegal, { ok: false, code: 'ILLEGAL_MODE_TRANSITION' })
  assert.equal((await transitionV3PrintMode(state.db, { tenantId: 'tenant-a', storeId: 'store-a', expectedStateVersion: 1, nextMode: 'V2_DRAINING' }, now)).ok, true)
  assert.equal((await transitionV3PrintMode(state.db, { tenantId: 'tenant-a', storeId: 'store-a', expectedStateVersion: 2, nextMode: 'BLOCKED_UNKNOWN' }, now)).ok, true)
  assert.equal((await transitionV3PrintMode(state.db, { tenantId: 'tenant-a', storeId: 'store-a', expectedStateVersion: 3, nextMode: 'V3_ACTIVE' }, now)).ok, true)
  const before = state.plane().ownerEpoch
  const handoff = { tenantId: 'tenant-a', storeId: 'store-a', actorUserId: 'user-owner', intendedOwnerDeviceId: 'device-new', confirmationId: 'confirm-0001' }
  assert.equal((await controlledV3OwnerHandoff(state.db, { ...handoff, expectedStateVersion: 4 }, now)).ok, true)
  assert.equal(state.plane().ownerEpoch, before)
  assert.equal(state.plane().mode, 'BLOCKED_UNKNOWN')
  assert.equal(state.plane().ownerDeviceId, 'device-new')
  assert.match(state.plane().leaseId, /^handoff:[0-9a-f]{64}$/)
  assert.equal((await controlledV3OwnerHandoff(state.db, { ...handoff, expectedStateVersion: 5 }, new Date(now.getTime() + 1))).ok, true)
  assert.equal(state.plane().ownerEpoch, before + 1)
  assert.equal(state.plane().ownerDeviceId, 'device-new')
  assert.equal(state.audits.length, 2)
  assert.deepEqual(state.audits.map(row => row.payloadSnapshot.action), ['QUARANTINE_STARTED', 'HANDOFF_CONFIRMED'])
  assert.equal(state.audits[1].userId, 'user-owner')
  assert.equal(state.audits[1].payloadSnapshot.previousOwnerDeviceId, null)
  assert.equal(state.audits[1].payloadSnapshot.intendedOwnerDeviceId, 'device-new')
})

test('owner release enters BLOCKED_UNKNOWN and revokes the active execution batch', async () => {
  const leaseExpiresAt = new Date(now.getTime() + 120_000)
  const state = fakeDb({ ownerDeviceId: 'device-a', ownerEpoch: 3, leaseId: 'lease-a', leaseExpiresAt, stateVersion: 5 })
  await issueV3ExecutionBatch(state.db, {
    tenantId: 'tenant-a', storeId: 'store-a', deviceId: 'device-a', ownerEpoch: 3, leaseId: 'lease-a', stateVersion: 5,
  }, { now })
  const released = await releaseV3Authority(state.db, {
    tenantId: 'tenant-a', storeId: 'store-a', deviceId: 'device-a', ownerEpoch: 3, leaseId: 'lease-a', stateVersion: 5,
  }, now)
  assert.equal(released.ok, true)
  assert.equal(state.plane().mode, 'BLOCKED_UNKNOWN')
  assert.equal(state.plane().ownerDeviceId, null)
  assert.equal(state.batches[0].revokedAt?.toISOString(), now.toISOString())
})

test('finalized handoff prebinds only the intended owner and does not advance epoch again on acquisition', async () => {
  const state = fakeDb({ ownerDeviceId: 'device-old', ownerEpoch: 4, leaseId: 'lease-old', leaseExpiresAt: new Date(now.getTime() + 120_000) })
  const request = { tenantId: 'tenant-a', storeId: 'store-a', actorUserId: 'user-owner', intendedOwnerDeviceId: 'device-new', confirmationId: 'confirm-0001' }
  await controlledV3OwnerHandoff(state.db, { ...request, expectedStateVersion: 1 }, now)
  await controlledV3OwnerHandoff(state.db, { ...request, expectedStateVersion: 2 }, new Date(now.getTime() + 120_001))
  assert.equal(state.plane().ownerDeviceId, 'device-new')
  assert.equal(state.plane().ownerEpoch, 5)
  assert.equal((await transitionV3PrintMode(state.db, { tenantId: 'tenant-a', storeId: 'store-a', expectedStateVersion: 3, nextMode: 'V3_ACTIVE' }, new Date(now.getTime() + 120_002))).ok, true)
  assert.deepEqual(await acquireV3Authority(state.db, { tenantId: 'tenant-a', storeId: 'store-a', deviceId: 'device-other' }, { now: new Date(now.getTime() + 120_003) }),
    { ok: false, code: 'OWNER_ALREADY_ACTIVE' })
  assert.equal((await acquireV3Authority(state.db, { tenantId: 'tenant-a', storeId: 'store-a', deviceId: 'device-new' }, { now: new Date(now.getTime() + 120_003) })).ok, true)
  assert.equal(state.plane().ownerEpoch, 5)
  assert.ok(state.plane().leaseId)
})

test('handoff confirmation is bound to the intended owner and confirmation identity', async () => {
  const state = fakeDb({ ownerDeviceId: 'device-old', ownerEpoch: 4, leaseId: 'lease-old', leaseExpiresAt: new Date(now.getTime() + 120_000) })
  const request = { tenantId: 'tenant-a', storeId: 'store-a', actorUserId: 'user-owner', intendedOwnerDeviceId: 'device-new', confirmationId: 'confirm-0001' }
  await controlledV3OwnerHandoff(state.db, { ...request, expectedStateVersion: 1 }, now)
  const afterStart = state.plane()
  assert.deepEqual(await controlledV3OwnerHandoff(state.db, {
    ...request, intendedOwnerDeviceId: 'device-other', expectedStateVersion: 2,
  }, new Date(now.getTime() + 120_001)), { ok: false, code: 'CONCURRENT_STATE_CHANGE' })
  assert.deepEqual(await controlledV3OwnerHandoff(state.db, {
    ...request, confirmationId: 'confirm-other', expectedStateVersion: 2,
  }, new Date(now.getTime() + 120_001)), { ok: false, code: 'CONCURRENT_STATE_CHANGE' })
  assert.deepEqual(state.plane(), afterStart)
})

test('handoff state and authority roll back when durable audit insertion fails', async () => {
  const initial = { ownerDeviceId: 'device-old', ownerEpoch: 4, leaseId: 'lease-old', leaseExpiresAt: new Date(now.getTime() + 120_000) }
  const state = fakeDb(initial, { failAudit: true })
  const before = state.plane()
  await assert.rejects(controlledV3OwnerHandoff(state.db, {
    tenantId: 'tenant-a', storeId: 'store-a', expectedStateVersion: 1, actorUserId: 'user-owner',
    intendedOwnerDeviceId: 'device-new', confirmationId: 'confirm-0001',
  }, now), /AUDIT_WRITE_FAILED/)
  assert.deepEqual(state.plane(), before)
  assert.equal(state.audits.length, 0)
})
