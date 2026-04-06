/**
 * POST /api/ops/applications/[id]/notify
 *
 * 向申请人重新发送审批通过通知（补发兜底）。
 * 前提：申请已处于 APPROVED 状态。
 * Ops-admin only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkOpsAuth } from '@/lib/ops-auth'
import { sendAndLogMessage, WELCOME_TEXT } from '@/lib/telegram'

const NOTIFY_TEXT =
  '你的开店申请已通过！请返回 Telegram，重新打开店小二助手进入系统。\n' +
  'ការស្នើសុំបើកហាងរបស់អ្នកត្រូវបានអនុម័តហើយ! សូមត្រឡប់ទៅ Telegram ហើយបើក店小二助手ម្ដងទៀតដើម្បីចូលប្រព័ន្ធ។\n\n' +
  WELCOME_TEXT

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const opsRole = checkOpsAuth(req)
  if (!opsRole) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const { id } = await params

  const app = await prisma.storeApplication.findUnique({ where: { id } })
  if (!app) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  if (app.status !== 'APPROVED') {
    return NextResponse.json({ error: 'NOT_APPROVED', message: '申请尚未审批通过' }, { status: 409 })
  }

  const result = await sendAndLogMessage({
    recipientTelegramId: app.telegramId,
    text: NOTIFY_TEXT,
    tenantId: app.tenantId ?? undefined,
    sentBy: 'OPS',
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: 'TG_SEND_FAILED', message: `Telegram 发送失败：${result.error}` },
      { status: 502 },
    )
  }

  return NextResponse.json({ ok: true })
}
