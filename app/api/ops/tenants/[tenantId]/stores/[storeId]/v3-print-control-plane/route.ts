import { NextRequest, NextResponse } from 'next/server'
import { getFkBackedOpsAdminIdentity } from '@/lib/ops-auth'
import { prisma } from '@/lib/prisma'
import {
  parseOpsPrintModeCommand,
  parseOpsV3QueueRecoveryCommand,
  readOpsPrintModeState,
  resolveOpsPrintStoreAccess,
  runOpsPrintModeAction,
  runOpsV3QueueRecovery,
  validateOpsPrintMutationRequest,
  type OpsPrintControlDb,
} from './service'

export const runtime = 'nodejs'

const db = prisma as unknown as OpsPrintControlDb
const DIAMOND_STORE_ID = 'cmvulpn8r000106jvpo58kye4'
const DIAMOND_STORE_CODE = 'ST883DC00C'
const DIAMOND_DEVICE_ID = 'cmvyx1jes000208l14t5vf9ur'
const DIAMOND_JOB_IDS = [
  'cmw0jlsme000v08kzgyiybcqg',
  'cmw0k7dgw001c08kz5xirfxzv',
  'cmw0kwwta001v08jv6q6rl2f4',
] as const
const FOUNDER_REVIEW_ACTION = 'FOUNDER_REVIEW_DIAMOND_EXPIRED_FRONT'
const FOUNDER_EXPIRE_ACTION = 'FOUNDER_EXPIRE_DIAMOND_UNEXECUTED_FRONT'
const REVIEW_MAX_AGE_MS = 5 * 60_000

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}

/** Read-only projection. The POST transaction remains the sole safety authority. */
async function readDiamondRecovery(tenantId: string, storeId: string, operatorId: string) {
  const scope = { tenantId, storeId }
  const [plane, rows] = await Promise.all([
    prisma.v3PrintControlPlane.findFirst({
      where: scope, select: { id: true, stateVersion: true, leaseId: true },
    }),
    prisma.eshopTrayPrintJob.findMany({
      where: { ...scope, schemaVersion: 3, id: { in: [...DIAMOND_JOB_IDS] } },
      select: {
        id: true, status: true, expiresAt: true, claimAttempt: true, attemptCount: true,
        claimedByComputerBindingId: true, claimTokenHash: true, leaseExpiresAt: true,
        executingAt: true, completedAt: true, resultStatus: true, resultCode: true,
        resultMessage: true, effectBoundary: true, physicalCompletionKnown: true,
      },
    }),
  ])
  const byId = new Map(rows.map(row => [row.id, row]))
  const jobs = DIAMOND_JOB_IDS.map(id => {
    const row = byId.get(id)
    return row ? {
      id, status: row.status, expiresAt: row.expiresAt.toISOString(),
      claimAttempt: row.claimAttempt, attemptCount: row.attemptCount,
      claimed: row.claimedByComputerBindingId !== null || row.claimTokenHash !== null
        || row.leaseExpiresAt !== null,
      executingAt: row.executingAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      resultStatus: row.resultStatus, effectBoundary: row.effectBoundary,
      hasResultMetadata: row.resultCode !== null || row.resultMessage !== null,
      physicalCompletionKnown: row.physicalCompletionKnown,
    } : { id, status: 'MISSING' as const, expiresAt: null, claimAttempt: null,
      attemptCount: null, claimed: null, executingAt: null, completedAt: null,
      resultStatus: null, effectBoundary: null, hasResultMetadata: null, physicalCompletionKnown: null }
  })

  if (!plane) return { deviceId: DIAMOND_DEVICE_ID, leasePresent: null, jobs, review: null }
  // Return only metadata for this exact active Founder. Never return captured
  // installation identifiers, ledger/outbox hashes, keys, or full audit payloads.
  const reviewed = await prisma.operationLog.findFirst({
    where: {
      ...scope, targetType: 'V3PrintControlPlane', targetId: plane.id,
      actionType: FOUNDER_REVIEW_ACTION, status: 'SUCCESS',
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, requestId: true, createdAt: true, payloadSnapshot: true },
  })
  if (!reviewed) return { deviceId: DIAMOND_DEVICE_ID, leasePresent: plane.leaseId !== null, jobs, review: null }
  const payload = object(reviewed.payloadSnapshot)
  if (payload?.reviewerId !== operatorId) return {
    deviceId: DIAMOND_DEVICE_ID, leasePresent: plane.leaseId !== null, jobs,
    review: { status: 'OTHER_REVIEWER' as const, evidenceId: null, requestId: null,
      reviewedAt: null, capturedAt: null, stateVersion: null,
      expireAuditId: null, expireRequestId: null },
  }
  const capture = object(payload?.capture)
  const fence = object(payload?.fence)
  const reviewedJobs = Array.isArray(payload?.jobs) ? payload.jobs.map(value => object(value)?.id).sort() : null
  const captureAt = typeof capture?.capturedAt === 'string' ? Date.parse(capture.capturedAt) : NaN
  const valid = payload?.founderEmergency === true && capture?.deviceId === DIAMOND_DEVICE_ID
    && reviewedJobs?.join(',') === [...DIAMOND_JOB_IDS].sort().join(',')
    && fence?.stateVersion === plane.stateVersion && Number.isFinite(captureAt)
  const consumed = await prisma.operationLog.findFirst({
    where: {
      ...scope, targetType: 'V3PrintControlPlane', targetId: plane.id,
      actionType: FOUNDER_EXPIRE_ACTION, status: 'SUCCESS',
      payloadSnapshot: { path: ['evidenceId'], equals: reviewed.id },
    },
    select: { id: true, requestId: true, createdAt: true },
  })
  return {
    deviceId: DIAMOND_DEVICE_ID, leasePresent: plane.leaseId !== null, jobs,
    review: {
      evidenceId: reviewed.id, requestId: reviewed.requestId,
      reviewedAt: reviewed.createdAt.toISOString(),
      capturedAt: valid ? new Date(captureAt).toISOString() : null,
      stateVersion: valid ? plane.stateVersion : null,
      status: consumed ? 'CONSUMED' as const
        : !valid ? 'UNKNOWN' as const
          : Date.now() - captureAt >= REVIEW_MAX_AGE_MS ? 'EXPIRED' as const : 'AVAILABLE' as const,
      expireAuditId: consumed?.id ?? null,
      expireRequestId: consumed?.requestId ?? null,
    },
  }
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set('Cache-Control', 'private, no-store')
  return NextResponse.json(body, { ...init, headers })
}

function serverFailure(error: unknown) {
  const value = error && typeof error === 'object' ? error as { name?: unknown; code?: unknown } : null
  const name = typeof value?.name === 'string' ? value.name : ''
  const code = typeof value?.code === 'string' ? value.code : ''
  const unavailable = name === 'PrismaClientInitializationError' || name === 'PrismaClientRustPanicError' ||
    /^P10(?:0[0-9]|1[0-7])$/.test(code) || code === 'P2024' ||
    ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(code)
  return unavailable
    ? noStoreJson({ ok: false, error: 'CONTROL_PLANE_UNAVAILABLE' }, { status: 503 })
    : noStoreJson({ ok: false, error: 'UNEXPECTED_SERVER_ERROR' }, { status: 500 })
}

async function authorizeStore(
  req: NextRequest,
  params: Promise<{ tenantId: string; storeId: string }>,
): Promise<
  | { ok: false; response: NextResponse }
  | { ok: true; operator: { id: string; role: string }; store: { id: string; tenantId: string; code: string } }
> {
  const scope = await params
  const result = await resolveOpsPrintStoreAccess(req, scope, {
    authenticate: (request) => getFkBackedOpsAdminIdentity(request, 'OPS_ADMIN'),
    findActiveStore: ({ tenantId, storeId }) => prisma.store.findFirst({
      where: { id: storeId, tenantId, status: 'ACTIVE' },
      select: { id: true, tenantId: true, code: true },
    }),
  })
  if (!result.ok) {
    const status = result.code === 'FORBIDDEN' ? 403 : 404
    return { ok: false, response: noStoreJson({ ok: false, error: result.code }, { status }) } as const
  }
  return { ok: true, operator: result.operator, store: result.store } as const
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tenantId: string; storeId: string }> },
) {
  try {
    const auth = await authorizeStore(req, params)
    if (!auth.ok) return auth.response
    const scope = { tenantId: auth.store.tenantId, storeId: auth.store.id }
    const state = await readOpsPrintModeState(db, scope)
    let diamondRecovery = null
    let diamondRecoveryError = null
    if (auth.operator.role === 'SUPER_ADMIN'
      && auth.store.id === DIAMOND_STORE_ID && auth.store.code === DIAMOND_STORE_CODE) {
      try {
        diamondRecovery = await readDiamondRecovery(scope.tenantId, scope.storeId, auth.operator.id)
      } catch {
        // A failed optional readout must not take down the existing control plane.
        // No recovery action is offered without the authoritative projection.
        console.error('DIAMOND_RECOVERY_READ_FAILED')
        diamondRecoveryError = 'DIAMOND_RECOVERY_READ_FAILED'
      }
    }
    return noStoreJson({ ok: true, state, diamondRecovery, diamondRecoveryError })
  } catch (error) {
    return serverFailure(error)
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tenantId: string; storeId: string }> },
) {
  const requestSafety = validateOpsPrintMutationRequest(req)
  if (!requestSafety.ok) {
    return noStoreJson({ ok: false, error: requestSafety.code }, {
      status: requestSafety.code === 'INVALID_CONTENT_TYPE' ? 415 : 403,
    })
  }
  try {
    const auth = await authorizeStore(req, params)
    if (!auth.ok) return auth.response
    const body: unknown = await req.json().catch(() => null)
    const recovery = parseOpsV3QueueRecoveryCommand(body)
    if (recovery) {
      if (!recovery.ok) return noStoreJson(recovery, { status: 400 })
      const result = await runOpsV3QueueRecovery(prisma, {
        tenantId: auth.store.tenantId,
        storeId: auth.store.id,
      }, auth.operator, recovery.value)
      return noStoreJson(result, { status: result.ok ? 200 : result.code === 'QUEUE_RECOVERY_FORBIDDEN' ? 403 : 409 })
    }
    const command = parseOpsPrintModeCommand(body)
    if (!command.ok) return noStoreJson({ ok: false, error: command.code }, { status: 400 })
    const result = await runOpsPrintModeAction(db, {
      tenantId: auth.store.tenantId,
      storeId: auth.store.id,
      operatorAdminId: auth.operator.id,
      operatorRole: auth.operator.role,
      expectedStateVersion: command.value.expectedStateVersion,
      action: command.value.action,
    })
    const state = await readOpsPrintModeState(db, {
      tenantId: auth.store.tenantId,
      storeId: auth.store.id,
    })
    return result.ok
      ? noStoreJson({ ok: true, requestId: result.requestId, state })
      : noStoreJson({ ok: false, error: result.code, state }, { status: 409 })
  } catch (error) {
    return serverFailure(error)
  }
}
