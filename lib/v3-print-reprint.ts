import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ES_TRAY_MAX_COMMAND_BYTES } from '@/lib/es-tray-relay/config'
import {
  enqueueV3PrintIntent,
  isV3PrintIntentIdempotencyConflict,
  type V3PrintRole,
} from '@/lib/v3-print-job-adapter'
import { V3_PRINT_INTENT_TTL_MS } from '@/lib/v3-print-identity'
import {
  canonicalV3OriginalPrintJobId,
  readV3OperatorPrintStatesWithDb,
  verifyV3OperatorRecoveryProof,
} from '@/lib/v3-print-operator-status'

const ORDER_NO_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const REQUEST_ID_PATTERN = /^v3-reprint:(front|kitchen):[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export type V3ReprintRequest = {
  schemaVersion: 3
  requestId: string
  orderNo: string
  role: V3PrintRole
  confirmation: 'OPERATOR_CONFIRMED'
  rendererVersion: 'reprint-raw-v1'
  commandStream: {
    encoding: 'base64'
    byteLength: number
    sha256: string
    data: string
  }
  recoveryProof?: string
}

export type V3ReprintActor =
  | { kind: 'ACCOUNT'; userId: string; role: 'OWNER' | 'STAFF' }
  | {
    kind: 'DESKTOP_DEVICE'
    browserPosDeviceId: string
    computerBindingId: string
  }
  | {
    kind: 'DESKTOP_DEVICE'
    browserPosDeviceId: string
    desktopDeviceId: string
  }

export class V3ReprintError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super(code)
    this.name = 'V3ReprintError'
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function exactKeys(value: Record<string, unknown>, required: readonly string[]) {
  const allowed = new Set(required)
  return required.every((key) => key in value) && Object.keys(value).every((key) => allowed.has(key))
}

function decodeCanonicalBase64(value: string): Buffer {
  if (
    !value
    || value.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) throw new V3ReprintError('V3_REPRINT_COMMAND_STREAM_INVALID', 400)
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) throw new V3ReprintError('V3_REPRINT_COMMAND_STREAM_INVALID', 400)
  return bytes
}

export function parseV3ReprintRequest(value: unknown): V3ReprintRequest {
  const body = object(value)
  const requiredKeys = [
    'schemaVersion', 'requestId', 'orderNo', 'role', 'confirmation', 'rendererVersion', 'commandStream',
  ] as const
  if (!body || (!exactKeys(body, requiredKeys) && !exactKeys(body, [...requiredKeys, 'recoveryProof']))) {
    throw new V3ReprintError('V3_REPRINT_REQUEST_INVALID', 400)
  }
  if (body.schemaVersion !== 3) throw new V3ReprintError('V3_REPRINT_SCHEMA_INVALID', 400)
  if (body.role !== 'FRONT' && body.role !== 'KITCHEN') throw new V3ReprintError('V3_REPRINT_ROLE_INVALID', 400)
  if (typeof body.requestId !== 'string' || !REQUEST_ID_PATTERN.test(body.requestId)) {
    throw new V3ReprintError('V3_REPRINT_IDENTITY_INVALID', 400)
  }
  const requestRole = REQUEST_ID_PATTERN.exec(body.requestId)?.[1]?.toUpperCase()
  if (requestRole !== body.role) throw new V3ReprintError('V3_REPRINT_IDENTITY_ROLE_MISMATCH', 400)
  if (typeof body.orderNo !== 'string' || !ORDER_NO_PATTERN.test(body.orderNo)) {
    throw new V3ReprintError('V3_REPRINT_ORDER_INVALID', 400)
  }
  if (body.confirmation !== 'OPERATOR_CONFIRMED' || body.rendererVersion !== 'reprint-raw-v1') {
    throw new V3ReprintError('V3_REPRINT_CONFIRMATION_INVALID', 400)
  }
  const stream = object(body.commandStream)
  if (!stream || !exactKeys(stream, ['encoding', 'byteLength', 'sha256', 'data']) || stream.encoding !== 'base64' ||
    !Number.isInteger(stream.byteLength) || Number(stream.byteLength) < 1 || Number(stream.byteLength) > ES_TRAY_MAX_COMMAND_BYTES ||
    typeof stream.sha256 !== 'string' || !SHA256_PATTERN.test(stream.sha256) || typeof stream.data !== 'string') {
    throw new V3ReprintError('V3_REPRINT_COMMAND_STREAM_INVALID', 400)
  }
  const bytes = decodeCanonicalBase64(stream.data)
  if (bytes.byteLength !== Number(stream.byteLength)) throw new V3ReprintError('V3_REPRINT_COMMAND_LENGTH_MISMATCH', 400)
  if (createHash('sha256').update(bytes).digest('hex') !== stream.sha256) {
    throw new V3ReprintError('V3_REPRINT_COMMAND_DIGEST_MISMATCH', 400)
  }
  if ('recoveryProof' in body && (typeof body.recoveryProof !== 'string' || body.recoveryProof.length > 4096)) {
    throw new V3ReprintError('V3_REPRINT_RECOVERY_PROOF_INVALID', 400)
  }
  return {
    schemaVersion: 3,
    requestId: body.requestId,
    orderNo: body.orderNo,
    role: body.role,
    confirmation: 'OPERATOR_CONFIRMED',
    rendererVersion: 'reprint-raw-v1',
    commandStream: {
      encoding: 'base64',
      byteLength: Number(stream.byteLength),
      sha256: stream.sha256,
      data: stream.data,
    },
    ...(typeof body.recoveryProof === 'string' ? { recoveryProof: body.recoveryProof } : {}),
  }
}

export async function readV3ReprintAvailabilityWithDb(
  db: Pick<typeof prisma, 'store' | 'v3PrintControlPlane' | 'eshopTrayPrintJob'>,
  scope: { tenantId: string; storeId: string },
  input?: { orderNo?: string; desktopDeviceId?: string },
) {
  const [store, controlPlane] = await Promise.all([
    db.store.findFirst({
      where: { id: scope.storeId, tenantId: scope.tenantId, status: 'ACTIVE', tenant: { status: 'ACTIVE' } },
      select: { printKitchenTicket: true },
    }),
    db.v3PrintControlPlane.findUnique({
      where: { storeId: scope.storeId },
      select: { tenantId: true, mode: true },
    }),
  ])
  const authoritativeMode = store && controlPlane?.tenantId === scope.tenantId ? controlPlane.mode : null
  const enabled = authoritativeMode === 'V3_ACTIVE'
  const result: {
    enabled: boolean
    kitchenEnabled: boolean
    legacyAllowed: boolean
    roles?: Awaited<ReturnType<typeof readV3OperatorPrintStatesWithDb>>
  } = {
    enabled,
    kitchenEnabled: enabled && store!.printKitchenTicket,
    legacyAllowed: authoritativeMode === 'V2_ACTIVE',
  }
  if (enabled && input?.orderNo) {
    result.roles = await readV3OperatorPrintStatesWithDb(db, scope, {
      orderNo: input.orderNo,
      kitchenEnabled: result.kitchenEnabled,
      desktopDeviceId: input.desktopDeviceId,
    })
  }
  return result
}

export function readV3ReprintAvailability(
  scope: { tenantId: string; storeId: string },
  input?: { orderNo?: string; desktopDeviceId?: string },
) {
  return readV3ReprintAvailabilityWithDb(prisma, scope, input)
}

export async function enqueueV3ManualReprint(
  scope: { tenantId: string; storeId: string },
  actor: V3ReprintActor,
  request: V3ReprintRequest,
  now = new Date(),
) {
  return enqueueV3ManualReprintWithDb(prisma, scope, actor, request, now)
}

function isReprintTransactionConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false
  if (error.code === 'P2034') return true
  if (error.code !== 'P2010') return false
  // Prisma 7 + adapter-pg preserves the SQLSTATE here for raw-query errors.
  // Neither a generic P2010 nor an error-message substring proves a conflict.
  const adapterError = error.meta?.driverAdapterError
  if (!adapterError || typeof adapterError !== 'object' || !('cause' in adapterError)) return false
  const cause = adapterError.cause
  return Boolean(cause && typeof cause === 'object' && 'originalCode' in cause
    && (cause.originalCode === '40001' || cause.originalCode === '40P01'))
}

export async function enqueueV3ManualReprintWithDb(
  db: Pick<typeof prisma, '$transaction'>,
  scope: { tenantId: string; storeId: string },
  actor: V3ReprintActor,
  request: V3ReprintRequest,
  now = new Date(),
) {
  const intent = {
    schemaVersion: 3 as const,
    printJobId: request.requestId,
    source: 'CLOUD_REMOTE_REPRINT' as const,
    role: request.role,
    payloadKind: 'RAW_BYTES' as const,
    orderNo: request.orderNo,
    rendererVersion: request.rendererVersion,
    payloadBase64: request.commandStream.data,
    byteLength: request.commandStream.byteLength,
    payloadHash: request.commandStream.sha256,
  }
  const expectedRequestHash = createHash('sha256').update(JSON.stringify(intent)).digest('hex')
  const readCommittedIdempotentResult = () => db.$transaction(async (tx) => {
    const job = await tx.eshopTrayPrintJob.findUnique({
      where: { tenantId_storeId_idempotencyKey: {
        tenantId: scope.tenantId,
        storeId: scope.storeId,
        idempotencyKey: request.requestId,
      } },
    })
    if (!job) return null
    if (job.schemaVersion !== 3 || job.requestHash !== expectedRequestHash) {
      throw new V3ReprintError('V3_REPRINT_IDEMPOTENCY_CONFLICT', 409)
    }
    const audit = await tx.operationLog.findFirst({
      where: {
        tenantId: scope.tenantId,
        storeId: scope.storeId,
        actionType: 'V3_PRINT_MANUAL_REPRINT_REQUESTED',
        requestId: request.requestId,
      },
      select: { id: true },
    })
    if (!audit) throw new V3ReprintError('V3_REPRINT_AUDIT_MISSING', 409)
    return {
      created: false,
      jobId: job.id,
      requestId: request.requestId,
      orderNo: request.orderNo,
      role: request.role,
    }
  })
  try {
    return await db.$transaction(async (tx) => {
      const lockedOrderRows = tx.$queryRaw
        ? await tx.$queryRaw<Array<{ id: string; status: string }>>`
            SELECT "id", "status"
            FROM "CustomerOrder"
            WHERE "tenantId" = ${scope.tenantId} AND "storeId" = ${scope.storeId} AND "orderNo" = ${request.orderNo}
            FOR UPDATE
          `
        : []
      const [store, controlPlane, sale, customerOrder, original] = await Promise.all([
        tx.store.findFirst({
          where: { id: scope.storeId, tenantId: scope.tenantId, status: 'ACTIVE', tenant: { status: 'ACTIVE' } },
          select: { printKitchenTicket: true },
        }),
        tx.v3PrintControlPlane.findUnique({
          where: { storeId: scope.storeId },
          select: { tenantId: true, mode: true },
        }),
        tx.saleRecord.findFirst({
          where: { tenantId: scope.tenantId, storeId: scope.storeId, orderNo: request.orderNo },
          select: { id: true },
        }),
        tx.customerOrder.findFirst({
          where: { tenantId: scope.tenantId, storeId: scope.storeId, orderNo: request.orderNo },
          select: { id: true },
        }),
        tx.eshopTrayPrintJob.findUnique({
          where: { tenantId_storeId_idempotencyKey: {
            tenantId: scope.tenantId,
            storeId: scope.storeId,
            idempotencyKey: canonicalV3OriginalPrintJobId(request.orderNo, request.role),
          } },
        }),
      ])
      if (!store) throw new V3ReprintError('V3_REPRINT_STORE_UNAVAILABLE', 403)
      if (!controlPlane || controlPlane.tenantId !== scope.tenantId || controlPlane.mode !== 'V3_ACTIVE') {
        throw new V3ReprintError('V3_REPRINT_MODE_NOT_ACTIVE', 409)
      }
      if (!sale && !customerOrder) throw new V3ReprintError('V3_REPRINT_ORDER_NOT_FOUND', 404)
      const lockedOrder = lockedOrderRows[0]
      if (request.role === 'KITCHEN' && lockedOrder?.status === 'CANCELLED') {
        throw new V3ReprintError('V3_REPRINT_CANCELLED_H5_KITCHEN_FORBIDDEN', 409)
      }
      if (request.role === 'KITCHEN' && !store.printKitchenTicket) {
        throw new V3ReprintError('V3_REPRINT_KITCHEN_DISABLED', 409)
      }
      if (!original || original.schemaVersion !== 3) {
        throw new V3ReprintError('V3_REPRINT_ORIGINAL_NOT_TERMINAL', 409)
      }
      const h5Intent = customerOrder && tx.customerOrderFulfillmentIntent
        ? await tx.customerOrderFulfillmentIntent.findUnique({
            where: { tenantId_storeId_orderNo_purpose: { tenantId: scope.tenantId, storeId: scope.storeId, orderNo: request.orderNo,
              purpose: request.role === 'KITCHEN' ? 'KITCHEN_MAKE' : 'FRONT_PAID' } },
          })
        : null
      if (customerOrder && !sale && (!h5Intent || h5Intent.source !== 'H5_HOME')) {
        throw new V3ReprintError('V3_REPRINT_H5_IDENTITY_MISMATCH', 409)
      }
      if (h5Intent?.source === 'H5_HOME') {
        if (h5Intent.state === 'CANCELLED' || h5Intent.cancelResultCode === 'CUSTOMER_ORDER_CANCELLED_BEFORE_CLAIM') {
          throw new V3ReprintError('V3_REPRINT_CANCELLED_H5_KITCHEN_FORBIDDEN', 409)
        }
        if (h5Intent.idempotencyKey !== original.idempotencyKey || h5Intent.idempotencyKey !== canonicalV3OriginalPrintJobId(request.orderNo, request.role)) {
          throw new V3ReprintError('V3_REPRINT_H5_IDENTITY_MISMATCH', 409)
        }
        if (!h5Intent.payloadHash || !h5Intent.payloadBase64 || h5Intent.payloadHash !== request.commandStream.sha256 || h5Intent.payloadBase64 !== request.commandStream.data) {
          throw new V3ReprintError('V3_REPRINT_H5_SEALED_PAYLOAD_REQUIRED', 409)
        }
      }
      if (
        original.effectBoundary === 'CROSSING_UNKNOWN'
        || original.resultStatus === 'CROSSING_UNKNOWN'
        || original.resultCode?.endsWith(':CROSSING_UNKNOWN')
      ) throw new V3ReprintError('V3_REPRINT_ORIGINAL_UNKNOWN', 409)

      const originalTerminal = Boolean(
        original.completedAt
        && original.resultCode
        && (
          (original.status === 'SUCCEEDED' && original.resultStatus === 'CROSSED' && original.effectBoundary === 'CROSSED')
          || (original.status === 'FAILED' && original.resultStatus === 'FAILED_NOT_CROSSED' && original.effectBoundary === 'NOT_CROSSED')
        ),
      )
      if (!originalTerminal) {
        if (actor.kind !== 'DESKTOP_DEVICE' || !('desktopDeviceId' in actor)) {
          throw new V3ReprintError('V3_REPRINT_RECOVERY_DESKTOP_REQUIRED', 409)
        }
        const originalJobId = canonicalV3OriginalPrintJobId(request.orderNo, request.role)
        const proof = request.recoveryProof && verifyV3OperatorRecoveryProof(request.recoveryProof, {
          tenantId: scope.tenantId,
          storeId: scope.storeId,
          desktopDeviceId: actor.desktopDeviceId,
          orderNo: request.orderNo,
          role: request.role,
          originalJobId,
        }, original, now)
        if (!proof) throw new V3ReprintError('V3_REPRINT_RECOVERY_PROOF_INVALID', 409)
        const terminalized = await tx.eshopTrayPrintJob.updateMany({
          where: {
            id: original.id,
            tenantId: scope.tenantId,
            storeId: scope.storeId,
            schemaVersion: 3,
            status: 'PENDING',
            completedAt: null,
            claimTokenHash: original.claimTokenHash,
            updatedAt: original.updatedAt,
            resultStatus: null,
            resultCode: null,
            effectBoundary: null,
            physicalCompletionKnown: false,
          },
          data: {
            status: 'FAILED',
            resultStatus: 'FAILED_NOT_CROSSED',
            effectBoundary: 'NOT_CROSSED',
            completedAt: now,
            resultCode: `V3_OPERATOR_RECOVERY:${request.requestId}`,
            resultMessage: 'V3_OPERATOR_RECOVERY_LEDGER_ABSENT',
            claimTokenHash: null,
            leaseExpiresAt: null,
            claimedByComputerBindingId: null,
            physicalCompletionKnown: false,
          },
        })
        if (terminalized.count !== 1) throw new V3ReprintError('V3_REPRINT_CONCURRENT_STATE_CHANGE', 409)
        await tx.operationLog.create({ data: {
          tenantId: scope.tenantId,
          storeId: scope.storeId,
          userId: null,
          actionType: 'V3_PRINT_OPERATOR_RECOVERY_COMMITTED',
          targetType: 'EshopTrayPrintJob',
          targetId: original.id,
          requestId: request.requestId,
          status: 'SUCCESS',
          message: `${request.role} original terminalized before operator reprint`,
          payloadSnapshot: {
            schemaVersion: 1,
            originalJobId,
            orderNo: request.orderNo,
            role: request.role,
            recoveryEvidence: 'AUTHENTICATED_DESKTOP_LEDGER_ABSENT',
            desktopDeviceId: actor.desktopDeviceId,
            proofIssuedAt: proof.issuedAt,
            committedAt: now.toISOString(),
          } as Prisma.InputJsonValue,
        } })
      }

      const result = await enqueueV3PrintIntent(
        tx as unknown as Parameters<typeof enqueueV3PrintIntent>[0],
        scope,
        intent,
        new Date(now.getTime() + V3_PRINT_INTENT_TTL_MS),
        { idempotencyConflict: 'THROW' },
      )
      if (result.created) {
        await tx.operationLog.create({ data: {
          tenantId: scope.tenantId,
          storeId: scope.storeId,
          userId: actor.kind === 'ACCOUNT' ? actor.userId : null,
          actionType: 'V3_PRINT_MANUAL_REPRINT_REQUESTED',
          targetType: 'SaleOrder',
          targetId: request.orderNo,
          requestId: request.requestId,
          status: 'SUCCESS',
          message: `${request.role} manual reprint`,
          payloadSnapshot: {
            schemaVersion: 3,
            source: 'CLOUD_REMOTE_REPRINT',
            orderNo: request.orderNo,
            role: request.role,
            printJobId: request.requestId,
            actor: actor.kind === 'ACCOUNT'
              ? { kind: actor.kind, userId: actor.userId, role: actor.role }
              : 'desktopDeviceId' in actor
                ? { kind: actor.kind, browserPosDeviceId: actor.browserPosDeviceId, desktopDeviceId: actor.desktopDeviceId }
                : { kind: actor.kind, browserPosDeviceId: actor.browserPosDeviceId, computerBindingId: actor.computerBindingId },
            confirmedAt: now.toISOString(),
          } as Prisma.InputJsonValue,
        } })
      } else {
        const audit = await tx.operationLog.findFirst({
          where: {
            tenantId: scope.tenantId,
            storeId: scope.storeId,
            actionType: 'V3_PRINT_MANUAL_REPRINT_REQUESTED',
            requestId: request.requestId,
          },
          select: { id: true },
        })
        if (!audit) throw new V3ReprintError('V3_REPRINT_AUDIT_MISSING', 409)
      }
      return {
        created: result.created,
        jobId: result.job.id,
        requestId: request.requestId,
        orderNo: request.orderNo,
        role: request.role,
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch (error) {
    if (error instanceof V3ReprintError) throw error
    if (isV3PrintIntentIdempotencyConflict(error)) {
      const recovered = await readCommittedIdempotentResult()
      if (recovered) return recovered
      throw error
    }
    if (isReprintTransactionConflict(error)) {
      const recovered = await readCommittedIdempotentResult()
      if (recovered) return recovered
      throw new V3ReprintError('V3_REPRINT_CONCURRENT_STATE_CHANGE', 409)
    }
    throw error
  }
}
