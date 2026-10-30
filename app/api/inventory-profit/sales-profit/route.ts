import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryProfitAccess } from '@/lib/inventory-profit/access'
import { normalizeProfit, type ProfitPeriod } from '@/lib/inventory-profit/contract'
import { externalFailure, freshSnapshot } from '@/lib/inventory-profit/http'
import { getInventoryProfitProvider } from '@/lib/inventory-profit/provider'

const PERIODS = new Set<ProfitPeriod>(['TODAY', 'WEEK', 'MONTH'])

export async function GET(req: NextRequest) {
  const access = await requireInventoryProfitAccess(req, { telegramPresence: true })
  if (!access.ok) return access.response
  const period = req.nextUrl.searchParams.get('period') as ProfitPeriod | null
  if (!period || !PERIODS.has(period)) {
    return NextResponse.json({ ok: false, error: 'INVALID_PERIOD' }, { status: 400 })
  }

  try {
    const fresh = freshSnapshot(await getInventoryProfitProvider().getSalesProfit(access.access.ctx.storeId, period))
    if (!fresh.ok) return fresh.response
    return NextResponse.json({
      ok: true,
      asOf: fresh.snapshot.asOf,
      data: normalizeProfit(fresh.snapshot.data),
    }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return externalFailure(error)
  }
}
