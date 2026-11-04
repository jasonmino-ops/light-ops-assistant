/**
 * GET /api/cashier/store?storeCode=xxx
 *
 * Public endpoint — no Telegram session required.
 * Returns store name, ACTIVE products, and categories for the desktop cashier.
 * Does NOT return KHQR config, user data, or any sensitive merchant info.
 */
import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isMultiUnitBusinessType } from '@/lib/product-unit'

const CASHIER_PRODUCT_SELECT = {
  id: true,
  barcode: true,
  sku: true,
  name: true,
  spec: true,
  sellPrice: true,
  mainUnitName: true,
  auxUnitName: true,
  auxBarcode: true,
  auxConversionFactor: true,
  auxSellPrice: true,
  auxEnabled: true,
  categoryId: true,
  imageUrl: true,
  imageUrls: true,
  status: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect

function parseImageUrls(imageUrls: string | null, imageUrl: string | null): string[] {
  try {
    const parsed = imageUrls ? JSON.parse(imageUrls) : []
    if (Array.isArray(parsed) && parsed.length > 0) return parsed.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, 3)
  } catch {}
  return imageUrl ? [imageUrl] : []
}

function isMissingCashierProductColumn(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2022') return false
  const text = String(e.message)
  return text.includes('imageUrls') || text.includes('imageStorageKeys') || text.includes('sku') || text.includes('column') || text.includes('does not exist')
}

export async function GET(req: NextRequest) {
  const storeCode = req.nextUrl.searchParams.get('storeCode')?.trim()
  if (!storeCode) {
    return NextResponse.json({ error: 'MISSING_STORE_CODE' }, { status: 400 })
  }

  const store = await prisma.store.findUnique({
    where: { code: storeCode },
    select: { id: true, name: true, tenantId: true, status: true, currencyCode: true, printKitchenTicket: true, businessType: true },
  })
  if (!store || store.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })
  }

  const productWhere = { tenantId: store.tenantId, status: 'ACTIVE' as const }
  const multiUnit = isMultiUnitBusinessType(store.businessType)
  const paged = req.nextUrl.searchParams.get('catalog') === '1'
  const after = paged ? req.nextUrl.searchParams.get('after') : null
  const lookup = paged ? req.nextUrl.searchParams.get('lookup')?.trim() : null
  const pageSize = 200
  const listOptions = {
    where: {
      ...productWhere,
      ...(lookup ? {
        OR: [
          { barcode: lookup },
          { sku: { equals: lookup, mode: 'insensitive' as const } },
          ...(multiUnit ? [{ auxEnabled: true, auxBarcode: lookup }] : []),
        ],
      } : after ? { id: { gt: after } } : {}),
    },
    orderBy: paged ? { id: 'asc' as const } : { name: 'asc' as const },
    take: lookup ? 2 : paged ? pageSize + 1 : 500,
  }
  const products = await prisma.product.findMany({
    ...listOptions,
    select: CASHIER_PRODUCT_SELECT,
  }).catch(async (e) => {
    if (!isMissingCashierProductColumn(e)) throw e
    const legacyProducts = await prisma.product.findMany({
      ...listOptions,
      ...(lookup ? { where: { ...productWhere, barcode: lookup } } : {}),
      select: {
        id: true,
        barcode: true,
        name: true,
        spec: true,
        sellPrice: true,
        categoryId: true,
        imageUrl: true,
        status: true,
        updatedAt: true,
      },
    })
    return legacyProducts.map((p) => ({
      ...p,
      sku: null,
      imageUrls: null,
      mainUnitName: null,
      auxUnitName: null,
      auxBarcode: null,
      auxConversionFactor: null,
      auxSellPrice: null,
      auxEnabled: false,
    }))
  })

  const hasMore = paged && !lookup && products.length > pageSize
  const items = (hasMore ? products.slice(0, pageSize) : products).map((p) => ({
    id: p.id,
    barcode: p.barcode,
    sku: p.sku,
    name: p.name,
    spec: p.spec,
    sellPrice: p.sellPrice.toNumber(),
    categoryId: p.categoryId,
    imageUrl: p.imageUrl,
    imageUrls: parseImageUrls(p.imageUrls, p.imageUrl),
    status: p.status,
    updatedAt: p.updatedAt.toISOString(),
    ...(multiUnit ? {
      mainUnitName: p.mainUnitName,
      auxUnitName: p.auxUnitName,
      auxBarcode: p.auxBarcode,
      auxConversionFactor: p.auxConversionFactor,
      auxSellPrice: p.auxSellPrice?.toNumber() ?? null,
      auxEnabled: p.auxEnabled,
    } : {}),
  }))
  if (lookup) return NextResponse.json({ storeCode, products: items })

  const categories = !paged || !hasMore
    ? await prisma.productCategory.findMany({
      where: { tenantId: store.tenantId },
      select: { id: true, name: true, parentId: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    })
    : []
  // Compare the assembled pages against a single database statement at the end
  // of the traversal. Count alone misses inserts paired with deletions.
  let proof: { totalCount: number; digest: string; verifiedAt: number } | undefined
  if (paged && !hasMore) {
    const verifiedAt = Date.now()
    const current = await prisma.product.findMany({ where: productWhere, select: { id: true, updatedAt: true } })
    const revisions = current.map(p => JSON.stringify([p.id, p.updatedAt.toISOString()])).sort()
    proof = {
      totalCount: current.length,
      digest: createHash('sha256').update(revisions.join('\n')).digest('hex'),
      verifiedAt,
    }
  }

  return NextResponse.json({
    tenantId: store.tenantId,
    storeId: store.id,
    storeCode,
    storeName: store.name,
    currencyCode: store.currencyCode,
    printKitchenTicket: store.printKitchenTicket,
    ...(multiUnit ? { multiUnitEligible: true } : {}),
    products: items,
    categories,
    ...(paged ? { nextCursor: hasMore ? items[items.length - 1].id : null, proof } : {}),
  })
}
