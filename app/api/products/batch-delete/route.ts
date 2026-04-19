import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

/**
 * POST /api/products/batch-delete  — OWNER only
 *
 * Body: { ids: string[] }
 * For each id: if no sales history → delete; else → add to skipped list.
 * Returns: { deleted: string[], skipped: Array<{ id, name, reason }> }
 */
export async function POST(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') {
    return NextResponse.json({ error: 'FORBIDDEN', message: '只有老板可以删除商品' }, { status: 403 })
  }

  let body: { ids?: string[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const ids = body.ids
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'MISSING_IDS' }, { status: 400 })
  }
  if (ids.length > 200) {
    return NextResponse.json({ error: 'TOO_MANY_IDS' }, { status: 400 })
  }

  // Fetch all products belonging to this tenant
  const products = await prisma.product.findMany({
    where: { id: { in: ids }, tenantId: ctx.tenantId },
    select: { id: true, name: true },
  })
  const productMap = new Map(products.map((p) => [p.id, p.name]))

  // Fetch sale counts for all ids in one query
  const saleCounts = await prisma.saleRecord.groupBy({
    by: ['productId'],
    where: { productId: { in: ids } },
    _count: { id: true },
  })
  const salesMap = new Map(saleCounts.map((r) => [r.productId as string, r._count.id]))

  const deleted: string[] = []
  const skipped: Array<{ id: string; name: string; reason: string }> = []

  for (const id of ids) {
    if (!productMap.has(id)) {
      // Not found or not owned by tenant — skip silently
      continue
    }
    const name = productMap.get(id)!
    const count = salesMap.get(id) ?? 0
    if (count > 0) {
      skipped.push({ id, name, reason: 'HAS_SALES' })
    } else {
      try {
        await prisma.product.delete({ where: { id } })
        deleted.push(id)
      } catch {
        skipped.push({ id, name, reason: 'DELETE_FAILED' })
      }
    }
  }

  return NextResponse.json({ deleted, skipped })
}
