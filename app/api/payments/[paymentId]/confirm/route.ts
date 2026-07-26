import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { authorizeDesktopPosRequest, unauthorizedPosResponse } from '@/lib/desktop-pos-auth'

/**
 * POST /api/payments/:paymentId/confirm
 * 操作员手动确认已收款 — 将 PaymentIntent 状态设为 PAID。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const { paymentId } = await params
  const pi = await prisma.paymentIntent.findFirst({
    where: { id: paymentId },
  })
  if (!pi) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }

  // Existing mobile/account callers retain their context path. Browser POS and
  // the Desktop runtime may also use the formal signed device authorization.
  const ctx = await getContext(req)
  const accountAuthorized = !!ctx && ctx.tenantId === pi.tenantId
  if (!accountAuthorized) {
    const store = await prisma.store.findUnique({
      where: { id: pi.storeId },
      select: { code: true, status: true },
    })
    if (!store || store.status !== 'ACTIVE') return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    const posAuth = await authorizeDesktopPosRequest(req, {
      tenantId: pi.tenantId,
      storeId: pi.storeId,
      storeCode: store.code,
    }, { allowStoreCodeFallback: false })
    if (!posAuth) return unauthorizedPosResponse()
  }

  if (pi.status === 'PAID') {
    return NextResponse.json({ id: pi.id, status: pi.status, paidAt: pi.paidAt, replayed: true })
  }
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
      where: { orderNo: pi.orderNo, tenantId: pi.tenantId, status: 'PENDING_PAYMENT' },
      data: { status: 'COMPLETED' },
    }),
  ])

  return NextResponse.json({ id: updated.id, status: updated.status, paidAt: updated.paidAt })
}
