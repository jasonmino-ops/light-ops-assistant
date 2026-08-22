import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSalesWorkspaceActor } from '@/lib/sales-workspace-auth'

export async function GET(req: NextRequest) {
  const actor = await getSalesWorkspaceActor(req)
  if (!actor) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const query = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 80)
  const leadSearch = query ? {
    OR: [
      { storeName: { contains: query, mode: 'insensitive' as const } },
      { ownerName: { contains: query, mode: 'insensitive' as const } },
      { normalizedPhone: { contains: query } },
      { telegramUsername: { contains: query, mode: 'insensitive' as const } },
    ],
  } : {}
  const leadWhere = {
    ...(actor.isManager ? {} : { salesOwnerId: actor.userId }),
    ...leadSearch,
  }
  // Unassigned Lead search intentionally excludes owner/phone/Telegram fields.
  const unassignedWhere = {
    salesOwnerId: null,
    ...(query ? { storeName: { contains: query, mode: 'insensitive' as const } } : {}),
  }
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
      where: unassignedWhere,
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
      select: {
        salesLeadId: true,
        content: true,
        createdAt: true,
        sentBy: true,
        senderName: true,
        senderUsername: true,
      },
    })
    : []
  const conversationMap = new Map<string, typeof latestMessages[number]>()
  const contactMap = new Map<string, typeof latestMessages[number]>()
  const replyMap = new Map<string, typeof latestMessages[number]>()
  for (const message of latestMessages) {
    if (message.salesLeadId
      && message.sentBy !== 'SYSTEM'
      && !conversationMap.has(message.salesLeadId)) {
      conversationMap.set(message.salesLeadId, message)
    }
    if (message.salesLeadId && message.sentBy === 'CUSTOMER' && !contactMap.has(message.salesLeadId)) {
      contactMap.set(message.salesLeadId, message)
    }
    if (message.salesLeadId && message.sentBy === 'OPS' && !replyMap.has(message.salesLeadId)) {
      replyMap.set(message.salesLeadId, message)
    }
  }

  return NextResponse.json({
    role: actor.role,
    leads: leads.map((lead) => {
      const conversation = conversationMap.get(lead.id)
      const contact = contactMap.get(lead.id)
      const salesReply = replyMap.get(lead.id)
      const applicantDisplayName = [lead.telegramFirstName, lead.telegramLastName]
        .filter(Boolean).join(' ').trim() || null
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
        telegramDisplayName: contact?.senderName ?? applicantDisplayName,
        telegramUsername: contact?.senderUsername ?? lead.telegramUsername,
        status: lead.status,
        applicationStatus: lead.applications[0]?.status ?? 'NOT_APPLIED',
        converted: Boolean(lead.applications[0]?.createdStoreId),
        lastActivityAt: lead.lastActivityAt.toISOString(),
        conversation: conversation ? {
          lastMessage: conversation.content,
          lastAt: conversation.createdAt.toISOString(),
          lastSentBy: conversation.sentBy,
          hasNewMessage: Boolean(contact && (!salesReply || contact.createdAt > salesReply.createdAt)),
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
