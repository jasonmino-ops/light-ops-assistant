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

  const tgId = req.nextUrl.searchParams.get('tgId')?.trim() || null

  const store = await prisma.store.findUnique({
    where: { code },
    select: { name: true, status: true, tenantId: true, bannerUrl: true, announcement: true, promoText: true },
  })

  if (!store || store.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })
  }

  // 顾客绑定状态：仅当客户端能提供自己的 tgId（Telegram WebApp）时才查；
  // 普通浏览器无 tgId → customerBound: false，前端正常显示绑定引导
  let customerBound = false
  if (tgId) {
    const contact = await prisma.storeCustomerContact.findUnique({
      where: { storeCode_telegramId: { storeCode: code, telegramId: tgId } },
      select: { id: true, status: true },
    })
    customerBound = !!contact && contact.status === 'active'
  }

  const [products, categories] = await Promise.all([
    prisma.product.findMany({
      where: { tenantId: store.tenantId, status: 'ACTIVE' },
      select: { id: true, name: true, spec: true, sellPrice: true, categoryId: true, imageUrl: true },
      orderBy: { name: 'asc' },
      take: 200,
    }),
    prisma.productCategory.findMany({
      where: { tenantId: store.tenantId },
      select: { id: true, name: true, parentId: true, sortOrder: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
  ])

  return NextResponse.json({
    store: {
      name: store.name,
      isOpen: true,
      bannerUrl:    store.bannerUrl    ?? null,
      announcement: store.announcement ?? null,
      promoText:    store.promoText    ?? null,
    },
    customerBound,
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      parentId: c.parentId ?? null,
      sortOrder: c.sortOrder,
    })),
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      spec: p.spec ?? null,
      price: p.sellPrice.toNumber(),
      categoryId: p.categoryId ?? null,
      imageUrl: p.imageUrl ?? null,
    })),
  })
}
