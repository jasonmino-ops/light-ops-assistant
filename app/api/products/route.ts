import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

/**
 * GET /api/products?barcode=<barcode>
 *
 * Returns the active product matching the barcode within the tenant.
 * sellPrice is the authoritative price — the sale page must not allow editing it.
 */
export async function GET(req: NextRequest) {
  const ctx = getContext(req)
  if (!ctx) {
    return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  }

  const barcode = req.nextUrl.searchParams.get('barcode')
  if (!barcode) {
    return NextResponse.json(
      { error: 'MISSING_PARAM', message: 'barcode is required' },
      { status: 400 },
    )
  }

  const product = await prisma.product.findFirst({
    where: { tenantId: ctx.tenantId, barcode, status: 'ACTIVE' },
    select: { id: true, barcode: true, name: true, spec: true, sellPrice: true },
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
  })
}
