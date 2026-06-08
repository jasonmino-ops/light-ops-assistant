import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params

  const page = await prisma.marketingProductPage.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      title: true,
      subtitle: true,
      heroImageUrl: true,
      salePrice: true,
      originalPrice: true,
      soldCount: true,
      feature1: true,
      feature2: true,
      feature3: true,
      feature4: true,
      feature5: true,
      enableCountdown: true,
      detailImage1: true,
      detailImage2: true,
      detailImage3: true,
      reviewImage1: true,
      reviewImage2: true,
      reviewImage3: true,
      buttonText: true,
      status: true,
      store: {
        select: { id: true, code: true, name: true, status: true },
      },
      product: {
        select: { id: true, name: true, spec: true, sellPrice: true, status: true, imageUrl: true },
      },
    },
  })

  if (!page || page.status !== 'PUBLISHED' || page.store.status !== 'ACTIVE' || page.product.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }

  return NextResponse.json({
    slug: page.slug,
    title: page.title || page.product.name,
    subtitle: page.subtitle,
    heroImageUrl: page.heroImageUrl || page.product.imageUrl,
    salePrice: page.salePrice ? page.salePrice.toNumber() : null,
    originalPrice: page.originalPrice ? page.originalPrice.toNumber() : null,
    soldCount: page.soldCount,
    features: [page.feature1, page.feature2, page.feature3, page.feature4, page.feature5].filter(Boolean),
    enableCountdown: page.enableCountdown,
    detailImages: [page.detailImage1, page.detailImage2, page.detailImage3].filter(Boolean),
    reviewImages: [page.reviewImage1, page.reviewImage2, page.reviewImage3].filter(Boolean),
    buttonText: page.buttonText || '立即下单',
    store: {
      code: page.store.code,
      name: page.store.name,
    },
    product: {
      id: page.product.id,
      name: page.product.name,
      spec: page.product.spec,
      price: page.product.sellPrice.toNumber(),
      imageUrl: page.product.imageUrl,
    },
  })
}
