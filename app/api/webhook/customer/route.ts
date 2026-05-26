import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { classifyIntent, type Lang } from '@/lib/bot/intent'
import { resolveReplyLang } from '@/lib/bot/lang'
import { TPL } from '@/lib/bot/templates'
import { chatReply } from '@/lib/bot/handlers/chat'
import { businessReply } from '@/lib/bot/handlers/business'
import { escalateReply } from '@/lib/bot/handlers/escalate'

/**
 * POST /api/webhook/customer
 *
 * Telegram webhook for the customer-facing bot (@Eshop_sale_bot).
 *
 * 支持的 /start 形态：
 *   /start                                  → 欢迎 + 默认门店 Mini App 按钮
 *   /start bind_<STORECODE>                 → 顾客主动绑定门店联系人
 *   /start bind_<STORECODE>_<ORDERNO>       → 顾客主动绑定 + 记录订单号
 *
 * 所需环境变量：
 *   CUSTOMER_BOT_TOKEN     — @Eshop_sale_bot 的 bot token
 *   CUSTOMER_WEBHOOK_SECRET — 可选，Webhook secret 防伪
 *   NEXT_PUBLIC_APP_URL    — 生产域名
 *   DEFAULT_STORE_CODE     — 测试门店 code（仅无参 /start 用）
 *
 * Webhook 注册（首次部署后执行一次）：
 *   curl "https://api.telegram.org/bot<CUSTOMER_BOT_TOKEN>/setWebhook" \
 *     -d "url=https://<domain>/api/webhook/customer" \
 *     -d "secret_token=<CUSTOMER_WEBHOOK_SECRET>"
 */

const BOT_TOKEN       = process.env.CUSTOMER_BOT_TOKEN ?? ''
const WEBHOOK_SECRET  = process.env.CUSTOMER_WEBHOOK_SECRET ?? ''
const APP_URL         = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
const DEFAULT_STORE   = process.env.DEFAULT_STORE_CODE ?? 'STORE-A'

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

function menuKeyboard(storeCode: string) {
  if (!APP_URL) return undefined
  return {
    inline_keyboard: [[
      { text: '🛍️ 再次点单', web_app: { url: `${APP_URL}/menu?code=${encodeURIComponent(storeCode)}` } },
    ]],
  }
}

// 解析 /start payload：'bind_STORECODE' 或 'bind_STORECODE_ORDERNO'
function parseBindPayload(payload: string): { storeCode: string; orderNo: string | null } | null {
  if (!payload.startsWith('bind_')) return null
  const rest = payload.slice(5) // 去掉 'bind_'
  if (!rest) return null
  const idx = rest.indexOf('_')
  if (idx === -1) return { storeCode: rest, orderNo: null }
  return {
    storeCode: rest.slice(0, idx),
    orderNo:   rest.slice(idx + 1) || null,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleBind(msg: any, payload: { storeCode: string; orderNo: string | null }) {
  const chatId = msg.chat?.id
  const from   = msg.from
  if (!chatId || !from?.id) return

  const { storeCode, orderNo } = payload

  // 校验 storeCode 是否存在
  const store = await prisma.store.findUnique({
    where: { code: storeCode },
    select: { tenantId: true, name: true },
  })
  if (!store) {
    await tgSend('sendMessage', {
      chat_id: chatId,
      text: '门店信息无效，请重新扫码点单。',
    })
    return
  }

  const telegramId = String(from.id)

  // upsert：同 storeCode + telegramId 不新增重复，更新 lastSeenAt / lastOrderId / 用户名
  await prisma.storeCustomerContact.upsert({
    where: { storeCode_telegramId: { storeCode, telegramId } },
    create: {
      tenantId:             store.tenantId,
      storeCode,
      telegramId,
      telegramUsername:     from.username      ?? null,
      telegramFirstName:    from.first_name    ?? null,
      telegramLastName:     from.last_name     ?? null,
      telegramLanguageCode: from.language_code ?? null,
      lastOrderId:          orderNo,
      source:               'telegram_bind_after_order',
      status:               'active',
    },
    update: {
      tenantId:             store.tenantId,
      telegramUsername:     from.username      ?? null,
      telegramFirstName:    from.first_name    ?? null,
      telegramLastName:     from.last_name     ?? null,
      telegramLanguageCode: from.language_code ?? null,
      lastOrderId:          orderNo ?? undefined,
      lastSeenAt:           new Date(),
    },
  })

  const lines = [
    '绑定成功。以后你可以在这里接收订单通知、查看订单进度和再次点单。',
    `已绑定门店：${store.name}（${storeCode}）`,
  ]
  if (orderNo) lines.push(`本次订单已记录：${orderNo}`)

  // 更新 bot 持久菜单按钮（左下角「查看商品」）→ 始终指向 /e-life 多店平台首页
  // 不再动态指向某家店，避免多店场景下用户从底部按钮误进旧店铺
  // inline keyboard「再次点单」仍使用当前 storeCode（见下方 sendMessage）
  if (APP_URL) {
    const platformUrl   = `${APP_URL}/e-life`
    const inlineStoreCode = storeCode
    try {
      const res = await tgSend('setChatMenuButton', {
        chat_id: chatId,
        menu_button: {
          type:    'web_app',
          text:    '🛍️ 查看商品',
          web_app: { url: platformUrl },
        },
      })
      const resJson = res ? await res.json().catch(() => null) : null
      console.log('[customer-webhook] setChatMenuButton', {
        chat_id: chatId, menuUrl: platformUrl, inlineStoreCode,
        ok: resJson?.ok ?? false,
        error: resJson?.description ?? null,
      })
    } catch (e) {
      console.error('[customer-webhook] setChatMenuButton failed', { chat_id: chatId, error: e })
    }
  }

  await tgSend('sendMessage', {
    chat_id: chatId,
    text: lines.join('\n\n'),
    reply_markup: menuKeyboard(storeCode),
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

  const chatId = msg.chat?.id
  const text   = (msg.text ?? '').trim()
  if (!chatId) return NextResponse.json({ ok: true })

  // /start [payload]
  if (text.startsWith('/start')) {
    const payload = text.split(/\s+/)[1] ?? ''

    // 顾客主动绑定
    const bindPayload = parseBindPayload(payload)
    if (bindPayload) {
      try {
        await handleBind(msg, bindPayload)
      } catch (e) {
        console.error('[customer-webhook] handleBind failed', e)
        await tgSend('sendMessage', { chat_id: chatId, text: '门店信息无效，请重新扫码点单。' })
      }
      return NextResponse.json({ ok: true })
    }

    // 无参/未识别参数：引导到 E-Life 多店平台首页
    // 不再默认跳某一家店，由顾客在首页自行选择
    const platformUrl = `${APP_URL}/e-life`
    await tgSend('sendMessage', {
      chat_id: chatId,
      text: '👋 欢迎来到 E-Life 超生活！点击下方按钮浏览店铺，找到喜欢的直接下单。',
      reply_markup: {
        inline_keyboard: [[
          { text: '🛍️ 查看商品', web_app: { url: platformUrl } },
        ]],
      },
    })
    return NextResponse.json({ ok: true })
  }

  // ── 三层对话路由（阶段一：纯规则）─────────────────────────────────────
  const telegramId = String(msg.from?.id ?? '')
  if (!telegramId) return NextResponse.json({ ok: true })

  // 频控：60s 内 > 10 提示稍候；> 30 静默
  const rl = checkRate(telegramId)
  const langForRL: Lang = normalizeLang(msg.from?.language_code)
  if (rl === 'BLOCK') return NextResponse.json({ ok: true })
  if (rl === 'WARN') {
    await tgSend('sendMessage', { chat_id: chatId, text: RATE_HINT[langForRL] })
    return NextResponse.json({ ok: true })
  }

  // 找顾客上下文（最近活跃的 active contact）
  const contact = await prisma.storeCustomerContact.findFirst({
    where:   { telegramId, status: 'active' },
    orderBy: { lastSeenAt: 'desc' },
    select:  { tenantId: true, storeCode: true, telegramLanguageCode: true },
  }).catch(() => null)

  // 没绑过：fallback 到 DEFAULT_STORE 的 tenant（仍能回闲聊/转人工，但订单查询查不到）
  let tenantId   = contact?.tenantId  ?? null
  let storeCode  = contact?.storeCode ?? DEFAULT_STORE
  let storeName  = ''
  const fbStore = await prisma.store.findUnique({
    where: { code: storeCode }, select: { tenantId: true, name: true },
  }).catch(() => null)
  if (fbStore) {
    if (!tenantId) tenantId = fbStore.tenantId
    storeName = fbStore.name
  }
  const isText = typeof msg.text === 'string' && msg.text.trim().length > 0
  const lang: Lang = resolveReplyLang({
    text:         isText ? msg.text : null,
    isText,
    contactLang:  contact?.telegramLanguageCode,
    telegramLang: msg.from?.language_code,
  })

  // 非文本媒体识别（含语音）：统一走温柔模板，不进入文本分类
  const media = detectMedia(msg)
  if (media) {
    const reply = media === 'VOICE' ? TPL.voice[lang] : TPL.media[media][lang]
    await tgSend('sendMessage', { chat_id: chatId, text: reply })
    const tag = `[${media.toLowerCase()}]`
    void logConv({ tenantId, storeCode, telegramId, lang, direction: 'IN',  text: tag,   intentLayer: 2, intentSource: media, escalated: false })
    void logConv({ tenantId, storeCode, telegramId, lang, direction: 'OUT', text: reply, intentLayer: 2, intentSource: media, escalated: false })
    return NextResponse.json({ ok: true })
  }

  // 文字消息：分类 → 分发
  const intent = classifyIntent(text, lang)
  void logConv({
    tenantId, storeCode, telegramId, lang,
    direction: 'IN', text: text.slice(0, 1000),
    intentLayer: intent.layer, intentSlot: intent.slot ?? intent.chatKind ?? null,
    intentSource: intent.source, escalated: intent.escalate,
  })

  let reply = ''
  if (intent.layer === 1 && intent.slot && tenantId) {
    reply = await businessReply(intent.slot, { text, lang, storeCode, storeName, tenantId, telegramId })
  } else if (intent.layer === 2 && intent.chatKind) {
    reply = chatReply(intent.chatKind, lang, storeName || DEFAULT_STORE)
  } else {
    reply = escalateReply({
      text, lang, tenantId: tenantId ?? '', telegramId,
      source:    intent.source,
      storeCode,
      username:  msg.from?.username ?? null,
    })
  }

  await tgSend('sendMessage', { chat_id: chatId, text: reply })
  void logConv({
    tenantId, storeCode, telegramId, lang,
    direction: 'OUT', text: reply,
    intentLayer: intent.layer, intentSlot: intent.slot ?? intent.chatKind ?? null,
    intentSource: intent.source, escalated: intent.escalate,
  })

  return NextResponse.json({ ok: true })
}

// ── 媒体类型识别 ─────────────────────────────────────────────────────────

type MediaKind = 'VOICE' | 'PHOTO' | 'STICKER' | 'LOCATION' | 'CONTACT' | 'DOCUMENT' | 'UNSUPPORTED'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function detectMedia(m: any): MediaKind | null {
  if (m.voice || m.video_note || m.audio) return 'VOICE'
  if (m.photo)    return 'PHOTO'
  if (m.sticker)  return 'STICKER'
  if (m.location || m.venue) return 'LOCATION'
  if (m.contact)  return 'CONTACT'
  if (m.document) return 'DOCUMENT'
  if (m.animation || m.video || m.dice || m.game || m.poll || m.invoice) return 'UNSUPPORTED'
  // 文本消息时返回 null（外层走文本分类）
  if (typeof m.text === 'string' && m.text.length > 0) return null
  // 既无文本又无识别媒体 → 仍兜底
  return 'UNSUPPORTED'
}

// ── 工具：lang normalize / 频控 / 日志 / 频控文案 ─────────────────────────

function normalizeLang(v: string | null | undefined): Lang {
  const s = (v ?? '').toLowerCase()
  if (s === 'zh' || s.startsWith('zh-') || s.startsWith('zh_')) return 'zh'
  if (s === 'en' || s.startsWith('en-') || s.startsWith('en_')) return 'en'
  if (s === 'km' || s.startsWith('km-') || s.startsWith('kh') || s === 'km_kh') return 'km'
  return 'zh'
}

const RATE_HINT: Record<Lang, string> = {
  zh: '您消息有点多，我先休息一下哦～❤️',
  en: "I'm catching up — please give me a moment ❤️",
  km: 'ខ្ញុំសុំសម្រាកបន្តិច សូមមួយរំពេច ❤️',
}

// 模块级 in-memory 频控（serverless 实例级；够用，跨实例不共享）
const rateMap = new Map<string, number[]>()
function checkRate(telegramId: string): 'OK' | 'WARN' | 'BLOCK' {
  const now = Date.now()
  const arr = (rateMap.get(telegramId) ?? []).filter((t) => now - t < 60_000)
  arr.push(now)
  rateMap.set(telegramId, arr)
  if (arr.length > 30) return 'BLOCK'
  if (arr.length > 10) return 'WARN'
  return 'OK'
}

type LogEntry = {
  tenantId:     string | null
  storeCode:    string | null
  telegramId:   string
  lang:         string
  direction:    'IN' | 'OUT'
  text:         string
  intentLayer:  number | null
  intentSlot?:  string | null
  intentSource: string
  escalated:    boolean
}
async function logConv(e: LogEntry): Promise<void> {
  try {
    await prisma.conversationLog.create({
      data: {
        tenantId:     e.tenantId,
        storeCode:    e.storeCode,
        telegramId:   e.telegramId,
        lang:         e.lang,
        direction:    e.direction,
        text:         e.text,
        intentLayer:  e.intentLayer ?? undefined,
        intentSlot:   e.intentSlot ?? undefined,
        intentSource: e.intentSource,
        escalated:    e.escalated,
      },
    })
  } catch { /* DDL 未跑或落盘失败时静默，不影响回复 */ }
}
