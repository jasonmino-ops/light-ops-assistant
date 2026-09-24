import assert from 'node:assert/strict'
import test from 'node:test'
import {
  acquireV3Authority, controlledV3OwnerHandoff, issueV3ExecutionBatch,
  releaseV3Authority, renewV3Authority, transitionV3PrintMode, type V3ControlPlaneDb,
} from '../lib/v3-print-control-plane'
import {
  parseOpsPrintModeCommand,
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
  failModeCasAfterAudit?: boolean
  failSerializableOnce?: boolean
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
  let serializableFailureRemaining = options.failSerializableOnce === true
  const matches = (where: any) => Object.entries(where).every(([key, expected]: any) => {
    const actual = plane[key]
    if (expected && typeof expected === 'object' && 'gt' in expected) return actual instanceof Date && actual > expected.gt
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
        if (options.failAudit) throw new Error('AUDIT_WRITE_FAILED')
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
      try {
        return await operation(tx)
      } catch (error) {
        plane = beforePlane
        batches.splice(0, batches.length, ...beforeBatches)
        audits.splice(0, audits.length, ...beforeAudits)
        throw error
      }
    },
  }
  return { db, plane: () => ({ ...plane }), batches, audits, jobs, transactionOptions }
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
