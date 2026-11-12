import { after, NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { lockOrderSettlement, orderRecordStore } from '@/lib/order-settlement-lock'
import { getContext } from '@/lib/context'
import { notifyCashierGateway } from '@/lib/cashier-realtime-notify'

/**
 * POST /api/orders/:orderNo/cancel
 *
 * 取消挂单（PENDING_PAYMENT）订单：
 *  - 将所有 PENDING_PAYMENT SaleRecord 置为 CANCELLED
 *  - 若存在 PENDING PaymentIntent，同步置为 CANCELLED
 *
 * 已 COMPLETED / 已 CANCELLED 订单不可再取消（返回 409）。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderNo: string }> },
) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })

  const { orderNo } = await params

  const tenantScope = { tenantId: ctx.tenantId, ...(ctx.role === 'STAFF' ? { storeId: ctx.storeId } : {}) }
  // Check records exist and are cancellable
  const records = await prisma.saleRecord.findMany({
    where: { orderNo, ...tenantScope },
    select: { id: true, status: true, tenantId: true, storeId: true, diningBatchId: true },
  })

  if (records.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }

  // A shared orderNo is not sufficient authority to cancel a dining meal.
  // Keep ordinary DEFER orders on this legacy path, but force dining rows
  // through the batch-aware whole-line void flow.
  if (records.some((record) => record.diningBatchId)) {
    return NextResponse.json(
      { error: 'DINING_VOID_REQUIRED', message: '堂食菜品请从堂食页面整行退菜' },
      { status: 409 },
    )
  }

  const storeId = records[0].storeId
  if (records.some((record) => record.storeId !== storeId)) {
    return NextResponse.json({ error: 'INVALID_ORDER_SCOPE' }, { status: 409 })
  }
  const alreadyCancelled = records.every((r) => r.status === 'CANCELLED')
  if (alreadyCancelled) {
    return NextResponse.json({ error: 'ALREADY_CANCELLED' }, { status: 409 })
  }

  const hasCompleted = records.some((r) => r.status === 'COMPLETED')
  if (hasCompleted) {
    return NextResponse.json(
      { error: 'ALREADY_COMPLETED', message: '已完成订单不可取消' },
      { status: 409 },
    )
  }

  try {
    const cancelled = await prisma.$transaction(async (tx) => {
      await lockOrderSettlement(tx, ctx.tenantId, orderNo)
      const paymentScope = { orderNo, tenantId: ctx.tenantId }
      const scope = { ...paymentScope, storeId }
      if (await orderRecordStore(tx, scope) !== storeId) return 'ORDER_STATE_CHANGED'
      const prior = await tx.paymentIntent.findFirst({ where: paymentScope, select: { status: true } })
      if (prior?.status === 'PAID') return 'ALREADY_COMPLETED'
      const current = await tx.saleRecord.findMany({ where: scope, select: { status: true } })
      if (current.some((record) => record.status === 'COMPLETED')) return 'ALREADY_COMPLETED'
      const changed = await tx.saleRecord.updateMany({
        where: { ...scope, status: 'PENDING_PAYMENT' },
        data: { status: 'CANCELLED' },
      })

      if (!changed.count) return 'ALREADY_CANCELLED'
      // Cancel any pending PaymentIntent
      await tx.paymentIntent.updateMany({
        where: { ...paymentScope, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      })
      return 'CANCELLED'
    })
    if (cancelled !== 'CANCELLED') return NextResponse.json({ error: cancelled }, { status: 409 })

    after(() => notifyCashierGateway({
      tenantId: records[0].tenantId,
      storeId: records[0].storeId,
      type: 'pending_orders_changed',
    }))

    return NextResponse.json({ orderNo, status: 'CANCELLED' })
  } catch (err) {
    console.error('[POST /api/orders/cancel]', err)
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
