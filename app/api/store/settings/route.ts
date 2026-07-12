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
      checkoutMode: true,
      currencyCode: true,
      contactPhone: true,
      contactTelegram: true,
      contactWhatsApp: true,
    },
  })
  if (!store) return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })

  return NextResponse.json({
    storeId:      store.id,
    storeCode:    store.code,
    storeName:    store.name,
    businessType: store.businessType,
    checkoutMode: store.checkoutMode,
    currencyCode: store.currencyCode,
    contactPhone: store.contactPhone,
    contactTelegram: store.contactTelegram,
    contactWhatsApp: store.contactWhatsApp,
  })
}

export async function PATCH(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') {
    return NextResponse.json({ error: 'FORBIDDEN', message: '只有老板可以修改店铺类型' }, { status: 403 })
  }

  let body: { businessType?: string; currencyCode?: string; contactPhone?: string; contactTelegram?: string; contactWhatsApp?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 }) }

  const data: { businessType?: BizType; currencyCode?: string; contactPhone?: string | null; contactTelegram?: string | null; contactWhatsApp?: string | null } = {}
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
  if (body.contactPhone !== undefined) {
    const next = cleanContactValue(body.contactPhone)
    if (next === undefined || !isValidContactPhone(next)) {
      return NextResponse.json({ error: 'INVALID_CONTACT_FIELD', field: 'contactPhone' }, { status: 400 })
    }
    data.contactPhone = next
  }
  if (body.contactTelegram !== undefined) {
    const next = cleanContactValue(body.contactTelegram)
    if (next === undefined || !isValidContactTelegram(next)) {
      return NextResponse.json({ error: 'INVALID_CONTACT_FIELD', field: 'contactTelegram' }, { status: 400 })
    }
    data.contactTelegram = next
  }
  if (body.contactWhatsApp !== undefined) {
    const next = cleanContactValue(body.contactWhatsApp)
    if (next === undefined || !isValidContactWhatsApp(next)) {
      return NextResponse.json({ error: 'INVALID_CONTACT_FIELD', field: 'contactWhatsApp' }, { status: 400 })
    }
    data.contactWhatsApp = next
  }
  if (
    !data.businessType &&
    !data.currencyCode &&
    data.contactPhone === undefined &&
    data.contactTelegram === undefined &&
    data.contactWhatsApp === undefined
  ) {
    return NextResponse.json({ error: 'NO_CHANGES' }, { status: 400 })
  }

  const store = await prisma.store.findFirst({
    where:  { id: ctx.storeId, tenantId: ctx.tenantId },
    select: { id: true },
  })
  if (!store) return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })

  const updated = await prisma.store.update({
    where: { id: store.id },
    data,
    select: { id: true, businessType: true, currencyCode: true, contactPhone: true, contactTelegram: true, contactWhatsApp: true },
  })

  return NextResponse.json({
    ok: true,
    businessType: updated.businessType,
    currencyCode: updated.currencyCode,
    contactPhone: updated.contactPhone,
    contactTelegram: updated.contactTelegram,
    contactWhatsApp: updated.contactWhatsApp,
  })
}
