import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

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
  const ctx = getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') {
    return NextResponse.json(
      { error: 'FORBIDDEN', message: '只有老板可以修改商品' },
      { status: 403 },
    )
  }

  const { id } = await params

  // Verify product belongs to this tenant
  const existing = await prisma.product.findFirst({
    where: { id, tenantId: ctx.tenantId },
  })
  if (!existing) {
    return NextResponse.json({ error: 'PRODUCT_NOT_FOUND' }, { status: 404 })
  }

  let body: { name?: string; spec?: string | null; sellPrice?: number; status?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const { name, spec, sellPrice, status } = body

  if (name !== undefined && !String(name).trim()) {
    return NextResponse.json({ error: 'INVALID_NAME', message: '商品名不能为空' }, { status: 400 })
  }
  if (sellPrice !== undefined && (isNaN(Number(sellPrice)) || Number(sellPrice) <= 0)) {
    return NextResponse.json({ error: 'INVALID_PRICE', message: '售价必须大于 0' }, { status: 400 })
  }
  if (status !== undefined && !['ACTIVE', 'DISABLED'].includes(status)) {
    return NextResponse.json({ error: 'INVALID_STATUS' }, { status: 400 })
  }

  const updated = await prisma.product.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name: String(name).trim() } : {}),
      ...(spec !== undefined ? { spec: spec ? String(spec).trim() || null : null } : {}),
      ...(sellPrice !== undefined ? { sellPrice: String(sellPrice) } : {}),
      ...(status !== undefined ? { status: status as 'ACTIVE' | 'DISABLED' } : {}),
    },
  })

  return NextResponse.json({
    id: updated.id,
    barcode: updated.barcode,
    name: updated.name,
    spec: updated.spec,
    sellPrice: updated.sellPrice.toNumber(),
    status: updated.status,
  })
}
