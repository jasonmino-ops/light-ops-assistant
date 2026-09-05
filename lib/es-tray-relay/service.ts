import { Prisma, type EshopTrayPrintJob } from '@prisma/client'
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
}

export type ClaimedRelayJob = {
  id: string
  schemaVersion: typeof ES_TRAY_RELAY_SCHEMA_VERSION
  idempotencyKey: string
  requestHash: string
  claimAttempt: number
  claimToken: string
  leaseExpiresAt: string
  request: EshopTrayPrintRequest
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

function storedRequest(job: EshopTrayPrintJob): EshopTrayPrintRequest {
  try {
    return parsePrintRequest(job.payload)
  } catch {
    throw new RelayServiceError('ES_TRAY_02_STORED_PAYLOAD_INVALID', 500)
  }
}

export async function enqueueRelayPrintJob(
  scope: RelayStoreScope,
  request: EshopTrayPrintRequest,
  timing: RelayTimingConfig,
  now = new Date(),
) {
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
  scope: RelayStoreScope,
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

    const candidates = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
        FROM "EshopTrayPrintJob"
       WHERE "tenantId" = ${scope.tenantId}
         AND "storeId" = ${scope.storeId}
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
    let request: EshopTrayPrintRequest
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
      schemaVersion: ES_TRAY_RELAY_SCHEMA_VERSION,
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
  return prisma.eshopTrayPrintJob.findFirst({
    where: {
      id: jobId,
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
