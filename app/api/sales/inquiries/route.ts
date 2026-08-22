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
    where: { ...INQUIRY_WHERE, sentBy: 'CUSTOMER' },
    orderBy: { createdAt: 'desc' },
    take: 500,
    select: {
      id: true,
      recipientTelegramId: true,
      senderName: true,
      content: true,
      createdAt: true,
      salesInquiryOwnerId: true,
      salesInquiryOwner: { select: { id: true, name: true } },
    },
  })
  const seen = new Set<string>()
  const inquiries = recent.flatMap((message) => {
    if (seen.has(message.recipientTelegramId)) return []
    seen.add(message.recipientTelegramId)
    if (!actor.isManager
      && message.salesInquiryOwnerId
      && message.salesInquiryOwnerId !== actor.userId) return []
    return [{
      id: message.id,
      senderName: message.senderName,
      latestMessage: message.content,
      lastAt: message.createdAt.toISOString(),
      claimed: Boolean(message.salesInquiryOwnerId),
      ownedByMe: message.salesInquiryOwnerId === actor.userId,
      owner: actor.isManager || message.salesInquiryOwnerId === actor.userId
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
