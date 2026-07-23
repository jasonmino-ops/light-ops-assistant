import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authorizeTransaction, transactionAuthorizationErrorResponse } from '@/lib/transaction-authorization'

/**
 * POST /api/payments/:paymentId/confirm
 * 操作员手动确认已收款 — 将 PaymentIntent 状态设为 PAID。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const initialAuthorization = await authorizeTransaction(req, { operation: 'PAYMENT_CONFIRM' })
  if (!initialAuthorization.ok) return transactionAuthorizationErrorResponse(initialAuthorization)
  const initialCtx = initialAuthorization.authorization

  const { paymentId } = await params

  const pi = await prisma.paymentIntent.findFirst({
    where: { id: paymentId, tenantId: initialCtx.tenantId },
  })

  if (!pi) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }
  const store = await prisma.store.findFirst({
    where: { id: pi.storeId, tenantId: initialCtx.tenantId, status: 'ACTIVE' },
    select: { id: true, code: true, tenantId: true },
  })
  if (!store) return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })
  const authorization = await authorizeTransaction(req, { operation: 'PAYMENT_CONFIRM', store: {
    tenantId: store.tenantId, storeId: store.id, storeCode: store.code,
  } })
  if (!authorization.ok) return transactionAuthorizationErrorResponse(authorization)
  const ctx = authorization.authorization

  if (pi.status !== 'PENDING') {
    return NextResponse.json(
      { error: 'INVALID_STATE', status: pi.status },
      { status: 422 },
    )
  }

  const [updated] = await prisma.$transaction([
    prisma.paymentIntent.update({
      where: { id: paymentId },
      data: { status: 'PAID', paidAt: new Date() },
    }),
    // Deferred orders: KHQR confirm transitions PENDING_PAYMENT → COMPLETED
    // Direct retail orders: records are already COMPLETED, updateMany is a no-op
    prisma.saleRecord.updateMany({
      where: { orderNo: pi.orderNo, tenantId: ctx.tenantId, status: 'PENDING_PAYMENT' },
      data: { status: 'COMPLETED' },
    }),
  ])

  return NextResponse.json({ id: updated.id, status: updated.status, paidAt: updated.paidAt })
}
