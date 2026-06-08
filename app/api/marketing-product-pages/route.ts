import { NextRequest, NextResponse } from 'next/server'
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

async function uniqueSlug(base: string): Promise<string> {
  let slug = cleanSlug(base) || `p-${Math.random().toString(36).slice(2, 8)}`
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? slug : `${slug}-${i + 1}`
    const exists = await prisma.marketingProductPage.findUnique({
      where: { slug: candidate },
      select: { id: true },
    })
    if (!exists) return candidate
  }
  return `${slug}-${Date.now().toString(36)}`
}

export async function GET(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  if (!ctx.storeId) return NextResponse.json({ error: 'NO_STORE' }, { status: 400 })

  const productId = req.nextUrl.searchParams.get('productId')?.trim()
  const pages = await prisma.marketingProductPage.findMany({
    where: {
      tenantId: ctx.tenantId,
      storeId: ctx.storeId,
      ...(productId ? { productId } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    take: 500,
    select: PAGE_SELECT,
  })

  return NextResponse.json({ pages: pages.map(mapPage) })
}

export async function POST(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  if (!ctx.storeId) return NextResponse.json({ error: 'NO_STORE' }, { status: 400 })

  let body: { productId?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const productId = body.productId?.trim()
  if (!productId) return NextResponse.json({ error: 'MISSING_PRODUCT_ID' }, { status: 400 })

  const product = await prisma.product.findFirst({
    where: { id: productId, tenantId: ctx.tenantId },
    select: { id: true, name: true, barcode: true, imageUrl: true },
  })
  if (!product) return NextResponse.json({ error: 'PRODUCT_NOT_FOUND' }, { status: 404 })

  const existing = await prisma.marketingProductPage.findFirst({
    where: { tenantId: ctx.tenantId, storeId: ctx.storeId, productId },
    select: PAGE_SELECT,
  })
  if (existing) return NextResponse.json(mapPage(existing))

  const slug = await uniqueSlug(`${product.name}-${product.barcode}`)
  const created = await prisma.marketingProductPage.create({
    data: {
      tenantId: ctx.tenantId,
      storeId: ctx.storeId,
      productId,
      slug,
      status: 'DRAFT',
      title: product.name,
      subtitle: null,
      heroImageUrl: product.imageUrl,
      buttonText: '立即下单',
    },
    select: PAGE_SELECT,
  })

  return NextResponse.json(mapPage(created), { status: 201 })
}
