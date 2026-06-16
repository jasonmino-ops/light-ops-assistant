import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params
  const order = await prisma.customerOrder.findFirst({
    where: { OR: [{ id: orderId }, { orderNo: orderId }] },
    select: {
      id: true,
      orderNo: true,
      status: true,
      paymentStatus: true,
      paymentMethod: true,
      paidAt: true,
    },
  })
  if (!order) return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })

  const payment = await prisma.paymentTransaction.findFirst({
    where: { customerOrderId: order.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      provider: true,
      method: true,
      trxId: true,
      status: true,
      deepLinkUrl: true,
      errorCode: true,
      errorMessage: true,
      paidAt: true,
      createdAt: true,
    },
  })

  return NextResponse.json({
    order: {
      id: order.id,
      orderNo: order.orderNo,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      paidAt: order.paidAt?.toISOString() ?? null,
    },
    payment: payment ? {
      ...payment,
      paidAt: payment.paidAt?.toISOString() ?? null,
      createdAt: payment.createdAt.toISOString(),
    } : null,
  })
}
