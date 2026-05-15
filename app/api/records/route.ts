import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { getPaymentBreakdown, getOrderPaymentMap } from '@/lib/payment-breakdown'

/**
 * GET /api/records?dateFrom=yyyy-MM-dd&dateTo=yyyy-MM-dd[&saleType=SALE|REFUND][&storeId=][&operatorUserId=][&page=1][&pageSize=20]
 *
 * Permission rules (enforced server-side, ignores body):
 *   STAFF  → always scoped to own userId + storeId from session headers
 *   OWNER  → accepts optional storeId / operatorUserId query params; no filter = global view
 *
 * Dates are interpreted as UTC day boundaries.
 * summary reflects the current filtered result set, not the full day.
 */
export async function GET(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) {
    return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  }

  const p = req.nextUrl.searchParams
  const dateFrom = p.get('dateFrom')
  const dateTo = p.get('dateTo')

  if (!dateFrom || !dateTo) {
    return NextResponse.json(
      { error: 'MISSING_DATE_RANGE', message: 'dateFrom and dateTo are required (yyyy-MM-dd)' },
      { status: 400 },
    )
  }

  const from = new Date(dateFrom + 'T00:00:00.000Z')
  const to = new Date(dateTo + 'T23:59:59.999Z')

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return NextResponse.json(
      { error: 'INVALID_DATE', message: 'Dates must be in yyyy-MM-dd format' },
      { status: 400 },
    )
  }

  const saleTypeParam = p.get('saleType')
  const page = Math.max(1, parseInt(p.get('page') ?? '1', 10))
  const pageSize = Math.min(50, Math.max(1, parseInt(p.get('pageSize') ?? '20', 10)))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {
    tenantId: ctx.tenantId,
    createdAt: { gte: from, lte: to },
  }

  if (ctx.role === 'STAFF') {
    // Hard-scope to own identity — query params for storeId/operatorUserId are ignored
    where.storeId = ctx.storeId
    where.operatorUserId = ctx.userId
  } else {
    // OWNER: optional narrowing
    const storeId = p.get('storeId')
    const operatorUserId = p.get('operatorUserId')
    if (storeId) where.storeId = storeId
    if (operatorUserId) where.operatorUserId = operatorUserId
  }

  if (saleTypeParam === 'SALE' || saleTypeParam === 'REFUND') {
    where.saleType = saleTypeParam
  }

  // Zero-value placeholder for skipped aggregation branches
  const ZERO_AGG = { _sum: { lineAmount: null }, _count: 0 } as const

  // ── 顾客 H5 订单合并条件 ─────────────────────────────────────────────────
  // 与 /api/summary 口径完全一致：status='COMPLETED' && paymentStatus='PAID'
  // 仅首页合并（避免分页重复）；STAFF / REFUND filter / 按员工筛选时不合并
  const operatorUserIdQ = p.get('operatorUserId')
  const shouldIncludeCO =
    ctx.role !== 'STAFF' &&
    saleTypeParam !== 'REFUND' &&
    !operatorUserIdQ &&
    page === 1
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const coWhere: any = shouldIncludeCO
    ? {
        tenantId: ctx.tenantId,
        status: 'COMPLETED',
        paymentStatus: 'PAID',
        paidAt: { gte: from, lte: to },
        ...(where.storeId ? { storeId: where.storeId } : {}),
      }
    : null

  const [total, items, saleAgg, refundAgg, customerOrders] = await Promise.all([
    prisma.saleRecord.count({ where }),
    prisma.saleRecord.findMany({
      where,
      include: {
        store: { select: { name: true } },
        operatorUser: { select: { displayName: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    saleTypeParam !== 'REFUND'
      ? prisma.saleRecord.aggregate({
          where: { ...where, saleType: 'SALE', status: 'COMPLETED' },
          _sum: { lineAmount: true },
          _count: true,
        })
      : Promise.resolve(ZERO_AGG),
    saleTypeParam !== 'SALE'
      ? prisma.saleRecord.aggregate({
          where: { ...where, saleType: 'REFUND', status: 'COMPLETED' },
          _sum: { lineAmount: true },
          _count: true,
        })
      : Promise.resolve(ZERO_AGG),
    coWhere
      ? prisma.customerOrder.findMany({
          where: coWhere,
          orderBy: { paidAt: 'desc' },
          take: 500,
        })
      : Promise.resolve([]),
  ])

  // CO 门店名映射（CustomerOrder 无 store relation，按需单独查）
  const coStoreIds = Array.from(new Set(customerOrders.map((o) => o.storeId)))
  const coStores = coStoreIds.length > 0
    ? await prisma.store.findMany({
        where: { id: { in: coStoreIds } },
        select: { id: true, name: true },
      })
    : []
  const coStoreMap = new Map(coStores.map((s) => [s.id, s.name]))

  const totalSaleAmount = saleAgg._sum.lineAmount?.toNumber() ?? 0
  const totalRefundAmount = refundAgg._sum.lineAmount?.toNumber() ?? 0

  // Payment breakdown (CASH vs KHQR paid) + per-order PI info
  const storeId = ctx.role === 'STAFF' ? ctx.storeId : (where.storeId as string | undefined)
  const operatorUserId = ctx.role === 'STAFF' ? ctx.userId : (where.operatorUserId as string | undefined)

  const [breakdown, paymentMap] = await Promise.all([
    saleTypeParam !== 'REFUND'
      ? getPaymentBreakdown({ tenantId: ctx.tenantId, from, to, storeId, operatorUserId })
      : { cashSaleAmount: 0, khqrSaleAmount: 0 },
    (() => {
      const saleOrderNos = items
        .filter((r) => r.saleType === 'SALE' && r.orderNo)
        .map((r) => r.orderNo as string)
      return getOrderPaymentMap([...new Set(saleOrderNos)])
    })(),
  ])

  // 映射 SR 行（透传 source）
  const srItems = items.map((r) => {
    const pi = r.saleType === 'SALE' && r.orderNo ? paymentMap.get(r.orderNo) : undefined
    return {
      id: r.id,
      recordNo: r.recordNo,
      orderNo: r.orderNo,
      createdAt: r.createdAt.toISOString(),
      storeName: r.store.name,
      operatorDisplayName: r.operatorUser.displayName,
      productNameSnapshot: r.productNameSnapshot,
      specSnapshot: r.specSnapshot,
      quantity: r.quantity.toNumber(),
      unitPrice: r.unitPrice.toNumber(),
      lineAmount: r.lineAmount.toNumber(),
      saleType: r.saleType,
      refundReason: r.refundReason,
      paymentMethod: pi?.paymentMethod ?? (r.saleType === 'SALE' && r.status === 'COMPLETED' ? 'CASH' : null),
      paymentStatus: pi?.paymentStatus ?? (r.saleType === 'SALE' && r.status === 'COMPLETED' ? 'PAID' : null),
      source: 'SALE_RECORD' as const,
    }
  })

  // 映射 CO 行（单行聚合：itemsJson 解析后取首项 + 计数说明）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type CoItem = { name?: string; spec?: string | null; quantity?: number; price?: number; lineAmount?: number }
  const coRows = customerOrders.map((o) => {
    let parsedItems: CoItem[] = []
    try { parsedItems = JSON.parse(o.itemsJson) } catch { /* keep [] */ }
    const first = parsedItems[0] ?? {}
    const totalQty = parsedItems.reduce((acc, it) => acc + (Number(it.quantity) || 0), 0) || 1
    const totalAmt = o.totalAmount.toNumber()
    const nameLabel = parsedItems.length > 1
      ? `${first.name ?? '商品'} 等${parsedItems.length}项`
      : (first.name ?? '商品')
    const pm = o.paymentMethod === 'QR' ? 'KHQR' : (o.paymentMethod === 'CASH' ? 'CASH' : 'CASH')
    return {
      id: o.id,
      recordNo: o.orderNo,
      orderNo: o.orderNo,
      createdAt: (o.paidAt ?? o.createdAt).toISOString(),
      storeName: coStoreMap.get(o.storeId) ?? '—',
      operatorDisplayName: 'H5 顾客',
      productNameSnapshot: nameLabel,
      specSnapshot: first.spec ?? null,
      quantity: totalQty,
      unitPrice: totalAmt / totalQty,
      lineAmount: totalAmt,
      saleType: 'SALE' as const,
      refundReason: null,
      paymentMethod: pm as 'CASH' | 'KHQR',
      paymentStatus: 'PAID' as const,
      source: 'CUSTOMER_ORDER' as const,
      // 配送/上门信息（按 deliveryAddress 是否非空判定 isDelivery）
      isDelivery:      !!o.deliveryAddress,
      customerName:    o.customerName ?? null,
      customerPhone:   o.customerPhone ?? null,
      deliveryAddress: o.deliveryAddress ?? null,
      deliveryLat:     o.deliveryLat ?? null,
      deliveryLng:     o.deliveryLng ?? null,
      mapUrl: (o.deliveryLat != null && o.deliveryLng != null)
        ? `https://maps.google.com/?q=${o.deliveryLat},${o.deliveryLng}` : null,
    }
  })

  // 合并并按时间倒序（仅首页有 coRows；后续页 coRows 为空，自然不重复）
  const merged = coRows.length > 0
    ? [...srItems, ...coRows].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : srItems

  // 汇总数字与 /api/summary 对齐：含 CO 已确认+已付的金额与笔数
  const coCount = customerOrders.length
  const coSum = customerOrders.reduce((s, o) => s + o.totalAmount.toNumber(), 0)
  const coCash = customerOrders
    .filter((o) => o.paymentMethod === 'CASH')
    .reduce((s, o) => s + o.totalAmount.toNumber(), 0)
  const coKhqr = customerOrders
    .filter((o) => o.paymentMethod === 'QR')
    .reduce((s, o) => s + o.totalAmount.toNumber(), 0)
  // 送货/上门统计：仅 CO 行参与（SR 是线下到店）
  const deliveryOrders = customerOrders.filter((o) => !!o.deliveryAddress)
  const deliveryCount  = deliveryOrders.length
  const deliveryAmount = deliveryOrders.reduce((s, o) => s + o.totalAmount.toNumber(), 0)

  return NextResponse.json({
    total: total + coCount,
    page,
    pageSize,
    items: merged,
    summary: {
      saleCount: saleAgg._count + coCount,
      refundCount: refundAgg._count,
      netAmount: totalSaleAmount + totalRefundAmount + coSum,
      cashSaleAmount: breakdown.cashSaleAmount + coCash,
      khqrSaleAmount: breakdown.khqrSaleAmount + coKhqr,
      deliveryCount,
      deliveryAmount,
    },
  })
}
