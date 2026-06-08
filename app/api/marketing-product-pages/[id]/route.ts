import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

const STATUS_VALUES = ['DRAFT', 'PUBLISHED', 'DISABLED'] as const
type PageStatus = typeof STATUS_VALUES[number]

const PAGE_SELECT = {
  id: true, productId: true, slug: true, status: true,
  title: true, titleZh: true, titleEn: true, titleKm: true,
  subtitle: true, heroImageUrl: true,
  salePrice: true, originalPrice: true, soldCount: true,
  feature1: true, feature2: true, feature3: true, feature4: true, feature5: true,
  feature1Zh: true, feature2Zh: true, feature3Zh: true, feature4Zh: true, feature5Zh: true,
  feature1En: true, feature2En: true, feature3En: true, feature4En: true, feature5En: true,
  feature1Km: true, feature2Km: true, feature3Km: true, feature4Km: true, feature5Km: true,
  enableCountdown: true,
  detailImage1: true, detailImage2: true, detailImage3: true,
  reviewImage1: true, reviewImage2: true, reviewImage3: true,
  buttonText: true, buttonTextZh: true, buttonTextEn: true, buttonTextKm: true,
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
  titleZh: string | null
  titleEn: string | null
  titleKm: string | null
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
  feature1Zh: string | null
  feature2Zh: string | null
  feature3Zh: string | null
  feature4Zh: string | null
  feature5Zh: string | null
  feature1En: string | null
  feature2En: string | null
  feature3En: string | null
  feature4En: string | null
  feature5En: string | null
  feature1Km: string | null
  feature2Km: string | null
  feature3Km: string | null
  feature4Km: string | null
  feature5Km: string | null
  enableCountdown: boolean
  detailImage1: string | null
  detailImage2: string | null
  detailImage3: string | null
  reviewImage1: string | null
  reviewImage2: string | null
  reviewImage3: string | null
  buttonText: string | null
  buttonTextZh: string | null
  buttonTextEn: string | null
  buttonTextKm: string | null
}) {
  return {
    id: p.id,
    productId: p.productId,
    slug: p.slug,
    status: p.status,
    title: p.title,
    titleZh: p.titleZh,
    titleEn: p.titleEn,
    titleKm: p.titleKm,
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
    feature1Zh: p.feature1Zh,
    feature2Zh: p.feature2Zh,
    feature3Zh: p.feature3Zh,
    feature4Zh: p.feature4Zh,
    feature5Zh: p.feature5Zh,
    feature1En: p.feature1En,
    feature2En: p.feature2En,
    feature3En: p.feature3En,
    feature4En: p.feature4En,
    feature5En: p.feature5En,
    feature1Km: p.feature1Km,
    feature2Km: p.feature2Km,
    feature3Km: p.feature3Km,
    feature4Km: p.feature4Km,
    feature5Km: p.feature5Km,
    enableCountdown: p.enableCountdown,
    detailImage1: p.detailImage1,
    detailImage2: p.detailImage2,
    detailImage3: p.detailImage3,
    reviewImage1: p.reviewImage1,
    reviewImage2: p.reviewImage2,
    reviewImage3: p.reviewImage3,
    buttonText: p.buttonText,
    buttonTextZh: p.buttonTextZh,
    buttonTextEn: p.buttonTextEn,
    buttonTextKm: p.buttonTextKm,
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
    titleZh?: string | null
    titleEn?: string | null
    titleKm?: string | null
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
    feature1Zh?: string | null
    feature2Zh?: string | null
    feature3Zh?: string | null
    feature4Zh?: string | null
    feature5Zh?: string | null
    feature1En?: string | null
    feature2En?: string | null
    feature3En?: string | null
    feature4En?: string | null
    feature5En?: string | null
    feature1Km?: string | null
    feature2Km?: string | null
    feature3Km?: string | null
    feature4Km?: string | null
    feature5Km?: string | null
    enableCountdown?: boolean
    detailImage1?: string | null
    detailImage2?: string | null
    detailImage3?: string | null
    reviewImage1?: string | null
    reviewImage2?: string | null
    reviewImage3?: string | null
    buttonText?: string | null
    buttonTextZh?: string | null
    buttonTextEn?: string | null
    buttonTextKm?: string | null
  }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const data: {
    slug?: string
    status?: PageStatus
    title?: string | null
    titleZh?: string | null
    titleEn?: string | null
    titleKm?: string | null
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
    feature1Zh?: string | null
    feature2Zh?: string | null
    feature3Zh?: string | null
    feature4Zh?: string | null
    feature5Zh?: string | null
    feature1En?: string | null
    feature2En?: string | null
    feature3En?: string | null
    feature4En?: string | null
    feature5En?: string | null
    feature1Km?: string | null
    feature2Km?: string | null
    feature3Km?: string | null
    feature4Km?: string | null
    feature5Km?: string | null
    enableCountdown?: boolean
    detailImage1?: string | null
    detailImage2?: string | null
    detailImage3?: string | null
    reviewImage1?: string | null
    reviewImage2?: string | null
    reviewImage3?: string | null
    buttonText?: string | null
    buttonTextZh?: string | null
    buttonTextEn?: string | null
    buttonTextKm?: string | null
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
  if (body.titleZh !== undefined) data.titleZh = body.titleZh?.trim() || null
  if (body.titleEn !== undefined) data.titleEn = body.titleEn?.trim() || null
  if (body.titleKm !== undefined) data.titleKm = body.titleKm?.trim() || null
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
  if (body.feature1Zh !== undefined) data.feature1Zh = body.feature1Zh?.trim() || null
  if (body.feature2Zh !== undefined) data.feature2Zh = body.feature2Zh?.trim() || null
  if (body.feature3Zh !== undefined) data.feature3Zh = body.feature3Zh?.trim() || null
  if (body.feature4Zh !== undefined) data.feature4Zh = body.feature4Zh?.trim() || null
  if (body.feature5Zh !== undefined) data.feature5Zh = body.feature5Zh?.trim() || null
  if (body.feature1En !== undefined) data.feature1En = body.feature1En?.trim() || null
  if (body.feature2En !== undefined) data.feature2En = body.feature2En?.trim() || null
  if (body.feature3En !== undefined) data.feature3En = body.feature3En?.trim() || null
  if (body.feature4En !== undefined) data.feature4En = body.feature4En?.trim() || null
  if (body.feature5En !== undefined) data.feature5En = body.feature5En?.trim() || null
  if (body.feature1Km !== undefined) data.feature1Km = body.feature1Km?.trim() || null
  if (body.feature2Km !== undefined) data.feature2Km = body.feature2Km?.trim() || null
  if (body.feature3Km !== undefined) data.feature3Km = body.feature3Km?.trim() || null
  if (body.feature4Km !== undefined) data.feature4Km = body.feature4Km?.trim() || null
  if (body.feature5Km !== undefined) data.feature5Km = body.feature5Km?.trim() || null
  if (body.enableCountdown !== undefined) data.enableCountdown = !!body.enableCountdown
  if (body.detailImage1 !== undefined) data.detailImage1 = body.detailImage1?.trim() || null
  if (body.detailImage2 !== undefined) data.detailImage2 = body.detailImage2?.trim() || null
  if (body.detailImage3 !== undefined) data.detailImage3 = body.detailImage3?.trim() || null
  if (body.reviewImage1 !== undefined) data.reviewImage1 = body.reviewImage1?.trim() || null
  if (body.reviewImage2 !== undefined) data.reviewImage2 = body.reviewImage2?.trim() || null
  if (body.reviewImage3 !== undefined) data.reviewImage3 = body.reviewImage3?.trim() || null
  if (body.buttonText !== undefined) data.buttonText = body.buttonText?.trim() || null
  if (body.buttonTextZh !== undefined) data.buttonTextZh = body.buttonTextZh?.trim() || null
  if (body.buttonTextEn !== undefined) data.buttonTextEn = body.buttonTextEn?.trim() || null
  if (body.buttonTextKm !== undefined) data.buttonTextKm = body.buttonTextKm?.trim() || null

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
