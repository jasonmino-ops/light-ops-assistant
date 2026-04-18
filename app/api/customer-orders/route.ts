import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

/**
 * GET /api/customer-orders[?status=PENDING,CONFIRMED]
 *
 * 返回当前 tenant 下的顾客订单列表。
 * status 参数逗号分隔，默认返回 PENDING + CONFIRMED（待处理订单）。
 * OWNER 和 STAFF 均可查看。
 */
export async function GET(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })

  const statusParam = req.nextUrl.searchParams.get('status')
  const statuses = statusParam
    ? statusParam.split(',')
    : ['PENDING', 'CONFIRMED', 'COMPLETED']

  // COMPLETED 状态只返回未付款的，已付款订单不再需要操作
  const includesCompleted = statuses.includes('COMPLETED')
  const where = includesCompleted
    ? {
        tenantId: ctx.tenantId,
        OR: [
          { status: { in: statuses.filter((s) => s !== 'COMPLETED') } },
          { status: 'COMPLETED', paymentStatus: 'UNPAID' },
        ],
      }
    : { tenantId: ctx.tenantId, status: { in: statuses } }

  const orders = await prisma.customerOrder.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      orderNo: true,
      storeCode: true,
      customerTelegramId: true,
      itemsJson: true,
      totalAmount: true,
      status: true,
      paymentStatus: true,
      paymentMethod: true,
      paidAt: true,
      createdAt: true,
    },
  })

  return NextResponse.json(
    orders.map((o) => ({
      id: o.id,
      orderNo: o.orderNo,
      storeCode: o.storeCode,
      customerTelegramId: o.customerTelegramId,
      items: JSON.parse(o.itemsJson) as unknown[],
      totalAmount: o.totalAmount.toNumber(),
      status: o.status,
      paymentStatus: o.paymentStatus,
      paymentMethod: o.paymentMethod,
      paidAt: o.paidAt ? o.paidAt.toISOString() : null,
      createdAt: o.createdAt.toISOString(),
    })),
  )
}
