import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getSalesWorkspaceActor } from '@/lib/sales-workspace-auth'

export async function GET(req: NextRequest) {
  const actor = await getSalesWorkspaceActor(req)
  if (!actor) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const query = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 80)
  const view = req.nextUrl.searchParams.get('view') === 'activated' ? 'activated' : 'all'
  const leadSearch: Prisma.SalesLeadWhereInput = query ? {
    OR: [
      { storeName: { contains: query, mode: 'insensitive' as const } },
      { ownerName: { contains: query, mode: 'insensitive' as const } },
      { normalizedPhone: { contains: query } },
      { telegramUsername: { contains: query, mode: 'insensitive' as const } },
    ],
  } : {}
  const conversionEvidenceWhere: Prisma.SalesLeadWhereInput = {
    status: 'ACTIVATED',
    applications: {
      some: {
        status: 'APPROVED',
        createdStoreId: { not: null },
        createdStore: { isNot: null },
      },
    },
  }
  const currentOwnerWhere: Prisma.SalesLeadWhereInput = actor.isManager
    ? {}
    : { salesOwnerId: actor.userId }
  const performanceWhere: Prisma.SalesLeadWhereInput = actor.isManager
    ? conversionEvidenceWhere
    : { ...conversionEvidenceWhere, initialSalesOwnerId: actor.userId }
  // Follow-up ownership is current-owner scoped. Completed performance is permanently
  // attributed to the first-touch owner, even after a later reassignment.
  const visibleLeadWhere: Prisma.SalesLeadWhereInput = actor.isManager
    ? {}
    : {
      OR: [
        { salesOwnerId: actor.userId, status: { not: 'ACTIVATED' } },
        performanceWhere,
      ],
    }
  const leadWhere: Prisma.SalesLeadWhereInput = {
    AND: [
      visibleLeadWhere,
      view === 'activated' ? performanceWhere : {},
      leadSearch,
    ],
  }
  // Unassigned Lead search intentionally excludes owner/phone/Telegram fields.
  const unassignedWhere: Prisma.SalesLeadWhereInput = {
    salesOwnerId: null,
    status: { not: 'ACTIVATED' as const },
    ...(query ? { storeName: { contains: query, mode: 'insensitive' as const } } : {}),
  }
  const [
    leads,
    unassigned,
    unlinkedInquiryCount,
    mineCount,
    newOwnedCount,
    followingCount,
    pendingCount,
    activatedCount,
    unassignedCount,
  ] = await Promise.all([
    prisma.salesLead.findMany({
      where: leadWhere,
      orderBy: { lastActivityAt: 'desc' },
      take: 200,
      include: {
        firstInvite: { select: { code: true } },
        initialSalesOwner: { select: { id: true, name: true } },
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
    prisma.salesLead.count({ where: visibleLeadWhere }),
    prisma.salesLead.count({
      where: { ...currentOwnerWhere, status: { in: ['NEW', 'WAITING_TELEGRAM'] } },
    }),
    prisma.salesLead.count({ where: { ...currentOwnerWhere, status: 'FOLLOWING' } }),
    prisma.salesLead.count({
      where: {
        ...currentOwnerWhere,
        status: { not: 'ACTIVATED' },
        applications: { some: { status: 'PENDING' } },
      },
    }),
    prisma.salesLead.count({ where: performanceWhere }),
    prisma.salesLead.count({ where: { salesOwnerId: null, status: { not: 'ACTIVATED' } } }),
  ])

  const leadIds = leads.map((lead) => lead.id)
  const [latestMessages, conversionApplications] = leadIds.length > 0
    ? await Promise.all([
      prisma.telegramMessage.findMany({
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
      }),
      prisma.storeApplication.findMany({
        where: {
          salesLeadId: { in: leadIds },
          status: 'APPROVED',
          createdStoreId: { not: null },
          createdStore: { isNot: null },
        },
        orderBy: [{ approvedAt: 'desc' }, { createdAt: 'desc' }],
        select: {
          salesLeadId: true,
          approvedAt: true,
          createdStore: { select: { status: true, createdAt: true } },
        },
      }),
    ])
    : [[], []]
  const conversationMap = new Map<string, typeof latestMessages[number]>()
  const contactMap = new Map<string, typeof latestMessages[number]>()
  const replyMap = new Map<string, typeof latestMessages[number]>()
  const conversionMap = new Map<string, typeof conversionApplications[number]>()
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
  for (const application of conversionApplications) {
    if (application.salesLeadId && !conversionMap.has(application.salesLeadId)) {
      conversionMap.set(application.salesLeadId, application)
    }
  }

  return NextResponse.json({
    role: actor.role,
    summary: {
      mine: mineCount,
      new: newOwnedCount + (actor.isManager ? 0 : unassignedCount),
      following: followingCount,
      pending: pendingCount,
      activated: activatedCount,
    },
    leads: leads.map((lead) => {
      const conversation = conversationMap.get(lead.id)
      const contact = contactMap.get(lead.id)
      const salesReply = replyMap.get(lead.id)
      const conversion = lead.status === 'ACTIVATED' ? conversionMap.get(lead.id) : undefined
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
        initialSalesOwner: lead.initialSalesOwner,
        salesOwner: lead.salesOwner,
        telegramBound: Boolean(lead.telegramId),
        telegramDisplayName: contact?.senderName ?? applicantDisplayName,
        telegramUsername: contact?.senderUsername ?? lead.telegramUsername,
        status: lead.status,
        applicationStatus: lead.applications[0]?.status ?? 'NOT_APPLIED',
        converted: Boolean(conversion?.createdStore),
        openedAt: conversion
          ? (conversion.approvedAt ?? conversion.createdStore!.createdAt).toISOString()
          : null,
        storeStatus: conversion?.createdStore?.status ?? null,
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
