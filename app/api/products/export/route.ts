import { NextRequest, NextResponse } from 'next/server'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/prisma'
import { createProductExportWorkbook } from '@/lib/product-backup'

export async function GET(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const products = await prisma.product.findMany({
    where: { tenantId: ctx.tenantId },
    include: { category: { include: { parent: true } } },
    orderBy: [{ categoryId: 'asc' }, { name: 'asc' }, { barcode: 'asc' }],
  })
  const data = createProductExportWorkbook(products)
  const date = new Date().toISOString().slice(0, 10)
  return new NextResponse(new Uint8Array(data), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="products_export_${date}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  })
}
