/**
 * PATCH /api/campaign-links/[id] — 更新推广短链落地页（OWNER）
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

async function resolveTargetUrl(rawTargetUrl: unknown, ctx: { tenantId: string; storeId: string }): Promise<string> {
  if (typeof rawTargetUrl !== 'string') return ''
  const targetUrl = rawTargetUrl.trim()
  if (!targetUrl.startsWith('/p/')) return ''

  const slug = targetUrl.slice(3).split(/[?#]/)[0]?.trim()
  if (!slug) return ''

  const page = await prisma.marketingProductPage.findFirst({
    where: {
      tenantId: ctx.tenantId,
      storeId: ctx.storeId,
      slug,
      status: 'PUBLISHED',
    },
    select: { slug: true },
  })

  return page ? `/p/${page.slug}` : ''
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  if (!ctx.storeId) return NextResponse.json({ error: 'NO_STORE' }, { status: 400 })

  const { id } = await params
  let body: { targetUrl?: string } = {}
  try { body = await req.json() } catch { /* empty body means menu page */ }

  const link = await prisma.campaignLink.findUnique({
    where: { id },
    select: { id: true, storeId: true },
  })
  if (!link) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  if (link.storeId !== ctx.storeId) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const targetUrl = await resolveTargetUrl(body.targetUrl, { tenantId: ctx.tenantId, storeId: ctx.storeId })
  const updated = await prisma.campaignLink.update({
    where: { id },
    data: { targetUrl },
    select: { id: true, targetUrl: true },
  })

  return NextResponse.json(updated)
}
