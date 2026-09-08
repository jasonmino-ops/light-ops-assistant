import { Prisma, type EshopTrayPrintJob } from '@prisma/client'
import { createHash } from 'node:crypto'
import { parseNetworkRequest, type NetworkRequest } from '../../e-shop-tray/src/networkContract'
import { prisma } from '@/lib/prisma'
import {
  ES_TRAY_RELAY_SCHEMA_VERSION,
  type RelayTimingConfig,
} from './config'
import {
  hashPrintRequest,
  parsePrintRequest,
  type EshopTrayPrintRequest,
  type RelayClaimProof,
  type RelayTerminalResult,
} from './contract'
import { createClaimToken, hashClaimToken } from './crypto'

export class RelayServiceError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code)
    this.name = 'RelayServiceError'
  }
}

export type RelayStoreScope = {
  tenantId: string
  storeId: string
}

export type RelayAgentScope = RelayStoreScope & {
  computerBindingId: string
  schemaVersion?: 1 | 2
}

export type ClaimedRelayJob = {
  id: string
  schemaVersion: 1 | 2
  idempotencyKey: string
  requestHash: string
  claimAttempt: number
  claimToken: string
  leaseExpiresAt: string
  request: EshopTrayPrintRequest | NetworkRequest
}

function serializeJob(job: EshopTrayPrintJob) {
  return {
    id: job.id,
    schemaVersion: job.schemaVersion,
    idempotencyKey: job.idempotencyKey,
    requestHash: job.requestHash,
    status: job.status,
    claimAttempt: job.claimAttempt,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    leaseExpiresAt: job.leaseExpiresAt?.toISOString() ?? null,
    nextAttemptAt: job.nextAttemptAt.toISOString(),
    expiresAt: job.expiresAt.toISOString(),
    executingAt: job.executingAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    result: job.resultStatus ? {
      status: job.resultStatus,
      code: job.resultCode,
      message: job.resultMessage,
      effectBoundary: job.effectBoundary,
      physicalCompletionKnown: job.physicalCompletionKnown,
    } : null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  }
}

function storedRequest(job: EshopTrayPrintJob): EshopTrayPrintRequest | NetworkRequest {
  try {
    if (job.schemaVersion === 2) {
      const request = parseNetworkRequest(job.payload)
      if (createHash('sha256').update(JSON.stringify(request)).digest('hex') !== job.requestHash) {
        throw new Error('NETWORK_PAYLOAD_HASH_MISMATCH')
      }
      return request
    }
    if (job.schemaVersion !== 1) throw new Error('UNSUPPORTED_SCHEMA')
    return parsePrintRequest(job.payload)
  } catch {
    throw new RelayServiceError('ES_TRAY_02_STORED_PAYLOAD_INVALID', 500)
  }
}

export async function enqueueRelayPrintJob(
  scope: RelayStoreScope,
  request: EshopTrayPrintRequest | NetworkRequest,
  timing: RelayTimingConfig,
  now = new Date(),
  tx?: Prisma.TransactionClient,
) {
  if ('profile' in request) {
    if (!tx) throw new RelayServiceError('NETWORK_SALE_TRANSACTION_REQUIRED', 500)
    const normalized = parseNetworkRequest(request)
    const requestHash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
    // ON CONFLICT avoids aborting the surrounding sale transaction on a duplicate key.
    const inserted = await tx.eshopTrayPrintJob.createMany({
      skipDuplicates: true,
      data: {
        ...scope, idempotencyKey: normalized.requestId, requestHash, schemaVersion: 2,
        payload: normalized as unknown as Prisma.InputJsonValue,
        // Both role jobs share the immutable sale timestamp, so another order
        // cannot be sorted between this order's FRONT and KITCHEN.
        createdAt: new Date(normalized.order.createdAt),
        maxAttempts: timing.maxAttempts, nextAttemptAt: now,
        expiresAt: new Date(now.getTime() + timing.jobTtlMs), physicalCompletionKnown: false,
      },
    })
    const job = await tx.eshopTrayPrintJob.findUniqueOrThrow({
      where: { tenantId_storeId_idempotencyKey: { ...scope, idempotencyKey: normalized.requestId } },
    })
    if (job.requestHash !== requestHash || job.schemaVersion !== 2) {
      throw new RelayServiceError('ES_TRAY_02_IDEMPOTENCY_CONFLICT', 409)
    }
    return { created: inserted.count === 1, job: serializeJob(job) }
  }
  const requestHash = hashPrintRequest(request)
  const expiresAt = new Date(now.getTime() + timing.jobTtlMs)
  try {
    const job = await prisma.eshopTrayPrintJob.create({
      data: {
        tenantId: scope.tenantId,
        storeId: scope.storeId,
        idempotencyKey: request.requestId,
        requestHash,
        schemaVersion: ES_TRAY_RELAY_SCHEMA_VERSION,
        payload: request as unknown as Prisma.InputJsonValue,
        status: 'PENDING',
        maxAttempts: timing.maxAttempts,
        nextAttemptAt: now,
        expiresAt,
        physicalCompletionKnown: false,
      },
    })
    return { created: true, job: serializeJob(job) }
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error
    const existing = await prisma.eshopTrayPrintJob.findUnique({
      where: {
        tenantId_storeId_idempotencyKey: {
          tenantId: scope.tenantId,
          storeId: scope.storeId,
          idempotencyKey: request.requestId,
        },
      },
    })
    if (!existing) throw error
    if (existing.requestHash !== requestHash || existing.schemaVersion !== ES_TRAY_RELAY_SCHEMA_VERSION) {
      throw new RelayServiceError('ES_TRAY_02_IDEMPOTENCY_CONFLICT', 409)
    }
    return { created: false, job: serializeJob(existing) }
  }
}

async function recoverTimedOutJobs(
  tx: Prisma.TransactionClient,
  scope: RelayStoreScope & { schemaVersion?: 1 | 2 },
  now: Date,
) {
  // Once EXECUTING is reached the side-effect boundary is uncertain. Expiry
  // closes the job as FAILED and must never make it claimable again.
  await tx.$executeRaw(Prisma.sql`
    UPDATE "EshopTrayPrintJob"
       SET "status" = 'FAILED'::"EshopTrayPrintJobStatus",
           "completedAt" = ${now},
           "resultStatus" = 'FAILURE',
           "resultCode" = 'EXECUTION_RESULT_TIMEOUT',
           "resultMessage" = 'Tray stopped reporting after entering the printing boundary.',
           "effectBoundary" = 'CROSSING_UNKNOWN',
           "physicalCompletionKnown" = false,
           "leaseExpiresAt" = NULL,
           "updatedAt" = ${now}
     WHERE "tenantId" = ${scope.tenantId}
       AND "storeId" = ${scope.storeId}
       AND "status" = 'EXECUTING'::"EshopTrayPrintJobStatus"
       AND "schemaVersion" = ${scope.schemaVersion ?? 1}
       AND "leaseExpiresAt" <= ${now}
  `)

  await tx.$executeRaw(Prisma.sql`
    UPDATE "EshopTrayPrintJob"
       SET "status" = 'EXPIRED'::"EshopTrayPrintJobStatus",
           "completedAt" = ${now},
           "resultStatus" = 'EXPIRED',
           "resultCode" = 'JOB_TTL_EXPIRED',
           "resultMessage" = 'The print job expired before entering the printing boundary.',
           "effectBoundary" = 'NOT_CROSSED',
           "physicalCompletionKnown" = false,
           "leaseExpiresAt" = NULL,
           "updatedAt" = ${now}
     WHERE "tenantId" = ${scope.tenantId}
       AND "storeId" = ${scope.storeId}
       AND "status" IN (
         'PENDING'::"EshopTrayPrintJobStatus",
         'CLAIMED'::"EshopTrayPrintJobStatus"
       )
       AND "schemaVersion" = ${scope.schemaVersion ?? 1}
       AND "expiresAt" <= ${now}
  `)

  await tx.$executeRaw(Prisma.sql`
    UPDATE "EshopTrayPrintJob"
       SET "status" = 'FAILED'::"EshopTrayPrintJobStatus",
           "completedAt" = ${now},
           "resultStatus" = 'FAILURE',
           "resultCode" = 'MAX_CLAIM_ATTEMPTS_EXCEEDED',
           "resultMessage" = 'The print job exhausted safe pre-execution claim attempts.',
           "effectBoundary" = 'NOT_CROSSED',
           "physicalCompletionKnown" = false,
           "leaseExpiresAt" = NULL,
           "updatedAt" = ${now}
     WHERE "tenantId" = ${scope.tenantId}
       AND "storeId" = ${scope.storeId}
       AND "status" = 'CLAIMED'::"EshopTrayPrintJobStatus"
       AND "leaseExpiresAt" <= ${now}
       AND "attemptCount" >= "maxAttempts"
       AND "schemaVersion" = ${scope.schemaVersion ?? 1}
  `)

  // RETRYABLE is represented by PENDING plus explicit result metadata, keeping
  // the public state machine small while preserving why it became claimable.
  await tx.$executeRaw(Prisma.sql`
    UPDATE "EshopTrayPrintJob"
       SET "status" = 'PENDING'::"EshopTrayPrintJobStatus",
           "claimedByComputerBindingId" = NULL,
           "claimTokenHash" = NULL,
           "leaseExpiresAt" = NULL,
           "nextAttemptAt" = ${now},
           "resultStatus" = 'RETRYABLE',
           "resultCode" = 'CLAIM_LEASE_EXPIRED_BEFORE_EXECUTING',
           "resultMessage" = 'The pre-execution claim lease expired and may be claimed again.',
           "effectBoundary" = 'NOT_CROSSED',
           "physicalCompletionKnown" = false,
           "updatedAt" = ${now}
     WHERE "tenantId" = ${scope.tenantId}
       AND "storeId" = ${scope.storeId}
       AND "status" = 'CLAIMED'::"EshopTrayPrintJobStatus"
       AND "leaseExpiresAt" <= ${now}
       AND "attemptCount" < "maxAttempts"
       AND "expiresAt" > ${now}
       AND "schemaVersion" = ${scope.schemaVersion ?? 1}
  `)

  await tx.$executeRaw(Prisma.sql`
    UPDATE "EshopTrayPrintJob"
       SET "status" = 'FAILED'::"EshopTrayPrintJobStatus",
           "completedAt" = ${now},
           "resultStatus" = 'FAILURE',
           "resultCode" = 'MAX_CLAIM_ATTEMPTS_EXCEEDED',
           "resultMessage" = 'The print job exhausted safe pre-execution claim attempts.',
           "effectBoundary" = 'NOT_CROSSED',
           "physicalCompletionKnown" = false,
           "updatedAt" = ${now}
     WHERE "tenantId" = ${scope.tenantId}
       AND "storeId" = ${scope.storeId}
       AND "status" = 'PENDING'::"EshopTrayPrintJobStatus"
       AND "attemptCount" >= "maxAttempts"
       AND "schemaVersion" = ${scope.schemaVersion ?? 1}
  `)
}

async function lockActiveClaimScope(
  tx: Prisma.TransactionClient,
  scope: RelayAgentScope,
  now: Date,
) {
  // Authentication and claim are separate HTTP/service steps. Revalidate and
  // lock all authorization rows in this transaction so a concurrent disable,
  // credential revoke, or store/tenant deactivation wins before any job can be
  // claimed by the stale authorization state.
  const active = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT binding."id"
      FROM "ComputerBinding" AS binding
      JOIN "Store" AS store
        ON store."id" = binding."storeId"
       AND store."tenantId" = binding."tenantId"
      JOIN "Tenant" AS tenant
        ON tenant."id" = binding."tenantId"
     WHERE binding."id" = ${scope.computerBindingId}
       AND binding."tenantId" = ${scope.tenantId}
       AND binding."storeId" = ${scope.storeId}
       AND binding."status" = 'APPROVED'::"ComputerBindingStatus"
       AND binding."boundAt" IS NOT NULL
       AND binding."disabledAt" IS NULL
       AND binding."credentialStatus" = 'ACTIVE'::"ComputerCredentialStatus"
       AND (
         binding."credentialExpiresAt" IS NULL
         OR binding."credentialExpiresAt" > ${now}
       )
       AND store."status" = 'ACTIVE'::"StoreStatus"
       AND tenant."status" = 'ACTIVE'
     FOR UPDATE OF binding, store, tenant
  `)
  if (!active[0]) {
    throw new RelayServiceError('COMPUTER_BINDING_NOT_ACTIVE', 403)
  }
}

export async function claimNextRelayPrintJob(
  scope: RelayAgentScope,
  timing: RelayTimingConfig,
  now = new Date(),
): Promise<ClaimedRelayJob | null> {
  return prisma.$transaction(async (tx) => {
    await lockActiveClaimScope(tx, scope, now)
    await recoverTimedOutJobs(tx, scope, now)

    if (scope.schemaVersion === 2) {
      // A partial/unknown TCP stream may still affect this single printer. ACK,
      // TTL and a later order must not automatically release that boundary.
      const unknown = await tx.eshopTrayPrintJob.findFirst({
        where: {
          tenantId: scope.tenantId, storeId: scope.storeId, schemaVersion: 2,
          status: { in: ['SUCCEEDED', 'FAILED', 'EXPIRED'] }, effectBoundary: 'CROSSING_UNKNOWN',
        },
        select: { id: true },
      })
      if (unknown) return null
      // A sale transaction may commit late with an earlier createdAt. Checking
      // only the sorted head would hide an already active job behind that sale.
      const active = await tx.eshopTrayPrintJob.findFirst({
        where: {
          tenantId: scope.tenantId, storeId: scope.storeId, schemaVersion: 2,
          status: { in: ['CLAIMED', 'EXECUTING'] },
        },
        select: { id: true },
      })
      if (active) return null
    }

    const candidates = scope.schemaVersion === 2
      ? await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT candidate."id"
          FROM "EshopTrayPrintJob" AS candidate
         WHERE candidate."tenantId" = ${scope.tenantId}
           AND candidate."storeId" = ${scope.storeId}
           AND candidate."schemaVersion" = 2
           AND candidate."status" = 'PENDING'::"EshopTrayPrintJobStatus"
         ORDER BY CASE WHEN candidate."payload"->>'role' = 'KITCHEN'
           AND candidate."payload"->>'mode' = 'SHARED_PRINTER'
           AND EXISTS (
             SELECT 1 FROM "EshopTrayPrintJob" AS front
              WHERE front."tenantId" = candidate."tenantId"
                AND front."storeId" = candidate."storeId"
                AND front."schemaVersion" = 2
                AND front."status" = 'SUCCEEDED'::"EshopTrayPrintJobStatus"
                AND front."payload"->>'role' = 'FRONT'
                AND front."payload"->>'mode' = 'SHARED_PRINTER'
                AND front."payload"->'order'->>'orderNo' = candidate."payload"->'order'->>'orderNo'
           ) THEN 0 ELSE 1 END ASC,
           candidate."createdAt" ASC, candidate."payload"->'order'->>'orderNo' ASC,
           CASE candidate."payload"->>'role' WHEN 'FRONT' THEN 0 WHEN 'KITCHEN' THEN 1 ELSE 2 END ASC,
           candidate."id" ASC
         LIMIT 1
         FOR UPDATE OF candidate
      `)
      : await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
        FROM "EshopTrayPrintJob"
       WHERE "tenantId" = ${scope.tenantId}
         AND "storeId" = ${scope.storeId}
         AND "schemaVersion" = ${scope.schemaVersion ?? 1}
         AND "status" = 'PENDING'::"EshopTrayPrintJobStatus"
         AND "nextAttemptAt" <= ${now}
         AND "expiresAt" > ${now}
         AND "attemptCount" < "maxAttempts"
       ORDER BY "createdAt" ASC, "id" ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
    `)
    const candidateId = candidates[0]?.id
    if (!candidateId) return null

    const candidate = await tx.eshopTrayPrintJob.findUniqueOrThrow({ where: { id: candidateId } })
    // Finish a started pair before untouched orders, even if another sale was
    // committed late. Check readiness only after selecting that pending head.
    if (scope.schemaVersion === 2 && (candidate.status !== 'PENDING' || candidate.nextAttemptAt > now)) return null
    let request: EshopTrayPrintRequest | NetworkRequest
    try {
      request = storedRequest(candidate)
    } catch {
      await tx.eshopTrayPrintJob.update({
        where: { id: candidate.id },
        data: {
          status: 'FAILED',
          completedAt: now,
          resultStatus: 'FAILURE',
          resultCode: 'STORED_PAYLOAD_INVALID',
          resultMessage: 'Stored relay payload failed contract validation.',
          effectBoundary: 'NOT_CROSSED',
          physicalCompletionKnown: false,
        },
      })
      return null
    }

    if ('profile' in request && request.role === 'KITCHEN') {
      const frontKey = createHash('sha256').update(`cashier-network-v2:${request.order.orderNo}:FRONT`).digest('hex')
      const front = await tx.eshopTrayPrintJob.findUnique({
        where: {
          tenantId_storeId_idempotencyKey: {
            tenantId: scope.tenantId, storeId: scope.storeId, idempotencyKey: `network:${frontKey}`,
          },
        },
      })
      let validFront = false
      if (front?.schemaVersion === 2) {
        try {
          const prior = storedRequest(front)
          validFront = 'profile' in prior && prior.mode === 'SHARED_PRINTER'
            && prior.role === 'FRONT' && prior.order.orderNo === request.order.orderNo
            && JSON.stringify(prior.order) === JSON.stringify(request.order)
        } catch { /* An invalid dependency cannot authorize kitchen bytes. */ }
      }
      if (!validFront || !front || front.status === 'FAILED' || front.status === 'EXPIRED') {
        await tx.eshopTrayPrintJob.update({
          where: { id: candidate.id },
          data: {
            status: 'FAILED', completedAt: now, resultStatus: 'FAILURE',
            resultCode: 'NETWORK_FRONT_DEPENDENCY_FAILED',
            resultMessage: 'Kitchen printing requires the matching front receipt to finish submission.',
            effectBoundary: 'NOT_CROSSED', physicalCompletionKnown: false,
          },
        })
        return null
      }
      if (front.status !== 'SUCCEEDED' || front.effectBoundary !== 'CROSSED'
        || front.resultCode !== 'SUBMITTED_TO_NETWORK_SOCKET') return null
    }

    const claimToken = createClaimToken()
    const leaseExpiresAt = new Date(now.getTime() + timing.claimLeaseMs)
    const claimed = await tx.eshopTrayPrintJob.update({
      where: { id: candidate.id },
      data: {
        status: 'CLAIMED',
        claimedByComputerBindingId: scope.computerBindingId,
        claimTokenHash: hashClaimToken(claimToken),
        claimAttempt: { increment: 1 },
        attemptCount: { increment: 1 },
        leaseExpiresAt,
        resultStatus: null,
        resultCode: null,
        resultMessage: null,
        effectBoundary: 'NOT_CROSSED',
        physicalCompletionKnown: false,
      },
    })
    return {
      id: claimed.id,
      schemaVersion: candidate.schemaVersion as 1 | 2,
      idempotencyKey: claimed.idempotencyKey,
      requestHash: claimed.requestHash,
      claimAttempt: claimed.claimAttempt,
      claimToken,
      leaseExpiresAt: leaseExpiresAt.toISOString(),
      request,
    }
  })
}

async function findClaimedJob(scope: RelayAgentScope, jobId: string, proof: RelayClaimProof) {
  if (proof.schemaVersion !== (scope.schemaVersion ?? 1)) return null
  return prisma.eshopTrayPrintJob.findFirst({
    where: {
      id: jobId,
      schemaVersion: scope.schemaVersion ?? 1,
      tenantId: scope.tenantId,
      storeId: scope.storeId,
      claimedByComputerBindingId: scope.computerBindingId,
      claimAttempt: proof.claimAttempt,
      claimTokenHash: hashClaimToken(proof.claimToken),
    },
  })
}

export async function markRelayPrintJobExecuting(
  scope: RelayAgentScope,
  jobId: string,
  proof: RelayClaimProof,
  timing: RelayTimingConfig,
  now = new Date(),
) {
  const current = await findClaimedJob(scope, jobId, proof)
  if (!current) throw new RelayServiceError('ES_TRAY_02_STALE_CLAIM', 409)
  if (current.status === 'EXECUTING') return { idempotent: true, job: serializeJob(current) }
  if (current.status !== 'CLAIMED') {
    throw new RelayServiceError('ES_TRAY_02_JOB_NOT_CLAIMED', 409)
  }
  if (!current.leaseExpiresAt || current.leaseExpiresAt.getTime() <= now.getTime()) {
    throw new RelayServiceError('ES_TRAY_02_CLAIM_LEASE_EXPIRED', 409)
  }

  const executionDeadline = new Date(now.getTime() + timing.executionTimeoutMs)
  const updated = await prisma.eshopTrayPrintJob.updateMany({
    where: {
      id: current.id,
      schemaVersion: scope.schemaVersion ?? 1,
      tenantId: scope.tenantId,
      storeId: scope.storeId,
      claimedByComputerBindingId: scope.computerBindingId,
      claimAttempt: proof.claimAttempt,
      claimTokenHash: current.claimTokenHash,
      status: 'CLAIMED',
      leaseExpiresAt: { gt: now },
    },
    data: {
      status: 'EXECUTING',
      executingAt: now,
      leaseExpiresAt: executionDeadline,
      effectBoundary: 'CROSSING_UNKNOWN',
      physicalCompletionKnown: false,
    },
  })
  if (updated.count !== 1) {
    const latest = await findClaimedJob(scope, jobId, proof)
    if (latest?.status === 'EXECUTING') return { idempotent: true, job: serializeJob(latest) }
    throw new RelayServiceError('ES_TRAY_02_CLAIM_STATE_CHANGED', 409)
  }
  const job = await findClaimedJob(scope, jobId, proof)
  if (!job) throw new RelayServiceError('ES_TRAY_02_STALE_CLAIM', 409)
  return { idempotent: false, job: serializeJob(job) }
}

function sameTerminalResult(job: EshopTrayPrintJob, result: RelayTerminalResult) {
  return job.status === result.state
    && job.resultStatus === (result.state === 'SUCCEEDED' ? 'SUCCESS' : 'FAILURE')
    && job.resultCode === result.resultCode
    && job.resultMessage === (result.resultMessage ?? null)
    && job.effectBoundary === result.effectBoundary
    && job.physicalCompletionKnown === false
}

export async function completeRelayPrintJob(
  scope: RelayAgentScope,
  jobId: string,
  result: RelayTerminalResult,
  now = new Date(),
) {
  const current = await findClaimedJob(scope, jobId, result)
  if (!current) throw new RelayServiceError('ES_TRAY_02_STALE_CLAIM', 409)
  if (current.status === 'SUCCEEDED' || current.status === 'FAILED') {
    if (!sameTerminalResult(current, result)) {
      throw new RelayServiceError('ES_TRAY_02_RESULT_CONFLICT', 409)
    }
    return { idempotent: true, job: serializeJob(current) }
  }

  const preExecutionFailure = current.status === 'CLAIMED'
    && result.state === 'FAILED'
    && result.effectBoundary !== 'CROSSED'
  if (current.status !== 'EXECUTING' && !preExecutionFailure) {
    throw new RelayServiceError('ES_TRAY_02_JOB_NOT_EXECUTING', 409)
  }

  const updated = await prisma.eshopTrayPrintJob.updateMany({
    where: {
      id: current.id,
      schemaVersion: scope.schemaVersion ?? 1,
      tenantId: scope.tenantId,
      storeId: scope.storeId,
      claimedByComputerBindingId: scope.computerBindingId,
      claimAttempt: result.claimAttempt,
      claimTokenHash: current.claimTokenHash,
      status: { in: preExecutionFailure ? ['CLAIMED'] : ['EXECUTING'] },
    },
    data: {
      status: result.state,
      completedAt: now,
      leaseExpiresAt: null,
      resultStatus: result.state === 'SUCCEEDED' ? 'SUCCESS' : 'FAILURE',
      resultCode: result.resultCode,
      resultMessage: result.resultMessage ?? null,
      effectBoundary: result.effectBoundary,
      physicalCompletionKnown: false,
    },
  })
  if (updated.count !== 1) {
    const latest = await findClaimedJob(scope, jobId, result)
    if (latest && sameTerminalResult(latest, result)) {
      return { idempotent: true, job: serializeJob(latest) }
    }
    throw new RelayServiceError('ES_TRAY_02_RESULT_CONFLICT', 409)
  }
  const job = await findClaimedJob(scope, jobId, result)
  if (!job) throw new RelayServiceError('ES_TRAY_02_STALE_CLAIM', 409)
  return { idempotent: false, job: serializeJob(job) }
}
