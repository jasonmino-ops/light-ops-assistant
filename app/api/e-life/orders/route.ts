import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyTgInitData, extractTgUserIdFromParams } from '@/lib/verify-tg-init-data'

/**
 * POST /api/e-life/orders
 * Body: { initData: string }  — raw Telegram WebApp initData string
 *
 * 安全模型：
 *   后端用 CUSTOMER_BOT_TOKEN 校验 initData HMAC，从签名后的 user.id 提取
 *   telegramId，不信任任何客户端传来的 tgId query 参数。
 *   校验失败 → 401 INVALID_TELEGRAM_AUTH，不返回任何订单。
 *
 * Dev 模式：CUSTOMER_BOT_TOKEN 未配置时跳过 HMAC，方便本地开发。
 */

const CUSTOMER_BOT_TOKEN = process.env.CUSTOMER_BOT_TOKEN?.trim() ?? ''

export async function POST(req: NextRequest) {
  let body: { initData?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'INVALID_JSON' }, { status: 400 })
  }

  const { initData } = body
  if (!initData) {
    return NextResponse.json({ ok: false, error: 'MISSING_INIT_DATA', orders: [] }, { status: 401 })
  }

  const params = verifyTgInitData(initData, CUSTOMER_BOT_TOKEN)
  if (!params) {
    return NextResponse.json({ ok: false, error: 'INVALID_TELEGRAM_AUTH', orders: [] }, { status: 401 })
  }

  const tgId = extractTgUserIdFromParams(params)
  if (!tgId) {
    return NextResponse.json({ ok: false, error: 'MISSING_USER', orders: [] }, { status: 401 })
  }

  const orders = await prisma.customerOrder.findMany({
    where: { customerTelegramId: tgId },
    orderBy: { createdAt: 'desc' },
    take: 60,
    select: {
      id:            true,
      orderNo:       true,
      storeCode:     true,
      itemsJson:     true,
      totalAmount:   true,
      status:        true,
      paymentStatus: true,
      createdAt:     true,
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
    ok: true,
    orders: orders.map((o) => {
      type Item = { name?: string; quantity?: number }
      let items: Item[] = []
      try { items = JSON.parse(o.itemsJson) } catch { /* ignore */ }
      const firstItem  = items[0]?.name ?? '—'
      const extraCount = items.length - 1
      return {
        id:           o.id,
        orderNo:      o.orderNo,
        storeCode:    o.storeCode,
        storeName:    nameByCode.get(o.storeCode) ?? o.storeCode,
        itemCount:    items.reduce((s, it) => s + (typeof it.quantity === 'number' ? it.quantity : 1), 0),
        firstItem,
        extraCount,
        totalAmount:  o.totalAmount.toNumber(),
        status:       o.status,
        paymentStatus: o.paymentStatus,
        createdAt:    o.createdAt.toISOString(),
      }
    }),
  })
}
