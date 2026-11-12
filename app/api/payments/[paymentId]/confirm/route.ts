import { after, NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { lockOrderSettlement, orderRecordStore } from '@/lib/order-settlement-lock'
import { getContext } from '@/lib/context'
import { notifyCashierGateway } from '@/lib/cashier-realtime-notify'

/**
 * POST /api/payments/:paymentId/confirm
 * 操作员手动确认已收款 — 将 PaymentIntent 状态设为 PAID。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })

  const { paymentId } = await params

  const pi = await prisma.paymentIntent.findFirst({
    where: { id: paymentId, tenantId: ctx.tenantId },
  })

  if (!pi) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }

  const result = await prisma.$transaction(async (tx) => {
    await lockOrderSettlement(tx, pi.tenantId, pi.orderNo)
    const current = await tx.paymentIntent.findUniqueOrThrow({ where: { id: paymentId }, select: { status: true } })
    const storeId = await orderRecordStore(tx, pi)
    if (!storeId || (ctx.role === 'STAFF' && ctx.storeId !== storeId)) return { scopeDenied: true }
    if (current.status !== 'PENDING') return { status: current.status }
    const scope = { tenantId: pi.tenantId, storeId, orderNo: pi.orderNo }
    const paidAt = new Date()
    await tx.paymentIntent.update({ where: { id: paymentId }, data: { status: 'PAID', paidAt } })
    // Direct retail lines are already COMPLETED; only deferred rows transition.
    const changed = await tx.saleRecord.updateMany({
      where: { ...scope, status: 'PENDING_PAYMENT' }, data: { status: 'COMPLETED' },
    })
    return { paidAt, pendingRecordCount: changed.count, storeId }
  })
  if ('scopeDenied' in result) return ctx.role === 'STAFF'
    ? NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    : NextResponse.json({ error: 'ORDER_SCOPE_MISMATCH' }, { status: 409 })
  if ('status' in result) return NextResponse.json({ error: 'INVALID_STATE', status: result.status }, { status: 422 })

  if (result.pendingRecordCount > 0) {
    after(() => notifyCashierGateway({
      tenantId: pi.tenantId,
      storeId: result.storeId,
      type: 'pending_orders_changed',
    }))
  }

  return NextResponse.json({ id: paymentId, status: 'PAID', paidAt: result.paidAt })
}
