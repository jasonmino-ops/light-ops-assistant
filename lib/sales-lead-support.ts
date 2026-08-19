import { normalizeTelegramBotUsername } from '@/lib/telegram-link'

export type PlatformSupportConfig = {
  phoneDisplay: string | null
  phoneHref: string | null
  telegramUrl: string | null
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
