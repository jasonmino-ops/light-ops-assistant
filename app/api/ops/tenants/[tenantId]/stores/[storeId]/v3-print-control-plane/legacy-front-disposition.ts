import { Prisma, type EshopTrayPrintJob, type PrismaClient } from '@prisma/client'
import { canonicalV3PrintEffectKey, v3PrintIntentExpiresAt } from '@/lib/v3-print-identity'
import {
  activationReceiptId,
  completeDisposition,
  signActivation,
  signDisposition,
  trustedCutoff,
} from '@/lib/v3-legacy-seven/clean-start'
import nextAttempt from '@/lib/v3-legacy-seven/sealed-next-attempt.json'
import { parseV3PrintIntent } from '@/lib/v3-print-job-adapter'
import { runOpsPrintModeAction, type OpsPrintControlDb } from './service'
import {
  ADMISSION,
  CaseStop,
  action,
  activationGrant,
  check,
  dbTime,
  isTarget,
  jobIds,
  live,
  object,
  plan,
  prefix,
  readArchivedGrant,
  reason,
  scope,
  sha,
  subject,
  verifyGrant,
  type CaseCommand,
  type Grant,
} from './legacy-front-grant'

type Tx = Prisma.TransactionClient
type Actor = { id: string; role: string }
type DB = Pick<PrismaClient, '$transaction'>
const txOptions = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 }
const iso = (dt: string) => new Date(dt + 'Z').toISOString()
const receiptId = (phase: string) => prefix + phase
const summaryId = receiptId('apply')
const activatedId = activationReceiptId

async function lockCase(tx: Tx) {
  // Store FK inserts take KEY SHARE. Reject a conflicting in-flight writer;
  // the signed operational drain also covers offline/late producers outside this transaction.
  const stores = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM "Store" WHERE id=${scope.storeId} AND "tenantId"=${scope.tenantId} AND code=${plan.scope.code} AND status='ACTIVE' FOR UPDATE NOWAIT`
  check(stores.length === 1, 'CASE_STORE_CHANGED')
  const planes = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM "V3PrintControlPlane" WHERE "tenantId"=${scope.tenantId} AND "storeId"=${scope.storeId} FOR UPDATE NOWAIT`
  check(planes.length === 1, 'CASE_PLANE_CHANGED')
  return planes[0].id
}

async function authority(tx: Tx, actor: Actor) {
  const locked = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM "OperationLog" WHERE id=${receiptId('grant')} AND "tenantId"=${scope.tenantId} AND "storeId"=${scope.storeId} FOR SHARE NOWAIT`
  check(locked.length === 1, 'CASE_GRANT_MISSING_OR_REVOKED')
  const g = verifyGrant(await tx.operationLog.findUnique({ where: { id: locked[0].id } }))
  check(actor.role === 'OPS_ADMIN' && (actor.id === g.reviewer || actor.id === g.executor), 'CASE_ACTOR_FORBIDDEN')
  const operators = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM "OpsAdmin" WHERE id IN (${g.reviewer},${g.executor}) AND status='ACTIVE' AND role='OPS_ADMIN' AND ("lockedUntil" IS NULL OR "lockedUntil" <= clock_timestamp() AT TIME ZONE 'UTC') ORDER BY id FOR SHARE NOWAIT`
  check(operators.length === 2, 'CASE_ACTOR_FORBIDDEN')
  const allowedIds = ['grant', 'review', 'apply', 'activated', ...jobIds].map(receiptId)
  check(
    (await tx.operationLog.count({
      where: { ...scope, requestId: plan.operationRequestId, id: { notIn: allowedIds } },
    })) === 0,
    'CASE_RECEIPT_CONFLICT'
  )
  return g
}

async function checkFence(tx: Tx, activating: boolean, now: Date) {
  check(
    (await tx.store.count({
      where: { id: scope.storeId, tenantId: scope.tenantId, printKitchenTicket: false },
    })) === 1,
    'CASE_STORE_CHANGED'
  )
  const c = await tx.v3PrintControlPlane.findUniqueOrThrow({ where: { storeId: scope.storeId } })
  const original = plan.control
  const batch = await tx.v3PrintExecutionBatch.findMany({
    where: { ...scope, OR: [{ expiresAt: { gt: now } }, { revokedAt: null }] },
    select: { id: true, expiresAt: true, revokedAt: true },
    orderBy: { id: 'asc' },
  })
  check(
    batch.every((b) => b.expiresAt <= now),
    'CASE_BATCH_ACTIVE'
  )
  const devices = await tx.desktopDevice.count({
    where: { ...scope, id: plan.newOwner, status: 'ACTIVE', revokedAt: null, tokenExpiresAt: { gt: now } },
  })
  check(devices === 1 && c.tenantId === scope.tenantId && !c.handoffQuarantineUntil, 'CASE_FENCE_CHANGED')
  if (!activating) {
    check(
      c.mode === original.mode &&
        c.ownerEpoch === original.ownerEpoch &&
        c.ownerDeviceId === plan.originalOwner &&
        c.stateVersion === original.stateVersion &&
        c.leaseId &&
        sha(c.leaseId) === original.leaseSha256 &&
        c.leaseExpiresAt?.toISOString() === iso(original.leaseExpiresAt) &&
        c.leaseExpiresAt <= now &&
        c.handoffRequestedAt === null &&
        JSON.stringify(batch.map((b) => b.id)) === JSON.stringify(plan.unrevokedBatches),
      'CASE_FENCE_CHANGED'
    )
    return
  }
  check(
    batch.length === 0 &&
      c.mode === 'BLOCKED_UNKNOWN' &&
      c.ownerDeviceId === plan.newOwner &&
      c.ownerEpoch === original.ownerEpoch + 1 &&
      c.stateVersion === original.stateVersion + 2 &&
      c.leaseId &&
      !c.leaseId.startsWith('handoff:') &&
      c.leaseExpiresAt &&
      c.leaseExpiresAt > now,
    'CASE_HANDOFF_STALE'
  )
  const last = await tx.operationLog.findFirst({
    where: {
      ...scope,
      targetType: 'V3PrintControlPlane',
      targetId: c.id,
      actionType: 'V3_PRINT_CONTROLLED_HANDOFF',
      status: 'SUCCESS',
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })
  const fact = object(last?.payloadSnapshot)
  check(
    last?.message === 'HANDOFF_CONFIRMED' &&
      last.requestId === plan.handoffConfirmationId &&
      fact.confirmationId === plan.handoffConfirmationId &&
      fact.stateVersion === c.stateVersion &&
      fact.ownerEpoch === c.ownerEpoch &&
      fact.intendedOwnerDeviceId === plan.newOwner,
    'CASE_HANDOFF_STALE'
  )
  const start = await tx.operationLog.findMany({
    where: {
      ...scope,
      targetType: 'V3PrintControlPlane',
      targetId: c.id,
      actionType: 'V3_PRINT_CONTROLLED_HANDOFF',
      status: 'SUCCESS',
      requestId: plan.handoffConfirmationId,
      message: 'QUARANTINE_STARTED',
    },
  })
  const startFact = object(start[0]?.payloadSnapshot)
  check(
    start.length === 1 &&
      startFact.previousOwnerDeviceId === plan.originalOwner &&
      startFact.intendedOwnerDeviceId === plan.newOwner &&
      startFact.ownerEpoch === original.ownerEpoch &&
      startFact.stateVersion === original.stateVersion + 1,
    'CASE_HANDOFF_STALE'
  )
  const spentBatch = await tx.v3PrintExecutionBatch.findMany({
    where: {
      ...scope,
      id: { in: plan.unrevokedBatches },
      ownerDeviceId: plan.originalOwner,
      ownerEpoch: original.ownerEpoch,
    },
  })
  check(
    spentBatch.length === plan.unrevokedBatches.length &&
      spentBatch.every((b) => b.revokedAt?.toISOString() === fact.occurredAt),
    'CASE_HANDOFF_STALE'
  )
}

function ticket(row: EshopTrayPrintJob, index: number, quarantined: boolean) {
  const seal = plan.jobs[index],
    p = parseV3PrintIntent(row.payload)
  check(
    row.id === seal.id &&
      isTarget(row) &&
      row.schemaVersion === 3 &&
      row.createdAt.toISOString() === iso(seal.createdAt) &&
      row.expiresAt.toISOString() === iso(seal.expiresAt) &&
      row.nextAttemptAt.getTime() === Date.parse(nextAttempt[row.id as keyof typeof nextAttempt]) &&
      row.requestHash === seal.requestHash &&
      sha(row.idempotencyKey) === seal.keySha256 &&
      row.status === (quarantined ? 'EXPIRED' : 'PENDING') &&
      row.resultCode === (quarantined ? reason : null) &&
      (quarantined || row.updatedAt.toISOString() === iso(seal.updatedAt)) &&
      row.claimAttempt === 0 &&
      row.attemptCount === 0 &&
      row.maxAttempts === 1 &&
      !row.physicalCompletionKnown &&
      row.claimTokenHash === null &&
      row.claimedByComputerBindingId === null &&
      row.executingAt === null &&
      row.completedAt === null &&
      row.leaseExpiresAt === null &&
      row.resultStatus === null &&
      row.resultMessage === null &&
      row.effectBoundary === null &&
      p?.source === 'LOCAL_DESKTOP' &&
      p.role === 'FRONT' &&
      p.payloadKind === 'RAW_BYTES' &&
      p.printJobId === row.idempotencyKey &&
      row.idempotencyKey === 'network:' + sha(canonicalV3PrintEffectKey(p.orderNo, 'FRONT')),
    'CASE_TICKET_DRIFT'
  )
  // Rebuild the original HOLD_LOCAL wire field order. PostgreSQL jsonb reorders keys.
  const intent = {
    schemaVersion: 3,
    printJobId: p.printJobId,
    source: p.source,
    role: p.role,
    payloadKind: p.payloadKind,
    orderNo: p.orderNo,
    rendererVersion: p.rendererVersion,
    payloadBase64: p.payloadBase64,
    byteLength: p.byteLength,
    payloadHash: p.payloadHash,
  }
  check(sha(JSON.stringify(intent)) === seal.requestHash, 'CASE_BYTES_DRIFT')
  return {
    orderNo: p.orderNo,
    id: row.id,
    keySha256: seal.keySha256,
    requestHash: row.requestHash,
    payloadHash: p.payloadHash,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    nextAttemptAt: row.nextAttemptAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    claimAttempt: 0,
    attemptCount: 0,
    status: row.status,
    resultCode: row.resultCode,
    completedAt: null,
    resultStatus: null,
    effectBoundary: null,
    physicalCompletionKnown: false,
    role: p.role,
    source: p.source,
    payloadKind: p.payloadKind,
    schemaVersion: 3,
    maxAttempts: 1,
    claimTokenHash: null,
    claimedByComputerBindingId: null,
    executingAt: null,
    leaseExpiresAt: null,
    resultMessage: null,
  }
}

async function readSeven(tx: Tx, quarantined: boolean, now: Date, exclusive = true) {
  if (exclusive) {
    const locked = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "EshopTrayPrintJob" WHERE "tenantId"=${scope.tenantId} AND "storeId"=${scope.storeId} ORDER BY id LIMIT 8 FOR UPDATE NOWAIT`
    check(JSON.stringify(locked.map((r) => r.id)) === JSON.stringify(jobIds), 'CASE_QUEUE_OR_HELD_CHANGED')
  }
  const rows = await tx.eshopTrayPrintJob.findMany({
    where: { ...scope, id: { in: jobIds } },
    orderBy: { id: 'asc' },
  })
  check(rows.length === 7, 'CASE_QUEUE_OR_HELD_CHANGED')
  const facts = rows.map((r, i) => ticket(r, i, quarantined))
  const orders = facts.map((f) => f.orderNo)
  check(new Set(orders).size === 7, 'CASE_EFFECT_ALIAS')
  const receipts = await tx.saleRecord.findMany({
    where: { ...scope, orderNo: { in: orders }, recordNo: { in: orders }, saleType: 'SALE', status: 'COMPLETED' },
    select: { orderNo: true, recordNo: true, createdAt: true },
  })
  for (const f of facts) {
    const matches = receipts.filter((r) => r.recordNo === f.orderNo && r.orderNo === f.orderNo)
    check(
      matches.length === 1 &&
        matches[0].createdAt <= new Date(f.createdAt) &&
        v3PrintIntentExpiresAt(matches[0].createdAt.toISOString()) === f.expiresAt &&
        new Date(f.expiresAt) <= now,
      'CASE_RECEIPT_TTL_UNPROVEN'
    )
  }
  if (exclusive) {
    const [runtime, fulfill, reprints] = await Promise.all([
      tx.storeRuntimePrintTask.count({ where: scope }),
      tx.customerOrderFulfillmentIntent.count({
        where: {
          ...scope,
          OR: [{ orderNo: { in: orders } }, { state: { notIn: ['CANCELLED', 'EXPIRED', 'NOT_REQUIRED'] } }],
        },
      }),
      tx.operationLog.count({
        where: {
          ...scope,
          OR: [
            { actionType: 'V3_PRINT_MANUAL_REPRINT_REQUESTED' },
            { targetId: { in: [...jobIds, ...rows.map((r) => r.idempotencyKey)] } },
          ],
        },
      }),
    ])
    check(!runtime && !fulfill && !reprints, 'CASE_OTHER_EFFECT')
  }
  return facts.map(({ orderNo: _, ...fact }) => fact)
}

type Facts = Awaited<ReturnType<typeof readSeven>>
function common(g: Grant) {
  return {
    grantDigest: g.digest,
    reviewer: g.reviewer,
    executor: g.executor,
    sourceSha: g.sourceSha,
    admissionSha256: ADMISSION,
    evidenceDigest: g.evidenceDigest,
  }
}
async function audit(tx: Tx, id: string, phase: string, payload: Prisma.InputJsonObject) {
  return tx.operationLog.create({
    data: {
      id,
      ...subject,
      requestId: plan.operationRequestId,
      actionType: action,
      status: 'SUCCESS',
      message: phase,
      payloadSnapshot: payload,
    },
  })
}
async function getReceipt(tx: Tx, id: string, phase: string, g: Grant) {
  const row = await tx.operationLog.findUnique({ where: { id } })
  if (!row) return null
  const value = object(row.payloadSnapshot)
  check(
    row.tenantId === scope.tenantId &&
      row.storeId === scope.storeId &&
      row.targetType === subject.targetType &&
      row.targetId === subject.targetId &&
      row.actionType === action &&
      row.requestId === plan.operationRequestId &&
      row.status === 'SUCCESS' &&
      row.message === phase &&
      Object.entries(common(g)).every(([k, v]) => value[k] === v),
    'CASE_RECEIPT_CONFLICT'
  )
  return value
}
// Ordered tuples survive jsonb object key reordering and bind each before/after field.
const fingerprint = (facts: Facts) =>
  sha(JSON.stringify(facts.map((f) => Object.entries(f).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))))
const afterDigest = (facts: Facts) => sha(JSON.stringify(facts.map((f) => fingerprint([f]))))
async function verifyApplied(tx: Tx, g: Grant, now: Date, exclusive = true) {
  const summary = await getReceipt(tx, summaryId, 'APPLY', g)
  check(summary, 'CASE_NOT_APPLIED')
  const after = await readSeven(tx, true, now, exclusive)
  const before = after.map((f, i) => ({
    ...f,
    status: 'PENDING' as const,
    resultCode: null,
    updatedAt: iso(plan.jobs[i].updatedAt),
  }))
  const review = await getReceipt(tx, receiptId('review'), 'REVIEW', g)
  check(
    g.beforeHash === fingerprint(before) &&
      review?.beforeHash === g.beforeHash &&
      summary.beforeHash === review.beforeHash &&
      summary.mac === signDisposition(summary) &&
      summary.afterHash === afterDigest(after),
    'CASE_RECEIPT_CONFLICT'
  )
  for (const [i, f] of after.entries()) {
    const entry = await getReceipt(tx, receiptId(f.id), 'TICKET', g)
    check(
      entry &&
        entry.beforeHash === fingerprint([before[i]]) &&
        entry.afterHash === fingerprint([f]) &&
        fingerprint([object(entry.before) as Facts[number]]) === entry.beforeHash &&
        fingerprint([object(entry.after) as Facts[number]]) === entry.afterHash,
      'CASE_RECEIPT_INCOMPLETE'
    )
  }
  return afterDigest(after)
}

async function apply(tx: Tx, g: Grant, review: Record<string, unknown>, facts: Facts) {
  check(review.beforeHash === fingerprint(facts), 'CASE_REVIEW_DRIFT')
  const at = await dbTime(tx)
  live(g, at)
  for (const f of facts) {
    const changed = await tx.eshopTrayPrintJob.updateMany({
      where: {
        ...scope,
        id: f.id,
        requestHash: f.requestHash,
        status: 'PENDING',
        schemaVersion: 3,
        updatedAt: new Date(f.updatedAt),
        expiresAt: new Date(f.expiresAt),
        claimTokenHash: null,
        claimAttempt: 0,
        attemptCount: 0,
        completedAt: null,
        resultCode: null,
      },
      data: { status: 'EXPIRED', resultCode: reason, updatedAt: at },
    })
    check(changed.count === 1, 'CASE_CAS_LOST')
    const after = { ...f, status: 'EXPIRED' as const, resultCode: reason, updatedAt: at.toISOString() }
    await audit(tx, receiptId(f.id), 'TICKET', {
      ...common(g),
      before: f,
      after,
      beforeHash: fingerprint([f]),
      afterHash: fingerprint([after]),
    })
  }
  const after = await readSeven(tx, true, at)
  const applied = {
    ...common(g),
    beforeHash: fingerprint(facts),
    afterHash: afterDigest(after),
    jobIds,
  }
  await audit(tx, summaryId, 'APPLY', { ...applied, mac: signDisposition(applied) })
  await verifyApplied(tx, g, at)
}

/** Inspect durable facts after a lost response without requiring the old lease or a live grant. */
export async function readLegacyReceipt(db: DB, store: typeof scope, actor: Actor) {
  check(isTarget(store) && actor.role === 'OPS_ADMIN', 'CASE_RECEIPT_FORBIDDEN')
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`
    const g = readArchivedGrant(await tx.operationLog.findUnique({ where: { id: receiptId('grant') } }))
    check(actor.id === g.reviewer || actor.id === g.executor, 'CASE_RECEIPT_FORBIDDEN')
    const active = await tx.opsAdmin.count({
      where: {
        id: actor.id,
        role: 'OPS_ADMIN',
        status: 'ACTIVE',
        OR: [{ lockedUntil: null }, { lockedUntil: { lte: await dbTime(tx) } }],
      },
    })
    check(active === 1, 'CASE_RECEIPT_FORBIDDEN')
    const rows = await tx.operationLog.findMany({
      where: { ...subject, actionType: action, requestId: plan.operationRequestId },
    })
    const summary = await getReceipt(tx, summaryId, 'APPLY', g)
    const activated = await tx.operationLog.findUnique({ where: { id: activatedId } })
    if (!summary) {
      check(!activated && rows.every((r) => r.id === receiptId('review')), 'CASE_RECEIPT_CONFLICT')
      return { disposition: 'NO_APPLY_RECEIPT', activation: 'NO_ACTIVATION_RECEIPT', liveAuthorization: false }
    }
    check(summary.beforeHash === g.beforeHash && completeDisposition(rows, summary), 'CASE_RECEIPT_CONFLICT')
    const cutoff = activated && (await trustedCutoff(tx.operationLog))
    check(!activated || cutoff, 'CASE_RECEIPT_CONFLICT')
    return {
      disposition: 'APPLIED',
      activation: cutoff ? 'COMMITTED' : 'NO_ACTIVATION_RECEIPT',
      afterHash: summary.afterHash,
      cutoffUtc: cutoff?.toISOString() ?? null,
      liveAuthorization: false,
    }
  }, txOptions)
}

export async function runLegacyDisposition(db: DB, store: typeof scope, actor: Actor, cmd: CaseCommand) {
  check(isTarget(store), 'CASE_STORE_FORBIDDEN')
  return db.$transaction(async (tx) => {
    await lockCase(tx)
    const g = await authority(tx, actor)
    check(
      g.sourceSha === cmd.sourceSha &&
        (cmd.phase === 'READBACK' || actor.id === (cmd.phase === 'REVIEW' ? g.reviewer : g.executor)),
      'CASE_ACTOR_FORBIDDEN'
    )
    const now = await dbTime(tx)
    if ((await getReceipt(tx, summaryId, 'APPLY', g)) || cmd.phase === 'READBACK') {
      if (cmd.phase === 'READBACK') {
        live(g, now)
        await checkFence(tx, false, now)
        await verifyApplied(tx, g, now)
        live(g, await dbTime(tx))
        return { ok: true, state: 'HANDOFF_PREFLIGHT_OK' as const, receiptId: summaryId }
      }
      await verifyApplied(tx, g, now, false)
      return { ok: true, state: 'APPLIED_RECEIPT_ONLY' as const, receiptId: summaryId }
    }
    live(g, now)
    await checkFence(tx, false, now)
    const facts = await readSeven(tx, false, now)
    check(g.beforeHash === fingerprint(facts), 'CASE_PREIMAGE_NOT_APPROVED')
    const review = await getReceipt(tx, receiptId('review'), 'REVIEW', g)
    if (cmd.phase === 'REVIEW') {
      if (review) check(review.beforeHash === fingerprint(facts), 'CASE_REVIEW_DRIFT')
      else await audit(tx, receiptId('review'), 'REVIEW', { ...common(g), beforeHash: fingerprint(facts), jobIds })
    } else {
      check(review, 'CASE_REVIEW_REQUIRED')
      await apply(tx, g, review, facts)
    }
    live(g, await dbTime(tx))
    return {
      ok: true,
      state: cmd.phase === 'REVIEW' ? ('REVIEWED' as const) : ('APPLIED' as const),
      receiptId: cmd.phase === 'REVIEW' ? receiptId('review') : summaryId,
    }
  }, txOptions)
}

export async function runLegacyFinalization(
  db: DB,
  store: typeof scope,
  actor: Actor,
  version: number,
  mode: 'FINALIZE_V3_ACTIVE' | 'FINALIZE_V2_ACTIVE'
) {
  check(isTarget(store), 'CASE_STORE_FORBIDDEN')
  const result = await db.$transaction(async (tx) => {
    // Preserve future normal operations once this one controlled cutover is verifiably spent.
    const closed = await tx.operationLog.findUnique({ where: { id: activatedId } })
    const spent = closed && (await trustedCutoff(tx.operationLog))
    const wantsLater = spent && version >= plan.control.stateVersion + 3
    const boundDb = {
      ...tx,
      $transaction: <T>(fn: (transaction: Tx) => Promise<T>) => fn(tx),
    } as unknown as OpsPrintControlDb
    const run = (at: Date) =>
      runOpsPrintModeAction(
        boundDb,
        {
          ...scope,
          action: mode,
          operatorAdminId: actor.id,
          operatorRole: actor.role,
          expectedStateVersion: version,
        },
        at
      )
    if (wantsLater) return run(await dbTime(tx))
    check(
      !closed && mode === 'FINALIZE_V3_ACTIVE' && version === plan.control.stateVersion + 2,
      'CASE_FINALIZE_BLOCKED'
    )
    await lockCase(tx)
    const g = await authority(tx, actor)
    check(actor.id === g.executor, 'CASE_ACTOR_FORBIDDEN')
    const now = await dbTime(tx)
    live(g, now)
    await checkFence(tx, true, now)
    const afterHash = await verifyApplied(tx, g, now)
    const approval = await activationGrant(tx, g, afterHash, now)
    const before = await dbTime(tx)
    live(g, before)
    await checkFence(tx, true, before)
    const result = await run(before)
    check(result.ok, 'CASE_ORIGINAL_FINALIZE_REFUSED')
    const c = result.controlPlane
    check(
      c.mode === 'V3_ACTIVE' &&
        c.ownerDeviceId === plan.newOwner &&
        c.ownerEpoch === plan.control.ownerEpoch + 1 &&
        c.stateVersion === version + 1 &&
        c.leaseExpiresAt,
      'CASE_FINALIZE_DRIFT'
    )
    const fact = {
      ...common(g),
      confirmationId: plan.handoffConfirmationId,
      deviceId: plan.newOwner,
      ownerEpoch: c.ownerEpoch,
      stateVersion: c.stateVersion,
      modeAuditRequestId: result.requestId,
      controlPlaneId: c.id,
      cutoffUtc: (await dbTime(tx)).toISOString(),
      beforeHash: g.beforeHash,
      afterHash,
      activationGrantDigest: approval.digest,
    }
    await audit(tx, activatedId, 'ACTIVATED', { ...fact, mac: signActivation(fact) })
    const end = await dbTime(tx)
    check(
      Math.min(Date.parse(c.leaseExpiresAt), g.end, approval.end) > end.getTime() + 10_000,
      'CASE_HANDOFF_STALE'
    )
    return result
  }, txOptions)
  if (result.ok && version === plan.control.stateVersion + 2) {
    try {
      await db.$transaction(async (tx) => {
        const now = await dbTime(tx)
        const plane = await tx.v3PrintControlPlane.findUnique({ where: { storeId: scope.storeId } })
        const g = await authority(tx, actor)
        const applied = await getReceipt(tx, summaryId, 'APPLY', g)
        check(applied && typeof applied.afterHash === 'string', 'CASE_POST_COMMIT_READBACK_REQUIRED')
        await activationGrant(tx, g, applied.afterHash, now)
        check(
          (await trustedCutoff(tx.operationLog)) &&
            plane?.mode === 'V3_ACTIVE' &&
            plane.ownerDeviceId === plan.newOwner &&
            plane.ownerEpoch === plan.control.ownerEpoch + 1 &&
            plane.leaseExpiresAt &&
            plane.leaseExpiresAt > now,
          'CASE_POST_COMMIT_READBACK_REQUIRED'
        )
      }, txOptions)
    } catch {
      throw new CaseStop('CASE_ACTIVATION_COMMITTED_READBACK_REQUIRED')
    }
  }
  return result
}

export function caseRejection(error: unknown) {
  if (error instanceof CaseStop) return error.message
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    ['P2002', 'P2025', 'P2028', 'P2034', 'P2010'].includes(error.code)
  )
    return 'CASE_OUTCOME_REQUIRES_READBACK'
  return null
}
