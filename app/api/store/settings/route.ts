/**
 * GET /api/store/settings
 * PATCH /api/store/settings
 *
 * 商户端轻量门店设置接口。本期暴露 businessType（店铺类型）和 currencyCode（门店货币）。
 *
 * 鉴权：
 *   - GET:   登录即可（OWNER / STAFF）
 *   - PATCH: 必须 OWNER；不允许 STAFF 修改
 *
 * 范围：仅作用于 ctx.storeId 对应门店；隔离 tenantId。
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { isSupportedCurrencyCode, normalizeCurrencyCode } from '@/lib/currency'
import { cleanContactValue, isValidContactPhone, isValidContactTelegram, isValidContactWhatsApp } from '@/lib/store-contact'
import {
  STORE_CONTACT_SCHEMA_UPGRADE_MESSAGE,
  getStoreContactById,
  isStoreContactSchemaUpgradeRequiredError,
  updateStoreContactById,
} from '@/lib/store-contact-db'

const VALID_TYPES = ['FOOD', 'RETAIL', 'SERVICE', 'GENERAL'] as const
type BizType = typeof VALID_TYPES[number]

export async function GET(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })

  const store = await prisma.store.findFirst({
    where:  { id: ctx.storeId, tenantId: ctx.tenantId },
    select: {
      id: true,
      code: true,
      name: true,
      businessType: true,
      kitchenTicketEnabled: true,
      checkoutMode: true,
      currencyCode: true,
    },
  })
  if (!store) return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })
  const contact = await getStoreContactById(store.id)

  return NextResponse.json({
    storeId:      store.id,
    storeCode:    store.code,
    storeName:    store.name,
    businessType: store.businessType,
    kitchenTicketEnabled: store.kitchenTicketEnabled,
    checkoutMode: store.checkoutMode,
    currencyCode: store.currencyCode,
    ...contact,
  })
}

export async function PATCH(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') {
    return NextResponse.json({ error: 'FORBIDDEN', message: '只有老板可以修改店铺类型' }, { status: 403 })
  }

  let body: { businessType?: string; kitchenTicketEnabled?: boolean; currencyCode?: string; contactPhone?: string; contactTelegram?: string; contactWhatsApp?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 }) }

  const data: { businessType?: BizType; kitchenTicketEnabled?: boolean; currencyCode?: string } = {}
  const contactData: { contactPhone?: string | null; contactTelegram?: string | null; contactWhatsApp?: string | null } = {}
  if (body.businessType !== undefined) {
    const bt = body.businessType.trim()
    if (!VALID_TYPES.includes(bt as BizType)) {
      return NextResponse.json({ error: 'INVALID_BUSINESS_TYPE' }, { status: 400 })
    }
    data.businessType = bt as BizType
  }
  if (body.currencyCode !== undefined) {
    if (!isSupportedCurrencyCode(body.currencyCode)) {
      return NextResponse.json({ error: 'INVALID_CURRENCY_CODE' }, { status: 400 })
    }
    data.currencyCode = normalizeCurrencyCode(body.currencyCode)
  }
  if (body.kitchenTicketEnabled !== undefined && typeof body.kitchenTicketEnabled !== 'boolean') {
    return NextResponse.json({ error: 'INVALID_KITCHEN_TICKET_ENABLED' }, { status: 400 })
  }
  if (body.contactPhone !== undefined) {
    const next = cleanContactValue(body.contactPhone)
    if (next === undefined || !isValidContactPhone(next)) {
      return NextResponse.json({ error: 'INVALID_CONTACT_FIELD', field: 'contactPhone' }, { status: 400 })
    }
    contactData.contactPhone = next
  }
  if (body.contactTelegram !== undefined) {
    const next = cleanContactValue(body.contactTelegram)
    if (next === undefined || !isValidContactTelegram(next)) {
      return NextResponse.json({ error: 'INVALID_CONTACT_FIELD', field: 'contactTelegram' }, { status: 400 })
    }
    contactData.contactTelegram = next
  }
  if (body.contactWhatsApp !== undefined) {
    const next = cleanContactValue(body.contactWhatsApp)
    if (next === undefined || !isValidContactWhatsApp(next)) {
      return NextResponse.json({ error: 'INVALID_CONTACT_FIELD', field: 'contactWhatsApp' }, { status: 400 })
    }
    contactData.contactWhatsApp = next
  }
  if (
    !data.businessType &&
    !data.currencyCode &&
    body.kitchenTicketEnabled === undefined &&
    contactData.contactPhone === undefined &&
    contactData.contactTelegram === undefined &&
    contactData.contactWhatsApp === undefined
  ) {
    return NextResponse.json({ error: 'NO_CHANGES' }, { status: 400 })
  }

  const store = await prisma.store.findFirst({
    where:  { id: ctx.storeId, tenantId: ctx.tenantId },
    select: { id: true, businessType: true, kitchenTicketEnabled: true, currencyCode: true },
  })
  if (!store) return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })

  const effectiveBusinessType = data.businessType ?? store.businessType
  if (body.kitchenTicketEnabled === true && effectiveBusinessType !== 'FOOD') {
    return NextResponse.json({ error: 'KITCHEN_TICKET_REQUIRES_FOOD_STORE' }, { status: 422 })
  }
  if (body.kitchenTicketEnabled !== undefined) {
    data.kitchenTicketEnabled = body.kitchenTicketEnabled
  }
  // A store changing away from FOOD is always brought back to the safe default.
  if (effectiveBusinessType !== 'FOOD') {
    data.kitchenTicketEnabled = false
  }

  const hasContactData = contactData.contactPhone !== undefined ||
    contactData.contactTelegram !== undefined ||
    contactData.contactWhatsApp !== undefined
  let contact
  try {
    contact = hasContactData
      ? await updateStoreContactById(store.id, contactData)
      : await getStoreContactById(store.id)
  } catch (error) {
    if (isStoreContactSchemaUpgradeRequiredError(error)) {
      return NextResponse.json({
        error: 'STORE_CONTACT_SCHEMA_UPGRADE_REQUIRED',
        message: STORE_CONTACT_SCHEMA_UPGRADE_MESSAGE,
      }, { status: 503 })
    }
    throw error
  }

  const updated = Object.keys(data).length > 0
    ? await prisma.store.update({
      where: { id: store.id },
      data,
      select: { id: true, businessType: true, kitchenTicketEnabled: true, currencyCode: true },
    })
    : store

  return NextResponse.json({
    ok: true,
    businessType: updated.businessType,
    kitchenTicketEnabled: updated.kitchenTicketEnabled,
    currencyCode: updated.currencyCode,
    ...contact,
  })
}
