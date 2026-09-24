import { randomUUID } from 'node:crypto'
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
