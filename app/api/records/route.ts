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

  const [total, items, saleAgg, refundAgg] = await Promise.all([
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
    // Only aggregate SALE when the filter is ALL or SALE
    saleTypeParam !== 'REFUND'
      ? prisma.saleRecord.aggregate({
          where: { ...where, saleType: 'SALE' },
          _sum: { lineAmount: true },
          _count: true,
        })
      : Promise.resolve(ZERO_AGG),
    // Only aggregate REFUND when the filter is ALL or REFUND
    saleTypeParam !== 'SALE'
      ? prisma.saleRecord.aggregate({
          where: { ...where, saleType: 'REFUND' },
          _sum: { lineAmount: true },
          _count: true,
        })
      : Promise.resolve(ZERO_AGG),
  ])

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

  return NextResponse.json({
    total,
    page,
    pageSize,
    items: items.map((r) => {
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
        // Payment info (null for REFUND / historical orders without PI)
        paymentMethod: pi?.paymentMethod ?? (r.saleType === 'SALE' ? 'CASH' : null),
        paymentStatus: pi?.paymentStatus ?? (r.saleType === 'SALE' ? 'PAID' : null),
      }
    }),
    summary: {
      saleCount: saleAgg._count,
      refundCount: refundAgg._count,
      netAmount: totalSaleAmount + totalRefundAmount,
      cashSaleAmount: breakdown.cashSaleAmount,
      khqrSaleAmount: breakdown.khqrSaleAmount,
    },
  })
}
