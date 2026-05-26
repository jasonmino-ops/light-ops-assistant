import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/e-life/orders?tgId=<telegramId>
 *
 * 平台级跨商户订单查询（顾客端公开接口）。
 * 身份依赖客户端传入的 tgId（从 Telegram initData 提取）。
 * 无 tgId 时返回空列表，不报错。
 *
 * 安全模型与 /api/public/my-orders 一致：tgId 未做 HMAC 验证，
 * 为顾客端只读查询，不暴露商户敏感经营数据。
 */
export async function GET(req: NextRequest) {
  const tgId = req.nextUrl.searchParams.get('tgId')?.trim() || null

  if (!tgId) {
    return NextResponse.json({ orders: [], noTg: true })
  }

  const orders = await prisma.customerOrder.findMany({
    where: { customerTelegramId: tgId },
    orderBy: { createdAt: 'desc' },
    take: 60,
    select: {
      id:                true,
      orderNo:           true,
      storeCode:         true,
      itemsJson:         true,
      totalAmount:       true,
      status:            true,
      paymentStatus:     true,
      createdAt:         true,
    },
  })

  // 批量取店铺名（去重 storeCode，一次 IN 查询）
  const codes = [...new Set(orders.map((o) => o.storeCode))]
  const stores = codes.length === 0 ? [] : await prisma.store.findMany({
    where: { code: { in: codes } },
    select: { code: true, name: true },
  })
  const nameByCode = new Map(stores.map((s) => [s.code, s.name]))

  return NextResponse.json({
    orders: orders.map((o) => {
      type Item = { name?: string; quantity?: number }
      let items: Item[] = []
      try { items = JSON.parse(o.itemsJson) } catch { /* ignore */ }
      const firstItem = items[0]?.name ?? '—'
      const extraCount = items.length - 1
      return {
        id:           o.id,
        orderNo:      o.orderNo,
        storeCode:    o.storeCode,
        storeName:    nameByCode.get(o.storeCode) ?? o.storeCode,
        itemCount:    items.reduce((s, it) => s + (typeof it.quantity === 'number' ? it.quantity : 1), 0),
        firstItem,
        extraCount,   // 供前端按语言拼摘要
        totalAmount:  o.totalAmount.toNumber(),
        status:       o.status,
        paymentStatus: o.paymentStatus,
        createdAt:    o.createdAt.toISOString(),
      }
    }),
  })
}
