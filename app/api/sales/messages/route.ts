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
    text?: unknown
  } | null
  const salesLeadId = typeof body?.salesLeadId === 'string' ? body.salesLeadId.trim() : ''
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (!salesLeadId || !text || text.length > 2000) {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })
  }

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

  const result = await sendAndLogMessage({
    recipientTelegramId: conversation.recipientTelegramId,
    text,
    sentBy: 'OPS',
    botToken: process.env.SALES_ONBOARDING_BOT_TOKEN,
    channel: 'SALES_ONBOARDING',
    salesLeadId,
  })
  if (!result.ok) {
    return NextResponse.json({ error: 'TELEGRAM_SEND_FAILED' }, { status: 502 })
  }
  await prisma.salesLead.update({
    where: { id: salesLeadId },
    data: { lastActivityAt: new Date() },
  }).catch(() => null)
  return NextResponse.json({ ok: true })
}
