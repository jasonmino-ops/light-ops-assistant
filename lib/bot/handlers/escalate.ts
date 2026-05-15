/**
 * lib/bot/handlers/escalate.ts — 第三层：转人工。
 *
 * 给顾客温柔回复 + 给 OWNER 商户 bot 推送告警。OWNER 通知用 TELEGRAM_BOT_TOKEN（商户 bot），
 * 顾客回复由调用方 sendMessage（webhook 接入时拼装）。
 */
import { prisma } from '@/lib/prisma'
import { sendAndLogMessage } from '@/lib/telegram'
import type { Lang } from '../intent'
import { TPL, fill } from '../templates'

export type EscalateCtx = {
  text:       string
  lang:       Lang
  tenantId:   string
  telegramId: string | null
  source:     string  // intent.source: RISK / FALLBACK_UNKNOWN / VOICE / ...
}

export type EscalateKind = 'GENERIC' | 'REFUND_LIKE' | 'UNKNOWN'

/** 选一个回复模板（按来源粗分类） */
function pickReplyKind(source: string): EscalateKind {
  if (source === 'RISK') return 'REFUND_LIKE'
  if (source === 'FALLBACK_UNKNOWN') return 'UNKNOWN'
  return 'GENERIC'
}

/** 异步通知 OWNER；失败不抛 */
async function notifyOwner(ctx: EscalateCtx): Promise<void> {
  const owner = await prisma.user.findFirst({
    where: { tenantId: ctx.tenantId, role: 'OWNER', status: 'ACTIVE', telegramId: { not: null } },
    select: { telegramId: true },
  }).catch(() => null)
  if (!owner?.telegramId) return

  const tpl = TPL.escalate.OWNER_ALERT[ctx.lang]
  const text = fill(tpl, {
    tg:     ctx.telegramId ?? '-',
    lang:   ctx.lang,
    source: ctx.source,
    text:   ctx.text.slice(0, 200),
  })
  await sendAndLogMessage({
    recipientTelegramId: owner.telegramId,
    text,
    tenantId: ctx.tenantId,
    sentBy:   'SYSTEM',
    // 不传 botToken → 走默认商户 bot（TELEGRAM_BOT_TOKEN）
  }).catch(() => { /* swallow */ })
}

/** 返回给顾客的温柔回复；同时 fire-and-forget 通知 OWNER */
export function escalateReply(ctx: EscalateCtx): string {
  const kind = pickReplyKind(ctx.source)
  void notifyOwner(ctx) // 不阻塞
  return TPL.escalate[kind][ctx.lang]
}
