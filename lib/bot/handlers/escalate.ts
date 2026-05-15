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
  storeCode?: string | null
  username?:  string | null
}

export type EscalateKind = 'GENERIC' | 'REFUND_LIKE' | 'UNKNOWN'

function pickReplyKind(source: string): EscalateKind {
  if (source === 'RISK') return 'REFUND_LIKE'
  if (source === 'FALLBACK_UNKNOWN') return 'UNKNOWN'
  return 'GENERIC'
}

// 模块级 in-memory throttle（serverless 实例级；够用）
const OWNER_NOTIFY_WINDOW_MS = 5 * 60 * 1000
const notifyMap = new Map<string, number>()

function shouldNotify(tenantId: string, storeCode: string | null | undefined, telegramId: string | null | undefined): boolean {
  if (!telegramId) return false
  const key = `${tenantId}|${storeCode ?? '-'}|${telegramId}`
  const last = notifyMap.get(key) ?? 0
  const now  = Date.now()
  if (now - last < OWNER_NOTIFY_WINDOW_MS) return false
  notifyMap.set(key, now)
  return true
}

function kindLabel(source: string, lang: Lang): string {
  if (source === 'FALLBACK_UNKNOWN') return TPL.escalate.KIND_UNKNOWN[lang]
  return TPL.escalate.KIND_HUMAN_HELP[lang]
}

function fmtTime(lang: Lang): string {
  const d = new Date()
  return d.toLocaleString(lang === 'en' ? 'en-US' : lang === 'km' ? 'km-KH' : 'zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

async function notifyOwner(ctx: EscalateCtx): Promise<void> {
  const owner = await prisma.user.findFirst({
    where: { tenantId: ctx.tenantId, role: 'OWNER', status: 'ACTIVE', telegramId: { not: null } },
    select: { telegramId: true },
  }).catch(() => null)
  if (!owner?.telegramId) return

  const user = ctx.username ? `@${ctx.username}` : (ctx.telegramId ?? '-')
  const text = fill(TPL.escalate.OWNER_SUMMARY[ctx.lang], {
    user,
    kind: kindLabel(ctx.source, ctx.lang),
    text: ctx.text.slice(0, 200),
    time: fmtTime(ctx.lang),
  })
  await sendAndLogMessage({
    recipientTelegramId: owner.telegramId,
    text,
    tenantId: ctx.tenantId,
    sentBy:   'SYSTEM',
  }).catch(() => { /* swallow */ })
}

/**
 * 顾客温柔回复 + 按节流策略通知 OWNER（同 telegramId+storeCode 5 分钟一次）。
 * 节流命中时仍记 ConversationLog（由调用方完成），不重复打扰商户。
 */
export function escalateReply(ctx: EscalateCtx): string {
  const kind = pickReplyKind(ctx.source)
  if (ctx.tenantId && shouldNotify(ctx.tenantId, ctx.storeCode, ctx.telegramId)) {
    void notifyOwner(ctx)
  }
  return TPL.escalate[kind][ctx.lang]
}
