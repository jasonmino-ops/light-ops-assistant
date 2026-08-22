import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendAndLogMessage } from '@/lib/telegram'
import {
  canAccessOwnedSalesLead,
  getSalesWorkspaceActor,
} from '@/lib/sales-workspace-auth'

export async function POST(req: NextRequest) {
  const actor = await getSalesWorkspaceActor(req)
  if (!actor) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  const body = await req.json().catch(() => null) as {
    salesLeadId?: unknown
    inquiryId?: unknown
    text?: unknown
  } | null
  const salesLeadId = typeof body?.salesLeadId === 'string' ? body.salesLeadId.trim() : ''
  const inquiryId = typeof body?.inquiryId === 'string' ? body.inquiryId.trim() : ''
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if ((!salesLeadId && !inquiryId) || (salesLeadId && inquiryId) || !text || text.length > 2000) {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })
  }

  let recipientTelegramId = ''
  let salesInquiryOwnerId: string | null = null
  if (salesLeadId) {
    const lead = await prisma.salesLead.findUnique({
      where: { id: salesLeadId },
      select: { salesOwnerId: true },
    })
    if (!lead) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    if (!canAccessOwnedSalesLead(actor, lead.salesOwnerId)) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }

    const conversation = await prisma.telegramMessage.findFirst({
      where: {
        channel: 'SALES_ONBOARDING',
        salesLeadId,
        sentBy: 'CUSTOMER',
      },
      orderBy: { createdAt: 'desc' },
      select: { recipientTelegramId: true },
    })
    if (!conversation) {
      return NextResponse.json({ error: 'NO_SALES_CONVERSATION' }, { status: 409 })
    }
    recipientTelegramId = conversation.recipientTelegramId
  } else {
    const anchor = await prisma.telegramMessage.findFirst({
      where: {
        id: inquiryId,
        channel: 'SALES_ONBOARDING',
        salesLeadId: null,
        sentBy: 'CUSTOMER',
      },
      select: { recipientTelegramId: true, salesInquiryOwnerId: true },
    })
    if (!anchor) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    if (!actor.isManager && anchor.salesInquiryOwnerId !== actor.userId) {
      return NextResponse.json({ error: 'CLAIM_REQUIRED' }, { status: 403 })
    }
    recipientTelegramId = anchor.recipientTelegramId
    salesInquiryOwnerId = anchor.salesInquiryOwnerId
  }

  const result = await sendAndLogMessage({
    recipientTelegramId,
    text,
    sentBy: 'OPS',
    botToken: process.env.SALES_ONBOARDING_BOT_TOKEN,
    channel: 'SALES_ONBOARDING',
    salesLeadId: salesLeadId || null,
    salesInquiryOwnerId,
  })
  if (!result.ok) {
    return NextResponse.json({ error: 'TELEGRAM_SEND_FAILED' }, { status: 502 })
  }
  if (salesLeadId) {
    await prisma.salesLead.update({
      where: { id: salesLeadId },
      data: { lastActivityAt: new Date() },
    }).catch(() => null)
  }
  return NextResponse.json({ ok: true })
}
