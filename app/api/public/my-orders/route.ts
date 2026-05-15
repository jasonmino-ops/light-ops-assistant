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

  // 一次性按 orderNo 批量取 CouponRedemption；再批量取 CustomerCoupon 拿名称
  const orderNos = orders.map((o) => o.orderNo)
  const redemptions = orderNos.length === 0 ? [] : await prisma.couponRedemption.findMany({
    where: { orderNo: { in: orderNos } },
    select: { orderNo: true, discountAmount: true, couponId: true },
  })
  const redByOrder = new Map(redemptions.map((r) => [r.orderNo, r]))
  const couponIds = Array.from(new Set(redemptions.map((r) => r.couponId)))
  const coupons = couponIds.length === 0 ? [] : await prisma.customerCoupon.findMany({
    where: { id: { in: couponIds } },
    select: { id: true, name: true },
  })
  const couponNameById = new Map(coupons.map((c) => [c.id, c.name]))

  return NextResponse.json({
    storeName: store.name,
    orders: orders.map((o) => {
      type RawItem = { lineAmount?: number; price?: number; quantity?: number }
      const items = JSON.parse(o.itemsJson) as RawItem[]
      const subtotalFromItems = +items.reduce((sum, it) => {
        const l = typeof it.lineAmount === 'number' ? it.lineAmount
                : (typeof it.price === 'number' && typeof it.quantity === 'number' ? it.price * it.quantity : 0)
        return sum + l
      }, 0).toFixed(2)
      const total = o.totalAmount.toNumber()
      const red = redByOrder.get(o.orderNo)
      const discountAmount = red ? red.discountAmount.toNumber() : +(subtotalFromItems - total).toFixed(2)
      const safeDiscount   = (!Number.isFinite(discountAmount) || discountAmount < 0) ? 0 : discountAmount
      // 保证 subtotal - discount = total（兜底校准）
      const subtotal = +(total + safeDiscount).toFixed(2)
      return {
        id: o.id,
        orderNo: o.orderNo,
        items,
        totalAmount:    total,
        subtotal,
        discountAmount: safeDiscount,
        payableAmount:  total,
        couponName:     red ? (couponNameById.get(red.couponId) ?? null) : null,
        status: o.status,
        paymentStatus: o.paymentStatus,
        paymentMethod: o.paymentMethod,
        paidAt: o.paidAt?.toISOString() ?? null,
        createdAt: o.createdAt.toISOString(),
      }
    }),
  })
}
