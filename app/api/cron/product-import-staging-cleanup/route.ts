import { NextRequest, NextResponse } from 'next/server'
import { cleanupExpiredProductImportJobs } from '@/lib/product-bulk-import/jobs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

function authorized(value: string | null): boolean {
  const secret = process.env.CRON_SECRET
  return !!secret && value === `Bearer ${secret}`
}
export async function GET(req: NextRequest) {
  if (!authorized(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }
  const result = await cleanupExpiredProductImportJobs()
  return NextResponse.json(result, { status: result.failed > 0 ? 503 : 200 })
}
