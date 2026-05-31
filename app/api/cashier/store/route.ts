/**
 * GET /api/cashier/store?storeCode=xxx
 *
 * Public endpoint — no Telegram session required.
 * Returns store name, ACTIVE products, and categories for the desktop cashier.
 * Does NOT return KHQR config, user data, or any sensitive merchant info.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const storeCode = req.nextUrl.searchParams.get('storeCode')?.trim()
  if (!storeCode) {
    return NextResponse.json({ error: 'MISSING_STORE_CODE' }, { status: 400 })
  }

  const store = await prisma.store.findUnique({
    where: { code: storeCode },
    select: { id: true, name: true, tenantId: true, status: true },
  })
  if (!store || store.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })
  }

  const [products, categories] = await Promise.all([
    prisma.product.findMany({
      where: { tenantId: store.tenantId, status: 'ACTIVE' },
      select: { id: true, barcode: true, name: true, spec: true, sellPrice: true, categoryId: true, imageUrl: true },
      orderBy: { name: 'asc' },
      take: 500,
    }),
    prisma.productCategory.findMany({
      where: { tenantId: store.tenantId },
      select: { id: true, name: true, parentId: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
  ])

  return NextResponse.json({
    storeName: store.name,
    products: products.map((p) => ({
      id: p.id,
      barcode: p.barcode,
      name: p.name,
      spec: p.spec,
      sellPrice: p.sellPrice.toNumber(),
      categoryId: p.categoryId,
      imageUrl: p.imageUrl,
    })),
    categories,
  })
}
