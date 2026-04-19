import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

const ORDER_SELECT = {
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
} as const

function mapOrder(o: {
  id: string; orderNo: string; storeCode: string; customerTelegramId: string | null
  itemsJson: string; totalAmount: { toNumber(): number }; status: string
  paymentStatus: string; paymentMethod: string | null; paidAt: Date | null; createdAt: Date
}) {
  return {
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
  }
}

/**
 * GET /api/customer-orders
 *
 * 模式 A（待处理）：?status=PENDING,CONFIRMED,COMPLETED
 *   默认返回 PENDING + CONFIRMED + COMPLETED（只含未付款的 COMPLETED）。
 *
 * 模式 B（已付款，用于概览汇总与最近记录）：?paymentStatus=PAID[&dateFrom=yyyy-MM-dd]
 *   返回 status=COMPLETED, paymentStatus=PAID 的订单，可按 paidAt 日期筛选。
 *
 * OWNER 和 STAFF 均可查看。
 */
export async function GET(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })

  // ── 模式 B：已付款订单（用于概览 + 最近记录） ─────────────────────────────
  const paymentStatusParam = req.nextUrl.searchParams.get('paymentStatus')
  if (paymentStatusParam === 'PAID') {
    const dateFromParam = req.nextUrl.searchParams.get('dateFrom')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { tenantId: ctx.tenantId, status: 'COMPLETED', paymentStatus: 'PAID' }
    if (dateFromParam) {
      where.paidAt = {
        gte: new Date(dateFromParam + 'T00:00:00.000Z'),
        lte: new Date(dateFromParam + 'T23:59:59.999Z'),
      }
    }
    const orders = await prisma.customerOrder.findMany({
      where,
      orderBy: { paidAt: 'desc' },
      take: 50,
      select: ORDER_SELECT,
    })
    return NextResponse.json(orders.map(mapOrder))
  }

  // ── 模式 A：待处理订单 ────────────────────────────────────────────────────
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
    select: ORDER_SELECT,
  })

  return NextResponse.json(orders.map(mapOrder))
}
