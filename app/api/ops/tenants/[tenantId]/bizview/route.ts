/**
 * GET /api/ops/tenants/[tenantId]/bizview?days=7
 *
 * Read-only business data for ops review. Returns:
 *   - overview:       aggregate sales/refund for the period
 *   - topProducts:    top 5 by revenue
 *   - recentRecords:  latest 30 records
 *   - staffStats:     per-staff sales for the period
 *   - productCount:   total active products
 *
 * Ops-admin only. Bypasses merchant auth — uses checkOpsAuth.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkOpsAuth } from '@/lib/ops-auth'
import { getPaymentBreakdown } from '@/lib/payment-breakdown'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const opsRole = checkOpsAuth(req)
  if (!opsRole) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const { tenantId } = await params
  const days = Math.min(30, Math.max(1, parseInt(req.nextUrl.searchParams.get('days') ?? '7', 10)))

  const from = new Date()
  from.setDate(from.getDate() - days + 1)
  from.setHours(0, 0, 0, 0)

  const [saleAgg, refundAgg, topProducts, recentRecords, staffGroups, productCount] =
    await Promise.all([
      prisma.saleRecord.aggregate({
        where: { tenantId, saleType: 'SALE', status: 'COMPLETED', createdAt: { gte: from } },
        _sum: { lineAmount: true },
        _count: true,
      }),
      prisma.saleRecord.aggregate({
        where: { tenantId, saleType: 'REFUND', status: 'COMPLETED', createdAt: { gte: from } },
        _sum: { lineAmount: true },
        _count: true,
      }),
      prisma.saleRecord.groupBy({
        by: ['productNameSnapshot', 'specSnapshot'],
        where: { tenantId, saleType: 'SALE', status: 'COMPLETED', createdAt: { gte: from } },
        _sum: { quantity: true, lineAmount: true },
        orderBy: { _sum: { lineAmount: 'desc' } },
        take: 5,
      }),
      prisma.saleRecord.findMany({
        where: { tenantId },
        include: {
          store: { select: { name: true } },
          operatorUser: { select: { displayName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      prisma.saleRecord.groupBy({
        by: ['operatorUserId'],
        where: { tenantId, saleType: 'SALE', status: 'COMPLETED', createdAt: { gte: from } },
        _sum: { lineAmount: true },
        _count: true,
      }),
      prisma.product.count({ where: { tenantId, status: 'ACTIVE' } }),
    ])

  // Resolve staff display names in one query
  const staffIds = staffGroups.map((g) => g.operatorUserId).filter(Boolean) as string[]
  const staffUsers =
    staffIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: staffIds } },
          select: { id: true, displayName: true },
        })
      : []
  const staffMap = Object.fromEntries(staffUsers.map((u) => [u.id, u.displayName]))

  const saleAmount = saleAgg._sum.lineAmount?.toNumber() ?? 0
  const refundRaw = refundAgg._sum.lineAmount?.toNumber() ?? 0

  const breakdown = await getPaymentBreakdown({ tenantId, from, to: new Date() })

  return NextResponse.json({
    days,
    overview: {
      saleAmount: parseFloat(saleAmount.toFixed(2)),
      saleCount: saleAgg._count,
      refundAmount: parseFloat(Math.abs(refundRaw).toFixed(2)),
      refundCount: refundAgg._count,
      netAmount: parseFloat((saleAmount + refundRaw).toFixed(2)),
      cashSaleAmount: breakdown.cashSaleAmount,
      khqrSaleAmount: breakdown.khqrSaleAmount,
    },
    topProducts: topProducts.map((p) => ({
      name: p.productNameSnapshot,
      spec: p.specSnapshot ?? null,
      qty: parseFloat(String(p._sum.quantity ?? 0)),
      amount: parseFloat((p._sum.lineAmount?.toNumber() ?? 0).toFixed(2)),
    })),
    recentRecords: recentRecords.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      saleType: r.saleType,
      productName: r.productNameSnapshot,
      spec: r.specSnapshot ?? null,
      qty: r.quantity.toNumber(),
      lineAmount: r.lineAmount.toNumber(),
      storeName: r.store.name,
      operator: r.operatorUser.displayName,
      orderNo: r.orderNo ?? null,
    })),
    staffStats: staffGroups
      .map((g) => ({
        displayName: staffMap[g.operatorUserId as string] ?? g.operatorUserId ?? '—',
        saleCount: g._count,
        saleAmount: parseFloat((g._sum.lineAmount?.toNumber() ?? 0).toFixed(2)),
      }))
      .sort((a, b) => b.saleAmount - a.saleAmount),
    productCount,
  })
}
