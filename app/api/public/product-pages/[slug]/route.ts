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
