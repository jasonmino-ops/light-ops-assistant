import { buildTelegramStartLink, normalizeTelegramBotUsername } from '@/lib/telegram-link'
import { issueSalesLeadContextToken } from '@/lib/sales-lead-context-token'
import { prisma } from '@/lib/prisma'
import { cleanContactValue, isValidContactPhone } from '@/lib/store-contact'

export type PlatformSupportConfig = {
  phoneDisplay: string | null
  phoneHref: string | null
  telegramUrl: string | null
}

export type SalesLeadSupportConfigInput = {
  supportPhone?: unknown
  telegramSupportTarget?: unknown
}

export type NormalizedSalesLeadSupportConfig = {
  supportPhone: string | null
  telegramSupportTarget: string | null
}

const SUPPORT_CONFIG_ID = 'platform'

export function normalizeTelegramSupportTarget(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  const raw = value.trim()
  if (!raw) return null
  const username = raw
    .replace(/^@/, '')
    .replace(/^https:\/\/t\.me\//i, '')
    .replace(/\/$/, '')
  return /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username) ? username : undefined
}

export function normalizeSalesLeadSupportConfig(
  input: SalesLeadSupportConfigInput,
): NormalizedSalesLeadSupportConfig | null {
  if (input.supportPhone === undefined || input.telegramSupportTarget === undefined) return null
  if (input.supportPhone !== null && typeof input.supportPhone !== 'string') return null
  const supportPhone = cleanContactValue(input.supportPhone)
  const telegramSupportTarget = normalizeTelegramSupportTarget(input.telegramSupportTarget)
  if (supportPhone === undefined || telegramSupportTarget === undefined) return null
  if (!isValidContactPhone(supportPhone)) return null
  return { supportPhone, telegramSupportTarget }
}

function toPublicSupport(
  values: NormalizedSalesLeadSupportConfig,
  fallbackBot: string,
): PlatformSupportConfig {
  const phoneDisplay = values.supportPhone
  const dialPhone = phoneDisplay?.replace(/[^\d+]/g, '') ?? ''
  const telegramTarget = values.telegramSupportTarget || fallbackBot
  return {
    phoneDisplay,
    phoneHref: dialPhone ? `tel:${dialPhone}` : null,
    telegramUrl: telegramTarget ? `https://t.me/${telegramTarget}` : null,
  }
}

async function loadSupportConfig(): Promise<{
  values: NormalizedSalesLeadSupportConfig
  telegramTarget: string
}> {
  const fallbackBot = normalizeTelegramBotUsername(
    process.env.TELEGRAM_BOT_USERNAME,
    process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME,
  )
  try {
    const row = await prisma.salesLeadSupportConfig.findUnique({
      where: { id: SUPPORT_CONFIG_ID },
      select: { supportPhone: true, telegramSupportTarget: true },
    })
    const values = {
      supportPhone: row?.supportPhone ?? null,
      telegramSupportTarget: row?.telegramSupportTarget ?? null,
    }
    return { values, telegramTarget: values.telegramSupportTarget || fallbackBot }
  } catch {
    // Missing config/migration must not make customer support pages fail.
    return {
      values: { supportPhone: null, telegramSupportTarget: null },
      telegramTarget: fallbackBot,
    }
  }
}

export async function getLeadSupportConfig(input: {
  salesLeadId: string | null | undefined
  contextStage: string
}): Promise<PlatformSupportConfig> {
  const loaded = await loadSupportConfig()
  const support = toPublicSupport(loaded.values, loaded.telegramTarget)
  if (!input.salesLeadId) return support
  if (!loaded.telegramTarget) return support
  try {
    const rawToken = await issueSalesLeadContextToken({
      salesLeadId: input.salesLeadId,
      purpose: 'SUPPORT',
      contextStage: input.contextStage,
    })
    return {
      ...support,
      telegramUrl: buildTelegramStartLink(loaded.telegramTarget, `support_${rawToken}`),
    }
  } catch {
    // Context enrichment must never make customer support unavailable.
    return support
  }
}

export async function getPlatformSupportConfig(): Promise<PlatformSupportConfig> {
  const loaded = await loadSupportConfig()
  return toPublicSupport(loaded.values, loaded.telegramTarget)
}
