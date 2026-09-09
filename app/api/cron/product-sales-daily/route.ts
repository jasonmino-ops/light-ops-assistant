import { NextRequest, NextResponse } from 'next/server'
import { generateDailyReports, scheduledAuthorization } from '@/lib/product-sales/daily'
import { errorResponse, noStore } from '@/lib/product-sales/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300
export async function GET(req: NextRequest) {
  if (!scheduledAuthorization(req.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401, headers: noStore })
  }
  try {
    const result = await generateDailyReports()
    return NextResponse.json(result, { status: result.failed ? 503 : 200, headers: noStore })
  } catch (error) { return errorResponse(error) }
}
