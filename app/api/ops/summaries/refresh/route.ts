/**
 * POST /api/ops/summaries/refresh
 *
 * Computes TenantDailySummary + StoreDailySummary for a given UTC date
 * and upserts the results. Safe to call multiple times (idempotent).
 *
 * Body: { date?: string }   // YYYY-MM-DD UTC; defaults to today
 *
 * Access: any ops role.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkOpsAuth } from '@/lib/ops-auth'

interface Agg {
  saleOrderNos: Set<string>
  refundCount: number
  grossSales: number
  refundAmount: number
}

export async function POST(req: NextRequest) {
  const opsRole = checkOpsAuth(req)
  if (!opsRole) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  let body: { date?: string } = {}
  try { body = (await req.json()) ?? {} } catch { /* empty body ok */ }

  const date = (body.date ?? new Date().toISOString().slice(0, 10)).trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'INVALID_DATE', message: 'date must be YYYY-MM-DD (UTC)' }, { status: 400 })
  }

  const start = new Date(date + 'T00:00:00.000Z')
  const end   = new Date(date + 'T23:59:59.999Z')

  // Fetch only COMPLETED records — CANCELLED and PENDING_PAYMENT must not count as revenue
  const records = await prisma.saleRecord.findMany({
    where: { createdAt: { gte: start, lte: end }, status: 'COMPLETED' },
    select: { id: true, tenantId: true, storeId: true, saleType: true, lineAmount: true, orderNo: true },
  })

  const tenantAgg = new Map<string, Agg>()
  const storeAgg  = new Map<string, { tenantId: string } & Agg>()

  function getOrCreate<T>(map: Map<string, T>, key: string, init: () => T): T {
    if (!map.has(key)) map.set(key, init())
    return map.get(key)!
  }

  for (const r of records) {
    const ta = getOrCreate(tenantAgg, r.tenantId, () =>
      ({ saleOrderNos: new Set(), refundCount: 0, grossSales: 0, refundAmount: 0 }))
    const sa = getOrCreate(storeAgg, r.storeId, () =>
      ({ tenantId: r.tenantId, saleOrderNos: new Set(), refundCount: 0, grossSales: 0, refundAmount: 0 }))

    if (r.saleType === 'SALE') {
      // Count by distinct orderNo (skip null orderNos — legacy lines without a parent order)
      if (r.orderNo) { ta.saleOrderNos.add(r.orderNo); sa.saleOrderNos.add(r.orderNo) }
      const amt = Number(r.lineAmount)
      ta.grossSales += amt; sa.grossSales += amt
    } else {
      ta.refundCount++; sa.refundCount++
      const amt = Math.abs(Number(r.lineAmount))
      ta.refundAmount += amt; sa.refundAmount += amt
    }
  }

  const now = new Date()

  function round2(n: number) { return Math.round(n * 100) / 100 }

  const tenantUpserts = Array.from(tenantAgg.entries()).map(([tenantId, a]) => {
    const gross   = round2(a.grossSales)
    const refund  = round2(a.refundAmount)
    const net     = round2(gross - refund)
    const common  = { salesCount: a.saleOrderNos.size, refundCount: a.refundCount, grossSales: gross, refundAmount: refund, netSales: net, computedAt: now }
    return prisma.tenantDailySummary.upsert({
      where:  { tenantId_date: { tenantId, date } },
      create: { date, tenantId, ...common },
      update: common,
    })
  })

  const storeUpserts = Array.from(storeAgg.entries()).map(([storeId, a]) => {
    const gross   = round2(a.grossSales)
    const refund  = round2(a.refundAmount)
    const net     = round2(gross - refund)
    const common  = { salesCount: a.saleOrderNos.size, refundCount: a.refundCount, grossSales: gross, refundAmount: refund, netSales: net, computedAt: now }
    return prisma.storeDailySummary.upsert({
      where:  { storeId_date: { storeId, date } },
      create: { date, tenantId: a.tenantId, storeId, ...common },
      update: common,
    })
  })

  await Promise.all([...tenantUpserts, ...storeUpserts])

  return NextResponse.json({
    ok: true,
    date,
    recordsProcessed: records.length,
    tenantSummaries: tenantAgg.size,
    storeSummaries: storeAgg.size,
  })
}
