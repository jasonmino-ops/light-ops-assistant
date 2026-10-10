/**
 * ES-DINE-IN-01 M1 — every state change of the dine-in module.
 *
 * Shape of each command: one database transaction that first locks the meal row
 * (the table row when opening), then looks up the request key, and only then looks
 * at the meal's state. Printing never happens here; the Desktop page prints after
 * the transaction has committed.
 *
 * Money is never stored by this module. What a meal owes is always the sum of its
 * PENDING_PAYMENT SaleRecord rows; what was paid is the PaymentIntent.
 */
import { Prisma, type PrismaClient } from '@prisma/client'
import { generateRecordNo } from '@/lib/record-no'
import { isKhqrSupportedCurrency } from '@/lib/currency'
import { requiresCashierManualPaymentConfirmation } from '@/lib/cashier-payment-confirmation'
import { canonicalV3OriginalPrintJobId, classifyV3OperatorPrintJob } from '@/lib/v3-print-operator-status'
import { V3_PRINT_INTENT_TTL_MS } from '@/lib/v3-print-identity'
import {
  DINING_NOTICE_TTL_MS,
  PRINT_ORDER_NO_PATTERN,
  deriveDiningNoticeStatus,
  diningNoticeDeliverable,
  diningNoticeStale,
  diningNoticePrintOrderNo,
  isDiningNoticeReportOutcome,
  kitchenAwareness,
  type DiningKitchenAwareness,
  type DiningNoticeEvidence,
  type DiningNoticeStatus,
} from './kitchen-notice'
import {
  DiningCommandError,
  asJson,
  iso,
  isUniqueViolation,
  money,
  parseMoney,
  requestDigest,
  requireRequestKey,
  type DiningActor,
  type DiningPaymentMethod,
  type DiningScope,
} from './types'

type Tx = Prisma.TransactionClient
type Db = PrismaClient

const TX_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const
const MAX_ATTEMPTS = 3
const MAX_LINES_PER_BATCH = 100
const MAX_QUANTITY = 999

// ── Public result shapes ────────────────────────────────────────────────────

export type DiningNoticeView = {
  required: boolean
  status: DiningNoticeStatus
  claimedAt: string | null
  reportedOutcome: string | null
  /** A page may take the printable content now (first and only submit). */
  canClaim: boolean
  /** A person may create a manual re-notification batch for this batch now. */
  canRenotify: boolean
  /** Re-notifying may put a second ticket in the kitchen; the operator must accept that. */
  duplicateRisk: boolean
}

export type DiningLineView = {
  saleRecordId: string
  name: string
  spec: string | null
  quantity: number
  unitPrice: string
  lineAmount: string
  status: 'PENDING_PAYMENT' | 'COMPLETED' | 'CANCELLED'
  kitchen: boolean
}

export type DiningBatchView = {
  id: string
  seq: number
  kind: 'ORDER' | 'VOID' | 'RENOTIFY'
  createdAt: string
  operatorName: string | null
  reason: string | null
  refSeq: number | null
  lines: DiningLineView[]
  notice: DiningNoticeView
}

export type DiningPaymentView = {
  paymentIntentId: string
  billNo: string
  paymentMethod: string
  amount: string
  paidAt: string | null
  /**
   * Print identity of the payment receipt: the bill number itself with role FRONT,
   * exactly the identity an ordinary sale receipt has. Null when the bill number
   * cannot be used as a print identity.
   */
  receiptPrint: { printOrderNo: string; printJobId: string; role: 'FRONT'; expiresAt: string } | null
}

export type DiningMealView = {
  mealId: string
  state: 'OPEN' | 'PAID' | 'CLOSED' | 'VOIDED'
  version: number
  table: { id: string; name: string; areaKind: 'HALL' | 'ROOM' }
  guestCount: number
  note: string | null
  billNo: string | null
  openedAt: string
  endedAt: string | null
  unpaidAmount: string
  unpaidLineCount: number
  payment: DiningPaymentView | null
  /**
   * The meal is still OPEN but its bill number already carries a payment row this
   * module did not write (for example a legacy checkout during an application
   * rollback). Nothing can be ordered or settled here; it needs a person.
   */
  externalPaymentStatus: string | null
  /**
   * Batches whose kitchen notice no page has taken yet and that can still be taken.
   * While the meal is open that is any notice; afterwards only void notices.
   */
  pendingNoticeSeqs: number[]
  /**
   * Batches that need a kitchen notice and have no evidence of one having been sent to
   * the printer, counting every manual re-notification. Information for people; never a
   * condition of any command.
   *
   * This is about sending evidence only. The system knows three separate things and
   * never turns one into another: that a notice is wanted (the batch), whether there is
   * evidence it was sent to the printer (page report and print job row), and that a
   * person said they told the kitchen (audit of a void). None of them says that the
   * kitchen has seen or accepted anything.
   *  - orderSeqs: order batches with a dish that was not voided. Once the meal is no
   *    longer open nothing more is sent for them.
   *  - voidSeqs: void batches. These can still be sent or sent again, also after the
   *    meal has ended.
   */
  noSendEvidence: { orderSeqs: number[]; voidSeqs: number[] }
  batches: DiningBatchView[]
}

export type DiningTableView = {
  id: string
  name: string
  areaKind: 'HALL' | 'ROOM'
  isActive: boolean
  sortOrder: number
  meal: null | {
    mealId: string
    state: 'OPEN' | 'PAID'
    guestCount: number
    openedAt: string
    billNo: string | null
    unpaidAmount: string
    batchCount: number
    pendingNoticeCount: number
  }
}

/** An ended meal that still has a void notice a person can send or re-send. */
export type DiningRecoverableMeal = {
  mealId: string
  state: 'CLOSED' | 'VOIDED'
  tableName: string
  billNo: string | null
  endedAt: string
  /** Void batches with no evidence of a notice having been sent to the printer. */
  voidNoticeSeqs: number[]
}

/** One bounded page of the recovery list, newest ended meal first. */
export type DiningRecoverablePage = {
  items: DiningRecoverableMeal[]
  /** Pass back to get the next page. Null when this is the last one. */
  nextCursor: string | null
  hasMore: boolean
}

export type DiningKitchenNotice = {
  batchId: string
  printOrderNo: string
  printJobId: string
  role: 'KITCHEN'
  expiresAt: string
  content: {
    kind: 'ORDER' | 'VOID' | 'RENOTIFY'
    /** For a re-notification: what is being re-sent. */
    subject: 'ORDER' | 'VOID'
    seq: number
    refSeq: number | null
    billNo: string
    tableName: string
    areaKind: 'HALL' | 'ROOM'
    guestCount: number
    createdAt: string
    lines: { saleRecordId: string; name: string; spec: string | null; quantity: number }[]
  }
}

// ── Plumbing ────────────────────────────────────────────────────────────────

function retryable(error: unknown): boolean {
  if (error instanceof DiningCommandError) return false
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code === 'P2034' || error.code === 'P2002'
  return false
}

/**
 * Runs one command transaction. A serialization failure or a record-number
 * collision (generateRecordNo is count+1) rolls everything back and is retried;
 * because nothing was committed, the retry cannot duplicate a batch.
 */
async function transact<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await db.$transaction(fn, TX_OPTIONS)
    } catch (error) {
      lastError = error
      if (!retryable(error) || attempt === MAX_ATTEMPTS) break
    }
  }
  if (retryable(lastError)) throw new DiningCommandError('BUSY_RETRY_SAME_REQUEST', 409)
  throw lastError
}

async function lockMeal(tx: Tx, scope: DiningScope, mealId: string) {
  if (typeof mealId !== 'string' || !mealId) throw new DiningCommandError('MEAL_NOT_FOUND', 404)
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "DiningMeal"
    WHERE "id" = ${mealId} AND "tenantId" = ${scope.tenantId} AND "storeId" = ${scope.storeId}
    FOR UPDATE`
  if (rows.length !== 1) throw new DiningCommandError('MEAL_NOT_FOUND', 404)
  return tx.diningMeal.findUniqueOrThrow({ where: { id: mealId }, include: { table: true } })
}

async function lockTable(tx: Tx, scope: DiningScope, tableId: string) {
  if (typeof tableId !== 'string' || !tableId) throw new DiningCommandError('TABLE_NOT_FOUND', 404)
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "DiningTable"
    WHERE "id" = ${tableId} AND "tenantId" = ${scope.tenantId} AND "storeId" = ${scope.storeId}
    FOR UPDATE`
  if (rows.length !== 1) throw new DiningCommandError('TABLE_NOT_FOUND', 404)
  return tx.diningTable.findUniqueOrThrow({ where: { id: tableId } })
}

async function audit(
  tx: Tx,
  scope: DiningScope,
  actor: DiningActor,
  entry: { actionType: string; targetType: string; targetId: string; requestId?: string; payload: unknown },
) {
  await tx.operationLog.create({
    data: {
      tenantId: scope.tenantId,
      storeId: scope.storeId,
      userId: actor.userId,
      actionType: entry.actionType,
      targetType: entry.targetType,
      targetId: entry.targetId,
      requestId: entry.requestId ?? null,
      status: 'SUCCESS',
      payloadSnapshot: asJson(entry.payload),
    },
  })
}

function reason(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text.length < 1 || text.length > 200) throw new DiningCommandError('REASON_REQUIRED', 400)
  return text
}

// ── Reading a meal ──────────────────────────────────────────────────────────

type MealRow = Prisma.DiningMealGetPayload<{ include: { table: true } }>
type BatchRow = Prisma.DiningBatchGetPayload<Record<string, never>>
type SaleRow = Prisma.SaleRecordGetPayload<Record<string, never>>
type VoidRow = Prisma.DiningVoidLineGetPayload<Record<string, never>>

type MealGraph = {
  meal: MealRow
  batches: BatchRow[]
  sales: SaleRow[]
  salesById: Map<string, SaleRow>
  voids: VoidRow[]
  status: Map<string, DiningNoticeStatus>
}

const PRINT_JOB_SELECT = {
  id: true, idempotencyKey: true, schemaVersion: true, payload: true, status: true, claimTokenHash: true,
  claimAttempt: true, attemptCount: true, leaseExpiresAt: true, completedAt: true, resultStatus: true,
  resultCode: true, resultMessage: true, effectBoundary: true, physicalCompletionKnown: true, updatedAt: true,
} as const

/**
 * Reads the existing print job rows for the given notice identities and classifies
 * them with the existing operator-status function. Read only.
 */
async function readNoticeEvidence(tx: Tx, scope: DiningScope, printOrderNos: string[]) {
  const evidence = new Map<string, DiningNoticeEvidence>()
  const jobIdByOrderNo = new Map<string, string>()
  for (const orderNo of printOrderNos) {
    if (PRINT_ORDER_NO_PATTERN.test(orderNo)) jobIdByOrderNo.set(orderNo, canonicalV3OriginalPrintJobId(orderNo, 'KITCHEN'))
  }
  if (jobIdByOrderNo.size === 0) return evidence
  const jobs = await tx.eshopTrayPrintJob.findMany({
    where: { tenantId: scope.tenantId, storeId: scope.storeId, idempotencyKey: { in: [...jobIdByOrderNo.values()] } },
    select: PRINT_JOB_SELECT,
  })
  const jobByKey = new Map(jobs.map((job) => [job.idempotencyKey, job]))
  for (const [orderNo, jobId] of jobIdByOrderNo) {
    const job = jobByKey.get(jobId) ?? null
    evidence.set(orderNo, job ? classifyV3OperatorPrintJob(job, jobId).state : null)
  }
  return evidence
}

/** The database's clock. Staleness is decided with it, so that every application instance agrees. */
async function databaseNow(tx: Tx): Promise<Date> {
  // As a zone-less UTC timestamp, the same form every DateTime column of this schema is stored and read in.
  const rows = await tx.$queryRaw<{ now: Date }[]>`SELECT (clock_timestamp() AT TIME ZONE 'UTC') AS "now"`
  return rows[0].now
}

async function loadGraph(tx: Tx, scope: DiningScope, meal: MealRow, at?: Date): Promise<MealGraph> {
  const batches = await tx.diningBatch.findMany({
    where: { tenantId: scope.tenantId, storeId: scope.storeId, mealId: meal.id },
    orderBy: { seq: 'asc' },
  })
  const batchIds = batches.map((batch) => batch.id)
  const [sales, voids] = batchIds.length === 0 ? [[], []] : await Promise.all([
    tx.saleRecord.findMany({
      where: { tenantId: scope.tenantId, storeId: scope.storeId, diningBatchId: { in: batchIds } },
      orderBy: { createdAt: 'asc' },
    }),
    tx.diningVoidLine.findMany({ where: { tenantId: scope.tenantId, storeId: scope.storeId, mealId: meal.id } }),
  ])
  const claimedOrderNos = meal.billNo
    ? batches.filter((batch) => batch.noticeClaimedAt).map((batch) => diningNoticePrintOrderNo(meal.billNo!, batch.seq))
    : []
  const evidence = await readNoticeEvidence(tx, scope, claimedOrderNos)
  const status = new Map<string, DiningNoticeStatus>()
  const kindById = new Map(batches.map((batch) => [batch.id, batch.kind]))
  const now = at ?? await databaseNow(tx)
  for (const batch of batches) {
    const subjectKind = batch.kind === 'RENOTIFY' ? kindById.get(batch.refBatchId ?? '') : batch.kind
    status.set(batch.id, deriveDiningNoticeStatus({
      required: batch.noticeRequired,
      claimed: batch.noticeClaimedAt !== null,
      withdrawn: batch.noticeWithdrawnAt !== null,
      reportedOutcome: batch.noticeReportedOutcome,
      deliverable: diningNoticeDeliverable(meal.state === 'OPEN', subjectKind === 'VOID' ? 'VOID' : 'ORDER'),
      stale: diningNoticeStale(batch.createdAt, now),
      evidence: meal.billNo ? evidence.get(diningNoticePrintOrderNo(meal.billNo, batch.seq)) ?? null : null,
    }))
  }
  return { meal, batches, sales, salesById: new Map(sales.map((sale) => [sale.id, sale])), voids, status }
}

/** The notice of `batch` plus every manual re-notification of it. */
function chainOf(graph: MealGraph, batch: BatchRow): BatchRow[] {
  return [batch, ...graph.batches.filter((other) => other.kind === 'RENOTIFY' && other.refBatchId === batch.id)]
}

function awarenessOf(graph: MealGraph, batch: BatchRow): DiningKitchenAwareness {
  return kitchenAwareness(chainOf(graph, batch).map((entry) => graph.status.get(entry.id)!))
}

/**
 * Lines a notice for `batch` would carry right now. An order notice only ever
 * carries rows that are still unpaid and not voided; a void notice carries the
 * rows that void took off a ticket the kitchen may have.
 */
function noticeLines(graph: MealGraph, batch: BatchRow): SaleRow[] {
  const subject = batch.kind === 'RENOTIFY' ? graph.batches.find((other) => other.id === batch.refBatchId) : batch
  if (!subject) return []
  const rows = subject.kitchenLineIds.map((id) => graph.salesById.get(id)).filter((row): row is SaleRow => Boolean(row))
  return subject.kind === 'ORDER' ? rows.filter((row) => row.status === 'PENDING_PAYMENT') : rows
}

function noticeView(graph: MealGraph, batch: BatchRow): DiningNoticeView {
  const status = graph.status.get(batch.id)!
  // After the meal has stopped being open only a void notice may be sent again.
  const open = diningNoticeDeliverable(graph.meal.state === 'OPEN', batch.kind === 'VOID' ? 'VOID' : 'ORDER')
  const chain = batch.kind === 'RENOTIFY' ? [] : chainOf(graph, batch)
  const chainStatuses = chain.map((entry) => graph.status.get(entry.id)!)
  const awareness = kitchenAwareness(chainStatuses)
  const canRenotify = open
    && batch.kind !== 'RENOTIFY'
    && batch.noticeRequired
    && awareness !== 'NEVER_TOLD'
    && !chainStatuses.includes('PENDING_SUBMIT')
    && noticeLines(graph, batch).length > 0
  return {
    required: batch.noticeRequired,
    status,
    claimedAt: iso(batch.noticeClaimedAt),
    reportedOutcome: batch.noticeReportedOutcome,
    canClaim: status === 'PENDING_SUBMIT',
    canRenotify,
    duplicateRisk: canRenotify && awareness !== 'NOT_SENT',
  }
}

async function paymentView(tx: Tx, meal: MealRow): Promise<DiningPaymentView | null> {
  if (!meal.paymentIntentId || !meal.billNo) return null
  const payment = await tx.paymentIntent.findUnique({ where: { id: meal.paymentIntentId } })
  if (!payment) return null
  return {
    paymentIntentId: payment.id,
    billNo: meal.billNo,
    paymentMethod: payment.paymentMethod,
    amount: money(payment.amount),
    paidAt: iso(payment.paidAt),
    receiptPrint: payment.paidAt && PRINT_ORDER_NO_PATTERN.test(meal.billNo) ? {
      printOrderNo: meal.billNo,
      printJobId: canonicalV3OriginalPrintJobId(meal.billNo, 'FRONT'),
      role: 'FRONT',
      expiresAt: new Date(payment.paidAt.getTime() + V3_PRINT_INTENT_TTL_MS).toISOString(),
    } : null,
  }
}

/** A payment row on this bill number that this meal does not own. */
async function externalPayment(tx: Tx, meal: MealRow) {
  if (!meal.billNo) return null
  const payment = await tx.paymentIntent.findUnique({ where: { orderNo: meal.billNo }, select: { id: true, status: true } })
  return payment && payment.id !== meal.paymentIntentId ? payment : null
}

async function buildView(tx: Tx, scope: DiningScope, meal: MealRow): Promise<DiningMealView> {
  const graph = await loadGraph(tx, scope, meal)
  const operatorIds = [...new Set(graph.batches.map((batch) => batch.operatorUserId))]
  const operators = operatorIds.length === 0 ? [] : await tx.user.findMany({
    where: { tenantId: scope.tenantId, id: { in: operatorIds } },
    select: { id: true, displayName: true },
  })
  const operatorName = new Map(operators.map((user) => [user.id, user.displayName]))
  const seqById = new Map(graph.batches.map((batch) => [batch.id, batch.seq]))
  const kitchenIds = new Set(graph.batches.filter((batch) => batch.kind === 'ORDER').flatMap((batch) => batch.kitchenLineIds))
  const lineView = (sale: SaleRow): DiningLineView => ({
    saleRecordId: sale.id,
    name: sale.productNameSnapshot,
    spec: sale.specSnapshot,
    quantity: Number(sale.quantity),
    unitPrice: money(sale.unitPrice),
    lineAmount: money(sale.lineAmount),
    status: sale.status,
    kitchen: kitchenIds.has(sale.id),
  })
  const unpaid = graph.sales.filter((sale) => sale.status === 'PENDING_PAYMENT' && sale.saleType === 'SALE')
  return {
    mealId: meal.id,
    state: meal.state,
    version: meal.version,
    table: { id: meal.table.id, name: meal.table.name, areaKind: meal.table.areaKind },
    guestCount: meal.guestCount,
    note: meal.note,
    billNo: meal.billNo,
    openedAt: meal.createdAt.toISOString(),
    endedAt: iso(meal.endedAt),
    unpaidAmount: money(unpaid.reduce((sum, sale) => sum.add(sale.lineAmount), new Prisma.Decimal(0))),
    unpaidLineCount: unpaid.length,
    payment: await paymentView(tx, meal),
    externalPaymentStatus: meal.state === 'OPEN' ? (await externalPayment(tx, meal))?.status ?? null : null,
    pendingNoticeSeqs: unsentNoticeSeqs(graph),
    noSendEvidence: noSendEvidence(graph),
    batches: graph.batches.map((batch) => ({
      id: batch.id,
      seq: batch.seq,
      kind: batch.kind,
      createdAt: batch.createdAt.toISOString(),
      operatorName: operatorName.get(batch.operatorUserId) ?? null,
      reason: batch.reason,
      refSeq: batch.refBatchId ? seqById.get(batch.refBatchId) ?? null : null,
      lines: batch.kind === 'ORDER'
        ? graph.sales.filter((sale) => sale.diningBatchId === batch.id).map(lineView)
        : batch.kind === 'VOID'
          ? graph.voids.filter((line) => line.voidBatchId === batch.id)
            .map((line) => graph.salesById.get(line.saleRecordId))
            .filter((sale): sale is SaleRow => Boolean(sale))
            .map(lineView)
          : [],
      notice: noticeView(graph, batch),
    })),
  }
}

export async function getMealView(db: Db, scope: DiningScope, mealId: string): Promise<DiningMealView> {
  return db.$transaction(async (tx) => {
    const meal = await tx.diningMeal.findFirst({
      where: { id: mealId, tenantId: scope.tenantId, storeId: scope.storeId },
      include: { table: true },
    })
    if (!meal) throw new DiningCommandError('MEAL_NOT_FOUND', 404)
    return buildView(tx, scope, meal)
  }, TX_OPTIONS)
}

// ── Tables ──────────────────────────────────────────────────────────────────

export async function listTables(db: Db, scope: DiningScope): Promise<DiningTableView[]> {
  const where = { tenantId: scope.tenantId, storeId: scope.storeId }
  const [tables, meals] = await Promise.all([
    db.diningTable.findMany({ where, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    db.diningMeal.findMany({ where: { ...where, state: { in: ['OPEN', 'PAID'] } } }),
  ])
  const mealIds = meals.map((meal) => meal.id)
  const batches = mealIds.length === 0 ? [] : await db.diningBatch.findMany({
    where: { ...where, mealId: { in: mealIds } },
    select: { id: true, mealId: true, kind: true, refBatchId: true, noticeRequired: true, noticeClaimedAt: true, noticeWithdrawnAt: true },
  })
  const mealIdByBatch = new Map(batches.map((batch) => [batch.id, batch.mealId]))
  const unpaidRows = batches.length === 0 ? [] : await db.saleRecord.groupBy({
    by: ['diningBatchId'],
    where: { ...where, diningBatchId: { in: batches.map((batch) => batch.id) }, status: 'PENDING_PAYMENT', saleType: 'SALE' },
    _sum: { lineAmount: true },
  })
  const unpaidByMeal = new Map<string, Prisma.Decimal>()
  for (const row of unpaidRows) {
    const mealId = row.diningBatchId ? mealIdByBatch.get(row.diningBatchId) : undefined
    if (!mealId) continue
    unpaidByMeal.set(mealId, (unpaidByMeal.get(mealId) ?? new Prisma.Decimal(0)).add(row._sum.lineAmount ?? 0))
  }
  const mealByTable = new Map(meals.map((meal) => [meal.tableId, meal]))
  const kindById = new Map(batches.map((batch) => [batch.id, batch.kind]))
  const voidSubject = (batch: typeof batches[number]) => (batch.kind === 'RENOTIFY' ? kindById.get(batch.refBatchId ?? '') : batch.kind) === 'VOID'
  return tables.map((table) => {
    const meal = mealByTable.get(table.id)
    const mealBatches = meal ? batches.filter((batch) => batch.mealId === meal.id) : []
    return {
      id: table.id,
      name: table.name,
      areaKind: table.areaKind,
      isActive: table.isActive,
      sortOrder: table.sortOrder,
      meal: meal ? {
        mealId: meal.id,
        state: meal.state as 'OPEN' | 'PAID',
        guestCount: meal.guestCount,
        openedAt: meal.createdAt.toISOString(),
        billNo: meal.billNo,
        unpaidAmount: money(unpaidByMeal.get(meal.id) ?? 0),
        batchCount: mealBatches.length,
        // Counted however old: a notice nobody took still has not gone out, whether the bill then offers "send" or "send again".
        pendingNoticeCount: mealBatches.filter((batch) => batch.noticeRequired && !batch.noticeClaimedAt && !batch.noticeWithdrawnAt
          && diningNoticeDeliverable(meal.state === 'OPEN', voidSubject(batch) ? 'VOID' : 'ORDER')).length,
      } : null,
    }
  })
}

const RECOVERABLE_PAGE_DEFAULT = 20
const RECOVERABLE_PAGE_MAX = 50

/**
 * In SQL, the same question the bill view answers in TypeScript (noSendEvidence().voidSeqs
 * non-empty): an ended meal has a void batch that needs a notice, and neither that
 * batch nor any manual re-notification of it has a print job row that says "printed".
 *
 * The job key and the "printed" condition repeat canonicalV3OriginalPrintJobId and the
 * PRINTED branch of classifyV3OperatorPrintJob, because a list that is paged and an
 * existence check must both be answered by the database, without a time window and
 * without reading every meal. tests/dine-in-m1-db.test.ts holds the two forms against
 * each other. Read only.
 */
function recoverableMealCondition(scope: DiningScope): Prisma.Sql {
  return Prisma.sql`
    m."tenantId" = ${scope.tenantId} AND m."storeId" = ${scope.storeId} AND m."state" IN ('CLOSED', 'VOIDED')
    AND EXISTS (
      SELECT 1 FROM "DiningBatch" v
      WHERE v."mealId" = m."id" AND v."kind" = 'VOID' AND v."noticeRequired"
        AND NOT EXISTS (
          SELECT 1 FROM "DiningBatch" c
          JOIN "EshopTrayPrintJob" j
            ON j."tenantId" = m."tenantId" AND j."storeId" = m."storeId"
           AND j."idempotencyKey" = 'network:' || encode(sha256(convert_to('cashier-network-v2:' || m."billNo" || '.' || c."seq" || ':KITCHEN', 'UTF8')), 'hex')
          WHERE c."mealId" = m."id" AND (c."id" = v."id" OR (c."kind" = 'RENOTIFY' AND c."refBatchId" = v."id"))
            AND c."noticeClaimedAt" IS NOT NULL
            AND j."schemaVersion" = 3 AND j."status" = 'SUCCEEDED' AND j."resultStatus" = 'CROSSED' AND j."effectBoundary" = 'CROSSED'
            AND j."completedAt" IS NOT NULL AND j."resultCode" IS NOT NULL AND j."resultCode" <> ''
        )
    )`
}

/** `endedAt` is the instant as the database holds it, already formatted as a UTC ISO string with milliseconds. */
function encodeRecoverCursor(endedAt: string, mealId: string): string {
  return Buffer.from(JSON.stringify([endedAt, mealId]), 'utf8').toString('base64url')
}

function decodeRecoverCursor(value: unknown): { endedAt: string; mealId: string } | null {
  if (value === undefined || value === null || value === '') return null
  try {
    if (typeof value !== 'string' || value.length > 400) throw new Error('shape')
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string') throw new Error('shape')
    // Exactly what encodeRecoverCursor writes: a four-digit-year UTC instant with milliseconds, and an id without odd characters.
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(parsed[0]) || new Date(parsed[0]).toISOString() !== parsed[0]) throw new Error('time')
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(parsed[1])) throw new Error('id')
    return { endedAt: parsed[0], mealId: parsed[1] }
  } catch {
    throw new DiningCommandError('RECOVER_CURSOR_INVALID', 400)
  }
}

/**
 * Ended meals that still have a void notice with no sending evidence: never taken, or
 * taken without a print job row that says "printed". No time window: such a meal stays
 * reachable until the evidence exists. One bounded page per call, newest first; the
 * cursor continues exactly after the last item, so nothing is skipped or repeated when
 * the list changes between calls. Read only; it is the way back to such a meal once its
 * table is free.
 */
export async function listRecoverableMeals(db: Db, scope: DiningScope, input: { cursor?: unknown; limit?: unknown } = {}): Promise<DiningRecoverablePage> {
  const after = decodeRecoverCursor(input.cursor)
  const limit = typeof input.limit === 'number' && Number.isInteger(input.limit) && input.limit >= 1
    ? Math.min(input.limit, RECOVERABLE_PAGE_MAX)
    : RECOVERABLE_PAGE_DEFAULT
  return db.$transaction(async (tx) => {
    // "endedAt" is stored as UTC without a zone; the cursor carries the same instant as text.
    const position = after
      ? Prisma.sql`AND (m."endedAt", m."id") < (${after.endedAt.replace('Z', '')}::timestamp, ${after.mealId})`
      : Prisma.empty
    const rows = await tx.$queryRaw<{ id: string; endedAt: string }[]>`
      SELECT m."id", to_char(m."endedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "endedAt" FROM "DiningMeal" m
      WHERE ${recoverableMealCondition(scope)} ${position}
      ORDER BY m."endedAt" DESC, m."id" DESC
      LIMIT ${limit + 1}`
    const pageRows = rows.slice(0, limit)
    const pageIds = pageRows.map((row) => row.id)
    const now = await databaseNow(tx)
    const meals = pageIds.length === 0 ? [] : await tx.diningMeal.findMany({
      where: { id: { in: pageIds }, tenantId: scope.tenantId, storeId: scope.storeId },
      include: { table: true },
    })
    const mealById = new Map(meals.map((meal) => [meal.id, meal]))
    const items: DiningRecoverableMeal[] = []
    for (const id of pageIds) {
      const meal = mealById.get(id)
      if (!meal || !meal.endedAt) continue
      const voidNoticeSeqs = noSendEvidence(await loadGraph(tx, scope, meal, now)).voidSeqs
      // Sending evidence that arrived between the two reads: the meal has nothing left to do, so it is not shown.
      if (voidNoticeSeqs.length === 0) continue
      items.push({
        mealId: meal.id, state: meal.state as 'CLOSED' | 'VOIDED', tableName: meal.table.name, billNo: meal.billNo,
        endedAt: meal.endedAt.toISOString(), voidNoticeSeqs,
      })
    }
    // The cursor is the position of the last row the database returned for this page, whatever was shown of it.
    const hasMore = rows.length > limit
    const last = pageRows.at(-1)
    return { items, hasMore, nextCursor: hasMore && last ? encodeRecoverCursor(last.endedAt, last.id) : null }
  }, TX_OPTIONS)
}

/** Whether any ended meal is waiting in the recovery list. Asked of the database directly, not of a page of the list. */
export async function hasRecoverableMeals(db: Db, scope: DiningScope): Promise<boolean> {
  const rows = await db.$queryRaw<{ found: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM "DiningMeal" m WHERE ${recoverableMealCondition(scope)}) AS "found"`
  return rows[0]?.found === true
}

/**
 * Whether the dine-in page still has something for a person to do: a meal on a table,
 * or an ended meal with a void notice that has no sending evidence. This keeps the way
 * into the page open when new business is switched off.
 */
export async function hasActiveMeals(db: Db, scope: DiningScope): Promise<boolean> {
  const meal = await db.diningMeal.findFirst({
    where: { tenantId: scope.tenantId, storeId: scope.storeId, state: { in: ['OPEN', 'PAID'] } },
    select: { id: true },
  })
  if (meal !== null) return true
  // If the question cannot be answered, the way into the page stays open; hiding it could strand a void notice.
  return hasRecoverableMeals(db, scope).catch((error) => { console.error('[dine-in] recovery check unavailable', error); return true })
}

function tableName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : ''
  if (name.length < 1 || name.length > 40) throw new DiningCommandError('TABLE_NAME_INVALID', 400)
  return name
}

function areaKind(value: unknown): 'HALL' | 'ROOM' {
  if (value !== 'HALL' && value !== 'ROOM') throw new DiningCommandError('TABLE_AREA_INVALID', 400)
  return value
}

function sortOrder(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 9999) {
    throw new DiningCommandError('TABLE_SORT_INVALID', 400)
  }
  return value
}

/** OWNER table maintenance: add, rename, hall/room, order, enable/disable. */
export async function saveTable(db: Db, scope: DiningScope, actor: DiningActor, input: {
  tableId?: unknown
  name?: unknown
  areaKind?: unknown
  sortOrder?: unknown
  isActive?: unknown
}): Promise<DiningTableView> {
  if (actor.role !== 'OWNER') throw new DiningCommandError('OWNER_REQUIRED', 403)
  try {
    const table = await transact(db, async (tx) => {
      if (input.tableId === undefined) {
        const created = await tx.diningTable.create({
          data: {
            tenantId: scope.tenantId,
            storeId: scope.storeId,
            name: tableName(input.name),
            areaKind: input.areaKind === undefined ? 'HALL' : areaKind(input.areaKind),
            sortOrder: input.sortOrder === undefined ? 0 : sortOrder(input.sortOrder),
          },
        })
        await audit(tx, scope, actor, { actionType: 'DINE_IN_TABLE_CREATE', targetType: 'DiningTable', targetId: created.id, payload: { name: created.name, areaKind: created.areaKind } })
        return created
      }
      const current = await lockTable(tx, scope, String(input.tableId))
      const data: Prisma.DiningTableUpdateInput = {}
      if (input.name !== undefined) data.name = tableName(input.name)
      if (input.areaKind !== undefined) data.areaKind = areaKind(input.areaKind)
      if (input.sortOrder !== undefined) data.sortOrder = sortOrder(input.sortOrder)
      if (input.isActive !== undefined) {
        if (typeof input.isActive !== 'boolean') throw new DiningCommandError('TABLE_ACTIVE_INVALID', 400)
        if (!input.isActive) {
          // Opening a meal locks the same table row first, so this check cannot race it.
          const active = await tx.diningMeal.findFirst({ where: { tableId: current.id, state: { in: ['OPEN', 'PAID'] } }, select: { id: true } })
          if (active) throw new DiningCommandError('TABLE_OCCUPIED', 409, { mealId: active.id })
        }
        data.isActive = input.isActive
      }
      const updated = await tx.diningTable.update({ where: { id: current.id }, data })
      await audit(tx, scope, actor, { actionType: 'DINE_IN_TABLE_UPDATE', targetType: 'DiningTable', targetId: updated.id, payload: { name: updated.name, areaKind: updated.areaKind, sortOrder: updated.sortOrder, isActive: updated.isActive } })
      return updated
    })
    return { id: table.id, name: table.name, areaKind: table.areaKind, isActive: table.isActive, sortOrder: table.sortOrder, meal: null }
  } catch (error) {
    if (isUniqueViolation(error) || (error instanceof DiningCommandError && error.code === 'BUSY_RETRY_SAME_REQUEST')) {
      throw new DiningCommandError('TABLE_NAME_TAKEN', 409)
    }
    throw error
  }
}

// ── Open ────────────────────────────────────────────────────────────────────

export type OpenMealResult = { mealId: string; tableId: string; state: string; version: number; replayed: boolean }

/**
 * `newBusinessBlockers` are the unmet new-business conditions the route computed.
 * They are applied only after the request-key lookup, so a request that already
 * committed still gets its earlier result when the gate has closed since.
 */
function requireNewBusiness(blockers: readonly string[] | undefined) {
  if (blockers && blockers.length > 0) throw new DiningCommandError('DINE_IN_NEW_BUSINESS_UNAVAILABLE', 403, { reasons: blockers })
}

export async function openMeal(db: Db, scope: DiningScope, actor: DiningActor, input: {
  tableId: unknown
  guestCount: unknown
  note?: unknown
  requestKey: unknown
  newBusinessBlockers?: readonly string[]
}): Promise<OpenMealResult> {
  const requestKey = requireRequestKey(input.requestKey)
  const tableId = typeof input.tableId === 'string' ? input.tableId : ''
  const guestCount = input.guestCount
  if (typeof guestCount !== 'number' || !Number.isInteger(guestCount) || guestCount < 1 || guestCount > 999) {
    throw new DiningCommandError('GUEST_COUNT_INVALID', 400)
  }
  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 200) : null
  const digest = requestDigest({ tableId, guestCount, note })

  const replay = async (client: Db | Tx): Promise<OpenMealResult | null> => {
    const existing = await client.diningMeal.findUnique({
      where: { tenantId_storeId_openRequestKey: { tenantId: scope.tenantId, storeId: scope.storeId, openRequestKey: requestKey } },
    })
    if (!existing) return null
    if (existing.openRequestDigest !== digest) throw new DiningCommandError('REQUEST_KEY_REUSED', 409)
    return { mealId: existing.id, tableId: existing.tableId, state: existing.state, version: existing.version, replayed: true }
  }
  const occupied = async (client: Db | Tx) => {
    const active = await client.diningMeal.findFirst({
      where: { tenantId: scope.tenantId, storeId: scope.storeId, tableId, state: { in: ['OPEN', 'PAID'] } },
      select: { id: true, state: true },
    })
    return active ? new DiningCommandError('TABLE_OCCUPIED', 409, { mealId: active.id, state: active.state }) : null
  }

  try {
    return await db.$transaction(async (tx) => {
      // Same key, same content: the earlier result, whatever state that meal is in now.
      const earlier = await replay(tx)
      if (earlier) return earlier
      requireNewBusiness(input.newBusinessBlockers)
      const table = await lockTable(tx, scope, tableId)
      const afterLock = await replay(tx)
      if (afterLock) return afterLock
      if (!table.isActive) throw new DiningCommandError('TABLE_INACTIVE', 409)
      const taken = await occupied(tx)
      if (taken) throw taken
      const meal = await tx.diningMeal.create({
        data: {
          tenantId: scope.tenantId,
          storeId: scope.storeId,
          tableId: table.id,
          guestCount,
          note,
          openedByUserId: actor.userId,
          openRequestKey: requestKey,
          openRequestDigest: digest,
        },
      })
      await audit(tx, scope, actor, { actionType: 'DINE_IN_OPEN', targetType: 'DiningMeal', targetId: meal.id, requestId: requestKey, payload: { tableId: table.id, tableName: table.name, guestCount } })
      return { mealId: meal.id, tableId: meal.tableId, state: meal.state, version: meal.version, replayed: false }
    }, TX_OPTIONS)
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    // Lost a race the row lock could not see (same key on another table, or the
    // partial unique index). The committed winner decides the answer.
    const winner = await replay(db)
    if (winner) return winner
    throw (await occupied(db)) ?? new DiningCommandError('BUSY_RETRY_SAME_REQUEST', 409)
  }
}

// ── Order batch ─────────────────────────────────────────────────────────────

export type OrderItem = { barcode: string; quantity: number }

function orderItems(value: unknown): OrderItem[] {
  if (!Array.isArray(value) || value.length === 0) throw new DiningCommandError('ORDER_ITEMS_REQUIRED', 400)
  const merged = new Map<string, number>()
  for (const entry of value) {
    const row = entry as { barcode?: unknown; quantity?: unknown } | null
    const barcode = typeof row?.barcode === 'string' ? row.barcode.trim() : ''
    const quantity = row?.quantity
    if (!barcode || typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) {
      throw new DiningCommandError('ORDER_ITEM_INVALID', 400)
    }
    merged.set(barcode, (merged.get(barcode) ?? 0) + quantity)
  }
  const items = [...merged].map(([barcode, quantity]) => ({ barcode, quantity })).sort((a, b) => (a.barcode < b.barcode ? -1 : 1))
  if (items.length > MAX_LINES_PER_BATCH || items.some((item) => item.quantity > MAX_QUANTITY)) {
    throw new DiningCommandError('ORDER_ITEM_INVALID', 400)
  }
  return items
}

export type BatchResult = { batchId: string; seq: number; replayed: boolean; meal: DiningMealView }

async function replayBatch(tx: Tx, meal: MealRow, kind: BatchRow['kind'], requestKey: string, digest: string) {
  const existing = await tx.diningBatch.findUnique({ where: { mealId_requestKey: { mealId: meal.id, requestKey } } })
  if (!existing) return null
  if (existing.kind !== kind || existing.requestDigest !== digest) throw new DiningCommandError('REQUEST_KEY_REUSED', 409)
  return existing
}

async function nextSeq(tx: Tx, mealId: string): Promise<number> {
  const last = await tx.diningBatch.aggregate({ where: { mealId }, _max: { seq: true } })
  return (last._max.seq ?? 0) + 1
}

export async function addOrderBatch(db: Db, scope: DiningScope, actor: DiningActor, input: {
  store: { code: string; printKitchenTicket: boolean }
  mealId: string
  requestKey: unknown
  items: unknown
  newBusinessBlockers?: readonly string[]
}): Promise<BatchResult> {
  const requestKey = requireRequestKey(input.requestKey)
  const items = orderItems(input.items)
  const digest = requestDigest({ items })

  return transact(db, async (tx) => {
    const meal = await lockMeal(tx, scope, input.mealId)
    const earlier = await replayBatch(tx, meal, 'ORDER', requestKey, digest)
    if (earlier) return { batchId: earlier.id, seq: earlier.seq, replayed: true, meal: await buildView(tx, scope, meal) }
    requireNewBusiness(input.newBusinessBlockers)
    if (meal.state !== 'OPEN') throw new DiningCommandError('MEAL_NOT_OPEN', 409, { state: meal.state })
    // A bill that already has a payment row must not grow: the new rows could never be settled here.
    const foreign = await externalPayment(tx, meal)
    if (foreign) throw new DiningCommandError('EXTERNAL_PAYMENT_EXISTS', 409, { paymentIntentId: foreign.id, status: foreign.status })

    // Prices, names and the kitchen flag come from the product table, never from the page.
    const products = await tx.product.findMany({
      where: { tenantId: scope.tenantId, barcode: { in: items.map((item) => item.barcode) }, status: 'ACTIVE' },
    })
    const productByBarcode = new Map(products.map((product) => [product.barcode, product]))
    const missing = items.find((item) => !productByBarcode.has(item.barcode))
    if (missing) throw new DiningCommandError('PRODUCT_NOT_FOUND', 404, { barcode: missing.barcode })

    // Serialises dine-in orders of one store against each other while record
    // numbers are taken. A collision with the cashier is still possible and is
    // handled by rolling back and retrying the whole transaction.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`dine-in-record-no:${scope.storeId}`}))`

    const seq = await nextSeq(tx, meal.id)
    const batch = await tx.diningBatch.create({
      data: {
        tenantId: scope.tenantId, storeId: scope.storeId, mealId: meal.id, seq, kind: 'ORDER',
        requestKey, requestDigest: digest, operatorUserId: actor.userId,
      },
    })
    let billNo = meal.billNo
    const kitchenLineIds: string[] = []
    for (const item of items) {
      const product = productByBarcode.get(item.barcode)!
      const recordNo = await generateRecordNo(tx, 'S', scope.tenantId, scope.storeId, input.store.code)
      billNo ??= recordNo
      const sale = await tx.saleRecord.create({
        data: {
          tenantId: scope.tenantId,
          storeId: scope.storeId,
          operatorUserId: actor.userId,
          recordNo,
          orderNo: billNo,
          saleType: 'SALE',
          status: 'PENDING_PAYMENT',
          productId: product.id,
          barcode: product.barcode,
          productNameSnapshot: product.name,
          specSnapshot: product.spec ?? null,
          unitPrice: product.sellPrice,
          quantity: item.quantity,
          lineAmount: product.sellPrice.mul(item.quantity),
          remark: '堂食',
          diningBatchId: batch.id,
        },
      })
      if (input.store.printKitchenTicket && product.printKitchenTicket) kitchenLineIds.push(sale.id)
    }
    await tx.diningBatch.update({
      where: { id: batch.id },
      data: { kitchenLineIds, noticeRequired: kitchenLineIds.length > 0 },
    })
    const updated = await tx.diningMeal.update({
      where: { id: meal.id },
      data: { billNo, version: { increment: 1 } },
      include: { table: true },
    })
    await audit(tx, scope, actor, { actionType: 'DINE_IN_ORDER', targetType: 'DiningBatch', targetId: batch.id, requestId: requestKey, payload: { mealId: meal.id, seq, lineCount: items.length, billNo } })
    return { batchId: batch.id, seq, replayed: false, meal: await buildView(tx, scope, updated) }
  })
}

// ── Void lines (before settlement, whole lines only) ────────────────────────

export async function voidLines(db: Db, scope: DiningScope, actor: DiningActor, input: {
  mealId: string
  requestKey: unknown
  lines: unknown
  reason: unknown
  /** The operator states they told the kitchen in person. Required when the kitchen's knowledge is unknown. */
  kitchenConfirmed?: unknown
}): Promise<BatchResult> {
  if (actor.role !== 'OWNER') throw new DiningCommandError('OWNER_REQUIRED', 403)
  const requestKey = requireRequestKey(input.requestKey)
  const why = reason(input.reason)
  if (!Array.isArray(input.lines) || input.lines.length === 0 || input.lines.length > MAX_LINES_PER_BATCH) {
    throw new DiningCommandError('VOID_LINES_REQUIRED', 400)
  }
  const targets = input.lines.map((entry) => {
    const row = entry as { saleRecordId?: unknown; quantity?: unknown } | null
    if (typeof row?.saleRecordId !== 'string' || !row.saleRecordId || typeof row.quantity !== 'number' || !(row.quantity > 0)) {
      throw new DiningCommandError('VOID_LINE_INVALID', 400)
    }
    return { saleRecordId: row.saleRecordId, quantity: row.quantity }
  }).sort((a, b) => (a.saleRecordId < b.saleRecordId ? -1 : 1))
  if (new Set(targets.map((target) => target.saleRecordId)).size !== targets.length) throw new DiningCommandError('VOID_LINE_INVALID', 400)
  const kitchenConfirmed = input.kitchenConfirmed === true
  const digest = requestDigest({ lines: targets, reason: why, kitchenConfirmed })
  const targetAudit = { actionType: 'DINE_IN_VOID_LINES', targetType: 'DiningMeal', targetId: String(input.mealId), requestId: requestKey }

  return transact(db, async (tx) => {
    const meal = await lockMeal(tx, scope, input.mealId)
    const earlier = await replayBatch(tx, meal, 'VOID', requestKey, digest)
    if (earlier) return { batchId: earlier.id, seq: earlier.seq, replayed: true, meal: await buildView(tx, scope, meal) }
    if (meal.state !== 'OPEN') throw new DiningCommandError('MEAL_NOT_OPEN', 409, { state: meal.state })
    if (!meal.billNo) throw new DiningCommandError('VOID_LINE_NOT_FOUND', 404)
    // Money that was taken, or is being taken, for this bill outside the dine-in page covers
    // these very lines: nothing is voided under it. A payment attempt that ended without
    // money (cancelled, failed, expired) changes nothing here.
    const foreign = await externalPayment(tx, meal)
    if (foreign && (foreign.status === 'PAID' || foreign.status === 'PENDING')) {
      throw new DiningCommandError('EXTERNAL_PAYMENT_EXISTS', 409, { paymentIntentId: foreign.id, status: foreign.status }, { ...targetAudit, payload: { paymentIntentId: foreign.id, status: foreign.status } })
    }

    const graph = await loadGraph(tx, scope, meal)
    // Looked up without the meal filter on purpose: a row of another meal, store or
    // tenant must be refused explicitly, not silently skipped.
    const rows = await tx.saleRecord.findMany({ where: { id: { in: targets.map((target) => target.saleRecordId) } } })
    const rowById = new Map(rows.map((row) => [row.id, row]))
    const batchById = new Map(graph.batches.map((batch) => [batch.id, batch]))
    const needsConfirmation: string[] = []
    const plan = targets.map((target) => {
      const row = rowById.get(target.saleRecordId)
      if (!row || row.tenantId !== scope.tenantId || row.storeId !== scope.storeId) {
        throw new DiningCommandError('VOID_LINE_NOT_FOUND', 404, { saleRecordId: target.saleRecordId })
      }
      const original = row.diningBatchId ? batchById.get(row.diningBatchId) : undefined
      if (row.orderNo !== meal.billNo || !original || original.kind !== 'ORDER') {
        throw new DiningCommandError('VOID_LINE_NOT_IN_MEAL', 409, { saleRecordId: row.id })
      }
      if (row.saleType !== 'SALE' || row.status !== 'PENDING_PAYMENT') {
        throw new DiningCommandError('VOID_LINE_NOT_VOIDABLE', 409, { saleRecordId: row.id, status: row.status })
      }
      if (!new Prisma.Decimal(target.quantity).equals(row.quantity)) {
        throw new DiningCommandError('PARTIAL_VOID_NOT_SUPPORTED', 409, { saleRecordId: row.id, quantity: Number(row.quantity) })
      }
      const kitchenLine = original.kitchenLineIds.includes(row.id)
      const awareness = kitchenLine ? awarenessOf(graph, original) : 'NEVER_TOLD'
      if (awareness === 'UNKNOWN') needsConfirmation.push(row.id)
      return {
        row,
        original,
        originalNoticeClaimed: kitchenLine && original.noticeClaimedAt !== null,
        // The kitchen is told about a void only if it may hold the dish on a ticket.
        tellKitchen: awareness === 'SENT' || awareness === 'UNKNOWN',
      }
    })
    if (needsConfirmation.length > 0 && !kitchenConfirmed) {
      throw new DiningCommandError('KITCHEN_CONFIRMATION_REQUIRED', 409, { saleRecordIds: needsConfirmation }, { ...targetAudit, payload: { saleRecordIds: needsConfirmation } })
    }

    const seq = await nextSeq(tx, meal.id)
    const tellKitchenIds = plan.filter((entry) => entry.tellKitchen).map((entry) => entry.row.id)
    const batch = await tx.diningBatch.create({
      data: {
        tenantId: scope.tenantId, storeId: scope.storeId, mealId: meal.id, seq, kind: 'VOID',
        requestKey, requestDigest: digest, operatorUserId: actor.userId, reason: why,
        kitchenLineIds: tellKitchenIds, noticeRequired: tellKitchenIds.length > 0,
      },
    })
    await tx.diningVoidLine.createMany({
      data: plan.map((entry) => ({
        tenantId: scope.tenantId,
        storeId: scope.storeId,
        mealId: meal.id,
        voidBatchId: batch.id,
        saleRecordId: entry.row.id,
        originalBatchId: entry.original.id,
        quantity: entry.row.quantity,
        originalNoticeClaimed: entry.originalNoticeClaimed,
      })),
    })
    const cancelled = await tx.saleRecord.updateMany({
      where: {
        id: { in: plan.map((entry) => entry.row.id) },
        tenantId: scope.tenantId, storeId: scope.storeId, orderNo: meal.billNo,
        saleType: 'SALE', status: 'PENDING_PAYMENT',
      },
      data: { status: 'CANCELLED' },
    })
    if (cancelled.count !== plan.length) throw new Error('DINE_IN_VOID_ROW_COUNT_MISMATCH')
    // A legacy checkout does not take the meal lock. One that committed since the check above is visible now;
    // the whole void is then rolled back.
    const appeared = await externalPayment(tx, meal)
    if (appeared && (appeared.status === 'PAID' || appeared.status === 'PENDING')) {
      throw new DiningCommandError('EXTERNAL_PAYMENT_EXISTS', 409, { paymentIntentId: appeared.id, status: appeared.status }, { ...targetAudit, payload: { paymentIntentId: appeared.id, status: appeared.status } })
    }

    // An order notice nobody has taken yet, whose kitchen lines are now all gone,
    // will never be printed.
    const voidedIds = new Set(plan.map((entry) => entry.row.id))
    for (const original of new Set(plan.map((entry) => entry.original))) {
      if (!original.noticeRequired || original.noticeClaimedAt || original.noticeWithdrawnAt) continue
      const left = original.kitchenLineIds.filter((id) => !voidedIds.has(id) && graph.salesById.get(id)?.status === 'PENDING_PAYMENT')
      if (left.length === 0) {
        await tx.diningBatch.updateMany({
          where: { id: original.id, noticeClaimedAt: null, noticeWithdrawnAt: null },
          data: { noticeWithdrawnAt: new Date() },
        })
      }
    }
    const updated = await tx.diningMeal.update({ where: { id: meal.id }, data: { version: { increment: 1 } }, include: { table: true } })
    await audit(tx, scope, actor, { ...targetAudit, targetType: 'DiningBatch', targetId: batch.id, payload: { mealId: meal.id, seq, saleRecordIds: plan.map((entry) => entry.row.id), reason: why, kitchenConfirmedInPerson: kitchenConfirmed, kitchenNoticeLines: tellKitchenIds.length } })
    return { batchId: batch.id, seq, replayed: false, meal: await buildView(tx, scope, updated) }
  })
}

// ── Manual re-notification (a new batch, hence a new print identity) ────────

export async function renotifyBatch(db: Db, scope: DiningScope, actor: DiningActor, input: {
  mealId: string
  refBatchId: string
  requestKey: unknown
  reason: unknown
  /** The operator accepts that the kitchen may end up with two tickets. */
  duplicateRiskAccepted?: unknown
}): Promise<BatchResult> {
  const requestKey = requireRequestKey(input.requestKey)
  const why = reason(input.reason)
  const duplicateRiskAccepted = input.duplicateRiskAccepted === true
  const digest = requestDigest({ refBatchId: input.refBatchId, reason: why, duplicateRiskAccepted })
  const targetAudit = { actionType: 'DINE_IN_RENOTIFY', targetType: 'DiningBatch', targetId: String(input.refBatchId), requestId: requestKey }

  return transact(db, async (tx) => {
    const meal = await lockMeal(tx, scope, input.mealId)
    const earlier = await replayBatch(tx, meal, 'RENOTIFY', requestKey, digest)
    if (earlier) return { batchId: earlier.id, seq: earlier.seq, replayed: true, meal: await buildView(tx, scope, meal) }

    const graph = await loadGraph(tx, scope, meal)
    const ref = graph.batches.find((batch) => batch.id === input.refBatchId)
    if (!ref) throw new DiningCommandError('BATCH_NOT_FOUND', 404)
    // Never a re-notification of a re-notification: each one is asked for by a person.
    if (ref.kind === 'RENOTIFY' || !ref.noticeRequired) throw new DiningCommandError('RENOTIFY_TARGET_INVALID', 409)
    // Once the meal is paid, cleared or voided nothing new is sent for cooking; a void
    // notice can still be sent again.
    if (!diningNoticeDeliverable(meal.state === 'OPEN', ref.kind === 'VOID' ? 'VOID' : 'ORDER')) {
      throw new DiningCommandError('MEAL_NOT_OPEN', 409, { state: meal.state })
    }
    const chainStatuses = chainOf(graph, ref).map((entry) => graph.status.get(entry.id)!)
    const awareness = kitchenAwareness(chainStatuses)
    // Nothing has been handed to a page yet: the first submit is still available.
    if (awareness === 'NEVER_TOLD') throw new DiningCommandError('NOTICE_NOT_SUBMITTED_YET', 409, { status: graph.status.get(ref.id) })
    // One manual re-notification at a time; a click is one batch is one submit.
    if (chainStatuses.includes('PENDING_SUBMIT')) throw new DiningCommandError('RENOTIFY_ALREADY_PENDING', 409)
    if (noticeLines(graph, ref).length === 0) throw new DiningCommandError('NOTHING_TO_RENOTIFY', 409)
    if (awareness !== 'NOT_SENT' && !duplicateRiskAccepted) {
      throw new DiningCommandError('DUPLICATE_RISK_NOT_ACCEPTED', 409, { awareness }, { ...targetAudit, payload: { awareness } })
    }

    const seq = await nextSeq(tx, meal.id)
    const batch = await tx.diningBatch.create({
      data: {
        tenantId: scope.tenantId, storeId: scope.storeId, mealId: meal.id, seq, kind: 'RENOTIFY',
        requestKey, requestDigest: digest, operatorUserId: actor.userId, reason: why,
        refBatchId: ref.id, noticeRequired: true,
      },
    })
    await audit(tx, scope, actor, { ...targetAudit, targetId: batch.id, payload: { mealId: meal.id, seq, refBatchId: ref.id, refSeq: ref.seq, reason: why, awareness, duplicateRiskAccepted, mealState: meal.state } })
    return { batchId: batch.id, seq, replayed: false, meal: await buildView(tx, scope, meal) }
  })
}

// ── Kitchen notice: claim once, report once ─────────────────────────────────

export type ClaimNoticeResult =
  | { claimed: true; notice: DiningKitchenNotice; meal: DiningMealView }
  | { claimed: false; status: DiningNoticeStatus; meal: DiningMealView }

/**
 * Hands the printable content of one notice to exactly one caller. The content is
 * computed here, under the meal lock, from the rows that are still valid at this
 * instant; voids take the same lock, so a voided dish can never be on it. A second
 * call gets the status and no content, and so does a call for a notice that has gone
 * stale: its identity is not handed out any more.
 */
export async function claimNotice(db: Db, scope: DiningScope, actor: DiningActor, input: {
  mealId: string
  batchId: unknown
}): Promise<ClaimNoticeResult> {
  return transact(db, async (tx) => {
    const meal = await lockMeal(tx, scope, input.mealId)
    const graph = await loadGraph(tx, scope, meal)
    const batch = graph.batches.find((entry) => entry.id === input.batchId)
    if (!batch) throw new DiningCommandError('BATCH_NOT_FOUND', 404)
    const status = graph.status.get(batch.id)!
    if (status !== 'PENDING_SUBMIT') return { claimed: false as const, status, meal: await buildView(tx, scope, meal) }

    const lines = noticeLines(graph, batch)
    if (lines.length === 0) {
      await tx.diningBatch.updateMany({ where: { id: batch.id, noticeClaimedAt: null, noticeWithdrawnAt: null }, data: { noticeWithdrawnAt: new Date() } })
      return { claimed: false as const, status: 'WITHDRAWN' as const, meal: await buildView(tx, scope, meal) }
    }
    const printOrderNo = diningNoticePrintOrderNo(meal.billNo ?? '', batch.seq)
    if (!meal.billNo || !PRINT_ORDER_NO_PATTERN.test(printOrderNo)) throw new DiningCommandError('PRINT_IDENTITY_INVALID', 409)

    const ref = batch.refBatchId ? graph.batches.find((entry) => entry.id === batch.refBatchId) ?? null : null
    const claimedAt = new Date()
    const content: DiningKitchenNotice['content'] = {
      kind: batch.kind,
      subject: (ref ?? batch).kind === 'VOID' ? 'VOID' : 'ORDER',
      seq: batch.seq,
      refSeq: ref?.seq ?? null,
      billNo: meal.billNo,
      tableName: meal.table.name,
      areaKind: meal.table.areaKind,
      guestCount: meal.guestCount,
      createdAt: batch.createdAt.toISOString(),
      lines: lines.map((line) => ({ saleRecordId: line.id, name: line.productNameSnapshot, spec: line.specSnapshot, quantity: Number(line.quantity) })),
    }
    const won = await tx.diningBatch.updateMany({
      where: { id: batch.id, noticeClaimedAt: null, noticeWithdrawnAt: null },
      data: { noticeClaimedAt: claimedAt, noticeClaimedByUserId: actor.userId, noticeContentDigest: requestDigest(content) },
    })
    if (won.count !== 1) throw new Error('DINE_IN_NOTICE_CLAIM_RACE')
    await audit(tx, scope, actor, { actionType: 'DINE_IN_NOTICE_CLAIM', targetType: 'DiningBatch', targetId: batch.id, payload: { mealId: meal.id, seq: batch.seq, kind: batch.kind, lineCount: lines.length, printOrderNo, mealState: meal.state } })
    return {
      claimed: true as const,
      notice: {
        batchId: batch.id,
        printOrderNo,
        printJobId: canonicalV3OriginalPrintJobId(printOrderNo, 'KITCHEN'),
        role: 'KITCHEN' as const,
        // The window belongs to the batch: an identity taken late does not live longer for it.
        expiresAt: new Date(batch.createdAt.getTime() + DINING_NOTICE_TTL_MS).toISOString(),
        content,
      },
      meal: await buildView(tx, scope, await tx.diningMeal.findUniqueOrThrow({ where: { id: meal.id }, include: { table: true } })),
    }
  })
}

/**
 * Records what the page says the print bridge returned. Written once; a hint for
 * the operator, never execution evidence.
 */
export async function reportNotice(db: Db, scope: DiningScope, actor: DiningActor, input: {
  mealId: string
  batchId: unknown
  outcome: unknown
}): Promise<{ recorded: boolean; meal: DiningMealView }> {
  if (!isDiningNoticeReportOutcome(input.outcome)) throw new DiningCommandError('NOTICE_OUTCOME_INVALID', 400)
  const outcome = input.outcome
  return transact(db, async (tx) => {
    const meal = await lockMeal(tx, scope, input.mealId)
    const batch = await tx.diningBatch.findFirst({ where: { id: String(input.batchId), mealId: meal.id, tenantId: scope.tenantId, storeId: scope.storeId } })
    if (!batch) throw new DiningCommandError('BATCH_NOT_FOUND', 404)
    if (!batch.noticeClaimedAt) throw new DiningCommandError('NOTICE_NOT_CLAIMED', 409)
    if (batch.noticeClaimedByUserId !== actor.userId) throw new DiningCommandError('NOTICE_CLAIMED_BY_ANOTHER_OPERATOR', 403)
    const written = await tx.diningBatch.updateMany({
      where: { id: batch.id, noticeReportedAt: null },
      data: { noticeReportedOutcome: outcome, noticeReportedAt: new Date() },
    })
    if (written.count === 1) {
      await audit(tx, scope, actor, { actionType: 'DINE_IN_NOTICE_REPORT', targetType: 'DiningBatch', targetId: batch.id, payload: { mealId: meal.id, seq: batch.seq, outcome } })
    }
    return { recorded: written.count === 1, meal: await buildView(tx, scope, meal) }
  })
}

// ── Settle ──────────────────────────────────────────────────────────────────

/**
 * Sequence numbers of batches whose kitchen notice no page has taken yet, that can
 * still be taken, and that would still print something.
 */
function unsentNoticeSeqs(graph: MealGraph): number[] {
  return graph.batches
    .filter((batch) => graph.status.get(batch.id) === 'PENDING_SUBMIT' && noticeLines(graph, batch).length > 0)
    .map((batch) => batch.seq)
}

/** See DiningMealView.noSendEvidence. */
function noSendEvidence(graph: MealGraph): { orderSeqs: number[]; voidSeqs: number[] } {
  const unconfirmed = (batch: BatchRow) => batch.noticeRequired && awarenessOf(graph, batch) !== 'SENT'
  return {
    orderSeqs: graph.batches
      .filter((batch) => batch.kind === 'ORDER' && unconfirmed(batch)
        && batch.kitchenLineIds.some((id) => { const row = graph.salesById.get(id); return row !== undefined && row.status !== 'CANCELLED' }))
      .map((batch) => batch.seq),
    voidSeqs: graph.batches.filter((batch) => batch.kind === 'VOID' && unconfirmed(batch)).map((batch) => batch.seq),
  }
}

/**
 * Settle and end keys are unique per store. A key that already belongs to another
 * meal is a different request, not a busy system.
 */
async function refuseKeyOfAnotherMeal(tx: Tx, scope: DiningScope, mealId: string, key: { settleRequestKey: string } | { endRequestKey: string }) {
  const other = await tx.diningMeal.findFirst({ where: { tenantId: scope.tenantId, storeId: scope.storeId, ...key, NOT: { id: mealId } }, select: { id: true } })
  if (other) throw new DiningCommandError('REQUEST_KEY_REUSED', 409)
}

export type SettleResult = {
  payment: DiningPaymentView
  replayed: boolean
  /** True when another request had already settled this meal; nothing was written. */
  alreadySettled: boolean
  /**
   * Never a reason to refuse a payment: DiningMealView.noSendEvidence as it stands once
   * the payment is recorded. Order batches in it will not be sent any more; void batches
   * can still be sent from the bill.
   */
  kitchenWarnings: { orderSeqs: number[]; voidSeqs: number[] }
  meal: DiningMealView
}

function settleResult(payment: DiningPaymentView, view: DiningMealView, flags: { replayed: boolean; alreadySettled: boolean }): SettleResult {
  return {
    payment, ...flags,
    kitchenWarnings: view.noSendEvidence,
    meal: view,
  }
}

export async function settleMeal(db: Db, scope: DiningScope, actor: DiningActor, input: {
  store: { currencyCode: string }
  mealId: string
  requestKey: unknown
  paymentMethod: unknown
  /** The amount the page showed the cashier, as the two-decimal string the server sent. */
  expectedAmount: unknown
  expectedVersion: unknown
  manualPaymentConfirmed?: unknown
  /** KHQR only: the store's configured provider, recorded the way the cashier records it. */
  khqrConfig?: { provider: string | null; merchantConfigId: string } | null
}): Promise<SettleResult> {
  const requestKey = requireRequestKey(input.requestKey)
  if (input.paymentMethod !== 'CASH' && input.paymentMethod !== 'KHQR') throw new DiningCommandError('PAYMENT_METHOD_INVALID', 400)
  const paymentMethod: DiningPaymentMethod = input.paymentMethod
  const expectedAmount = parseMoney(input.expectedAmount)
  if (!expectedAmount) throw new DiningCommandError('EXPECTED_AMOUNT_REQUIRED', 400)
  if (typeof input.expectedVersion !== 'number' || !Number.isInteger(input.expectedVersion)) {
    throw new DiningCommandError('EXPECTED_VERSION_REQUIRED', 400)
  }
  const expectedVersion = input.expectedVersion
  const manualPaymentConfirmed = input.manualPaymentConfirmed === true
  const digest = requestDigest({ paymentMethod, expectedAmount: money(expectedAmount), expectedVersion, manualPaymentConfirmed })
  const targetAudit = { actionType: 'DINE_IN_SETTLE', targetType: 'DiningMeal', targetId: String(input.mealId), requestId: requestKey }

  return transact(db, async (tx) => {
    const meal = await lockMeal(tx, scope, input.mealId)

    if (meal.settleRequestKey === requestKey) {
      if (meal.settleRequestDigest !== digest) throw new DiningCommandError('REQUEST_KEY_REUSED', 409)
      return settleResult((await paymentView(tx, meal))!, await buildView(tx, scope, meal), { replayed: true, alreadySettled: false })
    }
    if (meal.state === 'PAID' || meal.state === 'CLOSED') {
      // Settled by another request: report that one payment, collect nothing again.
      return settleResult((await paymentView(tx, meal))!, await buildView(tx, scope, meal), { replayed: false, alreadySettled: true })
    }
    if (meal.state !== 'OPEN') throw new DiningCommandError('MEAL_NOT_OPEN', 409, { state: meal.state })

    if (requiresCashierManualPaymentConfirmation(paymentMethod, manualPaymentConfirmed)) {
      throw new DiningCommandError('MANUAL_PAYMENT_CONFIRMATION_REQUIRED', 409)
    }
    if (paymentMethod === 'KHQR' && !isKhqrSupportedCurrency(input.store.currencyCode)) {
      throw new DiningCommandError('KHQR_UNSUPPORTED_CURRENCY', 422)
    }
    if (!meal.billNo) throw new DiningCommandError('NOTHING_TO_SETTLE', 409)
    await refuseKeyOfAnotherMeal(tx, scope, meal.id, { settleRequestKey: requestKey })

    const rows = await tx.saleRecord.findMany({
      where: { tenantId: scope.tenantId, storeId: scope.storeId, orderNo: meal.billNo, saleType: 'SALE', status: 'PENDING_PAYMENT' },
      select: { id: true, lineAmount: true, diningBatchId: true },
    })
    if (rows.length === 0) throw new DiningCommandError('NOTHING_TO_SETTLE', 409)
    const ownBatches = new Set((await tx.diningBatch.findMany({ where: { mealId: meal.id, kind: 'ORDER' }, select: { id: true } })).map((batch) => batch.id))
    if (rows.some((row) => !row.diningBatchId || !ownBatches.has(row.diningBatchId))) throw new Error('DINE_IN_FOREIGN_ROW_ON_BILL')
    const amount = rows.reduce((sum, row) => sum.add(row.lineAmount), new Prisma.Decimal(0))

    // The amount the cashier collected must be the amount owed right now. Orders
    // and voids take the same meal lock, so whoever arrives second sees the other.
    if (!amount.equals(expectedAmount) || meal.version !== expectedVersion) {
      throw new DiningCommandError('BILL_CHANGED', 409, { amount: money(amount), version: meal.version }, { ...targetAudit, payload: { version: meal.version, expectedVersion } })
    }
    // A kitchen notice is never a condition of payment. Whatever has not reached the
    // kitchen is reported back with the payment and written to the audit entry.
    const external = await externalPayment(tx, meal)
    if (external) {
      throw new DiningCommandError('EXTERNAL_PAYMENT_EXISTS', 409, { paymentIntentId: external.id, status: external.status }, { ...targetAudit, payload: { paymentIntentId: external.id, status: external.status } })
    }

    const paidAt = new Date()
    const payment = await tx.paymentIntent.create({
      data: {
        tenantId: scope.tenantId,
        storeId: scope.storeId,
        operatorUserId: actor.userId,
        orderNo: meal.billNo,
        paymentMethod,
        status: 'PAID',
        amount,
        paidAt,
        provider: paymentMethod === 'KHQR' ? input.khqrConfig?.provider ?? null : null,
        merchantConfigId: paymentMethod === 'KHQR' ? input.khqrConfig?.merchantConfigId ?? null : null,
      },
    })
    const completed = await tx.saleRecord.updateMany({
      where: { id: { in: rows.map((row) => row.id) }, tenantId: scope.tenantId, storeId: scope.storeId, status: 'PENDING_PAYMENT' },
      data: { status: 'COMPLETED' },
    })
    if (completed.count !== rows.length) throw new Error('DINE_IN_SETTLE_ROW_COUNT_MISMATCH')
    const updated = await tx.diningMeal.update({
      where: { id: meal.id },
      data: {
        state: 'PAID',
        settleRequestKey: requestKey,
        settleRequestDigest: digest,
        paymentIntentId: payment.id,
        paidByUserId: actor.userId,
        version: { increment: 1 },
      },
      include: { table: true },
    })
    const view = await buildView(tx, scope, updated)
    await audit(tx, scope, actor, { ...targetAudit, targetId: meal.id, payload: { billNo: meal.billNo, paymentIntentId: payment.id, paymentMethod, lineCount: rows.length, noSendEvidence: view.noSendEvidence } })
    return settleResult((await paymentView(tx, updated))!, view, { replayed: false, alreadySettled: false })
  })
}

// ── End of a meal: clear a paid table, or void an empty one ─────────────────

export type EndMealResult = {
  mealId: string
  state: 'CLOSED' | 'VOIDED'
  endedAt: string
  replayed: boolean
  alreadyEnded: boolean
  /** Void batches with no evidence of a notice having been sent to the printer. They stay available from the ended meal. */
  noSendEvidenceVoidSeqs: number[]
}

/**
 * What makes voiding a meal unsafe: money that was, or may still be, collected for
 * its bill number. This module does not decide what such a payment means; it only
 * refuses to end the meal over it.
 */
async function paymentFacts(tx: Tx, scope: DiningScope, meal: MealRow) {
  if (!meal.billNo) return null
  const [intent, completedLineCount] = await Promise.all([
    tx.paymentIntent.findUnique({ where: { orderNo: meal.billNo }, select: { id: true, status: true } }),
    tx.saleRecord.count({ where: { tenantId: scope.tenantId, storeId: scope.storeId, orderNo: meal.billNo, status: 'COMPLETED' } }),
  ])
  const live = intent !== null && (intent.status === 'PAID' || intent.status === 'PENDING')
  return live || completedLineCount > 0
    ? { paymentIntentId: intent?.id ?? null, paymentIntentStatus: intent?.status ?? null, completedLineCount }
    : null
}

async function endMeal(db: Db, scope: DiningScope, actor: DiningActor, action: 'CLEAR' | 'VOID', input: { mealId: string; requestKey: unknown }): Promise<EndMealResult> {
  const requestKey = requireRequestKey(input.requestKey)
  const digest = requestDigest({ action })
  return transact(db, async (tx) => {
    const meal = await lockMeal(tx, scope, input.mealId)
    const pendingVoid = async (row: MealRow) => noSendEvidence(await loadGraph(tx, scope, row)).voidSeqs
    const terminal = async (replayed: boolean, alreadyEnded: boolean): Promise<EndMealResult> => ({
      mealId: meal.id, state: meal.state as 'CLOSED' | 'VOIDED', endedAt: meal.endedAt!.toISOString(), replayed, alreadyEnded,
      noSendEvidenceVoidSeqs: await pendingVoid(meal),
    })
    if (meal.endRequestKey === requestKey) {
      if (meal.endRequestDigest !== digest) throw new DiningCommandError('REQUEST_KEY_REUSED', 409)
      return terminal(true, false)
    }
    // Already ended by another request: report the existing terminal state, rewrite nothing.
    if (meal.state === 'CLOSED' || meal.state === 'VOIDED') return terminal(false, true)

    const targetAudit = { actionType: action === 'CLEAR' ? 'DINE_IN_CLEAR' : 'DINE_IN_VOID_MEAL', targetType: 'DiningMeal', targetId: meal.id, requestId: requestKey }
    if (action === 'CLEAR') {
      if (meal.state !== 'PAID') throw new DiningCommandError('MEAL_NOT_PAID', 409, { state: meal.state })
      const payment = meal.paymentIntentId ? await tx.paymentIntent.findUnique({ where: { id: meal.paymentIntentId }, select: { status: true } }) : null
      if (payment?.status !== 'PAID') throw new DiningCommandError('PAYMENT_NOT_PAID', 409, { status: payment?.status ?? null })
    } else {
      if (meal.state !== 'OPEN') throw new DiningCommandError('MEAL_ALREADY_PAID', 409, { state: meal.state })
      // The unpaid lines are counted first and the payment facts read after them: a
      // legacy checkout that commits in between (it does not take the meal lock) then
      // shows up in one of the two reads, never in neither.
      const unpaid = meal.billNo ? await tx.saleRecord.count({
        where: { tenantId: scope.tenantId, storeId: scope.storeId, orderNo: meal.billNo, status: 'PENDING_PAYMENT' },
      }) : 0
      // Decided before anything else about the bill: a meal that money was taken for
      // is never voided, whatever its lines look like.
      const facts = await paymentFacts(tx, scope, meal)
      if (facts) throw new DiningCommandError('PAYMENT_FACT_EXISTS', 409, facts, { ...targetAudit, payload: { billNo: meal.billNo, ...facts } })
      if (unpaid > 0) throw new DiningCommandError('MEAL_HAS_UNPAID_LINES', 409, { unpaidLineCount: unpaid })
    }
    await refuseKeyOfAnotherMeal(tx, scope, meal.id, { endRequestKey: requestKey })
    const endedAt = new Date()
    const state = action === 'CLEAR' ? 'CLOSED' : 'VOIDED'
    const updated = await tx.diningMeal.update({
      where: { id: meal.id },
      data: { state, endRequestKey: requestKey, endRequestDigest: digest, endedByUserId: actor.userId, endedAt },
      include: { table: true },
    })
    const noSendEvidenceVoidSeqs = await pendingVoid(updated)
    await audit(tx, scope, actor, { ...targetAudit, payload: { tableId: meal.tableId, billNo: meal.billNo, noSendEvidenceVoidSeqs } })
    return { mealId: meal.id, state, endedAt: endedAt.toISOString(), replayed: false, alreadyEnded: false, noSendEvidenceVoidSeqs }
  })
}

/** Clears a table whose meal is paid. */
export async function clearMeal(db: Db, scope: DiningScope, actor: DiningActor, input: { mealId: string; requestKey: unknown }) {
  return endMeal(db, scope, actor, 'CLEAR', input)
}

/**
 * Voids a meal that has no unpaid line and no payment on its bill: never ordered,
 * or everything voided. OWNER only.
 */
export async function voidMeal(db: Db, scope: DiningScope, actor: DiningActor, input: { mealId: string; requestKey: unknown }) {
  if (actor.role !== 'OWNER') throw new DiningCommandError('OWNER_REQUIRED', 403)
  return endMeal(db, scope, actor, 'VOID', input)
}
