import { NextRequest, NextResponse } from 'next/server'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/prisma'
import { computeSubscriptionReminder } from '@/lib/subscription-reminder'

export async function GET(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const subscription = await prisma.tenantSubscription.findUnique({
    where: { tenantId: ctx.tenantId },
    select: {
      status: true,
      trialEndsAt: true,
      currentPeriodEndsAt: true,
    },
  })

  return NextResponse.json(computeSubscriptionReminder(subscription), {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
