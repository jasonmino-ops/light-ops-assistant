import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { OperationLog, Prisma } from '@prisma/client'
import admission from '@/lib/v3-legacy-seven/admission.json'

export const plan = admission
export const DESIGN = 'd746925f7b4c69f4cfddf1bafdbdb309def98945673601ef8e1b23ac91eba419'
export const ADMISSION = '5b53783cd4b979ad1370c54a57fad8540f854fe64dec64eb47cddc94afb5611c'
export const scope = { tenantId: plan.scope.tenantId, storeId: plan.scope.storeId }
export const subject = { ...scope, targetType: plan.task, targetId: plan.scope.code }
export const action = 'QUARANTINE_EXPIRED_UNKNOWN_FRONT_ONCE'
export const prefix = 'st04:legacy-front-seven:'
export const reason = 'V3_OPS_QUARANTINED_PHYSICAL_UNKNOWN'
export const sha = (s: string) => createHash('sha256').update(s).digest('hex')
export const hex = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s)
export class CaseStop extends Error {}
export function check(condition: unknown, code: string): asserts condition {
  if (!condition) throw new CaseStop(code)
}
export function object(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}
export function isTarget(s: { tenantId: string; storeId: string }) {
  return s.tenantId === scope.tenantId && s.storeId === scope.storeId
}
export const jobIds = plan.jobs.map((j) => j.id)
const id = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_.:-]{5,128}$/.test(s)
const sameList = (a: unknown, b: string[]) =>
  Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i])
export type CaseCommand = { phase: 'REVIEW' | 'APPLY' | 'READBACK'; sourceSha: string }
export function parseCommand(v: unknown): CaseCommand {
  const b = object(v)
  check(
    Object.keys(b).sort().join(',') === 'action,admissionSha256,designSha256,jobIds,phase,requestId,sourceSha' &&
      b.action === action &&
      b.requestId === plan.operationRequestId &&
      b.designSha256 === DESIGN &&
      b.admissionSha256 === ADMISSION &&
      sameList(b.jobIds, jobIds) &&
      typeof b.sourceSha === 'string' &&
      /^[0-9a-f]{40}$/.test(b.sourceSha) &&
      (b.phase === 'REVIEW' || b.phase === 'APPLY' || b.phase === 'READBACK'),
    'CASE_COMMAND_INVALID'
  )
  return { phase: b.phase, sourceSha: b.sourceSha }
}
export async function dbTime(tx: Prisma.TransactionClient) {
  const [row] = await tx.$queryRaw<
    { ms: bigint }[]
  >`SELECT floor(extract(epoch from clock_timestamp()) * 1000)::bigint AS ms`
  return new Date(Number(row.ms))
}
const evidenceKeys = [
  'founderDecision',
  'implementationReview',
  'releaseLineage',
  'oldHostRetired',
  'v727LocalIdle',
  'desktopAndOfflineDrained',
  'h5Drained',
  'thirdPartyDrained',
  'backgroundDrained',
  'exclusiveWindow',
  'endpoints',
  'aliasReview',
] as const

/** Only the separately registered, protected Ops record can open this case.
 * No route creates a grant. Revocation takes the same row lock and marks it FAILED.
 * AUTH_SECRET follows the existing server-side signed OperationLog admission pattern.
 */
function decodeGrant(row: OperationLog | null, purpose: 'ACTIVE' | 'AUDIT_ONLY') {
  const seal = object(row?.payloadSnapshot)
  const secret = process.env.AUTH_SECRET
  check(
    row &&
      row.id === prefix + 'grant' &&
      isTarget({ tenantId: row.tenantId, storeId: row.storeId ?? '' }) &&
      (row.status === 'SUCCESS' || (purpose === 'AUDIT_ONLY' && row.status === 'FAILED')) &&
      row.actionType === 'FOUNDER_ADMISSION' &&
      row.targetType === subject.targetType &&
      row.targetId === subject.targetId &&
      row.requestId === plan.operationRequestId,
    'CASE_GRANT_MISSING_OR_REVOKED'
  )
  check(
    process.env.VERCEL_ENV === 'production' &&
      secret &&
      secret.length >= 24 &&
      secret !== 'dev-secret-change-in-production' &&
      typeof seal.payload === 'string' &&
      seal.payload.length <= 16384 &&
      hex(seal.signature),
    'CASE_GRANT_INVALID'
  )
  const sig = createHmac('sha256', secret)
    .update(plan.task + '\n' + seal.payload)
    .digest()
  check(timingSafeEqual(sig, Buffer.from(seal.signature, 'hex')), 'CASE_GRANT_INVALID')
  let g: Record<string, unknown>
  try {
    g = object(JSON.parse(seal.payload))
  } catch {
    throw new CaseStop('CASE_GRANT_INVALID')
  }
  const evidence = object(g.evidence)
  check(
    g.task === plan.task &&
      g.tenantId === scope.tenantId &&
      g.storeId === scope.storeId &&
      g.designSha256 === DESIGN &&
      g.admissionSha256 === ADMISSION &&
      g.requestId === plan.operationRequestId &&
      g.handoffId === plan.handoffConfirmationId &&
      g.deviceId === plan.newOwner &&
      sameList(g.jobIds, jobIds) &&
      typeof g.sourceSha === 'string' &&
      /^[0-9a-f]{40}$/.test(g.sourceSha) &&
      typeof g.releaseSha === 'string' &&
      /^[0-9a-f]{40}$/.test(g.releaseSha) &&
      (purpose === 'AUDIT_ONLY' || g.releaseSha === process.env.VERCEL_GIT_COMMIT_SHA) &&
      id(g.deploymentId) &&
      (purpose === 'AUDIT_ONLY' || g.deploymentId === process.env.VERCEL_DEPLOYMENT_ID) &&
      id(g.reviewer) &&
      id(g.executor) &&
      g.reviewer !== g.executor &&
      hex(g.beforeHash) &&
      g.status === 'APPROVED' &&
      evidenceKeys.every((k) => hex(evidence[k])) &&
      Object.keys(evidence).length === evidenceKeys.length,
    'CASE_GRANT_UNBOUND'
  )
  const start = Date.parse(String(g.validFrom)),
    end = Date.parse(String(g.validUntil))
  check(
    Number.isFinite(start) &&
      Number.isFinite(end) &&
      start >= Date.parse(plan.notBefore) &&
      end > start &&
      end - start <= 15 * 60_000,
    'CASE_WINDOW_INVALID'
  )
  return {
    digest: sha(seal.payload),
    reviewer: g.reviewer,
    executor: g.executor,
    sourceSha: g.sourceSha,
    beforeHash: g.beforeHash,
    start,
    end,
    evidenceDigest: sha(JSON.stringify(evidenceKeys.map((k) => [k, evidence[k]]))),
  }
}
export const verifyGrant = (row: OperationLog | null) => decodeGrant(row, 'ACTIVE')
export const readArchivedGrant = (row: OperationLog | null) => decodeGrant(row, 'AUDIT_ONLY')
export type Grant = ReturnType<typeof verifyGrant>
/** Separately registered AFTER disposition; an A-only authorization cannot activate an Owner. */
export async function activationGrant(tx: Prisma.TransactionClient, g: Grant, afterHash: string, now: Date) {
  const id = prefix + 'activation-grant'
  const locked = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM "OperationLog" WHERE id=${id} AND "tenantId"=${scope.tenantId} AND "storeId"=${scope.storeId} FOR SHARE NOWAIT`
  check(locked.length === 1, 'CASE_ACTIVATION_GRANT_REQUIRED')
  const row = await tx.operationLog.findUnique({ where: { id } })
  const seal = object(row?.payloadSnapshot)
  check(
    row &&
      row.status === 'SUCCESS' &&
      row.actionType === 'FOUNDER_FINALIZE_ADMISSION' &&
      row.targetType === subject.targetType &&
      row.targetId === subject.targetId &&
      row.requestId === plan.handoffConfirmationId &&
      typeof seal.payload === 'string' &&
      seal.payload.length < 8192 &&
      hex(seal.signature),
    'CASE_ACTIVATION_GRANT_INVALID'
  )
  const sig = createHmac('sha256', process.env.AUTH_SECRET!)
    .update(plan.task + ':FINALIZE:' + seal.payload)
    .digest()
  check(timingSafeEqual(sig, Buffer.from(seal.signature, 'hex')), 'CASE_ACTIVATION_GRANT_INVALID')
  let v: Record<string, unknown>
  try {
    v = object(JSON.parse(seal.payload))
  } catch {
    throw new CaseStop('CASE_ACTIVATION_GRANT_INVALID')
  }
  const start = Date.parse(String(v.validFrom)),
    end = Date.parse(String(v.validUntil))
  check(
    v.action === 'FINALIZE_V3_ACTIVE' &&
      v.designSha256 === DESIGN &&
      v.grantDigest === g.digest &&
      v.afterHash === afterHash &&
      v.tenantId === scope.tenantId &&
      v.storeId === scope.storeId &&
      v.deviceId === plan.newOwner &&
      v.confirmationId === plan.handoffConfirmationId &&
      v.stateVersion === plan.control.stateVersion + 2 &&
      v.ownerEpoch === plan.control.ownerEpoch + 1 &&
      v.executor === g.executor &&
      hex(v.founderDecision) &&
      hex(v.handoffApproval) &&
      hex(v.freshDrainEvidence) &&
      start >= g.start &&
      end <= g.end &&
      start <= now.getTime() &&
      end > now.getTime() + 10_000,
    'CASE_ACTIVATION_GRANT_INVALID'
  )
  return { digest: sha(seal.payload), end }
}
export function live(g: Grant, now: Date) {
  check(now.getTime() >= g.start && now.getTime() < g.end, 'CASE_WINDOW_CLOSED')
}
