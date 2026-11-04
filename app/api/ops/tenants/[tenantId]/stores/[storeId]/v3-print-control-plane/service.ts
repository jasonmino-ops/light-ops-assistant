import { createHash, randomUUID } from 'node:crypto'
import type { EshopTrayPrintJob, Prisma, PrismaClient } from '@prisma/client'
import { canonicalV3PrintEffectKey, v3PrintIntentExpiresAt } from '@/lib/v3-print-identity'
import { parseV3PrintIntent } from '@/lib/v3-print-job-adapter'
import { hashInstallationId } from '@/lib/desktop-activation/crypto'
import {
  readV3ControlPlane,
  transitionV3PrintMode,
  type V3ControlPlaneDb,
} from '@/lib/v3-print-control-plane'

export type OpsPrintModeAction =
  | 'START_ACTIVATION'
  | 'ENTER_MANUAL_REVIEW'
  | 'FINALIZE_V3_ACTIVE'
  | 'START_DEACTIVATION'
  | 'FINALIZE_V2_ACTIVE'

const V2_DRAIN_WINDOW_MS = 120_000
const V3_HELD_MARKER = 'V3_DURABLY_HELD'

export type OpsPrintControlDb = V3ControlPlaneDb & {
  desktopDevice: V3ControlPlaneDb['desktopDevice'] & {
    count(args: unknown): Promise<number>
  }
  eshopTrayPrintJob: V3ControlPlaneDb['eshopTrayPrintJob'] & {
    count(args: unknown): Promise<number>
  }
  operationLog: V3ControlPlaneDb['operationLog'] & {
    findFirst(args: unknown): Promise<{ id: string; payloadSnapshot: unknown } | null>
  }
}

type TransitionInput = {
  tenantId: string
  storeId: string
  operatorAdminId: string
  operatorRole: string
  expectedStateVersion: number
  action: OpsPrintModeAction
}

type OpsOperatorIdentity = { id: string; role: string }
type OpsStoreIdentity = { id: string; tenantId: string; code: string }

export async function resolveOpsPrintStoreAccess<TRequest>(
  request: TRequest,
  scope: { tenantId: string; storeId: string },
  dependencies: {
    authenticate(request: TRequest): Promise<OpsOperatorIdentity | false>
    findActiveStore(scope: { tenantId: string; storeId: string }): Promise<OpsStoreIdentity | null>
  },
): Promise<
  | { ok: false; code: 'FORBIDDEN' | 'STORE_NOT_FOUND' }
  | { ok: true; operator: OpsOperatorIdentity; store: OpsStoreIdentity }
> {
  const operator = await dependencies.authenticate(request)
  if (!operator) return { ok: false, code: 'FORBIDDEN' as const }
  const store = await dependencies.findActiveStore(scope)
  if (!store || store.id !== scope.storeId || store.tenantId !== scope.tenantId) {
    return { ok: false, code: 'STORE_NOT_FOUND' as const }
  }
  return { ok: true, operator, store } as const
}

export function parseOpsPrintModeCommand(body: unknown):
  | { ok: true; value: { confirmed: true; expectedStateVersion: number; action: OpsPrintModeAction } }
  | { ok: false; code: 'INVALID_REQUEST' | 'INVALID_SCOPE_INPUT' } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, code: 'INVALID_REQUEST' }
  const input = body as Record<string, unknown>
  if ('tenantId' in input || 'storeId' in input || 'ownerDeviceId' in input) {
    return { ok: false, code: 'INVALID_SCOPE_INPUT' }
  }
  const actions: readonly string[] = [
    'START_ACTIVATION', 'ENTER_MANUAL_REVIEW', 'FINALIZE_V3_ACTIVE', 'START_DEACTIVATION', 'FINALIZE_V2_ACTIVE',
  ]
  if (input.confirmed !== true || !Number.isInteger(input.expectedStateVersion) || !actions.includes(String(input.action))) {
    return { ok: false, code: 'INVALID_REQUEST' }
  }
  return { ok: true, value: {
    confirmed: true,
    expectedStateVersion: input.expectedStateVersion as number,
    action: input.action as OpsPrintModeAction,
  } }
}

export function validateOpsPrintMutationRequest(request: {
  url: string
  headers: { get(name: string): string | null }
}): { ok: true } | { ok: false; code: 'INVALID_REQUEST_ORIGIN' | 'INVALID_CONTENT_TYPE' } {
  const contentType = request.headers.get('content-type')?.trim().toLowerCase() ?? ''
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/.test(contentType)) {
    return { ok: false, code: 'INVALID_CONTENT_TYPE' }
  }
  const origin = request.headers.get('origin')?.trim() ?? ''
  const fetchSite = request.headers.get('sec-fetch-site')?.trim().toLowerCase() ?? ''
  if (origin !== new URL(request.url).origin || fetchSite !== 'same-origin') {
    return { ok: false, code: 'INVALID_REQUEST_ORIGIN' }
  }
  return { ok: true }
}

type TransitionResult =
  | { ok: true; requestId: string; controlPlane: Awaited<ReturnType<typeof readV3ControlPlane>> }
  | { ok: false; code: string; controlPlane: Awaited<ReturnType<typeof readV3ControlPlane>> }

class RejectedTransition extends Error {
  public constructor(public readonly result: Extract<TransitionResult, { ok: false }>) {
    super(result.code)
    this.name = 'RejectedTransition'
  }
}

function asOpsTransactionDb(tx: any): OpsPrintControlDb {
  return {
    v3PrintControlPlane: tx.v3PrintControlPlane,
    v3PrintExecutionBatch: tx.v3PrintExecutionBatch,
    desktopDevice: tx.desktopDevice,
    operationLog: tx.operationLog,
    eshopTrayPrintJob: tx.eshopTrayPrintJob,
    $transaction: async (operation) => operation(tx),
  }
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null
  return typeof error.code === 'string' ? error.code : null
}

async function findActiveBatch(
  targetDb: V3ControlPlaneDb,
  scope: { tenantId: string; storeId: string },
  now: Date,
) {
  return targetDb.v3PrintExecutionBatch.findFirst({
    where: {
      tenantId: scope.tenantId,
      storeId: scope.storeId,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    orderBy: { expiresAt: 'desc' },
  })
}

async function hasFinalizedHandoffAuthority(
  targetDb: OpsPrintControlDb,
  controlPlane: Awaited<ReturnType<typeof readV3ControlPlane>>,
  now: Date,
) {
  if (!controlPlane.ownerDeviceId || !controlPlane.leaseId || !controlPlane.leaseExpiresAt ||
    controlPlane.leaseId.startsWith('handoff:') || new Date(controlPlane.leaseExpiresAt) <= now ||
    controlPlane.handoffQuarantineUntil !== null) return false
  const [owner, audit] = await Promise.all([
    targetDb.desktopDevice.findFirst({
      where: {
        id: controlPlane.ownerDeviceId,
        tenantId: controlPlane.tenantId,
        storeId: controlPlane.storeId,
        status: 'ACTIVE',
      },
      select: { id: true },
    }),
    targetDb.operationLog.findFirst({
      where: {
        tenantId: controlPlane.tenantId,
        storeId: controlPlane.storeId,
        actionType: 'V3_PRINT_CONTROLLED_HANDOFF',
        targetType: 'V3PrintControlPlane',
        targetId: controlPlane.id,
        status: 'SUCCESS',
        message: 'HANDOFF_CONFIRMED',
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, payloadSnapshot: true },
    }),
  ])
  if (!owner || owner.id !== controlPlane.ownerDeviceId) return false
  const snapshot = audit?.payloadSnapshot
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false
  const evidence = snapshot as Record<string, unknown>
  return evidence.intendedOwnerDeviceId === controlPlane.ownerDeviceId &&
    evidence.ownerEpoch === controlPlane.ownerEpoch && evidence.stateVersion === controlPlane.stateVersion
}

async function readV2QueueState(
  targetDb: OpsPrintControlDb,
  scope: { tenantId: string; storeId: string },
) {
  const where = { ...scope, schemaVersion: { in: [1, 2] } }
  const [pending, claimed, executing, crossingUnknown] = await Promise.all([
    targetDb.eshopTrayPrintJob.count({ where: { ...where, status: 'PENDING' } }),
    targetDb.eshopTrayPrintJob.count({ where: { ...where, status: 'CLAIMED' } }),
    targetDb.eshopTrayPrintJob.count({ where: { ...where, status: 'EXECUTING' } }),
    targetDb.eshopTrayPrintJob.count({ where: { ...where, effectBoundary: 'CROSSING_UNKNOWN' } }),
  ])
  return { pending, claimed, executing, crossingUnknown }
}

async function readV3QueueState(
  targetDb: OpsPrintControlDb,
  scope: { tenantId: string; storeId: string },
) {
  const where = { ...scope, schemaVersion: 3 }
  const [pending, claimed, executing, crossingUnknown] = await Promise.all([
    targetDb.eshopTrayPrintJob.count({
      where: {
        ...where,
        status: 'PENDING',
        completedAt: null,
        OR: [
          { resultMessage: null },
          { resultMessage: { not: V3_HELD_MARKER } },
        ],
      },
    }),
    targetDb.eshopTrayPrintJob.count({ where: { ...where, status: 'CLAIMED' } }),
    targetDb.eshopTrayPrintJob.count({ where: { ...where, status: 'EXECUTING' } }),
    targetDb.eshopTrayPrintJob.count({ where: { ...where, effectBoundary: 'CROSSING_UNKNOWN' } }),
  ])
  return { pending, claimed, executing, crossingUnknown }
}

export async function readOpsPrintModeState(
  targetDb: OpsPrintControlDb,
  scope: { tenantId: string; storeId: string },
  now = new Date(),
) {
  const controlPlane = await readV3ControlPlane(targetDb, scope)
  const [activeBatch, registeredDeviceCount, ownerDevice, v2Queue, v3Queue] = await Promise.all([
    findActiveBatch(targetDb, scope, now),
    targetDb.desktopDevice.count({
      where: { tenantId: scope.tenantId, storeId: scope.storeId, status: 'ACTIVE' },
    }),
    controlPlane.ownerDeviceId
      ? (targetDb.desktopDevice as unknown as {
          findFirst(args: unknown): Promise<{ id: string; status: string; lastSeenAt: Date | null } | null>
        }).findFirst({
          where: {
            id: controlPlane.ownerDeviceId,
            tenantId: scope.tenantId,
            storeId: scope.storeId,
          },
          select: { id: true, status: true, lastSeenAt: true },
        })
      : Promise.resolve(null),
    readV2QueueState(targetDb, scope),
    readV3QueueState(targetDb, scope),
  ])
  const handoffBlocked = controlPlane.handoffQuarantineUntil !== null
  const hasActiveBatch = activeBatch !== null
  const hasOwner = controlPlane.ownerDeviceId !== null
  const v2DrainBlocked = Object.values(v2Queue).some((count) => count > 0)
  const v2ExecutionAmbiguous = v2Queue.claimed > 0 || v2Queue.executing > 0 || v2Queue.crossingUnknown > 0
  const v3DrainBlocked = Object.values(v3Queue).some((count) => count > 0)
  const v3Released = !hasOwner && !hasActiveBatch && !handoffBlocked
  const finalizedHandoffAuthority = !hasActiveBatch && ownerDevice?.status === 'ACTIVE' &&
    await hasFinalizedHandoffAuthority(targetDb, controlPlane, now)
  const v2DrainReadyAt = controlPlane.mode === 'V2_DRAINING'
    ? new Date(Date.parse(controlPlane.updatedAt) + V2_DRAIN_WINDOW_MS)
    : null
  const v2DrainWindowActive = v2DrainReadyAt !== null && v2DrainReadyAt > now

  return {
    controlPlane: {
      mode: controlPlane.mode,
      stateVersion: controlPlane.stateVersion,
      ownerDeviceId: controlPlane.ownerDeviceId,
      ownerEpoch: controlPlane.ownerEpoch,
      leaseExpiresAt: controlPlane.leaseExpiresAt,
      handoffRequestedAt: controlPlane.handoffRequestedAt,
      handoffQuarantineUntil: controlPlane.handoffQuarantineUntil,
      lastReconciledAt: controlPlane.lastReconciledAt,
      updatedAt: controlPlane.updatedAt,
    },
    ownerDevice: ownerDevice ? {
      id: ownerDevice.id,
      status: ownerDevice.status,
      lastSeenAt: ownerDevice.lastSeenAt?.toISOString() ?? null,
    } : null,
    activeBatch: activeBatch ? {
      id: activeBatch.id,
      ownerDeviceId: activeBatch.ownerDeviceId,
      ownerEpoch: activeBatch.ownerEpoch,
      expiresAt: activeBatch.expiresAt.toISOString(),
    } : null,
    v2Queue,
    v3Queue,
    v2DrainReadyAt: v2DrainReadyAt?.toISOString() ?? null,
    registeredDeviceCount,
    blocking: {
      ownerActive: hasOwner,
      activeExecutionBatch: hasActiveBatch,
      handoffOrReconciliation: handoffBlocked,
      v2Drain: v2DrainBlocked,
      v2DrainWindowActive,
      v2ExecutionAmbiguous,
      v3Drain: v3DrainBlocked,
    },
    actions: {
      startActivation: controlPlane.mode === 'V2_ACTIVE' && v3Released,
      enterManualReview: (
        controlPlane.mode === 'V2_DRAINING' && v3Released && !v2DrainBlocked && !v2DrainWindowActive
      ) || (
        controlPlane.mode === 'V3_DRAINING' && v3Released && !v2ExecutionAmbiguous && !v3DrainBlocked
      ),
      finalizeV3Active: controlPlane.mode === 'BLOCKED_UNKNOWN' && (v3Released || finalizedHandoffAuthority) &&
        !v2DrainBlocked && !v3DrainBlocked,
      startDeactivation: controlPlane.mode === 'V3_ACTIVE' && !handoffBlocked && !v3DrainBlocked,
      finalizeV2Active: controlPlane.mode === 'BLOCKED_UNKNOWN' && v3Released && !v2ExecutionAmbiguous && !v3DrainBlocked,
    },
  }
}

export async function runOpsPrintModeAction(
  targetDb: OpsPrintControlDb,
  input: TransitionInput,
  now = new Date(),
): Promise<TransitionResult> {
  const scope = { tenantId: input.tenantId, storeId: input.storeId }
  const runSerializable = targetDb.$transaction.bind(targetDb) as unknown as <T>(
    operation: (tx: unknown) => Promise<T>,
    options: { isolationLevel: 'Serializable' },
  ) => Promise<T>

  try {
    return await runSerializable(async (rawTx) => {
      const tx = asOpsTransactionDb(rawTx)
      const initial = await readV3ControlPlane(tx, scope)
      if (initial.stateVersion !== input.expectedStateVersion) {
        return { ok: false, code: 'CONCURRENT_STATE_CHANGE', controlPlane: initial }
      }

      const [activeBatch, v2Queue, v3Queue] = await Promise.all([
        findActiveBatch(tx, scope, now),
        readV2QueueState(tx, scope),
        readV3QueueState(tx, scope),
      ])
      const handoffBlocked = initial.handoffQuarantineUntil !== null
      if (handoffBlocked) return { ok: false, code: 'HANDOFF_NOT_FINALIZED', controlPlane: initial }

      const transition = (() => {
        switch (input.action) {
          case 'START_ACTIVATION':
            return initial.mode === 'V2_ACTIVE' ? { nextMode: 'V2_DRAINING' as const } : null
          case 'ENTER_MANUAL_REVIEW':
            return initial.mode === 'V2_DRAINING' || initial.mode === 'V3_DRAINING'
              ? { nextMode: 'BLOCKED_UNKNOWN' as const }
              : null
          case 'FINALIZE_V3_ACTIVE':
            return initial.mode === 'BLOCKED_UNKNOWN' ? { nextMode: 'V3_ACTIVE' as const } : null
          case 'START_DEACTIVATION':
            return initial.mode === 'V3_ACTIVE' ? { nextMode: 'V3_DRAINING' as const } : null
          case 'FINALIZE_V2_ACTIVE':
            return initial.mode === 'BLOCKED_UNKNOWN' ? { nextMode: 'V2_ACTIVE' as const } : null
        }
      })()
      if (!transition) {
        return { ok: false, code: 'ACTION_NOT_AVAILABLE', controlPlane: initial }
      }

      const enteringOrLeavingActivationGate =
        (input.action === 'ENTER_MANUAL_REVIEW' && initial.mode === 'V2_DRAINING') ||
        input.action === 'FINALIZE_V3_ACTIVE'
      const v2DrainBlocked = Object.values(v2Queue).some((count) => count > 0)
      const v2ExecutionAmbiguous = v2Queue.claimed > 0 || v2Queue.executing > 0 || v2Queue.crossingUnknown > 0
      const v3DrainBlocked = Object.values(v3Queue).some((count) => count > 0)
      const v2DrainWindowActive = initial.mode === 'V2_DRAINING' &&
        new Date(Date.parse(initial.updatedAt) + V2_DRAIN_WINDOW_MS) > now
      if (input.action === 'ENTER_MANUAL_REVIEW' && v2DrainWindowActive) {
        return { ok: false, code: 'V2_DRAIN_WINDOW_ACTIVE', controlPlane: initial }
      }
      if (enteringOrLeavingActivationGate && v2DrainBlocked) {
        return { ok: false, code: 'V2_DRAIN_NOT_COMPLETE', controlPlane: initial }
      }
      if (input.action === 'FINALIZE_V3_ACTIVE' && v3DrainBlocked) {
        return { ok: false, code: 'V3_EXECUTION_AMBIGUOUS', controlPlane: initial }
      }
      if (((input.action === 'ENTER_MANUAL_REVIEW' && initial.mode === 'V3_DRAINING') || input.action === 'FINALIZE_V2_ACTIVE') &&
        v2ExecutionAmbiguous) {
        return { ok: false, code: 'V2_EXECUTION_AMBIGUOUS', controlPlane: initial }
      }
      if (((input.action === 'ENTER_MANUAL_REVIEW' && initial.mode === 'V3_DRAINING') || input.action === 'FINALIZE_V2_ACTIVE') &&
        v3DrainBlocked) {
        return { ok: false, code: 'V3_DRAIN_NOT_COMPLETE', controlPlane: initial }
      }
      if (input.action === 'START_DEACTIVATION' && v3DrainBlocked) {
        return { ok: false, code: 'V3_DRAIN_NOT_COMPLETE', controlPlane: initial }
      }
      const finalizedHandoffAuthority = input.action === 'FINALIZE_V3_ACTIVE' &&
        await hasFinalizedHandoffAuthority(tx, initial, now)
      if (input.action !== 'START_DEACTIVATION') {
        if (initial.ownerDeviceId !== null && !finalizedHandoffAuthority) {
          return { ok: false, code: 'OWNER_RELEASE_REQUIRED', controlPlane: initial }
        }
        if (activeBatch) return { ok: false, code: 'ACTIVE_EXECUTION_BATCH', controlPlane: initial }
      }

      const requestId = randomUUID()
      await tx.operationLog.create({
        data: {
          tenantId: input.tenantId,
          storeId: input.storeId,
          userId: null,
          actionType: 'V3_PRINT_MODE_OPERATOR_CONFIRMATION',
          targetType: 'V3PrintControlPlane',
          targetId: initial.id,
          requestId,
          status: 'SUCCESS',
          message: input.action,
          payloadSnapshot: {
            operatorAdminId: input.operatorAdminId,
            operatorRole: input.operatorRole,
            action: input.action,
            initialMode: initial.mode,
            expectedStateVersion: input.expectedStateVersion,
            requestedTransition: { fromMode: initial.mode, toMode: transition.nextMode },
            confirmedAt: now.toISOString(),
          },
        },
      })

      const result = await transitionV3PrintMode(tx, {
        ...scope,
        expectedStateVersion: initial.stateVersion,
        nextMode: transition.nextMode,
      }, now)
      if (!result.ok) {
        throw new RejectedTransition({
          ok: false,
          code: result.code,
          controlPlane: await readV3ControlPlane(tx, scope),
        })
      }
      return { ok: true, requestId, controlPlane: result.value.controlPlane }
    }, { isolationLevel: 'Serializable' })
  } catch (error) {
    if (error instanceof RejectedTransition) return error.result
    if (errorCode(error) === 'P2034') {
      return {
        ok: false,
        code: 'CONCURRENT_STATE_CHANGE',
        controlPlane: await readV3ControlPlane(targetDb, scope),
      }
    }
    throw error
  }
}

const REVIEW_EVIDENCE = 'REVIEW_EXPIRED_V3_FRONT_EVIDENCE'
const EXPIRE_JOBS = 'EXPIRE_UNEXECUTED_V3_FRONT'
const RECOVERY_REASON = 'EXPIRED_UNEXECUTED_FRONT_RECOVERY'
const RECOVERY_RESULT_CODE = 'V3_OPS_EXPIRED_UNEXECUTED'
const EVIDENCE_MAX_AGE_MS = 5 * 60_000
const CAPTURE_CLOCK_SKEW_MS = 30_000
const ID = /^[a-zA-Z0-9_-]{8,128}$/
const SHA256 = /^[a-f0-9]{64}$/

type QueueRecoveryScope = { tenantId: string; storeId: string }
type QueueRecoveryBase = {
  requestId: string
  expectedStateVersion: number
  jobIds: string[]
  reason: typeof RECOVERY_REASON
}
type EvidenceCapture = {
  captureId: string
  deviceId: string
  ownerEpoch: number
  releasedAt: string
  releasedBatchId: string
  jobs: { id: string; key: string; requestHash: string; updatedAt: string }[]
  capturedAt: string
  deviceObservedAt: string
  historyVerifiedFrom: string
  ledgerSha256: string
  outboxSha256: string
  verifiedNoLocalExecution: true
}
type EvidenceCommand = QueueRecoveryBase & { action: typeof REVIEW_EVIDENCE; capture: EvidenceCapture; installationId: string }
type ExpireCommand = QueueRecoveryBase & { action: typeof EXPIRE_JOBS; evidenceId: string }
type QueueRecoveryCommand = EvidenceCommand | ExpireCommand
type ReviewedJob = {
  id: string
  key: string
  requestHash: string
  updatedAt: string
  receiptCreatedAt: string
  expiresAt: string
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}

function exactKeys(row: Record<string, unknown>, keys: string[]) {
  return Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row, key))
}

function id(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value)
}

function sha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256.test(value)
}

function iso(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value
}

function parseEvidenceCapture(value: unknown): EvidenceCapture | null {
  const row = object(value)
  if (!row || !exactKeys(row, [
    'captureId', 'deviceId', 'ownerEpoch', 'releasedAt', 'releasedBatchId', 'jobs',
    'capturedAt', 'deviceObservedAt', 'historyVerifiedFrom',
    'ledgerSha256', 'outboxSha256', 'verifiedNoLocalExecution',
  ]) || !id(row.captureId) || !id(row.deviceId) || !id(row.releasedBatchId) || !iso(row.releasedAt)
    || typeof row.ownerEpoch !== 'number' || !Number.isSafeInteger(row.ownerEpoch) || row.ownerEpoch < 1
    || !Array.isArray(row.jobs) || row.jobs.length < 1 || row.jobs.length > 3
    || !iso(row.capturedAt) || !iso(row.deviceObservedAt)
    || !iso(row.historyVerifiedFrom) || !sha256(row.ledgerSha256) || !sha256(row.outboxSha256)
    || row.verifiedNoLocalExecution !== true) return null
  const jobs: EvidenceCapture['jobs'] = []
  for (const raw of row.jobs) {
    const job = object(raw)
    if (!job || !exactKeys(job, ['id', 'key', 'requestHash', 'updatedAt']) || !id(job.id)
      || typeof job.key !== 'string' || !/^network:[a-f0-9]{64}$/.test(job.key)
      || !sha256(job.requestHash) || !iso(job.updatedAt)) return null
    jobs.push({ id: job.id, key: job.key, requestHash: job.requestHash, updatedAt: job.updatedAt })
  }
  jobs.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  if (new Set(jobs.map(job => job.id)).size !== jobs.length) return null
  return {
    captureId: row.captureId, deviceId: row.deviceId, ownerEpoch: row.ownerEpoch, releasedAt: row.releasedAt,
    releasedBatchId: row.releasedBatchId, jobs, capturedAt: row.capturedAt, deviceObservedAt: row.deviceObservedAt,
    historyVerifiedFrom: row.historyVerifiedFrom, ledgerSha256: row.ledgerSha256,
    outboxSha256: row.outboxSha256, verifiedNoLocalExecution: true,
  }
}

/** null means this request belongs to the unchanged mode-command parser. */
export function parseOpsV3QueueRecoveryCommand(value: unknown):
  { ok: true; value: QueueRecoveryCommand } | { ok: false; code: 'INVALID_QUEUE_RECOVERY_COMMAND' } | null {
  const row = object(value)
  if (!row || (row.action !== REVIEW_EVIDENCE && row.action !== EXPIRE_JOBS)) return null
  const invalid = { ok: false, code: 'INVALID_QUEUE_RECOVERY_COMMAND' } as const
  if (!exactKeys(row, ['action', 'confirmed', 'requestId', 'expectedStateVersion', 'jobIds', 'reason',
    ...(row.action === REVIEW_EVIDENCE ? ['capture', 'installationId'] : ['evidenceId'])])
    || row.confirmed !== true || !id(row.requestId) || typeof row.expectedStateVersion !== 'number'
    || !Number.isSafeInteger(row.expectedStateVersion) || row.expectedStateVersion < 1
    || !Array.isArray(row.jobIds) || row.jobIds.length < 1 || row.jobIds.length > 3
    || !row.jobIds.every(id) || new Set(row.jobIds).size !== row.jobIds.length
    || row.reason !== RECOVERY_REASON) return invalid
  const base: QueueRecoveryBase = {
    requestId: row.requestId, expectedStateVersion: row.expectedStateVersion,
    jobIds: [...row.jobIds].sort(), reason: RECOVERY_REASON,
  }
  if (row.action === EXPIRE_JOBS) {
    return id(row.evidenceId) ? { ok: true, value: { ...base, action: EXPIRE_JOBS, evidenceId: row.evidenceId } } : invalid
  }
  const capture = parseEvidenceCapture(row.capture)
  return capture && id(row.installationId) && digest(capture.jobs.map(job => job.id)) === digest(base.jobIds)
    ? { ok: true, value: { ...base, action: REVIEW_EVIDENCE, capture, installationId: row.installationId } }
    : invalid
}

function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

class QueueRecoveryRejected extends Error {}

function requireRecovery(condition: unknown, code: string): asserts condition {
  if (!condition) throw new QueueRecoveryRejected(code)
}

function captureFresh(capture: EvidenceCapture, now: Date, registeredAt: Date, releasedAt: Date) {
  const at = Date.parse(capture.capturedAt)
  const deviceAt = Date.parse(capture.deviceObservedAt)
  const received = registeredAt.getTime()
  return at >= releasedAt.getTime() && at <= received && received <= now.getTime()
    && received - at <= CAPTURE_CLOCK_SKEW_MS
    && Math.abs(deviceAt - at) <= CAPTURE_CLOCK_SKEW_MS
    && now.getTime() - at <= EVIDENCE_MAX_AGE_MS
    && now.getTime() - received <= EVIDENCE_MAX_AGE_MS
}

function pendingUnexecutedJob(scope: QueueRecoveryScope, id: string) {
  return {
    ...scope, id, schemaVersion: 3, status: 'PENDING' as const, attemptCount: 0, claimAttempt: 0,
    claimedByComputerBindingId: null, claimTokenHash: null, leaseExpiresAt: null, executingAt: null,
    completedAt: null, resultStatus: null, resultCode: null, resultMessage: null, effectBoundary: null,
    physicalCompletionKnown: false,
  }
}

function matchesPendingJob(job: EshopTrayPrintJob, scope: QueueRecoveryScope) {
  return Object.entries(pendingUnexecutedJob(scope, job.id)).every(
    ([key, expected]) => job[key as keyof EshopTrayPrintJob] === expected,
  )
}

async function reviewQueueRows(
  tx: Prisma.TransactionClient,
  scope: QueueRecoveryScope,
  plane: { id: string; ownerEpoch: number; handoffRequestedAt: Date },
  command: QueueRecoveryBase,
  capture: EvidenceCapture,
  installationIdHash: string,
  now: Date,
): Promise<ReviewedJob[]> {
  requireRecovery(capture.ownerEpoch === plane.ownerEpoch
    && capture.releasedAt === plane.handoffRequestedAt.toISOString(), 'QUEUE_EVIDENCE_FENCE_MISMATCH')
  const device = await tx.desktopDevice.findFirst({
    where: { ...scope, id: capture.deviceId, status: 'ACTIVE', installationIdHash }, select: { id: true },
  })
  requireRecovery(device, 'EVIDENCE_DEVICE_INVALID')
  const rows = await tx.eshopTrayPrintJob.findMany({
    where: { ...scope, id: { in: command.jobIds } }, orderBy: { id: 'asc' },
  })
  requireRecovery(rows.length === command.jobIds.length, 'QUEUE_JOB_SCOPE_MISMATCH')
  const observed = new Map(capture.jobs.map(job => [job.id, job]))
  const jobs: ReviewedJob[] = []
  for (const row of rows) {
    requireRecovery(matchesPendingJob(row, scope), 'QUEUE_JOB_NOT_UNEXECUTED')
    const intent = parseV3PrintIntent(row.payload)
    requireRecovery(intent?.role === 'FRONT' && intent.source === 'LOCAL_DESKTOP'
      && intent.payloadKind === 'RAW_BYTES' && intent.printJobId === row.idempotencyKey,
    'QUEUE_JOB_IDENTITY_INVALID')
    const key = 'network:' + createHash('sha256')
      .update(canonicalV3PrintEffectKey(intent.orderNo, 'FRONT')).digest('hex')
    requireRecovery(key === row.idempotencyKey, 'QUEUE_JOB_IDENTITY_INVALID')
    const evidence = observed.get(row.id)
    requireRecovery(evidence?.key === key && evidence.requestHash === row.requestHash
      && evidence.updatedAt === row.updatedAt.toISOString()
      && Date.parse(evidence.updatedAt) <= Date.parse(capture.capturedAt), 'QUEUE_EVIDENCE_JOB_MISMATCH')

    // The cashier sale response uses the original first SALE row's createdAt.
    // Never accept a client-supplied expiry as the receipt's source of truth.
    const receipt = await tx.saleRecord.findFirst({
      where: { ...scope, orderNo: intent.orderNo, recordNo: intent.orderNo, saleType: 'SALE', status: 'COMPLETED' },
      select: { createdAt: true },
    })
    requireRecovery(receipt && receipt.createdAt <= row.createdAt
      && v3PrintIntentExpiresAt(receipt.createdAt.toISOString()) === row.expiresAt.toISOString(),
    'QUEUE_RECEIPT_TTL_UNPROVEN')
    requireRecovery(row.expiresAt <= now && row.expiresAt.getTime() <= Date.parse(capture.capturedAt)
      && row.expiresAt.getTime() <= Date.parse(capture.deviceObservedAt), 'QUEUE_JOB_NOT_EXPIRED')
    requireRecovery(Date.parse(capture.historyVerifiedFrom) <= receipt.createdAt.getTime(), 'EVIDENCE_HISTORY_INCOMPLETE')
    jobs.push({
      id: row.id, key, requestHash: row.requestHash, updatedAt: row.updatedAt.toISOString(),
      receiptCreatedAt: receipt.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(),
    })
  }

  const releasedBatch = await tx.v3PrintExecutionBatch.findFirst({
    where: {
      ...scope, id: capture.releasedBatchId, controlPlaneId: plane.id, ownerDeviceId: capture.deviceId,
      ownerEpoch: plane.ownerEpoch, revokedAt: plane.handoffRequestedAt,
    },
    select: { id: true },
  })
  requireRecovery(releasedBatch, 'QUEUE_RELEASE_EVIDENCE_MISSING')
  const earliest = Math.min(...jobs.map(job => Date.parse(job.receiptCreatedAt)))
  // A revoked batch may still be cached by an offline previous owner until its original expiry.
  // Local evidence from the current installation cannot clear another device's execution window.
  const otherExecutor = await tx.v3PrintExecutionBatch.findFirst({
    where: {
      ...scope, controlPlaneId: plane.id, ownerDeviceId: { not: capture.deviceId },
      createdAt: { lte: new Date(Date.parse(capture.capturedAt) + CAPTURE_CLOCK_SKEW_MS) },
      expiresAt: { gte: new Date(earliest - CAPTURE_CLOCK_SKEW_MS) },
    },
    select: { id: true },
  })
  requireRecovery(!otherExecutor, 'EVIDENCE_OTHER_EXECUTOR')
  return jobs.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/** Route authentication supplies the actor, while the transaction rechecks both active Ops identities. */
export async function runOpsV3QueueRecovery(
  db: Pick<PrismaClient, '$transaction'>,
  scope: QueueRecoveryScope,
  actor: OpsOperatorIdentity,
  command: QueueRecoveryCommand,
  clock: () => Date = () => new Date(),
): Promise<{ ok: true; requestId: string; evidenceId: string; jobIds: string[] } | { ok: false; code: string }> {
  if (actor.role !== 'OPS_ADMIN') return { ok: false, code: 'QUEUE_RECOVERY_FORBIDDEN' }
  try {
    return await db.$transaction(async tx => {
      const activeOps = (adminId: string) => tx.opsAdmin.findFirst({
        where: { id: adminId, role: 'OPS_ADMIN', status: 'ACTIVE' }, select: { id: true },
      })
      requireRecovery(await activeOps(actor.id), 'QUEUE_RECOVERY_FORBIDDEN')
      const planeIds = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "V3PrintControlPlane"
        WHERE "tenantId" = ${scope.tenantId} AND "storeId" = ${scope.storeId} FOR UPDATE
      `
      requireRecovery(planeIds.length === 1, 'QUEUE_CONTROL_PLANE_UNAVAILABLE')
      const target = { ...scope, targetType: 'V3PrintControlPlane', targetId: planeIds[0].id }
      const commandDigest = digest([actor.id, command])
      const prior = await tx.operationLog.findFirst({
        where: { ...target, requestId: command.requestId, actionType: { in: [REVIEW_EVIDENCE, EXPIRE_JOBS] } },
        select: { id: true, actionType: true, payloadSnapshot: true },
      })
      if (prior) {
        const saved = object(prior.payloadSnapshot)
        requireRecovery(prior.actionType === command.action && saved?.commandDigest === commandDigest, 'QUEUE_REQUEST_CONFLICT')
        return {
          ok: true, requestId: command.requestId,
          evidenceId: command.action === REVIEW_EVIDENCE ? prior.id : command.evidenceId, jobIds: command.jobIds,
        }
      }

      const plane = await tx.v3PrintControlPlane.findUnique({ where: { id: target.targetId } })
      requireRecovery(plane && plane.stateVersion === command.expectedStateVersion, 'CONCURRENT_STATE_CHANGE')
      requireRecovery(plane.mode === 'BLOCKED_UNKNOWN' && !plane.ownerDeviceId && !plane.leaseId
        && !plane.leaseExpiresAt && !plane.handoffQuarantineUntil && plane.handoffRequestedAt && plane.ownerEpoch > 0,
      'QUEUE_FENCE_NOT_RELEASED')
      const releasedAt = plane.handoffRequestedAt
      const now = clock()
      const activeBatch = await tx.v3PrintExecutionBatch.findFirst({
        where: { ...scope, revokedAt: null, expiresAt: { gt: now } }, select: { id: true },
      })
      requireRecovery(!activeBatch, 'ACTIVE_EXECUTION_BATCH')
      const fence = { stateVersion: plane.stateVersion, ownerEpoch: plane.ownerEpoch, releasedAt: releasedAt.toISOString() }
      const auditBase = { ...target, status: 'SUCCESS' as const, requestId: command.requestId, message: command.reason, createdAt: now }

      if (command.action === REVIEW_EVIDENCE) {
        requireRecovery(captureFresh(command.capture, now, now, releasedAt), 'QUEUE_EVIDENCE_STALE')
        const captureKey = digest([
          command.capture.deviceId, command.capture.capturedAt, command.capture.ledgerSha256, command.capture.outboxSha256,
        ])
        const priorCapture = await tx.operationLog.findFirst({
          where: {
            ...target, actionType: REVIEW_EVIDENCE,
            OR: [
              { payloadSnapshot: { path: ['captureKey'], equals: captureKey } },
              { payloadSnapshot: { path: ['capture', 'captureId'], equals: command.capture.captureId } },
            ],
          },
          select: { id: true },
        })
        requireRecovery(!priorCapture, 'QUEUE_EVIDENCE_CAPTURE_REUSED')
        // A real Ops reviewer attests the trusted Windows capture. The server does not
        // read Windows itself. The capture ID prevents re-dating the same collection.
        // Verify the installation from the captured Windows profile without storing its raw ID.
        const installationIdHash = hashInstallationId(command.installationId)
        const jobs = await reviewQueueRows(tx, scope, { ...plane, handoffRequestedAt: releasedAt },
          command, command.capture, installationIdHash, now)
        const evidence = await tx.operationLog.create({
          data: {
            ...auditBase, actionType: REVIEW_EVIDENCE,
            payloadSnapshot: { commandDigest, captureKey, capture: command.capture, installationIdHash, reviewerId: actor.id, fence, jobs, reason: command.reason },
          },
          select: { id: true },
        })
        return { ok: true, requestId: command.requestId, evidenceId: evidence.id, jobIds: command.jobIds }
      }

      const evidence = await tx.operationLog.findFirst({
        where: { ...target, id: command.evidenceId, actionType: REVIEW_EVIDENCE, status: 'SUCCESS' },
        select: { createdAt: true, payloadSnapshot: true },
      })
      const review = object(evidence?.payloadSnapshot)
      const capture = parseEvidenceCapture(review?.capture)
      requireRecovery(evidence && review && capture && id(review.reviewerId) && sha256(review.installationIdHash), 'QUEUE_EVIDENCE_REQUIRED')
      const reviewerId = review.reviewerId
      requireRecovery(reviewerId !== actor.id, 'QUEUE_EVIDENCE_INDEPENDENCE_REQUIRED')
      requireRecovery(await activeOps(reviewerId), 'QUEUE_REVIEWER_NOT_ACTIVE')
      requireRecovery(captureFresh(capture, now, evidence.createdAt, releasedAt), 'QUEUE_EVIDENCE_STALE')
      const reviewedFence = object(review.fence)
      requireRecovery(reviewedFence?.stateVersion === fence.stateVersion && reviewedFence?.ownerEpoch === fence.ownerEpoch
        && reviewedFence?.releasedAt === fence.releasedAt && review.reason === command.reason, 'QUEUE_EVIDENCE_FENCE_MISMATCH')
      const consumed = await tx.operationLog.findFirst({
        where: { ...target, actionType: EXPIRE_JOBS, payloadSnapshot: { path: ['evidenceId'], equals: command.evidenceId } },
        select: { id: true },
      })
      requireRecovery(!consumed, 'QUEUE_EVIDENCE_CONSUMED')
      const jobs = await reviewQueueRows(tx, scope, { ...plane, handoffRequestedAt: releasedAt },
        command, capture, review.installationIdHash, now)
      // PostgreSQL JSONB can reorder object keys. Compare only the fixed, typed projection.
      const reviewed = Array.isArray(review.jobs) ? review.jobs.map(raw => {
        const row = object(raw)
        return row ? [row.id, row.key, row.requestHash, row.updatedAt, row.receiptCreatedAt, row.expiresAt] : null
      }) : null
      const expected = jobs.map(job => [job.id, job.key, job.requestHash, job.updatedAt, job.receiptCreatedAt, job.expiresAt])
      requireRecovery(digest(reviewed) === digest(expected), 'QUEUE_EVIDENCE_JOB_MISMATCH')

      requireRecovery(captureFresh(capture, clock(), evidence.createdAt, releasedAt), 'QUEUE_EVIDENCE_STALE')
      const disposition = {
        status: 'EXPIRED', resultStatus: 'EXPIRED', effectBoundary: 'NOT_CROSSED',
        physicalCompletionKnown: false, resultCode: RECOVERY_RESULT_CODE,
      } as const
      for (const job of jobs) {
        const update = await tx.eshopTrayPrintJob.updateMany({
          where: {
            ...pendingUnexecutedJob(scope, job.id), idempotencyKey: job.key, requestHash: job.requestHash,
            expiresAt: new Date(job.expiresAt), updatedAt: new Date(job.updatedAt),
          },
          data: { ...disposition, completedAt: now },
        })
        requireRecovery(update.count === 1, 'QUEUE_JOB_CONCURRENT_CHANGE')
      }
      // An update may have waited for a competing job-row lock. Recheck before recording success.
      requireRecovery(captureFresh(capture, clock(), evidence.createdAt, releasedAt), 'QUEUE_EVIDENCE_STALE')
      await tx.operationLog.create({
        data: {
          ...auditBase, actionType: EXPIRE_JOBS,
          payloadSnapshot: {
            commandDigest, evidenceId: command.evidenceId, reviewerId, executorId: actor.id,
            reason: command.reason, fence,
            jobs: jobs.map(job => ({
              ...job, before: { status: 'PENDING', attemptCount: 0, claimAttempt: 0, effectBoundary: null },
              after: { ...disposition, completedAt: now.toISOString() },
            })),
          },
        },
      })
      requireRecovery(captureFresh(capture, clock(), evidence.createdAt, releasedAt), 'QUEUE_EVIDENCE_STALE')
      return { ok: true, requestId: command.requestId, evidenceId: command.evidenceId, jobIds: command.jobIds }
    }, { isolationLevel: 'Serializable' })
  } catch (error) {
    if (error instanceof QueueRecoveryRejected) return { ok: false, code: error.message }
    if (errorCode(error) === 'P2034') return { ok: false, code: 'CONCURRENT_STATE_CHANGE' }
    throw error
  }
}
