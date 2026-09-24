import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ES_TRAY_MAX_COMMAND_BYTES } from '@/lib/es-tray-relay/config'
import { enqueueV3PrintIntent, type V3PrintRole } from '@/lib/v3-print-job-adapter'
import { canonicalV3PrintEffectKey, V3_PRINT_INTENT_TTL_MS } from '@/lib/v3-print-identity'

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
}

export type V3ReprintActor =
  | { kind: 'ACCOUNT'; userId: string; role: 'OWNER' | 'STAFF' }
  | { kind: 'DESKTOP_DEVICE'; browserPosDeviceId: string; computerBindingId: string }

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
  if (!body || !exactKeys(body, [
    'schemaVersion', 'requestId', 'orderNo', 'role', 'confirmation', 'rendererVersion', 'commandStream',
  ])) throw new V3ReprintError('V3_REPRINT_REQUEST_INVALID', 400)
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
  }
}

export async function readV3ReprintAvailabilityWithDb(
  db: Pick<typeof prisma, 'store' | 'v3PrintControlPlane'>,
  scope: { tenantId: string; storeId: string },
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
  return {
    enabled,
    kitchenEnabled: enabled && store!.printKitchenTicket,
    legacyAllowed: authoritativeMode === 'V2_ACTIVE',
  }
}

export function readV3ReprintAvailability(scope: { tenantId: string; storeId: string }) {
  return readV3ReprintAvailabilityWithDb(prisma, scope)
}

function originalPrintJobId(orderNo: string, role: V3PrintRole) {
  return `network:${createHash('sha256').update(canonicalV3PrintEffectKey(orderNo, role)).digest('hex')}`
}

export async function enqueueV3ManualReprint(
  scope: { tenantId: string; storeId: string },
  actor: V3ReprintActor,
  request: V3ReprintRequest,
  now = new Date(),
) {
  return enqueueV3ManualReprintWithDb(prisma, scope, actor, request, now)
}

export async function enqueueV3ManualReprintWithDb(
  db: Pick<typeof prisma, '$transaction'>,
  scope: { tenantId: string; storeId: string },
  actor: V3ReprintActor,
  request: V3ReprintRequest,
  now = new Date(),
) {
  try {
    return await db.$transaction(async (tx) => {
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
            idempotencyKey: originalPrintJobId(request.orderNo, request.role),
          } },
          select: { schemaVersion: true, effectBoundary: true, resultStatus: true, resultCode: true },
        }),
      ])
      if (!store) throw new V3ReprintError('V3_REPRINT_STORE_UNAVAILABLE', 403)
      if (!controlPlane || controlPlane.tenantId !== scope.tenantId || controlPlane.mode !== 'V3_ACTIVE') {
        throw new V3ReprintError('V3_REPRINT_MODE_NOT_ACTIVE', 409)
      }
      if (!sale && !customerOrder) throw new V3ReprintError('V3_REPRINT_ORDER_NOT_FOUND', 404)
      if (request.role === 'KITCHEN' && !store.printKitchenTicket) {
        throw new V3ReprintError('V3_REPRINT_KITCHEN_DISABLED', 409)
      }
      if (original?.schemaVersion === 3 && (
        original.effectBoundary === 'CROSSING_UNKNOWN'
        || original.resultStatus === 'CROSSING_UNKNOWN'
        || original.resultCode?.endsWith(':CROSSING_UNKNOWN')
      )) throw new V3ReprintError('V3_REPRINT_ORIGINAL_UNKNOWN', 409)
      if (original?.schemaVersion === 3 &&
        original.resultStatus !== 'CROSSED' && original.resultStatus !== 'FAILED_NOT_CROSSED') {
        throw new V3ReprintError('V3_REPRINT_ORIGINAL_NOT_TERMINAL', 409)
      }

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
      const result = await enqueueV3PrintIntent(
        tx as unknown as Parameters<typeof enqueueV3PrintIntent>[0],
        scope,
        intent,
        new Date(now.getTime() + V3_PRINT_INTENT_TTL_MS),
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
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      throw new V3ReprintError('V3_REPRINT_CONCURRENT_STATE_CHANGE', 409)
    }
    throw error
  }
}
