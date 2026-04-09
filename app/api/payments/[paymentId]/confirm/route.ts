import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

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

  if (pi.status !== 'PENDING') {
    return NextResponse.json(
      { error: 'INVALID_STATE', status: pi.status },
      { status: 422 },
    )
  }

  const updated = await prisma.paymentIntent.update({
    where: { id: paymentId },
    data: { status: 'PAID', paidAt: new Date() },
  })

  return NextResponse.json({ id: updated.id, status: updated.status, paidAt: updated.paidAt })
}
