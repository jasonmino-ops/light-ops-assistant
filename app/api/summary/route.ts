import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { getPaymentBreakdown } from '@/lib/payment-breakdown'

/**
 * GET /api/summary?dateFrom=yyyy-MM-dd&dateTo=yyyy-MM-dd[&storeId=][&operatorUserId=]
 *
 * 口径：SaleRecord（普通单）+ CustomerOrder（COMPLETED+PAID，按 paidAt 过滤）
 * 维度：GLOBAL / STORE / STAFF（STAFF 不含顾客订单）
 */
export async function GET(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) {
    return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  }

  if (ctx.role !== 'OWNER') {
    return NextResponse.json(
      { error: 'FORBIDDEN', message: 'Only OWNER can access summary' },
      { status: 403 },
    )
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

  const storeId = p.get('storeId') ?? undefined
  const operatorUserId = p.get('operatorUserId') ?? undefined

  let dimension: 'GLOBAL' | 'STORE' | 'STAFF'
  if (operatorUserId) {
    dimension = 'STAFF'
  } else if (storeId) {
    dimension = 'STORE'
  } else {
    dimension = 'GLOBAL'
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const coWhere: any = dimension !== 'STAFF' ? {
    tenantId: ctx.tenantId,
    status: 'COMPLETED',
    paymentStatus: 'PAID',
    paidAt: { gte: from, lte: to },
    ...(storeId ? { storeId } : {}),
  } : null

  // ── Summary-table fast path ───────────────────────────────────────────────
  if (dateFrom === dateTo && !operatorUserId) {
    try {
      const summaryDate = dateFrom
      const row = storeId
        ? await prisma.storeDailySummary.findUnique({
            where: { storeId_date: { storeId, date: summaryDate } },
            select: { salesCount: true, refundCount: true, grossSales: true, refundAmount: true, netSales: true },
          })
        : await prisma.tenantDailySummary.findFirst({
            where: { tenantId: ctx.tenantId, date: summaryDate },
            select: { salesCount: true, refundCount: true, grossSales: true, refundAmount: true, netSales: true },
          })

      if (row) {
        const [storeInfo, breakdown] = await Promise.all([
          storeId
            ? prisma.store.findFirst({ where: { id: storeId }, select: { name: true } })
            : Promise.resolve(null),
          getPaymentBreakdown({ tenantId: ctx.tenantId, from, to, storeId }),
        ])

        let coTotal = 0, coCount = 0, coCashAmt = 0, coQRAmt = 0
        if (coWhere) {
          const [coAgg, coCashRes, coQRRes] = await Promise.all([
            prisma.customerOrder.aggregate({ where: coWhere, _sum: { totalAmount: true }, _count: true }),
            prisma.customerOrder.aggregate({ where: { ...coWhere, paymentMethod: 'CASH' }, _sum: { totalAmount: true } }),
            prisma.customerOrder.aggregate({ where: { ...coWhere, paymentMethod: 'QR' }, _sum: { totalAmount: true } }),
          ])
          coTotal   = coAgg._sum.totalAmount?.toNumber() ?? 0
          coCount   = coAgg._count
          coCashAmt = coCashRes._sum.totalAmount?.toNumber() ?? 0
          coQRAmt   = coQRRes._sum.totalAmount?.toNumber() ?? 0
        }

        const totalSaleAmount   = Number(row.grossSales) + coTotal
        const totalRefundAmount = -Number(row.refundAmount)
        const netAmount         = Number(row.netSales) + coTotal
        const finalCount        = row.salesCount + coCount

        return NextResponse.json({
          dateFrom, dateTo, dimension,
          storeName: storeInfo?.name ?? null,
          operatorDisplayName: null,
          totalSaleAmount,
          totalRefundAmount,
          netAmount,
          saleCount: finalCount,
          refundCount: row.refundCount,
          saleOrderCount: finalCount,
          refundOrderCount: row.refundCount,
          avgSaleAmount: finalCount > 0 ? parseFloat((netAmount / finalCount).toFixed(2)) : 0,
          topProducts: [],
          cashSaleAmount: breakdown.cashSaleAmount + coCashAmt,
          khqrSaleAmount: breakdown.khqrSaleAmount + coQRAmt,
          _source: 'summary',
        })
      }
    } catch {
      // Summary tables don't exist yet (P2021) — fall through to raw queries
    }
  }

  // ── Raw queries ───────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseWhere: any = {
    tenantId: ctx.tenantId,
    createdAt: { gte: from, lte: to },
    ...(storeId ? { storeId } : {}),
    ...(operatorUserId ? { operatorUserId } : {}),
  }

  const [
    saleAgg,
    refundAgg,
    saleOrderGroups,
    refundOrderGroups,
    topProductGroups,
    storeInfo,
    staffInfo,
  ] = await Promise.all([
    prisma.saleRecord.aggregate({
      where: { ...baseWhere, saleType: 'SALE', status: 'COMPLETED' },
      _sum: { lineAmount: true },
      _count: true,
    }),
    prisma.saleRecord.aggregate({
      where: { ...baseWhere, saleType: 'REFUND', status: 'COMPLETED' },
      _sum: { lineAmount: true },
      _count: true,
    }),
    prisma.saleRecord.groupBy({
      by: ['orderNo'],
      where: { ...baseWhere, saleType: 'SALE', status: 'COMPLETED', orderNo: { not: null } },
    }),
    prisma.saleRecord.groupBy({
      by: ['orderNo'],
      where: { ...baseWhere, saleType: 'REFUND', status: 'COMPLETED', orderNo: { not: null } },
    }),
    // take: 50 以便与顾客订单合并后再取 top 3
    prisma.saleRecord.groupBy({
      by: ['productNameSnapshot', 'specSnapshot'],
      where: { ...baseWhere, saleType: 'SALE', status: 'COMPLETED' },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 50,
    }),
    storeId
      ? prisma.store.findFirst({ where: { id: storeId }, select: { name: true } })
      : Promise.resolve(null),
    operatorUserId
      ? prisma.user.findFirst({ where: { id: operatorUserId }, select: { displayName: true } })
      : Promise.resolve(null),
  ])

  const totalSaleAmount   = saleAgg._sum.lineAmount?.toNumber() ?? 0
  const totalRefundAmount = refundAgg._sum.lineAmount?.toNumber() ?? 0
  const netAmount         = totalSaleAmount + totalRefundAmount
  const saleCount         = saleAgg._count
  const refundCount       = refundAgg._count
  const saleOrderCount    = saleOrderGroups.length
  const refundOrderCount  = refundOrderGroups.length
  const avgSaleAmount     = saleCount > 0 ? parseFloat((netAmount / saleCount).toFixed(2)) : 0

  // 收款拆分 + 顾客订单（并行）
  type CoRow = { itemsJson: string; totalAmount: { toNumber(): number }; paymentMethod: string | null }
  const [breakdown, coOrders] = await Promise.all([
    getPaymentBreakdown({ tenantId: ctx.tenantId, from, to, storeId, operatorUserId }),
    (coWhere
      ? prisma.customerOrder.findMany({
          where: coWhere,
          select: { itemsJson: true, totalAmount: true, paymentMethod: true },
        })
      : Promise.resolve([])) as Promise<CoRow[]>,
  ])

  // 顾客订单汇总
  const coTotal   = coOrders.reduce((s, o) => s + o.totalAmount.toNumber(), 0)
  const coCount   = coOrders.length
  const coCashAmt = coOrders
    .filter((o) => o.paymentMethod === 'CASH')
    .reduce((s, o) => s + o.totalAmount.toNumber(), 0)
  const coQRAmt   = coOrders
    .filter((o) => o.paymentMethod === 'QR')
    .reduce((s, o) => s + o.totalAmount.toNumber(), 0)

  // 合并热销商品（SaleRecord top50 + CustomerOrder itemsJson）
  const productMap = new Map<string, { name: string; spec: string | null; totalQty: number }>()
  for (const g of topProductGroups) {
    const key = `${g.productNameSnapshot}||${g.specSnapshot ?? ''}`
    productMap.set(key, {
      name: g.productNameSnapshot,
      spec: g.specSnapshot ?? null,
      totalQty: parseFloat((g._sum.quantity ?? 0).toString()),
    })
  }
  for (const order of coOrders) {
    let items: Array<{ name: string; spec?: string; quantity: number }>
    try { items = JSON.parse(order.itemsJson) } catch { items = [] }
    for (const item of items) {
      const key = `${item.name}||${item.spec ?? ''}`
      const existing = productMap.get(key)
      if (existing) {
        existing.totalQty += item.quantity
      } else {
        productMap.set(key, { name: item.name, spec: item.spec ?? null, totalQty: item.quantity })
      }
    }
  }
  const topProducts = Array.from(productMap.values())
    .sort((a, b) => b.totalQty - a.totalQty)
    .slice(0, 3)

  const finalTotal = totalSaleAmount + coTotal
  const finalNet   = netAmount + coTotal
  const finalCount = saleCount + coCount

  return NextResponse.json({
    dateFrom,
    dateTo,
    dimension,
    storeName: storeInfo?.name ?? null,
    operatorDisplayName: staffInfo?.displayName ?? null,
    totalSaleAmount: finalTotal,
    totalRefundAmount,
    netAmount: finalNet,
    saleCount: finalCount,
    refundCount,
    saleOrderCount: saleOrderCount + coCount,
    refundOrderCount,
    avgSaleAmount: finalCount > 0 ? parseFloat((finalNet / finalCount).toFixed(2)) : avgSaleAmount,
    topProducts,
    cashSaleAmount: breakdown.cashSaleAmount + coCashAmt,
    khqrSaleAmount: breakdown.khqrSaleAmount + coQRAmt,
  })
}
