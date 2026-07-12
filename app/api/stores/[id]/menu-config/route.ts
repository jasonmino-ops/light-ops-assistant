import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { cleanContactValue, isValidContactPhone, isValidContactTelegram, isValidContactWhatsApp } from '@/lib/store-contact'

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

  const updated = await prisma.store.update({
    where: { id: storeId },
    data: {
      bannerUrl:    typeof body.bannerUrl    === 'string' ? body.bannerUrl.trim()    || null : undefined,
      announcement: typeof body.announcement === 'string' ? body.announcement.trim() || null : undefined,
      promoText:    typeof body.promoText    === 'string' ? body.promoText.trim()    || null : undefined,
      ...contactData,
    },
    select: {
      id: true,
      bannerUrl: true,
      announcement: true,
      promoText: true,
      contactPhone: true,
      contactTelegram: true,
      contactWhatsApp: true,
    },
  })

  return NextResponse.json(updated)
}
