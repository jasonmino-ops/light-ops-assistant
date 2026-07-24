/**
 * GET /api/cashier/pending-orders?storeCode=xxx
 *
 * Desktop POS endpoint. Requires logged-in store OWNER/STAFF or signed POS device token.
 *
 * 返回本门店"待收款挂单"——即仍有 SaleRecord.status = PENDING_PAYMENT 明细的整单
 * （按 orderNo 聚合）。这些单可能来自：
 *   - 手机商户端（Telegram Mini App）先挂单、后结账（POST /api/sales, paymentMethod=DEFER）
 *   - 浏览器收银端后续挂单（同一 PENDING_PAYMENT 模型）
 *
 * 以明细行状态为唯一权威：
 *   - CASH 完成 / KHQR 确认后明细转 COMPLETED → 自然不再出现；
 *   - 取消后明细转 CANCELLED → 自然不再出现；
 *   - KHQR 收款中（PaymentIntent=PENDING）明细仍为 PENDING_PAYMENT → 继续可见、可恢复；
 *   - 支付 FAILED / EXPIRED 明细仍为 PENDING_PAYMENT → 不被永久隐藏。
 * 不再按"存在任意 PaymentIntent"排除，避免把待收款订单永久隐藏。
 *
 * 授权：正式浏览器员工端边界（账号 / 正式设备身份），不接受 storeCode 弱回退。
 * 仅读取现有 SaleRecord，不引入新模型、不改支付流程。
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authorizeDesktopPosRequest, unauthorizedPosResponse } from '@/lib/desktop-pos-auth'

export async function GET(req: NextRequest) {
  const storeCode = req.nextUrl.searchParams.get('storeCode')?.trim()
  if (!storeCode) return NextResponse.json({ error: 'MISSING_STORE_CODE' }, { status: 400 })

  const store = await prisma.store.findUnique({
    where: { code: storeCode },
    select: { id: true, tenantId: true, status: true },
  })
  if (!store || store.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })
  }
  const posAuth = await authorizeDesktopPosRequest(req, {
    tenantId: store.tenantId,
    storeId: store.id,
    storeCode,
  }, { allowStoreCodeFallback: false })
  if (!posAuth) {
    return unauthorizedPosResponse()
  }

  // 本门店所有待收款明细行（共享 orderNo 的整单在此按行返回，稍后聚合）
  const rows = await prisma.saleRecord.findMany({
    where: {
      tenantId: store.tenantId,
      storeId: store.id,
      saleType: 'SALE',
      status: 'PENDING_PAYMENT',
      orderNo: { not: null },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      orderNo: true, productId: true, barcode: true,
      productNameSnapshot: true, specSnapshot: true,
      unitPrice: true, quantity: true, lineAmount: true, createdAt: true,
    },
  })

  if (rows.length === 0) return NextResponse.json([])

  const grouped = new Map<string, {
    orderNo: string
    createdAt: Date
    totalAmount: number
    items: Array<{
      productId: string | null; barcode: string; name: string; spec: string | null
      unitPrice: number; quantity: number; lineAmount: number
    }>
  }>()

  for (const r of rows) {
    const orderNo = r.orderNo as string
    const entry = grouped.get(orderNo) ?? {
      orderNo,
      createdAt: r.createdAt,
      totalAmount: 0,
      items: [],
    }
    entry.totalAmount += r.lineAmount.toNumber()
    entry.items.push({
      productId: r.productId,
      barcode: r.barcode,
      name: r.productNameSnapshot,
      spec: r.specSnapshot,
      unitPrice: r.unitPrice.toNumber(),
      quantity: r.quantity.toNumber(),
      lineAmount: r.lineAmount.toNumber(),
    })
    grouped.set(orderNo, entry)
  }

  // 最新挂单在前
  const result = Array.from(grouped.values())
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((o) => ({
      orderNo: o.orderNo,
      createdAt: o.createdAt.toISOString(),
      totalAmount: o.totalAmount,
      itemCount: o.items.length,
      items: o.items,
    }))

  return NextResponse.json(result)
}
