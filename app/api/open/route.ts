import { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { cleanSalesLeadRequiredText } from '@/lib/sales-lead-service'
import { validateSalesLeadPhone, salesLeadPhonesMatch } from '@/lib/sales-lead-phone'
import { hashSalesLeadContextToken, isSalesLeadRawToken } from '@/lib/sales-lead-token'
import { consumeSalesLeadRateLimit } from '@/lib/sales-lead-rate'
import { getLeadSupportConfig, getPlatformSupportConfig } from '@/lib/sales-lead-support'
import {
  cleanStoreAddress,
  cleanStoreCoordinate,
  isValidStoreLat,
  isValidStoreLng,
} from '@/lib/store-location'
import { verifyTgInitData } from '@/lib/verify-tg-init-data'
import { getSalesLeadTelegramAdvisoryKey } from '@/lib/sales-lead-advisory'

type TelegramApplicant = {
  telegramId: string
  username: string | null
  firstName: string | null
  lastName: string | null
}

type OpenBody = {
  action?: unknown
  initData?: unknown
  applicationToken?: unknown
  phone?: unknown
  storeName?: unknown
  ownerName?: unknown
  address?: unknown
  latitude?: unknown
  longitude?: unknown
}

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? ''
const IN_FLIGHT_STATUSES = ['NEW', 'FOLLOWING', 'WAITING_TELEGRAM', 'APPLIED', 'LOST'] as const

function safeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const clean = value.trim().slice(0, maxLength)
  return clean || null
}

function verifyApplicant(initData: unknown): { applicant?: TelegramApplicant; error?: string } {
  if (typeof initData !== 'string' || !initData) return { error: 'INVALID_TELEGRAM' }
  let params: URLSearchParams | null
  if (!BOT_TOKEN) {
    if (process.env.NODE_ENV === 'production') return { error: 'TELEGRAM_CONFIG_UNAVAILABLE' }
    params = new URLSearchParams(initData)
  } else {
    params = verifyTgInitData(initData, BOT_TOKEN)
  }
  if (!params) return { error: 'INVALID_TELEGRAM' }

  try {
    const user = JSON.parse(params.get('user') ?? '{}') as Record<string, unknown>
    const telegramId = String(user.id ?? '')
    if (!/^[1-9]\d{0,19}$/.test(telegramId)) return { error: 'INVALID_TELEGRAM' }
    return {
      applicant: {
        telegramId,
        username: safeText(user.username, 64),
        firstName: safeText(user.first_name, 120),
        lastName: safeText(user.last_name, 120),
      },
    }
  } catch {
    return { error: 'INVALID_TELEGRAM' }
  }
}

function leadProfile(lead: {
  storeName: string
  ownerName: string
  normalizedPhone: string
  address: string | null
  latitude: number | null
  longitude: number | null
}) {
  return {
    storeName: lead.storeName,
    ownerName: lead.ownerName,
    phone: lead.normalizedPhone,
    address: lead.address,
    latitude: lead.latitude,
    longitude: lead.longitude,
  }
}

async function activeMerchantUser(telegramId: string, client: Prisma.TransactionClient | typeof prisma = prisma) {
  return client.user.findFirst({
    where: { telegramId, status: 'ACTIVE', tenant: { status: 'ACTIVE' } },
    select: { id: true },
  })
}

async function activeApplicationBlock(telegramId: string, client: Prisma.TransactionClient | typeof prisma = prisma) {
  return client.applicationBlock.findFirst({
    where: { telegramId, unblockedAt: null },
    select: { id: true },
  })
}

async function consumeClaimRates(input: {
  telegramId: string
  token: string
  phone: string
}) {
  const results = await Promise.all([
    consumeSalesLeadRateLimit({ action: 'APPLICANT_CLAIM', scopeType: 'TELEGRAM', value: input.telegramId }),
    consumeSalesLeadRateLimit({ action: 'APPLICANT_CLAIM', scopeType: 'APPLICATION_TOKEN', value: input.token || 'missing' }),
    consumeSalesLeadRateLimit({ action: 'APPLICANT_CLAIM', scopeType: 'PHONE', value: input.phone || 'missing' }),
  ])
  return results.find((result) => !result.allowed) ?? null
}

async function statusForApplicant(applicant: TelegramApplicant) {
  if (await activeMerchantUser(applicant.telegramId)) return { state: 'ALREADY_BOUND' as const }
  const pending = await prisma.storeApplication.findFirst({
    where: { telegramId: applicant.telegramId, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, salesLeadId: true },
  })
  if (pending) return {
    state: 'PENDING' as const,
    applicationNo: pending.id.slice(-8).toUpperCase(),
    salesLeadId: pending.salesLeadId,
  }

  const lead = await prisma.salesLead.findFirst({
    where: { telegramId: applicant.telegramId },
    orderBy: { lastActivityAt: 'desc' },
    select: {
      id: true,
      storeName: true,
      ownerName: true,
      normalizedPhone: true,
      address: true,
      latitude: true,
      longitude: true,
      status: true,
    },
  })
  if (await activeApplicationBlock(applicant.telegramId)) {
    return { state: 'BLOCKED' as const, salesLeadId: lead?.id ?? null }
  }
  if (lead?.status === 'ACTIVATED') return { state: 'ALREADY_BOUND' as const }
  if (lead) return { state: 'CLAIMED' as const, profile: leadProfile(lead), salesLeadId: lead.id }
  return {
    state: 'LEGACY_FORM' as const,
    ownerName: [applicant.firstName, applicant.lastName].filter(Boolean).join(' ') || applicant.username || '',
  }
}

async function claimAttributedLead(applicant: TelegramApplicant, body: OpenBody) {
  const rawToken = typeof body.applicationToken === 'string' ? body.applicationToken : ''
  const phoneInput = typeof body.phone === 'string' ? body.phone : ''
  let rateBlocked
  try {
    rateBlocked = await consumeClaimRates({
      telegramId: applicant.telegramId,
      token: rawToken,
      phone: phoneInput.trim(),
    })
  } catch {
    return { state: 'RATE_GUARD_UNAVAILABLE' as const, status: 503 }
  }
  if (rateBlocked) return { state: 'RATE_LIMITED' as const, status: 429, retryAfter: rateBlocked.retryAfterSeconds }

  const phone = validateSalesLeadPhone(phoneInput)
  if (!isSalesLeadRawToken(rawToken) || !phone.ok) {
    return { state: 'CLAIM_FAILED' as const, status: 400 }
  }
  const now = new Date()
  const context = await prisma.salesLeadContextToken.findUnique({
    where: { tokenHash: hashSalesLeadContextToken(rawToken) },
    include: { salesLead: true },
  })
  if (!context || context.purpose !== 'APPLICATION' || context.revokedAt || context.expiresAt <= now) {
    return { state: 'CLAIM_FAILED' as const, status: 400 }
  }
  if (context.consumedAt) {
    if (
      context.consumedByTelegramId === applicant.telegramId &&
      context.salesLead.telegramId === applicant.telegramId
    ) {
      return {
        state: 'CLAIMED' as const,
        status: 200,
        profile: leadProfile(context.salesLead),
        salesLeadId: context.salesLeadId,
      }
    }
    return { state: 'CLAIM_FAILED' as const, status: 409 }
  }
  if (!salesLeadPhonesMatch(phone.normalizedPhone, context.salesLead.normalizedPhone)) {
    return { state: 'CLAIM_FAILED' as const, status: 400 }
  }
  if (context.salesLead.telegramId && context.salesLead.telegramId !== applicant.telegramId) {
    return { state: 'CLAIM_FAILED' as const, status: 409 }
  }
  if (await activeMerchantUser(applicant.telegramId)) {
    return { state: 'ALREADY_BOUND' as const, status: 409 }
  }

  try {
    await prisma.$transaction(async (tx) => {
      const conflicting = await tx.salesLead.findFirst({
        where: {
          telegramId: applicant.telegramId,
          id: { not: context.salesLeadId },
          status: { in: [...IN_FLIGHT_STATUSES] },
        },
        select: { id: true },
      })
      if (conflicting) throw new Error('APPLICANT_FLOW_EXISTS')

      const leadUpdate = await tx.salesLead.updateMany({
        where: {
          id: context.salesLeadId,
          OR: [{ telegramId: null }, { telegramId: applicant.telegramId }],
        },
        data: {
          telegramId: applicant.telegramId,
          telegramUsername: applicant.username,
          telegramFirstName: applicant.firstName,
          telegramLastName: applicant.lastName,
          telegramBoundAt: context.salesLead.telegramBoundAt ?? now,
          status: context.salesLead.status === 'WAITING_TELEGRAM' ? 'NEW' : context.salesLead.status,
          lastActivityAt: now,
        },
      })
      if (leadUpdate.count !== 1) throw new Error('CLAIM_CONFLICT')

      const tokenUpdate = await tx.salesLeadContextToken.updateMany({
        where: { id: context.id, consumedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now, consumedByTelegramId: applicant.telegramId },
      })
      if (tokenUpdate.count !== 1) throw new Error('CLAIM_CONFLICT')
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { state: 'APPLICANT_FLOW_EXISTS' as const, status: 409 }
    }
    return {
      state: error instanceof Error && error.message === 'APPLICANT_FLOW_EXISTS'
        ? 'APPLICANT_FLOW_EXISTS' as const
        : 'CLAIM_FAILED' as const,
      status: 409,
    }
  }

  return {
    state: 'CLAIMED' as const,
    status: 200,
    profile: leadProfile(context.salesLead),
    salesLeadId: context.salesLeadId,
  }
}

async function applyForStore(applicant: TelegramApplicant, body: OpenBody) {
  // Preserve HTTP idempotency before consuming a rate-limit slot. The
  // transaction and partial unique index below remain authoritative for races.
  const idempotentPending = await prisma.storeApplication.findFirst({
    where: { telegramId: applicant.telegramId, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, salesLeadId: true },
  })
  if (idempotentPending) {
    return {
      state: 'PENDING' as const,
      status: 200,
      applicationNo: idempotentPending.id.slice(-8).toUpperCase(),
      salesLeadId: idempotentPending.salesLeadId,
    }
  }

  const storeName = cleanSalesLeadRequiredText(body.storeName)
  const ownerName = cleanSalesLeadRequiredText(body.ownerName)
  const phone = validateSalesLeadPhone(typeof body.phone === 'string' ? body.phone : '')
  const address = cleanStoreAddress(body.address)
  const latitude = cleanStoreCoordinate(body.latitude)
  const longitude = cleanStoreCoordinate(body.longitude)
  if (!storeName || !ownerName || !phone.ok) return { state: 'INVALID_INPUT' as const, status: 400 }
  if (!isValidStoreLat(latitude) || !isValidStoreLng(longitude)) {
    return { state: 'INVALID_LOCATION' as const, status: 400 }
  }

  try {
    const rate = await consumeSalesLeadRateLimit({
      action: 'APPLICATION_SUBMIT',
      scopeType: 'TELEGRAM',
      value: applicant.telegramId,
    })
    if (!rate.allowed) return { state: 'RATE_LIMITED' as const, status: 429, retryAfter: rate.retryAfterSeconds }
  } catch {
    return { state: 'RATE_GUARD_UNAVAILABLE' as const, status: 503 }
  }

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${getSalesLeadTelegramAdvisoryKey(applicant.telegramId)})`

      if (await activeMerchantUser(applicant.telegramId, tx)) {
        return { state: 'ALREADY_BOUND' as const, status: 409 }
      }
      const pending = await tx.storeApplication.findFirst({
        where: { telegramId: applicant.telegramId, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, salesLeadId: true },
      })
      if (pending) {
        return {
          state: 'PENDING' as const,
          status: 200,
          applicationNo: pending.id.slice(-8).toUpperCase(),
          salesLeadId: pending.salesLeadId,
        }
      }
      if (await activeApplicationBlock(applicant.telegramId, tx)) {
        return { state: 'BLOCKED' as const, status: 403 }
      }

      let lead = await tx.salesLead.findFirst({
        where: { telegramId: applicant.telegramId, status: { in: [...IN_FLIGHT_STATUSES] } },
        orderBy: { lastActivityAt: 'desc' },
      })
      const now = new Date()
      if (lead) {
        if (!salesLeadPhonesMatch(phone.normalizedPhone, lead.normalizedPhone)) {
          return { state: 'INVALID_INPUT' as const, status: 400 }
        }
        lead = await tx.salesLead.update({
          where: { id: lead.id },
          data: {
            storeName,
            ownerName,
            address: address ?? null,
            latitude: latitude ?? null,
            longitude: longitude ?? null,
            telegramUsername: applicant.username,
            telegramFirstName: applicant.firstName,
            telegramLastName: applicant.lastName,
            status: 'APPLIED',
            lastActivityAt: now,
          },
        })
      } else {
        lead = await tx.salesLead.create({
          data: {
            storeName,
            ownerName,
            normalizedPhone: phone.normalizedPhone,
            address: address ?? null,
            latitude: latitude ?? null,
            longitude: longitude ?? null,
            firstSourceChannel: 'DIRECT_TELEGRAM',
            telegramId: applicant.telegramId,
            telegramUsername: applicant.username,
            telegramFirstName: applicant.firstName,
            telegramLastName: applicant.lastName,
            telegramBoundAt: now,
            status: 'APPLIED',
            lastActivityAt: now,
          },
        })
      }

      const application = await tx.storeApplication.create({
        data: {
          storeName: lead.storeName,
          ownerName: lead.ownerName,
          telegramId: applicant.telegramId,
          telegramUsername: applicant.username,
          status: 'PENDING',
          salesLeadId: lead.id,
        },
        select: { id: true },
      })
      return {
        state: 'PENDING' as const,
        status: 201,
        applicationNo: application.id.slice(-8).toUpperCase(),
        salesLeadId: lead.id,
      }
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const pending = await prisma.storeApplication.findFirst({
        where: { telegramId: applicant.telegramId, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, salesLeadId: true },
      })
      if (pending) return {
        state: 'PENDING' as const,
        status: 200,
        applicationNo: pending.id.slice(-8).toUpperCase(),
        salesLeadId: pending.salesLeadId,
      }
    }
    console.error('[/api/open] application transaction failed', error instanceof Prisma.PrismaClientKnownRequestError ? error.code : 'UNKNOWN')
    return { state: 'DB_ERROR' as const, status: 500 }
  }
}

export async function GET() {
  return NextResponse.json({ support: getPlatformSupportConfig() })
}

export async function POST(req: NextRequest) {
  const support = getPlatformSupportConfig()
  let body: OpenBody
  try {
    body = await req.json() as OpenBody
  } catch {
    return NextResponse.json({ error: 'INVALID_INPUT', support }, { status: 400 })
  }

  const verified = verifyApplicant(body.initData)
  if (!verified.applicant) {
    const status = verified.error === 'TELEGRAM_CONFIG_UNAVAILABLE' ? 503 : 401
    return NextResponse.json({ error: verified.error, support }, { status })
  }

  if (body.action === 'STATUS') {
    const result = await statusForApplicant(verified.applicant)
    const contextualSupport = await getLeadSupportConfig({
      salesLeadId: 'salesLeadId' in result ? result.salesLeadId : null,
      contextStage: result.state === 'PENDING' ? 'APPLICATION_PENDING' : 'OPEN',
    })
    const { salesLeadId: _salesLeadId, ...publicResult } = 'salesLeadId' in result
      ? result
      : { ...result, salesLeadId: null }
    return NextResponse.json({ ...publicResult, support: contextualSupport })
  }
  if (body.action === 'CLAIM') {
    const result = await claimAttributedLead(verified.applicant, body)
    const contextualSupport = await getLeadSupportConfig({
      salesLeadId: 'salesLeadId' in result ? result.salesLeadId : null,
      contextStage: 'OPEN',
    })
    return NextResponse.json(
      { state: result.state, profile: 'profile' in result ? result.profile : undefined, support: contextualSupport },
      {
        status: result.status,
        headers: 'retryAfter' in result ? { 'Retry-After': String(result.retryAfter) } : undefined,
      },
    )
  }
  if (body.action === 'APPLY' || body.action == null) {
    const result = await applyForStore(verified.applicant, body)
    const contextualSupport = await getLeadSupportConfig({
      salesLeadId: 'salesLeadId' in result ? result.salesLeadId : null,
      contextStage: result.state === 'PENDING' ? 'APPLICATION_PENDING' : 'OPEN',
    })
    return NextResponse.json(
      {
        ok: result.state === 'PENDING',
        state: result.state,
        applicationNo: 'applicationNo' in result ? result.applicationNo : undefined,
        support: contextualSupport,
      },
      {
        status: result.status,
        headers: 'retryAfter' in result ? { 'Retry-After': String(result.retryAfter) } : undefined,
      },
    )
  }
  return NextResponse.json({ error: 'INVALID_ACTION', support }, { status: 400 })
}
