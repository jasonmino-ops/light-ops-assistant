import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { localDate } from '@/lib/product-sales/dates'
import { identifier, ReportError } from '@/lib/product-sales/contract'
import { ownerRequest } from '@/lib/product-sales/http'

export async function GET(req: NextRequest) {
  return ownerRequest(req, async (_owner, allowed) => {
    const params = req.nextUrl.searchParams
    const storeId = params.get('storeId')
    const stores = storeId ? allowed.filter((store) => store.storeId === identifier(storeId)) : allowed
    if (!stores.length) throw new ReportError('STORE_ACCESS_DENIED', 403)
    const q = (params.get('q') ?? '').trim()
    if (q.length > 100) throw new ReportError('INVALID_SEARCH')
    const cursor = params.get('cursor')
    const products = await prisma.product.findMany({
      where: { tenantId: { in: [...new Set(stores.map((store) => store.tenantId))] }, ...(cursor ? { id: { gt: identifier(cursor) } } : {}),
        ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { barcode: { contains: q, mode: 'insensitive' } }, { sku: { contains: q, mode: 'insensitive' } }] } : {}) },
      orderBy: { id: 'asc' }, take: 101,
      select: { id: true, tenantId: true, name: true, barcode: true, status: true },
    })
    return { today: localDate(), stores: allowed.map(({ tenantId, storeId, storeName, currencyCode }) => ({ tenantId, storeId, storeName, currencyCode })),
      products: products.slice(0, 100).map(({ id, ...product }) => ({ ...product, productId: id })), nextCursor: products.length > 100 ? products[99].id : null }
  })
}
