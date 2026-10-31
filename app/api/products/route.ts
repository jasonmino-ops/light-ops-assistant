import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import {
  assertProductUnitBarcodesAvailable,
  isMultiUnitBusinessType,
  normalizeMultiUnitMutation,
  ProductUnitError,
  type MultiUnitMutation,
} from '@/lib/product-unit'

const PRODUCT_SELECT = {
  id: true,
  sku: true,
  barcode: true,
  name: true,
  spec: true,
  sellPrice: true,
  mainUnitName: true,
  auxUnitName: true,
  auxBarcode: true,
  auxConversionFactor: true,
  auxSellPrice: true,
  auxEnabled: true,
  discountPrice: true,
  discountEnabled: true,
  isRecommended: true,
  printKitchenTicket: true,
  status: true,
  categoryId: true,
  imageUrl: true,
  imageUrls: true,
} satisfies Prisma.ProductSelect

const PRODUCT_LEGACY_SELECT = {
  id: true,
  sku: true,
  barcode: true,
  name: true,
  spec: true,
  sellPrice: true,
  discountPrice: true,
  discountEnabled: true,
  isRecommended: true,
  printKitchenTicket: true,
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

function isProductBarcodeConflict(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
}

const multiUnitFields = (product: {
  mainUnitName: string | null
  auxUnitName: string | null
  auxBarcode: string | null
  auxConversionFactor: number | null
  auxSellPrice: Prisma.Decimal | null
  auxEnabled: boolean
}) => ({
  multiUnitEligible: true,
  mainUnitName: product.mainUnitName,
  auxUnitName: product.auxUnitName,
  auxBarcode: product.auxBarcode,
  auxConversionFactor: product.auxConversionFactor,
  auxSellPrice: product.auxSellPrice?.toNumber() ?? null,
  auxEnabled: product.auxEnabled,
})

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
  const store = await prisma.store.findFirst({
    where: { id: ctx.storeId, tenantId: ctx.tenantId },
    select: { businessType: true },
  })
  const multiUnitEligible = isMultiUnitBusinessType(store?.businessType)
  if (req.nextUrl.searchParams.get('capabilities') === 'true') {
    return NextResponse.json({ multiUnitEligible })
  }

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
      products = legacyProducts.map((p) => ({
        ...p,
        imageUrls: null,
        mainUnitName: null,
        auxUnitName: null,
        auxBarcode: null,
        auxConversionFactor: null,
        auxSellPrice: null,
        auxEnabled: false,
      }))
    }
    return NextResponse.json(
      products.map((p) => ({
        id: p.id,
        sku: p.sku,
        barcode: p.barcode,
        name: p.name,
        spec: p.spec,
        sellPrice: p.sellPrice.toNumber(),
        discountPrice: p.discountPrice?.toNumber() ?? null,
        discountEnabled: p.discountEnabled,
        isRecommended: p.isRecommended,
        printKitchenTicket: p.printKitchenTicket,
        status: p.status,
        categoryId: p.categoryId,
        imageUrl: p.imageUrl,
        imageUrls: parseImageUrls(p.imageUrls, p.imageUrl),
        ...(multiUnitEligible ? multiUnitFields(p) : {}),
      })),
    )
  }

  // ── Single lookup ──────────────────────────────────────────────────────────
  // OWNER can see disabled products (to re-enable them in the products page)
  const statusFilter = ctx.role === 'OWNER' ? undefined : ('ACTIVE' as const)
  const where = {
    tenantId: ctx.tenantId,
    OR: [
      { barcode },
      ...(multiUnitEligible ? [{ auxEnabled: true, auxBarcode: barcode }] : []),
    ],
    ...(statusFilter ? { status: statusFilter } : {}),
  }
  let product: Prisma.ProductGetPayload<{ select: typeof PRODUCT_SELECT }> | null
  try {
    product = await prisma.product.findFirst({ where, select: PRODUCT_SELECT })
  } catch (e) {
    if (!isMissingImageGalleryColumn(e)) throw e
    const legacyProduct = await prisma.product.findFirst({
      where: {
        tenantId: ctx.tenantId,
        barcode,
        ...(statusFilter ? { status: statusFilter } : {}),
      },
      select: PRODUCT_LEGACY_SELECT,
    })
    product = legacyProduct ? {
      ...legacyProduct,
      imageUrls: null,
      mainUnitName: null,
      auxUnitName: null,
      auxBarcode: null,
      auxConversionFactor: null,
      auxSellPrice: null,
      auxEnabled: false,
    } : null
  }

  if (!product) {
    return NextResponse.json({ error: 'PRODUCT_NOT_FOUND' }, { status: 404 })
  }

  return NextResponse.json({
    id: product.id,
    sku: product.sku,
    barcode: multiUnitEligible && product.auxEnabled && product.auxBarcode === barcode ? product.auxBarcode : product.barcode,
    name: product.name,
    spec: product.spec,
    sellPrice: multiUnitEligible && product.auxEnabled && product.auxBarcode === barcode
      ? product.auxSellPrice!.toNumber()
      : product.sellPrice.toNumber(),
    discountPrice: product.discountPrice?.toNumber() ?? null,
    discountEnabled: product.discountEnabled,
    isRecommended: product.isRecommended,
    printKitchenTicket: product.printKitchenTicket,
    categoryId: product.categoryId,
    imageUrl: product.imageUrl,
    imageUrls: parseImageUrls(product.imageUrls, product.imageUrl),
    ...(multiUnitEligible ? {
      primaryBarcode: product.barcode,
      primarySellPrice: product.sellPrice.toNumber(),
      ...multiUnitFields(product),
      sellingUnitType: product.auxEnabled && product.auxBarcode === barcode ? 'AUX' : 'MAIN',
      sellingUnitName: product.auxEnabled && product.auxBarcode === barcode
        ? product.auxUnitName
        : product.mainUnitName ?? '件',
      sellingConversionFactor: product.auxEnabled && product.auxBarcode === barcode
        ? product.auxConversionFactor
        : 1,
    } : {}),
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

  let body: { barcode?: string; name?: string; spec?: string | null; sellPrice?: number; discountPrice?: number | null; discountEnabled?: boolean; isRecommended?: boolean; printKitchenTicket?: boolean; categoryId?: string | null } & MultiUnitMutation
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const { barcode, name, spec, sellPrice, discountPrice, discountEnabled = false, isRecommended = false, printKitchenTicket = true, categoryId } = body

  if (!name?.trim()) {
    return NextResponse.json({ error: 'MISSING_NAME', message: '商品名不能为空' }, { status: 400 })
  }
  if (sellPrice === undefined || isNaN(Number(sellPrice)) || Number(sellPrice) <= 0) {
    return NextResponse.json({ error: 'INVALID_PRICE', message: '售价必须大于 0' }, { status: 400 })
  }
  if (discountPrice != null && (isNaN(Number(discountPrice)) || Number(discountPrice) <= 0 || Number(discountPrice) >= Number(sellPrice))) {
    return NextResponse.json({ error: 'INVALID_DISCOUNT_PRICE', message: '折扣价必须大于 0 且低于原售价' }, { status: 400 })
  }
  if (discountEnabled && discountPrice == null) {
    return NextResponse.json({ error: 'MISSING_DISCOUNT_PRICE', message: '开启折扣前请填写折扣价' }, { status: 400 })
  }
  if (typeof printKitchenTicket !== 'boolean') {
    return NextResponse.json({ error: 'INVALID_PRINT_KITCHEN_TICKET' }, { status: 400 })
  }

  const cleanBarcode = barcode?.trim() || `MANUAL-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
  const store = await prisma.store.findFirst({ where: { id: ctx.storeId, tenantId: ctx.tenantId }, select: { businessType: true } })
  const multiUnitEligible = isMultiUnitBusinessType(store?.businessType)
  const hasMultiUnitInput = ['mainUnitName', 'auxUnitName', 'auxBarcode', 'auxConversionFactor', 'auxSellPrice', 'auxEnabled']
    .some((key) => Object.prototype.hasOwnProperty.call(body, key))
  if (hasMultiUnitInput && !multiUnitEligible) {
    return NextResponse.json({ error: 'MULTI_UNIT_NOT_AVAILABLE' }, { status: 403 })
  }
  const existingMainBarcode = await prisma.product.findFirst({
    where: { tenantId: ctx.tenantId, barcode: cleanBarcode },
    select: { id: true },
  })
  if (existingMainBarcode) {
    return NextResponse.json(
      { error: 'BARCODE_EXISTS', message: '该条码已存在，请直接查询修改' },
      { status: 409 },
    )
  }
  let multiUnit = normalizeMultiUnitMutation({})
  try {
    if (multiUnitEligible) multiUnit = normalizeMultiUnitMutation(body)
    await assertProductUnitBarcodesAvailable(prisma, {
      tenantId: ctx.tenantId,
      barcode: cleanBarcode,
      auxBarcode: multiUnit.auxBarcode,
    })
  } catch (error) {
    if (error instanceof ProductUnitError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status })
    }
    throw error
  }

  let created: Prisma.ProductGetPayload<{ select: typeof PRODUCT_LEGACY_SELECT }>
  try {
    created = await prisma.product.create({
      data: {
        tenantId: ctx.tenantId,
        barcode: cleanBarcode,
        name: name.trim(),
        spec: spec?.trim() || null,
        sellPrice: String(sellPrice),
        discountPrice: discountPrice == null ? null : String(discountPrice),
        discountEnabled,
        isRecommended,
        printKitchenTicket,
        status: 'ACTIVE',
        categoryId: categoryId ?? null,
        ...(multiUnitEligible ? {
          mainUnitName: multiUnit.mainUnitName,
          auxUnitName: multiUnit.auxUnitName,
          auxBarcode: multiUnit.auxBarcode,
          auxConversionFactor: multiUnit.auxConversionFactor == null ? null : Number(multiUnit.auxConversionFactor),
          auxSellPrice: multiUnit.auxSellPrice == null ? null : String(multiUnit.auxSellPrice),
          auxEnabled: multiUnit.auxEnabled,
        } : {}),
      },
      select: PRODUCT_LEGACY_SELECT,
    })
  } catch (error) {
    if (isProductBarcodeConflict(error)) {
      const mainConflict = await prisma.product.findFirst({
        where: { tenantId: ctx.tenantId, barcode: cleanBarcode },
        select: { id: true },
      })
      if (mainConflict) {
        return NextResponse.json(
          { error: 'BARCODE_EXISTS', message: '该条码已存在，请直接查询修改' },
          { status: 409 },
        )
      }
      return NextResponse.json({ error: 'BARCODE_COLLISION', message: '条码已被其他商品主单位或辅单位使用' }, { status: 409 })
    }
    throw error
  }

  return NextResponse.json(
    {
      id: created.id,
      sku: created.sku,
      barcode: created.barcode,
      name: created.name,
      spec: created.spec,
      sellPrice: created.sellPrice.toNumber(),
      discountPrice: created.discountPrice?.toNumber() ?? null,
      discountEnabled: created.discountEnabled,
      isRecommended: created.isRecommended,
      printKitchenTicket: created.printKitchenTicket,
      status: created.status,
      categoryId: created.categoryId,
      imageUrl: created.imageUrl,
      imageUrls: [],
      ...(multiUnitEligible ? multiUnitFields({ ...multiUnit, auxSellPrice: multiUnit.auxSellPrice == null ? null : new Prisma.Decimal(multiUnit.auxSellPrice) }) : {}),
    },
    { status: 201 },
  )
}
