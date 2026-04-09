import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

/**
 * POST /api/payments/:paymentId/cancel
 * 操作员取消 KHQR 收款 — 将 PaymentIntent 设为 CANCELLED，
 * 并将关联 orderNo 下的所有 SaleRecord 状态改为 CANCELLED。
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

  if (pi.status !== 'PENDING') {
    return NextResponse.json(
      { error: 'INVALID_STATE', status: pi.status },
      { status: 422 },
    )
  }

  await prisma.$transaction([
    prisma.paymentIntent.update({
      where: { id: paymentId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    }),
    prisma.saleRecord.updateMany({
      where: { orderNo: pi.orderNo, tenantId: ctx.tenantId },
      data: { status: 'CANCELLED' },
    }),
  ])

  return NextResponse.json({ id: paymentId, status: 'CANCELLED' })
}
