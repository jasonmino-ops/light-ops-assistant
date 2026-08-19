import type { Prisma, PrismaClient, SalesLeadTokenPurpose } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { generateSalesLeadContextToken } from '@/lib/sales-lead-token'

type TokenClient = Pick<PrismaClient, 'salesLeadContextToken'> | Pick<Prisma.TransactionClient, 'salesLeadContextToken'>

export async function issueSalesLeadContextToken(input: {
  salesLeadId: string
  purpose: SalesLeadTokenPurpose
  contextStage: string
  now?: Date
  client?: TokenClient
}) {
  const now = input.now ?? new Date()
  const client = input.client ?? prisma
  const material = generateSalesLeadContextToken(input.purpose, now)
  await client.salesLeadContextToken.updateMany({
    where: {
      salesLeadId: input.salesLeadId,
      purpose: input.purpose,
      consumedAt: null,
      revokedAt: null,
    },
    data: { revokedAt: now },
  })
  await client.salesLeadContextToken.create({
    data: {
      salesLeadId: input.salesLeadId,
      tokenHash: material.tokenHash,
      purpose: input.purpose,
      contextStage: input.contextStage,
      expiresAt: material.expiresAt,
    },
  })
  return material.rawToken
}
