import { prisma } from '@/lib/prisma'
import { hashSalesLeadContextToken, isSalesLeadRawToken } from '@/lib/sales-lead-token'

export type SupportStartCommand = {
  attempted: boolean
  rawToken: string | null
}

export function parseSupportStartCommand(text: string): SupportStartCommand {
  const normalized = text.trim()
  if (!/^\/start(?:@[A-Za-z0-9_]+)?\s+support_/.test(normalized)) {
    return { attempted: false, rawToken: null }
  }
  const match = normalized.match(/^\/start(?:@[A-Za-z0-9_]+)?\s+support_([A-Za-z0-9_-]{22})$/)
  return {
    attempted: true,
    rawToken: match && isSalesLeadRawToken(match[1]) ? match[1] : null,
  }
}

export async function consumeSupportContextToken(input: {
  rawToken: string | null
  telegramId: string
  now?: Date
}) {
  if (!input.rawToken) return { contextual: false as const, salesLeadId: null }
  const now = input.now ?? new Date()
  const token = await prisma.salesLeadContextToken.findUnique({
    where: { tokenHash: hashSalesLeadContextToken(input.rawToken) },
    select: {
      id: true,
      salesLeadId: true,
      purpose: true,
      expiresAt: true,
      consumedAt: true,
      revokedAt: true,
    },
  })
  if (
    !token || token.purpose !== 'SUPPORT' || token.expiresAt <= now ||
    token.consumedAt || token.revokedAt
  ) {
    return { contextual: false as const, salesLeadId: null }
  }
  const consumed = await prisma.salesLeadContextToken.updateMany({
    where: {
      id: token.id,
      purpose: 'SUPPORT',
      expiresAt: { gt: now },
      consumedAt: null,
      revokedAt: null,
    },
    data: { consumedAt: now, consumedByTelegramId: input.telegramId },
  })
  return consumed.count === 1
    ? { contextual: true as const, salesLeadId: token.salesLeadId }
    : { contextual: false as const, salesLeadId: null }
}
