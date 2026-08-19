import { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkOpsAuthContext, hasOpsRole } from '@/lib/ops-auth'

const LEAD_STATUSES = ['NEW', 'FOLLOWING', 'WAITING_TELEGRAM', 'APPLIED', 'ACTIVATED', 'LOST']

export async function GET(req: NextRequest) {
  const ops = await checkOpsAuthContext(req)
  if (!ops || !hasOpsRole(ops.role, 'OPS_ADMIN')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 80)
  const requestedStatus = req.nextUrl.searchParams.get('status')
  const where: Prisma.SalesLeadWhereInput = {
    ...(requestedStatus && LEAD_STATUSES.includes(requestedStatus)
      ? { status: requestedStatus as never }
      : {}),
    ...(q ? {
      OR: [
        { storeName: { contains: q, mode: 'insensitive' } },
        { ownerName: { contains: q, mode: 'insensitive' } },
        { normalizedPhone: { contains: q } },
        { firstCampaign: { contains: q, mode: 'insensitive' } },
        { firstInvite: { code: { contains: q, mode: 'insensitive' } } },
      ],
    } : {}),
  }

  const [leads, visits, validLeads, telegramBound, applications, approved, stores] = await Promise.all([
    prisma.salesLead.findMany({
      where,
      orderBy: { lastActivityAt: 'desc' },
      take: 200,
      include: {
        firstInvite: { select: { code: true } },
        initialSalesOwner: { select: { id: true, name: true } },
        applications: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, status: true, createdAt: true, createdStoreId: true },
        },
      },
    }),
    prisma.acquisitionInvite.aggregate({ _sum: { visitCount: true } }),
    prisma.salesLead.count(),
    prisma.salesLead.count({ where: { telegramId: { not: null } } }),
    prisma.storeApplication.count({ where: { salesLeadId: { not: null } } }),
    prisma.storeApplication.count({ where: { salesLeadId: { not: null }, status: 'APPROVED' } }),
    prisma.storeApplication.count({ where: { salesLeadId: { not: null }, createdStoreId: { not: null } } }),
  ])
  const telegramIds = leads.flatMap((lead) => lead.telegramId ? [lead.telegramId] : [])
  const blocks = telegramIds.length > 0 ? await prisma.applicationBlock.findMany({
    where: { telegramId: { in: telegramIds }, unblockedAt: null },
    select: { telegramId: true },
  }) : []
  const blocked = new Set(blocks.map((block) => block.telegramId))

  return NextResponse.json({
    leads: leads.map((lead) => ({
      id: lead.id,
      storeName: lead.storeName,
      ownerName: lead.ownerName,
      phone: lead.normalizedPhone,
      source: lead.firstSourceChannel,
      campaign: lead.firstCampaign,
      inviteCode: lead.firstInvite?.code ?? null,
      salesOwner: lead.initialSalesOwner,
      telegramBound: !!lead.telegramId,
      telegramUsername: lead.telegramUsername,
      status: lead.status,
      lastActivityAt: lead.lastActivityAt.toISOString(),
      application: lead.applications[0]
        ? { ...lead.applications[0], createdAt: lead.applications[0].createdAt.toISOString() }
        : null,
      blocked: lead.telegramId ? blocked.has(lead.telegramId) : false,
    })),
    funnel: {
      visits: visits._sum.visitCount ?? 0,
      validLeads,
      telegramBound,
      applications,
      approved,
      stores,
    },
  })
}
