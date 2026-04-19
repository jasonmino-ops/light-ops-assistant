import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

/**
 * PATCH /api/stores/:id/menu-config
 * body: { bannerUrl?, announcement?, promoText? }
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

  const updated = await prisma.store.update({
    where: { id: storeId },
    data: {
      bannerUrl:    typeof body.bannerUrl    === 'string' ? body.bannerUrl.trim()    || null : undefined,
      announcement: typeof body.announcement === 'string' ? body.announcement.trim() || null : undefined,
      promoText:    typeof body.promoText    === 'string' ? body.promoText.trim()    || null : undefined,
    },
    select: { id: true, bannerUrl: true, announcement: true, promoText: true },
  })

  return NextResponse.json(updated)
}
