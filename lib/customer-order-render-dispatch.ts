import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  CUSTOMER_ORDER_SOURCE, CUSTOMER_ORDER_MAX_RENDER_ATTEMPTS, clearCustomerOrderRenderLease,
  lockCustomerOrder, nextCustomerOrderAttemptAt, processCustomerOrderFulfillmentIntent,
  customerOrderIntentBusinessValid, supersedeCustomerOrderUnpaidIntent,
  type FulfillmentDb,
} from './customer-order-fulfillment'
import {
  customerOrderSnapshot, customerOrderRendererReleased, validateCustomerOrderRaster,
  type RendererRelease, type SealedCustomerOrderBytes,
} from './customer-order-fulfillment-renderer'

export const H5_RENDER_PROTOCOL = 1
export const H5_RENDER_LEASE_MS = 60_000
export const H5_RENDER_CLAIM_LIMIT = 20
export const H5_RENDER_MAX_BODY = 4 * 1024 * 1024 + 8192
const states = ['PENDING', 'RENDER_PENDING', 'FAILED_RETRYABLE']
const digest = (s: string) => createHash('sha256').update(s).digest('hex')
const hex = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s)
const safeId = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(s)
export type RenderWorker = { workerId: string; credentialSha256: string; tenantId: string; storeId: string; roles: Array<'KITCHEN' | 'FRONT'>; profileId: string }
export type RenderRuntime = RendererRelease & { now?: () => Date }
export type RenderResult = { kind: string; [key: string]: any }

/** Exactly one configured owner. This is not the production renderer allowlist. */
export function configuredRenderWorker(raw = process.env.H5_RENDER_WORKER_CONFIG): RenderWorker | null {
  if (!raw || raw.length > 2048) return null
  try {
    const v = JSON.parse(raw)
    if (!v || Array.isArray(v) || Object.keys(v).sort().join(',') !== 'credentialSha256,profileId,roles,storeId,tenantId,workerId'
      || ![v.workerId, v.tenantId, v.storeId].every(safeId) || !hex(v.credentialSha256) || !hex(v.profileId)
      || !Array.isArray(v.roles) || !v.roles.length || v.roles.length > 2 || new Set(v.roles).size !== v.roles.length
      || v.roles.some((r: unknown) => r !== 'KITCHEN' && r !== 'FRONT')) return null
    return v
  } catch { return null }
}

export function authenticateRenderWorker(header: string | null, worker: RenderWorker | null): RenderWorker | null {
  if (!worker || !header || !/^Bearer [A-Za-z0-9_-]{43,128}$/.test(header)) return null
  return timingSafeEqual(Buffer.from(digest(header.slice(7)), 'hex'), Buffer.from(worker.credentialSha256, 'hex')) ? worker : null
}

export function renderOwnerLockKey(workerId: string): number {
  return createHash('sha256').update(`h5-render-owner:v1:${workerId}`).digest().readInt32BE(0)
}
function scope(w: RenderWorker) { return { tenantId: w.tenantId, storeId: w.storeId, source: CUSTOMER_ORDER_SOURCE, role: { in: w.roles } } }
function owned(i: any, w: RenderWorker): boolean {
  return Boolean(i && i.tenantId === w.tenantId && i.storeId === w.storeId && i.source === CUSTOMER_ORDER_SOURCE && w.roles.includes(i.role))
}
function fence(i: any) {
  return { id: i.id, tenantId: i.tenantId, storeId: i.storeId, source: CUSTOMER_ORDER_SOURCE, role: i.role,
    revision: i.revision, state: { in: states }, printJobId: null }
}
function nowAt(runtime: RenderRuntime) { return runtime.now ? runtime.now() : new Date() }
function validBusiness(order: any, i: any): boolean {
  return customerOrderIntentBusinessValid(order, i)
}
async function expire(tx: any, i: any, now: Date) {
  const changed = await tx.customerOrderFulfillmentIntent.updateMany({ where: fence(i), data: {
    ...clearCustomerOrderRenderLease, state: 'EXPIRED', lastErrorCode: 'CUSTOMER_ORDER_FULFILLMENT_DEADLINE_EXPIRED',
    lastErrorAt: now, lastRecoverySweepAt: now, revision: { increment: 1 },
  } })
  return { kind: changed.count === 1 ? 'EXPIRED' : 'STALE' }
}
async function defer(tx: any, i: any, now: Date, code: string, terminal = false, renderFailure = false) {
  const exhausted = (i.renderAttemptCount ?? 0) >= CUSTOMER_ORDER_MAX_RENDER_ATTEMPTS
  const changed = await tx.customerOrderFulfillmentIntent.updateMany({ where: fence(i), data: {
    ...clearCustomerOrderRenderLease,
    state: terminal || exhausted ? 'MANUAL_REVIEW' : renderFailure ? 'FAILED_RETRYABLE' : 'RENDER_PENDING',
    nextAttemptAt: nextCustomerOrderAttemptAt(renderFailure ? i.renderAttemptCount : 1, now, i.deadlineAt),
    lastErrorCode: code, lastErrorAt: now, lastRecoverySweepAt: now,
    ...(terminal || exhausted ? { manualReviewReason: code } : {}), revision: { increment: 1 },
  } })
  if (changed.count !== 1) return { kind: 'STALE' }
  return { kind: terminal || exhausted ? 'MANUAL_REVIEW' : 'WAITING', code }
}

/** One short transaction per candidate: owner -> order -> Intent, never browser I/O. */
export async function claimCustomerOrderRender(db: FulfillmentDb, w: RenderWorker, runtime: RenderRuntime = {}): Promise<RenderResult> {
  if (!db.$transaction || !db.$queryRaw) throw new Error('H5_RENDER_TRANSACTION_REQUIRED')
  const now = nowAt(runtime)
  const page = await db.customerOrderFulfillmentIntent.findMany({ where: {
    ...scope(w), decision: 'REQUIRED', state: { in: states }, printJobId: null,
    OR: [{ nextAttemptAt: { lte: now } }, { deadlineAt: { lte: now } }],
  }, orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }], take: H5_RENDER_CLAIM_LIMIT })
  let processed = 0
  for (const candidate of page) {
    let result: RenderResult
    try {
      result = await db.$transaction(async (tx) => {
        const ownerLock = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(1211454001::int, ${renderOwnerLockKey(w.workerId)}::int) AS acquired`
        if (!ownerLock[0]?.acquired) return { kind: 'BUSY' }
        const clock = nowAt(runtime)
        const rows = await tx.$queryRaw`SELECT "id" FROM "CustomerOrder"
          WHERE "tenantId" = ${w.tenantId} AND "storeId" = ${w.storeId} AND "orderNo" = ${candidate.orderNo}
          FOR UPDATE SKIP LOCKED`
        if (!rows.length) return { kind: 'SKIPPED' }
        const i = await tx.customerOrderFulfillmentIntent.findUnique({ where: { id: candidate.id } })
        if (!owned(i, w) || i.decision !== 'REQUIRED' || i.printJobId || !states.includes(i.state)) return { kind: 'SKIPPED' }
        if (i.deadlineAt <= clock) return expire(tx, i, clock)
        if (i.sealedAt) return { kind: 'SEALED', intentId: i.id }
        if (i.renderLeaseExpiresAt && i.renderLeaseExpiresAt > clock) return { kind: 'BUSY' }
        if (i.renderLeaseExpiresAt) return defer(tx, i, clock, 'CUSTOMER_ORDER_RENDER_LEASE_EXPIRED', false, true)
        if (i.nextAttemptAt > clock) return { kind: 'SKIPPED' }
        const active = await tx.customerOrderFulfillmentIntent.findFirst({ where: {
          renderLeaseOwnerId: w.workerId, renderLeaseExpiresAt: { gt: clock }, state: { in: states }, printJobId: null,
        }, select: { id: true } })
        if (active) return { kind: 'BUSY' }
        const order = await tx.customerOrder.findFirst({ where: { tenantId: w.tenantId, storeId: w.storeId, orderNo: i.orderNo } })
        if (i.purpose === 'FRONT_UNPAID' && order?.paymentStatus === 'PAID') {
          const result = await supersedeCustomerOrderUnpaidIntent(tx, i, clock)
          return { kind: result.status, printJobId: result.printJobId, code: result.error }
        }
        if (!validBusiness(order, i)) return defer(tx, i, clock, 'CUSTOMER_ORDER_STATE_CHANGED_BEFORE_RENDER', true)
        try { customerOrderSnapshot(i) } catch { return defer(tx, i, clock, 'CUSTOMER_ORDER_RENDER_SNAPSHOT_INVALID', true) }
        if (i.renderProfileId && i.renderProfileId !== w.profileId) return defer(tx, i, clock, 'CUSTOMER_ORDER_RENDER_PROFILE_CONFLICT', true)
        if (!customerOrderRendererReleased(w.profileId, runtime)) return defer(tx, i, clock, 'CUSTOMER_ORDER_RENDERER_NOT_RELEASED')
        const cp = await tx.v3PrintControlPlane.findUnique({ where: { storeId: w.storeId }, select: { tenantId: true, mode: true } })
        if (!cp || cp.tenantId !== w.tenantId || cp.mode !== 'V3_ACTIVE') return defer(tx, i, clock, 'CUSTOMER_ORDER_V3_NOT_ACTIVE')
        if (i.renderAttemptCount >= CUSTOMER_ORDER_MAX_RENDER_ATTEMPTS) return defer(tx, i, clock, 'CUSTOMER_ORDER_RENDER_ATTEMPTS_EXHAUSTED', true)
        if (i.deadlineAt.getTime() - clock.getTime() < 30_000) {
          const changed = await tx.customerOrderFulfillmentIntent.updateMany({ where: fence(i), data: {
            nextAttemptAt: i.deadlineAt, lastErrorCode: 'CUSTOMER_ORDER_RENDER_DEADLINE_TOO_CLOSE',
            lastErrorAt: clock, lastRecoverySweepAt: clock, revision: { increment: 1 },
          } })
          return changed.count === 1 ? { kind: 'WAITING', code: 'CUSTOMER_ORDER_RENDER_DEADLINE_TOO_CLOSE' } : { kind: 'STALE' }
        }
        const token = randomBytes(32).toString('hex')
        const expiresAt = new Date(Math.min(clock.getTime() + H5_RENDER_LEASE_MS, i.deadlineAt.getTime()))
        const changed = await tx.customerOrderFulfillmentIntent.updateMany({ where: { ...fence(i), sealedAt: null, renderLeaseTokenHash: null }, data: {
          renderProfileId: w.profileId, renderLeaseOwnerId: w.workerId, renderLeaseTokenHash: digest(token), renderLeaseExpiresAt: expiresAt,
          renderAttemptCount: { increment: 1 }, nextAttemptAt: expiresAt, state: 'RENDER_PENDING', lastErrorCode: null,
          lastRecoverySweepAt: clock, revision: { increment: 1 },
        } })
        if (changed.count !== 1) return { kind: 'SKIPPED' }
        return { kind: 'CLAIMED', claim: { intentId: i.id, tenantId: i.tenantId, storeId: i.storeId, orderNo: i.orderNo, role: i.role,
          snapshotJson: i.snapshotJson, snapshotHash: i.snapshotHash, schemaVersion: i.schemaVersion, profileId: w.profileId,
          deadlineAt: i.deadlineAt.toISOString(), leaseExpiresAt: expiresAt.toISOString(), revision: i.revision + 1, token } }
      })
      if (result.kind === 'SEALED') {
        // Independent T3: a crash here is recovered from the same sealed row.
        const printed = await processCustomerOrderFulfillmentIntent(db, result.intentId, nowAt(runtime), runtime)
        result = { kind: 'JOB', printStatus: printed.status }
      }
    } catch (error) {
      // A failed row cannot monopolize a writable queue. CAS never overwrites
      // another consumer, a result seal, cancellation, or an active lease.
      const clock = nowAt(runtime)
      await db.customerOrderFulfillmentIntent.updateMany({ where: { ...fence(candidate), renderLeaseTokenHash: null, nextAttemptAt: { lte: clock } }, data: {
        state: candidate.deadlineAt <= clock ? 'EXPIRED' : 'FAILED_RETRYABLE',
        nextAttemptAt: nextCustomerOrderAttemptAt(1, clock, candidate.deadlineAt),
        lastErrorCode: 'CUSTOMER_ORDER_RENDER_DISPATCH_FAILED', lastErrorAt: clock, revision: { increment: 1 },
      } })
      // Unknown database faults remain operational errors, not claimed success.
      throw error
    }
    processed += 1
    if (result.kind === 'CLAIMED' || result.kind === 'BUSY') return { ...result, processed }
  }
  return { kind: 'IDLE', processed }
}

export type RenderReply = {
  intentId: string; tenantId: string; storeId: string; orderNo: string; role: 'KITCHEN' | 'FRONT';
  snapshotHash: string; schemaVersion: number; profileId: string; revision: number; token: string;
}
function validReply(r: RenderReply): boolean {
  return Boolean(r && typeof r === 'object') && [r.intentId, r.tenantId, r.storeId, r.orderNo].every(safeId) && ['KITCHEN', 'FRONT'].includes(r.role)
    && hex(r.snapshotHash) && hex(r.profileId) && hex(r.token) && r.schemaVersion === 3 && Number.isSafeInteger(r.revision)
}
function sameIdentity(i: any, r: RenderReply): boolean {
  return i.tenantId === r.tenantId && i.storeId === r.storeId && i.orderNo === r.orderNo && i.role === r.role
    && i.snapshotHash === r.snapshotHash && i.schemaVersion === r.schemaVersion && i.renderProfileId === r.profileId
}
function leaseMatches(i: any, w: RenderWorker, r: RenderReply, now: Date): boolean {
  return i.renderLeaseOwnerId === w.workerId && i.renderLeaseTokenHash === digest(r.token)
    && i.renderLeaseExpiresAt > now && i.revision === r.revision
}

export async function sealCustomerOrderRender(db: FulfillmentDb, w: RenderWorker, r: RenderReply & SealedCustomerOrderBytes, runtime: RenderRuntime = {}): Promise<RenderResult> {
  if (!validReply(r) || r.rendererVersion !== r.profileId) return { kind: 'INVALID' }
  try { validateCustomerOrderRaster(r) } catch { return { kind: 'INVALID_BYTES' } }
  return db.$transaction!(async (tx) => {
    const first = await tx.customerOrderFulfillmentIntent.findUnique({ where: { id: r.intentId } })
    if (!owned(first, w)) return { kind: 'NOT_FOUND' }
    await lockCustomerOrder(tx, first)
    const i = await tx.customerOrderFulfillmentIntent.findUnique({ where: { id: r.intentId } })
    const now = nowAt(runtime)
    if (!owned(i, w)) return { kind: 'NOT_FOUND' }
    if (['CANCELLED', 'EXPIRED', 'MANUAL_REVIEW', 'NOT_REQUIRED'].includes(i.state) || i.decision !== 'REQUIRED') return { kind: 'TERMINAL' }
    if (i.deadlineAt <= now && !i.printJobId) return expire(tx, i, now)
    const identity = sameIdentity(i, r) && r.profileId === w.profileId
    if (i.sealedAt) {
      if (identity && i.payloadHash === r.payloadHash && i.payloadBase64 === r.payloadBase64 && i.byteLength === r.byteLength && i.rendererVersion === r.rendererVersion) return { kind: 'ALREADY_SEALED', printJobId: i.printJobId }
      const changed = await tx.customerOrderFulfillmentIntent.updateMany({ where: { id: i.id, revision: i.revision }, data: {
        ...(i.printJobId ? {} : { state: 'MANUAL_REVIEW' }), ...clearCustomerOrderRenderLease,
        manualReviewReason: 'CUSTOMER_ORDER_RENDER_RESULT_CONFLICT', lastErrorCode: 'CUSTOMER_ORDER_RENDER_RESULT_CONFLICT', lastErrorAt: now, revision: { increment: 1 },
      } })
      return { kind: changed.count === 1 ? 'CONFLICT' : 'STALE' }
    }
    if (!leaseMatches(i, w, r, now)) return { kind: 'STALE' }
    if (!identity) {
      const result = await defer(tx, i, now, 'CUSTOMER_ORDER_RENDER_IDENTITY_CONFLICT', true)
      return result.kind === 'STALE' ? result : { ...result, kind: 'CONFLICT' }
    }
    if (!customerOrderRendererReleased(i.renderProfileId, runtime)) {
      const result = await defer(tx, i, now, 'CUSTOMER_ORDER_RENDERER_NOT_RELEASED')
      return result.kind === 'STALE' ? result : { ...result, kind: 'NOT_RELEASED' }
    }
    const order = await tx.customerOrder.findFirst({ where: { tenantId: i.tenantId, storeId: i.storeId, orderNo: i.orderNo } })
    if (i.purpose === 'FRONT_UNPAID' && order?.paymentStatus === 'PAID') {
      const result = await supersedeCustomerOrderUnpaidIntent(tx, i, now)
      return { kind: result.status, printJobId: result.printJobId, code: result.error }
    }
    if (!validBusiness(order, i)) return defer(tx, i, now, 'CUSTOMER_ORDER_STATE_CHANGED_BEFORE_SEAL', true)
    try { customerOrderSnapshot(i) } catch { return defer(tx, i, now, 'CUSTOMER_ORDER_RENDER_SNAPSHOT_INVALID', true) }
    const changed = await tx.customerOrderFulfillmentIntent.updateMany({ where: {
      ...fence(i), sealedAt: null, renderLeaseOwnerId: w.workerId, renderLeaseTokenHash: digest(r.token), renderLeaseExpiresAt: { gt: now },
    }, data: { ...clearCustomerOrderRenderLease, payloadBase64: r.payloadBase64, payloadHash: r.payloadHash, byteLength: r.byteLength,
      rendererVersion: i.renderProfileId, sealedAt: now, state: 'PENDING', nextAttemptAt: now,
      lastErrorCode: null, lastErrorAt: null, revision: { increment: 1 },
    } })
    return { kind: changed.count === 1 ? 'SEALED' : 'STALE' }
  })
}

export async function failCustomerOrderRender(db: FulfillmentDb, w: RenderWorker, r: RenderReply & { code: string }, runtime: RenderRuntime = {}): Promise<RenderResult> {
  if (!validReply(r) || !['RENDER_FAILED', 'RENDER_TIMEOUT', 'RENDER_RESOURCE_LIMIT', 'RENDER_UNAVAILABLE', 'RENDER_SELF_CHECK_FAILED'].includes(r.code)) return { kind: 'INVALID' }
  return db.$transaction!(async (tx) => {
    const first = await tx.customerOrderFulfillmentIntent.findUnique({ where: { id: r.intentId } })
    if (!owned(first, w)) return { kind: 'NOT_FOUND' }
    await lockCustomerOrder(tx, first)
    const i = await tx.customerOrderFulfillmentIntent.findUnique({ where: { id: r.intentId } })
    const now = nowAt(runtime)
    if (!owned(i, w) || !states.includes(i.state) || i.printJobId || i.sealedAt) return { kind: 'STALE' }
    if (i.deadlineAt <= now) return expire(tx, i, now)
    if (!sameIdentity(i, r) || !leaseMatches(i, w, r, now)) return { kind: 'STALE' }
    // Reservation already consumed exactly once; failure never increments it.
    return defer(tx, i, now, r.code, false, true)
  })
}

/** In-process abuse bound is additional, not a cross-instance global limit. */
const requestTimes = new Map<string, number[]>()
export function renderRequestAllowed(workerId: string, now = Date.now()): boolean {
  if (!requestTimes.has(workerId) && requestTimes.size >= 16) return false
  const recent = (requestTimes.get(workerId) ?? []).filter((t) => t > now - 60_000)
  if (recent.length >= 240) return false
  recent.push(now); requestTimes.set(workerId, recent); return true
}
