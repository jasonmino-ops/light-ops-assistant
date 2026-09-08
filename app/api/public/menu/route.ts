import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { loadPublicMenuCatalog } from '@/lib/public-menu-data'
import { getStoreContactById } from '@/lib/store-contact-db'
import { getStoreLocationById } from '@/lib/store-location-db'

function compactUrls(urls: Array<string | null | undefined>, limit?: number): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  urls.forEach((raw) => {
    const url = raw?.trim()
    if (!url || seen.has(url)) return
    seen.add(url)
    result.push(url)
  })
  return typeof limit === 'number' ? result.slice(0, limit) : result
}

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

  const catalog = await loadPublicMenuCatalog(code)
  if (!catalog) {
    return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })
  }
  const { store, products, categories } = catalog

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

  const storeIdPromise = prisma.store.findUnique({ where: { code }, select: { id: true } })
  const [contact, location] = await Promise.all([
    storeIdPromise.then((row) => row ? getStoreContactById(row.id) : { contactPhone: null, contactTelegram: null, contactWhatsApp: null }),
    storeIdPromise.then((row) => row ? getStoreLocationById(row.id) : { storeAddress: null, storeLat: null, storeLng: null, mapUrl: null }),
  ])

  const productIds = products.map((p) => p.id)
  const marketingPages = productIds.length > 0
    ? await prisma.marketingProductPage.findMany({
      where: {
        tenantId: store.tenantId,
        productId: { in: productIds },
        status: { not: 'DISABLED' },
      },
      select: {
        productId: true,
        heroImageUrl: true,
        detailImage1: true,
        detailImage2: true,
        detailImage3: true,
        reviewImage1: true,
        reviewImage2: true,
        reviewImage3: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: Math.min(productIds.length * 3, 500),
    })
    : []

  const marketingImagesByProduct = new Map<string, string[]>()
  marketingPages.forEach((page) => {
    if (marketingImagesByProduct.has(page.productId)) return
    const images = compactUrls([
      page.detailImage1,
      page.detailImage2,
      page.detailImage3,
      page.heroImageUrl,
      page.reviewImage1,
      page.reviewImage2,
      page.reviewImage3,
    ])
    if (images.length > 0) marketingImagesByProduct.set(page.productId, images)
  })

  return NextResponse.json({
    store: {
      name: store.name,
      isOpen: true,
      bannerUrl:    store.bannerUrl    ?? null,
      announcement: store.announcement ?? null,
      promoText:    store.promoText    ?? null,
      businessType: store.businessType ?? 'GENERAL',
      currencyCode: store.currencyCode ?? 'USD',
      ...contact,
      ...location,
    },
    customerBound,
    categories,
    products: products.map((product) => ({
      ...product,
      marketingImageUrls: marketingImagesByProduct.get(product.id) ?? [],
    })),
  })
}
