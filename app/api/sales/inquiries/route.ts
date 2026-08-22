import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSalesWorkspaceActor } from '@/lib/sales-workspace-auth'

const INQUIRY_WHERE = {
  channel: 'SALES_ONBOARDING',
  salesLeadId: null,
} as const

export async function GET(req: NextRequest) {
  const actor = await getSalesWorkspaceActor(req)
  if (!actor) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const inquiryId = (req.nextUrl.searchParams.get('inquiryId') ?? '').trim()
  if (inquiryId) {
    const anchor = await prisma.telegramMessage.findFirst({
      where: { id: inquiryId, ...INQUIRY_WHERE, sentBy: 'CUSTOMER' },
      select: { recipientTelegramId: true, salesInquiryOwnerId: true },
    })
    if (!anchor) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    if (!actor.isManager && anchor.salesInquiryOwnerId !== actor.userId) {
      return NextResponse.json({ error: 'CLAIM_REQUIRED' }, { status: 403 })
    }

    const messages = await prisma.telegramMessage.findMany({
      where: { ...INQUIRY_WHERE, recipientTelegramId: anchor.recipientTelegramId },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: {
        id: true,
        sentBy: true,
        senderName: true,
        senderUsername: true,
        content: true,
        messageType: true,
        status: true,
        createdAt: true,
      },
    })
    return NextResponse.json({
      messages: messages.map((message) => ({
        ...message,
        createdAt: message.createdAt.toISOString(),
      })),
    })
  }

  // One bounded recent row-set is grouped in memory so the API never exposes
  // recipientTelegramId. V0.1 intentionally has no inquiry/conversation model.
  const recent = await prisma.telegramMessage.findMany({
    where: INQUIRY_WHERE,
    orderBy: { createdAt: 'desc' },
    take: 1000,
    select: {
      id: true,
      recipientTelegramId: true,
      senderName: true,
      senderUsername: true,
      content: true,
      createdAt: true,
      sentBy: true,
      salesInquiryOwnerId: true,
      salesInquiryOwner: { select: { id: true, name: true } },
    },
  })
  const grouped = new Map<string, {
    customer?: typeof recent[number]
    reply?: typeof recent[number]
  }>()
  for (const message of recent) {
    const group = grouped.get(message.recipientTelegramId) ?? {}
    if (message.sentBy === 'CUSTOMER' && !group.customer) group.customer = message
    if (message.sentBy === 'OPS' && !group.reply) group.reply = message
    grouped.set(message.recipientTelegramId, group)
  }
  const query = (req.nextUrl.searchParams.get('q') ?? '').trim().toLocaleLowerCase().slice(0, 80)
  const inquiries = Array.from(grouped.values()).flatMap((group) => {
    const message = group.customer
    if (!message) return []
    if (!actor.isManager
      && message.salesInquiryOwnerId
      && message.salesInquiryOwnerId !== actor.userId) return []
    const canSeeIdentity = actor.isManager || message.salesInquiryOwnerId === actor.userId
    const latestHuman = !group.reply || message.createdAt > group.reply.createdAt
      ? message
      : group.reply
    const searchable = [
      message.senderName,
      latestHuman.content,
      canSeeIdentity ? message.senderUsername : null,
    ].filter(Boolean).join(' ').toLocaleLowerCase()
    if (query && !searchable.includes(query)) return []
    return [{
      id: message.id,
      senderName: message.senderName,
      senderUsername: canSeeIdentity ? message.senderUsername : null,
      latestMessage: latestHuman.content,
      lastAt: latestHuman.createdAt.toISOString(),
      hasNewMessage: !group.reply || message.createdAt > group.reply.createdAt,
      claimed: Boolean(message.salesInquiryOwnerId),
      ownedByMe: message.salesInquiryOwnerId === actor.userId,
      owner: canSeeIdentity
        ? message.salesInquiryOwner
        : null,
    }]
  })
  return NextResponse.json({ inquiries })
}

export async function POST(req: NextRequest) {
  const actor = await getSalesWorkspaceActor(req)
  if (!actor || actor.userId === '_ops_admin') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }
  const body = await req.json().catch(() => null) as { inquiryId?: unknown } | null
  const inquiryId = typeof body?.inquiryId === 'string' ? body.inquiryId.trim() : ''
  if (!inquiryId) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })

  const admin = await prisma.opsAdmin.findUnique({
    where: { id: actor.userId },
    select: { id: true, name: true, status: true, role: true },
  })
  if (!admin || admin.status !== 'ACTIVE' || admin.role !== actor.role) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  const result = await prisma.$transaction(async (tx) => {
    const anchor = await tx.telegramMessage.findFirst({
      where: { id: inquiryId, ...INQUIRY_WHERE, sentBy: 'CUSTOMER' },
      select: { recipientTelegramId: true },
    })
    if (!anchor) return { status: 'NOT_FOUND' as const }

    const current = await tx.telegramMessage.findFirst({
      where: {
        ...INQUIRY_WHERE,
        recipientTelegramId: anchor.recipientTelegramId,
        salesInquiryOwnerId: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      select: { salesInquiryOwnerId: true },
    })
    if (current?.salesInquiryOwnerId && current.salesInquiryOwnerId !== admin.id) {
      return { status: 'ALREADY_CLAIMED' as const }
    }
    if (current?.salesInquiryOwnerId === admin.id) {
      return { status: 'OWNED' as const }
    }

    const claimed = await tx.telegramMessage.updateMany({
      where: {
        ...INQUIRY_WHERE,
        recipientTelegramId: anchor.recipientTelegramId,
        salesInquiryOwnerId: null,
      },
      data: { salesInquiryOwnerId: admin.id },
    })
    if (claimed.count > 0) return { status: 'CLAIMED' as const }

    const raced = await tx.telegramMessage.findFirst({
      where: {
        ...INQUIRY_WHERE,
        recipientTelegramId: anchor.recipientTelegramId,
        salesInquiryOwnerId: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      select: { salesInquiryOwnerId: true },
    })
    return raced?.salesInquiryOwnerId === admin.id
      ? { status: 'OWNED' as const }
      : { status: 'ALREADY_CLAIMED' as const }
  })

  if (result.status === 'NOT_FOUND') {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }
  if (result.status === 'ALREADY_CLAIMED') {
    return NextResponse.json({ error: 'ALREADY_CLAIMED' }, { status: 409 })
  }
  return NextResponse.json({
    ok: true,
    alreadyOwned: result.status === 'OWNED',
    owner: { id: admin.id, name: admin.name },
  })
}
