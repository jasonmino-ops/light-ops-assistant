import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

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
  const ctx = getContext(req)
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseWhere: any = {
    tenantId: ctx.tenantId,
    createdAt: { gte: from, lte: to },
    ...(storeId ? { storeId } : {}),
    ...(operatorUserId ? { operatorUserId } : {}),
  }

  // Aggregate SALE and REFUND in parallel
  const [saleAgg, refundAgg, storeInfo, staffInfo] = await Promise.all([
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
  const avgSaleAmount = saleCount > 0
    ? parseFloat((netAmount / saleCount).toFixed(2))
    : 0

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
    avgSaleAmount,
  })
}
