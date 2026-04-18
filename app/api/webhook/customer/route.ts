import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/webhook/customer
 *
 * Telegram webhook for the customer-facing bot (@Eshop_sale_bot).
 * 收到任意消息或 /start 命令时，回复一条带 Mini App 按钮的消息，
 * 引导顾客打开顾客端商品页 /menu?code=<STORE_CODE>。
 *
 * 所需环境变量：
 *   CUSTOMER_BOT_TOKEN     — @Eshop_sale_bot 的 bot token（BotFather 获取）
 *   CUSTOMER_WEBHOOK_SECRET — 可选，Webhook secret 防伪
 *   NEXT_PUBLIC_APP_URL    — 生产域名，例如 https://your-app.vercel.app
 *   DEFAULT_STORE_CODE     — 测试门店 code，默认 STORE-A
 *
 * Webhook 注册（首次部署后执行一次）：
 *   curl "https://api.telegram.org/bot<CUSTOMER_BOT_TOKEN>/setWebhook" \
 *     -d "url=https://<domain>/api/webhook/customer" \
 *     -d "secret_token=<CUSTOMER_WEBHOOK_SECRET>"
 */

const BOT_TOKEN       = process.env.CUSTOMER_BOT_TOKEN ?? ''
const WEBHOOK_SECRET  = process.env.CUSTOMER_WEBHOOK_SECRET ?? ''
const APP_URL         = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
const STORE_CODE      = process.env.DEFAULT_STORE_CODE ?? 'STORE-A'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TgUpdate = Record<string, any>

async function tgSend(method: string, body: object) {
  if (!BOT_TOKEN) return
  return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function POST(req: NextRequest) {
  // 校验 secret_token（已配置时启用）
  if (WEBHOOK_SECRET) {
    const incoming = req.headers.get('x-telegram-bot-api-secret-token') ?? ''
    if (incoming !== WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }
  }

  if (!BOT_TOKEN) {
    console.warn('[customer-webhook] CUSTOMER_BOT_TOKEN 未配置，忽略请求')
    return NextResponse.json({ ok: true })
  }

  if (!APP_URL) {
    console.warn('[customer-webhook] NEXT_PUBLIC_APP_URL 未配置，无法生成 Mini App 链接')
    return NextResponse.json({ ok: true })
  }

  let update: TgUpdate
  try {
    update = await req.json()
  } catch {
    return NextResponse.json({ ok: true })
  }

  const msg = update.message
  if (!msg) return NextResponse.json({ ok: true })

  const chatId  = msg.chat?.id
  const text    = (msg.text ?? '').trim()
  if (!chatId) return NextResponse.json({ ok: true })

  const menuUrl = `${APP_URL}/menu?code=${encodeURIComponent(STORE_CODE)}`

  // /start 命令：发送欢迎消息 + Mini App 按钮
  if (text.startsWith('/start')) {
    await tgSend('sendMessage', {
      chat_id: chatId,
      text: '👋 欢迎！点击下方按钮查看商品，选好后可直接下单，商家会及时处理。',
      reply_markup: {
        inline_keyboard: [[
          { text: '🛍️ 查看商品', web_app: { url: menuUrl } },
        ]],
      },
    })
    return NextResponse.json({ ok: true })
  }

  // 其他消息：同样回复入口按钮
  await tgSend('sendMessage', {
    chat_id: chatId,
    text: '点击下方按钮查看商品并下单 👇',
    reply_markup: {
      inline_keyboard: [[
        { text: '🛍️ 查看商品', web_app: { url: menuUrl } },
      ]],
    },
  })

  return NextResponse.json({ ok: true })
}
