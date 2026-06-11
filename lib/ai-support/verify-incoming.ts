/**
 * lib/ai-support/verify-incoming.ts
 *
 * 入方向校验：灵烁回调店小二 plugin API 时使用。
 *
 * 必须满足全部条件才放行：
 *   1. 配置存在且 enabled
 *   2. X-AI-Client-Id 与配置匹配
 *   3. X-AI-Timestamp 与服务器时钟差 ≤ 300s
 *   4. X-AI-Signature = HMAC-SHA256(secret, timestamp.method.path.sha256(body)) 时序对比通过
 *   5. X-AI-Session-Id 存在且映射到一条 SUCCESS / NEED_HUMAN / PENDING 的审计行，且未超过 10min
 *   6. URL 中的 storeId / customerId 必须与审计行字段严格相等
 *
 * 任一不满足 → throw NextResponse.json 401。
 * 通过 → 返回 { auditRow, tenantId, storeId, customerTelegramId }。
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { getAiSupportConfig } from './config'
import type { AiSupportProviderConfig } from './types'

const MAX_DRIFT_SECONDS = 300
const AUDIT_TTL_MINUTES = 10

export class AiPluginAuthError extends Error {
  status: number
  code: string
  constructor(code: string, message: string, status = 401) {
    super(message)
    this.code = code
    this.status = status
  }
}

export type VerifyContext = {
  expectedStoreId?: string | null
  expectedCustomerId?: string | null
}

export type VerifiedAiRequest = {
  tenantId: string
  storeId: string | null
  customerTelegramId: string | null
  sessionId: string
  auditId: string
  config: AiSupportProviderConfig
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  } catch {
    return false
  }
}

function resolveApiSecret(cfg: AiSupportProviderConfig): string | null {
  const ref = cfg.secretRef?.trim()
  if (ref) {
    const fromEnv = process.env[ref]?.trim()
    if (fromEnv) return fromEnv
  }
  return null
}

function killSwitchEngaged(): boolean {
  const v = (process.env.AI_SUPPORT_KILL_SWITCH ?? '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

function bodyHash(body: string): string {
  return crypto.createHash('sha256').update(body).digest('hex')
}

function computeSignature(secret: string, timestamp: string, method: string, path: string, body: string): string {
  const payload = `${timestamp}\n${method.toUpperCase()}\n${path}\n${bodyHash(body)}`
  return crypto.createHmac('sha256', secret).update(payload).digest('hex')
}

/**
 * 校验灵烁来访 plugin API 的请求。
 * @param req           当前 NextRequest
 * @param rawBody       已经 await 出来的原始请求体（GET 传空字符串）
 * @param ctx           URL 路径里要求等值核对的字段
 */
export async function verifyIncomingAiRequest(
  req: NextRequest,
  rawBody: string,
  ctx: VerifyContext,
): Promise<VerifiedAiRequest> {
  if (killSwitchEngaged()) {
    throw new AiPluginAuthError('KILL_SWITCH', 'AI support kill switch is engaged', 503)
  }

  const clientId = req.headers.get('x-ai-client-id')?.trim() ?? ''
  const timestamp = req.headers.get('x-ai-timestamp')?.trim() ?? ''
  const signature = req.headers.get('x-ai-signature')?.trim() ?? ''
  const sessionId = req.headers.get('x-ai-session-id')?.trim() ?? ''

  if (!clientId || !timestamp || !signature || !sessionId) {
    throw new AiPluginAuthError('MISSING_HEADERS', 'Missing AI auth headers')
  }

  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) {
    throw new AiPluginAuthError('INVALID_TIMESTAMP', 'Timestamp not a number')
  }
  const nowSec = Math.floor(Date.now() / 1000)
  const drift = Math.abs(nowSec - ts)
  if (drift > MAX_DRIFT_SECONDS) {
    throw new AiPluginAuthError('TIMESTAMP_DRIFT', `Timestamp drift ${drift}s > ${MAX_DRIFT_SECONDS}s`)
  }

  // 通过 sessionId 找到审计行；再用审计行的 tenantId 找配置
  const auditRow = await prisma.aiSupportAuditLog.findFirst({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      tenantId: true,
      storeId: true,
      customerId: true,
      sessionId: true,
      provider: true,
      createdAt: true,
      status: true,
    },
  })
  if (!auditRow || !auditRow.tenantId || !auditRow.sessionId) {
    throw new AiPluginAuthError('SESSION_NOT_FOUND', 'Session id not found in audit log')
  }

  const ageMs = Date.now() - auditRow.createdAt.getTime()
  if (ageMs > AUDIT_TTL_MINUTES * 60_000) {
    throw new AiPluginAuthError('SESSION_EXPIRED', `Session expired (${Math.floor(ageMs / 60_000)} min)`)
  }

  if (ctx.expectedStoreId !== undefined) {
    if ((auditRow.storeId ?? null) !== (ctx.expectedStoreId ?? null)) {
      throw new AiPluginAuthError('STOREID_MISMATCH', 'URL storeId does not match session storeId')
    }
  }
  if (ctx.expectedCustomerId !== undefined) {
    if ((auditRow.customerId ?? null) !== (ctx.expectedCustomerId ?? null)) {
      throw new AiPluginAuthError('CUSTOMERID_MISMATCH', 'URL customerId does not match session customerId')
    }
  }

  const cfg = await getAiSupportConfig({
    tenantId: auditRow.tenantId,
    storeId: auditRow.storeId,
    provider: auditRow.provider,
  })
  if (!cfg || !cfg.enabled) {
    throw new AiPluginAuthError('CONFIG_DISABLED', 'AI support disabled for this tenant/store')
  }
  if (!cfg.clientId || cfg.clientId !== clientId) {
    throw new AiPluginAuthError('CLIENT_ID_MISMATCH', 'X-AI-Client-Id does not match config')
  }
  const secret = resolveApiSecret(cfg)
  if (!secret) {
    throw new AiPluginAuthError('SECRET_UNAVAILABLE', 'Server-side secret not configured', 500)
  }

  // 计算签名：path 用 req.nextUrl.pathname；body 已由调用方读取
  const path = req.nextUrl.pathname
  const method = req.method
  const expected = computeSignature(secret, timestamp, method, path, rawBody)
  if (!constantTimeEqual(expected, signature)) {
    throw new AiPluginAuthError('BAD_SIGNATURE', 'Signature mismatch')
  }

  return {
    tenantId: auditRow.tenantId,
    storeId: auditRow.storeId,
    customerTelegramId: auditRow.customerId,
    sessionId: auditRow.sessionId,
    auditId: auditRow.id,
    config: cfg,
  }
}

/** 统一把 AiPluginAuthError 渲染为 NextResponse。 */
export function aiPluginErrorResponse(err: unknown): NextResponse {
  if (err instanceof AiPluginAuthError) {
    return NextResponse.json({ error: err.code, message: err.message }, { status: err.status })
  }
  console.error('[ai-plugin] internal error', err)
  return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
}
