/**
 * POST /api/customers/touch/batch — 旗舰版批量 Telegram 触达
 * Body: { telegramIds: string[], templateKey, messageText? }
 * OWNER + isFlagshipTier + ≤50 人 + messageText trim 非空且 ≤300 + 同顾客同模板 24h 节流
 * 走 CUSTOMER_BOT_TOKEN，每人单独写 CustomerTouchLog，单条失败不影响其他。
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { sendAndLogMessage } from '@/lib/telegram'
import { isFlagshipTier } from '@/lib/tier'

type TemplateKey = 'THANK_YOU' | 'PROMO' | 'ORDER_CARE'
type Lang = 'zh' | 'en' | 'km'

const VALID_KEYS  = new Set(['THANK_YOU', 'PROMO', 'ORDER_CARE'])
const THROTTLE_MS = 24 * 60 * 60 * 1000
const MSG_MAX_LEN = 300
const BATCH_MAX   = 50

const TEMPLATES: Record<TemplateKey, Record<Lang, (s: string) => string>> = {
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

type ItemResult = { telegramId: string; status: 'SENT' | 'FAILED' | 'THROTTLED' | 'SKIPPED'; error?: string }

export async function POST(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'FORBIDDEN', message: '只有老板可以触达顾客' }, { status: 403 })

  const tenant = await prisma.tenant.findUnique({ where: { id: ctx.tenantId }, select: { tier: true } })
  if (!isFlagshipTier(tenant?.tier)) {
    return NextResponse.json({ error: 'TIER_REQUIRED', message: '批量触达为旗舰版专属功能' }, { status: 403 })
  }

  let body: { telegramIds?: unknown; templateKey?: string; messageText?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 }) }

  const templateKey = (body.templateKey ?? '').trim() as TemplateKey
  if (!VALID_KEYS.has(templateKey)) return NextResponse.json({ error: 'INVALID_PARAMS', message: '模板无效' }, { status: 400 })

  let userText: string | null = null
  if (typeof body.messageText === 'string') {
    const t = body.messageText.trim()
    if (t.length === 0) return NextResponse.json({ error: 'INVALID_MESSAGE', message: '消息内容不能为空' }, { status: 400 })
    if (t.length > MSG_MAX_LEN) return NextResponse.json({ error: 'INVALID_MESSAGE', message: `消息内容最多 ${MSG_MAX_LEN} 字` }, { status: 400 })
    userText = t
  }

  if (!Array.isArray(body.telegramIds)) return NextResponse.json({ error: 'INVALID_PARAMS', message: 'telegramIds 必须为数组' }, { status: 400 })
  const ids = Array.from(new Set(body.telegramIds.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean)))
  if (ids.length === 0) return NextResponse.json({ error: 'INVALID_PARAMS', message: '收件人列表为空' }, { status: 400 })
  if (ids.length > BATCH_MAX) return NextResponse.json({ error: 'BATCH_TOO_LARGE', message: `单次最多 ${BATCH_MAX} 人` }, { status: 400 })

  const customerBotToken = process.env.CUSTOMER_BOT_TOKEN
  if (!customerBotToken) return NextResponse.json({ error: 'BOT_NOT_CONFIGURED', message: '后端未配置顾客 bot' }, { status: 500 })

  const contacts = await prisma.storeCustomerContact.findMany({
    where: { tenantId: ctx.tenantId, telegramId: { in: ids }, status: 'active' },
    select: { telegramId: true, storeCode: true, telegramLanguageCode: true },
  })
  const contactMap = new Map(contacts.map((c) => [c.telegramId, c]))
  const stores = await prisma.store.findMany({
    where: { tenantId: ctx.tenantId, code: { in: Array.from(new Set(contacts.map((c) => c.storeCode))) } },
    select: { id: true, code: true, name: true },
  })
  const storeByCode = new Map(stores.map((s) => [s.code, s]))

  const since = new Date(Date.now() - THROTTLE_MS)
  const results: ItemResult[] = []

  for (const telegramId of ids) {
    const contact = contactMap.get(telegramId)
    if (!contact) { results.push({ telegramId, status: 'SKIPPED', error: 'NOT_BOUND' }); continue }
    const store = storeByCode.get(contact.storeCode)
    if (!store) { results.push({ telegramId, status: 'SKIPPED', error: 'STORE_NOT_FOUND' }); continue }

    const recent = await prisma.customerTouchLog.findFirst({
      where: { tenantId: ctx.tenantId, telegramId, templateKey, status: 'SENT', sentAt: { gt: since } },
      select: { id: true },
    })
    const messageText = userText ?? TEMPLATES[templateKey][pickLang(contact.telegramLanguageCode)](store.name)

    if (recent) {
      await prisma.customerTouchLog.create({
        data: { tenantId: ctx.tenantId, storeId: store.id, telegramId, templateKey, messageText,
                status: 'THROTTLED', errorMessage: '24h 内已发送同模板', sentByUserId: ctx.userId },
      }).catch(() => {})
      results.push({ telegramId, status: 'THROTTLED' })
      continue
    }

    try {
      const r = await sendAndLogMessage({
        recipientTelegramId: telegramId, text: messageText,
        tenantId: ctx.tenantId, sentBy: 'SYSTEM', botToken: customerBotToken,
      })
      await prisma.customerTouchLog.create({
        data: { tenantId: ctx.tenantId, storeId: store.id, telegramId, templateKey, messageText,
                status: r.ok ? 'SENT' : 'FAILED', errorMessage: r.ok ? null : (r.error ?? 'unknown'),
                sentByUserId: ctx.userId },
      }).catch(() => {})
      results.push({ telegramId, status: r.ok ? 'SENT' : 'FAILED', error: r.ok ? undefined : (r.error ?? 'unknown') })
    } catch (e) {
      const msg = (e as Error).message ?? 'send error'
      await prisma.customerTouchLog.create({
        data: { tenantId: ctx.tenantId, storeId: store.id, telegramId, templateKey, messageText,
                status: 'FAILED', errorMessage: msg, sentByUserId: ctx.userId },
      }).catch(() => {})
      results.push({ telegramId, status: 'FAILED', error: msg })
    }
  }

  const sent    = results.filter((r) => r.status === 'SENT').length
  const skipped = results.filter((r) => r.status === 'THROTTLED' || r.status === 'SKIPPED').length
  const failed  = results.filter((r) => r.status === 'FAILED').length
  return NextResponse.json({ ok: true, total: results.length, sent, skipped, failed, results })
}
