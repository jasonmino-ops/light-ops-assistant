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

const PRODUCT_PATCH_SELECT = {
  id: true,
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

const PRODUCT_PATCH_LEGACY_SELECT = {
  id: true,
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

/**
 * DELETE /api/products/[id]  — OWNER only
 *
 * Physically deletes a product if it has no SaleRecord references.
 * If the product has been sold, returns 409 PRODUCT_HAS_SALES.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') {
    return NextResponse.json({ error: 'FORBIDDEN', message: '只有老板可以删除商品' }, { status: 403 })
  }

  const { id } = await params

  // Verify product belongs to tenant
  const product = await prisma.product.findFirst({
    where: { id, tenantId: ctx.tenantId },
    select: { id: true, name: true },
  })
  if (!product) {
    return NextResponse.json({ error: 'PRODUCT_NOT_FOUND' }, { status: 404 })
  }

  // Guard: refuse if product has any sale history
  const salesCount = await prisma.saleRecord.count({ where: { productId: id } })
  if (salesCount > 0) {
    return NextResponse.json(
      { error: 'PRODUCT_HAS_SALES', message: '该商品已有销售记录，无法删除，建议改为停用' },
      { status: 409 },
    )
  }

  try {
    await prisma.product.delete({ where: { id } })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: 'PRODUCT_NOT_FOUND' }, { status: 404 })
    }
    throw e
  }

  return NextResponse.json({ success: true })
}

/**
 * PATCH /api/products/[id]  — OWNER only
 *
 * Updates one or more fields of an existing product.
 * Body (all optional): { barcode?, name?, spec?, sellPrice?, status? }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') {
    return NextResponse.json(
      { error: 'FORBIDDEN', message: '只有老板可以修改商品' },
      { status: 403 },
    )
  }

  const { id } = await params

  let body: { barcode?: string; name?: string; spec?: string | null; sellPrice?: number; discountPrice?: number | null; discountEnabled?: boolean; isRecommended?: boolean; printKitchenTicket?: boolean; status?: string; categoryId?: string | null } & MultiUnitMutation
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const { barcode, name, spec, sellPrice, discountPrice, discountEnabled, isRecommended, printKitchenTicket, status, categoryId } = body

  if (barcode !== undefined && !String(barcode).trim()) {
    return NextResponse.json({ error: 'INVALID_BARCODE', message: '条码不能为空' }, { status: 400 })
  }
  if (name !== undefined && !String(name).trim()) {
    return NextResponse.json({ error: 'INVALID_NAME', message: '商品名不能为空' }, { status: 400 })
  }
  if (sellPrice !== undefined && (isNaN(Number(sellPrice)) || Number(sellPrice) <= 0)) {
    return NextResponse.json({ error: 'INVALID_PRICE', message: '售价必须大于 0' }, { status: 400 })
  }
  if (status !== undefined && !['ACTIVE', 'DISABLED'].includes(status)) {
    return NextResponse.json({ error: 'INVALID_STATUS' }, { status: 400 })
  }
  if (printKitchenTicket !== undefined && typeof printKitchenTicket !== 'boolean') {
    return NextResponse.json({ error: 'INVALID_PRINT_KITCHEN_TICKET' }, { status: 400 })
  }
  const current = await prisma.product.findFirst({
    where: { id, tenantId: ctx.tenantId },
    select: {
      barcode: true,
      sellPrice: true,
      discountPrice: true,
      discountEnabled: true,
      mainUnitName: true,
      auxUnitName: true,
      auxBarcode: true,
      auxConversionFactor: true,
      auxSellPrice: true,
      auxEnabled: true,
    },
  })
  if (!current) return NextResponse.json({ error: 'PRODUCT_NOT_FOUND' }, { status: 404 })
  const effectiveSellPrice = sellPrice === undefined ? current.sellPrice.toNumber() : Number(sellPrice)
  const effectiveDiscountPrice = discountPrice === undefined ? current.discountPrice?.toNumber() ?? null : discountPrice
  const effectiveDiscountEnabled = discountEnabled === undefined ? current.discountEnabled : discountEnabled
  if (effectiveDiscountPrice != null && (isNaN(Number(effectiveDiscountPrice)) || Number(effectiveDiscountPrice) <= 0 || Number(effectiveDiscountPrice) >= effectiveSellPrice)) {
    return NextResponse.json({ error: 'INVALID_DISCOUNT_PRICE', message: '折扣价必须大于 0 且低于原售价' }, { status: 400 })
  }
  if (effectiveDiscountEnabled && effectiveDiscountPrice == null) {
    return NextResponse.json({ error: 'MISSING_DISCOUNT_PRICE', message: '开启折扣前请填写折扣价' }, { status: 400 })
  }

  const cleanBarcode = barcode !== undefined ? String(barcode).trim() : undefined
  const store = await prisma.store.findFirst({ where: { id: ctx.storeId, tenantId: ctx.tenantId }, select: { businessType: true } })
  const multiUnitEligible = isMultiUnitBusinessType(store?.businessType)
  const hasMultiUnitInput = ['mainUnitName', 'auxUnitName', 'auxBarcode', 'auxConversionFactor', 'auxSellPrice', 'auxEnabled']
    .some((key) => Object.prototype.hasOwnProperty.call(body, key))
  if (hasMultiUnitInput && !multiUnitEligible) {
    return NextResponse.json({ error: 'MULTI_UNIT_NOT_AVAILABLE' }, { status: 403 })
  }
  if (cleanBarcode !== undefined) {
    const existingMainBarcode = await prisma.product.findFirst({
      where: { tenantId: ctx.tenantId, barcode: cleanBarcode, id: { not: id } },
      select: { id: true },
    })
    if (existingMainBarcode) {
      return NextResponse.json({ error: 'DUPLICATE_BARCODE', message: '该条码已存在' }, { status: 409 })
    }
  }
  let multiUnit
  try {
    multiUnit = normalizeMultiUnitMutation(multiUnitEligible ? body : {}, {
      ...current,
      auxSellPrice: current.auxSellPrice?.toString() ?? null,
    })
    await assertProductUnitBarcodesAvailable(prisma, {
      tenantId: ctx.tenantId,
      barcode: cleanBarcode ?? current.barcode,
      auxBarcode: multiUnit.auxBarcode,
      excludeProductId: id,
    })
  } catch (error) {
    if (error instanceof ProductUnitError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status })
    }
    throw error
  }

  const data = {
    ...(cleanBarcode !== undefined ? { barcode: cleanBarcode } : {}),
    ...(name !== undefined ? { name: String(name).trim() } : {}),
    ...(spec !== undefined ? { spec: spec ? String(spec).trim() || null : null } : {}),
    ...(sellPrice !== undefined ? { sellPrice: String(sellPrice) } : {}),
    ...(discountPrice !== undefined ? { discountPrice: discountPrice == null ? null : String(discountPrice) } : {}),
    ...(discountEnabled !== undefined ? { discountEnabled } : {}),
    ...(isRecommended !== undefined ? { isRecommended } : {}),
    ...(printKitchenTicket !== undefined ? { printKitchenTicket } : {}),
    ...(status !== undefined ? { status: status as 'ACTIVE' | 'DISABLED' } : {}),
    ...(categoryId !== undefined ? { categoryId: categoryId ?? null } : {}),
    ...(multiUnitEligible && hasMultiUnitInput ? {
      mainUnitName: multiUnit.mainUnitName,
      auxUnitName: multiUnit.auxUnitName,
      auxBarcode: multiUnit.auxBarcode,
      auxConversionFactor: multiUnit.auxConversionFactor == null ? null : Number(multiUnit.auxConversionFactor),
      auxSellPrice: multiUnit.auxSellPrice == null ? null : String(multiUnit.auxSellPrice),
      auxEnabled: multiUnit.auxEnabled,
    } : {}),
  }

  let updated: Prisma.ProductGetPayload<{ select: typeof PRODUCT_PATCH_SELECT }>
  try {
    updated = await prisma.product.update({
      where: { id, tenantId: ctx.tenantId },
      data,
      select: PRODUCT_PATCH_SELECT,
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: 'PRODUCT_NOT_FOUND' }, { status: 404 })
    }
    if (isProductBarcodeConflict(e)) {
      const mainConflict = cleanBarcode === undefined ? null : await prisma.product.findFirst({
        where: { tenantId: ctx.tenantId, barcode: cleanBarcode, id: { not: id } },
        select: { id: true },
      })
      if (mainConflict) {
        return NextResponse.json({ error: 'DUPLICATE_BARCODE', message: '该条码已存在' }, { status: 409 })
      }
      return NextResponse.json({ error: 'BARCODE_COLLISION', message: '条码已被其他商品主单位或辅单位使用' }, { status: 409 })
    }
    if (!isMissingImageGalleryColumn(e)) throw e
    const legacyUpdated = await prisma.product.update({
      where: { id, tenantId: ctx.tenantId },
      data,
      select: PRODUCT_PATCH_LEGACY_SELECT,
    })
    updated = {
      ...legacyUpdated,
      imageUrls: null,
      mainUnitName: null,
      auxUnitName: null,
      auxBarcode: null,
      auxConversionFactor: null,
      auxSellPrice: null,
      auxEnabled: false,
    }
  }

  return NextResponse.json({
    id: updated.id,
    barcode: updated.barcode,
    name: updated.name,
    spec: updated.spec,
    sellPrice: updated.sellPrice.toNumber(),
    discountPrice: updated.discountPrice?.toNumber() ?? null,
    discountEnabled: updated.discountEnabled,
    isRecommended: updated.isRecommended,
    printKitchenTicket: updated.printKitchenTicket,
    status: updated.status,
    categoryId: updated.categoryId,
    imageUrl: updated.imageUrl,
    imageUrls: parseImageUrls(updated.imageUrls, updated.imageUrl),
    ...(multiUnitEligible ? {
      multiUnitEligible: true,
      mainUnitName: updated.mainUnitName,
      auxUnitName: updated.auxUnitName,
      auxBarcode: updated.auxBarcode,
      auxConversionFactor: updated.auxConversionFactor,
      auxSellPrice: updated.auxSellPrice?.toNumber() ?? null,
      auxEnabled: updated.auxEnabled,
    } : {}),
  })
}
