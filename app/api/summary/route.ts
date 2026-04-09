import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { getPaymentBreakdown } from '@/lib/payment-breakdown'

/**
 * GET /api/summary?dateFrom=yyyy-MM-dd&dateTo=yyyy-MM-dd[&storeId=][&operatorUserId=]
 *
 * Owner overview page. STAFF requests are rejected with 403.
 *
 * Dimension is inferred from query params:
 *   neither storeId nor operatorUserId  → GLOBAL
 *   storeId only                        → STORE
 *   operatorUserId (with or without storeId) → STAFF
 *
 * Dates are interpreted as UTC day boundaries.
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

  // Infer dimension
  let dimension: 'GLOBAL' | 'STORE' | 'STAFF'
  if (operatorUserId) {
    dimension = 'STAFF'
  } else if (storeId) {
    dimension = 'STORE'
  } else {
    dimension = 'GLOBAL'
  }

  // ── Summary-table fast path ───────────────────────────────────────────────
  // Only for single-day non-staff queries (GLOBAL or STORE dimension).
  // Wrapped in try/catch: if the summary tables don't exist yet (P2021),
  // fall through silently to the raw-query path below.
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
      const totalSaleAmount   = Number(row.grossSales)
      const totalRefundAmount = -Number(row.refundAmount) // negative to match raw-query contract
      const netAmount         = Number(row.netSales)
      return NextResponse.json({
        dateFrom, dateTo, dimension,
        storeName: storeInfo?.name ?? null,
        operatorDisplayName: null,
        totalSaleAmount,
        totalRefundAmount,
        netAmount,
        saleCount: row.salesCount,
        refundCount: row.refundCount,
        saleOrderCount: row.salesCount,
        refundOrderCount: row.refundCount,
        avgSaleAmount: row.salesCount > 0
          ? parseFloat((netAmount / row.salesCount).toFixed(2))
          : 0,
        topProducts: [],      // not stored in summary; fallback to raw for top-products detail
        cashSaleAmount: breakdown.cashSaleAmount,
        khqrSaleAmount: breakdown.khqrSaleAmount,
        _source: 'summary',
      })
    }
    // summary missing for this date → fall through to raw queries below
    } catch {
      // Summary tables don't exist yet (P2021) — fall through to raw queries
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseWhere: any = {
    tenantId: ctx.tenantId,
    createdAt: { gte: from, lte: to },
    ...(storeId ? { storeId } : {}),
    ...(operatorUserId ? { operatorUserId } : {}),
  }

  // Run all queries in parallel
  const [
    saleAgg,
    refundAgg,
    saleOrderGroups,
    refundOrderGroups,
    topProductGroups,
    storeInfo,
    staffInfo,
  ] = await Promise.all([
    // Amount aggregates
    prisma.saleRecord.aggregate({
      where: { ...baseWhere, saleType: 'SALE' },
      _sum: { lineAmount: true },
      _count: true,
    }),
    prisma.saleRecord.aggregate({
      where: { ...baseWhere, saleType: 'REFUND' },
      _sum: { lineAmount: true },
      _count: true,
    }),
    // Distinct sales order count (by orderNo)
    prisma.saleRecord.groupBy({
      by: ['orderNo'],
      where: { ...baseWhere, saleType: 'SALE', orderNo: { not: null } },
    }),
    // Distinct refund order count (by orderNo)
    prisma.saleRecord.groupBy({
      by: ['orderNo'],
      where: { ...baseWhere, saleType: 'REFUND', orderNo: { not: null } },
    }),
    // Top 3 hot products by quantity sold
    prisma.saleRecord.groupBy({
      by: ['productNameSnapshot', 'specSnapshot'],
      where: { ...baseWhere, saleType: 'SALE' },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 3,
    }),
    // Store / staff label lookups
    storeId
      ? prisma.store.findFirst({ where: { id: storeId }, select: { name: true } })
      : Promise.resolve(null),
    operatorUserId
      ? prisma.user.findFirst({ where: { id: operatorUserId }, select: { displayName: true } })
      : Promise.resolve(null),
  ])

  const totalSaleAmount = saleAgg._sum.lineAmount?.toNumber() ?? 0
  const totalRefundAmount = refundAgg._sum.lineAmount?.toNumber() ?? 0 // negative number
  const netAmount = totalSaleAmount + totalRefundAmount
  const saleCount = saleAgg._count
  const refundCount = refundAgg._count
  const saleOrderCount = saleOrderGroups.length
  const refundOrderCount = refundOrderGroups.length
  const avgSaleAmount = saleCount > 0
    ? parseFloat((netAmount / saleCount).toFixed(2))
    : 0

  const topProducts = topProductGroups.map((g) => ({
    name: g.productNameSnapshot,
    spec: g.specSnapshot ?? null,
    totalQty: parseFloat((g._sum.quantity ?? 0).toString()),
  }))

  const breakdown = await getPaymentBreakdown({
    tenantId: ctx.tenantId,
    from,
    to,
    storeId,
    operatorUserId,
  })

  return NextResponse.json({
    dateFrom,
    dateTo,
    dimension,
    storeName: storeInfo?.name ?? null,
    operatorDisplayName: staffInfo?.displayName ?? null,
    totalSaleAmount,
    totalRefundAmount,
    netAmount,
    saleCount,
    refundCount,
    saleOrderCount,
    refundOrderCount,
    avgSaleAmount,
    topProducts,
    cashSaleAmount: breakdown.cashSaleAmount,
    khqrSaleAmount: breakdown.khqrSaleAmount,
  })
}
