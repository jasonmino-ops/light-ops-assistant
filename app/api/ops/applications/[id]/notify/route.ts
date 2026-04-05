/**
 * POST /api/ops/applications/[id]/notify
 *
 * 向申请人的 Telegram 账号发送开通链接消息。
 * 前提：申请已处于 APPROVED 状态，bindTokenValue 已写入。
 * Ops-admin only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkOpsAuth } from '@/lib/ops-auth'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const opsRole = checkOpsAuth(req)
  if (!opsRole) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const { id } = await params

  const app = await prisma.storeApplication.findUnique({ where: { id } })
  if (!app) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  if (app.status !== 'APPROVED' || !app.bindTokenValue) {
    return NextResponse.json({ error: 'NOT_APPROVED', message: '申请尚未通过或缺少开通链接' }, { status: 409 })
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const botUsername = (process.env.TELEGRAM_BOT_USERNAME ?? '').replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '')
  if (!botToken || !botUsername) {
    return NextResponse.json({ error: 'BOT_NOT_CONFIGURED', message: '未配置 TELEGRAM_BOT_TOKEN / TELEGRAM_BOT_USERNAME' }, { status: 500 })
  }

  const tgLink = `https://t.me/${botUsername}?startapp=bind_${app.bindTokenValue}`

  const text =
    `你的店铺申请已通过，请点击下方链接完成正式开通。\n` +
    `ការស្នើសុំបើកហាងរបស់អ្នកត្រូវបានអនុម័តហើយ។ សូមចុចតំណខាងក្រោមដើម្បីបញ្ចប់ការបើកដំណើរការ។\n\n` +
    tgLink

  const apiRes = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: app.telegramId, text }),
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
