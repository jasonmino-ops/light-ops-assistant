import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSalesWorkspaceActor } from '@/lib/sales-workspace-auth'

export async function GET(req: NextRequest) {
  const actor = await getSalesWorkspaceActor(req)
  if (!actor) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const leadWhere = actor.isManager ? {} : { salesOwnerId: actor.userId }
  const [leads, unassigned, unlinkedInquiryCount] = await Promise.all([
    prisma.salesLead.findMany({
      where: leadWhere,
      orderBy: { lastActivityAt: 'desc' },
      take: 200,
      include: {
        firstInvite: { select: { code: true } },
        salesOwner: { select: { id: true, name: true } },
        applications: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, status: true, createdStoreId: true, createdAt: true },
        },
      },
    }),
    prisma.salesLead.findMany({
      where: { salesOwnerId: null },
      orderBy: { lastActivityAt: 'desc' },
      take: 100,
      include: {
        firstInvite: { select: { code: true } },
        applications: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { status: true },
        },
      },
    }),
    actor.isManager
      ? prisma.telegramMessage.count({
        where: { channel: 'SALES_ONBOARDING', salesLeadId: null, sentBy: 'CUSTOMER' },
      })
      : Promise.resolve(0),
  ])

  const leadIds = leads.map((lead) => lead.id)
  const latestMessages = leadIds.length > 0
    ? await prisma.telegramMessage.findMany({
      where: { channel: 'SALES_ONBOARDING', salesLeadId: { in: leadIds } },
      orderBy: { createdAt: 'desc' },
      select: { salesLeadId: true, content: true, createdAt: true, sentBy: true },
    })
    : []
  const conversationMap = new Map<string, typeof latestMessages[number]>()
  for (const message of latestMessages) {
    if (message.salesLeadId && !conversationMap.has(message.salesLeadId)) {
      conversationMap.set(message.salesLeadId, message)
    }
  }

  return NextResponse.json({
    role: actor.role,
    leads: leads.map((lead) => {
      const conversation = conversationMap.get(lead.id)
      return {
        id: lead.id,
        storeName: lead.storeName,
        ownerName: lead.ownerName,
        phone: lead.normalizedPhone,
        source: lead.firstSourceChannel,
        campaign: lead.firstCampaign,
        inviteCode: lead.firstInvite?.code ?? null,
        salesOwner: lead.salesOwner,
        telegramBound: Boolean(lead.telegramId),
        status: lead.status,
        applicationStatus: lead.applications[0]?.status ?? 'NOT_APPLIED',
        converted: Boolean(lead.applications[0]?.createdStoreId),
        lastActivityAt: lead.lastActivityAt.toISOString(),
        conversation: conversation ? {
          lastMessage: conversation.content,
          lastAt: conversation.createdAt.toISOString(),
          lastSentBy: conversation.sentBy,
        } : null,
      }
    }),
    unassigned: unassigned.map((lead) => ({
      id: lead.id,
      storeName: lead.storeName,
      source: lead.firstSourceChannel,
      campaign: lead.firstCampaign,
      inviteCode: lead.firstInvite?.code ?? null,
      status: lead.status,
      applicationStatus: lead.applications[0]?.status ?? 'NOT_APPLIED',
      lastActivityAt: lead.lastActivityAt.toISOString(),
    })),
    unlinkedInquiryCount,
  })
}
