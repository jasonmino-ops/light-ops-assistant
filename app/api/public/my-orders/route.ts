import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/public/my-orders?code=xxx[&tgId=xxx][&orderNos=NO1,NO2,...]
 *
 * 顾客端公开接口：查询当前顾客在指定门店的订单记录。
 * 身份识别两条路径（任一命中即可，tgId 优先）：
 *   1) tgId    — Telegram WebApp 内 customerTelegramId 匹配
 *   2) orderNos — 非 TG 外部 H5 用户：本设备 localStorage 缓存的订单号列表
 * 两者都缺则返回空 orders（不报错，由前端展示"暂无历史订单"）。
 */
export async function GET(req: NextRequest) {
  const tgId         = req.nextUrl.searchParams.get('tgId')
  const code         = req.nextUrl.searchParams.get('code')
  const orderNosParam = req.nextUrl.searchParams.get('orderNos')

  if (!code) {
    return NextResponse.json({ error: 'MISSING_CODE' }, { status: 400 })
  }

  const store = await prisma.store.findUnique({
    where: { code },
    select: { name: true, status: true },
  })
  if (!store || store.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })
  }

  // 组装 where：tgId 优先；其次 orderNos 列表；都没有则空列表
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let where: any | null = null
  if (tgId) {
    where = { storeCode: code, customerTelegramId: tgId }
  } else if (orderNosParam) {
    const list = orderNosParam.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 30)
    if (list.length > 0) where = { storeCode: code, orderNo: { in: list } }
  }

  if (!where) {
    return NextResponse.json({ storeName: store.name, orders: [] })
  }

  const orders = await prisma.customerOrder.findMany({
    where,
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
