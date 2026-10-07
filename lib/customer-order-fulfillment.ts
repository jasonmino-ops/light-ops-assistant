import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { cancelPendingV3PrintIntent, cancelUnclaimedV3PrintReprints, enqueueV3PrintIntent, isV3PrintIntentIdempotencyConflict, parseV3PrintIntent } from './v3-print-job-adapter'
import {
  ALLOWED_CUSTOMER_ORDER_RENDERER_VERSIONS,
  buildCustomerOrderPrintIntent,
  customerOrderPrintOrder,
  customerOrderPrintJobId,
  kitchenItems,
  customerOrderKitchenDisposition,
  CUSTOMER_ORDER_RENDERER_VERSION,
  customerOrderEnvelopeFromSeal,
  customerOrderRendererReleased,
  customerOrderSnapshot,
  type CustomerOrderPrintOrder,
  type CustomerOrderPrintRole,
} from './customer-order-fulfillment-renderer'

export {
  ALLOWED_CUSTOMER_ORDER_RENDERER_VERSIONS,
  buildCustomerOrderPrintIntent,
  customerOrderPrintOrder,
  customerOrderPrintJobId,
  kitchenItems,
  customerOrderKitchenDisposition,
  CUSTOMER_ORDER_RENDERER_VERSION,
}
export type { CustomerOrderPrintOrder, CustomerOrderPrintRole } from './customer-order-fulfillment-renderer'

export const CUSTOMER_ORDER_FRONT_PRINT_TTL_MS = 24 * 60 * 60 * 1000
export const CUSTOMER_ORDER_KITCHEN_PRINT_TTL_MS = 30 * 60 * 1000
export const CUSTOMER_ORDER_PRINT_TTL_MS = CUSTOMER_ORDER_FRONT_PRINT_TTL_MS
export const CUSTOMER_ORDER_FRONT_MAX_ATTEMPTS = 12
export const CUSTOMER_ORDER_KITCHEN_MAX_ATTEMPTS = 12
export const CUSTOMER_ORDER_ACTOR_TYPE = 'H5_CUSTOMER_ORDER'
export const CUSTOMER_ORDER_SOURCE = 'H5_HOME'
export const CUSTOMER_ORDER_CANCELLED_BEFORE_CLAIM = 'CUSTOMER_ORDER_CANCELLED_BEFORE_CLAIM'

export type FulfillmentDb = {
  customerOrderFulfillmentIntent?: any
  customerOrder?: any
  paymentIntent?: any
  v3PrintControlPlane?: any
  eshopTrayPrintJob?: any
  store?: any
  $transaction?: (fn: (tx: any) => Promise<any>, options?: any) => Promise<any>
  $queryRaw?: any
}

export type CustomerOrderPrintStatus =
  | 'QUEUED' | 'ALREADY_PRESENT' | 'NOT_READY' | 'FAILED'
  | 'RECONCILIATION_REQUIRED' | 'MANUAL_REVIEW' | 'EXPIRED' | 'NOT_REQUIRED'
  | 'NOT_APPLICABLE' | 'PROCESSING'

export type CustomerOrderPrintResult = {
  status: CustomerOrderPrintStatus
  created: boolean
  printJobId: string | null
  error?: string
}

export type CustomerOrderFulfillmentDecision = 'REQUIRED' | 'NOT_REQUIRED' | 'MANUAL_REVIEW'
export type CustomerOrderFulfillmentState =
  | 'PENDING' | 'RENDER_PENDING' | 'ENQUEUED' | 'FAILED_RETRYABLE'
  | 'CANCELLED' | 'EXPIRED' | 'MANUAL_REVIEW' | 'NOT_REQUIRED'
type IntentRole = 'KITCHEN' | 'FRONT'
export type CustomerOrderFulfillmentRuntimeOptions = {
  /** Internal injection only; HTTP callers cannot supply a release decision. */
  testProfileId?: string
}

export type CustomerOrderJobEvidence =
  | 'QUEUED' | 'NOT_READY' | 'RETRYING' | 'RESULT_UNKNOWN' | 'EXECUTION_REPORTED'
  | 'FAILED' | 'NOT_REQUIRED' | 'REVIEW_REQUIRED' | 'EXPIRED' | 'NOT_APPLICABLE' | 'PROCESSING'

export function customerOrderJobEvidence(job: {
  status: string
  resultStatus: string | null
  claimTokenHash: string | null
  expiresAt: Date
  completedAt: Date | null
  effectBoundary: string | null
} | null, now = new Date()): CustomerOrderJobEvidence {
  if (!job) return 'REVIEW_REQUIRED'
  if (job.status === 'SUCCEEDED' && job.resultStatus === 'CROSSED' && job.effectBoundary === 'CROSSED' && job.completedAt) return 'EXECUTION_REPORTED'
  if (job.status === 'FAILED' && job.resultStatus === 'FAILED_NOT_CROSSED' && job.effectBoundary === 'NOT_CROSSED' && job.completedAt) return 'FAILED'
  if (job.status === 'FAILED' && (job.resultStatus === 'CROSSING_UNKNOWN' || job.effectBoundary === 'CROSSING_UNKNOWN')) return 'RESULT_UNKNOWN'
  if (job.expiresAt <= now && !job.completedAt) return job.claimTokenHash ? 'RESULT_UNKNOWN' : 'EXPIRED'
  if (job.completedAt) return 'RESULT_UNKNOWN'
  return 'QUEUED'
}

function errorCode(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'CUSTOMER_ORDER_PRINT_FAILED'
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function intentModel(db: FulfillmentDb): any {
  if (!db.customerOrderFulfillmentIntent) throw new Error('CUSTOMER_ORDER_FULFILLMENT_INTENT_MODEL_UNAVAILABLE')
  return db.customerOrderFulfillmentIntent
}

function snapshotOf(order: CustomerOrderPrintOrder): { json: string; hash: string } {
  const json = JSON.stringify({
    tenantId: order.tenantId, storeId: order.storeId, orderNo: order.orderNo,
    storeName: order.storeName, currencyCode: order.currencyCode,
    createdAt: order.createdAt.toISOString(), paidAt: order.paidAt?.toISOString() ?? null,
    tableNo: order.tableNo, remark: order.remark, totalAmount: order.totalAmount,
    paymentStatus: order.paymentStatus, paymentMethod: order.paymentMethod, items: order.items,
  })
  return { json, hash: hash(json) }
}

function orderFromSnapshot(value: string): CustomerOrderPrintOrder {
  const parsed = JSON.parse(value) as CustomerOrderPrintOrder & { createdAt: string; paidAt: string | null }
  return { ...parsed, createdAt: new Date(parsed.createdAt), paidAt: parsed.paidAt ? new Date(parsed.paidAt) : null }
}

function roleState(decision: CustomerOrderFulfillmentDecision): CustomerOrderFulfillmentState {
  if (decision === 'NOT_REQUIRED') return 'NOT_REQUIRED'
  if (decision === 'MANUAL_REVIEW') return 'MANUAL_REVIEW'
  return 'RENDER_PENDING'
}

function deadlineFor(role: IntentRole, eventAt: Date): Date {
  return new Date(eventAt.getTime() + (role === 'KITCHEN' ? CUSTOMER_ORDER_KITCHEN_PRINT_TTL_MS : CUSTOMER_ORDER_FRONT_PRINT_TTL_MS))
}

export function paymentIntentMethod(paymentMethod: 'CASH' | 'QR'): 'CASH' | 'KHQR' {
  return paymentMethod === 'QR' ? 'KHQR' : 'CASH'
}

export function customerOrderPaymentIntentData(input: {
  tenantId: string; storeId: string; operatorUserId: string; orderNo: string; orderId: string
  amount: string; paymentMethod: 'CASH' | 'QR'; paidAt: Date
}) {
  return {
    tenantId: input.tenantId, storeId: input.storeId, operatorUserId: input.operatorUserId,
    transactionActorType: CUSTOMER_ORDER_ACTOR_TYPE, transactionActorId: input.orderId,
    authorizedByUserId: input.operatorUserId, orderNo: input.orderNo,
    paymentMethod: paymentIntentMethod(input.paymentMethod), status: 'PAID' as const,
    amount: input.amount, khqrPayload: null, provider: null, merchantConfigId: null, paidAt: input.paidAt,
  }
}

export function nextCustomerOrderBackoff(attemptCount: number): number {
  return Math.min(30 * 60 * 1000, 60 * 1000 * (2 ** Math.max(0, attemptCount - 1)))
}

export function nextCustomerOrderAttemptAt(attemptCount: number, now: Date, deadlineAt: Date): Date {
  const candidate = new Date(now.getTime() + nextCustomerOrderBackoff(attemptCount))
  return candidate < deadlineAt ? candidate : deadlineAt
}

export function printOrderFromCustomerOrder(input: {
  tenantId: string; storeId: string; orderNo: string; storeName: string; currencyCode: string
  createdAt: Date; paidAt: Date | null; tableNo: string | null; remark: string | null
  totalAmount: { toNumber(): number } | number; paymentStatus: string; paymentMethod: string | null; itemsJson: string
}) {
  return customerOrderPrintOrder(input)
}

export function intentCreateData(input: {
  order: CustomerOrderPrintOrder; role: IntentRole; decision: CustomerOrderFulfillmentDecision
  now: Date; paymentIntentId?: string | null
}) {
  const snapshot = snapshotOf(input.order)
  const eventAt = input.role === 'FRONT' ? input.order.paidAt : input.now
  if (!eventAt) throw new Error('CUSTOMER_ORDER_FULFILLMENT_EVENT_TIME_REQUIRED')
  return {
    tenantId: input.order.tenantId, storeId: input.order.storeId, orderNo: input.order.orderNo,
    role: input.role, source: CUSTOMER_ORDER_SOURCE, schemaVersion: 3,
    decision: input.decision, state: roleState(input.decision), snapshotJson: snapshot.json, snapshotHash: snapshot.hash,
    idempotencyKey: customerOrderPrintJobId(input.order, input.role), paymentIntentId: input.paymentIntentId ?? null,
    paymentEventAt: input.role === 'FRONT' ? input.order.paidAt : null,
    confirmedAt: input.role === 'KITCHEN' ? input.now : null, paidAt: input.role === 'FRONT' ? input.order.paidAt : null,
    deadlineAt: deadlineFor(input.role, eventAt), nextAttemptAt: input.now,
    maxAttempts: input.role === 'FRONT' ? CUSTOMER_ORDER_FRONT_MAX_ATTEMPTS : CUSTOMER_ORDER_KITCHEN_MAX_ATTEMPTS,
    attemptCount: 0, revision: 0,
  }
}

export async function createCustomerOrderFulfillmentIntent(tx: FulfillmentDb, input: Parameters<typeof intentCreateData>[0]) {
  return intentModel(tx).create({ data: intentCreateData(input) })
}

export const clearCustomerOrderRenderLease = { renderLeaseOwnerId: null, renderLeaseTokenHash: null, renderLeaseExpiresAt: null }
export const CUSTOMER_ORDER_MAX_RENDER_ATTEMPTS = 3

function failureData(intent: any, now: Date, code: string, state: CustomerOrderFulfillmentState = 'FAILED_RETRYABLE') {
  return {
    state, lastErrorCode: code, lastErrorAt: now,
    nextAttemptAt: nextCustomerOrderAttemptAt(Math.max(1, intent.attemptCount), now, intent.deadlineAt),
    revision: { increment: 1 },
  }
}

export async function lockCustomerOrder(tx: FulfillmentDb, scope: { tenantId: string; storeId: string; orderNo: string }) {
  if (tx.$queryRaw) {
    await tx.$queryRaw`
      SELECT "id" FROM "CustomerOrder"
      WHERE "tenantId" = ${scope.tenantId} AND "storeId" = ${scope.storeId} AND "orderNo" = ${scope.orderNo}
      FOR UPDATE
    `
  }
}

function existingJobMatchesIntent(job: any, intent: any, expected: ReturnType<typeof buildCustomerOrderPrintIntent>): boolean {
  const parsed = parseV3PrintIntent(job.payload)
  if (!parsed || parsed.payloadKind !== 'RAW_BYTES') return false
  return Boolean(
    intent.source === CUSTOMER_ORDER_SOURCE
      && expected.printJobId === intent.idempotencyKey && expected.orderNo === intent.orderNo
      && job.tenantId === intent.tenantId && job.storeId === intent.storeId
      && job.idempotencyKey === intent.idempotencyKey
      && job.schemaVersion === expected.schemaVersion && intent.schemaVersion === expected.schemaVersion
      && parsed.schemaVersion === expected.schemaVersion
      && parsed.printJobId === intent.idempotencyKey
      && parsed.source === 'CLOUD_H5'
      && parsed.orderNo === intent.orderNo
      && parsed.role === intent.role
      && parsed.payloadBase64 === intent.payloadBase64
      && parsed.byteLength === intent.byteLength
      && parsed.payloadHash === intent.payloadHash
      && parsed.rendererVersion === intent.rendererVersion
      // V3 hashes the producer's envelope, not PostgreSQL jsonb's key order.
      // Rebuild through that same H5 producer; do not change the V3 hash contract.
      && job.requestHash === hash(JSON.stringify(expected)),
  )
}

const pendingJobStates = ['PENDING', 'RENDER_PENDING', 'FAILED_RETRYABLE']

async function recordRolledBackCreation(db: FulfillmentDb, attempted: any, error: unknown): Promise<CustomerOrderPrintResult> {
  // The failed SQL transaction is already rolled back. Accounting must use a
  // fresh short transaction, with the same order -> Intent lock/CAS discipline.
  return db.$transaction!(async (tx) => {
    await lockCustomerOrder(tx, attempted)
    const model = intentModel(tx)
    const current = await model.findUnique({ where: { id: attempted.id } })
    if (current?.printJobId) return { status: 'ALREADY_PRESENT', created: false, printJobId: current.printJobId }
    if (!current || current.revision !== attempted.revision || current.attemptCount !== attempted.attemptCount
      || !pendingJobStates.includes(current.state)) {
      return { status: 'NOT_READY', created: false, printJobId: null, error: 'CUSTOMER_ORDER_PRINT_STATE_CHANGED' }
    }
    const now = new Date()
    const count = attempted.attemptCount + (isV3PrintIntentIdempotencyConflict(error) ? 0 : 1)
    const expired = current.deadlineAt <= now
    const exhausted = count >= current.maxAttempts
    const state = expired ? 'EXPIRED' : exhausted ? 'MANUAL_REVIEW' : 'FAILED_RETRYABLE'
    const updated = await model.updateMany({ where: {
      id: attempted.id, tenantId: attempted.tenantId, storeId: attempted.storeId, orderNo: attempted.orderNo,
      role: attempted.role, source: CUSTOMER_ORDER_SOURCE, state: { in: pendingJobStates },
      revision: attempted.revision, attemptCount: attempted.attemptCount, printJobId: null,
    }, data: {
      ...failureData({ ...current, attemptCount: count }, now, errorCode(error), state),
      attemptCount: count,
      ...(exhausted && !expired ? { manualReviewReason: 'CUSTOMER_ORDER_PRINT_ATTEMPTS_EXHAUSTED' } : {}),
    } })
    if (updated.count !== 1) return { status: 'NOT_READY', created: false, printJobId: null, error: 'CUSTOMER_ORDER_PRINT_STATE_CHANGED' }
    return { status: expired ? 'EXPIRED' : exhausted ? 'MANUAL_REVIEW' : 'FAILED', created: false, printJobId: null,
      error: expired ? 'CUSTOMER_ORDER_FULFILLMENT_DEADLINE_EXPIRED' : exhausted ? 'CUSTOMER_ORDER_PRINT_ATTEMPTS_EXHAUSTED' : errorCode(error) }
  })
}

async function createJobForSealedIntent(db: FulfillmentDb, intentId: string, runtime?: CustomerOrderFulfillmentRuntimeOptions): Promise<CustomerOrderPrintResult> {
  if (!db.$transaction) return { status: 'MANUAL_REVIEW', created: false, printJobId: null, error: 'CUSTOMER_ORDER_TRANSACTION_UNAVAILABLE' }
  let attempted: any = null
  const create = () => db.$transaction!(async (tx) => {
    const model = intentModel(tx)
    const first = await model.findUnique({ where: { id: intentId } })
    if (!first) return { status: 'MANUAL_REVIEW', created: false, printJobId: null, error: 'CUSTOMER_ORDER_INTENT_NOT_FOUND' }
    await lockCustomerOrder(tx, { tenantId: first.tenantId, storeId: first.storeId, orderNo: first.orderNo })
    const intent = await model.findUnique({ where: { id: intentId } })
    if (!intent) return { status: 'MANUAL_REVIEW', created: false, printJobId: null, error: 'CUSTOMER_ORDER_INTENT_NOT_FOUND' }
    const now = new Date()
    if (['CANCELLED', 'EXPIRED', 'MANUAL_REVIEW', 'NOT_REQUIRED'].includes(intent.state)) {
      return { status: intent.state === 'EXPIRED' ? 'EXPIRED' : intent.state === 'NOT_REQUIRED' ? 'NOT_REQUIRED' : 'MANUAL_REVIEW', created: false, printJobId: intent.printJobId, error: intent.cancelResultCode ?? intent.manualReviewReason }
    }
    if (intent.printJobId) return { status: 'ALREADY_PRESENT', created: false, printJobId: intent.printJobId }
    if (intent.deadlineAt <= now) {
      await model.updateMany({ where: { id: intent.id, printJobId: null, state: { in: ['PENDING', 'RENDER_PENDING', 'FAILED_RETRYABLE'] } }, data: { state: 'EXPIRED', lastErrorCode: 'CUSTOMER_ORDER_FULFILLMENT_DEADLINE_EXPIRED', lastErrorAt: now, revision: { increment: 1 } } })
      return { status: 'EXPIRED', created: false, printJobId: intent.printJobId, error: 'CUSTOMER_ORDER_FULFILLMENT_DEADLINE_EXPIRED' }
    }
    const order = await tx.customerOrder.findFirst({ where: { tenantId: intent.tenantId, storeId: intent.storeId, orderNo: intent.orderNo } })
    const controlPlane = await tx.v3PrintControlPlane?.findUnique({ where: { storeId: intent.storeId }, select: { tenantId: true, mode: true } })
    if (!controlPlane || controlPlane.tenantId !== intent.tenantId || controlPlane.mode !== 'V3_ACTIVE') {
      await model.updateMany({ where: { id: intent.id, printJobId: null, revision: intent.revision }, data: { state: 'RENDER_PENDING', lastErrorCode: 'CUSTOMER_ORDER_V3_NOT_ACTIVE', lastErrorAt: now, nextAttemptAt: nextCustomerOrderAttemptAt(Math.max(1, intent.attemptCount), now, intent.deadlineAt), revision: { increment: 1 } } })
      return { status: 'NOT_READY', created: false, printJobId: null, error: 'CUSTOMER_ORDER_V3_NOT_ACTIVE' }
    }
    if (!customerOrderRendererReleased(intent.renderProfileId, runtime)) {
      await model.updateMany({ where: { id: intent.id, printJobId: null, revision: intent.revision }, data: { state: 'RENDER_PENDING', lastErrorCode: 'CUSTOMER_ORDER_RENDERER_NOT_RELEASED', lastErrorAt: now, nextAttemptAt: nextCustomerOrderAttemptAt(Math.max(1, intent.attemptCount), now, intent.deadlineAt), revision: { increment: 1 } } })
      return { status: 'NOT_READY', created: false, printJobId: null, error: 'CUSTOMER_ORDER_RENDERER_NOT_RELEASED' }
    }
    if (!order || (intent.role === 'KITCHEN' && order.status !== 'CONFIRMED') || (intent.role === 'FRONT' && (order.paymentStatus !== 'PAID' || order.status === 'CANCELLED'))) {
      await model.updateMany({ where: { id: intent.id, printJobId: null, revision: intent.revision }, data: { state: 'MANUAL_REVIEW', manualReviewReason: 'CUSTOMER_ORDER_STATE_CHANGED_BEFORE_JOB_CREATE', lastErrorAt: now, revision: { increment: 1 } } })
      return { status: 'MANUAL_REVIEW', created: false, printJobId: intent.printJobId, error: 'CUSTOMER_ORDER_STATE_CHANGED_BEFORE_JOB_CREATE' }
    }
    if (!intent.payloadBase64 || !intent.payloadHash || !intent.byteLength || !intent.rendererVersion || !intent.sealedAt) {
      return { status: 'NOT_READY', created: false, printJobId: null, error: 'CUSTOMER_ORDER_RENDERER_NOT_RELEASED' }
    }
    let rendered: ReturnType<typeof customerOrderEnvelopeFromSeal>
    try {
      if (intent.rendererVersion !== intent.renderProfileId) throw new Error('CUSTOMER_ORDER_RENDER_PROFILE_CHANGED')
      rendered = customerOrderEnvelopeFromSeal(customerOrderSnapshot(intent), intent.role, intent)
    } catch {
      await model.updateMany({ where: { id: intent.id, printJobId: null, revision: intent.revision }, data: { state: 'MANUAL_REVIEW', manualReviewReason: 'CUSTOMER_ORDER_SEALED_PAYLOAD_MISMATCH', lastErrorAt: now, revision: { increment: 1 } } })
      return { status: 'MANUAL_REVIEW', created: false, printJobId: null, error: 'CUSTOMER_ORDER_SEALED_PAYLOAD_MISMATCH' }
    }
    const existing = await tx.eshopTrayPrintJob.findUnique({ where: { tenantId_storeId_idempotencyKey: { tenantId: intent.tenantId, storeId: intent.storeId, idempotencyKey: intent.idempotencyKey } } })
    if (existing) {
      if (!existingJobMatchesIntent(existing, intent, rendered)) {
        await model.updateMany({ where: { id: intent.id, printJobId: null, revision: intent.revision }, data: { state: 'MANUAL_REVIEW', manualReviewReason: 'CUSTOMER_ORDER_EXISTING_JOB_IDENTITY_MISMATCH', lastErrorAt: now, revision: { increment: 1 } } })
        return { status: 'MANUAL_REVIEW', created: false, printJobId: null, error: 'CUSTOMER_ORDER_EXISTING_JOB_IDENTITY_MISMATCH' }
      }
      const associated = await model.updateMany({ where: { id: intent.id, printJobId: null, state: { in: ['PENDING', 'RENDER_PENDING', 'FAILED_RETRYABLE'] }, revision: intent.revision }, data: { printJobId: existing.id, state: 'ENQUEUED', nextAttemptAt: intent.deadlineAt, revision: { increment: 1 } } })
      if (associated.count === 1) return { status: 'ALREADY_PRESENT', created: false, printJobId: existing.id }
      const current = await model.findUnique({ where: { id: intent.id } })
      return current?.printJobId ? { status: 'ALREADY_PRESENT', created: false, printJobId: current.printJobId } : { status: 'NOT_READY', created: false, printJobId: null, error: 'CUSTOMER_ORDER_PRINT_ATTEMPT_IN_PROGRESS' }
    }
    if (intent.nextAttemptAt > now) return { status: 'NOT_READY', created: false, printJobId: null, error: 'CUSTOMER_ORDER_PRINT_BACKOFF' }
    if (intent.attemptCount >= intent.maxAttempts) {
      await model.updateMany({ where: { id: intent.id, printJobId: null, revision: intent.revision }, data: { state: 'MANUAL_REVIEW', manualReviewReason: 'CUSTOMER_ORDER_PRINT_ATTEMPTS_EXHAUSTED', lastErrorCode: 'CUSTOMER_ORDER_PRINT_ATTEMPTS_EXHAUSTED', lastErrorAt: now, revision: { increment: 1 } } })
      return { status: 'MANUAL_REVIEW', created: false, printJobId: null, error: 'CUSTOMER_ORDER_PRINT_ATTEMPTS_EXHAUSTED' }
    }
    const attempt = await model.updateMany({ where: { id: intent.id, printJobId: null, state: { in: ['PENDING', 'RENDER_PENDING', 'FAILED_RETRYABLE'] }, nextAttemptAt: { lte: now }, revision: intent.revision }, data: { attemptCount: { increment: 1 }, revision: { increment: 1 } } })
    if (attempt.count !== 1) return { status: 'NOT_READY', created: false, printJobId: null, error: 'CUSTOMER_ORDER_PRINT_ATTEMPT_IN_PROGRESS' }
    const attemptRevision = intent.revision + 1
    attempted = { ...intent }
    const result = await enqueueV3PrintIntent(tx as any, { tenantId: intent.tenantId, storeId: intent.storeId }, rendered, intent.deadlineAt, { idempotencyConflict: 'THROW' })
    const associated = await model.updateMany({ where: { id: intent.id, printJobId: null, state: { in: ['PENDING', 'RENDER_PENDING', 'FAILED_RETRYABLE'] }, revision: attemptRevision }, data: { printJobId: result.job.id, state: 'ENQUEUED', nextAttemptAt: intent.deadlineAt, revision: { increment: 1 } } })
    if (associated.count !== 1) throw new Error('CUSTOMER_ORDER_PRINT_ASSOCIATION_RACE')
    return { status: result.created ? 'QUEUED' : 'ALREADY_PRESENT', created: result.created, printJobId: result.job.id }
  })
  try { return await create() } catch (error) {
    if (!attempted) throw error // No task creation attempt: do not invent one.
    // If this new transaction cannot commit, propagate that runtime failure;
    // never report that retry accounting was durably saved on an unwritable DB.
    return recordRolledBackCreation(db, attempted, error)
  }
}

/** Metadata/sealed-job recovery only. No browser or text renderer can run here. */
export async function processCustomerOrderFulfillmentIntent(db: FulfillmentDb, intentId: string, now = new Date(), runtime?: CustomerOrderFulfillmentRuntimeOptions): Promise<CustomerOrderPrintResult> {
  const model = intentModel(db)
  const intent = await model.findUnique({ where: { id: intentId } })
  if (!intent) return { status: 'NOT_APPLICABLE', created: false, printJobId: null, error: 'CUSTOMER_ORDER_INTENT_NOT_FOUND' }
  if (intent.printJobId) return { status: 'ALREADY_PRESENT', created: false, printJobId: intent.printJobId }
  if (['CANCELLED', 'EXPIRED', 'MANUAL_REVIEW', 'NOT_REQUIRED'].includes(intent.state)) {
    return { status: intent.state === 'EXPIRED' ? 'EXPIRED' : intent.state === 'NOT_REQUIRED' ? 'NOT_REQUIRED' : 'MANUAL_REVIEW', created: false, printJobId: intent.printJobId, error: intent.cancelResultCode ?? intent.manualReviewReason }
  }
  if (intent.deadlineAt <= now && !intent.printJobId) {
    const changed = await model.updateMany({ where: { id: intent.id, printJobId: null, revision: intent.revision, state: { in: pendingJobStates } }, data: { ...clearCustomerOrderRenderLease, state: 'EXPIRED', lastErrorCode: 'CUSTOMER_ORDER_FULFILLMENT_DEADLINE_EXPIRED', lastErrorAt: now, lastRecoverySweepAt: now, revision: { increment: 1 } } })
    if (changed.count !== 1) return customerOrderPrintReceipt(db, intent, intent.role)
    return { status: 'EXPIRED', created: false, printJobId: null, error: 'CUSTOMER_ORDER_FULFILLMENT_DEADLINE_EXPIRED' }
  }
  if (intent.attemptCount >= intent.maxAttempts && !intent.printJobId) {
    const changed = await model.updateMany({ where: { id: intent.id, printJobId: null, revision: intent.revision, state: { in: ['PENDING', 'RENDER_PENDING', 'FAILED_RETRYABLE'] } }, data: { state: 'MANUAL_REVIEW', manualReviewReason: 'CUSTOMER_ORDER_PRINT_ATTEMPTS_EXHAUSTED', lastErrorCode: 'CUSTOMER_ORDER_PRINT_ATTEMPTS_EXHAUSTED', lastErrorAt: now, revision: { increment: 1 } } })
    if (changed.count !== 1) return customerOrderPrintReceipt(db, intent, intent.role)
    return { status: 'MANUAL_REVIEW', created: false, printJobId: null, error: 'CUSTOMER_ORDER_PRINT_ATTEMPTS_EXHAUSTED' }
  }
  if (intent.sealedAt) return createJobForSealedIntent(db, intent.id, runtime)
  // An active rendering reservation is fenced by revision. Cron MUST NOT bump
  // that revision, or every valid result would become a spurious late result.
  if (intent.renderLeaseExpiresAt && intent.renderLeaseExpiresAt > now) return { status: 'PROCESSING', created: false, printJobId: null }
  const leaseExpired = Boolean(intent.renderLeaseExpiresAt)
  const exhausted = (intent.renderAttemptCount ?? 0) >= CUSTOMER_ORDER_MAX_RENDER_ATTEMPTS
  const controlPlane = await db.v3PrintControlPlane?.findUnique({ where: { storeId: intent.storeId }, select: { tenantId: true, mode: true } })
  const code = leaseExpired ? 'CUSTOMER_ORDER_RENDER_LEASE_EXPIRED'
    : !controlPlane || controlPlane.tenantId !== intent.tenantId || controlPlane.mode !== 'V3_ACTIVE' ? 'CUSTOMER_ORDER_V3_NOT_ACTIVE'
    : !customerOrderRendererReleased(intent.renderProfileId, runtime) ? 'CUSTOMER_ORDER_RENDERER_NOT_RELEASED' : 'CUSTOMER_ORDER_AWAITING_RENDERER'
  const changed = await model.updateMany({ where: { id: intent.id, printJobId: null, revision: intent.revision, state: { in: pendingJobStates } }, data: {
    ...clearCustomerOrderRenderLease, state: exhausted ? 'MANUAL_REVIEW' : leaseExpired ? 'FAILED_RETRYABLE' : 'RENDER_PENDING',
    nextAttemptAt: nextCustomerOrderAttemptAt(leaseExpired ? intent.renderAttemptCount : 1, now, intent.deadlineAt),
    lastErrorCode: exhausted ? 'CUSTOMER_ORDER_RENDER_ATTEMPTS_EXHAUSTED' : code,
    ...(exhausted ? { manualReviewReason: 'CUSTOMER_ORDER_RENDER_ATTEMPTS_EXHAUSTED' } : {}),
    lastErrorAt: now, lastRecoverySweepAt: now, revision: { increment: 1 },
  } })
  if (changed.count !== 1) return customerOrderPrintReceipt(db, intent, intent.role)
  return { status: exhausted ? 'MANUAL_REVIEW' : 'NOT_READY', created: false, printJobId: null, error: code }
}

/** Read-only response after a business commit. Failure is receipt evidence,
 * never a reason to turn an already committed payment into an HTTP 500. */
export async function customerOrderPrintReceipt(db: FulfillmentDb, scope: { tenantId: string; storeId: string; orderNo: string }, role: IntentRole): Promise<CustomerOrderPrintResult> {
  try {
    const i = await intentModel(db).findUnique({ where: { tenantId_storeId_orderNo_role: {
      tenantId: scope.tenantId, storeId: scope.storeId, orderNo: scope.orderNo, role,
    } } })
    if (!i || i.source !== CUSTOMER_ORDER_SOURCE) return { status: 'NOT_APPLICABLE', created: false, printJobId: null }
    if (i.printJobId) return { status: 'ALREADY_PRESENT', created: false, printJobId: i.printJobId }
    if (i.state === 'NOT_REQUIRED') return { status: 'NOT_REQUIRED', created: false, printJobId: null }
    if (i.state === 'EXPIRED') return { status: 'EXPIRED', created: false, printJobId: null }
    if (['MANUAL_REVIEW', 'CANCELLED'].includes(i.state)) return { status: 'MANUAL_REVIEW', created: false, printJobId: null }
    return { status: i.lastErrorCode ? 'NOT_READY' : 'PROCESSING', created: false, printJobId: null }
  } catch { return { status: 'FAILED', created: false, printJobId: null, error: 'CUSTOMER_ORDER_PRINT_STATUS_UNAVAILABLE' } }
}

export async function enqueueCustomerOrderPrintJob(db: FulfillmentDb, order: CustomerOrderPrintOrder, role: CustomerOrderPrintRole, runtime?: CustomerOrderFulfillmentRuntimeOptions): Promise<CustomerOrderPrintResult> {
  const model = intentModel(db)
  const key = { tenantId: order.tenantId, storeId: order.storeId, orderNo: order.orderNo, role }
  let existing = await model.findUnique({ where: { tenantId_storeId_orderNo_role: key } })
  if (!existing) {
    return {
      status: 'NOT_APPLICABLE',
      created: false,
      printJobId: null,
      error: role === 'FRONT' ? 'CUSTOMER_ORDER_FRONT_INTENT_MISSING' : 'CUSTOMER_ORDER_KITCHEN_INTENT_MISSING',
    }
  }
  return processCustomerOrderFulfillmentIntent(db, existing.id, new Date(), runtime)
}

export async function enqueueCustomerOrderKitchenPrintJob(db: FulfillmentDb, order: CustomerOrderPrintOrder): Promise<CustomerOrderPrintResult> {
  return enqueueCustomerOrderPrintJob(db, order, 'KITCHEN')
}

export async function recordCustomerOrderIntent(tx: FulfillmentDb, order: CustomerOrderPrintOrder, role: IntentRole, decision: CustomerOrderFulfillmentDecision, now: Date, paymentIntentId?: string | null) {
  return intentModel(tx).create({ data: intentCreateData({ order, role, decision, now, paymentIntentId }) })
}

export async function cancelCustomerOrderKitchenIntent(tx: FulfillmentDb, order: CustomerOrderPrintOrder, now = new Date()) {
  const model = intentModel(tx)
  await lockCustomerOrder(tx, { tenantId: order.tenantId, storeId: order.storeId, orderNo: order.orderNo })
  const intent = await model.findUnique({ where: { tenantId_storeId_orderNo_role: { tenantId: order.tenantId, storeId: order.storeId, orderNo: order.orderNo, role: 'KITCHEN' } } })
  if (!intent || intent.source !== CUSTOMER_ORDER_SOURCE) return { kind: 'NOT_APPLICABLE' as const }
  if (intent.state === 'CANCELLED') return { kind: 'CANCELLED' as const, code: intent.cancelResultCode }
  if (intent.state === 'NOT_REQUIRED') return { kind: 'CANCELLED' as const, code: 'NOT_REQUIRED' }
  if (intent.state === 'EXPIRED') return { kind: 'CANCELLED' as const, code: 'CUSTOMER_ORDER_FULFILLMENT_DEADLINE_EXPIRED' }
  if (intent.state === 'MANUAL_REVIEW') {
    return { kind: 'CANCELLED' as const, code: intent.manualReviewReason ?? 'KITCHEN_TASK_REQUIRES_MANUAL_VERIFICATION' }
  }
  let code = CUSTOMER_ORDER_CANCELLED_BEFORE_CLAIM
  if (intent.printJobId) {
    const cancelled = await cancelPendingV3PrintIntent(tx as any, {
      tenantId: order.tenantId, storeId: order.storeId, orderNo: order.orderNo,
      role: 'KITCHEN', jobId: intent.printJobId, idempotencyKey: intent.idempotencyKey, schemaVersion: intent.schemaVersion, now, inTransaction: true,
    })
    code = cancelled.ok ? CUSTOMER_ORDER_CANCELLED_BEFORE_CLAIM : cancelled.code
  }
  const reprints = tx.eshopTrayPrintJob?.findMany
    ? await cancelUnclaimedV3PrintReprints(tx as any, {
        tenantId: order.tenantId, storeId: order.storeId, orderNo: order.orderNo, role: 'KITCHEN', schemaVersion: intent.schemaVersion, now, inTransaction: true,
      })
    : { cancelledJobIds: [], uncertainJobIds: [], ok: true }
  if (reprints.uncertainJobIds.length > 0) code = 'KITCHEN_TASK_REQUIRES_MANUAL_VERIFICATION'
  const updated = await model.updateMany({ where: {
    id: intent.id, source: CUSTOMER_ORDER_SOURCE, state: { in: ['PENDING', 'RENDER_PENDING', 'FAILED_RETRYABLE', 'ENQUEUED'] },
    revision: intent.revision,
  }, data: {
    ...clearCustomerOrderRenderLease, state: 'CANCELLED', cancelResultCode: code,
    manualReviewReason: code === CUSTOMER_ORDER_CANCELLED_BEFORE_CLAIM ? null : 'KITCHEN_TASK_REQUIRES_MANUAL_VERIFICATION',
    nextAttemptAt: now, lastErrorCode: code, lastErrorAt: now, revision: { increment: 1 },
  } })
  if (updated.count !== 1) {
    const current = await model.findUnique({ where: { id: intent.id } })
    if (current?.state === 'CANCELLED') return { kind: 'CANCELLED' as const, code: current.cancelResultCode }
    return { kind: 'CANCEL_RACE' as const, code: 'CUSTOMER_ORDER_CANCEL_RACE' }
  }
  return { kind: 'CANCELLED' as const, code }
}

const CUSTOMER_ORDER_RECOVERY_PAGE_SIZE = 100
const CUSTOMER_ORDER_RECOVERY_MAX_PAGES = 10
const CUSTOMER_ORDER_RECOVERY_ACTIONABLE_STATES: CustomerOrderFulfillmentState[] = ['PENDING', 'RENDER_PENDING', 'FAILED_RETRYABLE']

export async function runCustomerOrderFulfillmentRecovery(db: FulfillmentDb, now = new Date()) {
  const summary = { scanned: 0, pages: 0, queued: 0, alreadyPresent: 0, notReady: 0, failed: 0, manualReview: 0, expired: 0, skipped: 0 }
  const errors: Array<{ orderNo: string; role: string; error: string }> = []
  const model = intentModel(db)

  for (let pageNumber = 0; pageNumber < CUSTOMER_ORDER_RECOVERY_MAX_PAGES; pageNumber += 1) {
    const page = await model.findMany({
      where: {
        source: CUSTOMER_ORDER_SOURCE,
        OR: [
          { state: { in: CUSTOMER_ORDER_RECOVERY_ACTIONABLE_STATES }, nextAttemptAt: { lte: now } },
          { state: { in: CUSTOMER_ORDER_RECOVERY_ACTIONABLE_STATES }, deadlineAt: { lte: now } },
        ],
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }],
      take: CUSTOMER_ORDER_RECOVERY_PAGE_SIZE,
    })
    summary.pages += 1
    summary.scanned += page.length
    if (page.length === 0) break

    for (const intent of page) {
      try {
        if (intent.deadlineAt <= now) {
          const changed = await model.updateMany({
            where: { id: intent.id, source: CUSTOMER_ORDER_SOURCE, revision: intent.revision, printJobId: null, state: { in: CUSTOMER_ORDER_RECOVERY_ACTIONABLE_STATES } },
            data: {
              ...clearCustomerOrderRenderLease, state: 'EXPIRED', lastErrorCode: 'CUSTOMER_ORDER_FULFILLMENT_DEADLINE_EXPIRED',
              lastErrorAt: now, lastRecoverySweepAt: now, revision: { increment: 1 },
            },
          })
          if (changed.count === 1) summary.expired += 1
          else summary.skipped += 1
          continue
        }

        const result = await processCustomerOrderFulfillmentIntent(db, intent.id, now)
        if (result.status === 'QUEUED') summary.queued += 1
        else if (result.status === 'ALREADY_PRESENT') summary.alreadyPresent += 1
        else if (result.status === 'NOT_READY') summary.notReady += 1
        else if (result.status === 'MANUAL_REVIEW') summary.manualReview += 1
        else if (result.status === 'FAILED') summary.failed += 1
        else if (result.status === 'EXPIRED') summary.expired += 1
        else summary.skipped += 1
        if (result.error && result.status !== 'NOT_READY') errors.push({ orderNo: intent.orderNo, role: intent.role, error: result.error })
      } catch (error) {
        const expired = intent.deadlineAt <= now
        const nextAttemptAt = new Date(Math.min(intent.deadlineAt.getTime(), now.getTime() + 60_000))
        await model.updateMany({
          where: {
            id: intent.id,
            source: CUSTOMER_ORDER_SOURCE,
            state: { in: CUSTOMER_ORDER_RECOVERY_ACTIONABLE_STATES },
            revision: intent.revision,
            printJobId: null,
            nextAttemptAt: { lte: now },
          },
          data: {
            state: expired ? 'EXPIRED' : 'FAILED_RETRYABLE',
            nextAttemptAt: expired ? now : nextAttemptAt,
            lastErrorCode: error instanceof Error ? error.message.slice(0, 160) : 'CUSTOMER_ORDER_RECOVERY_FAILED',
            lastErrorAt: now, lastRecoverySweepAt: now, revision: { increment: 1 },
          },
        })
        summary.failed += 1
        errors.push({ orderNo: intent.orderNo, role: intent.role, error: error instanceof Error ? error.message : 'CUSTOMER_ORDER_RECOVERY_FAILED' })
      }
    }

    if (page.length < CUSTOMER_ORDER_RECOVERY_PAGE_SIZE) break
  }

  return { ok: errors.length === 0, summary, errors: errors.slice(0, 100) }
}
