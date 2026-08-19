import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  cleanStoreAddress,
  cleanStoreCoordinate,
  isValidStoreLat,
  isValidStoreLng,
} from '@/lib/store-location'
import { buildTelegramStartAppLink, normalizeTelegramBotUsername } from '@/lib/telegram-link'
import { normalizeAcquisitionInviteCode } from '@/lib/sales-lead-invite'
import { validateSalesLeadPhone } from '@/lib/sales-lead-phone'
import { consumeSalesLeadRateLimit, getTrustedSalesLeadIpSignal } from '@/lib/sales-lead-rate'
import { cleanSalesLeadRequiredText, createOrRestorePublicSalesLead } from '@/lib/sales-lead-service'
import { getLeadSupportConfig, getPlatformSupportConfig } from '@/lib/sales-lead-support'

type LeadBody = {
  inviteCode?: unknown
  storeName?: unknown
  ownerName?: unknown
  phone?: unknown
  address?: unknown
  latitude?: unknown
  longitude?: unknown
}

async function checkLeadSubmitRates(req: NextRequest, phone: string, inviteCode: string) {
  const checks = [
    consumeSalesLeadRateLimit({ action: 'LEAD_SUBMIT', scopeType: 'PHONE', value: phone }),
    consumeSalesLeadRateLimit({ action: 'LEAD_SUBMIT', scopeType: 'INVITE', value: inviteCode }),
  ]
  const ip = getTrustedSalesLeadIpSignal(req.headers)
  if (ip) checks.push(consumeSalesLeadRateLimit({ action: 'LEAD_SUBMIT', scopeType: 'IP', value: ip }))
  const results = await Promise.all(checks)
  return results.find((result) => !result.allowed) ?? null
}

export async function POST(req: NextRequest) {
  const support = await getPlatformSupportConfig()
  let body: LeadBody
  try {
    body = await req.json() as LeadBody
  } catch {
    return NextResponse.json({ error: 'INVALID_INPUT', support }, { status: 400 })
  }

  const inviteCode = normalizeAcquisitionInviteCode(
    typeof body.inviteCode === 'string' ? body.inviteCode : '',
  )
  const storeName = cleanSalesLeadRequiredText(body.storeName)
  const ownerName = cleanSalesLeadRequiredText(body.ownerName)
  const phone = validateSalesLeadPhone(typeof body.phone === 'string' ? body.phone : '')
  const address = cleanStoreAddress(body.address)
  const latitude = cleanStoreCoordinate(body.latitude)
  const longitude = cleanStoreCoordinate(body.longitude)

  if (!inviteCode || !storeName || !ownerName || !phone.ok) {
    return NextResponse.json({ error: 'INVALID_INPUT', support }, { status: 400 })
  }
  if (!isValidStoreLat(latitude) || !isValidStoreLng(longitude)) {
    return NextResponse.json({ error: 'INVALID_LOCATION', support }, { status: 400 })
  }

  const invite = await prisma.acquisitionInvite.findUnique({ where: { code: inviteCode } })
  if (!invite) return NextResponse.json({ error: 'INVITE_NOT_FOUND', support }, { status: 404 })
  if (invite.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'INVITE_INACTIVE', support }, { status: 409 })
  }

  try {
    const blocked = await checkLeadSubmitRates(req, phone.normalizedPhone, inviteCode)
    if (blocked) {
      return NextResponse.json(
        { error: 'RATE_LIMITED', retryAfterSeconds: blocked.retryAfterSeconds, support },
        { status: 429, headers: { 'Retry-After': String(blocked.retryAfterSeconds) } },
      )
    }
  } catch {
    return NextResponse.json({ error: 'RATE_GUARD_UNAVAILABLE', support }, { status: 503 })
  }

  const result = await createOrRestorePublicSalesLead({
    invite,
    lead: {
      storeName,
      ownerName,
      normalizedPhone: phone.normalizedPhone,
      address: address ?? null,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
    },
  })
  if (result.state === 'READY_FOR_TELEGRAM') {
    const bot = normalizeTelegramBotUsername(
      process.env.TELEGRAM_BOT_USERNAME,
      process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME,
    )
    const contextualSupport = await getLeadSupportConfig({
      salesLeadId: result.salesLeadId,
      contextStage: 'LEAD_FORM',
    })
    return NextResponse.json({
      state: result.created ? 'CREATED' : 'RESTORED',
      telegramUrl: buildTelegramStartAppLink(bot, `open_${result.rawApplicationToken}`),
      support: contextualSupport,
    }, { status: result.created ? 201 : 200 })
  }
  return NextResponse.json({ state: result.state, support })
}
