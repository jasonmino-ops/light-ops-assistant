/**
 * POST /api/webhook/merchant
 *
 * Telegram webhook for the merchant bot (TELEGRAM_BOT_TOKEN).
 * Forwards user messages to the configured FORWARD_CHAT_ID.
 *
 * 商品批量导入流程（口令触发）：
 *   1. 用户发送「新商品」/ "new good" / "new goods" → 回复导入引导文案
 *   2. 用户发送商品清单（每行：名称 | 条码 | 售价）→ 解析并回复预览
 *   3. 用户回复「确认」/confirm/yes/ok → 正式入库
 *   4. 其他回复或 30 分钟超时 → 取消本次导入
 *
 * Setup (run once after deploy):
 *   curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
 *     -d "url=https://<domain>/api/webhook/merchant" \
 *     -d "secret_token=<MERCHANT_WEBHOOK_SECRET>"
 *
 * Required env vars:
 *   TELEGRAM_BOT_TOKEN      — merchant bot token (already used for Mini App auth)
 *   MERCHANT_WEBHOOK_SECRET — random string to verify requests come from Telegram
 *   FORWARD_CHAT_ID         — Telegram chat ID to forward messages to
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendAndLogMessage } from '@/lib/telegram'
import { parseProductTextLines } from '@/lib/product-import'
import type { TgImportRow } from '@/lib/product-import'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? ''
const WEBHOOK_SECRET = process.env.MERCHANT_WEBHOOK_SECRET ?? ''
const FORWARD_CHAT_ID = process.env.FORWARD_CHAT_ID ?? ''

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TgMessage = Record<string, any>
type TgUpdate = { message?: TgMessage; [key: string]: unknown }

async function tgSend(method: string, body: object) {
  return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// 触发商品导入模式的口令（不区分大小写）
const IMPORT_TRIGGERS = new Set(['新商品', 'new good', 'new goods'])

// 确认导入的回复词（不区分大小写）
const CONFIRM_WORDS = new Set(['确认', 'confirm', 'yes', 'ok'])

// 导入 session 有效期（30 分钟）
const SESSION_TTL_MS = 30 * 60 * 1000

// 导入引导文案
const IMPORT_GUIDE = `📦 商品批量录入

请按以下格式，每行一个商品发送：
商品名称 | 条码 | 售价

示例：
苹果 | 123456789 | 3.5
可乐 | 987654321 | 2.0

────────────────
Please send one product per line:
Product Name | Barcode | Price

发送完整列表后，系统将显示预览，确认后正式导入。`

export async function POST(req: NextRequest) {
  // Verify the request comes from Telegram
  const incomingSecret = req.headers.get('x-telegram-bot-api-secret-token')
  if (WEBHOOK_SECRET && incomingSecret !== WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  let update: TgUpdate
  try {
    update = await req.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const message: TgMessage | undefined = update.message

  // Only handle regular user messages
  if (!message || !BOT_TOKEN) {
    return NextResponse.json({ ok: true })
  }

  // Skip Mini App data submits
  if (message.web_app_data) {
    return NextResponse.json({ ok: true })
  }

  // Skip bot commands like /start
  const text: string = message.text ?? ''
  if (text.startsWith('/')) {
    return NextResponse.json({ ok: true })
  }

  const senderId = String(message.from?.id ?? message.chat?.id ?? '')
  const chatId = String(message.chat?.id ?? senderId)

  // ─── 商品批量导入流程（仅处理文本消息） ─────────────────────────────────────
  if (senderId && message.text) {
    const textNorm = text.trim().toLowerCase()
    const textTrimmed = text.trim()

    // 查询用户绑定的 tenantId（异步，非阻断）
    let tenantId: string | null = null
    try {
      const user = await prisma.user.findFirst({
        where: { telegramId: senderId },
        select: { tenantId: true },
      })
      tenantId = user?.tenantId ?? null
    } catch { /* ignore */ }

    // ── 1. 触发口令 → 进入导入模式 ──────────────────────────────────────────
    if (IMPORT_TRIGGERS.has(textNorm) || textTrimmed === '新商品') {
      try {
        await prisma.productImportSession.upsert({
          where: { telegramId: senderId },
          create: { telegramId: senderId, tenantId, phase: 'AWAITING_DATA' },
          update: { tenantId, phase: 'AWAITING_DATA', pendingRows: '[]' },
        })
      } catch { /* ignore — will degrade gracefully */ }

      await sendAndLogMessage({
        recipientTelegramId: chatId,
        text: IMPORT_GUIDE,
        tenantId: tenantId ?? undefined,
        sentBy: 'SYSTEM',
      })
      return NextResponse.json({ ok: true })
    }

    // ── 2. 检查是否处于活跃 import session ─────────────────────────────────
    let session: {
      telegramId: string
      tenantId: string | null
      phase: string
      pendingRows: string
      updatedAt: Date
    } | null = null

    try {
      session = await prisma.productImportSession.findUnique({
        where: { telegramId: senderId },
      })
    } catch { /* ignore */ }

    const sessionActive = session && Date.now() - session.updatedAt.getTime() < SESSION_TTL_MS

    if (sessionActive) {
      // ── AWAITING_DATA：解析商品清单 → 返回预览 ──────────────────────────
      if (session!.phase === 'AWAITING_DATA') {
        const { total, valid, fieldErrors, inFileDupes } = parseProductTextLines(text)

        if (total === 0) {
          // 空文本，不处理，fall through to normal message handling
        } else if (!tenantId) {
          await sendAndLogMessage({
            recipientTelegramId: chatId,
            text: '❌ 您的账号尚未绑定商户，无法导入商品。',
            sentBy: 'SYSTEM',
          })
          try { await prisma.productImportSession.delete({ where: { telegramId: senderId } }) } catch { /* ignore */ }
          return NextResponse.json({ ok: true })
        } else {
          // 检查数据库中已存在的条码
          let dbExistingBarcodes: string[] = []
          if (valid.length > 0) {
            try {
              const existing = await prisma.product.findMany({
                where: { tenantId, barcode: { in: valid.map((r) => r.barcode) } },
                select: { barcode: true },
              })
              dbExistingBarcodes = existing.map((p) => p.barcode)
            } catch { /* ignore */ }
          }

          const dbDupesSet = new Set(dbExistingBarcodes)
          const importable = valid.filter((r) => !dbDupesSet.has(r.barcode))
          const dbDupeCount = valid.length - importable.length

          let preview = `📦 商品导入预览\n\n`
          preview += `共 ${total} 行，可导入 ${importable.length} 条\n`
          if (fieldErrors.length > 0) preview += `格式/字段错误：${fieldErrors.length} 条\n`
          if (inFileDupes.length > 0) preview += `文本内重复条码：${inFileDupes.length} 条\n`
          if (dbDupeCount > 0) preview += `数据库已存在（跳过）：${dbDupeCount} 条\n`

          if (importable.length > 0) {
            preview += `\n可导入商品：\n`
            preview += importable
              .slice(0, 10)
              .map((r, i) => `${i + 1}. ${r.name} | ${r.barcode} | ¥${r.sellPrice}`)
              .join('\n')
            if (importable.length > 10) preview += `\n…（共 ${importable.length} 条）`
            preview += `\n\n回复「确认」正式导入，回复其他内容取消。`

            try {
              await prisma.productImportSession.update({
                where: { telegramId: senderId },
                data: { phase: 'AWAITING_CONFIRM', pendingRows: JSON.stringify(importable) },
              })
            } catch { /* ignore */ }
          } else {
            // 无可导入行，显示错误详情并保持 AWAITING_DATA（允许重新发送）
            preview += `\n没有可导入的商品，请检查格式后重新发送。`
            const allErrors = [
              ...fieldErrors.map((e) => `第 ${e.line} 行：${e.reason}`),
              ...inFileDupes.map((e) => `第 ${e.line} 行：${e.reason}`),
              ...valid
                .filter((r) => dbDupesSet.has(r.barcode))
                .map((r) => `条码 ${r.barcode}：数据库中已存在`),
            ]
            if (allErrors.length > 0) {
              preview += `\n\n${allErrors.slice(0, 8).join('\n')}`
            }
          }

          await sendAndLogMessage({
            recipientTelegramId: chatId,
            text: preview,
            tenantId: tenantId ?? undefined,
            sentBy: 'SYSTEM',
          })
          return NextResponse.json({ ok: true })
        }
      }

      // ── AWAITING_CONFIRM：「确认」→ 导入；其他 → 取消 ────────────────────
      if (session!.phase === 'AWAITING_CONFIRM') {
        if (CONFIRM_WORDS.has(textNorm)) {
          let rows: TgImportRow[] = []
          try { rows = JSON.parse(session!.pendingRows) } catch { /* ignore */ }

          const tid = session!.tenantId ?? tenantId

          if (!tid || rows.length === 0) {
            await sendAndLogMessage({
              recipientTelegramId: chatId,
              text: '❌ 导入失败：商户信息丢失或无可导入商品，请重新发送「新商品」口令。',
              sentBy: 'SYSTEM',
            })
            try { await prisma.productImportSession.delete({ where: { telegramId: senderId } }) } catch { /* ignore */ }
            return NextResponse.json({ ok: true })
          }

          // 再次检查 DB（防止并发写入）
          const existingNow = await prisma.product.findMany({
            where: { tenantId: tid, barcode: { in: rows.map((r) => r.barcode) } },
            select: { barcode: true },
          })
          const existingSet = new Set(existingNow.map((p) => p.barcode))
          const toCreate = rows.filter((r) => !existingSet.has(r.barcode))
          const skipped = rows.length - toCreate.length

          let imported = 0
          if (toCreate.length > 0) {
            const result = await prisma.product.createMany({
              data: toCreate.map((r) => ({
                tenantId: tid,
                barcode: r.barcode,
                name: r.name,
                sellPrice: String(r.sellPrice),
              })),
              skipDuplicates: true,
            })
            imported = result.count
          }

          let reply = `✅ 导入完成！成功导入 ${imported} 条商品。`
          if (skipped > 0) reply += `\n（${skipped} 条因条码已存在已跳过）`

          await sendAndLogMessage({
            recipientTelegramId: chatId,
            text: reply,
            tenantId: tid,
            sentBy: 'SYSTEM',
          })
          try { await prisma.productImportSession.delete({ where: { telegramId: senderId } }) } catch { /* ignore */ }
          return NextResponse.json({ ok: true })
        } else {
          // 任何非确认回复 → 取消
          try { await prisma.productImportSession.delete({ where: { telegramId: senderId } }) } catch { /* ignore */ }
          await sendAndLogMessage({
            recipientTelegramId: chatId,
            text: '已取消商品导入。',
            tenantId: tenantId ?? undefined,
            sentBy: 'SYSTEM',
          })
          return NextResponse.json({ ok: true })
        }
      }
    }
  }
  // ─── 普通消息：转发 + 入库 ──────────────────────────────────────────────────

  // Forward the message
  if (FORWARD_CHAT_ID && BOT_TOKEN) {
    try {
      await tgSend('forwardMessage', {
        chat_id: FORWARD_CHAT_ID,
        from_chat_id: message.chat.id,
        message_id: message.message_id,
      })
    } catch {
      // Forward failed — return 200 so Telegram doesn't retry endlessly
    }
  }

  // Save inbound customer message to DB for ops visibility
  if (senderId) {
    const firstName: string = message.from?.first_name ?? ''
    const lastName: string = message.from?.last_name ?? ''
    const username: string = message.from?.username ?? ''
    const senderName =
      [firstName, lastName].filter(Boolean).join(' ') || (username ? `@${username}` : null)

    const msgContent: string =
      message.text ||
      message.caption ||
      (message.photo
        ? '[图片]'
        : message.sticker
        ? '[贴纸]'
        : message.voice
        ? '[语音]'
        : message.video
        ? '[视频]'
        : message.document
        ? '[文件]'
        : '[其他消息]')

    const msgType: string = message.photo
      ? 'IMAGE'
      : message.sticker
      ? 'STICKER'
      : message.voice
      ? 'VOICE'
      : message.video
      ? 'VIDEO'
      : message.document
      ? 'FILE'
      : message.text
      ? 'TEXT'
      : 'OTHER'

    // Try to match sender to a tenant (non-blocking)
    let tenantId: string | null = null
    try {
      const user = await prisma.user.findFirst({
        where: { telegramId: senderId },
        select: { tenantId: true },
      })
      tenantId = user?.tenantId ?? null
    } catch { /* ignore lookup failure */ }

    prisma.telegramMessage
      .create({
        data: {
          recipientTelegramId: senderId,
          senderName,
          content: msgContent,
          messageType: msgType,
          tenantId,
          sentBy: 'CUSTOMER',
          status: 'RECEIVED',
        },
      })
      .catch(() => {})
  }

  return NextResponse.json({ ok: true })
}
