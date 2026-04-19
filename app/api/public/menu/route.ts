import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/public/menu?code=<storeCode>
 *
 * 公开接口（无需登录），供顾客端商品页读取门店和商品数据。
 * 通过 Store.code 识别门店，返回商品列表。
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  if (!code) {
    return NextResponse.json({ error: 'MISSING_CODE' }, { status: 400 })
  }

  const store = await prisma.store.findUnique({
    where: { code },
    select: { name: true, status: true, tenantId: true, bannerUrl: true, announcement: true, promoText: true },
  })

  if (!store || store.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })
  }

  const products = await prisma.product.findMany({
    where: { tenantId: store.tenantId, status: 'ACTIVE' },
    select: { id: true, name: true, spec: true, sellPrice: true },
    orderBy: { name: 'asc' },
    take: 200,
  })

  return NextResponse.json({
    store: {
      name: store.name,
      isOpen: true,
      bannerUrl:    store.bannerUrl    ?? null,
      announcement: store.announcement ?? null,
      promoText:    store.promoText    ?? null,
    },
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      spec: p.spec ?? null,
      price: p.sellPrice.toNumber(),
    })),
  })
}
