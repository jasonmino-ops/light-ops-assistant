import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { V3PrintRole } from '@/lib/v3-print-job-adapter'
import { canonicalV3PrintEffectKey } from '@/lib/v3-print-identity'

const PROOF_PREFIX = 'v3orp1'
const PROOF_TTL_MS = 2 * 60 * 1000
const ORDER_NO_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/
const JOB_ID_PATTERN = /^network:[0-9a-f]{64}$/
const CLAIM_PATTERN = /^V3_CLAIM:([^:]{1,128}):(\d+):([^:]{1,128})$/

export type V3OperatorPrintState = 'PRINTED' | 'DEFINITELY_NOT_PRINTED' | 'AMBIGUOUS'

export type V3OperatorRoleStatus = {
  state: V3OperatorPrintState
  originalJobId: string
  localProofEligible: boolean
}

export type V3OperatorPrintStates = {
  FRONT: V3OperatorRoleStatus
  KITCHEN: V3OperatorRoleStatus | null
}

type OperatorJob = {
  id: string
  idempotencyKey: string
  schemaVersion: number
  payload: unknown
  status: string
  claimTokenHash: string | null
  claimAttempt: number
  attemptCount: number
  leaseExpiresAt: Date | null
  completedAt: Date | null
  resultStatus: string | null
  resultCode: string | null
  resultMessage: string | null
  effectBoundary: string | null
  physicalCompletionKnown: boolean
  updatedAt: Date
}

type RecoveryProofClaims = {
  schemaVersion: 1
  tenantId: string
  storeId: string
  desktopDeviceId: string
  orderNo: string
  role: V3PrintRole
  originalJobId: string
  claimDigest: string
  originalUpdatedAt: string
  issuedAt: string
  expiresAt: string
}

type OperatorStatusDb = {
  eshopTrayPrintJob: {
    findMany(args: unknown): Promise<OperatorJob[]>
    findUnique(args: unknown): Promise<OperatorJob | null>
  }
}

function secret(): string {
  const value = process.env.DESKTOP_DEVICE_TOKEN_SECRET?.trim()
  if (!value) throw new Error('V3_OPERATOR_RECOVERY_PROOF_SECRET_UNAVAILABLE')
  return value
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function claimProvenance(value: string | null) {
  const match = CLAIM_PATTERN.exec(value ?? '')
  return match
    ? { deviceId: match[1], ownerEpoch: Number(match[2]), batchId: match[3] }
    : null
}

function intentIdentity(payload: unknown): { orderNo: string; role: V3PrintRole } | null {
  const intent = object(payload)
  if (!intent || intent.schemaVersion !== 3 || (intent.role !== 'FRONT' && intent.role !== 'KITCHEN')) return null
  if (intent.payloadKind === 'RAW_BYTES' && typeof intent.orderNo === 'string') {
    return { orderNo: intent.orderNo, role: intent.role }
  }
  const request = object(intent.networkRequest)
  if (intent.payloadKind === 'NETWORK_REQUEST' && typeof request?.orderNo === 'string') {
    return { orderNo: request.orderNo, role: intent.role }
  }
  return null
}

function terminalEvidence(job: OperatorJob) {
  return Boolean(job.completedAt && job.resultCode)
}

function effectState(job: OperatorJob): V3OperatorPrintState {
  if (
    job.status === 'SUCCEEDED'
    && job.resultStatus === 'CROSSED'
    && job.effectBoundary === 'CROSSED'
    && terminalEvidence(job)
  ) return 'PRINTED'
  if (
    job.status === 'FAILED'
    && job.resultStatus === 'FAILED_NOT_CROSSED'
    && job.effectBoundary === 'NOT_CROSSED'
    && terminalEvidence(job)
  ) return 'DEFINITELY_NOT_PRINTED'
  return 'AMBIGUOUS'
}

function reprintIdentity(job: OperatorJob): { orderNo: string; role: V3PrintRole } | null {
  const intent = object(job.payload)
  const identity = intentIdentity(job.payload)
  if (
    !identity
    || intent?.source !== 'CLOUD_REMOTE_REPRINT'
    || intent.printJobId !== job.idempotencyKey
    || !job.idempotencyKey.startsWith(`v3-reprint:${identity.role.toLowerCase()}:`)
  ) return null
  return identity
}

function applyReprintEvidence(base: V3OperatorRoleStatus, reprints: OperatorJob[]): V3OperatorRoleStatus {
  if (base.state === 'PRINTED' || reprints.length === 0) return base
  const states = reprints.map(effectState)
  if (states.includes('PRINTED')) {
    return { ...base, state: 'PRINTED', localProofEligible: false }
  }
  if (states.includes('AMBIGUOUS')) {
    return { ...base, state: 'AMBIGUOUS', localProofEligible: false }
  }
  return { ...base, state: 'DEFINITELY_NOT_PRINTED', localProofEligible: false }
}

export function canonicalV3OriginalPrintJobId(orderNo: string, role: V3PrintRole) {
  return `network:${createHash('sha256').update(canonicalV3PrintEffectKey(orderNo, role)).digest('hex')}`
}

export function classifyV3OperatorPrintJob(
  job: OperatorJob | null,
  originalJobId: string,
  desktopDeviceId?: string,
): V3OperatorRoleStatus {
  if (job?.schemaVersion === 3 && job.idempotencyKey === originalJobId) {
    const state = effectState(job)
    if (state !== 'AMBIGUOUS') return { state, originalJobId, localProofEligible: false }
  }

  const claim = job ? claimProvenance(job.resultMessage) : null
  const localProofEligible = Boolean(
    desktopDeviceId
    && job?.schemaVersion === 3
    && job.idempotencyKey === originalJobId
    && job.status === 'PENDING'
    && !job.completedAt
    && job.claimTokenHash
    && claim?.deviceId === desktopDeviceId
    && !job.resultStatus
    && !job.resultCode
    && !job.effectBoundary
    && !job.physicalCompletionKnown,
  )
  return { state: 'AMBIGUOUS', originalJobId, localProofEligible }
}

export async function readV3OperatorPrintStatesWithDb(
  db: OperatorStatusDb,
  scope: { tenantId: string; storeId: string },
  input: { orderNo: string; kitchenEnabled: boolean; desktopDeviceId?: string },
): Promise<V3OperatorPrintStates> {
  if (!ORDER_NO_PATTERN.test(input.orderNo)) throw new Error('V3_OPERATOR_ORDER_INVALID')
  const ids = (['FRONT', ...(input.kitchenEnabled ? ['KITCHEN'] : [])] as V3PrintRole[])
    .map((role) => canonicalV3OriginalPrintJobId(input.orderNo, role))
  const rows = await db.eshopTrayPrintJob.findMany({
    where: {
      tenantId: scope.tenantId,
      storeId: scope.storeId,
      schemaVersion: 3,
      OR: [
        { idempotencyKey: { in: ids } },
        { payload: { path: ['orderNo'], equals: input.orderNo } },
      ],
    },
    select: {
      id: true,
      idempotencyKey: true,
      schemaVersion: true,
      payload: true,
      status: true,
      claimTokenHash: true,
      claimAttempt: true,
      attemptCount: true,
      leaseExpiresAt: true,
      completedAt: true,
      resultStatus: true,
      resultCode: true,
      resultMessage: true,
      effectBoundary: true,
      physicalCompletionKnown: true,
      updatedAt: true,
    },
  })
  const byId = new Map(rows.map((row) => [row.idempotencyKey, row]))
  const reprints: Record<V3PrintRole, OperatorJob[]> = { FRONT: [], KITCHEN: [] }
  for (const row of rows) {
    const identity = reprintIdentity(row)
    if (identity?.orderNo === input.orderNo) reprints[identity.role].push(row)
  }
  const frontId = canonicalV3OriginalPrintJobId(input.orderNo, 'FRONT')
  const kitchenId = canonicalV3OriginalPrintJobId(input.orderNo, 'KITCHEN')
  return {
    FRONT: applyReprintEvidence(
      classifyV3OperatorPrintJob(byId.get(frontId) ?? null, frontId, input.desktopDeviceId),
      reprints.FRONT,
    ),
    KITCHEN: input.kitchenEnabled
      ? applyReprintEvidence(
          classifyV3OperatorPrintJob(byId.get(kitchenId) ?? null, kitchenId, input.desktopDeviceId),
          reprints.KITCHEN,
        )
      : null,
  }
}

function claimDigest(job: OperatorJob) {
  return createHash('sha256').update(JSON.stringify([
    job.claimTokenHash,
    job.resultMessage,
    job.claimAttempt,
    job.attemptCount,
    job.leaseExpiresAt?.toISOString() ?? null,
    job.updatedAt.toISOString(),
  ])).digest('hex')
}

function expectedClaimToken(originalJobId: string, deviceId: string, ownerEpoch: number) {
  return createHash('sha256').update(JSON.stringify(['v3-delivery', originalJobId, deviceId, ownerEpoch])).digest('hex')
}

function sign(encoded: string) {
  return createHmac('sha256', secret()).update(`${PROOF_PREFIX}.${encoded}`).digest('hex')
}

function encodeProof(claims: RecoveryProofClaims) {
  const encoded = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')
  return `${PROOF_PREFIX}.${encoded}.${sign(encoded)}`
}

function decodeProof(value: string): RecoveryProofClaims | null {
  const match = /^v3orp1\.([A-Za-z0-9_-]+)\.([0-9a-f]{64})$/.exec(value)
  if (!match) return null
  const expected = Buffer.from(sign(match[1]), 'hex')
  const actual = Buffer.from(match[2], 'hex')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  try {
    const parsed = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')) as Record<string, unknown>
    const keys = Object.keys(parsed).sort().join(',')
    if (keys !== 'claimDigest,desktopDeviceId,expiresAt,issuedAt,orderNo,originalJobId,originalUpdatedAt,role,schemaVersion,storeId,tenantId') return null
    if (
      parsed.schemaVersion !== 1
      || typeof parsed.tenantId !== 'string'
      || typeof parsed.storeId !== 'string'
      || typeof parsed.desktopDeviceId !== 'string'
      || typeof parsed.orderNo !== 'string'
      || !ORDER_NO_PATTERN.test(parsed.orderNo)
      || (parsed.role !== 'FRONT' && parsed.role !== 'KITCHEN')
      || typeof parsed.originalJobId !== 'string'
      || !JOB_ID_PATTERN.test(parsed.originalJobId)
      || typeof parsed.claimDigest !== 'string'
      || !/^[0-9a-f]{64}$/.test(parsed.claimDigest)
      || typeof parsed.originalUpdatedAt !== 'string'
      || !Number.isFinite(Date.parse(parsed.originalUpdatedAt))
      || typeof parsed.issuedAt !== 'string'
      || !Number.isFinite(Date.parse(parsed.issuedAt))
      || typeof parsed.expiresAt !== 'string'
      || !Number.isFinite(Date.parse(parsed.expiresAt))
    ) return null
    return parsed as RecoveryProofClaims
  } catch {
    return null
  }
}

function isRecoverableClaimGap(
  job: OperatorJob,
  identity: { tenantId: string; storeId: string; desktopDeviceId: string; orderNo: string; role: V3PrintRole },
) {
  const claim = claimProvenance(job.resultMessage)
  const payload = intentIdentity(job.payload)
  return job.schemaVersion === 3
    && job.idempotencyKey === canonicalV3OriginalPrintJobId(identity.orderNo, identity.role)
    && job.status === 'PENDING'
    && !job.completedAt
    && Boolean(job.claimTokenHash)
    && claim?.deviceId === identity.desktopDeviceId
    && job.claimTokenHash === expectedClaimToken(job.idempotencyKey, identity.desktopDeviceId, claim.ownerEpoch)
    && payload?.orderNo === identity.orderNo
    && payload.role === identity.role
    && !job.resultStatus
    && !job.resultCode
    && !job.effectBoundary
    && !job.physicalCompletionKnown
}

export async function issueV3OperatorRecoveryProofWithDb(
  db: OperatorStatusDb,
  scope: { tenantId: string; storeId: string; desktopDeviceId: string },
  input: { orderNo: string; role: V3PrintRole; originalJobId: string; localEvidence: 'LEDGER_ABSENT' },
  now = new Date(),
): Promise<string | null> {
  if (
    !ORDER_NO_PATTERN.test(input.orderNo)
    || input.originalJobId !== canonicalV3OriginalPrintJobId(input.orderNo, input.role)
    || input.localEvidence !== 'LEDGER_ABSENT'
  ) return null
  const job = await db.eshopTrayPrintJob.findUnique({
    where: { tenantId_storeId_idempotencyKey: {
      tenantId: scope.tenantId,
      storeId: scope.storeId,
      idempotencyKey: input.originalJobId,
    } },
  })
  if (!job || !isRecoverableClaimGap(job, { ...scope, orderNo: input.orderNo, role: input.role })) return null
  const issuedAt = now.toISOString()
  return encodeProof({
    schemaVersion: 1,
    tenantId: scope.tenantId,
    storeId: scope.storeId,
    desktopDeviceId: scope.desktopDeviceId,
    orderNo: input.orderNo,
    role: input.role,
    originalJobId: input.originalJobId,
    claimDigest: claimDigest(job),
    originalUpdatedAt: job.updatedAt.toISOString(),
    issuedAt,
    expiresAt: new Date(now.getTime() + PROOF_TTL_MS).toISOString(),
  })
}

export function verifyV3OperatorRecoveryProof(
  value: string,
  expected: { tenantId: string; storeId: string; desktopDeviceId: string; orderNo: string; role: V3PrintRole; originalJobId: string },
  job: OperatorJob,
  now = new Date(),
) {
  const claims = decodeProof(value)
  if (!claims) return null
  if (
    claims.tenantId !== expected.tenantId
    || claims.storeId !== expected.storeId
    || claims.desktopDeviceId !== expected.desktopDeviceId
    || claims.orderNo !== expected.orderNo
    || claims.role !== expected.role
    || claims.originalJobId !== expected.originalJobId
    || claims.originalUpdatedAt !== job.updatedAt.toISOString()
    || claims.claimDigest !== claimDigest(job)
    || Date.parse(claims.issuedAt) > now.getTime() + 5_000
    || Date.parse(claims.expiresAt) < now.getTime()
    || Date.parse(claims.expiresAt) - Date.parse(claims.issuedAt) !== PROOF_TTL_MS
    || !isRecoverableClaimGap(job, expected)
  ) return null
  return claims
}
