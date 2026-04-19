import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/public/my-orders?tgId=xxx&code=xxx
 *
 * 顾客端公开接口：查询当前顾客（通过 Telegram ID 识别）在指定门店的订单记录。
 * 无需登录，按 customerTelegramId 匹配，最多返回最近 20 条，按创建时间倒序。
 */
export async function GET(req: NextRequest) {
  const tgId = req.nextUrl.searchParams.get('tgId')
  const code = req.nextUrl.searchParams.get('code')

  if (!tgId || !code) {
    return NextResponse.json({ error: 'MISSING_PARAMS' }, { status: 400 })
  }

  const store = await prisma.store.findUnique({
    where: { code },
    select: { name: true, status: true },
  })
  if (!store || store.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })
  }

  const orders = await prisma.customerOrder.findMany({
    where: { storeCode: code, customerTelegramId: tgId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      orderNo: true,
      itemsJson: true,
      totalAmount: true,
      status: true,
      paymentStatus: true,
      paymentMethod: true,
      paidAt: true,
      createdAt: true,
    },
  })

  return NextResponse.json({
    storeName: store.name,
    orders: orders.map((o) => ({
      id: o.id,
      orderNo: o.orderNo,
      items: JSON.parse(o.itemsJson),
      totalAmount: o.totalAmount.toNumber(),
      status: o.status,
      paymentStatus: o.paymentStatus,
      paymentMethod: o.paymentMethod,
      paidAt: o.paidAt?.toISOString() ?? null,
      createdAt: o.createdAt.toISOString(),
    })),
  })
}
