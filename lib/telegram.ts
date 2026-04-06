/**
 * lib/telegram.ts
 *
 * 共享 Telegram 消息发送底座：
 * - sendAndLogMessage：发送消息 + 写入 TelegramMessage 日志表
 * - WELCOME_TEXT：首次开通欢迎消息（双语）
 *
 * 为将来群发文本/图片预留：TelegramMessage 表的 messageType / recipientTelegramId /
 * status / sentBy 字段均可直接复用。
 */

import { prisma } from './prisma'

// ─── 欢迎消息文案（双语）────────────────────────────────────────────────────────

export const WELCOME_TEXT =
  '🎉 账号已开通，欢迎使用店小二助手！\n\n' +
  '功能入口：\n' +
  '  · 首页 — 今日概览与数据\n' +
  '  · 销售 — 快速开单 / 扫码收款\n' +
  '  · 商品 — 查看与管理商品\n' +
  '  · 记录 — 历史销售订单\n\n' +
  '如有任何问题，可直接在此回复联系我们。\n\n' +
  '---\n\n' +
  '🎉 គណនីត្រូវបានបើក! សូមស្វាគមន៍ចូលប្រើ 店小二助手\n\n' +
  'មុខងារ:\n' +
  '  · ទំព័រដើម — ទិដ្ឋភាពប្រចាំថ្ងៃ\n' +
  '  · ការលក់ — ចុះQR / scan\n' +
  '  · ទំនិញ — គ្រប់គ្រងផលិតផល\n' +
  '  · កំណត់ត្រា — ប្រវត្តិបញ្ជីលក់\n\n' +
  'ប្រសិនបើត្រូវការជំនួយ សូម reply ដោយផ្ទាល់នៅទីនេះ។'

// ─── 发送 + 记录 ───────────────────────────────────────────────────────────────

/**
 * 向指定 Telegram 用户发送消息，并写入 TelegramMessage 日志。
 * 失败时记录状态为 FAILED，返回 { ok: false, error }，不抛出异常。
 */
export async function sendAndLogMessage({
  recipientTelegramId,
  text,
  tenantId,
  sentBy = 'SYSTEM',
  botToken = process.env.TELEGRAM_BOT_TOKEN,
}: {
  recipientTelegramId: string
  text: string
  tenantId?: string
  sentBy?: string
  botToken?: string
}): Promise<{ ok: boolean; error?: string }> {
  if (!botToken) {
    const err = 'TELEGRAM_BOT_TOKEN 未配置'
    await writeLog({ recipientTelegramId, text, tenantId, sentBy, status: 'FAILED', errorMessage: err })
    return { ok: false, error: err }
  }

  let ok = false
  let errorMessage: string | undefined

  try {
    const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: recipientTelegramId, text }),
    })
    const body = await r.json()
    ok = r.ok && body.ok === true
    if (!ok) errorMessage = body.description ?? `HTTP ${r.status}`
  } catch (e) {
    errorMessage = (e as Error).message ?? 'network error'
  }

  await writeLog({
    recipientTelegramId, text, tenantId, sentBy,
    status: ok ? 'SENT' : 'FAILED',
    errorMessage,
  })

  return ok ? { ok: true } : { ok: false, error: errorMessage }
}

async function writeLog(params: {
  recipientTelegramId: string
  text: string
  tenantId?: string
  sentBy: string
  status: string
  errorMessage?: string
}) {
  try {
    await prisma.telegramMessage.create({
      data: {
        recipientTelegramId: params.recipientTelegramId,
        content: params.text,
        tenantId: params.tenantId ?? null,
        sentBy: params.sentBy,
        status: params.status,
        errorMessage: params.errorMessage ?? null,
      },
    })
  } catch (e) {
    console.error('[telegram] Failed to write message log:', e)
  }
}
