import { buildTelegramStartLink, normalizeTelegramBotUsername } from '@/lib/telegram-link'
import { issueSalesLeadContextToken } from '@/lib/sales-lead-context-token'

export type PlatformSupportConfig = {
  phoneDisplay: string | null
  phoneHref: string | null
  telegramUrl: string | null
}

export async function getLeadSupportConfig(input: {
  salesLeadId: string | null | undefined
  contextStage: string
}): Promise<PlatformSupportConfig> {
  const support = getPlatformSupportConfig()
  if (!input.salesLeadId) return support
  const bot = normalizeTelegramBotUsername(
    process.env.TELEGRAM_BOT_USERNAME,
    process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME,
  )
  if (!bot) return support
  try {
    const rawToken = await issueSalesLeadContextToken({
      salesLeadId: input.salesLeadId,
      purpose: 'SUPPORT',
      contextStage: input.contextStage,
    })
    return {
      ...support,
      telegramUrl: buildTelegramStartLink(bot, `support_${rawToken}`),
    }
  } catch {
    // Context enrichment must never make customer support unavailable.
    return support
  }
}

export function getPlatformSupportConfig(
  env: NodeJS.ProcessEnv = process.env,
): PlatformSupportConfig {
  const rawPhone = String(env.PLATFORM_SUPPORT_PHONE ?? '').trim().slice(0, 40)
  const dialPhone = rawPhone.replace(/[^\d+]/g, '')
  const bot = normalizeTelegramBotUsername(
    env.TELEGRAM_BOT_USERNAME,
    env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME,
  )
  return {
    phoneDisplay: rawPhone || null,
    phoneHref: dialPhone ? `tel:${dialPhone}` : null,
    telegramUrl: bot ? `https://t.me/${bot}` : null,
  }
}
