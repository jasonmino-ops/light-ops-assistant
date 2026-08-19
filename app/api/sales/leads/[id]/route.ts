import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  canAccessOwnedSalesLead,
  getSalesWorkspaceActor,
} from '@/lib/sales-workspace-auth'

const MANUAL_STATUSES = new Set(['NEW', 'FOLLOWING', 'LOST'])

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await getSalesWorkspaceActor(req)
  if (!actor) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  const body = await req.json().catch(() => null) as { status?: unknown } | null
  if (typeof body?.status !== 'string' || !MANUAL_STATUSES.has(body.status)) {
    return NextResponse.json({ error: 'INVALID_STATUS' }, { status: 400 })
  }

  const { id } = await params
  const lead = await prisma.salesLead.findUnique({
    where: { id },
    select: { salesOwnerId: true },
  })
  if (!lead) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  if (!canAccessOwnedSalesLead(actor, lead.salesOwnerId)) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  const updated = await prisma.salesLead.updateMany({
    where: { id, status: { notIn: ['APPLIED', 'ACTIVATED'] } },
    data: {
      status: body.status as 'NEW' | 'FOLLOWING' | 'LOST',
      lastActivityAt: new Date(),
    },
  })
  if (updated.count !== 1) {
    return NextResponse.json({ error: 'SYSTEM_STATUS_LOCKED' }, { status: 409 })
  }
  return NextResponse.json({ ok: true, status: body.status })
}
