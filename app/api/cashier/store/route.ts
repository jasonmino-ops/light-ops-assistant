/**
 * GET /api/cashier/store?storeCode=xxx
 *
 * Public endpoint — no Telegram session required.
 * Returns store name, ACTIVE products, and categories for the desktop cashier.
 * Does NOT return KHQR config, user data, or any sensitive merchant info.
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

const CASHIER_PRODUCT_SELECT = {
  id: true,
  barcode: true,
  name: true,
  spec: true,
  sellPrice: true,
  categoryId: true,
  imageUrl: true,
  imageUrls: true,
} satisfies Prisma.ProductSelect

const CASHIER_PRODUCT_LEGACY_SELECT = {
  id: true,
  barcode: true,
  name: true,
  spec: true,
  sellPrice: true,
  categoryId: true,
  imageUrl: true,
} satisfies Prisma.ProductSelect

function parseImageUrls(imageUrls: string | null, imageUrl: string | null): string[] {
  try {
    const parsed = imageUrls ? JSON.parse(imageUrls) : []
    if (Array.isArray(parsed) && parsed.length > 0) return parsed.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, 3)
  } catch {}
  return imageUrl ? [imageUrl] : []
}

function isMissingImageGalleryColumn(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2022') return false
  const text = String(e.message)
  return text.includes('imageUrls') || text.includes('imageStorageKeys') || text.includes('column') || text.includes('does not exist')
}

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

  const productWhere = { tenantId: store.tenantId, status: 'ACTIVE' as const }
  const productsPromise = prisma.product.findMany({
    where: productWhere,
    select: CASHIER_PRODUCT_SELECT,
    orderBy: { name: 'asc' },
    take: 500,
  }).catch(async (e) => {
    if (!isMissingImageGalleryColumn(e)) throw e
    const legacyProducts = await prisma.product.findMany({
      where: productWhere,
      select: CASHIER_PRODUCT_LEGACY_SELECT,
      orderBy: { name: 'asc' },
      take: 500,
    })
    return legacyProducts.map((p) => ({ ...p, imageUrls: null }))
  })

  const [products, categories] = await Promise.all([
    productsPromise,
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
      imageUrls: parseImageUrls(p.imageUrls, p.imageUrl),
    })),
    categories,
  })
}
