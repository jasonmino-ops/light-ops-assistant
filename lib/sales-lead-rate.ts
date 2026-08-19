import crypto from 'node:crypto'
import type {
  Prisma,
  PrismaClient,
  SalesLeadRateAction,
  SalesLeadRateScope,
} from '@prisma/client'
import { prisma } from '@/lib/prisma'

type RateClient = Pick<PrismaClient, 'salesLeadRateCounter'> | Pick<Prisma.TransactionClient, 'salesLeadRateCounter'>

export type SalesLeadRatePolicy = {
  windowSeconds: number
  limit: number
  hard: boolean
}

const DEFAULT_POLICIES: Record<string, SalesLeadRatePolicy> = {
  'LEAD_SUBMIT:PHONE': { windowSeconds: 60 * 60, limit: 6, hard: true },
  'LEAD_SUBMIT:INVITE': { windowSeconds: 15 * 60, limit: 300, hard: false },
  'LEAD_SUBMIT:IP': { windowSeconds: 5 * 60, limit: 60, hard: false },
  'APPLICANT_CLAIM:PHONE': { windowSeconds: 15 * 60, limit: 10, hard: true },
  'APPLICANT_CLAIM:TELEGRAM': { windowSeconds: 15 * 60, limit: 10, hard: true },
  'APPLICANT_CLAIM:APPLICATION_TOKEN': { windowSeconds: 15 * 60, limit: 10, hard: true },
  'APPLICATION_SUBMIT:TELEGRAM': { windowSeconds: 15 * 60, limit: 5, hard: true },
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function getSalesLeadRatePolicy(
  action: SalesLeadRateAction,
  scopeType: SalesLeadRateScope,
  env: NodeJS.ProcessEnv = process.env,
): SalesLeadRatePolicy {
  const key = `${action}:${scopeType}`
  const fallback = DEFAULT_POLICIES[key] ?? { windowSeconds: 15 * 60, limit: 20, hard: false }
  const envStem = `SALES_LEAD_RATE_${action}_${scopeType}`
  return {
    windowSeconds: positiveInteger(env[`${envStem}_WINDOW_SECONDS`], fallback.windowSeconds),
    limit: positiveInteger(env[`${envStem}_LIMIT`], fallback.limit),
    hard: fallback.hard,
  }
}

export function getSalesLeadRateWindowStart(now: Date, windowSeconds: number): Date {
  const windowMs = windowSeconds * 1000
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs)
}

export function getSalesLeadRateScopeHash(input: {
  secret: string
  action: SalesLeadRateAction
  scopeType: SalesLeadRateScope
  value: string
}): string {
  if (input.secret.length < 32) throw new Error('SALES_LEAD_RATE_LIMIT_SECRET_MISSING')
  const canonicalValue = input.value.trim()
  if (!canonicalValue) throw new Error('SALES_LEAD_RATE_SCOPE_EMPTY')
  const domain = `es-sales-lead-v01:${input.action}:${input.scopeType}:${canonicalValue}`
  return crypto.createHmac('sha256', input.secret).update(domain).digest('hex')
}

export function getTrustedSalesLeadIpSignal(
  headers: Headers,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  // Vercel owns x-forwarded-for at the production proxy boundary. Outside that
  // boundary IP is omitted rather than treating a user-supplied header as identity.
  if (env.VERCEL !== '1' && env.NODE_ENV === 'production') return null
  const first = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return first || null
}

export async function consumeSalesLeadRateLimit(input: {
  action: SalesLeadRateAction
  scopeType: SalesLeadRateScope
  value: string
  now?: Date
  client?: RateClient
  env?: NodeJS.ProcessEnv
}) {
  const now = input.now ?? new Date()
  const env = input.env ?? process.env
  const client = input.client ?? prisma
  const policy = getSalesLeadRatePolicy(input.action, input.scopeType, env)
  const windowStart = getSalesLeadRateWindowStart(now, policy.windowSeconds)
  const expiresAt = new Date(windowStart.getTime() + policy.windowSeconds * 1000 * 2)
  const scopeKeyHash = getSalesLeadRateScopeHash({
    secret: env.SALES_LEAD_RATE_LIMIT_SECRET ?? '',
    action: input.action,
    scopeType: input.scopeType,
    value: input.value,
  })

  await client.salesLeadRateCounter.deleteMany({ where: { expiresAt: { lt: now } } })

  const counter = await client.salesLeadRateCounter.upsert({
    where: {
      action_scopeType_scopeKeyHash_windowStart: {
        action: input.action,
        scopeType: input.scopeType,
        scopeKeyHash,
        windowStart,
      },
    },
    create: {
      action: input.action,
      scopeType: input.scopeType,
      scopeKeyHash,
      windowStart,
      expiresAt,
      count: 1,
    },
    update: {
      count: { increment: 1 },
      expiresAt,
    },
    select: { count: true },
  })

  const exceeded = counter.count > policy.limit
  return {
    allowed: !policy.hard || !exceeded,
    hard: policy.hard,
    exceeded,
    count: counter.count,
    limit: policy.limit,
    retryAfterSeconds: Math.max(1, Math.ceil((windowStart.getTime() + policy.windowSeconds * 1000 - now.getTime()) / 1000)),
  }
}
