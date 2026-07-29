import type { NextRequest } from 'next/server'
import type { Prisma, PrismaClient } from '@prisma/client'
import { hashAuditValue } from './crypto'

/**
 * 电脑客户端审计。写库前做两道保护：
 *   1. 元数据 key 白名单；
 *   2. 敏感词拦截（token / secret / hash / installation 等一律丢弃）。
 * 目的：审计里永远不可能出现凭证明文。
 */

type AuditDb = Prisma.TransactionClient | PrismaClient

const ALLOWED_METADATA_KEYS = new Set([
  'status',
  'previousStatus',
  'credentialStatus',
  'reason',
  'reasonCode',
  'storeCode',
  'agentVersion',
  'idempotent',
  'expiresAt',
  'decidedAt',
  'boundAt',
  'operatorRole',
  'eventVersion',
])

const SENSITIVE_KEY_PATTERN =
  /(token|secret|pin|authorization|hash|installation|credential_?plain|payload|request|response)/i

type AuditMetadata = Record<string, string | number | boolean | null | undefined>

export type ComputerBindingAuditInput = {
  tenantId: string
  storeId: string
  bindingId?: string | null
  actorUserId?: string | null
  eventType: string
  result: 'SUCCESS' | 'FAILED' | 'DENIED' | 'INFO'
  reasonCode?: string | null
  ipHash?: string | null
  userAgentHash?: string | null
  metadata?: AuditMetadata
}

function sanitizeMetadata(metadata?: AuditMetadata) {
  if (!metadata) return undefined
  const output: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined) continue
    if (SENSITIVE_KEY_PATTERN.test(key)) continue
    if (!ALLOWED_METADATA_KEYS.has(key)) continue
    output[key] = value
  }
  return Object.keys(output).length > 0 ? output : undefined
}

/** 从请求里取 IP / UA 并直接哈希，明文不进入调用方 */
export function auditRequestFingerprint(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    null
  return {
    ipHash: hashAuditValue(ip),
    userAgentHash: hashAuditValue(req.headers.get('user-agent')),
  }
}

/** 审计失败绝不影响主流程 */
/** 必须与业务变更同一事务成功的审计（例如 OWNER 停用电脑）。 */
export async function createComputerBindingAudit(db: AuditDb, input: ComputerBindingAuditInput) {
  await db.computerBindingAudit.create({
    data: {
      tenantId: input.tenantId,
      storeId: input.storeId,
      bindingId: input.bindingId ?? null,
      actorUserId: input.actorUserId ?? null,
      eventType: input.eventType,
      result: input.result,
      reasonCode: input.reasonCode ?? null,
      ipHash: input.ipHash ?? null,
      userAgentHash: input.userAgentHash ?? null,
      metadata: sanitizeMetadata(input.metadata),
    },
  })
}

export async function writeComputerBindingAudit(db: AuditDb, input: ComputerBindingAuditInput) {
  try {
    await createComputerBindingAudit(db, input)
  } catch (err) {
    console.error('[computer-client] 审计写入失败', err)
  }
}
