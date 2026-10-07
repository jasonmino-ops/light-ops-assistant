import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { runCustomerOrderFulfillmentRecovery } from '@/lib/customer-order-fulfillment'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Fallback metadata/sealed-job recovery only. Normal rendering is driven by
// the independent controller, not by this five-minute route or a page GET.

function authorized(value: string | null): boolean {
  const secret = process.env.CRON_SECRET
  return !!secret && value === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorized(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }
  const result = await runCustomerOrderFulfillmentRecovery(prisma, new Date())
  return NextResponse.json(result, { status: result.ok ? 200 : 503 })
}
