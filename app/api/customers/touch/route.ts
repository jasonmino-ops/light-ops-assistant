/**
 * POST /api/customers/touch
 *
 * 商户 OWNER 对本店已绑定 Telegram 的顾客发送模板化 Telegram 消息。
 *
 * Body:
 *   { telegramId: string, templateKey: 'THANK_YOU' | 'PROMO' | 'ORDER_CARE' }
 *
 * 安全：
 *   - role !== 'OWNER' → 403
 *   - StoreCustomerContact 必须属当前 tenant（防跨租户）
 *   - 必须有 telegramId（页面已过滤，后端二次校验）
 *   - 24h 同顾客同模板节流 → 429 THROTTLED
 *
 * 通道：
 *   - 直接调 Telegram Bot API sendMessage，使用 CUSTOMER_BOT_TOKEN
 *   - 不使用 TELEGRAM_BOT_TOKEN（商户 bot）/ OPS_BOT_TOKEN（OPS bot）
 *   - 不复用 ops 后台会话 / 商户绑定会话身份
 *
 * 落盘：
 *   - 不论成功/失败/节流，都写入 CustomerTouchLog
 *   - 节流时 status='THROTTLED' 但不发送
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { sendAndLogMessage } from '@/lib/telegram'

type TemplateKey = 'THANK_YOU' | 'PROMO' | 'ORDER_CARE'
type Lang = 'zh' | 'en' | 'km'

const VALID_KEYS = new Set(['THANK_YOU', 'PROMO', 'ORDER_CARE'])
const THROTTLE_MS = 24 * 60 * 60 * 1000 // 同顾客同模板 24h 节流

const TEMPLATES: Record<TemplateKey, Record<Lang, (storeName: string) => string>> = {
  THANK_YOU: {
    zh: (s) => `感谢您选择${s}！期待您再次光临 🌟`,
    en: (s) => `Thank you for choosing ${s}! We look forward to your next visit 🌟`,
    km: (s) => `សូមអរគុណដែលជ្រើសរើស ${s}! រង់ចាំការត្រឡប់មកវិញ 🌟`,
  },
  PROMO: {
    zh: (s) => `${s} 近期有新活动，欢迎扫码查看最新菜单与优惠 🎉`,
    en: (s) => `${s} has new promotions. Scan the QR to see the latest menu & deals 🎉`,
    km: (s) => `${s} មានកម្មវិធីផ្សព្វផ្សាយថ្មី សូមស្កែន QR ដើម្បីមើល 🎉`,
  },
  ORDER_CARE: {
    zh: (s) => `您在 ${s} 的订单一切顺利吗？如有任何问题请直接告诉我们，感谢您的支持 🙏`,
    en: (s) => `How is your recent order at ${s}? Please let us know if anything went wrong. Thank you 🙏`,
    km: (s) => `ការបញ្ជាទិញរបស់អ្នកនៅ ${s} មានបញ្ហាអ្វីដែរ? សូមប្រាប់យើងបើមាន 🙏`,
  },
}

function pickLang(code: string | null): Lang {
  const c = (code ?? '').toLowerCase()
  if (c.startsWith('km') || c.startsWith('kh')) return 'km'
  if (c.startsWith('en')) return 'en'
  return 'zh'
}

export async function POST(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') {
    return NextResponse.json({ error: 'FORBIDDEN', message: '只有老板可以触达顾客' }, { status: 403 })
  }

  let body: { telegramId?: string; templateKey?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const telegramId = (body.telegramId ?? '').trim()
  const templateKey = (body.templateKey ?? '').trim() as TemplateKey
  if (!telegramId || !VALID_KEYS.has(templateKey)) {
    return NextResponse.json({ error: 'INVALID_PARAMS', message: '参数无效' }, { status: 400 })
  }

  // ── 1) 校验顾客属本租户 + 已绑定 TG ─────────────────────────────────────
  const contact = await prisma.storeCustomerContact.findFirst({
    where: { tenantId: ctx.tenantId, telegramId },
    select: {
      id: true,
      tenantId: true,
      storeCode: true,
      telegramId: true,
      telegramLanguageCode: true,
      status: true,
    },
  })
  if (!contact || contact.status !== 'active') {
    return NextResponse.json({ error: 'CUSTOMER_NOT_FOUND' }, { status: 404 })
  }

  // ── 2) 24h 节流（同顾客 + 同模板） ─────────────────────────────────────
  const since = new Date(Date.now() - THROTTLE_MS)
  const recent = await prisma.customerTouchLog.findFirst({
    where: {
      tenantId: ctx.tenantId,
      telegramId: contact.telegramId,
      templateKey,
      status: 'SENT',
      sentAt: { gt: since },
    },
    select: { id: true, sentAt: true },
    orderBy: { sentAt: 'desc' },
  })
  if (recent) {
    return NextResponse.json(
      {
        error: 'THROTTLED',
        message: '24 小时内已向该顾客发送过同模板消息，请稍后再试',
        lastSentAt: recent.sentAt.toISOString(),
      },
      { status: 429 },
    )
  }

  // ── 3) 取门店名 + 渲染消息 ─────────────────────────────────────────────
  const store = await prisma.store.findUnique({
    where: { code: contact.storeCode },
    select: { id: true, name: true, tenantId: true },
  })
  // 跨租户防御：store 必须也属同 tenant
  if (!store || store.tenantId !== ctx.tenantId) {
    return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })
  }

  const lang = pickLang(contact.telegramLanguageCode)
  const messageText = TEMPLATES[templateKey][lang](store.name)

  // ── 4) 走顾客 bot 发送（不使用商户/OPS bot） ──────────────────────────
  const customerBotToken = process.env.CUSTOMER_BOT_TOKEN
  if (!customerBotToken) {
    await prisma.customerTouchLog.create({
      data: {
        tenantId: ctx.tenantId,
        storeId: store.id,
        telegramId: contact.telegramId,
        templateKey,
        messageText,
        status: 'FAILED',
        errorMessage: 'CUSTOMER_BOT_TOKEN 未配置',
        sentByUserId: ctx.userId,
      },
    })
    return NextResponse.json(
      { error: 'BOT_NOT_CONFIGURED', message: '后端未配置顾客 Telegram bot' },
      { status: 500 },
    )
  }

  const sendResult = await sendAndLogMessage({
    recipientTelegramId: contact.telegramId,
    text: messageText,
    tenantId: ctx.tenantId,
    sentBy: 'SYSTEM',
    botToken: customerBotToken,
  })

  // ── 5) 写 CustomerTouchLog ─────────────────────────────────────────────
  await prisma.customerTouchLog.create({
    data: {
      tenantId: ctx.tenantId,
      storeId: store.id,
      telegramId: contact.telegramId,
      templateKey,
      messageText,
      status: sendResult.ok ? 'SENT' : 'FAILED',
      errorMessage: sendResult.ok ? null : (sendResult.error ?? 'unknown'),
      sentByUserId: ctx.userId,
    },
  })

  if (!sendResult.ok) {
    return NextResponse.json(
      { error: 'SEND_FAILED', message: sendResult.error ?? '发送失败' },
      { status: 502 },
    )
  }

  return NextResponse.json({ ok: true, messageText })
}

/**
 * GET /api/customers/touch?telegramId=xxx
 *
 * 返回该顾客最近一次成功触达的时间（用于前端 UI 提示），OWNER only。
 * 暂未在 UI 启用，可作为后续单顾客详情接入点。
 */
export async function GET(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const telegramId = req.nextUrl.searchParams.get('telegramId')?.trim()
  if (!telegramId) return NextResponse.json({ error: 'MISSING_PARAMS' }, { status: 400 })

  const last = await prisma.customerTouchLog.findFirst({
    where: { tenantId: ctx.tenantId, telegramId, status: 'SENT' },
    orderBy: { sentAt: 'desc' },
    select: { templateKey: true, sentAt: true },
  })
  return NextResponse.json({ last: last ? { ...last, sentAt: last.sentAt.toISOString() } : null })
}
