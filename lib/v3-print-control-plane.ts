import { cleanStartSelector } from './v3-legacy-seven/clean-start'
import type { Prisma } from '@prisma/client'
import { recordPrintOwnerRelease, replacementPreviousOwner, verifiedPrintReplacementTarget } from './v3-print-replacement-target'
import { readPrintExecutionStart, printStartId } from './v3-print-execution-start'
import { createHash, randomUUID } from 'node:crypto'

export const V3_PRINT_MODES = ['V2_ACTIVE', 'V2_DRAINING', 'V3_ACTIVE', 'V3_DRAINING', 'BLOCKED_UNKNOWN'] as const
export type V3PrintMode = typeof V3_PRINT_MODES[number]

export type V3ControlPlaneRecord = {
  id: string
  tenantId: string
  storeId: string
  ownerDeviceId: string | null
  ownerEpoch: number
  leaseId: string | null
  leaseExpiresAt: Date | null
  mode: string
  stateVersion: number
  handoffRequestedAt: Date | null
  handoffQuarantineUntil: Date | null
  lastReconciledAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type V3BatchRecord = {
  id: string
  controlPlaneId: string
  tenantId: string
  storeId: string
  ownerDeviceId: string
  ownerEpoch: number
  stateVersion: number
  leaseId: string
  mode: string
  expiresAt: Date
  revokedAt: Date | null
  createdAt: Date
}

type Tx = {
  $queryRaw?<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>
  v3PrintControlPlane: {
    upsert(args: unknown): Promise<V3ControlPlaneRecord>
    findUnique(args: unknown): Promise<V3ControlPlaneRecord | null>
    updateMany(args: unknown): Promise<{ count: number }>
  }
  v3PrintExecutionBatch: {
    create(args: unknown): Promise<V3BatchRecord>
    findFirst(args: unknown): Promise<V3BatchRecord | null>
    updateMany(args: unknown): Promise<{ count: number }>
  }
  desktopDevice: { findFirst(args: unknown): Promise<{ id: string } | null> }
  operationLog: { create(args: unknown): Promise<{ id: string }> }
  eshopTrayPrintJob: {
    findMany(args: unknown): Promise<any[]>
    findUnique(args: unknown): Promise<any | null>
    updateMany(args: unknown): Promise<{ count: number }>
    create(args: unknown): Promise<any>
  }
}

export type V3ControlPlaneDb = Tx & {
  $transaction<T>(operation: (tx: Tx) => Promise<T>): Promise<T>
}

export type ControlPlaneResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string }

const DEFAULT_LEASE_MS = 2 * 60_000
const MAX_LEASE_MS = 5 * 60_000
const DEFAULT_BATCH_MS = 15 * 60_000
const MAX_BATCH_MS = 60 * 60_000

function validMode(value: string): value is V3PrintMode {
  return (V3_PRINT_MODES as readonly string[]).includes(value)
}

function validDuration(value: number | undefined, fallback: number, max: number): number {
  return Number.isInteger(value) && value! > 0 ? Math.min(value!, max) : fallback
}

function handoffBinding(identity: { tenantId: string; storeId: string; intendedOwnerDeviceId: string; confirmationId: string }): string {
  return `handoff:${createHash('sha256').update([
    identity.tenantId, identity.storeId, identity.intendedOwnerDeviceId, identity.confirmationId,
  ].join('\0')).digest('hex')}`
}

function serializable(record: V3ControlPlaneRecord) {
  if (!validMode(record.mode)) throw new Error('CONTROL_PLANE_CORRUPT_MODE')
  return {
    id: record.id,
    tenantId: record.tenantId,
    storeId: record.storeId,
    ownerDeviceId: record.ownerDeviceId,
    ownerEpoch: record.ownerEpoch,
    leaseId: record.leaseId,
    leaseExpiresAt: record.leaseExpiresAt?.toISOString() ?? null,
    mode: record.mode,
    stateVersion: record.stateVersion,
    handoffRequestedAt: record.handoffRequestedAt?.toISOString() ?? null,
    handoffQuarantineUntil: record.handoffQuarantineUntil?.toISOString() ?? null,
    lastReconciledAt: record.lastReconciledAt?.toISOString() ?? null,
    updatedAt: record.updatedAt.toISOString(),
  }
}

async function ensurePlane(tx: Tx, tenantId: string, storeId: string) {
  return tx.v3PrintControlPlane.upsert({
    where: { storeId },
    create: { tenantId, storeId, mode: 'V2_ACTIVE' },
    update: {},
  })
}

async function readAfter(tx: Tx, storeId: string): Promise<V3ControlPlaneRecord> {
  const record = await tx.v3PrintControlPlane.findUnique({ where: { storeId } })
  if (!record) throw new Error('CONTROL_PLANE_MISSING_AFTER_WRITE')
  return record
}

async function lockControlPlaneRow(tx: Tx, current: V3ControlPlaneRecord): Promise<void> {
  if (!tx.$queryRaw) throw new Error('CONTROL_PLANE_ROW_LOCK_UNAVAILABLE')
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "V3PrintControlPlane"
    WHERE "id" = ${current.id} AND "storeId" = ${current.storeId}
    FOR UPDATE
  `
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.id !== current.id) {
    throw new Error('CONTROL_PLANE_ROW_LOCK_FAILED')
  }
}

export async function readV3ControlPlane(db: V3ControlPlaneDb, identity: { tenantId: string; storeId: string }) {
  return db.$transaction(async (tx) => serializable(await ensurePlane(tx, identity.tenantId, identity.storeId)))
}

export async function acquireV3Authority(
  db: V3ControlPlaneDb,
  identity: { tenantId: string; storeId: string; deviceId: string },
  options: { now?: Date; leaseMs?: number } = {},
): Promise<ControlPlaneResult<{ controlPlane: ReturnType<typeof serializable> }>> {
  const now = options.now ?? new Date()
  const leaseExpiresAt = new Date(now.getTime() + validDuration(options.leaseMs, DEFAULT_LEASE_MS, MAX_LEASE_MS))
  return db.$transaction(async (tx) => {
    const current = await ensurePlane(tx, identity.tenantId, identity.storeId)
    if (current.tenantId !== identity.tenantId || current.storeId !== identity.storeId) return { ok: false, code: 'SCOPE_MISMATCH' }
    if (current.mode !== 'V3_ACTIVE') return { ok: false, code: 'MODE_NOT_V3_ACTIVE' }
    if (current.ownerDeviceId !== null) {
      if (current.ownerDeviceId === identity.deviceId && current.leaseExpiresAt && current.leaseExpiresAt > now) {
        return { ok: true, value: { controlPlane: serializable(current) } }
      }
      return { ok: false, code: current.leaseExpiresAt && current.leaseExpiresAt <= now ? 'OWNER_LIVENESS_AMBIGUOUS' : 'OWNER_ALREADY_ACTIVE' }
    }
    const start = await readPrintExecutionStart(tx as unknown as Prisma.TransactionClient, identity)
    if (start && start.deviceId !== identity.deviceId) return { ok: false, code: 'PRINT_REPLACEMENT_CONFIRMATION_REQUIRED' }
    const result = await tx.v3PrintControlPlane.updateMany({
      where: { id: current.id, tenantId: identity.tenantId, storeId: identity.storeId, stateVersion: current.stateVersion, ownerDeviceId: null, mode: 'V3_ACTIVE' },
      data: {
        ownerDeviceId: identity.deviceId,
        ownerEpoch: { increment: 1 },
        leaseId: randomUUID(),
        leaseExpiresAt,
        stateVersion: { increment: 1 },
        lastReconciledAt: now,
      },
    })
    if (result.count !== 1) return { ok: false, code: 'CONCURRENT_STATE_CHANGE' }
    return { ok: true, value: { controlPlane: serializable(await readAfter(tx, identity.storeId)) } }
  })
}

export async function renewV3Authority(
  db: V3ControlPlaneDb,
  identity: { tenantId: string; storeId: string; deviceId: string; ownerEpoch: number; stateVersion: number; leaseId: string },
  options: { now?: Date; leaseMs?: number } = {},
): Promise<ControlPlaneResult<{ controlPlane: ReturnType<typeof serializable> }>> {
  const now = options.now ?? new Date()
  const leaseExpiresAt = new Date(now.getTime() + validDuration(options.leaseMs, DEFAULT_LEASE_MS, MAX_LEASE_MS))
  return db.$transaction(async (tx) => {
    const result = await tx.v3PrintControlPlane.updateMany({
      where: {
        tenantId: identity.tenantId, storeId: identity.storeId, ownerDeviceId: identity.deviceId,
        ownerEpoch: identity.ownerEpoch, stateVersion: identity.stateVersion, leaseId: identity.leaseId,
        mode: 'V3_ACTIVE', leaseExpiresAt: { gt: now },
      },
      data: { leaseExpiresAt, stateVersion: { increment: 1 }, lastReconciledAt: now },
    })
    if (result.count !== 1) return { ok: false, code: 'AUTHORITY_STALE_OR_EXPIRED' }
    return { ok: true, value: { controlPlane: serializable(await readAfter(tx, identity.storeId)) } }
  })
}

export async function recoverExpiredSelfV3Authority(
  db: V3ControlPlaneDb,
  identity: { tenantId: string; storeId: string; deviceId: string; ownerEpoch: number; stateVersion: number; leaseId: string },
  options: { now?: Date; leaseMs?: number } = {},
): Promise<ControlPlaneResult<{ controlPlane: ReturnType<typeof serializable> }>> {
  const now = options.now ?? new Date()
  const leaseExpiresAt = new Date(now.getTime() + validDuration(options.leaseMs, DEFAULT_LEASE_MS, MAX_LEASE_MS))
  const requestId = randomUUID()
  return db.$transaction(async (tx) => {
    const observed = await ensurePlane(tx, identity.tenantId, identity.storeId)
    await lockControlPlaneRow(tx, observed)
    const current = await readAfter(tx, identity.storeId)
    if (current.tenantId !== identity.tenantId || current.storeId !== identity.storeId) {
      return { ok: false, code: 'SCOPE_MISMATCH' }
    }
    const audit = async (
      actionType: 'RECOVER_EXPIRED_SELF_ATTEMPT' | 'RECOVER_EXPIRED_SELF_SUCCESS' | 'RECOVER_EXPIRED_SELF_REJECTED',
      status: 'SUCCESS' | 'FAILED',
      reason: string,
      next?: V3ControlPlaneRecord,
    ) => {
      await tx.operationLog.create({ data: {
        tenantId: current.tenantId,
        storeId: current.storeId,
        userId: null,
        actionType,
        targetType: 'V3PrintControlPlane',
        targetId: current.id,
        requestId,
        status,
        message: reason,
        payloadSnapshot: {
          ownerDeviceId: identity.deviceId,
          oldLeaseId: identity.leaseId,
          newLeaseId: next?.leaseId ?? null,
          ownerEpoch: identity.ownerEpoch,
          oldStateVersion: identity.stateVersion,
          newStateVersion: next?.stateVersion ?? null,
          reason,
          occurredAt: now.toISOString(),
        },
      } })
    }
    const reject = async (code: string): Promise<ControlPlaneResult<never>> => {
      await audit('RECOVER_EXPIRED_SELF_REJECTED', 'FAILED', code)
      return { ok: false, code }
    }

    await audit('RECOVER_EXPIRED_SELF_ATTEMPT', 'SUCCESS', 'ATTEMPT_RECORDED')
    if (current.mode !== 'V3_ACTIVE') return reject('MODE_NOT_V3_ACTIVE')
    if (current.ownerDeviceId !== identity.deviceId) return reject('RECOVERY_OWNER_MISMATCH')
    if (!current.leaseId || !current.leaseExpiresAt) return reject('RECOVERY_LEASE_MISSING')
    if (current.ownerEpoch !== identity.ownerEpoch || current.stateVersion !== identity.stateVersion ||
      current.leaseId !== identity.leaseId) return reject('RECOVERY_STALE_FENCE')
    if (current.handoffRequestedAt !== null) return reject('RECOVERY_HANDOFF_ACTIVE')
    if (current.handoffQuarantineUntil !== null) return reject('RECOVERY_QUARANTINE_ACTIVE')
    if (current.leaseExpiresAt > now) return reject('RECOVERY_LEASE_NOT_EXPIRED')
    const activeBatch = await tx.v3PrintExecutionBatch.findFirst({
      where: { controlPlaneId: current.id, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { expiresAt: 'desc' },
    })
    if (activeBatch) return reject('RECOVERY_ACTIVE_BATCH')

    const nextLeaseId = randomUUID()
    const result = await tx.v3PrintControlPlane.updateMany({
      where: {
        id: current.id,
        tenantId: identity.tenantId,
        storeId: identity.storeId,
        ownerDeviceId: identity.deviceId,
        ownerEpoch: identity.ownerEpoch,
        stateVersion: identity.stateVersion,
        leaseId: identity.leaseId,
        leaseExpiresAt: { lte: now },
        mode: 'V3_ACTIVE',
        handoffRequestedAt: null,
        handoffQuarantineUntil: null,
      },
      data: {
        leaseId: nextLeaseId,
        leaseExpiresAt,
        stateVersion: { increment: 1 },
        lastReconciledAt: now,
      },
    })
    if (result.count !== 1) return reject('RECOVERY_STALE_FENCE')
    await tx.v3PrintExecutionBatch.updateMany({
      where: { controlPlaneId: current.id, revokedAt: null },
      data: { revokedAt: now },
    })
    const recovered = await readAfter(tx, identity.storeId)
    await audit('RECOVER_EXPIRED_SELF_SUCCESS', 'SUCCESS', 'RECOVERY_SUCCEEDED', recovered)
    return { ok: true, value: { controlPlane: serializable(recovered) } }
  })
}

export async function releaseV3Authority(
  db: V3ControlPlaneDb,
  identity: { tenantId: string; storeId: string; deviceId: string; ownerEpoch: number; stateVersion: number; leaseId: string },
  now = new Date(),
): Promise<ControlPlaneResult<{ controlPlane: ReturnType<typeof serializable> }>> {
  return db.$transaction(async (tx) => {
    const before = await tx.v3PrintControlPlane.findUnique({ where: { storeId: identity.storeId } })
    const result = await tx.v3PrintControlPlane.updateMany({
      where: {
        tenantId: identity.tenantId, storeId: identity.storeId, ownerDeviceId: identity.deviceId,
        ownerEpoch: identity.ownerEpoch, stateVersion: identity.stateVersion, leaseId: identity.leaseId,
      },
      data: { ownerDeviceId: null, leaseId: null, leaseExpiresAt: null, mode: 'BLOCKED_UNKNOWN', stateVersion: { increment: 1 }, handoffRequestedAt: now },
    })
    if (result.count !== 1) return { ok: false, code: 'AUTHORITY_STALE' }
    await tx.v3PrintExecutionBatch.updateMany({
      where: { tenantId: identity.tenantId, storeId: identity.storeId, ownerDeviceId: identity.deviceId, ownerEpoch: identity.ownerEpoch, revokedAt: null },
      data: { revokedAt: now },
    })
    const released = await readAfter(tx, identity.storeId)
    if (before?.mode === 'V3_ACTIVE' && before.stateVersion === identity.stateVersion && before.ownerDeviceId === identity.deviceId) {
      // Revocation fences the server immediately. A disconnected client can still hold a batch until its original expiry.
      const latest = await tx.v3PrintExecutionBatch.findFirst({ where: { controlPlaneId: released.id, expiresAt: { gt: now } },
        orderBy: { expiresAt: 'desc' }, select: { expiresAt: true } })
      await recordPrintOwnerRelease(tx as unknown as Prisma.TransactionClient, released, identity, latest?.expiresAt ?? now)
    }
    return { ok: true, value: { controlPlane: serializable(released) } }
  })
}

export async function issueV3ExecutionBatch(
  db: V3ControlPlaneDb,
  identity: { tenantId: string; storeId: string; deviceId: string; ownerEpoch: number; stateVersion: number; leaseId: string },
  options: { now?: Date; batchMs?: number; printStartVersion?: 1 } = {},
): Promise<ControlPlaneResult<{ batch: Omit<V3BatchRecord, 'expiresAt' | 'createdAt'> & { expiresAt: string; createdAt: string; executionStartAt?: string } }>> {
  const now = options.now ?? new Date()
  return db.$transaction(async (tx) => {
    const observed = await tx.v3PrintControlPlane.findUnique({ where: { storeId: identity.storeId } })
    if (!observed) return { ok: false, code: 'AUTHORITY_STALE_OR_EXPIRED' }
    await lockControlPlaneRow(tx, observed)
    const current = await tx.v3PrintControlPlane.findUnique({ where: { storeId: identity.storeId } })
    if (!current || current.tenantId !== identity.tenantId || current.mode !== 'V3_ACTIVE' ||
      current.ownerDeviceId !== identity.deviceId || current.ownerEpoch !== identity.ownerEpoch ||
      current.stateVersion !== identity.stateVersion || current.leaseId !== identity.leaseId ||
      !current.leaseExpiresAt || current.leaseExpiresAt <= now) {
      return { ok: false, code: 'AUTHORITY_STALE_OR_EXPIRED' }
    }
    const start = await readPrintExecutionStart(tx as unknown as Prisma.TransactionClient, identity)
    if (start && (options.printStartVersion !== 1 || start.deviceId !== identity.deviceId || start.ownerEpoch > current.ownerEpoch)) {
      return { ok: false, code: 'V3_PRINT_START_COMPATIBLE_DEVICE_REQUIRED' }
    }
    const expiresAt = new Date(now.getTime() + validDuration(options.batchMs, DEFAULT_BATCH_MS, MAX_BATCH_MS))
    if (expiresAt <= now) return { ok: false, code: 'BATCH_EXPIRED' }
    const batch = await tx.v3PrintExecutionBatch.create({ data: {
      controlPlaneId: current.id, tenantId: identity.tenantId, storeId: identity.storeId,
      ownerDeviceId: identity.deviceId, ownerEpoch: identity.ownerEpoch, stateVersion: identity.stateVersion,
      leaseId: identity.leaseId, mode: 'V3_ACTIVE', expiresAt,
    } })
    return { ok: true, value: { batch: { ...batch, expiresAt: batch.expiresAt.toISOString(), createdAt: batch.createdAt.toISOString(), ...(start && { executionStartAt: start.startedAt }) } } }
  })
}

const MODE_TRANSITIONS: Record<V3PrintMode, readonly V3PrintMode[]> = {
  V2_ACTIVE: ['V2_DRAINING'],
  V2_DRAINING: ['BLOCKED_UNKNOWN'],
  BLOCKED_UNKNOWN: ['V2_ACTIVE', 'V3_ACTIVE'],
  V3_ACTIVE: ['V3_DRAINING'],
  V3_DRAINING: ['BLOCKED_UNKNOWN'],
}

export async function transitionV3PrintMode(
  db: V3ControlPlaneDb,
  identity: { tenantId: string; storeId: string; expectedStateVersion: number; nextMode: V3PrintMode },
  now = new Date(),
): Promise<ControlPlaneResult<{ controlPlane: ReturnType<typeof serializable> }>> {
  return db.$transaction(async (tx) => {
    const current = await ensurePlane(tx, identity.tenantId, identity.storeId)
    if (!validMode(current.mode) || !MODE_TRANSITIONS[current.mode].includes(identity.nextMode)) return { ok: false, code: 'ILLEGAL_MODE_TRANSITION' }
    if (identity.nextMode === 'V3_DRAINING' || identity.nextMode === 'V2_ACTIVE') {
      const start = await readPrintExecutionStart(tx as unknown as Prisma.TransactionClient, identity)
      if (start) return { ok: false, code: 'V2_FALLBACK_REPLAY_RISK' }
    }
    if ((identity.nextMode === 'V3_ACTIVE' || identity.nextMode === 'V2_ACTIVE') && current.handoffQuarantineUntil !== null) {
      return { ok: false, code: 'HANDOFF_NOT_FINALIZED' }
    }
    if (identity.nextMode === 'V3_ACTIVE' && current.ownerDeviceId !== null &&
      (!current.leaseId || !current.leaseExpiresAt || current.leaseExpiresAt <= now || current.leaseId.startsWith('handoff:'))) {
      return { ok: false, code: 'HANDOFF_NOT_FINALIZED' }
    }
    if (identity.nextMode === 'V2_ACTIVE' && current.ownerDeviceId !== null) return { ok: false, code: 'V3_OWNER_NOT_RELEASED' }
    const result = await tx.v3PrintControlPlane.updateMany({
      where: { id: current.id, tenantId: identity.tenantId, storeId: identity.storeId, stateVersion: identity.expectedStateVersion, mode: current.mode },
      data: { mode: identity.nextMode, stateVersion: { increment: 1 }, handoffRequestedAt: identity.nextMode === 'BLOCKED_UNKNOWN' ? now : null },
    })
    if (result.count !== 1) return { ok: false, code: 'CONCURRENT_STATE_CHANGE' }
    if (identity.nextMode === 'V2_ACTIVE' || identity.nextMode === 'V3_ACTIVE') {
      const { materializeHeldV3PrintIntents } = await import('./v3-print-job-adapter')
      await materializeHeldV3PrintIntents(tx as any, { tenantId: identity.tenantId, storeId: identity.storeId }, identity.nextMode, now)
    }
    return { ok: true, value: { controlPlane: serializable(await readAfter(tx, identity.storeId)) } }
  })
}

type HandoffInput = { tenantId: string; storeId: string; expectedStateVersion: number; actorUserId: string; intendedOwnerDeviceId: string; confirmationId: string;
  replacement?: { phase: 'BEGIN' | 'CONFIRM'; previousDeviceId: string; previousEpoch: number; previousDeviceStopped: true } }
type HandoffResult = ControlPlaneResult<{ controlPlane: ReturnType<typeof serializable> }>

export function controlledV3OwnerHandoff(db: V3ControlPlaneDb, identity: HandoffInput, now = new Date()): Promise<HandoffResult> {
  return db.$transaction<HandoffResult>(async tx => {
    // A standalone phase cannot establish a new source of authority.
    if (identity.replacement) {
      const selector = await cleanStartSelector(tx.operationLog, { ...identity, deviceId: identity.intendedOwnerDeviceId },
        identity.replacement.previousEpoch + 1)
      if (!selector) return { ok: false, code: 'V3_CLEAN_START_UNVERIFIED' }
    }
    return handoffWithinTransaction(tx, identity, now)
  }).catch(replacementFailure)
}

class ReplacementRejected extends Error {}

function replacementFailure(error: unknown): HandoffResult {
  if (error instanceof ReplacementRejected) return { ok: false, code: error.message }
  throw error
}

// Expose one atomic owner confirmation. A live old batch, changed credential or failed audit leaves the old plane intact.
export async function confirmPrintReplacement(db: V3ControlPlaneDb, identity: Omit<HandoffInput, 'replacement'>,
  previous: Omit<NonNullable<HandoffInput['replacement']>, 'phase'>): Promise<HandoffResult> {
  try {
    return await db.$transaction(async tx => {
      const begin = await handoffWithinTransaction(tx, { ...identity, replacement: { ...previous, phase: 'BEGIN' } }, new Date())
      if (!begin.ok) throw new ReplacementRejected(begin.code)
      const result = await handoffWithinTransaction(tx, { ...identity, expectedStateVersion: begin.value.controlPlane.stateVersion,
        replacement: { ...previous, phase: 'CONFIRM' } }, new Date(), true)
      if (!result.ok) throw new ReplacementRejected(result.code)
      return result
    })
  } catch (error) {
    return replacementFailure(error)
  }
}

async function handoffWithinTransaction(tx: Tx, identity: HandoffInput, now: Date, ownerConfirmed = false): Promise<HandoffResult> {
    const observed = await ensurePlane(tx, identity.tenantId, identity.storeId)
    if (identity.replacement) await lockControlPlaneRow(tx, observed)
    const current = identity.replacement ? await readAfter(tx, identity.storeId) : observed
    if (identity.replacement) {
      // Read an absolute instant regardless of the connection or adapter time zone.
      const [clock] = await tx.$queryRaw!<{ ms: bigint }[]>`SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS ms`
      const ms = Number(clock?.ms)
      if (!Number.isSafeInteger(ms) || ms <= 0) throw new Error('HANDOFF_CLOCK_UNAVAILABLE')
      now = new Date(ms)
    }
    const originDb = tx as unknown as Prisma.TransactionClient
    const replacement = identity.replacement
    if (!replacement) {
      const start = await readPrintExecutionStart(originDb, identity)
      if (start && start.deviceId !== identity.intendedOwnerDeviceId) {
        return { ok: false, code: 'PRINT_REPLACEMENT_CONFIRMATION_REQUIRED' }
      }
    }
    const binding = handoffBinding({ ...identity, confirmationId: identity.replacement ? 'replace/' + identity.confirmationId : identity.confirmationId })
    const previousOwnerDeviceId = replacement?.previousDeviceId ?? current.ownerDeviceId
    let releaseId: string | null = null
    const previousOwnerEpoch = current.ownerEpoch
    if (replacement) {
      // Serialize a concurrent credential rotation/revocation with publication of the new epoch.
      const locked = await originDb.$queryRaw<{ id: string }[]>`SELECT "id" FROM "DesktopDevice"
        WHERE "id" = ${identity.intendedOwnerDeviceId} AND "tenantId" = ${identity.tenantId} AND "storeId" = ${identity.storeId} FOR SHARE`
      if (locked.length !== 1) return { ok: false, code: 'HANDOFF_INTENDED_OWNER_INVALID' }
    }
    const intendedOwner = await tx.desktopDevice.findFirst({ where: {
      id: identity.intendedOwnerDeviceId, tenantId: identity.tenantId, storeId: identity.storeId, status: 'ACTIVE',
      ...(replacement && { activeSlot: 'ACTIVE', tokenExpiresAt: { gt: now } }),
    }, select: { id: true } })
    if (!intendedOwner) return { ok: false, code: 'HANDOFF_INTENDED_OWNER_INVALID' }
    let readyUntil: Date | null = null
    if (replacement) {
      if (replacement.previousDeviceStopped !== true) return { ok: false, code: 'HANDOFF_OLD_DEVICE_STOP_REQUIRED' }
      if (current.stateVersion !== identity.expectedStateVersion || current.ownerEpoch !== replacement.previousEpoch ||
          current.tenantId !== identity.tenantId || replacement.previousDeviceId === intendedOwner.id) {
        return { ok: false, code: 'CONCURRENT_STATE_CHANGE' }
      }
      readyUntil = await verifiedPrintReplacementTarget(originDb, identity, intendedOwner.id, identity.confirmationId, replacement, now, true)
      if (!readyUntil) return { ok: false, code: 'HANDOFF_TARGET_NOT_READY' }
      const priorStart = await readPrintExecutionStart(originDb, identity)
      if (priorStart && (priorStart.ownerEpoch > current.ownerEpoch || priorStart.startedAt >= now.toISOString())) {
        return { ok: false, code: 'V3_PRINT_EXECUTION_START_CONFLICT' }
      }
      if (replacement.phase === 'BEGIN') {
        const previous = await replacementPreviousOwner(originDb, identity, current)
        if (!previous || previous.previousDeviceId !== replacement.previousDeviceId) return { ok: false, code: 'REPLACEMENT_NOT_AVAILABLE' }
        if (previous.batchesValidUntil && previous.batchesValidUntil > now) return { ok: false, code: 'HANDOFF_QUARANTINE_ACTIVE' }
        releaseId = previous.releaseId
      } else {
        if (current.mode !== 'BLOCKED_UNKNOWN' || current.ownerDeviceId !== intendedOwner.id) return { ok: false, code: 'REPLACEMENT_NOT_AVAILABLE' }
        const begin = await originDb.operationLog.findFirst({ where: { tenantId: identity.tenantId, storeId: identity.storeId,
          targetId: current.id, targetType: 'V3PrintControlPlane', requestId: identity.confirmationId,
          actionType: 'V3_PRINT_CONTROLLED_HANDOFF', message: 'QUARANTINE_STARTED', status: 'SUCCESS', userId: identity.actorUserId },
          select: { payloadSnapshot: true } })
        const fact = begin?.payloadSnapshot as Record<string, unknown> | null
        if (fact?.replacement !== true || fact.previousDeviceStopped !== true || fact.previousOwnerDeviceId !== replacement.previousDeviceId ||
            fact.intendedOwnerDeviceId !== intendedOwner.id || fact.ownerEpoch !== current.ownerEpoch ||
            fact.stateVersion !== current.stateVersion) return { ok: false, code: 'REPLACEMENT_CONFIRMATION_MISMATCH' }
        releaseId = typeof fact.releaseReceiptId === 'string' ? fact.releaseReceiptId : null
      }
    }
    const audit = async (action: 'QUARANTINE_STARTED' | 'HANDOFF_CONFIRMED', previousOwnerDeviceId: string | null, ownerEpoch: number, stateVersion: number) => {
      await tx.operationLog.create({ data: {
        ...(replacement && action === 'HANDOFF_CONFIRMED' && { id: printStartId(identity, ownerEpoch) }),
        tenantId: identity.tenantId,
        storeId: identity.storeId,
        userId: identity.actorUserId,
        actionType: 'V3_PRINT_CONTROLLED_HANDOFF',
        targetType: 'V3PrintControlPlane',
        targetId: current.id,
        requestId: identity.confirmationId,
        status: 'SUCCESS',
        message: action,
        payloadSnapshot: {
          action,
          confirmationId: identity.confirmationId,
          previousOwnerDeviceId,
          intendedOwnerDeviceId: intendedOwner.id,
          ownerEpoch,
          stateVersion,
          occurredAt: now.toISOString(),
          ...(replacement && { replacement: true, previousDeviceStopped: true }),
          ...(ownerConfirmed && action === 'HANDOFF_CONFIRMED' && { authority: 'STORE_OWNER_REPLACEMENT_V1' }),
          ...(releaseId && { releaseReceiptId: releaseId }),
        },
      } })
    }
    if (current.mode !== 'BLOCKED_UNKNOWN' || replacement?.phase === 'BEGIN') {
      const latest = await tx.v3PrintExecutionBatch.findFirst({
        where: { controlPlaneId: current.id, revokedAt: null, expiresAt: { gt: now } }, orderBy: { expiresAt: 'desc' },
      })
      const quarantineUntil = latest?.expiresAt ?? now
      if (readyUntil && quarantineUntil >= readyUntil) return { ok: false, code: 'HANDOFF_QUARANTINE_ACTIVE' }
      const result = await tx.v3PrintControlPlane.updateMany({
        where: { id: current.id, tenantId: identity.tenantId, storeId: identity.storeId, stateVersion: identity.expectedStateVersion },
        data: {
          ownerDeviceId: intendedOwner.id,
          leaseId: binding,
          leaseExpiresAt: quarantineUntil,
          mode: 'BLOCKED_UNKNOWN',
          stateVersion: { increment: 1 },
          handoffRequestedAt: now,
          handoffQuarantineUntil: quarantineUntil,
        },
      })
      if (result.count !== 1) return { ok: false, code: 'CONCURRENT_STATE_CHANGE' }
      await audit('QUARANTINE_STARTED', previousOwnerDeviceId, previousOwnerEpoch, current.stateVersion + 1)
      return { ok: true, value: { controlPlane: serializable(await readAfter(tx, identity.storeId)) } }
    }
    if (!current.handoffQuarantineUntil || current.handoffQuarantineUntil > now) return { ok: false, code: 'HANDOFF_QUARANTINE_ACTIVE' }
    if (replacement) {
      const active = await tx.v3PrintExecutionBatch.findFirst({ where: { controlPlaneId: current.id, revokedAt: null, expiresAt: { gt: now } } })
      if (active) return { ok: false, code: 'HANDOFF_QUARANTINE_ACTIVE' }
      const v2Work = await originDb.eshopTrayPrintJob.count({ where: { tenantId: identity.tenantId, storeId: identity.storeId,
        schemaVersion: { in: [1, 2] }, OR: [{ status: { in: ['PENDING', 'CLAIMED', 'EXECUTING'] } }, { effectBoundary: 'CROSSING_UNKNOWN' }] } })
      if (v2Work) return { ok: false, code: 'V2_DRAIN_NOT_COMPLETE' }
      const liveClaims = await originDb.eshopTrayPrintJob.count({ where: { tenantId: identity.tenantId, storeId: identity.storeId,
        schemaVersion: 3, completedAt: null, ...(releaseId || ownerConfirmed ? {} : { leaseExpiresAt: { gt: now } }),
        OR: [{ claimTokenHash: { not: null } }, { status: { in: ['CLAIMED', 'EXECUTING'] } },
          ...(ownerConfirmed ? [{ effectBoundary: 'CROSSING_UNKNOWN' as const }] : [])] } })
      if (liveClaims) return { ok: false, code: 'V3_EXECUTION_IN_PROGRESS' }
    }
    const result = await tx.v3PrintControlPlane.updateMany({
      where: {
        id: current.id, tenantId: identity.tenantId, storeId: identity.storeId,
        stateVersion: identity.expectedStateVersion, mode: 'BLOCKED_UNKNOWN',
        ownerDeviceId: intendedOwner.id, leaseId: binding, leaseExpiresAt: current.handoffQuarantineUntil,
      },
      data: {
        leaseId: randomUUID(), leaseExpiresAt: new Date(now.getTime() + DEFAULT_LEASE_MS), ownerEpoch: { increment: 1 },
        stateVersion: { increment: 1 }, handoffQuarantineUntil: null,
        ...(replacement && { mode: 'V3_ACTIVE', handoffRequestedAt: null }),
      },
    })
    if (result.count !== 1) return { ok: false, code: 'CONCURRENT_STATE_CHANGE' }
    await tx.v3PrintExecutionBatch.updateMany({ where: { controlPlaneId: current.id, revokedAt: null }, data: { revokedAt: now } })
    await audit('HANDOFF_CONFIRMED', replacement?.previousDeviceId ?? null, previousOwnerEpoch + 1, current.stateVersion + 1)
    const controlPlane = serializable(await readAfter(tx, identity.storeId))
    if (ownerConfirmed) {
      // Validate the newly persisted evidence under the fence before either phase can commit.
      const selector = await cleanStartSelector(tx.operationLog, { ...identity, deviceId: intendedOwner.id }, controlPlane.ownerEpoch)
      if (!selector) throw new ReplacementRejected('V3_CLEAN_START_UNVERIFIED')
    }
    if (readyUntil) {
      const [clock] = await tx.$queryRaw!<{ ms: bigint }[]>`SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS ms`
      if (!clock || clock.ms >= BigInt(readyUntil.getTime())) throw new ReplacementRejected('HANDOFF_TARGET_NOT_READY')
    }
    return { ok: true, value: { controlPlane } }
}
