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
  const statuses = statusParam ? statusParam.split(',') : ['PENDING', 'CONFIRMED']

  const orders = await prisma.customerOrder.findMany({
    where: { tenantId: ctx.tenantId, status: { in: statuses } },
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
      createdAt: o.createdAt.toISOString(),
    })),
  )
}
