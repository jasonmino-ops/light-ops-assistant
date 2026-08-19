import type { Prisma } from '@prisma/client'

export function cleanApplicationBlockText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const clean = value.trim().replace(/\s+/g, ' ').slice(0, maxLength)
  return clean || null
}

export async function blockStoreApplications(input: {
  tx: Prisma.TransactionClient
  telegramId: string
  telegramUsername: string | null
  reason: string
  note: string | null
  opsAdminId: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  return input.tx.applicationBlock.upsert({
    where: { telegramId: input.telegramId },
    create: {
      telegramId: input.telegramId,
      telegramUsername: input.telegramUsername,
      reason: input.reason,
      note: input.note,
      blockedByOpsAdminId: input.opsAdminId,
      blockedAt: now,
    },
    update: {
      telegramUsername: input.telegramUsername,
      reason: input.reason,
      note: input.note,
      blockedByOpsAdminId: input.opsAdminId,
      blockedAt: now,
      unblockedByOpsAdminId: null,
      unblockedAt: null,
    },
  })
}
