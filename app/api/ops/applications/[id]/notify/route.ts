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

const NOTIFY_TEXT =
  '你的开店申请已通过！请返回 Telegram，重新打开店小二助手进入系统。\n' +
  'ការស្នើសុំបើកហាងរបស់អ្នកត្រូវបានអនុម័តហើយ! សូមត្រឡប់ទៅ Telegram ហើយបើក店小二助手ម្ដងទៀតដើម្បីចូលប្រព័ន្ធ។'

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

  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) {
    return NextResponse.json({ error: 'BOT_NOT_CONFIGURED', message: '未配置 TELEGRAM_BOT_TOKEN' }, { status: 500 })
  }

  const apiRes = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: app.telegramId, text: NOTIFY_TEXT }),
    },
  )
  const apiBody = await apiRes.json()

  if (!apiRes.ok || !apiBody.ok) {
    console.error('[notify] Telegram API error:', apiBody)
    return NextResponse.json(
      { error: 'TG_SEND_FAILED', message: `Telegram 发送失败：${apiBody.description ?? apiRes.status}` },
      { status: 502 },
    )
  }

  return NextResponse.json({ ok: true })
}
