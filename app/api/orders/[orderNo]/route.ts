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
    // ── Fallback: 顾客 H5 订单（CustomerOrder） ──────────────────────────
    const co = await prisma.customerOrder.findFirst({
      where: { orderNo, tenantId: ctx.tenantId },
    })
    if (!co) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    const coStore = await prisma.store.findUnique({
      where: { id: co.storeId }, select: { name: true },
    })

    type RawItem = { productId?: string; name?: string; spec?: string | null; quantity?: number; price?: number; lineAmount?: number }
    let rawItems: RawItem[] = []
    try { rawItems = JSON.parse(co.itemsJson) as RawItem[] } catch { rawItems = [] }

    const items = rawItems.map((it, idx) => {
      const q = typeof it.quantity   === 'number' ? it.quantity   : 1
      const p = typeof it.price      === 'number' ? it.price      : 0
      const l = typeof it.lineAmount === 'number' ? it.lineAmount : q * p
      return {
        id:                  `${co.orderNo}-${idx}`,
        recordNo:            co.orderNo,
        productNameSnapshot: it.name ?? '商品',
        specSnapshot:        it.spec ?? null,
        quantity:            q,
        unitPrice:           p,
        lineAmount:          l,
        saleType:            'SALE' as const,
      }
    })

    const subtotal       = +items.reduce((s, it) => s + it.lineAmount, 0).toFixed(2)
    const payableAmount  = co.totalAmount.toNumber()
    const redemption = await prisma.couponRedemption.findFirst({
      where: { orderNo, tenantId: ctx.tenantId },
      select: { discountAmount: true, couponId: true },
    })
    let discountAmount = redemption ? redemption.discountAmount.toNumber() : +(subtotal - payableAmount).toFixed(2)
    if (!Number.isFinite(discountAmount) || discountAmount < 0) discountAmount = 0
    let couponName: string | null = null
    if (redemption?.couponId) {
      const c = await prisma.customerCoupon.findUnique({
        where: { id: redemption.couponId },
        select: { name: true },
      })
      couponName = c?.name ?? null
    }

    return NextResponse.json({
      orderNo:             co.orderNo,
      storeName:           coStore?.name ?? '',
      operatorDisplayName: '顾客自助下单',
      createdAt:           co.createdAt.toISOString(),
      saleStatus:          co.status,
      items,
      totalAmount:         payableAmount,
      subtotal,
      discountAmount,
      payableAmount,
      couponName,
      orderSource:         'CUSTOMER_H5',
      paymentMethod:       co.paymentMethod ?? null,
      paymentStatus:       co.paymentStatus === 'PAID' ? 'PAID' : co.paymentStatus === 'UNPAID' ? 'PENDING' : co.paymentStatus,
      paidAt:              co.paidAt?.toISOString() ?? null,
      cancelledAt:         null,
      customerTelegramId:  co.customerTelegramId,
      remark:              co.remark,
    })
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
    paymentMethod: pi?.paymentMethod ?? null,
    paymentStatus: pi?.status ?? null,
    paidAt: pi?.paidAt?.toISOString() ?? null,
    cancelledAt: pi?.cancelledAt?.toISOString() ?? null,
  })
}
