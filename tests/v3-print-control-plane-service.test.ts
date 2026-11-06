import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { PrismaClient, type Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { classifyV3OperatorPrintJob, issueV3OperatorRecoveryProofWithDb } from '../lib/v3-print-operator-status'
import { hashInstallationId } from '../lib/desktop-activation/crypto'
import { deliverV3PrintIntent, reportV3Execution } from '../lib/v3-print-job-adapter'
import test from 'node:test'
import {
  acquireV3Authority, controlledV3OwnerHandoff, issueV3ExecutionBatch,
  recoverExpiredSelfV3Authority, releaseV3Authority, renewV3Authority, transitionV3PrintMode, type V3ControlPlaneDb,
} from '../lib/v3-print-control-plane'
import {
  parseOpsPrintModeCommand, parseOpsV3QueueRecoveryCommand, runOpsV3QueueRecovery,
  readOpsPrintModeState,
  resolveOpsPrintStoreAccess,
  runOpsPrintModeAction,
  validateOpsPrintMutationRequest,
  type OpsPrintControlDb,
} from '../app/api/ops/tenants/[tenantId]/stores/[storeId]/v3-print-control-plane/service'

const now = new Date('2026-01-01T00:00:00.000Z')
const afterV2Drain = new Date(now.getTime() + 120_001)

function fakeDb(initial: Partial<any> = {}, options: {
  failAudit?: boolean
  failAuditAction?: string
  failModeCasAfterAudit?: boolean
  failSerializableOnce?: boolean
  serializeRowLocks?: boolean
  beforeBatchCreate?: () => Promise<void>
  jobs?: any[]
} = {}) {
  let plane: any = {
    id: 'plane-a', tenantId: 'tenant-a', storeId: 'store-a', ownerDeviceId: null, ownerEpoch: 0,
    leaseId: null, leaseExpiresAt: null, mode: 'V3_ACTIVE', stateVersion: 1,
    handoffRequestedAt: null, handoffQuarantineUntil: null, lastReconciledAt: null, createdAt: now, updatedAt: now, ...initial,
  }
  const batches: any[] = []
  const audits: any[] = []
  const jobs = options.jobs ?? []
  const transactionOptions: any[] = []
  const rowLockQueries: string[] = []
  let rowLockTail = Promise.resolve()
  let serializableFailureRemaining = options.failSerializableOnce === true
  const matches = (where: any) => Object.entries(where).every(([key, expected]: any) => {
    const actual = plane[key]
    if (expected && typeof expected === 'object' && 'gt' in expected) return actual instanceof Date && actual > expected.gt
    if (expected && typeof expected === 'object' && 'lte' in expected) return actual instanceof Date && actual <= expected.lte
    return actual === expected
  })
  const matchesJob = (row: any, where: any): boolean => Object.entries(where).every(([key, expected]: any) => {
    if (key === 'OR') return expected.some((clause: any) => matchesJob(row, clause))
    if (key === 'NOT') return !matchesJob(row, expected)
    const actual = row[key]
    if (expected && typeof expected === 'object') {
      if ('in' in expected) return expected.in.includes(actual)
      if ('not' in expected) return actual !== expected.not
    }
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
      upsert: async () => ({ ...plane }),
      findUnique: async () => ({ ...plane }),
      updateMany: async ({ where, data }: any) => {
        if (options.failModeCasAfterAudit && audits.length > 0 && data.mode !== undefined) return { count: 0 }
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
        await options.beforeBatchCreate?.()
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
    desktopDevice: {
      findFirst: async ({ where }: any) => ({ id: where.id, status: 'ACTIVE', lastSeenAt: now }),
      count: async () => 1,
    },
    operationLog: {
      create: async ({ data }: any) => {
        if (options.failAudit || options.failAuditAction === data.actionType) throw new Error('AUDIT_WRITE_FAILED')
        const row = { id: `audit-${audits.length + 1}`, ...data }; audits.push(row); return row
      },
      findFirst: async ({ where }: any) => [...audits].reverse().find(row => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null,
    },
    eshopTrayPrintJob: {
      findMany: async () => [],
      findUnique: async () => null,
      count: async ({ where }: any) => jobs.filter((row) => matchesJob(row, where)).length,
      updateMany: async () => ({ count: 0 }),
      create: async () => { throw new Error('UNEXPECTED_JOB_CREATE') },
    },
  }
  const db: OpsPrintControlDb = {
    ...tx,
    $transaction: async function (this: OpsPrintControlDb, operation: any, config?: any) {
      assert.equal(this, db, 'transaction must retain its Prisma client receiver')
      transactionOptions.push(config ?? null)
      if (config?.isolationLevel === 'Serializable' && serializableFailureRemaining) {
        serializableFailureRemaining = false
        throw Object.assign(new Error('SERIALIZATION_FAILURE'), { code: 'P2034' })
      }
      const beforePlane = structuredClone(plane)
      const beforeBatches = structuredClone(batches)
      const beforeAudits = structuredClone(audits)
      const rowLockState: { release?: () => void } = {}
      const transactionTx = {
        ...tx,
        $queryRaw: async (strings: TemplateStringsArray) => {
          rowLockQueries.push(strings.join('?'))
          if (options.serializeRowLocks && !rowLockState.release) {
            let release!: () => void
            const previous = rowLockTail
            rowLockTail = new Promise<void>((resolve) => { release = resolve })
            await previous
            rowLockState.release = release
          }
          return [{ id: plane.id }]
        },
      }
      try {
        return await operation(transactionTx)
      } catch (error) {
        plane = beforePlane
        batches.splice(0, batches.length, ...beforeBatches)
        audits.splice(0, audits.length, ...beforeAudits)
        throw error
      } finally {
        rowLockState.release?.()
      }
    },
  }
  return { db, plane: () => ({ ...plane }), batches, audits, jobs, transactionOptions, rowLockQueries }
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

test('expired same-owner recovery rotates only lease/state, revokes stale batches, audits, and preserves pending jobs', async () => {
  const incidentJobs = [
    { id: 'front-row', idempotencyKey: 'network:front', schemaVersion: 3, status: 'PENDING', claimAttempt: 0 },
    { id: 'kitchen-row', idempotencyKey: 'network:kitchen', schemaVersion: 3, status: 'PENDING', claimAttempt: 0 },
  ]
  const state = fakeDb({
    ownerDeviceId: 'device-a', ownerEpoch: 5, leaseId: 'lease-expired',
    leaseExpiresAt: new Date(now.getTime() - 1), stateVersion: 12,
  }, { jobs: incidentJobs })
  state.batches.push({
    id: 'batch-stale', controlPlaneId: 'plane-a', tenantId: 'tenant-a', storeId: 'store-a',
    ownerDeviceId: 'device-a', ownerEpoch: 5, stateVersion: 12, leaseId: 'lease-expired', mode: 'V3_ACTIVE',
    expiresAt: new Date(now.getTime() - 1), revokedAt: null, createdAt: new Date(now.getTime() - 60_000),
  })
  const jobsBefore = structuredClone(state.jobs)
  const staleFence = {
    tenantId: 'tenant-a', storeId: 'store-a', deviceId: 'device-a', ownerEpoch: 5,
    stateVersion: 12, leaseId: 'lease-expired',
  }

  const result = await recoverExpiredSelfV3Authority(state.db, staleFence, { now })
  assert.equal(result.ok, true)
  assert.equal(state.plane().ownerDeviceId, 'device-a')
  assert.equal(state.plane().ownerEpoch, 5)
  assert.equal(state.plane().stateVersion, 13)
  assert.notEqual(state.plane().leaseId, 'lease-expired')
  assert.ok(state.plane().leaseExpiresAt > now)
  assert.equal(state.batches[0].revokedAt?.toISOString(), now.toISOString())
  assert.deepEqual(state.jobs, jobsBefore)
  assert.deepEqual(state.audits.slice(0, 2).map((row) => row.actionType), [
    'RECOVER_EXPIRED_SELF_ATTEMPT', 'RECOVER_EXPIRED_SELF_SUCCESS',
  ])
  assert.equal(state.audits[1].payloadSnapshot.oldLeaseId, 'lease-expired')
  assert.equal(state.audits[1].payloadSnapshot.newLeaseId, state.plane().leaseId)
  assert.equal(state.audits[1].payloadSnapshot.oldStateVersion, 12)
  assert.equal(state.audits[1].payloadSnapshot.newStateVersion, 13)

  assert.deepEqual(await renewV3Authority(state.db, staleFence, { now }), {
    ok: false, code: 'AUTHORITY_STALE_OR_EXPIRED',
  })
  assert.deepEqual(await recoverExpiredSelfV3Authority(state.db, staleFence, { now }), {
    ok: false, code: 'RECOVERY_STALE_FENCE',
  })
  assert.deepEqual(await issueV3ExecutionBatch(state.db, staleFence, { now }), {
    ok: false, code: 'AUTHORITY_STALE_OR_EXPIRED',
  })
  assert.deepEqual(state.jobs, jobsBefore)
})

test('expired-self recovery rolls authority and stale-batch revocation back when success audit cannot persist', async () => {
  const state = fakeDb({
    ownerDeviceId: 'device-a', ownerEpoch: 5, leaseId: 'lease-expired',
    leaseExpiresAt: new Date(now.getTime() - 1), stateVersion: 12,
  }, { failAuditAction: 'RECOVER_EXPIRED_SELF_SUCCESS' })
  state.batches.push({
    id: 'batch-stale', controlPlaneId: 'plane-a', tenantId: 'tenant-a', storeId: 'store-a',
    ownerDeviceId: 'device-a', ownerEpoch: 5, stateVersion: 12, leaseId: 'lease-expired', mode: 'V3_ACTIVE',
    expiresAt: new Date(now.getTime() - 1), revokedAt: null, createdAt: new Date(now.getTime() - 60_000),
  })

  await assert.rejects(() => recoverExpiredSelfV3Authority(state.db, {
    tenantId: 'tenant-a', storeId: 'store-a', deviceId: 'device-a', ownerEpoch: 5,
    stateVersion: 12, leaseId: 'lease-expired',
  }, { now }), /AUDIT_WRITE_FAILED/)
  assert.equal(state.plane().leaseId, 'lease-expired')
  assert.equal(state.plane().stateVersion, 12)
  assert.equal(state.batches[0].revokedAt, null)
  assert.equal(state.audits.length, 0)
})

test('expired-self recovery rejects every unsafe eligibility state', async () => {
  const base = {
    ownerDeviceId: 'device-a', ownerEpoch: 5, leaseId: 'lease-a',
    leaseExpiresAt: new Date(now.getTime() - 1), stateVersion: 12,
  }
  const request = {
    tenantId: 'tenant-a', storeId: 'store-a', deviceId: 'device-a', ownerEpoch: 5,
    stateVersion: 12, leaseId: 'lease-a',
  }
  const cases: Array<{ name: string; initial?: Record<string, unknown>; request?: Record<string, unknown>; code: string }> = [
    { name: 'live lease', initial: { leaseExpiresAt: new Date(now.getTime() + 1) }, code: 'RECOVERY_LEASE_NOT_EXPIRED' },
    { name: 'different owner', initial: { ownerDeviceId: 'device-b' }, code: 'RECOVERY_OWNER_MISMATCH' },
    { name: 'owner epoch mismatch', request: { ownerEpoch: 4 }, code: 'RECOVERY_STALE_FENCE' },
    { name: 'state version mismatch', request: { stateVersion: 11 }, code: 'RECOVERY_STALE_FENCE' },
    { name: 'lease mismatch', request: { leaseId: 'lease-old' }, code: 'RECOVERY_STALE_FENCE' },
    { name: 'active handoff', initial: { handoffRequestedAt: now }, code: 'RECOVERY_HANDOFF_ACTIVE' },
    { name: 'active quarantine', initial: { handoffQuarantineUntil: now }, code: 'RECOVERY_QUARANTINE_ACTIVE' },
    { name: 'wrong mode', initial: { mode: 'BLOCKED_UNKNOWN' }, code: 'MODE_NOT_V3_ACTIVE' },
  ]
  for (const value of cases) {
    const state = fakeDb({ ...base, ...value.initial })
    const result = await recoverExpiredSelfV3Authority(state.db, { ...request, ...value.request } as any, { now })
    assert.deepEqual(result, { ok: false, code: value.code }, value.name)
    assert.equal(state.plane().leaseId, (value.initial?.leaseId as string | undefined) ?? base.leaseId)
    assert.equal(state.audits.at(-1)?.actionType, 'RECOVER_EXPIRED_SELF_REJECTED')
    assert.equal(state.audits.at(-1)?.message, value.code)
  }

  const activeBatch = fakeDb(base)
  activeBatch.batches.push({
    id: 'batch-active', controlPlaneId: 'plane-a', tenantId: 'tenant-a', storeId: 'store-a',
    ownerDeviceId: 'device-a', ownerEpoch: 5, stateVersion: 12, leaseId: 'lease-a', mode: 'V3_ACTIVE',
    expiresAt: new Date(now.getTime() + 1), revokedAt: null, createdAt: now,
  })
  assert.deepEqual(await recoverExpiredSelfV3Authority(activeBatch.db, request, { now }), {
    ok: false, code: 'RECOVERY_ACTIVE_BATCH',
  })
  assert.equal(activeBatch.batches[0].revokedAt, null)
})

test('two concurrent expired-self recoveries allow exactly one winner', async () => {
  const state = fakeDb({
    ownerDeviceId: 'device-a', ownerEpoch: 5, leaseId: 'lease-expired',
    leaseExpiresAt: new Date(now.getTime() - 1), stateVersion: 12,
  })
  const request = {
    tenantId: 'tenant-a', storeId: 'store-a', deviceId: 'device-a', ownerEpoch: 5,
    stateVersion: 12, leaseId: 'lease-expired',
  }
  const results = await Promise.all([
    recoverExpiredSelfV3Authority(state.db, request, { now }),
    recoverExpiredSelfV3Authority(state.db, request, { now }),
  ])
  assert.equal(results.filter(({ ok }) => ok).length, 1)
  assert.deepEqual(results.filter(({ ok }) => !ok), [{ ok: false, code: 'RECOVERY_STALE_FENCE' }])
  assert.equal(state.plane().ownerEpoch, 5)
  assert.equal(state.plane().stateVersion, 13)
  assert.equal(state.audits.filter((row) => row.actionType === 'RECOVER_EXPIRED_SELF_SUCCESS').length, 1)
  assert.equal(state.audits.filter((row) => row.actionType === 'RECOVER_EXPIRED_SELF_REJECTED').length, 1)
})

test('row lock makes a late old-fence batch visible before expired-self recovery can succeed', async () => {
  let enteredCreate!: () => void
  let releaseCreate!: () => void
  const createEntered = new Promise<void>((resolve) => { enteredCreate = resolve })
  const createBlocked = new Promise<void>((resolve) => { releaseCreate = resolve })
  const state = fakeDb({
    ownerDeviceId: 'device-a', ownerEpoch: 5, leaseId: 'lease-expiring',
    leaseExpiresAt: new Date(now.getTime() - 1), stateVersion: 12,
  }, {
    serializeRowLocks: true,
    beforeBatchCreate: async () => { enteredCreate(); await createBlocked },
  })
  const request = {
    tenantId: 'tenant-a', storeId: 'store-a', deviceId: 'device-a', ownerEpoch: 5,
    stateVersion: 12, leaseId: 'lease-expiring',
  }

  const issue = issueV3ExecutionBatch(state.db, request, { now: new Date(now.getTime() - 2) })
  await createEntered
  const recover = recoverExpiredSelfV3Authority(state.db, request, { now })
  await new Promise((resolve) => setImmediate(resolve))
  releaseCreate()

  assert.equal((await issue).ok, true)
  assert.deepEqual(await recover, { ok: false, code: 'RECOVERY_ACTIVE_BATCH' })
  assert.equal(state.plane().leaseId, 'lease-expiring')
  assert.equal(state.plane().stateVersion, 12)
  assert.equal(state.batches.length, 1)
  assert.equal(state.batches[0].revokedAt, null)
  assert.equal(state.rowLockQueries.length, 2)
  assert.ok(state.rowLockQueries.every((query) => query.includes('V3PrintControlPlane') && query.includes('FOR UPDATE')))
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

test('Ops finalization preserves a completed controlled handoff but rejects unaudited prebinding', async () => {
  const state = fakeDb({ ownerDeviceId: 'device-old', ownerEpoch: 4, leaseId: 'lease-old', leaseExpiresAt: new Date(now.getTime() + 120_000) })
  const handoff = { tenantId: 'tenant-a', storeId: 'store-a', actorUserId: 'user-owner', intendedOwnerDeviceId: 'device-new', confirmationId: 'confirm-0001' }
  await controlledV3OwnerHandoff(state.db, { ...handoff, expectedStateVersion: 1 }, now)
  const finalizedAt = new Date(now.getTime() + 120_001)
  await controlledV3OwnerHandoff(state.db, { ...handoff, expectedStateVersion: 2 }, finalizedAt)
  assert.equal(state.audits.at(-1)?.message, 'HANDOFF_CONFIRMED')
  assert.equal(state.audits.at(-1)?.payloadSnapshot.intendedOwnerDeviceId, state.plane().ownerDeviceId)
  assert.equal(state.audits.at(-1)?.payloadSnapshot.ownerEpoch, state.plane().ownerEpoch)
  assert.equal(state.audits.at(-1)?.payloadSnapshot.stateVersion, state.plane().stateVersion)

  const readable = await readOpsPrintModeState(state.db, { tenantId: 'tenant-a', storeId: 'store-a' }, finalizedAt)
  assert.equal(readable.actions.finalizeV3Active, true)
  const result = await runOpsPrintModeAction(state.db, {
    tenantId: 'tenant-a', storeId: 'store-a', operatorAdminId: 'ops-admin-a', operatorRole: 'OPS_ADMIN',
    expectedStateVersion: 3, action: 'FINALIZE_V3_ACTIVE',
  }, finalizedAt)
  assert.equal(result.ok, true)
  assert.equal(state.plane().mode, 'V3_ACTIVE')
  assert.equal(state.plane().ownerDeviceId, 'device-new')
  assert.equal(state.plane().ownerEpoch, 5)

  const unaudited = fakeDb({
    mode: 'BLOCKED_UNKNOWN', ownerDeviceId: 'device-new', ownerEpoch: 5, leaseId: 'lease-new',
    leaseExpiresAt: new Date(finalizedAt.getTime() + 60_000), stateVersion: 3,
  })
  const denied = await runOpsPrintModeAction(unaudited.db, {
    tenantId: 'tenant-a', storeId: 'store-a', operatorAdminId: 'ops-admin-a', operatorRole: 'OPS_ADMIN',
    expectedStateVersion: 3, action: 'FINALIZE_V3_ACTIVE',
  }, finalizedAt)
  assert.equal(denied.ok, false)
  if (!denied.ok) assert.equal(denied.code, 'OWNER_RELEASE_REQUIRED')
  assert.equal(unaudited.plane().mode, 'BLOCKED_UNKNOWN')
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

test('Ops route access helpers reject unauthenticated, mismatched and client-overridden scope', async () => {
  let lookupScope: { tenantId: string; storeId: string } | null = null
  const unauthorized = await resolveOpsPrintStoreAccess({}, { tenantId: 'tenant-a', storeId: 'store-a' }, {
    authenticate: async () => false,
    findActiveStore: async (scope) => { lookupScope = scope; return null },
  })
  assert.deepEqual(unauthorized, { ok: false, code: 'FORBIDDEN' })
  assert.equal(lookupScope, null)

  const mismatched = await resolveOpsPrintStoreAccess({}, { tenantId: 'tenant-a', storeId: 'store-a' }, {
    authenticate: async () => ({ id: 'ops-a', role: 'OPS_ADMIN' }),
    findActiveStore: async (scope) => { lookupScope = scope; return { id: 'store-a', tenantId: 'tenant-b', code: 'B' } },
  })
  assert.deepEqual(mismatched, { ok: false, code: 'STORE_NOT_FOUND' })
  assert.deepEqual(lookupScope, { tenantId: 'tenant-a', storeId: 'store-a' })

  const authorized = await resolveOpsPrintStoreAccess({}, { tenantId: 'tenant-a', storeId: 'store-a' }, {
    authenticate: async () => ({ id: 'ops-a', role: 'OPS_ADMIN' }),
    findActiveStore: async () => ({ id: 'store-a', tenantId: 'tenant-a', code: 'STORE-A' }),
  })
  assert.equal(authorized.ok, true)
  assert.deepEqual(parseOpsPrintModeCommand({
    action: 'START_ACTIVATION', confirmed: true, expectedStateVersion: 1,
  }), { ok: true, value: { action: 'START_ACTIVATION', confirmed: true, expectedStateVersion: 1 } })
  for (const override of ['tenantId', 'storeId', 'ownerDeviceId']) {
    assert.deepEqual(parseOpsPrintModeCommand({
      action: 'START_ACTIVATION', confirmed: true, expectedStateVersion: 1, [override]: 'attacker-value',
    }), { ok: false, code: 'INVALID_SCOPE_INPUT' })
  }
})

test('Ops mutation metadata requires same-origin browser JSON requests', () => {
  const request = (headers: Record<string, string>) => ({
    url: 'https://ops.example.test/api/ops/tenants/tenant-a/stores/store-a/v3-print-control-plane',
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  })
  assert.deepEqual(validateOpsPrintMutationRequest(request({
    'content-type': 'application/json', origin: 'https://ops.example.test', 'sec-fetch-site': 'same-origin',
  })), { ok: true })
  assert.deepEqual(validateOpsPrintMutationRequest(request({
    'content-type': 'text/plain', origin: 'https://ops.example.test', 'sec-fetch-site': 'same-origin',
  })), { ok: false, code: 'INVALID_CONTENT_TYPE' })
  assert.deepEqual(validateOpsPrintMutationRequest(request({
    'content-type': 'application/json', origin: 'https://attacker.invalid', 'sec-fetch-site': 'cross-site',
  })), { ok: false, code: 'INVALID_REQUEST_ORIGIN' })
  assert.deepEqual(validateOpsPrintMutationRequest(request({
    'content-type': 'application/json', origin: 'https://ops.example.test',
  })), { ok: false, code: 'INVALID_REQUEST_ORIGIN' })
})

test('Ops activation persists every legal gate and never auto-exits BLOCKED_UNKNOWN', async () => {
  const state = fakeDb({ mode: 'V2_ACTIVE' })
  const start = await runOpsPrintModeAction(state.db, {
    tenantId: 'tenant-a', storeId: 'store-a', operatorAdminId: 'ops-admin-a', operatorRole: 'OPS_ADMIN',
    expectedStateVersion: 1, action: 'START_ACTIVATION',
  }, now)
  assert.equal(start.ok, true)
  assert.equal(state.plane().mode, 'V2_DRAINING')

  const tooEarly = await runOpsPrintModeAction(state.db, {
    tenantId: 'tenant-a', storeId: 'store-a', operatorAdminId: 'ops-admin-a', operatorRole: 'OPS_ADMIN',
    expectedStateVersion: 2, action: 'ENTER_MANUAL_REVIEW',
  }, now)
  assert.equal(tooEarly.ok, false)
  if (!tooEarly.ok) assert.equal(tooEarly.code, 'V2_DRAIN_WINDOW_ACTIVE')
  assert.equal(state.plane().mode, 'V2_DRAINING')

  const review = await runOpsPrintModeAction(state.db, {
    tenantId: 'tenant-a', storeId: 'store-a', operatorAdminId: 'ops-admin-a', operatorRole: 'OPS_ADMIN',
    expectedStateVersion: 2, action: 'ENTER_MANUAL_REVIEW',
  }, afterV2Drain)
  assert.equal(review.ok, true)
  assert.equal(state.plane().mode, 'BLOCKED_UNKNOWN')
  assert.equal(state.plane().stateVersion, 3)

  const finish = await runOpsPrintModeAction(state.db, {
    tenantId: 'tenant-a', storeId: 'store-a', operatorAdminId: 'ops-admin-a', operatorRole: 'OPS_ADMIN',
    expectedStateVersion: 3, action: 'FINALIZE_V3_ACTIVE',
  }, afterV2Drain)
  assert.equal(finish.ok, true)
  assert.equal(state.plane().mode, 'V3_ACTIVE')
  assert.equal(state.plane().stateVersion, 4)
  assert.equal(state.audits.length, 3)
  assert.equal(state.audits[0].actionType, 'V3_PRINT_MODE_OPERATOR_CONFIRMATION')
  assert.equal(state.audits[0].payloadSnapshot.operatorAdminId, 'ops-admin-a')
  assert.deepEqual(state.audits.map((row) => row.payloadSnapshot.requestedTransition), [
    { fromMode: 'V2_ACTIVE', toMode: 'V2_DRAINING' },
    { fromMode: 'V2_DRAINING', toMode: 'BLOCKED_UNKNOWN' },
    { fromMode: 'BLOCKED_UNKNOWN', toMode: 'V3_ACTIVE' },
  ])
  assert.equal(state.transactionOptions.filter((value) => value?.isolationLevel === 'Serializable').length, 4)
})

test('Ops activation cannot leave V2_DRAINING while old V2 work remains', async () => {
  const state = fakeDb({ mode: 'V2_DRAINING', stateVersion: 2 }, { jobs: [{
    id: 'v2-job', tenantId: 'tenant-a', storeId: 'store-a', schemaVersion: 2,
    status: 'EXECUTING', effectBoundary: 'CROSSING_UNKNOWN',
  }] })
  const result = await runOpsPrintModeAction(state.db, {
    tenantId: 'tenant-a', storeId: 'store-a', operatorAdminId: 'ops-admin-a', operatorRole: 'OPS_ADMIN',
    expectedStateVersion: 2, action: 'ENTER_MANUAL_REVIEW',
  }, afterV2Drain)
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.code, 'V2_DRAIN_NOT_COMPLETE')
  assert.equal(state.plane().mode, 'V2_DRAINING')
  assert.equal(state.audits.length, 0)
})

test('Ops V2 drain proof covers schema 1/2 pending, claimed, executing and unknown facts', async () => {
  const blockers = [
    { schemaVersion: 1, status: 'PENDING', effectBoundary: null },
    { schemaVersion: 2, status: 'CLAIMED', effectBoundary: 'NOT_CROSSED' },
    { schemaVersion: 1, status: 'EXECUTING', effectBoundary: 'NOT_CROSSED' },
    { schemaVersion: 2, status: 'SUCCEEDED', effectBoundary: 'CROSSING_UNKNOWN' },
  ]
  for (const [index, blocker] of blockers.entries()) {
    const state = fakeDb({ mode: 'V2_DRAINING', stateVersion: 2 }, { jobs: [{
      id: `v2-job-${index}`, tenantId: 'tenant-a', storeId: 'store-a', ...blocker,
    }] })
    const result = await runOpsPrintModeAction(state.db, {
      tenantId: 'tenant-a', storeId: 'store-a', operatorAdminId: 'ops-admin-a', operatorRole: 'OPS_ADMIN',
      expectedStateVersion: 2, action: 'ENTER_MANUAL_REVIEW',
    }, afterV2Drain)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'V2_DRAIN_NOT_COMPLETE')
    assert.equal(state.plane().mode, 'V2_DRAINING')
  }
})

test('Ops final actions re-check durable execution facts inside the serializable command', async () => {
  const activation = fakeDb({ mode: 'BLOCKED_UNKNOWN', stateVersion: 3 }, { jobs: [{
    id: 'late-v2-pending', tenantId: 'tenant-a', storeId: 'store-a', schemaVersion: 1,
    status: 'PENDING', effectBoundary: null,
  }] })
  const activate = await runOpsPrintModeAction(activation.db, {
    tenantId: 'tenant-a', storeId: 'store-a', operatorAdminId: 'ops-admin-a', operatorRole: 'OPS_ADMIN',
    expectedStateVersion: 3, action: 'FINALIZE_V3_ACTIVE',
  }, afterV2Drain)
  assert.equal(activate.ok, false)
  if (!activate.ok) assert.equal(activate.code, 'V2_DRAIN_NOT_COMPLETE')
  assert.equal(activation.plane().mode, 'BLOCKED_UNKNOWN')

  const deactivation = fakeDb({ mode: 'BLOCKED_UNKNOWN', stateVersion: 3 }, { jobs: [{
    id: 'late-v2-unknown', tenantId: 'tenant-a', storeId: 'store-a', schemaVersion: 2,
    status: 'FAILED', effectBoundary: 'CROSSING_UNKNOWN',
  }] })
  const deactivate = await runOpsPrintModeAction(deactivation.db, {
    tenantId: 'tenant-a', storeId: 'store-a', operatorAdminId: 'ops-admin-a', operatorRole: 'OPS_ADMIN',
    expectedStateVersion: 3, action: 'FINALIZE_V2_ACTIVE',
  }, afterV2Drain)
  assert.equal(deactivate.ok, false)
  if (!deactivate.ok) assert.equal(deactivate.code, 'V2_EXECUTION_AMBIGUOUS')
  assert.equal(deactivation.plane().mode, 'BLOCKED_UNKNOWN')
})

test('Ops V3 drain proof blocks executable schema-3 facts but excludes durably HELD intents', async () => {
  const blockers = [
    { status: 'PENDING', completedAt: null, resultMessage: null, effectBoundary: 'NOT_CROSSED' },
    { status: 'CLAIMED', completedAt: null, resultMessage: 'V3_CLAIM:device-a:1:batch-a', effectBoundary: 'NOT_CROSSED' },
    { status: 'EXECUTING', completedAt: null, resultMessage: null, effectBoundary: 'NOT_CROSSED' },
    { status: 'FAILED', completedAt: now, resultMessage: null, effectBoundary: 'CROSSING_UNKNOWN' },
  ]
  for (const [index, blocker] of blockers.entries()) {
    const active = fakeDb({ mode: 'V3_ACTIVE', stateVersion: 2 }, { jobs: [{
      id: `active-v3-job-${index}`, tenantId: 'tenant-a', storeId: 'store-a', schemaVersion: 3, ...blocker,
    }] })
    const start = await runOpsPrintModeAction(active.db, {
      tenantId: 'tenant-a', storeId: 'store-a', operatorAdminId: 'ops-admin-a', operatorRole: 'OPS_ADMIN',
      expectedStateVersion: 2, action: 'START_DEACTIVATION',
    }, afterV2Drain)
    assert.equal(start.ok, false)
    if (!start.ok) assert.equal(start.code, 'V3_DRAIN_NOT_COMPLETE')
    assert.equal(active.plane().mode, 'V3_ACTIVE')
    assert.equal(active.audits.length, 0)

    const blocked = fakeDb({ mode: 'BLOCKED_UNKNOWN', stateVersion: 3 }, { jobs: [{
      id: `blocked-v3-job-${index}`, tenantId: 'tenant-a', storeId: 'store-a', schemaVersion: 3, ...blocker,
    }] })
    const reactivate = await runOpsPrintModeAction(blocked.db, {
      tenantId: 'tenant-a', storeId: 'store-a', operatorAdminId: 'ops-admin-a', operatorRole: 'OPS_ADMIN',
      expectedStateVersion: 3, action: 'FINALIZE_V3_ACTIVE',
    }, afterV2Drain)
    assert.equal(reactivate.ok, false)
    if (!reactivate.ok) assert.equal(reactivate.code, 'V3_EXECUTION_AMBIGUOUS')
    assert.equal(blocked.plane().mode, 'BLOCKED_UNKNOWN')
    assert.equal(blocked.audits.length, 0)

    const state = fakeDb({ mode: 'BLOCKED_UNKNOWN', stateVersion: 3 }, { jobs: [{
      id: `v3-job-${index}`, tenantId: 'tenant-a', storeId: 'store-a', schemaVersion: 3, ...blocker,
    }] })
    const result = await runOpsPrintModeAction(state.db, {
      tenantId: 'tenant-a', storeId: 'store-a', operatorAdminId: 'ops-admin-a', operatorRole: 'OPS_ADMIN',
      expectedStateVersion: 3, action: 'FINALIZE_V2_ACTIVE',
    }, afterV2Drain)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'V3_DRAIN_NOT_COMPLETE')
    assert.equal(state.plane().mode, 'BLOCKED_UNKNOWN')
    assert.equal(state.audits.length, 0)
  }

  const held = fakeDb({ mode: 'BLOCKED_UNKNOWN', stateVersion: 3 }, { jobs: [{
    id: 'v3-held', tenantId: 'tenant-a', storeId: 'store-a', schemaVersion: 3,
    status: 'PENDING', completedAt: null, resultMessage: 'V3_DURABLY_HELD', effectBoundary: 'NOT_CROSSED',
  }] })
  const state = await readOpsPrintModeState(held.db, { tenantId: 'tenant-a', storeId: 'store-a' }, afterV2Drain)
  assert.deepEqual(state.v3Queue, { pending: 0, claimed: 0, executing: 0, crossingUnknown: 0 })
  assert.equal(state.actions.finalizeV2Active, true)
  assert.equal(state.actions.finalizeV3Active, true)

  const activeHeld = fakeDb({ mode: 'V3_ACTIVE', stateVersion: 2 }, { jobs: held.jobs })
  const activeState = await readOpsPrintModeState(activeHeld.db, { tenantId: 'tenant-a', storeId: 'store-a' }, afterV2Drain)
  assert.equal(activeState.actions.startDeactivation, true)
})

test('Ops mode action rejects stale CAS and unsafe authority state', async () => {
  const stale = fakeDb({ mode: 'V2_ACTIVE', stateVersion: 3 })
  const staleResult = await runOpsPrintModeAction(stale.db, {
    tenantId: 'tenant-a', storeId: 'store-a', operatorAdminId: 'ops-admin-a', operatorRole: 'OPS_ADMIN',
    expectedStateVersion: 2, action: 'START_ACTIVATION',
  }, now)
  assert.equal(staleResult.ok, false)
  if (!staleResult.ok) assert.equal(staleResult.code, 'CONCURRENT_STATE_CHANGE')
  assert.equal(staleResult.controlPlane.mode, 'V2_ACTIVE')
  assert.equal(staleResult.controlPlane.stateVersion, 3)
  assert.equal(stale.audits.length, 0)

  const owned = fakeDb({
    mode: 'V2_ACTIVE', ownerDeviceId: 'device-a', leaseId: 'lease-a', leaseExpiresAt: new Date(now.getTime() + 60_000),
  })
  const ownedResult = await runOpsPrintModeAction(owned.db, {
    tenantId: 'tenant-a', storeId: 'store-a', operatorAdminId: 'ops-admin-a', operatorRole: 'OPS_ADMIN',
    expectedStateVersion: 1, action: 'START_ACTIVATION',
  }, now)
  assert.equal(ownedResult.ok, false)
  if (!ownedResult.ok) assert.equal(ownedResult.code, 'OWNER_RELEASE_REQUIRED')
  assert.equal(owned.plane().mode, 'V2_ACTIVE')

  const batched = fakeDb({ mode: 'BLOCKED_UNKNOWN' })
  batched.batches.push({
    id: 'batch-active', controlPlaneId: 'plane-a', tenantId: 'tenant-a', storeId: 'store-a',
    ownerDeviceId: 'device-a', ownerEpoch: 1, stateVersion: 1, leaseId: 'lease-a', mode: 'V3_ACTIVE',
    expiresAt: new Date(now.getTime() + 60_000), revokedAt: null, createdAt: now,
  })
  const batchResult = await runOpsPrintModeAction(batched.db, {
    tenantId: 'tenant-a', storeId: 'store-a', operatorAdminId: 'ops-admin-a', operatorRole: 'OPS_ADMIN',
    expectedStateVersion: 1, action: 'FINALIZE_V2_ACTIVE',
  }, now)
  assert.equal(batchResult.ok, false)
  if (!batchResult.ok) assert.equal(batchResult.code, 'ACTIVE_EXECUTION_BATCH')
  assert.equal(batched.plane().mode, 'BLOCKED_UNKNOWN')
})

test('Ops deactivation enters draining before Desktop safely releases authority and preserves every manual gate', async () => {
  const leaseExpiresAt = new Date(now.getTime() + 120_000)
  const state = fakeDb({ mode: 'V3_ACTIVE', ownerDeviceId: 'device-a', ownerEpoch: 3, leaseId: 'lease-a', leaseExpiresAt })
  await issueV3ExecutionBatch(state.db, {
    tenantId: 'tenant-a', storeId: 'store-a', deviceId: 'device-a', ownerEpoch: 3, leaseId: 'lease-a', stateVersion: 1,
  }, { now })
  const start = await runOpsPrintModeAction(state.db, {
    tenantId: 'tenant-a', storeId: 'store-a', operatorAdminId: 'ops-admin-a', operatorRole: 'SUPER_ADMIN',
    expectedStateVersion: 1, action: 'START_DEACTIVATION',
  }, now)
  assert.equal(start.ok, true)
  assert.equal(state.plane().mode, 'V3_DRAINING')
  assert.equal(state.plane().stateVersion, 2)
  assert.equal(state.plane().ownerDeviceId, 'device-a')
  assert.equal(state.batches[0].revokedAt, null)

  const released = await releaseV3Authority(state.db, {
    tenantId: 'tenant-a', storeId: 'store-a', deviceId: 'device-a', ownerEpoch: 3, leaseId: 'lease-a', stateVersion: 2,
  }, now)
  assert.equal(released.ok, true)
  assert.equal(state.plane().mode, 'BLOCKED_UNKNOWN')
  assert.equal(state.plane().ownerDeviceId, null)
  assert.equal(state.batches[0].revokedAt?.toISOString(), now.toISOString())

  const finish = await runOpsPrintModeAction(state.db, {
    tenantId: 'tenant-a', storeId: 'store-a', operatorAdminId: 'ops-admin-a', operatorRole: 'SUPER_ADMIN',
    expectedStateVersion: 3, action: 'FINALIZE_V2_ACTIVE',
  }, now)
  assert.equal(finish.ok, true)
  assert.equal(state.plane().mode, 'V2_ACTIVE')
  assert.equal(state.plane().stateVersion, 4)
  assert.deepEqual(state.audits.map((row) => row.payloadSnapshot.requestedTransition), [
    { fromMode: 'V3_ACTIVE', toMode: 'V3_DRAINING' },
    { fromMode: 'BLOCKED_UNKNOWN', toMode: 'V2_ACTIVE' },
  ])

  const releasedState = fakeDb({ mode: 'V3_ACTIVE', stateVersion: 1 })
  const drain = await runOpsPrintModeAction(releasedState.db, {
    tenantId: 'tenant-a', storeId: 'store-a', operatorAdminId: 'ops-admin-a', operatorRole: 'SUPER_ADMIN',
    expectedStateVersion: 1, action: 'START_DEACTIVATION',
  }, now)
  assert.equal(drain.ok, true)
  assert.equal(releasedState.plane().mode, 'V3_DRAINING')
  const review = await runOpsPrintModeAction(releasedState.db, {
    tenantId: 'tenant-a', storeId: 'store-a', operatorAdminId: 'ops-admin-a', operatorRole: 'SUPER_ADMIN',
    expectedStateVersion: 2, action: 'ENTER_MANUAL_REVIEW',
  }, now)
  assert.equal(review.ok, true)
  assert.equal(releasedState.plane().mode, 'BLOCKED_UNKNOWN')
})

test('Ops transition never starts when durable operator confirmation cannot be recorded', async () => {
  const state = fakeDb({ mode: 'V2_ACTIVE' }, { failAudit: true })
  await assert.rejects(runOpsPrintModeAction(state.db, {
    tenantId: 'tenant-a', storeId: 'store-a', operatorAdminId: 'ops-admin-a', operatorRole: 'OPS_ADMIN',
    expectedStateVersion: 1, action: 'START_ACTIVATION',
  }, now), /AUDIT_WRITE_FAILED/)
  assert.equal(state.plane().mode, 'V2_ACTIVE')
  assert.equal(state.plane().stateVersion, 1)
})

test('Ops transition CAS failure rolls back the SUCCESS confirmation audit', async () => {
  const state = fakeDb({ mode: 'V2_ACTIVE' }, { failModeCasAfterAudit: true })
  const result = await runOpsPrintModeAction(state.db, {
    tenantId: 'tenant-a', storeId: 'store-a', operatorAdminId: 'ops-admin-a', operatorRole: 'OPS_ADMIN',
    expectedStateVersion: 1, action: 'START_ACTIVATION',
  }, now)
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.code, 'CONCURRENT_STATE_CHANGE')
  assert.equal(state.plane().mode, 'V2_ACTIVE')
  assert.equal(state.plane().stateVersion, 1)
  assert.equal(state.audits.length, 0)
})

test('Ops serializable conflict fails closed and reports current authoritative state', async () => {
  const state = fakeDb({ mode: 'V2_ACTIVE', stateVersion: 7 }, { failSerializableOnce: true })
  const result = await runOpsPrintModeAction(state.db, {
    tenantId: 'tenant-a', storeId: 'store-a', operatorAdminId: 'ops-admin-a', operatorRole: 'OPS_ADMIN',
    expectedStateVersion: 7, action: 'START_ACTIVATION',
  }, now)
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.code, 'CONCURRENT_STATE_CHANGE')
    assert.equal(result.controlPlane.mode, 'V2_ACTIVE')
    assert.equal(result.controlPlane.stateVersion, 7)
  }
  assert.equal(state.audits.length, 0)
})

const recoveryBase = {
  confirmed: true,
  requestId: 'request-review-01',
  expectedStateVersion: 9,
  reason: 'EXPIRED_UNEXECUTED_FRONT_RECOVERY',
  jobIds: ['test-job-002', 'test-job-001'],
}
const testInstallationId = 'test-diamond-installation'
const fixtureJobIds = ['test-job-001', 'test-job-002']
const keyForFixture = (id: string) => 'network:' + createHash('sha256')
  .update('cashier-network-v2:order-' + id + ':FRONT').digest('hex')
const recoveryCapture = {
  captureId: 'windows-capture-001',
  deviceId: 'test-device-01',
  ownerEpoch: 4,
  releasedAt: '2026-01-02T23:59:00.000Z',
  releasedBatchId: 'test-old-batch',
  jobs: fixtureJobIds.map(id => ({
    id, key: keyForFixture(id), requestHash: 'f'.repeat(64), updatedAt: '2026-01-01T00:00:00.000Z',
  })),
  capturedAt: '2026-01-03T00:00:00.000Z',
  deviceObservedAt: '2026-01-03T00:00:00.000Z',
  historyVerifiedFrom: '2026-01-01T00:00:00.000Z',
  ledgerSha256: 'a'.repeat(64),
  outboxSha256: 'b'.repeat(64),
  verifiedNoLocalExecution: true,
}

function recoveryCommand(body: unknown) {
  const parsed = parseOpsV3QueueRecoveryCommand(body)
  assert.ok(parsed?.ok)
  return parsed.value
}

test('queue recovery envelope rejects duplicates, untrusted scope/actor overrides and missing evidence', () => {
  const request = { ...recoveryBase, action: 'REVIEW_EXPIRED_V3_FRONT_EVIDENCE', installationId: testInstallationId, capture: recoveryCapture }
  assert.deepEqual(recoveryCommand(request).jobIds, ['test-job-001', 'test-job-002'])
  for (const input of [
    { ...request, jobIds: ['test-job-001', 'test-job-001'] },
    { ...request, jobIds: [] },
    { ...request, confirmed: false },
    { ...request, installationId: undefined },
    { ...request, storeId: 'other-store' },
    { ...request, reviewerId: 'other-admin' },
    { ...request, capture: { ...recoveryCapture, verifiedNoLocalExecution: false } },
    { ...request, capture: { ...recoveryCapture, ledgerSha256: 'invalid' } },
    { ...recoveryBase, action: 'EXPIRE_UNEXECUTED_V3_FRONT' },
  ]) {
    assert.deepEqual(parseOpsV3QueueRecoveryCommand(input), { ok: false, code: 'INVALID_QUEUE_RECOVERY_COMMAND' })
  }
  assert.equal(parseOpsV3QueueRecoveryCommand({ action: 'FINALIZE_V3_ACTIVE' }), null)
})

test('Founder emergency commands remain distinct from the two-Ops commands', () => {
  const review = { ...recoveryBase, action: 'FOUNDER_REVIEW_DIAMOND_EXPIRED_FRONT',
    installationId: testInstallationId, capture: recoveryCapture }
  assert.equal(recoveryCommand(review).action, review.action)
  assert.equal(recoveryCommand({ ...recoveryBase, action: 'FOUNDER_EXPIRE_DIAMOND_UNEXECUTED_FRONT',
    evidenceId: 'review-evidence-01' }).action, 'FOUNDER_EXPIRE_DIAMOND_UNEXECUTED_FRONT')
  for (const body of [
    { ...review, founderOverride: true },
    { ...review, confirmed: false },
    { ...review, capture: { ...recoveryCapture, verifiedNoLocalExecution: false } },
    { ...recoveryBase, action: 'FOUNDER_EXPIRE_DIAMOND_UNEXECUTED_FRONT' },
  ]) assert.deepEqual(parseOpsV3QueueRecoveryCommand(body), { ok: false, code: 'INVALID_QUEUE_RECOVERY_COMMAND' })
})

const recoverySocket = process.env.DIAMOND_QUEUE_TEST_SOCKET

test('only formal EXPIRE gets a bounded transaction budget; REVIEW keeps its existing policy', async () => {
  const marker = new Error('TRANSACTION_OPTIONS_CAPTURED')
  const observed: unknown[] = []
  const db = { $transaction: async (_work: unknown, options: unknown) => {
    observed.push(options)
    throw marker
  } } as unknown as Pick<PrismaClient, '$transaction'>
  for (const [action, role] of [
    ['REVIEW_EXPIRED_V3_FRONT_EVIDENCE', 'OPS_ADMIN'],
    ['EXPIRE_UNEXECUTED_V3_FRONT', 'OPS_ADMIN'],
    ['FOUNDER_REVIEW_DIAMOND_EXPIRED_FRONT', 'SUPER_ADMIN'],
    ['FOUNDER_EXPIRE_DIAMOND_UNEXECUTED_FRONT', 'SUPER_ADMIN'],
  ] as const) {
    const command = recoveryCommand({ ...recoveryBase, action,
      ...(action.includes('REVIEW') ? { installationId: testInstallationId, capture: recoveryCapture } : { evidenceId: 'test-evidence-01' }),
    })
    await assert.rejects(runOpsV3QueueRecovery(db, { tenantId: 'test-tenant', storeId: 'test-store' },
      { id: 'test-operator', role }, command), error => error === marker)
  }
  assert.deepEqual(observed, [
    { isolationLevel: 'Serializable' }, { isolationLevel: 'Serializable', timeout: 10_000 },
    { isolationLevel: 'Serializable' }, { isolationLevel: 'Serializable', timeout: 10_000 },
  ])
})

test('queue recovery serializable guards and claim race in isolated PostgreSQL', {
  skip: !recoverySocket && 'requires the dedicated DIAMOND_QUEUE_TEST_SOCKET fixture',
}, async t => {
  assert.match(recoverySocket!, /^\/private\/tmp\/diamond-v3-queue-pg\.[A-Za-z0-9]+$/)
  const previousSecret = process.env.DESKTOP_DEVICE_TOKEN_SECRET
  process.env.DESKTOP_DEVICE_TOKEN_SECRET = 'isolated-postgres-fixture-secret-never-production'
  t.after(() => {
    if (previousSecret === undefined) delete process.env.DESKTOP_DEVICE_TOKEN_SECRET
    else process.env.DESKTOP_DEVICE_TOKEN_SECRET = previousSecret
  })
  const fixtureSchema = 'queue_test_' + randomUUID().replaceAll('-', '')
  const pool = new pg.Pool({
    host: recoverySocket, port: 55483, database: 'es_diamond_v3_queue_test',
    max: 5, application_name: 'diamond-queue-recovery-test', options: '-c search_path=' + fixtureSchema,
  })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool, { schema: fixtureSchema }) })
  t.after(async () => { await prisma.$disconnect(); await pool.end() })
  const scope = { tenantId: 'test-tenant', storeId: 'test-store' }
  const reviewer = { id: 'test-ops-reviewer', role: 'OPS_ADMIN' }
  const executor = { id: 'test-ops-executor', role: 'OPS_ADMIN' }
  const startedAt = new Date('2026-01-03T00:00:05.000Z')
  const receiptTime = new Date(recoveryCapture.historyVerifiedFrom)
  const originalExpiry = new Date('2026-01-02T00:00:00.000Z')
  const releaseTime = new Date('2026-01-02T23:59:00.000Z')
  const raw = { payloadBase64: 'AQ==', byteLength: 1, payloadHash: createHash('sha256').update(Buffer.from([1])).digest('hex') }
  const originalKeys = new Map<string, string>()
  const jobIds = fixtureJobIds
  const reviewCommand = recoveryCommand({
    ...recoveryBase, action: 'REVIEW_EXPIRED_V3_FRONT_EVIDENCE', installationId: testInstallationId, capture: recoveryCapture,
  })
  const run = (command: ReturnType<typeof recoveryCommand>, actor = executor, at = startedAt, useScope = scope) =>
    runOpsV3QueueRecovery(prisma, useScope, actor, command, () => at)

  // Disposable fixture schema only, never a migration or an existing database.
  const identity = await pool.query('SELECT current_database() AS name, inet_server_addr() AS addr')
  assert.deepEqual(identity.rows, [{ name: 'es_diamond_v3_queue_test', addr: null }])
  await pool.query(`CREATE SCHEMA "${fixtureSchema}"`)
  await pool.query(`
    CREATE TYPE "DesktopDeviceStatus" AS ENUM ('ACTIVE', 'REVOKED');
    CREATE TYPE "StoreStatus" AS ENUM ('ACTIVE', 'DISABLED');
    CREATE TYPE "RecordStatus" AS ENUM ('PENDING_PAYMENT', 'COMPLETED', 'CANCELLED');
    CREATE TYPE "SaleType" AS ENUM ('SALE', 'REFUND');
    CREATE TYPE "LogStatus" AS ENUM ('SUCCESS', 'FAILED');
    CREATE TYPE "EshopTrayPrintJobStatus" AS ENUM ('PENDING', 'CLAIMED', 'EXECUTING', 'SUCCEEDED', 'FAILED', 'EXPIRED');
    CREATE TABLE "Store" ("id" text PRIMARY KEY, "tenantId" text NOT NULL, "code" text NOT NULL, "status" "StoreStatus" NOT NULL);
    CREATE TABLE "OpsAdmin" ("id" text PRIMARY KEY, "status" text NOT NULL, "role" text NOT NULL);
    CREATE TABLE "DesktopDevice" ("id" text PRIMARY KEY, "tenantId" text NOT NULL, "storeId" text NOT NULL, "status" "DesktopDeviceStatus" NOT NULL, "installationIdHash" char(64) NOT NULL);
    CREATE TABLE "SaleRecord" ("id" text PRIMARY KEY, "tenantId" text NOT NULL, "storeId" text NOT NULL, "orderNo" text NOT NULL, "recordNo" text NOT NULL, "status" "RecordStatus" NOT NULL, "saleType" "SaleType" NOT NULL, "createdAt" timestamp(3) NOT NULL);
    CREATE TABLE "V3PrintControlPlane" (
      "id" text PRIMARY KEY, "tenantId" text NOT NULL, "storeId" text UNIQUE NOT NULL, "ownerDeviceId" text,
      "ownerEpoch" integer NOT NULL, "leaseId" text, "leaseExpiresAt" timestamp(3), "mode" text NOT NULL,
      "stateVersion" integer NOT NULL, "handoffRequestedAt" timestamp(3), "handoffQuarantineUntil" timestamp(3),
      "lastReconciledAt" timestamp(3), "createdAt" timestamp(3) NOT NULL, "updatedAt" timestamp(3) NOT NULL
    );
    CREATE TABLE "V3PrintExecutionBatch" (
      "id" text PRIMARY KEY, "controlPlaneId" text NOT NULL, "tenantId" text NOT NULL, "storeId" text NOT NULL,
      "ownerDeviceId" text NOT NULL, "ownerEpoch" integer NOT NULL, "stateVersion" integer NOT NULL,
      "leaseId" text NOT NULL, "mode" text NOT NULL, "expiresAt" timestamp(3) NOT NULL,
      "revokedAt" timestamp(3), "createdAt" timestamp(3) NOT NULL
    );
    CREATE TABLE "EshopTrayPrintJob" (
      "id" text PRIMARY KEY, "tenantId" text NOT NULL, "storeId" text NOT NULL,
      "idempotencyKey" text NOT NULL, "requestHash" char(64) NOT NULL, "schemaVersion" integer NOT NULL,
      "payload" jsonb NOT NULL, "kitchenJobSuppressed" boolean DEFAULT false NOT NULL,
      "status" "EshopTrayPrintJobStatus" NOT NULL, "claimedByComputerBindingId" text, "claimTokenHash" char(64),
      "claimAttempt" integer DEFAULT 0 NOT NULL, "leaseExpiresAt" timestamp(3), "attemptCount" integer DEFAULT 0 NOT NULL,
      "maxAttempts" integer DEFAULT 1 NOT NULL, "nextAttemptAt" timestamp(3) NOT NULL, "expiresAt" timestamp(3) NOT NULL,
      "executingAt" timestamp(3), "completedAt" timestamp(3), "resultStatus" text, "resultCode" text, "resultMessage" text,
      "effectBoundary" text, "physicalCompletionKnown" boolean DEFAULT false NOT NULL,
      "createdAt" timestamp(3) NOT NULL, "updatedAt" timestamp(3) NOT NULL, UNIQUE ("tenantId", "storeId", "idempotencyKey")
    );
    CREATE TABLE "OperationLog" (
      "id" text PRIMARY KEY, "tenantId" text NOT NULL, "storeId" text, "userId" text, "actionType" text NOT NULL,
      "targetType" text NOT NULL, "targetId" text, "requestId" text, "status" "LogStatus" NOT NULL,
      "message" text, "payloadSnapshot" jsonb, "createdAt" timestamp(3) DEFAULT now() NOT NULL, "saleRecordId" text
    );
  `)

  async function reset() {
    await pool.query(`
      TRUNCATE "Store", "OpsAdmin", "DesktopDevice", "SaleRecord", "V3PrintControlPlane", "V3PrintExecutionBatch", "EshopTrayPrintJob", "OperationLog";
      INSERT INTO "Store" VALUES ('test-store','test-tenant','TEST','ACTIVE');
      INSERT INTO "OpsAdmin" VALUES ('test-ops-reviewer','ACTIVE','OPS_ADMIN'), ('test-ops-executor','ACTIVE','OPS_ADMIN');
    `)
    await pool.query(`INSERT INTO "DesktopDevice" VALUES ('test-device-01','test-tenant','test-store','ACTIVE',$1)`,
      [hashInstallationId(testInstallationId)])
    await prisma.v3PrintControlPlane.create({ data: {
      ...scope, id: 'test-plane-01', mode: 'BLOCKED_UNKNOWN', ownerEpoch: 4, stateVersion: 9,
      handoffRequestedAt: releaseTime, createdAt: receiptTime, updatedAt: releaseTime,
    } })
    await prisma.v3PrintExecutionBatch.create({ data: {
      ...scope, id: 'test-old-batch', controlPlaneId: 'test-plane-01', ownerDeviceId: recoveryCapture.deviceId,
      ownerEpoch: 4, stateVersion: 8, leaseId: 'test-lease-01', mode: 'V3_ACTIVE',
      expiresAt: startedAt, revokedAt: releaseTime, createdAt: receiptTime,
    } })
    for (const id of jobIds) {
      const orderNo = 'order-' + id
      const key = keyForFixture(id)
      originalKeys.set(id, key)
      await pool.query('INSERT INTO "SaleRecord" VALUES ($1,$2,$3,$4,$4,\'COMPLETED\',\'SALE\',$5)', [
        id, scope.tenantId, scope.storeId, orderNo, receiptTime.toISOString().slice(0, -1),
      ])
      await prisma.eshopTrayPrintJob.create({ data: {
        ...scope, id, idempotencyKey: key, requestHash: 'f'.repeat(64), schemaVersion: 3, maxAttempts: 1,
        payload: { schemaVersion: 3, source: 'LOCAL_DESKTOP', role: 'FRONT', payloadKind: 'RAW_BYTES',
          orderNo, printJobId: key, rendererVersion: 'network-1', ...raw },
        expiresAt: originalExpiry, nextAttemptAt: receiptTime, createdAt: receiptTime, updatedAt: receiptTime,
      } })
    }
  }

  async function register() {
    const result = await run(reviewCommand, reviewer)
    assert.ok(result.ok, JSON.stringify(result))
    return recoveryCommand({ ...recoveryBase, action: 'EXPIRE_UNEXECUTED_V3_FRONT',
      evidenceId: result.evidenceId, requestId: 'request-expire-01' })
  }

  async function assertNoExpiry() {
    assert.equal(await prisma.eshopTrayPrintJob.count({ where: { status: 'EXPIRED' } }), 0)
    assert.equal(await prisma.operationLog.count({ where: { actionType: 'EXPIRE_UNEXECUTED_V3_FRONT' } }), 0)
  }

  // Real isolated PostgreSQL transactions. Delay is injected at the same
  // boundary as the Production failure: after job writes, before SUCCESS audit.
  function delayedExpiryDb(options: { delayMs: number; legacyBudget?: boolean; failAudit?: boolean; mismatchLastRow?: boolean }) {
    const budgets: unknown[] = []
    let updateCalls = 0
    let auditAttempts = 0
    const db = {
      $transaction: (<T>(work: (tx: Prisma.TransactionClient) => Promise<T>, config?: {
        isolationLevel?: Prisma.TransactionIsolationLevel; timeout?: number
      }) => {
        budgets.push(config)
        return prisma.$transaction(async tx => {
          const wrapped = new Proxy(tx, {
            get(target, key) {
              if (key === 'eshopTrayPrintJob') return {
                ...target.eshopTrayPrintJob,
                updateMany: async (args: Prisma.EshopTrayPrintJobUpdateManyArgs) => {
                  updateCalls++
                  if (options.mismatchLastRow) {
                    // A CAS mismatch after validation must undo every row,
                    // including any rows that did match the single statement.
                    await target.eshopTrayPrintJob.update({ where: { id: jobIds[1] },
                      data: { updatedAt: new Date(receiptTime.getTime() + 1) } })
                  }
                  return target.eshopTrayPrintJob.updateMany(args)
                },
              }
              if (key === 'operationLog') return {
                ...target.operationLog,
                create: async (args: Prisma.OperationLogCreateArgs) => {
                  if (args.data.actionType === 'EXPIRE_UNEXECUTED_V3_FRONT') {
                    auditAttempts++
                    if (options.delayMs) await new Promise(resolve => setTimeout(resolve, options.delayMs))
                    if (options.failAudit) throw new Error('INJECTED_EXPIRE_AUDIT_FAILURE')
                  }
                  return target.operationLog.create(args)
                },
              }
              return Reflect.get(target, key)
            },
          })
          return work(wrapped)
        }, { ...config, ...(options.legacyBudget ? { timeout: 5_000 } : {}) })
      }) as PrismaClient['$transaction'],
    }
    return { db, budgets, updateCalls: () => updateCalls, auditAttempts: () => auditAttempts }
  }

  await t.test('slow EXPIRE reproduces the 5000ms audit-boundary timeout and rolls back all writes', async () => {
    await reset()
    const action = await register()
    const delayed = delayedExpiryDb({ delayMs: 5_700, legacyBudget: true })
    await assert.rejects(runOpsV3QueueRecovery(delayed.db, scope, executor, action, () => startedAt),
      (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === 'P2028')
    assert.equal(delayed.updateCalls(), 1)
    assert.equal(delayed.auditAttempts(), 1)
    await assertNoExpiry()
    assert.equal(await prisma.eshopTrayPrintJob.count({ where: { status: 'PENDING', attemptCount: 0, claimAttempt: 0 } }), 2)
  })

  await t.test('slow EXPIRE commits job batch plus audit within the new budget and exact replay does not write again', async () => {
    await reset()
    const action = await register()
    const delayed = delayedExpiryDb({ delayMs: 5_700 })
    const completed = await runOpsV3QueueRecovery(delayed.db, scope, executor, action, () => startedAt)
    assert.ok(completed.ok, JSON.stringify(completed))
    assert.deepEqual(delayed.budgets, [{ isolationLevel: 'Serializable', timeout: 10_000 }])
    assert.equal(delayed.updateCalls(), 1)
    assert.equal(delayed.auditAttempts(), 1)
    assert.equal(await prisma.eshopTrayPrintJob.count({ where: { status: 'EXPIRED', effectBoundary: 'NOT_CROSSED' } }), 2)
    assert.equal(await prisma.operationLog.count({ where: { actionType: 'EXPIRE_UNEXECUTED_V3_FRONT' } }), 1)
    assert.deepEqual(await runOpsV3QueueRecovery(delayed.db, scope, executor, action, () => startedAt), completed)
    assert.equal(delayed.updateCalls(), 1)
    assert.equal(delayed.auditAttempts(), 1)
  })

  await t.test('EXPIRE still times out and rolls back beyond the bounded 10000ms budget', async () => {
    await reset()
    const action = await register()
    const delayed = delayedExpiryDb({ delayMs: 10_300 })
    await assert.rejects(runOpsV3QueueRecovery(delayed.db, scope, executor, action, () => startedAt),
      (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === 'P2028')
    assert.equal(delayed.updateCalls(), 1)
    await assertNoExpiry()
  })

  await t.test('partial CAS and audit failure each roll back the entire EXPIRE batch without consuming evidence', async () => {
    await reset()
    let action = await register()
    let delayed = delayedExpiryDb({ delayMs: 0, mismatchLastRow: true })
    assert.deepEqual(await runOpsV3QueueRecovery(delayed.db, scope, executor, action, () => startedAt),
      { ok: false, code: 'QUEUE_JOB_CONCURRENT_CHANGE' })
    await assertNoExpiry()
    await reset()
    action = await register()
    delayed = delayedExpiryDb({ delayMs: 0, failAudit: true })
    await assert.rejects(runOpsV3QueueRecovery(delayed.db, scope, executor, action, () => startedAt),
      /INJECTED_EXPIRE_AUDIT_FAILURE/)
    await assertNoExpiry()
    assert.equal((await run(action)).ok, true)
  })

  await t.test('expiry and authenticated scoped fresh independent evidence are required', async () => {
    await reset()
    await prisma.v3PrintControlPlane.updateMany({ data: { handoffRequestedAt: receiptTime } })
    const earlyTime = new Date(originalExpiry.getTime() - 5000)
    const early = recoveryCommand({ ...recoveryBase, action: 'REVIEW_EXPIRED_V3_FRONT_EVIDENCE', installationId: testInstallationId, capture: {
      ...recoveryCapture, releasedAt: receiptTime.toISOString(), capturedAt: earlyTime.toISOString(), deviceObservedAt: earlyTime.toISOString(),
    } })
    assert.deepEqual(await run(early, reviewer, earlyTime), { ok: false, code: 'QUEUE_JOB_NOT_EXPIRED' })
    await reset()
    assert.deepEqual(await run(reviewCommand, { ...reviewer, role: 'SUPER_ADMIN' }), { ok: false, code: 'QUEUE_RECOVERY_FORBIDDEN' })
    assert.deepEqual(await run(recoveryCommand({ ...reviewCommand, installationId: 'wrong-installation', confirmed: true }), reviewer),
      { ok: false, code: 'EVIDENCE_DEVICE_INVALID' })
    const missing = recoveryCommand({ ...recoveryBase, action: 'EXPIRE_UNEXECUTED_V3_FRONT',
      requestId: 'request-missing-01', evidenceId: 'fake-evidence-id' })
    assert.deepEqual(await run(missing), { ok: false, code: 'QUEUE_EVIDENCE_REQUIRED' })
    const action = await register()
    assert.deepEqual(await run(action, reviewer), { ok: false, code: 'QUEUE_EVIDENCE_INDEPENDENCE_REQUIRED' })
    assert.deepEqual(await run(action, executor, new Date(startedAt.getTime() + 301_000)), { ok: false, code: 'QUEUE_EVIDENCE_STALE' })
    assert.deepEqual(await run(action, executor, startedAt, { ...scope, storeId: 'wrong-store' }), { ok: false, code: 'QUEUE_CONTROL_PLANE_UNAVAILABLE' })
    assert.deepEqual(await run({ ...action, expectedStateVersion: 8 }), { ok: false, code: 'CONCURRENT_STATE_CHANGE' })
    assert.deepEqual(await run({ ...action, jobIds: ['test-wrong-id'] }), { ok: false, code: 'QUEUE_JOB_SCOPE_MISMATCH' })
    assert.deepEqual(await run({ ...action, jobIds: ['test-job-001'] }), { ok: false, code: 'QUEUE_EVIDENCE_JOB_MISMATCH' })
    assert.deepEqual(await run({ ...reviewCommand, requestId: 'request-reused-capture' }, reviewer), { ok: false, code: 'QUEUE_EVIDENCE_CAPTURE_REUSED' })
    assert.deepEqual(await run(recoveryCommand({
      ...recoveryBase, requestId: 'request-redated-capture', action: 'REVIEW_EXPIRED_V3_FRONT_EVIDENCE',
      installationId: testInstallationId, capture: {
        ...recoveryCapture, capturedAt: startedAt.toISOString(), deviceObservedAt: startedAt.toISOString(),
      },
    }), reviewer), { ok: false, code: 'QUEUE_EVIDENCE_CAPTURE_REUSED' })
    await assertNoExpiry()
  })

  await t.test('any claim, execution, ACK or crossing rejects the entire batch', async () => {
    for (const flags of [
      { claimAttempt: 1 }, { attemptCount: 1 }, { claimTokenHash: 'f'.repeat(64) },
      { executingAt: startedAt }, { resultStatus: 'CROSSED' }, { effectBoundary: 'CROSSING_UNKNOWN' },
      { completedAt: startedAt }, { resultMessage: 'V3_DURABLY_HELD' }, { physicalCompletionKnown: true },
    ]) {
      await reset()
      const action = await register()
      await prisma.eshopTrayPrintJob.update({ where: { id: jobIds[1] }, data: flags })
      assert.deepEqual(await run(action), { ok: false, code: 'QUEUE_JOB_NOT_UNEXECUTED' })
      await assertNoExpiry()
    }
  })

  await t.test('original receipt and full host history bind evidence and no live batch is allowed', async () => {
    await reset()
    await prisma.eshopTrayPrintJob.update({ where: { id: jobIds[1] }, data: { expiresAt: receiptTime, updatedAt: receiptTime } })
    assert.deepEqual(await run(reviewCommand, reviewer), { ok: false, code: 'QUEUE_RECEIPT_TTL_UNPROVEN' })
    await reset()
    assert.deepEqual(await run(recoveryCommand({
      ...recoveryBase, action: 'REVIEW_EXPIRED_V3_FRONT_EVIDENCE', installationId: testInstallationId,
      capture: { ...recoveryCapture, historyVerifiedFrom: originalExpiry.toISOString() },
    }), reviewer), { ok: false, code: 'EVIDENCE_HISTORY_INCOMPLETE' })
    await prisma.v3PrintExecutionBatch.update({ where: { id: 'test-old-batch' }, data: {
      revokedAt: null, expiresAt: new Date(startedAt.getTime() + 10_000),
    } })
    assert.deepEqual(await run(reviewCommand, reviewer), { ok: false, code: 'ACTIVE_EXECUTION_BATCH' })
    await assertNoExpiry()
  })

  await t.test('attestation rejects changed captured facts or another device with a cached batch', async () => {
    await reset()
    const review = (capture: typeof recoveryCapture) => run(recoveryCommand({
      ...recoveryBase, action: 'REVIEW_EXPIRED_V3_FRONT_EVIDENCE', installationId: testInstallationId, capture,
    }), reviewer)
    assert.deepEqual(await review({ ...recoveryCapture, ownerEpoch: 3 }), { ok: false, code: 'QUEUE_EVIDENCE_FENCE_MISMATCH' })
    assert.deepEqual(await review({ ...recoveryCapture, releasedBatchId: 'unknown-old-batch' }),
      { ok: false, code: 'QUEUE_RELEASE_EVIDENCE_MISSING' })
    assert.deepEqual(await review({
      ...recoveryCapture, jobs: recoveryCapture.jobs.map(job => ({ ...job, requestHash: '0'.repeat(64) })),
    }), { ok: false, code: 'QUEUE_EVIDENCE_JOB_MISMATCH' })
    await prisma.v3PrintExecutionBatch.create({ data: {
      ...scope, id: 'test-other-batch', controlPlaneId: 'test-plane-01', ownerDeviceId: 'test-old-device',
      ownerEpoch: 3, stateVersion: 6, leaseId: 'test-other-lease', mode: 'V3_ACTIVE',
      createdAt: new Date(receiptTime.getTime() - 120_000),
      revokedAt: new Date(receiptTime.getTime() - 60_000), expiresAt: originalExpiry,
    } })
    assert.deepEqual(await review(recoveryCapture), { ok: false, code: 'EVIDENCE_OTHER_EXECUTOR' })
    await assertNoExpiry()
  })

  await t.test('expiry of evidence during job updates rolls back the batch', async () => {
    await reset()
    const action = await register()
    let reads = 0
    const result = await runOpsV3QueueRecovery(prisma, scope, executor, action, () =>
      ++reads <= 2 ? startedAt : new Date(startedAt.getTime() + 301_000))
    assert.deepEqual(result, { ok: false, code: 'QUEUE_EVIDENCE_STALE' })
    await assertNoExpiry()
  })

  await t.test('concurrent durable claim wins and a preceding job update rolls back', async () => {
    await reset()
    const action = await register()
    const claimant = await pool.connect()
    try {
      await claimant.query('BEGIN')
      await claimant.query('UPDATE "EshopTrayPrintJob" SET "claimAttempt"=1, "attemptCount"=1, "claimTokenHash"=$1 WHERE id=$2', ['d'.repeat(64), jobIds[1]])
      const terminalize = run(action)
      let waiting = false
      for (let i = 0; i < 80 && !waiting; i++) {
        const activity = await pool.query(`
          SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name='diamond-queue-recovery-test'
            AND wait_event_type='Lock' AND query LIKE 'UPDATE %"EshopTrayPrintJob"%'
        `)
        waiting = activity.rows[0].n > 0
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 15))
      }
      await claimant.query('COMMIT')
      const result = await terminalize
      assert.equal(waiting, true, 'terminalization must contend on the actual PostgreSQL job lock')
      assert.deepEqual(result, { ok: false, code: 'CONCURRENT_STATE_CHANGE' })
    } finally {
      await claimant.query('ROLLBACK')
      claimant.release()
    }
    await assertNoExpiry()
    assert.equal((await prisma.eshopTrayPrintJob.findUniqueOrThrow({ where: { id: jobIds[1] } })).claimAttempt, 1)
  })

  await t.test('a real delayed REPORT and terminalization cannot overwrite each other', async () => {
    const report = (db: Parameters<typeof reportV3Execution>[0]) => reportV3Execution(db, {
      ...scope, batchId: 'test-old-batch', deviceId: recoveryCapture.deviceId,
    }, {
      printJobId: keyForFixture(jobIds[1]), role: 'FRONT', source: 'LOCAL_DESKTOP',
      executionId: 'test-late-execution', ownerEpoch: 4, reportVersion: 1, outcome: 'CROSSED',
    }, startedAt)

    for (const winner of ['report', 'expiry'] as const) {
      await reset()
      const action = await register()
      let ready!: () => void
      let release!: () => void
      const readyToCommit = new Promise<void>(resolve => { ready = resolve })
      const unblock = new Promise<void>(resolve => { release = resolve })
      const holdCommit = async <T>(work: (tx: Prisma.TransactionClient) => Promise<T>, isolationLevel?: Prisma.TransactionIsolationLevel) =>
        prisma.$transaction(async tx => {
          const result = await work(tx)
          ready()
          await unblock
          return result
        }, { isolationLevel, timeout: 10_000 })
      const expiryDb = {
        $transaction: (<T>(work: (tx: Prisma.TransactionClient) => Promise<T>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel }) =>
          holdCommit(work, options?.isolationLevel)) as PrismaClient['$transaction'],
      }
      const first = winner === 'report'
        ? holdCommit(tx => report(tx as unknown as Parameters<typeof reportV3Execution>[0]))
        : runOpsV3QueueRecovery(expiryDb, scope, executor, action, () => startedAt)
      let second: Promise<unknown> | undefined
      try {
        await Promise.race([readyToCommit, first.then(() => { throw new Error('winner exited before taking the job lock') })])
        second = winner === 'report' ? run(action) : report(prisma as unknown as Parameters<typeof reportV3Execution>[0])
        let waiting = false
        for (let i = 0; i < 80 && !waiting; i++) {
          const activity = await pool.query(`
            SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name='diamond-queue-recovery-test'
              AND wait_event_type='Lock' AND query LIKE 'UPDATE %"EshopTrayPrintJob"%'
          `)
          waiting = activity.rows[0].n > 0
          if (!waiting) await new Promise(resolve => setTimeout(resolve, 15))
        }
        assert.equal(waiting, true)
      } finally {
        release()
      }
      assert.equal((await first).ok, true)
      assert.deepEqual(await second, {
        ok: false, code: winner === 'report' ? 'CONCURRENT_STATE_CHANGE' : 'V3_REPORT_RACE',
      })
      if (winner === 'report') {
        await assertNoExpiry()
        assert.equal((await prisma.eshopTrayPrintJob.findUniqueOrThrow({ where: { id: jobIds[1] } })).effectBoundary, 'CROSSED')
      } else {
        assert.equal(await prisma.eshopTrayPrintJob.count({ where: { status: 'EXPIRED' } }), 2)
      }
    }
  })

  await t.test('audit failure rolls back both updates and preserves the one-use evidence', async () => {
    await reset()
    const action = await register()
    await pool.query(`ALTER TABLE "OperationLog" ADD CONSTRAINT test_no_expiry_audit CHECK ("actionType" <> 'EXPIRE_UNEXECUTED_V3_FRONT')`)
    try {
      await assert.rejects(run(action))
      await assertNoExpiry()
    } finally {
      await pool.query('ALTER TABLE "OperationLog" DROP CONSTRAINT test_no_expiry_audit')
    }
    assert.equal((await run(action)).ok, true)
  })

  await t.test('terminalization preserves immutable identities, fences late reports and cannot redeliver', async () => {
    await reset()
    const before = await prisma.eshopTrayPrintJob.findMany({ orderBy: { id: 'asc' } })
    const action = await register()
    const result = await run(action)
    assert.ok(result.ok, JSON.stringify(result))
    assert.deepEqual(await run(action, executor, new Date(startedAt.getTime() + 301_000)), result)
    const jobs = await prisma.eshopTrayPrintJob.findMany({ orderBy: { id: 'asc' } })
    for (const [i, job] of jobs.entries()) {
      assert.equal(job.status, 'EXPIRED')
      assert.equal(job.effectBoundary, 'NOT_CROSSED')
      assert.equal(job.idempotencyKey, originalKeys.get(job.id))
      assert.deepEqual(job.payload, before[i].payload)
      assert.equal(job.requestHash, before[i].requestHash)
      assert.equal(job.claimAttempt, 0)
      assert.equal(job.attemptCount, 0)
      assert.equal(job.physicalCompletionKnown, false)
      assert.deepEqual(classifyV3OperatorPrintJob(job, job.idempotencyKey, recoveryCapture.deviceId), {
        originalJobId: job.idempotencyKey, state: 'AMBIGUOUS', localProofEligible: false,
      })
      assert.equal(await issueV3OperatorRecoveryProofWithDb(prisma, {
        ...scope, desktopDeviceId: recoveryCapture.deviceId,
      }, {
        orderNo: 'order-' + job.id, role: 'FRONT', originalJobId: job.idempotencyKey, localEvidence: 'LEDGER_ABSENT',
      }, startedAt), null)
      assert.deepEqual(await reportV3Execution(prisma as unknown as Parameters<typeof reportV3Execution>[0], {
        ...scope, batchId: 'test-old-batch', deviceId: recoveryCapture.deviceId,
      }, {
        printJobId: job.idempotencyKey, role: 'FRONT', source: 'LOCAL_DESKTOP', executionId: 'late-execution',
        ownerEpoch: 4, reportVersion: 1, outcome: 'CROSSED',
      }, startedAt), { ok: false, code: 'V3_REPORT_CONFLICT' })
    }
    assert.equal((await prisma.v3PrintControlPlane.findUniqueOrThrow({ where: { storeId: scope.storeId } })).mode, 'BLOCKED_UNKNOWN')
    assert.equal(await prisma.operationLog.count({ where: { actionType: 'EXPIRE_UNEXECUTED_V3_FRONT' } }), 1)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM "SaleRecord"')).rows[0].n, 2)

    // Move only the isolated synthetic fixture into the state a later Ops finalize/acquire would produce.
    const expiresAt = new Date(startedAt.getTime() + 60_000)
    await prisma.v3PrintControlPlane.updateMany({ data: {
      mode: 'V3_ACTIVE', ownerDeviceId: recoveryCapture.deviceId, ownerEpoch: 5,
      stateVersion: 11, leaseId: 'test-new-lease', leaseExpiresAt: expiresAt,
    } })
    await prisma.v3PrintExecutionBatch.create({ data: {
      ...scope, id: 'test-new-batch', controlPlaneId: 'test-plane-01', ownerDeviceId: recoveryCapture.deviceId,
      ownerEpoch: 5, stateVersion: 11, leaseId: 'test-new-lease', mode: 'V3_ACTIVE', expiresAt, createdAt: startedAt,
    } })
    assert.deepEqual(await deliverV3PrintIntent(prisma as unknown as Parameters<typeof deliverV3PrintIntent>[0], {
      ...scope, batchId: 'test-new-batch', deviceId: recoveryCapture.deviceId, role: 'FRONT',
    }, startedAt), { ok: true, job: null })
  })

  await t.test('exact Diamond Founder authority is single-use, scoped, audited and preserves the two-Ops path', async () => {
    await reset()
    const founderScope = { tenantId: scope.tenantId, storeId: 'cmvulpn8r000106jvpo58kye4' }
    const founderDeviceId = 'cmvyx1jes000208l14t5vf9ur'
    const founderIds = [
      'cmw0jlsme000v08kzgyiybcqg', 'cmw0k7dgw001c08kz5xirfxzv', 'cmw0kwwta001v08jv6q6rl2f4',
    ]
    const founder = { id: 'real-founder-admin', role: 'SUPER_ADMIN' }
    await pool.query(`INSERT INTO "OpsAdmin" VALUES ($1,'ACTIVE','SUPER_ADMIN')`, [founder.id])
    await pool.query('UPDATE "Store" SET "id"=$1, "code"=$2', [founderScope.storeId, 'ST883DC00C'])
    await prisma.v3PrintControlPlane.updateMany({ data: { storeId: founderScope.storeId } })
    await pool.query('UPDATE "DesktopDevice" SET "id"=$1, "storeId"=$2', [founderDeviceId, founderScope.storeId])
    await prisma.v3PrintExecutionBatch.updateMany({ data: { storeId: founderScope.storeId, ownerDeviceId: founderDeviceId } })
    await prisma.eshopTrayPrintJob.deleteMany()
    await pool.query('DELETE FROM "SaleRecord"')
    for (const id of founderIds) {
      const orderNo = 'order-' + id
      const key = keyForFixture(id)
      await pool.query('INSERT INTO "SaleRecord" VALUES ($1,$2,$3,$4,$4,\'COMPLETED\',\'SALE\',$5)', [
        id, founderScope.tenantId, founderScope.storeId, orderNo, receiptTime.toISOString().slice(0, -1),
      ])
      await prisma.eshopTrayPrintJob.create({ data: {
        ...founderScope, id, idempotencyKey: key, requestHash: 'f'.repeat(64), schemaVersion: 3, maxAttempts: 1,
        payload: { schemaVersion: 3, source: 'LOCAL_DESKTOP', role: 'FRONT', payloadKind: 'RAW_BYTES',
          orderNo, printJobId: key, rendererVersion: 'network-1', ...raw },
        expiresAt: originalExpiry, nextAttemptAt: receiptTime, createdAt: receiptTime, updatedAt: receiptTime,
      } })
    }
    const capture = { ...recoveryCapture, verifiedNoLocalExecution: true as const, deviceId: founderDeviceId,
      jobs: founderIds.map(id => ({ id, key: keyForFixture(id), requestHash: 'f'.repeat(64),
        updatedAt: receiptTime.toISOString() })) }
    const review = recoveryCommand({ ...recoveryBase, action: 'FOUNDER_REVIEW_DIAMOND_EXPIRED_FRONT',
      jobIds: founderIds, capture, installationId: testInstallationId, requestId: 'founder-review-01' })
    const founderRun = (command: ReturnType<typeof recoveryCommand>, actor = founder, at = startedAt, useScope = founderScope) =>
      runOpsV3QueueRecovery(prisma, useScope, actor, command, () => at)
    assert.deepEqual(await founderRun(review, reviewer), { ok: false, code: 'QUEUE_RECOVERY_FORBIDDEN' })
    assert.deepEqual(await founderRun(review, founder, startedAt, scope), { ok: false, code: 'QUEUE_RECOVERY_FORBIDDEN' })
    await pool.query('UPDATE "Store" SET "code"=$1', ['OTHER-STORE'])
    assert.deepEqual(await founderRun(review), { ok: false, code: 'QUEUE_RECOVERY_FORBIDDEN' })
    await pool.query('UPDATE "Store" SET "code"=$1', ['ST883DC00C'])
    await pool.query('UPDATE "OpsAdmin" SET "status"=$1 WHERE "id"=$2', ['DISABLED', founder.id])
    assert.deepEqual(await founderRun(review), { ok: false, code: 'QUEUE_RECOVERY_FORBIDDEN' })
    await pool.query('UPDATE "OpsAdmin" SET "status"=$1 WHERE "id"=$2', ['ACTIVE', founder.id])
    assert.deepEqual(await founderRun({ ...review, jobIds: founderIds.slice(0, 2) }),
      { ok: false, code: 'QUEUE_RECOVERY_FORBIDDEN' })
    assert.deepEqual(await founderRun(recoveryCommand({ ...recoveryBase,
      action: 'FOUNDER_REVIEW_DIAMOND_EXPIRED_FRONT', jobIds: founderIds,
      requestId: 'founder-wrong-device', installationId: testInstallationId,
      capture: { ...capture, deviceId: 'test-device-01' },
    })),
      { ok: false, code: 'QUEUE_RECOVERY_FORBIDDEN' })
    const approved = await founderRun(review)
    assert.ok(approved.ok, JSON.stringify(approved))
    assert.deepEqual(await founderRun({ ...review, requestId: 'founder-second-review' }),
      { ok: false, code: 'FOUNDER_RECOVERY_ALREADY_AUTHORIZED' })
    const expiry = recoveryCommand({ ...recoveryBase, action: 'FOUNDER_EXPIRE_DIAMOND_UNEXECUTED_FRONT',
      jobIds: founderIds, evidenceId: approved.evidenceId, requestId: 'founder-expire-01' })
    assert.deepEqual(await founderRun(expiry, executor), { ok: false, code: 'QUEUE_RECOVERY_FORBIDDEN' })
    assert.deepEqual(await founderRun(expiry, founder, new Date(startedAt.getTime() + 301_000)),
      { ok: false, code: 'QUEUE_EVIDENCE_STALE' })
    const completed = await founderRun(expiry)
    assert.ok(completed.ok, JSON.stringify(completed))
    assert.equal(await prisma.eshopTrayPrintJob.count({ where: { status: 'EXPIRED', effectBoundary: 'NOT_CROSSED' } }), 3)
    const audit = await prisma.operationLog.findFirstOrThrow({ where: { actionType: 'FOUNDER_EXPIRE_DIAMOND_UNEXECUTED_FRONT' } })
    assert.equal((audit.payloadSnapshot as Record<string, unknown>).founderEmergency, true)
    assert.equal((audit.payloadSnapshot as Record<string, unknown>).executorId, founder.id)
    assert.deepEqual(await founderRun(expiry), completed)
    assert.deepEqual(await founderRun({ ...expiry, requestId: 'founder-expire-again' }),
      { ok: false, code: 'QUEUE_EVIDENCE_CONSUMED' })
    assert.equal(await prisma.operationLog.count({ where: { actionType: 'FOUNDER_EXPIRE_DIAMOND_UNEXECUTED_FRONT' } }), 1)
    const nextBatchExpiry = new Date(startedAt.getTime() + 60_000)
    await prisma.v3PrintControlPlane.updateMany({ data: {
      mode: 'V3_ACTIVE', ownerDeviceId: founderDeviceId, ownerEpoch: 5,
      stateVersion: 11, leaseId: 'founder-new-lease', leaseExpiresAt: nextBatchExpiry,
    } })
    await prisma.v3PrintExecutionBatch.create({ data: {
      ...founderScope, id: 'founder-new-batch', controlPlaneId: 'test-plane-01', ownerDeviceId: founderDeviceId,
      ownerEpoch: 5, stateVersion: 11, leaseId: 'founder-new-lease', mode: 'V3_ACTIVE',
      expiresAt: nextBatchExpiry, createdAt: startedAt,
    } })
    assert.deepEqual(await deliverV3PrintIntent(prisma as unknown as Parameters<typeof deliverV3PrintIntent>[0], {
      ...founderScope, batchId: 'founder-new-batch', deviceId: founderDeviceId, role: 'FRONT',
    }, startedAt), { ok: true, job: null })
  })
})
