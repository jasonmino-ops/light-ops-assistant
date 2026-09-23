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

export async function releaseV3Authority(
  db: V3ControlPlaneDb,
  identity: { tenantId: string; storeId: string; deviceId: string; ownerEpoch: number; stateVersion: number; leaseId: string },
  now = new Date(),
): Promise<ControlPlaneResult<{ controlPlane: ReturnType<typeof serializable> }>> {
  return db.$transaction(async (tx) => {
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
    return { ok: true, value: { controlPlane: serializable(await readAfter(tx, identity.storeId)) } }
  })
}

export async function issueV3ExecutionBatch(
  db: V3ControlPlaneDb,
  identity: { tenantId: string; storeId: string; deviceId: string; ownerEpoch: number; stateVersion: number; leaseId: string },
  options: { now?: Date; batchMs?: number } = {},
): Promise<ControlPlaneResult<{ batch: Omit<V3BatchRecord, 'expiresAt' | 'createdAt'> & { expiresAt: string; createdAt: string } }>> {
  const now = options.now ?? new Date()
  return db.$transaction(async (tx) => {
    const current = await tx.v3PrintControlPlane.findUnique({ where: { storeId: identity.storeId } })
    if (!current || current.tenantId !== identity.tenantId || current.mode !== 'V3_ACTIVE' ||
      current.ownerDeviceId !== identity.deviceId || current.ownerEpoch !== identity.ownerEpoch ||
      current.stateVersion !== identity.stateVersion || current.leaseId !== identity.leaseId ||
      !current.leaseExpiresAt || current.leaseExpiresAt <= now) {
      return { ok: false, code: 'AUTHORITY_STALE_OR_EXPIRED' }
    }
    const expiresAt = new Date(now.getTime() + validDuration(options.batchMs, DEFAULT_BATCH_MS, MAX_BATCH_MS))
    if (expiresAt <= now) return { ok: false, code: 'BATCH_EXPIRED' }
    const batch = await tx.v3PrintExecutionBatch.create({ data: {
      controlPlaneId: current.id, tenantId: identity.tenantId, storeId: identity.storeId,
      ownerDeviceId: identity.deviceId, ownerEpoch: identity.ownerEpoch, stateVersion: identity.stateVersion,
      leaseId: identity.leaseId, mode: 'V3_ACTIVE', expiresAt,
    } })
    return { ok: true, value: { batch: { ...batch, expiresAt: batch.expiresAt.toISOString(), createdAt: batch.createdAt.toISOString() } } }
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

export async function controlledV3OwnerHandoff(
  db: V3ControlPlaneDb,
  identity: { tenantId: string; storeId: string; expectedStateVersion: number; actorUserId: string; intendedOwnerDeviceId: string; confirmationId: string },
  now = new Date(),
): Promise<ControlPlaneResult<{ controlPlane: ReturnType<typeof serializable> }>> {
  return db.$transaction(async (tx) => {
    const current = await ensurePlane(tx, identity.tenantId, identity.storeId)
    const binding = handoffBinding(identity)
    const previousOwnerDeviceId = current.ownerDeviceId
    const previousOwnerEpoch = current.ownerEpoch
    const intendedOwner = await tx.desktopDevice.findFirst({ where: {
      id: identity.intendedOwnerDeviceId, tenantId: identity.tenantId, storeId: identity.storeId, status: 'ACTIVE',
    }, select: { id: true } })
    if (!intendedOwner) return { ok: false, code: 'HANDOFF_INTENDED_OWNER_INVALID' }
    const audit = async (action: 'QUARANTINE_STARTED' | 'HANDOFF_CONFIRMED', previousOwnerDeviceId: string | null, ownerEpoch: number, stateVersion: number) => {
      await tx.operationLog.create({ data: {
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
        },
      } })
    }
    if (current.mode !== 'BLOCKED_UNKNOWN') {
      const latest = await tx.v3PrintExecutionBatch.findFirst({
        where: { controlPlaneId: current.id, revokedAt: null, expiresAt: { gt: now } }, orderBy: { expiresAt: 'desc' },
      })
      const quarantineUntil = latest?.expiresAt ?? now
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
    const result = await tx.v3PrintControlPlane.updateMany({
      where: {
        id: current.id, tenantId: identity.tenantId, storeId: identity.storeId,
        stateVersion: identity.expectedStateVersion, mode: 'BLOCKED_UNKNOWN',
        ownerDeviceId: intendedOwner.id, leaseId: binding, leaseExpiresAt: current.handoffQuarantineUntil,
      },
      data: {
        leaseId: randomUUID(), leaseExpiresAt: new Date(now.getTime() + DEFAULT_LEASE_MS), ownerEpoch: { increment: 1 },
        stateVersion: { increment: 1 }, handoffQuarantineUntil: null,
      },
    })
    if (result.count !== 1) return { ok: false, code: 'CONCURRENT_STATE_CHANGE' }
    await tx.v3PrintExecutionBatch.updateMany({ where: { controlPlaneId: current.id, revokedAt: null }, data: { revokedAt: now } })
    await audit('HANDOFF_CONFIRMED', null, previousOwnerEpoch + 1, current.stateVersion + 1)
    return { ok: true, value: { controlPlane: serializable(await readAfter(tx, identity.storeId)) } }
  })
}
