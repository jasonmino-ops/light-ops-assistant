import crypto from 'node:crypto'
import type { SalesLeadTokenPurpose } from '@prisma/client'

const TOKEN_BYTES = 16
const TOKEN_BASE64URL_LENGTH = 22
const DEFAULT_APPLICATION_TTL_HOURS = 72
const DEFAULT_SUPPORT_TTL_HOURS = 24

function positiveHours(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 24 * 30) return fallback
  return parsed
}

export function salesLeadTokenTtlMs(
  purpose: SalesLeadTokenPurpose,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const hours = purpose === 'APPLICATION'
    ? positiveHours(env.SALES_LEAD_APPLICATION_TOKEN_TTL_HOURS, DEFAULT_APPLICATION_TTL_HOURS)
    : positiveHours(env.SALES_LEAD_SUPPORT_TOKEN_TTL_HOURS, DEFAULT_SUPPORT_TTL_HOURS)
  return hours * 60 * 60 * 1000
}

export function isSalesLeadRawToken(value: string | null | undefined): value is string {
  return typeof value === 'string' &&
    value.length === TOKEN_BASE64URL_LENGTH &&
    /^[A-Za-z0-9_-]+$/.test(value)
}

export function hashSalesLeadContextToken(rawToken: string): string {
  if (!isSalesLeadRawToken(rawToken)) throw new Error('INVALID_SALES_LEAD_TOKEN')
  return crypto.createHash('sha256').update(rawToken).digest('hex')
}

export function generateSalesLeadContextToken(
  purpose: SalesLeadTokenPurpose,
  now = new Date(),
  env: NodeJS.ProcessEnv = process.env,
) {
  const rawToken = crypto.randomBytes(TOKEN_BYTES).toString('base64url')
  return {
    rawToken,
    tokenHash: hashSalesLeadContextToken(rawToken),
    expiresAt: new Date(now.getTime() + salesLeadTokenTtlMs(purpose, env)),
  }
}

export function redactSalesLeadToken(rawToken: string | null | undefined): string {
  if (!rawToken) return 'token:none'
  return `token:${rawToken.slice(0, 4)}…len${rawToken.length}`
}
