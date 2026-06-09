import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { ruleMarketingPageGenerator } from '@/lib/marketing-page-generator'

const STATUS_VALUES = ['DRAFT', 'PUBLISHED', 'DISABLED'] as const
type PageStatus = typeof STATUS_VALUES[number]
const TEMPLATE_VALUES = ['TIKTOK_HOT', 'HOME_GOODS', 'FOOD_SET', 'BEAUTY'] as const
type TemplateType = typeof TEMPLATE_VALUES[number]

const PAGE_SELECT = {
  id: true, productId: true, slug: true, status: true, templateType: true,
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
  templateType: TemplateType | null
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
    templateType: p.templateType ?? 'TIKTOK_HOT',
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

  let body: { productId?: string; mode?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const productId = body.productId?.trim()
  if (!productId) return NextResponse.json({ error: 'MISSING_PRODUCT_ID' }, { status: 400 })

  const product = await prisma.product.findFirst({
    where: { id: productId, tenantId: ctx.tenantId },
    select: { id: true, name: true, barcode: true, imageUrl: true, sellPrice: true },
  })
  if (!product) return NextResponse.json({ error: 'PRODUCT_NOT_FOUND' }, { status: 404 })

  const existing = await prisma.marketingProductPage.findFirst({
    where: { tenantId: ctx.tenantId, storeId: ctx.storeId, productId },
    select: PAGE_SELECT,
  })
  const generated = body.mode === 'RULE_GENERATE'
    ? ruleMarketingPageGenerator.generate(product)
    : null
  if (existing) {
    if (!generated) return NextResponse.json(mapPage(existing))

    const updated = await prisma.marketingProductPage.update({
      where: { id: existing.id },
      data: {
        title: generated.title,
        subtitle: generated.subtitle,
        salePrice: generated.salePrice,
        originalPrice: generated.originalPrice,
        soldCount: generated.soldCount,
        feature1: generated.features[0],
        feature2: generated.features[1],
        feature3: generated.features[2],
        feature4: generated.features[3],
        feature5: generated.features[4],
        buttonText: generated.buttonText,
      },
      select: PAGE_SELECT,
    })
    return NextResponse.json(mapPage(updated))
  }

  const slug = await uniqueSlug(`${product.name}-${product.barcode}`)
  const created = await prisma.marketingProductPage.create({
    data: {
      tenantId: ctx.tenantId,
      storeId: ctx.storeId,
      productId,
      slug,
      status: 'DRAFT',
      templateType: generated ? 'TIKTOK_HOT' : undefined,
      title: generated?.title ?? product.name,
      subtitle: generated?.subtitle ?? null,
      heroImageUrl: product.imageUrl,
      salePrice: generated?.salePrice,
      originalPrice: generated?.originalPrice,
      soldCount: generated?.soldCount,
      feature1: generated?.features[0],
      feature2: generated?.features[1],
      feature3: generated?.features[2],
      feature4: generated?.features[3],
      feature5: generated?.features[4],
      buttonText: generated?.buttonText ?? '立即下单',
    },
    select: PAGE_SELECT,
  })

  return NextResponse.json(mapPage(created), { status: 201 })
}
