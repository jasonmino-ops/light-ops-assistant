/**
 * GET /api/ops/conversations/[telegramId]
 *
 * 返回与某个客户的完整会话记录（客户发入 + 后台回复），按时间升序。
 */
import { NextRequest, NextResponse } from 'next/server'
import { checkOpsAuth } from '@/lib/ops-auth'
import { prisma } from '@/lib/prisma'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ telegramId: string }> },
) {
  const opsRole = checkOpsAuth(req)
  if (!opsRole) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const { telegramId } = await params

  const messages = await prisma.telegramMessage.findMany({
    where: { recipientTelegramId: telegramId },
    orderBy: { createdAt: 'asc' },
    take: 100,
    select: {
      id: true,
      sentBy: true,
      senderName: true,
      content: true,
      messageType: true,
      status: true,
      errorMessage: true,
      createdAt: true,
    },
  })

  return NextResponse.json(
    messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
  )
}
