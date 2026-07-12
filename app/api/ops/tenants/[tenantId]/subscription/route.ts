import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkOpsAuthContext } from '@/lib/ops-auth'
import {
  ensureMigratedSubscriptionForTenant,
  serializeSubscription,
  serializeSubscriptionEvent,
} from '@/lib/subscription'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const ops = await checkOpsAuthContext(req)
  if (!ops) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  const { tenantId } = await params

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true },
  })
  if (!tenant) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  const subscription = await prisma.$transaction(async (tx) => (
    ensureMigratedSubscriptionForTenant(tx, tenantId)
  ))

  const recentEvents = await prisma.subscriptionEvent.findMany({
    where: { tenantId, subscriptionId: subscription.id },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })

  return NextResponse.json({
    subscription: serializeSubscription(subscription),
    recentEvents: recentEvents.map(serializeSubscriptionEvent),
  })
}
