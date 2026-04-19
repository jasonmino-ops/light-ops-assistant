import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

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
 * Body (all optional): { name?, spec?, sellPrice?, status? }
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

  let body: { name?: string; spec?: string | null; sellPrice?: number; status?: string; categoryId?: string | null }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const { name, spec, sellPrice, status, categoryId } = body

  if (name !== undefined && !String(name).trim()) {
    return NextResponse.json({ error: 'INVALID_NAME', message: '商品名不能为空' }, { status: 400 })
  }
  if (sellPrice !== undefined && (isNaN(Number(sellPrice)) || Number(sellPrice) <= 0)) {
    return NextResponse.json({ error: 'INVALID_PRICE', message: '售价必须大于 0' }, { status: 400 })
  }
  if (status !== undefined && !['ACTIVE', 'DISABLED'].includes(status)) {
    return NextResponse.json({ error: 'INVALID_STATUS' }, { status: 400 })
  }

  let updated: Awaited<ReturnType<typeof prisma.product.update>>
  try {
    updated = await prisma.product.update({
      where: { id, tenantId: ctx.tenantId },
      data: {
        ...(name !== undefined ? { name: String(name).trim() } : {}),
        ...(spec !== undefined ? { spec: spec ? String(spec).trim() || null : null } : {}),
        ...(sellPrice !== undefined ? { sellPrice: String(sellPrice) } : {}),
        ...(status !== undefined ? { status: status as 'ACTIVE' | 'DISABLED' } : {}),
        ...(categoryId !== undefined ? { categoryId: categoryId ?? null } : {}),
      },
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: 'PRODUCT_NOT_FOUND' }, { status: 404 })
    }
    throw e
  }

  return NextResponse.json({
    id: updated.id,
    barcode: updated.barcode,
    name: updated.name,
    spec: updated.spec,
    sellPrice: updated.sellPrice.toNumber(),
    status: updated.status,
    categoryId: updated.categoryId,
  })
}
