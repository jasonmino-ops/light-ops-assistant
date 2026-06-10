import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

const PRODUCT_SELECT = {
  id: true,
  barcode: true,
  name: true,
  spec: true,
  sellPrice: true,
  status: true,
  categoryId: true,
  imageUrl: true,
  imageUrls: true,
} satisfies Prisma.ProductSelect

const PRODUCT_LEGACY_SELECT = {
  id: true,
  barcode: true,
  name: true,
  spec: true,
  sellPrice: true,
  status: true,
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

/**
 * GET /api/products[?barcode=<barcode>]
 *
 * List mode (no barcode): returns all ACTIVE products.
 *
 * Single lookup (barcode):
 *   STAFF → only ACTIVE products (unchanged behaviour)
 *   OWNER → all products incl. DISABLED; also returns status field so the
 *            product management page can show the current state.
 *
 * POST /api/products — OWNER only
 * Create a new product. Body: { barcode?, name, spec?, sellPrice }
 */

export async function GET(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })

  const barcode = req.nextUrl.searchParams.get('barcode')

  // ── List mode ──────────────────────────────────────────────────────────────
  if (!barcode) {
    const all = req.nextUrl.searchParams.get('all') === 'true'

    // all=true is OWNER-only; returns DISABLED products too (for delete management)
    if (all && ctx.role !== 'OWNER') {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }

    const where = {
      tenantId: ctx.tenantId,
      ...(all ? {} : { status: 'ACTIVE' as const }),
    }

    let products: Array<Prisma.ProductGetPayload<{ select: typeof PRODUCT_SELECT }>>
    try {
      products = await prisma.product.findMany({
        where,
        select: PRODUCT_SELECT,
        orderBy: { name: 'asc' },
        take: 500,
      })
    } catch (e) {
      if (!isMissingImageGalleryColumn(e)) throw e
      const legacyProducts = await prisma.product.findMany({
        where,
        select: PRODUCT_LEGACY_SELECT,
        orderBy: { name: 'asc' },
        take: 500,
      })
      products = legacyProducts.map((p) => ({ ...p, imageUrls: null }))
    }
    return NextResponse.json(
      products.map((p) => ({
        id: p.id,
        barcode: p.barcode,
        name: p.name,
        spec: p.spec,
        sellPrice: p.sellPrice.toNumber(),
        status: p.status,
        categoryId: p.categoryId,
        imageUrl: p.imageUrl,
        imageUrls: parseImageUrls(p.imageUrls, p.imageUrl),
      })),
    )
  }

  // ── Single lookup ──────────────────────────────────────────────────────────
  // OWNER can see disabled products (to re-enable them in the products page)
  const statusFilter = ctx.role === 'OWNER' ? undefined : ('ACTIVE' as const)
  const where = {
    tenantId: ctx.tenantId,
    barcode,
    ...(statusFilter ? { status: statusFilter } : {}),
  }
  let product: Prisma.ProductGetPayload<{ select: typeof PRODUCT_SELECT }> | null
  try {
    product = await prisma.product.findFirst({ where, select: PRODUCT_SELECT })
  } catch (e) {
    if (!isMissingImageGalleryColumn(e)) throw e
    const legacyProduct = await prisma.product.findFirst({ where, select: PRODUCT_LEGACY_SELECT })
    product = legacyProduct ? { ...legacyProduct, imageUrls: null } : null
  }

  if (!product) {
    return NextResponse.json({ error: 'PRODUCT_NOT_FOUND' }, { status: 404 })
  }

  return NextResponse.json({
    id: product.id,
    barcode: product.barcode,
    name: product.name,
    spec: product.spec,
    sellPrice: product.sellPrice.toNumber(),
    categoryId: product.categoryId,
    imageUrl: product.imageUrl,
    imageUrls: parseImageUrls(product.imageUrls, product.imageUrl),
    // status only exposed to OWNER (staff doesn't need to see it)
    ...(ctx.role === 'OWNER' ? { status: product.status } : {}),
  })
}

// ── POST: create product ───────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') {
    return NextResponse.json(
      { error: 'FORBIDDEN', message: '只有老板可以新增商品' },
      { status: 403 },
    )
  }

  let body: { barcode?: string; name?: string; spec?: string | null; sellPrice?: number; categoryId?: string | null }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const { barcode, name, spec, sellPrice, categoryId } = body

  if (!name?.trim()) {
    return NextResponse.json({ error: 'MISSING_NAME', message: '商品名不能为空' }, { status: 400 })
  }
  if (sellPrice === undefined || isNaN(Number(sellPrice)) || Number(sellPrice) <= 0) {
    return NextResponse.json({ error: 'INVALID_PRICE', message: '售价必须大于 0' }, { status: 400 })
  }

  const cleanBarcode = barcode?.trim() || `MANUAL-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`

  // Duplicate barcode guard
  const existing = await prisma.product.findFirst({
    where: { tenantId: ctx.tenantId, barcode: cleanBarcode },
  })
  if (existing) {
    return NextResponse.json(
      { error: 'BARCODE_EXISTS', message: '该条码已存在，请直接查询修改' },
      { status: 409 },
    )
  }

  const created = await prisma.product.create({
    data: {
      tenantId: ctx.tenantId,
      barcode: cleanBarcode,
      name: name.trim(),
      spec: spec?.trim() || null,
      sellPrice: String(sellPrice),
      status: 'ACTIVE',
      categoryId: categoryId ?? null,
    },
    select: PRODUCT_LEGACY_SELECT,
  })

  return NextResponse.json(
    {
      id: created.id,
      barcode: created.barcode,
      name: created.name,
      spec: created.spec,
      sellPrice: created.sellPrice.toNumber(),
      status: created.status,
      categoryId: created.categoryId,
      imageUrl: created.imageUrl,
      imageUrls: [],
    },
    { status: 201 },
  )
}
