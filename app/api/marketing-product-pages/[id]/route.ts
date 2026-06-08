import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

const STATUS_VALUES = ['DRAFT', 'PUBLISHED', 'DISABLED'] as const
type PageStatus = typeof STATUS_VALUES[number]

function cleanSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function mapPage(p: {
  id: string
  productId: string
  slug: string
  status: PageStatus
  title: string | null
  subtitle: string | null
  heroImageUrl: string | null
}) {
  return {
    id: p.id,
    productId: p.productId,
    slug: p.slug,
    status: p.status,
    title: p.title,
    subtitle: p.subtitle,
    heroImageUrl: p.heroImageUrl,
  }
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

  let body: {
    slug?: string
    status?: string
    title?: string | null
    subtitle?: string | null
    heroImageUrl?: string | null
  }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const data: {
    slug?: string
    status?: PageStatus
    title?: string | null
    subtitle?: string | null
    heroImageUrl?: string | null
  } = {}

  if (body.slug !== undefined) {
    const slug = cleanSlug(body.slug)
    if (!slug) return NextResponse.json({ error: 'INVALID_SLUG', message: 'slug 不能为空' }, { status: 400 })
    data.slug = slug
  }
  if (body.status !== undefined) {
    if (!STATUS_VALUES.includes(body.status as PageStatus)) {
      return NextResponse.json({ error: 'INVALID_STATUS' }, { status: 400 })
    }
    data.status = body.status as PageStatus
  }
  if (body.title !== undefined) data.title = body.title?.trim() || null
  if (body.subtitle !== undefined) data.subtitle = body.subtitle?.trim() || null
  if (body.heroImageUrl !== undefined) data.heroImageUrl = body.heroImageUrl?.trim() || null

  try {
    const updated = await prisma.marketingProductPage.update({
      where: { id, tenantId: ctx.tenantId, storeId: ctx.storeId },
      data,
      select: { id: true, productId: true, slug: true, status: true, title: true, subtitle: true, heroImageUrl: true },
    })
    return NextResponse.json(mapPage(updated))
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2025') return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
      if (e.code === 'P2002') return NextResponse.json({ error: 'SLUG_EXISTS', message: 'slug 已被占用' }, { status: 409 })
    }
    throw e
  }
}
