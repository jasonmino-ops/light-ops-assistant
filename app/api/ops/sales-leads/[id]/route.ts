import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkOpsAuthContext, hasOpsRole } from '@/lib/ops-auth'

const MANUAL_STATUSES = new Set(['NEW', 'FOLLOWING', 'LOST'])

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ops = await checkOpsAuthContext(req)
  if (!ops || !hasOpsRole(ops.role, 'OPS_ADMIN')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }
  const { id } = await params
  const lead = await prisma.salesLead.findUnique({
    where: { id },
    include: {
      firstInvite: {
        select: { code: true, sourceChannel: true, campaignLabel: true, internalNote: true },
      },
      initialSalesOwner: { select: { id: true, name: true, role: true } },
      applications: {
        orderBy: { createdAt: 'desc' },
        include: { createdStore: { select: { id: true, code: true, name: true } } },
      },
    },
  })
  if (!lead) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  const block = lead.telegramId ? await prisma.applicationBlock.findUnique({
    where: { telegramId: lead.telegramId },
    include: {
      blockedBy: { select: { id: true, name: true } },
      unblockedBy: { select: { id: true, name: true } },
    },
  }) : null
  return NextResponse.json({
    ...lead,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
    lastActivityAt: lead.lastActivityAt.toISOString(),
    telegramBoundAt: lead.telegramBoundAt?.toISOString() ?? null,
    applications: lead.applications.map((application) => ({
      ...application,
      createdAt: application.createdAt.toISOString(),
      approvedAt: application.approvedAt?.toISOString() ?? null,
    })),
    block: block ? {
      ...block,
      active: !block.unblockedAt,
      blockedAt: block.blockedAt.toISOString(),
      unblockedAt: block.unblockedAt?.toISOString() ?? null,
      createdAt: block.createdAt.toISOString(),
      updatedAt: block.updatedAt.toISOString(),
    } : null,
    conversationUrl: lead.telegramId
      ? `/ops?conversation=${encodeURIComponent(lead.telegramId)}#ops-conversations`
      : null,
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ops = await checkOpsAuthContext(req)
  if (!ops || !hasOpsRole(ops.role, 'OPS_ADMIN')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }
  const body = await req.json().catch(() => null) as { status?: unknown } | null
  if (typeof body?.status !== 'string' || !MANUAL_STATUSES.has(body.status)) {
    return NextResponse.json({ error: 'INVALID_STATUS' }, { status: 400 })
  }
  const { id } = await params
  const updated = await prisma.salesLead.updateMany({
    where: { id, status: { notIn: ['APPLIED', 'ACTIVATED'] } },
    data: { status: body.status as 'NEW' | 'FOLLOWING' | 'LOST', lastActivityAt: new Date() },
  })
  if (updated.count !== 1) return NextResponse.json({ error: 'NOT_EDITABLE' }, { status: 409 })
  return NextResponse.json({ ok: true, status: body.status })
}
