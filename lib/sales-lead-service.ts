import crypto from 'node:crypto'
import type { AcquisitionInvite, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { generateSalesLeadContextToken } from '@/lib/sales-lead-token'

export type PublicLeadInput = {
  storeName: string
  ownerName: string
  normalizedPhone: string
  address: string | null
  latitude: number | null
  longitude: number | null
}

export type PublicLeadResult =
  | { state: 'READY_FOR_TELEGRAM'; created: boolean; rawApplicationToken: string }
  | { state: 'EXISTING_APPLICATION' }
  | { state: 'ACTIVATED' }
  | { state: 'SHARED_PHONE_REVIEW' }

export function cleanSalesLeadRequiredText(value: unknown, maxLength = 120): string {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\s+/g, ' ').slice(0, maxLength)
}

function identityName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

function phoneAdvisoryLockKey(normalizedPhone: string): bigint {
  const digest = crypto.createHash('sha256').update(`sales-lead-phone:${normalizedPhone}`).digest()
  return digest.readBigInt64BE(0)
}

async function issueApplicationToken(
  tx: Prisma.TransactionClient,
  salesLeadId: string,
  now: Date,
) {
  const material = generateSalesLeadContextToken('APPLICATION', now)
  await tx.salesLeadContextToken.updateMany({
    where: { salesLeadId, purpose: 'APPLICATION', consumedAt: null, revokedAt: null },
    data: { revokedAt: now },
  })
  await tx.salesLeadContextToken.create({
    data: {
      salesLeadId,
      tokenHash: material.tokenHash,
      purpose: 'APPLICATION',
      contextStage: 'LEAD_FORM',
      expiresAt: material.expiresAt,
    },
  })
  return material.rawToken
}

export async function createOrRestorePublicSalesLead(input: {
  invite: AcquisitionInvite
  lead: PublicLeadInput
  now?: Date
}): Promise<PublicLeadResult> {
  const now = input.now ?? new Date()
  return prisma.$transaction(async (tx) => {
    // Phone is deliberately not UNIQUE, but this transaction-scoped lock closes
    // the concurrent double-submit race without persisting the raw phone as a key.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${phoneAdvisoryLockKey(input.lead.normalizedPhone)})`
    const phoneCandidates = await tx.salesLead.findMany({
      where: { normalizedPhone: input.lead.normalizedPhone },
      orderBy: { createdAt: 'asc' },
      take: 20,
      include: {
        applications: {
          where: { status: 'PENDING' },
          select: { id: true },
          take: 1,
        },
      },
    })
    const ownerKey = identityName(input.lead.ownerName)
    const storeKey = identityName(input.lead.storeName)
    const matches = phoneCandidates.filter((candidate) => (
      identityName(candidate.ownerName) === ownerKey && identityName(candidate.storeName) === storeKey
    ))

    if (matches.length > 1 || (phoneCandidates.length > 0 && matches.length === 0)) {
      return { state: 'SHARED_PHONE_REVIEW' }
    }

    const existing = matches[0]
    if (existing) {
      if (existing.status === 'ACTIVATED') return { state: 'ACTIVATED' }
      if (existing.applications.length > 0) return { state: 'EXISTING_APPLICATION' }

      const nextStatus = existing.status === 'LOST'
        ? (existing.telegramId ? 'NEW' : 'WAITING_TELEGRAM')
        : existing.status
      await tx.salesLead.update({
        where: { id: existing.id },
        data: {
          storeName: input.lead.storeName,
          ownerName: input.lead.ownerName,
          normalizedPhone: input.lead.normalizedPhone,
          address: input.lead.address,
          latitude: input.lead.latitude,
          longitude: input.lead.longitude,
          status: nextStatus,
          lastActivityAt: now,
          // firstInvite/source/campaign/initial owner are intentionally immutable.
        },
      })
      const rawApplicationToken = await issueApplicationToken(tx, existing.id, now)
      return { state: 'READY_FOR_TELEGRAM', created: false, rawApplicationToken }
    }

    const created = await tx.salesLead.create({
      data: {
        storeName: input.lead.storeName,
        ownerName: input.lead.ownerName,
        normalizedPhone: input.lead.normalizedPhone,
        address: input.lead.address,
        latitude: input.lead.latitude,
        longitude: input.lead.longitude,
        firstInviteId: input.invite.id,
        firstSourceChannel: input.invite.sourceChannel,
        firstCampaign: input.invite.campaignLabel,
        initialSalesOwnerId: input.invite.salesOwnerId,
        status: 'WAITING_TELEGRAM',
        lastActivityAt: now,
      },
    })
    const rawApplicationToken = await issueApplicationToken(tx, created.id, now)
    return { state: 'READY_FOR_TELEGRAM', created: true, rawApplicationToken }
  })
}
