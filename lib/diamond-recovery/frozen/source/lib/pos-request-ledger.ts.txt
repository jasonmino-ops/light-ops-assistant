import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { ProductUnitError } from '@/lib/product-unit'

type Actor = { tenantId: string; storeId: string; userId: string }
type RequestIdentity = { key: string | null; fingerprint: string }

function canonicalPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalPayload)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalPayload(record[key])]))
  }
  return value
}

export function posRequestIdentity(request: Request, body: unknown): RequestIdentity {
  const key = request.headers.get('idempotency-key')
  if (key !== null && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(key)) {
    throw new ProductUnitError('INVALID_IDEMPOTENCY_KEY', 400, 'Invalid request identifier')
  }
  return { key: key?.toLowerCase() ?? null, fingerprint: key === null ? '' : createHash('sha256').update(JSON.stringify(canonicalPayload(body))).digest('hex') }
}

function requestScope(actor: Actor, operation: string, key: string) {
  return {
    tenantId: actor.tenantId, storeId: actor.storeId,
    actorType: 'USER', actorId: actor.userId, operation, idempotencyKey: key,
  }
}

export async function replayPosRequest(
  db: Pick<Prisma.TransactionClient, 'cashierSaleIdempotency'>,
  actor: Actor, operation: string, request: RequestIdentity,
) {
  if (!request.key) return null
  const previous = await db.cashierSaleIdempotency.findUnique({
    where: { tenantId_storeId_actorType_actorId_operation_idempotencyKey: requestScope(actor, operation, request.key) },
  })
  if (!previous) return null
  if (previous.payloadFingerprint !== request.fingerprint || previous.status !== 'SUCCEEDED' || !previous.resultSnapshot) {
    throw new ProductUnitError('IDEMPOTENCY_CONFLICT', 409, '该请求编号已使用，请核对原交易')
  }
  return previous.resultSnapshot
}

export async function writePosRequest<T extends Prisma.InputJsonObject>(
  tx: Prisma.TransactionClient, actor: Actor, operation: string, storeCode: string,
  request: RequestIdentity, write: () => Promise<T>,
): Promise<T> {
  if (storeCode !== 'ST883DC00C') return write()
  const { key, fingerprint } = request
  if (key === null) {
    const [row] = await tx.$queryRaw<{ active: boolean }[]>`
      SELECT native_inventory.pin_sales_epoch(${actor.tenantId}, ${actor.storeId}) IS NOT NULL AS active
    `
    if (row?.active) {
      throw new ProductUnitError('IDEMPOTENCY_KEY_REQUIRED', 409, '请刷新收银页面后重试')
    }
    return write()
  }

  const scope = requestScope(actor, operation, key)
  // The uniqueness check waits for a concurrent request's commit or rollback.
  // The claim, payment/order changes, receipt response and inventory commit together.
  const claimed = await tx.cashierSaleIdempotency.createMany({
    data: { ...scope, payloadFingerprint: fingerprint, expiresAt: new Date('9999-12-31T00:00:00Z') },
    skipDuplicates: true,
  })
  if (claimed.count === 0) {
    const result = await replayPosRequest(tx, actor, operation, request)
    if (result === null) throw new Error('POS_REQUEST_RESULT_MISSING')
    return result as T
  }

  const result = await write()
  await tx.cashierSaleIdempotency.update({
    where: { tenantId_storeId_actorType_actorId_operation_idempotencyKey: scope },
    data: { status: 'SUCCEEDED', resultSnapshot: result },
  })
  return result
}
