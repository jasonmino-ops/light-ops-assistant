import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { cleanContactValue, isValidContactPhone, isValidContactTelegram, isValidContactWhatsApp } from '@/lib/store-contact'
import {
  STORE_CONTACT_SCHEMA_UPGRADE_MESSAGE,
  getStoreContactById,
  isStoreContactSchemaUpgradeRequiredError,
  updateStoreContactById,
} from '@/lib/store-contact-db'

/**
 * PATCH /api/stores/:id/menu-config
 * body: { bannerUrl?, announcement?, promoText?, contactPhone?, contactTelegram?, contactWhatsApp? }
 *
 * 保存门店顾客页展示配置，仅 OWNER 可操作。
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const { id: storeId } = await params

  const store = await prisma.store.findFirst({
    where: { id: storeId, tenantId: ctx.tenantId },
    select: { id: true },
  })
  if (!store) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })

  const contactData: { contactPhone?: string | null; contactTelegram?: string | null; contactWhatsApp?: string | null } = {}
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

  const displayData = {
    bannerUrl:    typeof body.bannerUrl    === 'string' ? body.bannerUrl.trim()    || null : undefined,
    announcement: typeof body.announcement === 'string' ? body.announcement.trim() || null : undefined,
    promoText:    typeof body.promoText    === 'string' ? body.promoText.trim()    || null : undefined,
  }
  const hasDisplayData = Object.values(displayData).some((value) => value !== undefined)
  const hasContactData = contactData.contactPhone !== undefined ||
    contactData.contactTelegram !== undefined ||
    contactData.contactWhatsApp !== undefined
  let contact
  try {
    contact = hasContactData
      ? await updateStoreContactById(storeId, contactData)
      : await getStoreContactById(storeId)
  } catch (error) {
    if (isStoreContactSchemaUpgradeRequiredError(error)) {
      return NextResponse.json({
        error: 'STORE_CONTACT_SCHEMA_UPGRADE_REQUIRED',
        message: STORE_CONTACT_SCHEMA_UPGRADE_MESSAGE,
      }, { status: 503 })
    }
    throw error
  }

  const updated = hasDisplayData
    ? await prisma.store.update({
      where: { id: storeId },
      data: displayData,
      select: {
        id: true,
        bannerUrl: true,
        announcement: true,
        promoText: true,
      },
    })
    : await prisma.store.findUniqueOrThrow({
      where: { id: storeId },
      select: {
        id: true,
        bannerUrl: true,
        announcement: true,
        promoText: true,
      },
    })

  return NextResponse.json({ ...updated, ...contact })
}
