import { createHash } from 'node:crypto'
import { Prisma, type EshopTrayPrintJob } from '@prisma/client'
import type { V3ControlPlaneDb } from './v3-print-control-plane'
import { parseNetworkRequest, type NetworkRequest } from '../e-shop-tray/src/networkContract'
import { ES_TRAY_QUEUE_NAME, ES_TRAY_RELAY_VERSION } from './es-tray-relay/config'
import { hashPrintRequest, type EshopTrayPrintRequest } from './es-tray-relay/contract'

export const V3_PRINT_JOB_SCHEMA = 3 as const
export type V3PrintSource = 'LOCAL_DESKTOP' | 'CLOUD_H5' | 'CLOUD_THIRD_PARTY' | 'CLOUD_REMOTE_REPRINT'
export type V3PrintRole = 'FRONT' | 'KITCHEN'
type V3IntentBase = {
  schemaVersion: 3; printJobId: string; source: V3PrintSource; role: V3PrintRole
}
export type V3Intent = V3IntentBase & ({ payloadKind: 'RAW_BYTES'; orderNo: string; rendererVersion: string; payloadBase64: string; byteLength: number; payloadHash: string }
  | { payloadKind: 'NETWORK_REQUEST'; rendererVersion: 'network-1'; networkRequest: NetworkRequest; payloadHash: string })

type Db = V3ControlPlaneDb & {
  eshopTrayPrintJob: {
    create(args: any): Promise<EshopTrayPrintJob>
    findUnique(args: any): Promise<EshopTrayPrintJob | null>
    findFirst(args: any): Promise<EshopTrayPrintJob | null>
    updateMany(args: any): Promise<{ count: number }>
  }
  v3PrintExecutionBatch: V3ControlPlaneDb['v3PrintExecutionBatch'] & { findUnique(args: any): Promise<any> }
}

function persistenceScope(scope: { tenantId: string; storeId: string }) {
  return { tenantId: scope.tenantId, storeId: scope.storeId }
}

function sha(value: string | Uint8Array) { return createHash('sha256').update(value).digest('hex') }
function claimProvenance(input: { deviceId: string; ownerEpoch: number; batchId: string }) {
  return `V3_CLAIM:${input.deviceId}:${input.ownerEpoch}:${input.batchId}`
}
function sameExecutionOwner(value: string | null, deviceId: string, ownerEpoch: number) {
  const prefix = `V3_CLAIM:${deviceId}:${ownerEpoch}:`
  return typeof value === 'string' && value.startsWith(prefix) && value.length > prefix.length
}
function parsedResultCode(value: string | null) {
  const match = /^V3:([^:]+):(\d+):(\d+):(CROSSED|FAILED_NOT_CROSSED|CROSSING_UNKNOWN)$/.exec(value ?? '')
  return match ? { executionId: match[1], ownerEpoch: Number(match[2]), reportVersion: Number(match[3]), outcome: match[4] } : null
}
function isTerminalLocalReconciliation(job: EshopTrayPrintJob, printJobId: string, role: V3PrintRole) {
  if (job.schemaVersion !== 3 || !job.completedAt || job.idempotencyKey !== printJobId || !job.payload ||
    typeof job.payload !== 'object' || Array.isArray(job.payload)) return false
  const payload = job.payload as Record<string, unknown>
  return payload.schemaVersion === 3 && payload.kind === 'LOCAL_RECONCILIATION' && payload.printJobId === printJobId &&
    payload.source === 'LOCAL_DESKTOP' && payload.role === role
}
function parse(value: unknown): V3Intent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (row.schemaVersion !== 3 || typeof row.printJobId !== 'string' || row.printJobId.length < 8 || row.printJobId.length > 128 ||
    !['LOCAL_DESKTOP', 'CLOUD_H5', 'CLOUD_THIRD_PARTY', 'CLOUD_REMOTE_REPRINT'].includes(String(row.source)) ||
    (row.role !== 'FRONT' && row.role !== 'KITCHEN') || typeof row.rendererVersion !== 'string' || !row.rendererVersion ||
    typeof row.payloadHash !== 'string' || !/^[0-9a-f]{64}$/.test(row.payloadHash)) return null
  if (row.payloadKind === 'RAW_BYTES') {
    if (Object.keys(row).sort().join(',') !== 'byteLength,orderNo,payloadBase64,payloadHash,payloadKind,printJobId,rendererVersion,role,schemaVersion,source' ||
      typeof row.orderNo !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(row.orderNo) ||
      typeof row.payloadBase64 !== 'string' || !Number.isInteger(row.byteLength) || Number(row.byteLength) < 1) return null
    const bytes = Buffer.from(row.payloadBase64, 'base64')
    return bytes.length === row.byteLength && bytes.toString('base64') === row.payloadBase64 && sha(bytes) === row.payloadHash ? row as unknown as V3Intent : null
  }
  if (row.payloadKind === 'NETWORK_REQUEST') {
    if (Object.keys(row).sort().join(',') !== 'networkRequest,payloadHash,payloadKind,printJobId,rendererVersion,role,schemaVersion,source' || row.rendererVersion !== 'network-1') return null
    try {
      const request = parseNetworkRequest(row.networkRequest)
      return request.requestId === row.printJobId && request.role === row.role && sha(JSON.stringify(request)) === row.payloadHash ? row as unknown as V3Intent : null
    } catch { return null }
  }
  return null
}

const HELD_MARKER = 'V3_DURABLY_HELD'

export async function enqueueHeldV3PrintIntent(db: Db, scope: { tenantId: string; storeId: string }, intent: V3Intent, expiresAt: Date) {
  const ownedScope = persistenceScope(scope)
  const result = await enqueueV3PrintIntent(db, ownedScope, intent, expiresAt)
  if (!result.created) return result
  const held = await db.eshopTrayPrintJob.updateMany({
    where: { id: result.job.id, schemaVersion: 3, status: 'PENDING', completedAt: null },
    data: { resultMessage: HELD_MARKER, nextAttemptAt: expiresAt },
  })
  if (held.count !== 1) throw new Error('V3_HELD_DURABILITY_RACE')
  const job = await db.eshopTrayPrintJob.findUnique({ where: { tenantId_storeId_idempotencyKey: { ...ownedScope, idempotencyKey: intent.printJobId } } })
  if (!job) throw new Error('V3_HELD_DURABILITY_MISSING')
  return { created: true, job }
}

export async function materializeHeldV3PrintIntents(
  db: Db,
  scope: { tenantId: string; storeId: string },
  target: 'V2_ACTIVE' | 'V3_ACTIVE',
  now: Date,
) {
  const ownedScope = persistenceScope(scope)
  const jobs = await (db.eshopTrayPrintJob as any).findMany({ where: {
    ...ownedScope, schemaVersion: 3, status: 'PENDING', completedAt: null, resultMessage: HELD_MARKER,
  } }) as EshopTrayPrintJob[]
  for (const job of jobs) {
    const intent = parse(job.payload)
    if (!intent) throw new Error('V3_HELD_INTENT_CORRUPT')
    if (target === 'V3_ACTIVE') {
      const updated = await db.eshopTrayPrintJob.updateMany({ where: {
        id: job.id, schemaVersion: 3, status: 'PENDING', completedAt: null, resultMessage: HELD_MARKER,
      }, data: { resultMessage: null, nextAttemptAt: now } })
      if (updated.count !== 1) throw new Error('V3_HELD_MATERIALIZATION_RACE')
      continue
    }
    const payload: EshopTrayPrintRequest | NetworkRequest = intent.payloadKind === 'NETWORK_REQUEST'
      ? intent.networkRequest
      : {
          relayVersion: ES_TRAY_RELAY_VERSION,
          requestId: intent.printJobId,
          orderNo: intent.orderNo,
          documentName: `E-Shop ${intent.role}`,
          target: { transport: 'windows-queue', queueName: ES_TRAY_QUEUE_NAME },
          commandStream: { encoding: 'base64', byteLength: intent.byteLength, sha256: intent.payloadHash, data: intent.payloadBase64 },
        }
    const schemaVersion = intent.payloadKind === 'NETWORK_REQUEST' ? 2 : 1
    const requestHash = intent.payloadKind === 'NETWORK_REQUEST' ? sha(JSON.stringify(payload)) : hashPrintRequest(payload as EshopTrayPrintRequest)
    const updated = await db.eshopTrayPrintJob.updateMany({ where: {
      id: job.id, schemaVersion: 3, status: 'PENDING', completedAt: null, resultMessage: HELD_MARKER,
    }, data: { schemaVersion, payload: payload as unknown as Prisma.InputJsonValue, requestHash, resultMessage: null, nextAttemptAt: now } })
    if (updated.count !== 1) throw new Error('V3_HELD_MATERIALIZATION_RACE')
  }
  return jobs.length
}

export function v3IntentFromNetworkRequest(request: NetworkRequest, source: Exclude<V3PrintSource, 'LOCAL_DESKTOP'>): V3Intent {
  const normalized = parseNetworkRequest(request)
  return { schemaVersion: 3, printJobId: normalized.requestId, source, role: normalized.role, payloadKind: 'NETWORK_REQUEST',
    rendererVersion: 'network-1', networkRequest: normalized, payloadHash: sha(JSON.stringify(normalized)) }
}

export async function enqueueV3PrintIntent(db: Db, scope: { tenantId: string; storeId: string }, intent: V3Intent, expiresAt: Date) {
  const ownedScope = persistenceScope(scope)
  const normalized = parse(intent)
  if (!normalized) throw new Error('V3_INTENT_INVALID')
  const requestHash = sha(JSON.stringify(normalized))
  try {
    const job = await db.eshopTrayPrintJob.create({ data: { ...ownedScope, idempotencyKey: normalized.printJobId, requestHash,
      schemaVersion: 3, payload: normalized as unknown as Prisma.InputJsonValue, maxAttempts: 1, expiresAt,
      physicalCompletionKnown: false } })
    return { created: true, job }
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error
    const job = await db.eshopTrayPrintJob.findUnique({ where: { tenantId_storeId_idempotencyKey: { ...ownedScope, idempotencyKey: normalized.printJobId } } })
    if (!job || (job.requestHash !== requestHash && !isTerminalLocalReconciliation(job, normalized.printJobId, normalized.role))) {
      throw new Error('V3_INTENT_IDEMPOTENCY_CONFLICT')
    }
    return { created: false, job }
  }
}

async function validBatch(db: Db, identity: { tenantId: string; storeId: string; deviceId: string; batchId: string }, now: Date) {
  const batch = await db.v3PrintExecutionBatch.findUnique({ where: { id: identity.batchId }, include: { controlPlane: true } })
  return batch && batch.tenantId === identity.tenantId && batch.storeId === identity.storeId && batch.ownerDeviceId === identity.deviceId &&
    batch.mode === 'V3_ACTIVE' && !batch.revokedAt && batch.expiresAt > now && batch.controlPlane.mode === 'V3_ACTIVE' &&
    batch.controlPlane.ownerDeviceId === identity.deviceId && batch.controlPlane.ownerEpoch === batch.ownerEpoch &&
    batch.controlPlane.leaseId === batch.leaseId ? batch : null
}

export async function deliverV3PrintIntent(db: Db, identity: { tenantId: string; storeId: string; deviceId: string; batchId: string }, now = new Date()) {
  const batch = await validBatch(db, identity, now)
  if (!batch) return { ok: false as const, code: 'V3_BATCH_STALE' }
  const tokenHash = sha(`v3-delivery:${batch.id}:${batch.ownerEpoch}`)
  const existing = await db.eshopTrayPrintJob.findFirst({ where: { tenantId: identity.tenantId, storeId: identity.storeId,
    schemaVersion: 3, status: 'CLAIMED', expiresAt: { gt: now } }, orderBy: { createdAt: 'asc' } })
  if (existing) {
    const intent = parse(existing.payload)
    if (!intent || !sameExecutionOwner(existing.resultMessage, identity.deviceId, batch.ownerEpoch)) {
      return { ok: false as const, code: 'V3_CLAIM_AMBIGUOUS' }
    }
    if (existing.claimTokenHash !== tokenHash) {
      const reclaimed = await db.eshopTrayPrintJob.updateMany({ where: { id: existing.id, schemaVersion: 3, status: 'CLAIMED',
        claimTokenHash: existing.claimTokenHash, resultMessage: existing.resultMessage }, data: { claimTokenHash: tokenHash,
        resultMessage: claimProvenance({ deviceId: identity.deviceId, ownerEpoch: batch.ownerEpoch, batchId: batch.id }), leaseExpiresAt: batch.expiresAt } })
      if (reclaimed.count !== 1) return { ok: false as const, code: 'V3_DELIVERY_RACE' }
    }
    return { ok: true as const, job: { id: existing.id, printJobId: existing.idempotencyKey, expiresAt: existing.expiresAt, intent } }
  }
  const job = await db.eshopTrayPrintJob.findFirst({ where: { tenantId: identity.tenantId, storeId: identity.storeId,
    schemaVersion: 3, status: 'PENDING', nextAttemptAt: { lte: now }, expiresAt: { gt: now } }, orderBy: { createdAt: 'asc' } })
  if (!job || !parse(job.payload)) return { ok: true as const, job: null }
  const updated = await db.eshopTrayPrintJob.updateMany({ where: { id: job.id, schemaVersion: 3, status: 'PENDING' }, data: {
    status: 'CLAIMED', claimTokenHash: tokenHash, resultMessage: claimProvenance({ deviceId: identity.deviceId, ownerEpoch: batch.ownerEpoch, batchId: batch.id }),
    claimAttempt: { increment: 1 }, attemptCount: { increment: 1 }, leaseExpiresAt: batch.expiresAt,
  } })
  return updated.count === 1 ? { ok: true as const, job: { id: job.id, printJobId: job.idempotencyKey, expiresAt: job.expiresAt, intent: parse(job.payload)! } }
    : { ok: false as const, code: 'V3_DELIVERY_RACE' }
}

export async function reportV3Execution(db: Db, identity: { tenantId: string; storeId: string; deviceId: string; batchId: string }, report: {
  printJobId: string; source: V3PrintSource; role: V3PrintRole; executionId: string; ownerEpoch: number; reportVersion: number; outcome: 'CROSSED' | 'FAILED_NOT_CROSSED' | 'CROSSING_UNKNOWN'
}, now = new Date()) {
  const batch = await db.v3PrintExecutionBatch.findUnique({ where: { id: identity.batchId } })
  if (!batch || batch.tenantId !== identity.tenantId || batch.storeId !== identity.storeId || batch.ownerDeviceId !== identity.deviceId ||
    batch.ownerEpoch !== report.ownerEpoch) return { ok: false as const, code: 'V3_REPORT_PROVENANCE_STALE' }
  const resultCode = `V3:${report.executionId}:${report.ownerEpoch}:${report.reportVersion}:${report.outcome}`
  let job = await db.eshopTrayPrintJob.findUnique({ where: { tenantId_storeId_idempotencyKey: { tenantId: identity.tenantId, storeId: identity.storeId, idempotencyKey: report.printJobId } } })
  if (!job && report.source === 'LOCAL_DESKTOP') {
    const reconciliation = { schemaVersion: 3, kind: 'LOCAL_RECONCILIATION', printJobId: report.printJobId, source: report.source, role: report.role,
      executionId: report.executionId, ownerEpoch: report.ownerEpoch }
    try {
      job = await db.eshopTrayPrintJob.create({ data: { tenantId: identity.tenantId, storeId: identity.storeId,
        idempotencyKey: report.printJobId, requestHash: sha(JSON.stringify(reconciliation)), schemaVersion: 3,
        payload: reconciliation as unknown as Prisma.InputJsonValue, status: report.outcome === 'CROSSED' ? 'SUCCEEDED' : 'FAILED', maxAttempts: 1,
        expiresAt: batch.expiresAt, completedAt: now, resultStatus: report.outcome, resultCode,
        effectBoundary: report.outcome === 'FAILED_NOT_CROSSED' ? 'NOT_CROSSED' : report.outcome, physicalCompletionKnown: false } })
      return { ok: true as const, acknowledged: true as const }
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error
      job = await db.eshopTrayPrintJob.findUnique({ where: { tenantId_storeId_idempotencyKey: { tenantId: identity.tenantId, storeId: identity.storeId, idempotencyKey: report.printJobId } } })
    }
  }
  if (!job || job.schemaVersion !== 3) return { ok: false as const, code: 'V3_JOB_NOT_FOUND' }
  if (job.completedAt) {
    if (job.resultCode === resultCode) return { ok: true as const, acknowledged: true as const }
    const previous = parsedResultCode(job.resultCode)
    if (previous?.executionId === report.executionId && previous.ownerEpoch === report.ownerEpoch &&
      previous.outcome === 'CROSSING_UNKNOWN' && report.outcome !== 'CROSSING_UNKNOWN' && previous.reportVersion < report.reportVersion) {
      const reconciled = await db.eshopTrayPrintJob.updateMany({ where: { id: job.id, schemaVersion: 3, resultCode: job.resultCode }, data: {
        status: report.outcome === 'CROSSED' ? 'SUCCEEDED' : 'FAILED', completedAt: now, resultStatus: report.outcome,
        resultCode, effectBoundary: report.outcome === 'FAILED_NOT_CROSSED' ? 'NOT_CROSSED' : report.outcome,
      } })
      return reconciled.count === 1 ? { ok: true as const, acknowledged: true as const } : { ok: false as const, code: 'V3_REPORT_RACE' }
    }
    return { ok: false as const, code: 'V3_REPORT_CONFLICT' }
  }
  const intent = parse(job.payload)
  if (!intent || intent.role !== report.role) return { ok: false as const, code: 'V3_REPORT_IDENTITY_MISMATCH' }
  const localReconciliation = report.source === 'LOCAL_DESKTOP'
    ? { schemaVersion: 3, kind: 'LOCAL_RECONCILIATION', printJobId: report.printJobId, source: report.source, role: report.role,
      executionId: report.executionId, ownerEpoch: report.ownerEpoch }
    : null
  if (!localReconciliation && intent.source !== report.source) return { ok: false as const, code: 'V3_REPORT_IDENTITY_MISMATCH' }
  const claimTokenHash = sha(`v3-delivery:${batch.id}:${batch.ownerEpoch}`)
  if (job.status === 'CLAIMED' && job.claimTokenHash !== claimTokenHash) return { ok: false as const, code: 'V3_JOB_NOT_FOUND' }
  if (job.status !== 'PENDING' && job.status !== 'CLAIMED') return { ok: false as const, code: 'V3_REPORT_CONFLICT' }
  const updated = await db.eshopTrayPrintJob.updateMany({ where: {
    id: job.id, schemaVersion: 3, completedAt: null, status: job.status,
    ...(job.status === 'CLAIMED' ? { claimTokenHash } : {}),
  }, data: {
    status: report.outcome === 'CROSSED' ? 'SUCCEEDED' : 'FAILED', completedAt: now, resultStatus: report.outcome,
    resultCode, effectBoundary: report.outcome === 'FAILED_NOT_CROSSED' ? 'NOT_CROSSED' : report.outcome,
    physicalCompletionKnown: false, leaseExpiresAt: null, claimTokenHash: null,
    ...(localReconciliation ? {
      payload: localReconciliation as unknown as Prisma.InputJsonValue,
      requestHash: sha(JSON.stringify(localReconciliation)),
    } : {}),
  } })
  return updated.count === 1 ? { ok: true as const, acknowledged: true as const } : { ok: false as const, code: 'V3_REPORT_RACE' }
}
