import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { OperationLog, Prisma } from '@prisma/client'
import { canonicalV3PrintEffectKey } from '../v3-print-identity'
import plan from './admission.json'

export const activationReceiptId = 'st04:legacy-front-seven:activated'
export const sealedAdmissionSha = '5b53783cd4b979ad1370c54a57fad8540f854fe64dec64eb47cddc94afb5611c'
const digest = (s: string) => createHash('sha256').update(s).digest('hex')
const target = (s: { tenantId: string; storeId: string }) =>
  s.tenantId === plan.scope.tenantId && s.storeId === plan.scope.storeId
type Log = Prisma.TransactionClient['operationLog']
const scoped = { tenantId: plan.scope.tenantId, storeId: plan.scope.storeId }
const hex = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)

export function sealedEffect(
  scope: typeof scoped,
  intent: { role: string; printJobId: string; orderNo?: string; networkRequest?: { order: { orderNo: string } } }
) {
  if (!target(scope)) return undefined
  const order = intent.orderNo ?? intent.networkRequest?.order.orderNo
  const canonical =
    order && intent.role === 'FRONT' && /^[A-Za-z0-9._:-]{1,128}$/.test(order)
      ? digest('network:' + digest(canonicalV3PrintEffectKey(order, 'FRONT')))
      : null
  const submitted = digest(intent.printJobId)
  return plan.jobs.find((j) => j.keySha256 === canonical || j.keySha256 === submitted)
}

const factKeys = [
  'grantDigest',
  'reviewer',
  'executor',
  'sourceSha',
  'admissionSha256',
  'evidenceDigest',
  'confirmationId',
  'ownerEpoch',
  'stateVersion',
  'modeAuditRequestId',
  'controlPlaneId',
  'cutoffUtc',
  'beforeHash',
  'afterHash',
  'activationGrantDigest',
  'deviceId',
] as const
function signFact(domain: string, fields: readonly string[], fact: Record<string, unknown>) {
  const secret = process.env.AUTH_SECRET
  if (!secret || secret.length < 24 || secret === 'dev-secret-change-in-production')
    throw Error('CASE_RECEIPT_KEY_UNAVAILABLE')
  return createHmac('sha256', secret)
    .update(plan.task + ':' + domain + ':' + JSON.stringify(fields.map((k) => fact[k])))
    .digest('hex')
}
export const signActivation = (fact: Record<string, unknown>) => signFact('CUTOVER', factKeys, fact)
const commonKeys = ['grantDigest', 'reviewer', 'executor', 'sourceSha', 'admissionSha256', 'evidenceDigest']
export const signDisposition = (fact: Record<string, unknown>) =>
  signFact('SEVEN_APPLIED', [...commonKeys, 'beforeHash', 'afterHash'], fact)
const pairs = (value: object) => Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
type AuditFact = Pick<OperationLog, 'id' | 'message' | 'status' | 'payloadSnapshot'>

/** Caller selects only this case's fixed scope, target, action and request ID. */
export function completeDisposition(audit: AuditFact[], fact: Record<string, unknown>) {
  if (!hex(fact.beforeHash) || !hex(fact.afterHash)) return false
  const beforeRows = []
  const afterHashes = []
  for (const suffix of ['review', 'apply', ...plan.jobs.map((j) => j.id)]) {
    const a = audit.find((x) => x.id === 'st04:legacy-front-seven:' + suffix)
    const v = a?.payloadSnapshot as Record<string, unknown> | null
    if (
      !v ||
      a?.status !== 'SUCCESS' ||
      !commonKeys.every((key) => v[key] === fact[key]) ||
      a.message !== (suffix === 'review' ? 'REVIEW' : suffix === 'apply' ? 'APPLY' : 'TICKET')
    )
      return false
    if (suffix === 'review' || suffix === 'apply') {
      if (
        v.beforeHash !== fact.beforeHash ||
        JSON.stringify(v.jobIds) !== JSON.stringify(plan.jobs.map((j) => j.id))
      )
        return false
      if (
        suffix === 'apply' &&
        (v.afterHash !== fact.afterHash ||
          !hex(v.mac) ||
          !timingSafeEqual(Buffer.from(signDisposition(v), 'hex'), Buffer.from(String(v.mac), 'hex')))
      )
        return false
      continue
    }
    for (const side of ['before', 'after'] as const) {
      const image = v[side]
      if (
        !image ||
        typeof image !== 'object' ||
        Array.isArray(image) ||
        (image as Record<string, unknown>).id !== suffix
      )
        return false
      const entry = pairs(image)
      const hash = digest(JSON.stringify([entry]))
      if (hash !== v[side + 'Hash']) return false
      if (side === 'before') beforeRows.push(entry)
      else afterHashes.push(hash)
    }
  }
  return (
    digest(JSON.stringify(beforeRows)) === fact.beforeHash &&
    digest(JSON.stringify(afterHashes)) === fact.afterHash
  )
}
export async function trustedCutoff(log: Log) {
  const row = await log.findUnique({ where: { id: activationReceiptId } })
  if (!row) return null
  const f = row.payloadSnapshot as Record<string, unknown> | null
  if (
    !f ||
    row.status !== 'SUCCESS' ||
    row.tenantId !== scoped.tenantId ||
    row.storeId !== scoped.storeId ||
    row.message !== 'ACTIVATED' ||
    row.actionType !== plan.designAction ||
    row.targetType !== plan.task ||
    row.targetId !== plan.scope.code ||
    row.requestId !== plan.operationRequestId ||
    f.admissionSha256 !== sealedAdmissionSha ||
    f.deviceId !== plan.newOwner ||
    f.confirmationId !== plan.handoffConfirmationId ||
    f.ownerEpoch !== plan.control.ownerEpoch + 1 ||
    f.stateVersion !== plan.control.stateVersion + 3 ||
    !hex(f.afterHash) ||
    !hex(f.activationGrantDigest) ||
    typeof f.cutoffUtc !== 'string' ||
    typeof f.modeAuditRequestId !== 'string' ||
    typeof f.controlPlaneId !== 'string' ||
    typeof f.mac !== 'string' ||
    !hex(f.mac) ||
    !timingSafeEqual(Buffer.from(signActivation(f), 'hex'), Buffer.from(f.mac, 'hex'))
  )
    return null
  const cutoff = new Date(f.cutoffUtc)
  if (
    !Number.isFinite(cutoff.getTime()) ||
    cutoff.toISOString() !== f.cutoffUtc ||
    cutoff.getTime() < Date.parse(plan.notBefore)
  )
    return null
  const audit = await log.findMany({
    where: {
      ...scoped,
      OR: [
        {
          requestId: f.modeAuditRequestId,
          targetType: 'V3PrintControlPlane',
          targetId: f.controlPlaneId,
          actionType: 'V3_PRINT_MODE_OPERATOR_CONFIRMATION',
          message: 'FINALIZE_V3_ACTIVE',
        },
        {
          requestId: plan.operationRequestId,
          targetType: plan.task,
          targetId: plan.scope.code,
          actionType: plan.designAction,
        },
      ],
    },
    select: { id: true, message: true, status: true, payloadSnapshot: true },
  })
  const mode = audit.filter((a) => a.message === 'FINALIZE_V3_ACTIVE')
  const m = mode[0]?.payloadSnapshot as Record<string, unknown> | null
  const transition = m?.requestedTransition as Record<string, unknown> | null
  if (
    mode.length !== 1 ||
    mode[0].status !== 'SUCCESS' ||
    !m ||
    m.operatorAdminId !== f.executor ||
    m.operatorRole !== 'OPS_ADMIN' ||
    transition?.fromMode !== 'BLOCKED_UNKNOWN' ||
    transition?.toMode !== 'V3_ACTIVE' ||
    m.action !== 'FINALIZE_V3_ACTIVE' ||
    m.expectedStateVersion !== plan.control.stateVersion + 2 ||
    m.initialMode !== 'BLOCKED_UNKNOWN' ||
    typeof m.confirmedAt !== 'string' ||
    !(Date.parse(m.confirmedAt) <= cutoff.getTime())
  )
    return null
  return completeDisposition(audit, f) ? cutoff : null
}

/** Existing authority and role predicates remain mandatory; this only narrows the target device's claim. */
export async function cleanStartSelector(
  log: unknown,
  identity: typeof scoped & { deviceId: string },
  epoch: number
) {
  if (!target(identity) || identity.deviceId !== plan.newOwner) return {}
  if (epoch < plan.control.ownerEpoch + 1 || !log || typeof (log as Log).findUnique !== 'function') return null
  const cutoff = await trustedCutoff(log as Log)
  return cutoff ? { createdAt: { gt: cutoff }, NOT: { id: { in: plan.jobs.map((j) => j.id) } } } : null
}
