/**
 * GET  /api/ops/messages?limit=50         — 最近的客户来信（sentBy=CUSTOMER）
 * POST /api/ops/messages                  — 运营后台向指定用户发送 Telegram 消息
 *
 * Body (POST): { recipientTelegramId: string; text: string; tenantId?: string }
 */
import { NextRequest, NextResponse } from 'next/server'
import { checkOpsAuth } from '@/lib/ops-auth'
import { sendAndLogMessage } from '@/lib/telegram'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const opsRole = checkOpsAuth(req)
  if (!opsRole) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? '50'), 100)

  const rows = await prisma.telegramMessage.findMany({
    where: { sentBy: 'CUSTOMER' },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      recipientTelegramId: true,
      content: true,
      tenantId: true,
      createdAt: true,
    },
  })

  return NextResponse.json(rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
  })))
}

export async function POST(req: NextRequest) {
  const opsRole = checkOpsAuth(req)
  if (!opsRole) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  let body: { recipientTelegramId?: string; text?: string; tenantId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const { recipientTelegramId, text, tenantId } = body
  if (!recipientTelegramId?.trim() || !text?.trim()) {
    return NextResponse.json({ error: 'MISSING_FIELDS', message: '缺少 recipientTelegramId 或 text' }, { status: 400 })
  }

  const result = await sendAndLogMessage({
    recipientTelegramId: recipientTelegramId.trim(),
    text: text.trim(),
    tenantId,
    sentBy: 'OPS',
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: 'TG_SEND_FAILED', message: `发送失败：${result.error}` },
      { status: 502 },
    )
  }

  return NextResponse.json({ ok: true })
}
