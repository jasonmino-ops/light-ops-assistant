import type { Prisma, PrismaClient } from '@prisma/client'
import type { NextRequest } from 'next/server'
import { hashAuditValue } from './crypto'

type DesktopAuditDb = Prisma.TransactionClient | PrismaClient

const ALLOWED_METADATA_KEYS = new Set([
  'accessState',
  'status',
  'credentialVersion',
  'expiresAt',
  'lockedUntil',
  'failedAttempts',
  'reusedDevice',
  'replacesDeviceId',
  'reason',
  'eventVersion',
  'operatorRole',
  'issuanceSource',
])

const SENSITIVE_KEY_PATTERN = /(token|pin|authorization|secret|hash|installation|payload|request|response)/i

type AuditMetadata = Record<string, string | number | boolean | null | undefined>

export type DesktopActivationAuditInput = {
  tenantId: string
  storeId: string
  deviceId?: string | null
  pinId?: string | null
  actorUserId?: string | null
  actorOpsAdminId?: string | null
  eventType: string
  result: 'SUCCESS' | 'FAILED' | 'DENIED' | 'INFO'
  reasonCode?: string | null
  ipHash?: string | null
  userAgentHash?: string | null
  metadata?: AuditMetadata
}

function safeMetadata(metadata: AuditMetadata | undefined): Prisma.InputJsonObject | undefined {
  if (!metadata) return undefined
  const output: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      throw new Error(`SENSITIVE_AUDIT_METADATA_KEY:${key}`)
    }
    if (!ALLOWED_METADATA_KEYS.has(key)) continue
    if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      output[key] = value ?? null
    }
  }
  return Object.keys(output).length > 0 ? output as Prisma.InputJsonObject : undefined
}

export async function writeDesktopActivationAudit(
  db: DesktopAuditDb,
  input: DesktopActivationAuditInput,
) {
  return db.desktopActivationAudit.create({
    data: {
      tenantId: input.tenantId,
      storeId: input.storeId,
      deviceId: input.deviceId ?? null,
      pinId: input.pinId ?? null,
      actorUserId: input.actorUserId ?? null,
      actorOpsAdminId: input.actorOpsAdminId ?? null,
      eventType: input.eventType,
      result: input.result,
      reasonCode: input.reasonCode ?? null,
      ipHash: input.ipHash ?? null,
      userAgentHash: input.userAgentHash ?? null,
      metadata: safeMetadata(input.metadata),
    },
  })
}

export function auditRequestHashes(req: NextRequest) {
  const forwardedFor = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const realIp = req.headers.get('x-real-ip')?.trim()
  const userAgent = req.headers.get('user-agent')?.trim()
  return {
    ipHash: hashAuditValue(forwardedFor || realIp || null),
    userAgentHash: hashAuditValue(userAgent || null),
  }
}
