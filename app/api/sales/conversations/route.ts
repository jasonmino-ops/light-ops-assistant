import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  canAccessOwnedSalesLead,
  getSalesWorkspaceActor,
} from '@/lib/sales-workspace-auth'

export async function GET(req: NextRequest) {
  const actor = await getSalesWorkspaceActor(req)
  if (!actor) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  const salesLeadId = (req.nextUrl.searchParams.get('salesLeadId') ?? '').trim()
  if (!salesLeadId) return NextResponse.json({ error: 'MISSING_LEAD' }, { status: 400 })

  const lead = await prisma.salesLead.findUnique({
    where: { id: salesLeadId },
    select: { salesOwnerId: true },
  })
  if (!lead) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  if (!canAccessOwnedSalesLead(actor, lead.salesOwnerId)) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  const messages = await prisma.telegramMessage.findMany({
    where: { channel: 'SALES_ONBOARDING', salesLeadId },
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
