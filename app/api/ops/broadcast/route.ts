/**
 * POST /api/ops/broadcast
 *
 * 向一批用户群发 Telegram 文本消息。
 * 逐个发送，不依赖 Telegram 原生 @all。
 * 仅发给已绑定 telegramId 的 ACTIVE 用户。
 * 每次发送都写入 TelegramMessage 日志，复用 sendAndLogMessage 底座。
 *
 * Body:
 *   scope    'ALL_OWNERS' | 'ALL_STAFF' | 'TENANT_MEMBERS'
 *   tenantId string  (仅 TENANT_MEMBERS 时必填)
 *   text     string  消息正文
 *
 * Response:
 *   { ok, total, success, failed, errors: [{ displayName, telegramId, error }] }
 */
import { NextRequest, NextResponse } from 'next/server'
import { checkOpsAuth } from '@/lib/ops-auth'
import { prisma } from '@/lib/prisma'
import { sendAndLogMessage } from '@/lib/telegram'
import type { Prisma } from '@prisma/client'

const VALID_SCOPES = ['ALL_OWNERS', 'ALL_STAFF', 'TENANT_MEMBERS'] as const
type Scope = (typeof VALID_SCOPES)[number]

export async function POST(req: NextRequest) {
  const opsRole = checkOpsAuth(req)
  if (!opsRole) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  let body: { scope?: string; tenantId?: string; text?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 }) }

  const { scope, tenantId, text } = body

  if (!scope || !VALID_SCOPES.includes(scope as Scope)) {
    return NextResponse.json({ error: 'INVALID_SCOPE', message: '无效的发送范围' }, { status: 400 })
  }
  if (!text?.trim()) {
    return NextResponse.json({ error: 'MISSING_TEXT', message: '消息内容不能为空' }, { status: 400 })
  }
  if (scope === 'TENANT_MEMBERS' && !tenantId?.trim()) {
    return NextResponse.json({ error: 'MISSING_TENANT', message: '请选择目标商户' }, { status: 400 })
  }

  // ── 查询目标用户 ────────────────────────────────────────────────────────────
  const where: Prisma.UserWhereInput = {
    status: 'ACTIVE',
    telegramId: { not: null },
    ...(scope === 'ALL_OWNERS' && { role: 'OWNER' }),
    ...(scope === 'ALL_STAFF'  && { role: 'STAFF' }),
    ...(scope === 'TENANT_MEMBERS' && { tenantId: tenantId!.trim() }),
  }

  const users = await prisma.user.findMany({
    where,
    select: { id: true, displayName: true, telegramId: true, tenantId: true },
    take: 500, // 安全上限，防止意外群发超大量
  })

  const targets = users.filter((u) => u.telegramId)

  if (targets.length === 0) {
    return NextResponse.json({ ok: true, total: 0, success: 0, failed: 0, errors: [] })
  }

  // ── 逐个发送 ────────────────────────────────────────────────────────────────
  let success = 0
  let failed = 0
  const errors: { displayName: string; telegramId: string; error: string }[] = []

  for (const user of targets) {
    const result = await sendAndLogMessage({
      recipientTelegramId: user.telegramId!,
      text: text.trim(),
      tenantId: user.tenantId,
      sentBy: 'OPS',
    })
    if (result.ok) {
      success++
    } else {
      failed++
      errors.push({
        displayName: user.displayName,
        telegramId: user.telegramId!,
        error: result.error ?? '未知错误',
      })
    }
  }

  return NextResponse.json({ ok: true, total: targets.length, success, failed, errors })
}
