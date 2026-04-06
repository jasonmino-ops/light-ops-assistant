/**
 * POST /api/webhook/merchant
 *
 * Telegram webhook for the merchant bot (TELEGRAM_BOT_TOKEN).
 * Forwards user messages to the configured FORWARD_CHAT_ID.
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
 *                             (your personal ID, e.g. 123456789, or a group ID like -100xxxxxxxxxx)
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

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

  // Skip Mini App data submits (web_app_data is sent when the Mini App calls sendData)
  if (message.web_app_data) {
    return NextResponse.json({ ok: true })
  }

  // Skip bot commands like /start (these are navigation, not support messages)
  const text: string = message.text ?? ''
  if (text.startsWith('/')) {
    return NextResponse.json({ ok: true })
  }

  // Forward the message — Telegram shows "Forwarded from: <user>" automatically
  // This preserves all content types: text, photos, voice, stickers, etc.
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
  const senderId = String(message.from?.id ?? message.chat?.id ?? '')
  if (senderId) {
    const firstName: string = message.from?.first_name ?? ''
    const lastName: string = message.from?.last_name ?? ''
    const username: string = message.from?.username ?? ''
    const senderLabel = [firstName, lastName].filter(Boolean).join(' ') || (username ? `@${username}` : senderId)

    const msgContent: string =
      message.text || message.caption ||
      (message.photo ? '[图片]' : message.sticker ? '[贴纸]' : message.voice ? '[语音]' :
        message.video ? '[视频]' : message.document ? '[文件]' : '[消息]')

    // Try to match sender to a tenant (non-blocking)
    let tenantId: string | null = null
    try {
      const user = await prisma.user.findFirst({
        where: { telegramId: senderId },
        select: { tenantId: true },
      })
      tenantId = user?.tenantId ?? null
    } catch { /* ignore lookup failure */ }

    prisma.telegramMessage.create({
      data: {
        recipientTelegramId: senderId,
        content: `[${senderLabel}] ${msgContent}`,
        tenantId,
        sentBy: 'CUSTOMER',
        status: 'RECEIVED',
      },
    }).catch(() => {})
  }

  return NextResponse.json({ ok: true })
}
