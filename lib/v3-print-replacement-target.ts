import { createHash } from 'node:crypto'
import { printStartId, readPrintExecutionStart } from './v3-print-execution-start'
import type { V3ControlPlaneRecord } from './v3-print-control-plane'
import type { Prisma } from '@prisma/client'

const actionType = 'V3_PRINT_REPLACEMENT_TARGET_READY'
const targetType = 'DesktopDevice'
const validityMs = 30 * 60_000
type Scope = { tenantId: string; storeId: string }
type Device = Scope & { deviceId: string; tokenVersion: number }
type Ready = { previousDeviceId: string; previousEpoch: number; tokenVersion: number; childId: string; childVersion: number; childActivatedAt: string }
type Tx = Pick<Prisma.TransactionClient, 'operationLog' | 'v3PrintControlPlane' | 'desktopDevice' | 'computerBinding' | '$queryRaw'>

const releasedAction = 'V3_PRINT_OWNER_FENCED_RELEASE'

function releaseReceiptId(plane: V3ControlPlaneRecord) {
  return 'v3-print-release:' + createHash('sha256').update(JSON.stringify([
    plane.tenantId, plane.storeId, plane.id, plane.ownerEpoch, plane.stateVersion,
  ])).digest('hex')
}

// The caller has matched the old device, epoch, version and lease in the same transaction.
export function recordPrintOwnerRelease(tx: Pick<Tx, 'operationLog'>, plane: V3ControlPlaneRecord,
  previous: { deviceId: string; stateVersion: number; leaseId: string }, validUntil: Date) {
  return tx.operationLog.create({ data: { id: releaseReceiptId(plane), tenantId: plane.tenantId, storeId: plane.storeId,
    actionType: releasedAction, targetType: 'V3PrintControlPlane', targetId: plane.id, status: 'SUCCESS', message: 'RELEASED',
    payloadSnapshot: { previousDeviceId: previous.deviceId, ownerEpoch: plane.ownerEpoch, previousStateVersion: previous.stateVersion,
      stateVersion: plane.stateVersion, previousLeaseSha256: createHash('sha256').update(previous.leaseId).digest('hex'),
      releasedAt: plane.handoffRequestedAt!.toISOString(), batchesValidUntil: validUntil.toISOString() } } })
}

export async function replacementPreviousOwner(tx: Pick<Tx, 'operationLog'>, scope: Scope, plane: V3ControlPlaneRecord | null) {
  if (!plane || plane.tenantId !== scope.tenantId || plane.storeId !== scope.storeId) return null
  if (plane.mode === 'V3_ACTIVE' && plane.ownerDeviceId) {
    return { previousDeviceId: plane.ownerDeviceId, previousEpoch: plane.ownerEpoch, releaseId: null, batchesValidUntil: null }
  }
  if (plane.mode !== 'BLOCKED_UNKNOWN' || plane.ownerDeviceId !== null || plane.leaseId !== null ||
      plane.leaseExpiresAt !== null || !plane.handoffRequestedAt) return null
  const releaseId = releaseReceiptId(plane)
  const row = await tx.operationLog.findFirst({ where: { tenantId: scope.tenantId, storeId: scope.storeId, id: releaseId, actionType: releasedAction,
    targetType: 'V3PrintControlPlane', targetId: plane.id, status: 'SUCCESS', message: 'RELEASED' }, select: { payloadSnapshot: true } })
  const fact = row?.payloadSnapshot as Record<string, unknown> | null
  if (!fact || typeof fact.previousDeviceId !== 'string' || !fact.previousDeviceId ||
      fact.ownerEpoch !== plane.ownerEpoch || fact.stateVersion !== plane.stateVersion ||
      fact.previousStateVersion !== plane.stateVersion - 1 || typeof fact.previousLeaseSha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(fact.previousLeaseSha256) || fact.releasedAt !== plane.handoffRequestedAt.toISOString() ||
      typeof fact.batchesValidUntil !== 'string') return null
  const until = new Date(fact.batchesValidUntil)
  if (!Number.isFinite(until.getTime()) || until.toISOString() !== fact.batchesValidUntil || until < plane.handoffRequestedAt) return null
  return { previousDeviceId: fact.previousDeviceId, previousEpoch: plane.ownerEpoch, releaseId, batchesValidUntil: until }
}

// Reuse the managed Add-on's existing binding, active slot and credential lifetime.
function activePrintChild(tx: Tx, scope: Scope, deviceId: string, now: Date) {
  return tx.computerBinding.findFirst({ where: { tenantId: scope.tenantId, storeId: scope.storeId,
    parentDesktopDeviceId: deviceId, identityKind: 'DESKTOP_PRINT_CHILD', childActiveSlot: 'ACTIVE',
    status: 'APPROVED', boundAt: { not: null }, disabledAt: null, credentialStatus: 'ACTIVE',
    credentialActivatedAt: { not: null }, credentialExpiresAt: { gt: now } },
    select: { id: true, deviceSecretVersion: true, credentialActivatedAt: true, credentialExpiresAt: true } })
}

// Called exclusively by the normal device-authenticated protocol. The target is never taken from JSON.
export async function preparePrintReplacementTarget(tx: Tx, device: Device) {
  const scope = { tenantId: device.tenantId, storeId: device.storeId }
  const plane = await tx.v3PrintControlPlane.findUnique({ where: { storeId: scope.storeId } })
  const previous = await replacementPreviousOwner(tx, scope, plane as V3ControlPlaneRecord | null)
  if (!previous || previous.previousDeviceId === device.deviceId) return null
  const child = await activePrintChild(tx, scope, device.deviceId, new Date())
  if (!child?.credentialActivatedAt) return null
  const event = await tx.operationLog.create({ data: { ...scope, status: 'SUCCESS', actionType, targetType,
    targetId: device.deviceId, payloadSnapshot: { previousDeviceId: previous.previousDeviceId, previousEpoch: previous.previousEpoch,
      tokenVersion: device.tokenVersion, childId: child.id, childVersion: child.deviceSecretVersion,
      childActivatedAt: child.credentialActivatedAt.toISOString(), printStartVersion: 1 } }, select: { id: true, createdAt: true } })
  return { confirmationId: event.id, deviceId: device.deviceId, previousDeviceId: previous.previousDeviceId,
    previousEpoch: previous.previousEpoch, expiresAt: new Date(event.createdAt.getTime() + validityMs).toISOString() }
}

// Only display requests for this store's current owner and epoch. Confirmation revalidates the selected receipt under lock.
export async function listPrintReplacementTargets(tx: Tx, scope: Scope, now = new Date()) {
  const plane = await tx.v3PrintControlPlane.findUnique({ where: { storeId: scope.storeId } })
  const previousOwner = await replacementPreviousOwner(tx, scope, plane as V3ControlPlaneRecord | null)
  if (!plane || !previousOwner) return []
  const previous = { previousDeviceId: previousOwner.previousDeviceId, previousEpoch: previousOwner.previousEpoch }
  const receipts = await tx.operationLog.findMany({ where: { ...scope, actionType, targetType, status: 'SUCCESS',
    createdAt: { gt: new Date(now.getTime() - validityMs), lte: now } }, take: 32, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, targetId: true } })
  const targets = []
  const seen = new Set<string>()
  for (const receipt of receipts) {
    if (!receipt.targetId || seen.has(receipt.targetId) || receipt.targetId === previous.previousDeviceId) continue
    if (!await verifiedPrintReplacementTarget(tx, scope, receipt.targetId, receipt.id, previous, now)) continue
    seen.add(receipt.targetId)
    targets.push({ ...previous, deviceId: receipt.targetId, confirmationId: receipt.id, expectedStateVersion: plane.stateVersion })
  }
  return targets
}

// Both stages call this under the existing control-plane row lock. Polling, renewing and rebooting never create this record.
export async function verifiedPrintReplacementTarget(tx: Tx, scope: Scope, deviceId: string, confirmationId: string,
  previous: Pick<Ready, 'previousDeviceId' | 'previousEpoch'>, now: Date, lockChild = false) {
  const receipt = await tx.operationLog.findFirst({ where: { tenantId: scope.tenantId, storeId: scope.storeId,
    id: confirmationId, actionType, targetType, targetId: deviceId, status: 'SUCCESS' }, select: { createdAt: true, payloadSnapshot: true } })
  if (!receipt || receipt.createdAt > now || now.getTime() - receipt.createdAt.getTime() >= validityMs) return null
  const fact = receipt.payloadSnapshot as (Ready & { printStartVersion: number }) | null
  if (!fact || fact.printStartVersion !== 1 || fact.previousEpoch !== previous.previousEpoch ||
      fact.previousDeviceId !== previous.previousDeviceId || !Number.isSafeInteger(fact.tokenVersion)) return null
  if (typeof fact.childId !== 'string' || !fact.childId || !Number.isSafeInteger(fact.childVersion) || fact.childVersion < 1) return null
  if (lockChild) {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "ComputerBinding"
      WHERE id = ${fact.childId} AND "tenantId" = ${scope.tenantId} AND "storeId" = ${scope.storeId}
      AND "parentDesktopDeviceId" = ${deviceId} FOR SHARE`
    if (locked.length !== 1) return null
    const [clock] = await tx.$queryRaw<{ ms: bigint }[]>`SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS ms`
    now = new Date(Number(clock.ms))
  }
  const child = await activePrintChild(tx, scope, deviceId, now)
  if (!child?.credentialExpiresAt || child.id !== fact.childId || child.deviceSecretVersion !== fact.childVersion ||
      child.credentialActivatedAt?.toISOString() !== fact.childActivatedAt) return null
  const active = await tx.desktopDevice.findFirst({ where: { id: deviceId, tenantId: scope.tenantId, storeId: scope.storeId,
    status: 'ACTIVE', activeSlot: 'ACTIVE', tokenVersion: fact.tokenVersion, tokenExpiresAt: { gt: now } }, select: { tokenExpiresAt: true } })
  if (!active?.tokenExpiresAt) return null
  const until = Math.min(receipt.createdAt.getTime() + validityMs, active.tokenExpiresAt.getTime(), child.credentialExpiresAt.getTime())
  return until > now.getTime() ? new Date(until) : null
}


// Verify the target request, quarantine and store-owner confirmation as a single historical chain.
// The receipt must have been current at confirmation. Reading it later must not renew its lifetime.
export async function confirmedReplacementCutoff(log: Tx['operationLog'], identity: Scope & { deviceId: string }, epoch: number) {
  const start = await readPrintExecutionStart({ operationLog: log }, identity)
  if (!start || start.deviceId !== identity.deviceId || start.ownerEpoch > epoch) return null
  const scope = { tenantId: identity.tenantId, storeId: identity.storeId }
  const event = await log.findUnique({ where: { id: printStartId(scope, start.ownerEpoch) },
    select: { userId: true, requestId: true, targetId: true, payloadSnapshot: true } })
  const fact = event?.payloadSnapshot as Record<string, unknown> | null
  if (!event?.userId || !event.requestId || !event.targetId || !fact || fact.authority !== 'STORE_OWNER_REPLACEMENT_V1' ||
      fact.action !== 'HANDOFF_CONFIRMED' || fact.confirmationId !== event.requestId || fact.previousDeviceStopped !== true ||
      typeof fact.previousOwnerDeviceId !== 'string' || !fact.previousOwnerDeviceId || fact.previousOwnerDeviceId === start.deviceId ||
      typeof fact.stateVersion !== 'number' || !Number.isSafeInteger(fact.stateVersion)) return null
  const ready = await log.findFirst({ where: { ...scope, id: event.requestId, actionType, targetType,
    targetId: start.deviceId, status: 'SUCCESS' }, select: { createdAt: true, payloadSnapshot: true } })
  const request = ready?.payloadSnapshot as (Ready & { printStartVersion: number }) | null
  const cutoff = new Date(start.startedAt)
  if (!ready || !request || request.printStartVersion !== 1 || request.previousDeviceId !== fact.previousOwnerDeviceId ||
      request.previousEpoch !== start.ownerEpoch - 1 || !Number.isSafeInteger(request.tokenVersion) ||
      typeof request.childId !== 'string' || !request.childId || !Number.isSafeInteger(request.childVersion) || request.childVersion < 1 ||
      typeof request.childActivatedAt !== 'string' || !Number.isFinite(Date.parse(request.childActivatedAt)) ||
      Date.parse(request.childActivatedAt) > ready.createdAt.getTime() ||
      ready.createdAt > cutoff || cutoff.getTime() - ready.createdAt.getTime() >= validityMs) return null
  const events = await log.findMany({ where: { ...scope, requestId: event.requestId, userId: event.userId,
    actionType: 'V3_PRINT_CONTROLLED_HANDOFF', targetType: 'V3PrintControlPlane', targetId: event.targetId,
    message: 'QUARANTINE_STARTED', status: 'SUCCESS' }, select: { payloadSnapshot: true }, take: 2 })
  const begin = events[0]?.payloadSnapshot as Record<string, unknown> | null
  if (events.length !== 1 || !begin || begin.action !== 'QUARANTINE_STARTED' || begin.confirmationId !== event.requestId ||
      begin.replacement !== true || begin.previousDeviceStopped !== true || begin.previousOwnerDeviceId !== request.previousDeviceId ||
      begin.intendedOwnerDeviceId !== start.deviceId || begin.ownerEpoch !== request.previousEpoch ||
      begin.stateVersion !== fact.stateVersion - 1 || typeof begin.occurredAt !== 'string' ||
      !Number.isFinite(Date.parse(begin.occurredAt)) || Date.parse(begin.occurredAt) < ready.createdAt.getTime() ||
      Date.parse(begin.occurredAt) > cutoff.getTime()) return null
  return cutoff
}
