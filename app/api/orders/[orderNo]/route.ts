import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

/**
 * GET /api/orders/:orderNo
 * 返回单笔订单完整详情：所有 SaleRecord 行 + PaymentIntent。
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orderNo: string }> },
) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })

  const { orderNo } = await params

  const records = await prisma.saleRecord.findMany({
    where: { orderNo, tenantId: ctx.tenantId },
    include: {
      store: { select: { name: true } },
      operatorUser: { select: { displayName: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  if (records.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }

  const pi = await prisma.paymentIntent.findFirst({
    where: { orderNo, tenantId: ctx.tenantId },
  })

  const first = records[0]
  const totalAmount = records.reduce((sum, r) => sum + r.lineAmount.toNumber(), 0)

  return NextResponse.json({
    orderNo,
    storeName: first.store.name,
    operatorDisplayName: first.operatorUser.displayName,
    createdAt: first.createdAt.toISOString(),
    saleStatus: first.status,
    items: records.map((r) => ({
      id: r.id,
      recordNo: r.recordNo,
      productNameSnapshot: r.productNameSnapshot,
      specSnapshot: r.specSnapshot ?? null,
      quantity: r.quantity.toNumber(),
      unitPrice: r.unitPrice.toNumber(),
      lineAmount: r.lineAmount.toNumber(),
      saleType: r.saleType,
    })),
    totalAmount,
    paymentMethod: pi?.paymentMethod ?? 'CASH',
    paymentStatus: pi?.status ?? 'PAID',
    paidAt: pi?.paidAt?.toISOString() ?? null,
    cancelledAt: pi?.cancelledAt?.toISOString() ?? null,
  })
}
