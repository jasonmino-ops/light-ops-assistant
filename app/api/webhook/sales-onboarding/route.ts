import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendAndLogMessage } from '@/lib/telegram'
import {
  consumeSupportContextToken,
  parseSupportStartCommand,
} from '@/lib/sales-lead-support-context'

const BOT_TOKEN = process.env.SALES_ONBOARDING_BOT_TOKEN?.trim() ?? ''
const WEBHOOK_SECRET = process.env.SALES_ONBOARDING_WEBHOOK_SECRET?.trim() ?? ''

type TelegramFrom = {
  id?: number | string
  first_name?: string
  last_name?: string
  username?: string
  language_code?: string
}

type TelegramMessage = {
  message_id?: number
  text?: string
  caption?: string
  photo?: unknown
  sticker?: unknown
  voice?: unknown
  video?: unknown
  document?: unknown
  from?: TelegramFrom
  chat?: { id?: number | string }
}

type TelegramUpdate = {
  update_id?: number
  message?: TelegramMessage
}

type OnboardingLanguage = 'zh' | 'en' | 'km'

const ACKNOWLEDGEMENT: Record<OnboardingLanguage, string> = {
  zh: '已收到你的开店咨询，销售顾问会尽快回复。正式申请请继续使用页面上的「Telegram 绑定并申请开店」。',
  en: 'Your store-opening question has been received. A sales advisor will reply soon. To apply, use “Bind Telegram & Apply” on the application page.',
  km: 'យើងបានទទួលសំណួរអំពីការបើកហាងរបស់អ្នក។ អ្នកប្រឹក្សាផ្នែកលក់នឹងឆ្លើយតបឆាប់ៗ។ ដើម្បីដាក់ពាក្យ សូមប្រើ «ភ្ជាប់ Telegram និងដាក់ពាក្យ» នៅលើទំព័រដាក់ពាក្យ។',
}

function detectLanguage(message: TelegramMessage): OnboardingLanguage {
  const code = message.from?.language_code?.toLowerCase() ?? ''
  if (code.startsWith('zh')) return 'zh'
  if (code.startsWith('km')) return 'km'
  const content = `${message.text ?? ''} ${message.caption ?? ''}`
  if (/\p{Script=Khmer}/u.test(content)) return 'km'
  if (/\p{Script=Han}/u.test(content)) return 'zh'
  return 'en'
}

function messageContent(message: TelegramMessage): { content: string; messageType: string } {
  if (message.text) return { content: message.text, messageType: 'TEXT' }
  if (message.caption) return { content: message.caption, messageType: 'TEXT' }
  if (message.photo) return { content: '[图片]', messageType: 'IMAGE' }
  if (message.sticker) return { content: '[贴纸]', messageType: 'STICKER' }
  if (message.voice) return { content: '[语音]', messageType: 'VOICE' }
  if (message.video) return { content: '[视频]', messageType: 'VIDEO' }
  if (message.document) return { content: '[文件]', messageType: 'FILE' }
  return { content: '[其他消息]', messageType: 'OTHER' }
}

function senderName(from: TelegramFrom | undefined): string | null {
  if (!from) return null
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ').trim()
  return name || (from.username ? `@${from.username}` : null)
}

function senderUsername(from: TelegramFrom | undefined): string | null {
  const username = from?.username?.trim() ?? ''
  return /^[A-Za-z0-9_]{1,64}$/.test(username) ? username : null
}

async function resolveRecentLeadContext(telegramId: string): Promise<string | null> {
  const recent = await prisma.telegramMessage.findFirst({
    where: {
      channel: 'SALES_ONBOARDING',
      recipientTelegramId: telegramId,
      salesLeadId: { not: null },
    },
    orderBy: { createdAt: 'desc' },
    select: { salesLeadId: true },
  })
  return recent?.salesLeadId ?? null
}

async function resolveUnlinkedInquiryOwner(telegramId: string): Promise<string | null> {
  const recent = await prisma.telegramMessage.findFirst({
    where: {
      channel: 'SALES_ONBOARDING',
      recipientTelegramId: telegramId,
      salesLeadId: null,
      salesInquiryOwnerId: { not: null },
    },
    orderBy: { createdAt: 'desc' },
    select: { salesInquiryOwnerId: true },
  })
  return recent?.salesInquiryOwnerId ?? null
}

async function logIncomingMessage(input: {
  telegramId: string
  message: TelegramMessage
  salesLeadId: string | null
  salesInquiryOwnerId: string | null
  supportEntry: boolean
}) {
  const parsed = input.supportEntry
    ? { content: '[SUPPORT_ENTRY]', messageType: 'TEXT' }
    : messageContent(input.message)
  await prisma.telegramMessage.create({
    data: {
      channel: 'SALES_ONBOARDING',
      salesLeadId: input.salesLeadId,
      salesInquiryOwnerId: input.salesInquiryOwnerId,
      tenantId: null,
      recipientTelegramId: input.telegramId,
      senderName: senderName(input.message.from),
      senderUsername: senderUsername(input.message.from),
      content: parsed.content,
      messageType: parsed.messageType,
      sentBy: 'CUSTOMER',
      status: 'RECEIVED',
    },
  })
}

export async function POST(req: NextRequest) {
  if (!BOT_TOKEN || !WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'BOT_NOT_CONFIGURED' }, { status: 503 })
  }
  if (req.headers.get('x-telegram-bot-api-secret-token') !== WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  let update: TelegramUpdate
  try {
    update = await req.json() as TelegramUpdate
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const message = update.message
  const telegramId = String(message?.from?.id ?? message?.chat?.id ?? '')
  if (!message || !telegramId) return NextResponse.json({ ok: true })

  const text = message.text ?? ''
  const supportStart = parseSupportStartCommand(text)
  let salesLeadId: string | null = null
  if (supportStart.attempted) {
    const context = await consumeSupportContextToken({
      rawToken: supportStart.rawToken,
      telegramId,
    }).catch(() => ({ contextual: false as const, salesLeadId: null }))
    salesLeadId = context.salesLeadId
  } else {
    salesLeadId = await resolveRecentLeadContext(telegramId).catch(() => null)
  }

  const salesInquiryOwnerId = salesLeadId
    ? null
    : await resolveUnlinkedInquiryOwner(telegramId).catch(() => null)

  await logIncomingMessage({
    telegramId,
    message,
    salesLeadId,
    salesInquiryOwnerId,
    supportEntry: supportStart.attempted || /^\/start(?:@[A-Za-z0-9_]+)?$/.test(text.trim()),
  })

  const lang = detectLanguage(message)
  await sendAndLogMessage({
    recipientTelegramId: telegramId,
    text: ACKNOWLEDGEMENT[lang],
    sentBy: 'SYSTEM',
    botToken: BOT_TOKEN,
    channel: 'SALES_ONBOARDING',
    salesLeadId,
    salesInquiryOwnerId,
  })

  return NextResponse.json({ ok: true })
}
