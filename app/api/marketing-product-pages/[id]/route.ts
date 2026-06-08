import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

const STATUS_VALUES = ['DRAFT', 'PUBLISHED', 'DISABLED'] as const
type PageStatus = typeof STATUS_VALUES[number]

const PAGE_SELECT = {
  id: true, productId: true, slug: true, status: true,
  title: true, subtitle: true, heroImageUrl: true,
  salePrice: true, originalPrice: true, soldCount: true,
  feature1: true, feature2: true, feature3: true, feature4: true, feature5: true,
  enableCountdown: true,
  detailImage1: true, detailImage2: true, detailImage3: true,
  reviewImage1: true, reviewImage2: true, reviewImage3: true,
  buttonText: true,
} as const

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
  salePrice: { toNumber(): number } | null
  originalPrice: { toNumber(): number } | null
  soldCount: number | null
  feature1: string | null
  feature2: string | null
  feature3: string | null
  feature4: string | null
  feature5: string | null
  enableCountdown: boolean
  detailImage1: string | null
  detailImage2: string | null
  detailImage3: string | null
  reviewImage1: string | null
  reviewImage2: string | null
  reviewImage3: string | null
  buttonText: string | null
}) {
  return {
    id: p.id,
    productId: p.productId,
    slug: p.slug,
    status: p.status,
    title: p.title,
    subtitle: p.subtitle,
    heroImageUrl: p.heroImageUrl,
    salePrice: p.salePrice ? p.salePrice.toNumber() : null,
    originalPrice: p.originalPrice ? p.originalPrice.toNumber() : null,
    soldCount: p.soldCount,
    feature1: p.feature1,
    feature2: p.feature2,
    feature3: p.feature3,
    feature4: p.feature4,
    feature5: p.feature5,
    enableCountdown: p.enableCountdown,
    detailImage1: p.detailImage1,
    detailImage2: p.detailImage2,
    detailImage3: p.detailImage3,
    reviewImage1: p.reviewImage1,
    reviewImage2: p.reviewImage2,
    reviewImage3: p.reviewImage3,
    buttonText: p.buttonText,
  }
}

function optionalMoney(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n.toFixed(2) : null
}

function optionalInt(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isInteger(n) && n >= 0 ? n : null
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
    salePrice?: number | string | null
    originalPrice?: number | string | null
    soldCount?: number | string | null
    feature1?: string | null
    feature2?: string | null
    feature3?: string | null
    feature4?: string | null
    feature5?: string | null
    enableCountdown?: boolean
    detailImage1?: string | null
    detailImage2?: string | null
    detailImage3?: string | null
    reviewImage1?: string | null
    reviewImage2?: string | null
    reviewImage3?: string | null
    buttonText?: string | null
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
    salePrice?: string | null
    originalPrice?: string | null
    soldCount?: number | null
    feature1?: string | null
    feature2?: string | null
    feature3?: string | null
    feature4?: string | null
    feature5?: string | null
    enableCountdown?: boolean
    detailImage1?: string | null
    detailImage2?: string | null
    detailImage3?: string | null
    reviewImage1?: string | null
    reviewImage2?: string | null
    reviewImage3?: string | null
    buttonText?: string | null
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
  if (body.salePrice !== undefined) data.salePrice = optionalMoney(body.salePrice)
  if (body.originalPrice !== undefined) data.originalPrice = optionalMoney(body.originalPrice)
  if (body.soldCount !== undefined) data.soldCount = optionalInt(body.soldCount)
  if (body.feature1 !== undefined) data.feature1 = body.feature1?.trim() || null
  if (body.feature2 !== undefined) data.feature2 = body.feature2?.trim() || null
  if (body.feature3 !== undefined) data.feature3 = body.feature3?.trim() || null
  if (body.feature4 !== undefined) data.feature4 = body.feature4?.trim() || null
  if (body.feature5 !== undefined) data.feature5 = body.feature5?.trim() || null
  if (body.enableCountdown !== undefined) data.enableCountdown = !!body.enableCountdown
  if (body.detailImage1 !== undefined) data.detailImage1 = body.detailImage1?.trim() || null
  if (body.detailImage2 !== undefined) data.detailImage2 = body.detailImage2?.trim() || null
  if (body.detailImage3 !== undefined) data.detailImage3 = body.detailImage3?.trim() || null
  if (body.reviewImage1 !== undefined) data.reviewImage1 = body.reviewImage1?.trim() || null
  if (body.reviewImage2 !== undefined) data.reviewImage2 = body.reviewImage2?.trim() || null
  if (body.reviewImage3 !== undefined) data.reviewImage3 = body.reviewImage3?.trim() || null
  if (body.buttonText !== undefined) data.buttonText = body.buttonText?.trim() || null

  try {
    const updated = await prisma.marketingProductPage.update({
      where: { id, tenantId: ctx.tenantId, storeId: ctx.storeId },
      data,
      select: PAGE_SELECT,
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
