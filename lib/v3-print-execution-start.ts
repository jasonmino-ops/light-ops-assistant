import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { canonicalV3PrintEffectKey, type V3PrintEffectRole } from './v3-print-identity'

type Scope = { tenantId: string; storeId: string }
type OriginDb = Pick<Prisma.TransactionClient, 'operationLog' | 'paymentIntent' | 'saleRecord' | 'customerOrder' | 'customerOrderFulfillmentIntent' | 'diningBatch' | 'diningMeal'>

export type PrintExecutionStart = {
  deviceId: string
  ownerEpoch: number
  startedAt: string
}

export type PrintOrigin = {
  orderNo: string
  role: V3PrintEffectRole
  printJobId: string
}

// The normal immutable HANDOFF_CONFIRMED audit doubles as the execution boundary.
// Its epoch suffix sorts numerically even if transactions began in the opposite order.
export function printStartId(scope: Scope, epoch?: number) {
  const prefix = 'v3-print-start:' + createHash('sha256').update(JSON.stringify([scope.tenantId, scope.storeId])).digest('hex') + ':'
  return epoch === undefined ? prefix : prefix + String(epoch).padStart(16, '0')
}

export async function readPrintExecutionStart(db: Pick<OriginDb, 'operationLog'>, scope: Scope): Promise<PrintExecutionStart | null> {
  const row = await db.operationLog.findFirst({ where: { tenantId: scope.tenantId, storeId: scope.storeId,
    id: { gte: printStartId(scope, 0), lte: printStartId(scope, Number.MAX_SAFE_INTEGER) } }, orderBy: { id: 'desc' },
    select: { id: true, actionType: true, targetType: true, message: true, status: true, payloadSnapshot: true } })
  if (!row) return null
  const fact = row.payloadSnapshot as Record<string, unknown> | null
  const epoch = fact?.ownerEpoch
  const deviceId = fact?.intendedOwnerDeviceId
  const startedAt = fact?.occurredAt
  if (row.actionType !== 'V3_PRINT_CONTROLLED_HANDOFF' || row.message !== 'HANDOFF_CONFIRMED' || row.targetType !== 'V3PrintControlPlane' ||
      row.status !== 'SUCCESS' || fact?.replacement !== true || typeof deviceId !== 'string' || !deviceId ||
      typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 1 || row.id !== printStartId(scope, epoch) ||
      typeof startedAt !== 'string' || !Number.isFinite(Date.parse(startedAt)) ||
      new Date(startedAt).toISOString() !== startedAt) throw new Error('V3_PRINT_EXECUTION_START_INVALID')
  return { deviceId, ownerEpoch: epoch, startedAt }
}

export async function isPrintOriginAfterStart(db: OriginDb, scope: Scope, start: PrintExecutionStart, effect: PrintOrigin): Promise<boolean> {
  const { orderNo, role, printJobId } = effect
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(orderNo) || (role !== 'FRONT' && role !== 'KITCHEN')) return false
  const since = new Date(start.startedAt)
  if (printJobId.startsWith('v3-reprint:')) {
    if (!printJobId.startsWith('v3-reprint:' + role.toLowerCase() + ':')) return false
    const audit = await db.operationLog.findFirst({ where: { ...scope, targetType: 'SaleOrder', targetId: orderNo,
      actionType: 'V3_PRINT_MANUAL_REPRINT_REQUESTED', status: 'SUCCESS', requestId: printJobId, createdAt: { gt: since },
      payloadSnapshot: { path: ['role'], equals: role } }, select: { id: true } })
    return audit !== null
  }
  const original = 'network:' + createHash('sha256').update(canonicalV3PrintEffectKey(orderNo, role)).digest('hex')
  // A fulfillment intent is born with the business event and can reach the print queue much later.
  const h5 = await db.customerOrderFulfillmentIntent.findFirst({ where: { ...scope, orderNo, role, idempotencyKey: printJobId },
    select: { purpose: true, paymentEventAt: true } })
  const dates: Date[] = []
  if (h5) {
    if (role === 'KITCHEN' ? h5.purpose !== 'KITCHEN_MAKE' : !['FRONT_PAID', 'FRONT_UNPAID'].includes(h5.purpose)) return false
    const order = await db.customerOrder.findFirst({ where: { ...scope, orderNo }, select: { createdAt: true, paidAt: true } })
    if (!order) return false
    const eventAt = h5.purpose === 'FRONT_PAID' ? order.paidAt : order.createdAt
    if (!eventAt || (h5.purpose === 'FRONT_PAID' && eventAt.getTime() !== h5.paymentEventAt?.getTime())) return false
    dates.push(eventAt)
  }
  if (printJobId === original) {
    const suffix = /^(.*)\.([1-9]\d{0,8})$/.exec(orderNo)
    if (role === 'KITCHEN' && suffix) {
      const notice = await db.diningBatch.findFirst({ where: { ...scope, seq: Number(suffix[2]),
        meal: { ...scope, billNo: suffix[1] }, noticeRequired: true, noticeClaimedAt: { not: null }, noticeWithdrawnAt: null },
        select: { createdAt: true } })
      if (notice) dates.push(notice.createdAt)
    }
    if (role === 'FRONT') {
      const meal = await db.diningMeal.findFirst({ where: { ...scope, billNo: orderNo },
        select: { paymentIntent: { select: { tenantId: true, storeId: true, orderNo: true, paidAt: true, createdAt: true, status: true } } } })
      if (meal) {
        const payment = meal.paymentIntent
        if (!payment?.paidAt || payment.status !== 'PAID' || payment.tenantId !== scope.tenantId ||
          payment.storeId !== scope.storeId || payment.orderNo !== orderNo) return false
        dates.push(payment.createdAt)
      }
    }
    const sales = await db.saleRecord.findMany({ where: { ...scope, orderNo, saleType: 'SALE', diningBatchId: null },
      select: { offlineOrderId: true, source: true } })
    if (sales.some(row => row.offlineOrderId !== null || row.source === 'CASHIER_OFFLINE')) return false
    if (sales.length) {
      // Display ordering can deliberately backdate sale lines. The original payment row is born in the sale transaction.
      const payment = await db.paymentIntent.findFirst({ where: { ...scope, orderNo }, select: { createdAt: true } })
      if (!payment) return false
      dates.push(payment.createdAt)
    }
  }
  // Multiple independent business origins with one effect identity are ambiguous.
  return dates.length === 1 && dates[0].getTime() > since.getTime()
}
