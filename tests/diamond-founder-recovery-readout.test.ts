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

// ES-OPS-LOCAL-FIRST-UX-01: exercise existing eligibility before changing its presentation.
function uxRecoveryFixture() {
  const clock = Date.parse('2026-11-06T01:00:00.000Z')
  const state = {
    controlPlane: { mode: 'BLOCKED_UNKNOWN', stateVersion: 10, ownerDeviceId: null as string | null,
      ownerEpoch: 2, leaseExpiresAt: null as string | null,
      handoffRequestedAt: new Date(clock - 100_000).toISOString(), handoffQuarantineUntil: null as string | null },
    activeBatch: null as { id: string } | null,
    v3Queue: { pending: 3, claimed: 0, executing: 0, crossingUnknown: 0 },
  }
  const recovery: DiamondRecoveryReadout = {
    deviceId: 'cmvyx1jes000208l14t5vf9ur', leasePresent: false, review: null,
    jobs: jobIds.map(id => ({ id, status: 'PENDING', expiresAt: new Date(clock - 60_000).toISOString(),
      claimAttempt: 0, attemptCount: 0, claimed: false, executingAt: null, completedAt: null,
      resultStatus: null, effectBoundary: null, hasResultMetadata: false, physicalCompletionKnown: false })),
  }
  const capture = parseCapture(JSON.stringify({
    captureId: 'ux-capture-0001', deviceId: recovery.deviceId, ownerEpoch: 2,
    releasedAt: state.controlPlane.handoffRequestedAt, releasedBatchId: 'ux-batch-0001',
    jobs: jobIds.map(id => ({ id, key: `network:${'a'.repeat(64)}`, requestHash: 'b'.repeat(64), updatedAt: new Date(clock - 60_000).toISOString() })),
    capturedAt: new Date(clock - 20_000).toISOString(), deviceObservedAt: new Date(clock - 20_000).toISOString(),
    historyVerifiedFrom: new Date(clock - 200_000).toISOString(), ledgerSha256: 'c'.repeat(64),
    outboxSha256: 'd'.repeat(64), verifiedNoLocalExecution: true,
  }))!
  assert.ok(capture)
  return { state, recovery, clock, capture, installationId: 'ux-installation-0001', grant: null,
    disabled: false, busy: false, blocked: false }
}

test('UX preservation: REVIEW rejects stale evidence, changed fences, ambiguity and busy states', () => {
  const base = uxRecoveryFixture()
  assert.equal(recoveryActions(base).mayReview, true)
  for (const patch of [{ disabled: true }, { busy: true }, { blocked: true }, { installationId: '' }, { capture: null }, { clock: base.clock + 10_000 }]) {
    assert.equal(recoveryActions({ ...base, ...patch }).mayReview, false)
  }
  for (const patch of [{ ownerDeviceId: 'other-device' }, { leaseExpiresAt: new Date(base.clock + 1000).toISOString() },
    { handoffQuarantineUntil: new Date(base.clock + 1000).toISOString() }, { ownerEpoch: 3 }, { mode: 'V3_ACTIVE' }]) {
    assert.equal(recoveryActions({ ...base, state: { ...base.state, controlPlane: { ...base.state.controlPlane, ...patch } } }).mayReview, false)
  }
  assert.equal(recoveryActions({ ...base, recovery: { ...base.recovery, leasePresent: null } }).mayReview, false)
  assert.equal(recoveryActions({ ...base, state: { ...base.state, activeBatch: { id: 'active-batch' } } }).mayReview, false)
  for (const key of ['claimed', 'executing', 'crossingUnknown'] as const) {
    assert.equal(recoveryActions({ ...base, state: { ...base.state, v3Queue: { ...base.state.v3Queue, [key]: 1 } } }).mayReview, false)
  }
})

test('UX preservation: EXPIRE closes at 295 seconds from capture, never from REVIEW time', () => {
  const base = uxRecoveryFixture()
  const capturedAtMs = Date.parse(base.capture.capturedAt)
  const review = { status: 'AVAILABLE' as const, evidenceId: 'ux-evidence-0001', requestId: 'ux-request-0001',
    capturedAt: base.capture.capturedAt, reviewedAt: new Date(base.clock).toISOString(), stateVersion: 10,
    expireAuditId: null, expireRequestId: null }
  const input = { ...base, recovery: { ...base.recovery, review } }
  assert.equal(recoveryActions(input).mayReview, false)
  assert.equal(recoveryActions({ ...input, clock: capturedAtMs + 294_999 }).mayExpire, true)
  assert.equal(recoveryActions({ ...input, clock: capturedAtMs + 295_000 }).mayExpire, false)
  for (const status of ['CONSUMED', 'EXPIRED', 'OTHER_REVIEWER', 'UNKNOWN'] as const) {
    assert.equal(recoveryActions({ ...input, recovery: { ...input.recovery, review: { ...review, status } } }).mayExpire, false)
  }
})

// Presentation tests deliberately consume the existing action result; they do not replace it.
import { captureWindow, describeFounderRecovery, describePrintMode, LOCAL_FIRST_TONES } from '../app/ops/[tenantId]/localFirstPresentation'

function uxModeFixture() {
  const { state } = uxRecoveryFixture()
  return { ...state, ownerDevice: null as { status: string } | null,
    activeBatch: null as { id: string; ownerDeviceId: string; ownerEpoch: number; expiresAt: string } | null,
    v2Queue: { pending: 0, claimed: 0, executing: 0, crossingUnknown: 0 },
    blocking: { ownerActive: false, activeExecutionBatch: false, handoffOrReconciliation: false,
      v2Drain: false, v2DrainWindowActive: false, v2ExecutionAmbiguous: false, v3Drain: true },
    actions: { startActivation: false, startDeactivation: false, enterManualReview: false,
      finalizeV3Active: false, finalizeV2Active: false } }
}
function uxFounderFixture() {
  const base = uxRecoveryFixture()
  return { ...base, ...recoveryActions(base), capturePresent: true, installationValid: true,
    stateReviewable: true, parentReason: '' }
}

test('UX status separates neutral V2, mode activation, owner and manual confirmation from exceptions', () => {
  const state = uxModeFixture()
  const clock = uxRecoveryFixture().clock
  state.controlPlane.mode = 'V2_ACTIVE'
  state.actions.startActivation = true
  assert.equal(describePrintMode(state, clock).tone, 'neutral')
  assert.match(describePrintMode(state, clock).owner, /不要求 V3 Owner/)
  state.controlPlane.mode = 'V3_ACTIVE'
  assert.match(describePrintMode(state, clock).label, /模式已启用/)
  assert.match(describePrintMode(state, clock).owner, /尚未取得/)
  assert.match(describePrintMode(state, clock).next, /不证明.*出票/)
  state.controlPlane.ownerDeviceId = 'other-owner'
  assert.match(describePrintMode(state, clock).owner, /不能.*接管/)
  state.controlPlane.leaseExpiresAt = new Date(clock + 10_000).toISOString()
  state.ownerDevice = { status: 'ACTIVE' }
  state.activeBatch = { id: 'batch', ownerDeviceId: 'other-owner', ownerEpoch: 2, expiresAt: new Date(clock + 10_000).toISOString() }
  assert.match(describePrintMode(state, clock).owner, /不代表.*打印正常/)
  state.activeBatch.ownerEpoch = 1
  assert.match(describePrintMode(state, clock).owner, /需核对/)
  state.controlPlane.mode = 'BLOCKED_UNKNOWN'
  assert.equal(describePrintMode(state, clock).tone, 'error')
  state.actions.finalizeV2Active = true
  assert.equal(describePrintMode(state, clock).tone, 'info')
  assert.equal(describePrintMode(state, clock).label, '等待人工确认')
})

test('UX unavailable explanations follow existing allowed flags without mutating them', () => {
  const state = uxModeFixture()
  state.controlPlane.mode = 'V2_DRAINING'
  state.blocking.v2DrainWindowActive = true
  state.blocking.v2Drain = true
  const before = structuredClone(state)
  assert.match(describePrintMode(state, 0).unavailable[0].reason, /120 秒.*旧 V2/)
  assert.deepEqual(state, before)
  state.actions.enterManualReview = true
  assert.deepEqual(describePrintMode(state, 0).unavailable, [])
  state.controlPlane.mode = 'V3_ACTIVE'
  state.blocking.handoffOrReconciliation = true
  assert.match(describePrintMode(state, 0).unavailable[0].reason, /交接.*V3/)
})

test('UX clocks reject missing, invalid and future capture times, and never reset on review', () => {
  const clock = uxRecoveryFixture().clock
  for (const value of [null, undefined, 'invalid', new Date(clock + 1).toISOString()]) assert.equal(captureWindow(value, clock, 30_000), null)
  assert.equal(captureWindow(clock - 20_000, clock, 30_000)?.seconds, 10)
  assert.equal(captureWindow(clock - 30_000, clock, 30_000)?.closed, true)
  assert.equal(captureWindow(clock - 300_000, clock, 300_000)?.seconds, 0)
  const input = uxFounderFixture()
  assert.equal(describeFounderRecovery(input).reviewWindow?.seconds, 10)
  const mismatched = { ...input, capture: { ...input.capture, ownerEpoch: 3 } }
  assert.equal(describeFounderRecovery(mismatched).reviewWindow, null)
  const expiring = { ...input, mayReview: false, mayExpire: false,
    activeGrant: { capturedAtMs: input.clock - 295_000, stateVersion: 10 } }
  const display = describeFounderRecovery(expiring)
  assert.equal(display.expireWindow?.seconds, 5)
  assert.match(display.expireReason, /提前 5 秒关闭/)
  const audited = { ...expiring, recovery: { ...expiring.recovery, review: { status: 'AVAILABLE' as const,
    evidenceId: 'ux-evidence', requestId: 'ux-request', capturedAt: new Date(expiring.activeGrant.capturedAtMs).toISOString(),
    reviewedAt: new Date(input.clock).toISOString(), stateVersion: 10, expireAuditId: null, expireRequestId: null } } }
  assert.match(describeFounderRecovery(audited).status, /前端提交窗口已关闭/)
})

test('UX explains each recovery rejection without enabling actions or retaining installation input', () => {
  const base = uxFounderFixture()
  for (const [patch, pattern] of [
    [{ blocked: true }, /审计.*不自动重试/], [{ busy: true }, /正在提交/],
    [{ disabled: true, parentReason: '云端读取失败' }, /云端读取失败/],
    [{ stateReviewable: false }, /Owner.*批次/],
    [{ capturePresent: false, evidenceReady: false }, /采集并粘贴/],
    [{ capture: null, evidenceReady: false }, /JSON 格式/],
    [{ installationValid: false, evidenceReady: false }, /Installation ID/],
    [{ evidenceReady: false }, /超过 30 秒/],
  ] as const) {
    const input = { ...base, ...patch, mayReview: false, mayExpire: false }
    const before = structuredClone(input)
    const result = describeFounderRecovery(input)
    assert.match(result.reviewReason, pattern)
    assert.deepEqual(input, before)
    assert.doesNotMatch(JSON.stringify(result), /ux-installation-0001/)
  }
})

test('UX defaults recovery open unless consumed audit, terminal jobs and V3 mode are all proven', () => {
  const base = uxFounderFixture()
  base.state.controlPlane.mode = 'V3_ACTIVE'
  base.state.v3Queue.pending = 0
  assert.equal(describeFounderRecovery(base).recovered, false)
  base.recovery.review = { status: 'CONSUMED', evidenceId: 'evidence-id', requestId: 'review-id', reviewedAt: null,
    capturedAt: null, stateVersion: 10, expireAuditId: 'expire-id', expireRequestId: 'expire-request-id' }
  base.recovery.jobs = base.recovery.jobs.map(job => ({ ...job, status: 'EXPIRED', resultStatus: 'EXPIRED',
    effectBoundary: 'NOT_CROSSED', completedAt: new Date(base.clock).toISOString() }))
  assert.equal(describeFounderRecovery(base).recovered, true)
  for (const status of ['UNKNOWN','EXPIRED','OTHER_REVIEWER','AVAILABLE'] as const) {
    assert.equal(describeFounderRecovery({ ...base, recovery: { ...base.recovery, review: { ...base.recovery.review, status } } }).recovered, false)
  }
  for (const patch of [{ disabled: true }, { busy: true }, { blocked: true }]) assert.equal(describeFounderRecovery({ ...base, ...patch }).recovered, false)
  base.state.controlPlane.mode = 'BLOCKED_UNKNOWN'
  assert.equal(describeFounderRecovery(base).recovered, false)
  assert.match(describeFounderRecovery(base).status, /等待核对最终模式/)
  base.state.controlPlane.mode = 'V3_ACTIVE'
  base.recovery.jobs[0].effectBoundary = 'CROSSING_UNKNOWN'
  assert.equal(describeFounderRecovery(base).recovered, false)
})

test('UX theme text meets 4.5:1 on every status surface and white card', () => {
  const rgb = (hex: string) => [1,3,5].map(index => parseInt(hex.slice(index, index + 2),16) / 255)
  const luminance = (hex: string) => rgb(hex).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum,v,index) => sum + v * [0.2126,0.7152,0.0722][index],0)
  const ratio = (a: string,b: string) => (Math.max(luminance(a),luminance(b)) + 0.05) / (Math.min(luminance(a),luminance(b)) + 0.05)
  for (const tone of Object.values(LOCAL_FIRST_TONES)) assert.ok(ratio(tone.color,tone.bg) >= 4.5)
  for (const color of ['#0f172a','#334155','#475569','#854d0e','#991b1b','#166534']) assert.ok(ratio(color,'#ffffff') >= 4.5)
  assert.ok(ratio('#ffffff','#166534') >= 4.5)
})


test('UX never suggests a second REVIEW when an AVAILABLE audit has incomplete or changed fence metadata', () => {
  const base = uxFounderFixture()
  const review = { status: 'AVAILABLE' as const, evidenceId: 'ux-evidence', requestId: 'ux-request',
    capturedAt: base.capture.capturedAt, reviewedAt: new Date(base.clock).toISOString(), stateVersion: 11,
    expireAuditId: null, expireRequestId: null }
  for (const patch of [{}, { stateVersion: 10, capturedAt: null }, { stateVersion: 10, evidenceId: null }]) {
    const input = { ...base, recovery: { ...base.recovery, review: { ...review, ...patch } } }
    const actions = recoveryActions(input)
    assert.equal(actions.mayReview, false)
    assert.equal(actions.mayExpire, false)
    const display = describeFounderRecovery({ ...input, ...actions })
    assert.match(display.reviewReason, /已有审核记录.*不得重新 REVIEW/)
    assert.match(display.expireReason, /已有审核记录.*不得重新 REVIEW/)
  }
})
