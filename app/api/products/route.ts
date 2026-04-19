import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

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
 * Create a new product. Body: { barcode, name, spec?, sellPrice }
 */

export async function GET(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })

  const barcode = req.nextUrl.searchParams.get('barcode')

  // ── List mode ──────────────────────────────────────────────────────────────
  if (!barcode) {
    const products = await prisma.product.findMany({
      where: { tenantId: ctx.tenantId, status: 'ACTIVE' },
      select: { id: true, barcode: true, name: true, spec: true, sellPrice: true, categoryId: true },
      orderBy: { name: 'asc' },
      take: 200,
    })
    return NextResponse.json(
      products.map((p) => ({
        id: p.id,
        barcode: p.barcode,
        name: p.name,
        spec: p.spec,
        sellPrice: p.sellPrice.toNumber(),
        categoryId: p.categoryId,
      })),
    )
  }

  // ── Single lookup ──────────────────────────────────────────────────────────
  // OWNER can see disabled products (to re-enable them in the products page)
  const statusFilter = ctx.role === 'OWNER' ? undefined : ('ACTIVE' as const)
  const product = await prisma.product.findFirst({
    where: {
      tenantId: ctx.tenantId,
      barcode,
      ...(statusFilter ? { status: statusFilter } : {}),
    },
    select: { id: true, barcode: true, name: true, spec: true, sellPrice: true, status: true, categoryId: true },
  })

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

  if (!barcode?.trim()) {
    return NextResponse.json({ error: 'MISSING_BARCODE', message: '条码不能为空' }, { status: 400 })
  }
  if (!name?.trim()) {
    return NextResponse.json({ error: 'MISSING_NAME', message: '商品名不能为空' }, { status: 400 })
  }
  if (sellPrice === undefined || isNaN(Number(sellPrice)) || Number(sellPrice) <= 0) {
    return NextResponse.json({ error: 'INVALID_PRICE', message: '售价必须大于 0' }, { status: 400 })
  }

  // Duplicate barcode guard
  const existing = await prisma.product.findFirst({
    where: { tenantId: ctx.tenantId, barcode: barcode.trim() },
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
      barcode: barcode.trim(),
      name: name.trim(),
      spec: spec?.trim() || null,
      sellPrice: String(sellPrice),
      status: 'ACTIVE',
      categoryId: categoryId ?? null,
    },
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
    },
    { status: 201 },
  )
}
