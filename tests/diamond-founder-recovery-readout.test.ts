import assert from 'node:assert/strict'
import { before, test } from 'node:test'
import { NextRequest } from 'next/server'
import { signSession } from '../lib/session'
import { parseCapture, recoveryActions, type DiamondRecoveryReadout } from '../app/ops/[tenantId]/DiamondFounderRecoveryPanel'

const tenantId = 'diamond-tenant'
const storeId = 'cmvulpn8r000106jvpo58kye4'
const jobIds = [
  'cmw0jlsme000v08kzgyiybcqg',
  'cmw0k7dgw001c08kz5xirfxzv',
  'cmw0kwwta001v08jv6q6rl2f4',
]
const now = new Date()
const capturedAt = new Date(now.getTime() - 20_000).toISOString()
const plane = {
  id: 'plane-diamond', tenantId, storeId, mode: 'BLOCKED_UNKNOWN',
  ownerDeviceId: null, ownerEpoch: 1, leaseId: null, leaseExpiresAt: null,
  stateVersion: 696, handoffRequestedAt: new Date(now.getTime() - 100_000),
  handoffQuarantineUntil: null, lastReconciledAt: null, updatedAt: now,
}
const rows = jobIds.map(id => ({
  id, tenantId, storeId, schemaVersion: 3, status: 'PENDING', expiresAt: new Date(now.getTime() - 60_000),
  claimAttempt: 0, attemptCount: 0, claimedByComputerBindingId: null,
  claimTokenHash: null, leaseExpiresAt: null, executingAt: null, completedAt: null,
  resultStatus: null, resultCode: null, resultMessage: null,
  effectBoundary: null, physicalCompletionKnown: false,
  requestHash: 'NEVER_EXPOSE_REQUEST_HASH', idempotencyKey: 'NEVER_EXPOSE_KEY',
  payload: 'NEVER_EXPOSE_PAYLOAD',
}))
let role = 'SUPER_ADMIN'
let actorId = 'ops-founder'
let reviewedAt = capturedAt
let consumed = false
let activeStoreId = storeId
let reviewerId = 'ops-founder'
let fenceStateVersion = 696
let planeMissing = false
let missingJobId = ''
let projectionFails = false
let adminExists = true
const queries: { plane?: Record<string, unknown>; jobs?: Record<string, unknown>; review?: Record<string, unknown> } = {}

const fakePrisma = {
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fakePrisma),
  opsAdmin: {
    findUnique: async () => adminExists ? ({ id: actorId, name: 'Founder', role, status: 'ACTIVE',
      lockedUntil: null, sessionVersion: 0 }) : null,
  },
  store: {
    findFirst: async () => ({ id: activeStoreId, tenantId, code: activeStoreId === storeId ? 'ST883DC00C' : 'OTHER' }),
  },
  v3PrintControlPlane: {
    upsert: async () => ({ ...plane, storeId: activeStoreId }),
    findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      queries.plane = where
      return planeMissing || where.tenantId !== tenantId || where.storeId !== storeId
        ? null : { id: plane.id, stateVersion: plane.stateVersion, leaseId: null }
    },
  },
  v3PrintExecutionBatch: { findFirst: async () => null },
  desktopDevice: { count: async () => 1 },
  eshopTrayPrintJob: {
    count: async ({ where }: { where: { schemaVersion: unknown; status: string } }) =>
      where.schemaVersion === 3 && where.status === 'PENDING' ? 3 : 0,
    findMany: async ({ where }: { where: { tenantId: string; storeId: string; schemaVersion: number; id: { in: string[] } } }) => {
      queries.jobs = where
      if (projectionFails) throw new Error('test readout outage')
      return rows.filter(row => row.tenantId === where.tenantId && row.storeId === where.storeId
        && row.schemaVersion === where.schemaVersion && where.id?.in.includes(row.id) && row.id !== missingJobId)
    },
  },
  operationLog: {
    findFirst: async ({ where }: { where: { tenantId: string; storeId: string; targetId: string; status: string; actionType: string; payloadSnapshot?: { path: string[]; equals: string } } }) => {
      if (where.actionType === 'FOUNDER_REVIEW_DIAMOND_EXPIRED_FRONT') queries.review = where
      if (where.tenantId !== tenantId || where.storeId !== storeId || where.targetId !== plane.id
        || where.status !== 'SUCCESS') return null
      return where.actionType === 'FOUNDER_REVIEW_DIAMOND_EXPIRED_FRONT'
        ? {
          id: 'review-audit-id', requestId: 'review-request-id', createdAt: new Date(reviewedAt),
          payloadSnapshot: {
            reviewerId, founderEmergency: true,
            capture: { deviceId: 'cmvyx1jes000208l14t5vf9ur', capturedAt: reviewedAt,
              installationId: 'NEVER_EXPOSE', ledgerSha256: 'NEVER_EXPOSE' },
            fence: { stateVersion: fenceStateVersion }, jobs: jobIds.map(id => ({ id })),
          },
        }
        : where.actionType === 'FOUNDER_EXPIRE_DIAMOND_UNEXECUTED_FRONT' && consumed
          && where.payloadSnapshot?.path.join('.') === 'evidenceId'
          && where.payloadSnapshot.equals === 'review-audit-id'
          ? { id: 'expire-audit-id', requestId: 'expire-request-id', createdAt: now } : null
    },
  },
}

// The singleton is injected before importing the route; no database connection is made.
;(globalThis as unknown as { _prisma: unknown })._prisma = fakePrisma
let GET: typeof import('../app/api/ops/tenants/[tenantId]/stores/[storeId]/v3-print-control-plane/route').GET
before(async () => {
  const route = await import('../app/api/ops/tenants/[tenantId]/stores/[storeId]/v3-print-control-plane/route')
  const loaded = route as unknown as { GET?: typeof GET; default?: { GET: typeof GET } }
  GET = (loaded.GET ?? loaded.default!.GET)
})

async function read() {
  const request = new NextRequest(`http://localhost/api/ops/tenants/${tenantId}/stores/${activeStoreId}/v3-print-control-plane`, {
    headers: { Cookie: `auth-session=${signSession({
      tenantId, storeId: activeStoreId, userId: actorId,
      role: 'OWNER', opsRole: role, opsSessionVersion: 0,
    })}` },
  })
  const response = await GET(request, {
    params: Promise.resolve({ tenantId, storeId: activeStoreId }),
  })
  assert.equal(response.status, 200)
  return response.json()
}

test('exact FK-backed SUPER_ADMIN sees only three Diamond jobs and resumable audit metadata', async () => {
  const body = await read()
  assert.deepEqual(body.diamondRecovery.jobs.map((job: { id: string }) => job.id), jobIds)
  assert.equal(body.diamondRecovery.review.status, 'AVAILABLE')
  assert.equal(body.diamondRecovery.review.evidenceId, 'review-audit-id')
  assert.equal(body.diamondRecovery.leasePresent, false)
  assert.deepEqual(queries.plane, { tenantId, storeId })
  assert.deepEqual(queries.jobs, { tenantId, storeId, schemaVersion: 3, id: { in: jobIds } })
  assert.equal(queries.review?.targetId, plane.id)
  assert.equal(queries.review?.status, 'SUCCESS')
  assert.doesNotMatch(JSON.stringify(body.diamondRecovery), /NEVER_EXPOSE|installationId|ledgerSha256|outboxSha256|requestHash|idempotencyKey|payload/)
})

test('another SUPER_ADMIN review blocks the one-time grant without exposing its evidence ID', async () => {
  reviewerId = 'ops-other'
  const body = await read()
  assert.equal(body.diamondRecovery.review.status, 'OTHER_REVIEWER')
  assert.equal(body.diamondRecovery.review.evidenceId, null)
  assert.doesNotMatch(JSON.stringify(body.diamondRecovery), /review-audit-id|ops-other/)
  reviewerId = 'ops-founder'
})

test('a failed optional projection leaves the existing control plane available', async () => {
  projectionFails = true
  const body = await read()
  assert.equal(body.state.controlPlane.mode, 'BLOCKED_UNKNOWN')
  assert.equal(body.diamondRecovery, null)
  assert.equal(body.diamondRecoveryError, 'DIAMOND_RECOVERY_READ_FAILED')
  projectionFails = false
})

test('fence mismatch, missing plane and missing job fail closed in the readout', async () => {
  fenceStateVersion = 697
  assert.equal((await read()).diamondRecovery.review.status, 'UNKNOWN')
  fenceStateVersion = 696
  planeMissing = true
  const missingPlane = await read()
  assert.equal(missingPlane.diamondRecovery.leasePresent, null)
  assert.equal(missingPlane.diamondRecovery.review, null)
  planeMissing = false
  missingJobId = jobIds[0]
  assert.equal((await read()).diamondRecovery.jobs[0].status, 'MISSING')
  missingJobId = ''
})

test('client recovery actions reject another review, stale grants and changed fence', async () => {
  const readout = (await read()).diamondRecovery as DiamondRecoveryReadout
  const capture = parseCapture(JSON.stringify({
    captureId: 'capture-diamond', deviceId: readout.deviceId, ownerEpoch: 1,
    releasedAt: plane.handoffRequestedAt.toISOString(), releasedBatchId: 'batch-diamond',
    jobs: jobIds.map(id => ({ id, key: `network:${'a'.repeat(64)}`, requestHash: 'b'.repeat(64), updatedAt: capturedAt })),
    capturedAt, deviceObservedAt: capturedAt, historyVerifiedFrom: capturedAt,
    ledgerSha256: 'c'.repeat(64), outboxSha256: 'd'.repeat(64), verifiedNoLocalExecution: true,
  }))
  assert.ok(capture)
  const state = (await read()).state
  const base = { state, recovery: readout, clock: now.getTime(), capture,
    installationId: 'installation-diamond', grant: null, disabled: false, busy: false, blocked: false }
  assert.equal(recoveryActions(base).mayReview, false)
  assert.equal(recoveryActions(base).mayExpire, true)
  for (const status of ['EXPIRED', 'UNKNOWN', 'CONSUMED', 'OTHER_REVIEWER'] as const) {
    assert.equal(recoveryActions({ ...base, recovery: { ...readout, review: { ...readout.review!, status } } }).mayExpire, false)
  }
  assert.equal(recoveryActions({ ...base, grant: { evidenceId: 'review-audit-id', requestId: 'request-id',
    capturedAtMs: Date.parse(capturedAt), stateVersion: 697 } }).mayExpire, true)
  assert.equal(recoveryActions({ ...base, recovery: { ...readout, review: null },
    grant: { evidenceId: 'review-audit-id', requestId: 'request-id',
      capturedAtMs: Date.parse(capturedAt), stateVersion: 697 } }).mayExpire, false)
})

test('successful EXPIRE audit is shown as consumed and cannot be presented as available', async () => {
  consumed = true
  const body = await read()
  assert.equal(body.diamondRecovery.review.status, 'CONSUMED')
  assert.equal(body.diamondRecovery.review.expireAuditId, 'expire-audit-id')
  consumed = false
})

test('expired evidence is not presented as an available grant', async () => {
  reviewedAt = new Date(now.getTime() - 10 * 60_000).toISOString()
  const body = await read()
  assert.equal(body.diamondRecovery.review.status, 'EXPIRED')
  reviewedAt = capturedAt
})

test('OPS_ADMIN and other stores do not receive Diamond recovery projection', async () => {
  role = 'OPS_ADMIN'
  assert.equal((await read()).diamondRecovery, null)
  role = 'SUPER_ADMIN'
  activeStoreId = 'other-store-id'
  assert.equal((await read()).diamondRecovery, null)
  activeStoreId = storeId
})

test('legacy SUPER_ADMIN session cannot read the FK-backed recovery projection', async () => {
  actorId = '_ops_admin'
  const request = new NextRequest(`http://localhost/api/ops/tenants/${tenantId}/stores/${storeId}/v3-print-control-plane`, {
    headers: { Cookie: `auth-session=${signSession({
      tenantId, storeId, userId: actorId, role: 'OWNER', opsRole: 'SUPER_ADMIN',
    })}` },
  })
  const response = await GET(request, { params: Promise.resolve({ tenantId, storeId }) })
  assert.equal(response.status, 403)
  actorId = 'ops-founder'
})

test('legacy non-FK Ops identity is rejected even when its session says SUPER_ADMIN', async () => {
  actorId = 'legacy-ops-user'
  adminExists = false
  const request = new NextRequest(`http://localhost/api/ops/tenants/${tenantId}/stores/${storeId}/v3-print-control-plane`, {
    headers: { Cookie: `auth-session=${signSession({ tenantId, storeId, userId: actorId,
      role: 'OWNER', opsRole: 'SUPER_ADMIN', opsSessionVersion: 0 })}` },
  })
  const response = await GET(request, { params: Promise.resolve({ tenantId, storeId }) })
  assert.equal(response.status, 403)
  adminExists = true
  actorId = 'ops-founder'
})
