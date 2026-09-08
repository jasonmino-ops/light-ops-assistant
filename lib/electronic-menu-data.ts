import { prisma } from '@/lib/prisma'
import {
  isValidMenuCode,
  type ElectronicMenuCategory,
  type ElectronicMenuData,
  type ElectronicMenuProduct,
} from '@/lib/electronic-menu'

const STORE_SELECT = {
  code: true, name: true, status: true, tenantId: true,
  currencyCode: true, announcement: true, promoText: true, bannerUrl: true,
} as const
const PRODUCT_SELECT = {
  id: true, name: true, nameZh: true, nameEn: true, nameKm: true,
  descZh: true, descEn: true, descKm: true, spec: true,
  sellPrice: true, discountPrice: true, discountEnabled: true, isRecommended: true,
  categoryId: true, imageUrl: true, imageUrls: true,
} as const
const CATEGORY_SELECT = { id: true, name: true, parentId: true, sortOrder: true } as const

type MenuStoreRecord = ElectronicMenuData['store'] & { status: string; tenantId: string }
type MenuProductRecord = Omit<ElectronicMenuProduct, 'price' | 'originalPrice' | 'imageUrls'> & {
  sellPrice: { toNumber(): number }
  discountPrice: { toNumber(): number } | null
  imageUrls: string | null
}

// A read-only structural subset of the existing singleton, injectable for tests.
// It deliberately contains no write delegate, contact, marketing or POS query.
export type ElectronicMenuDatabase = {
  store: {
    findUnique(args: { where: { code: string }; select: typeof STORE_SELECT }): Promise<MenuStoreRecord | null>
  }
  product: {
    findMany(args: {
      where: { tenantId: string; status: 'ACTIVE' }
      select: typeof PRODUCT_SELECT
      orderBy: { name: 'asc' }
      take: number
    }): Promise<MenuProductRecord[]>
  }
  productCategory: {
    findMany(args: {
      where: { tenantId: string }
      select: typeof CATEGORY_SELECT
      orderBy: Array<{ sortOrder: 'asc' } | { name: 'asc' }>
    }): Promise<ElectronicMenuCategory[]>
  }
}

function productImageUrls(imageUrls: string | null, imageUrl: string | null): string[] {
  // Preserve /api/public/menu's stored-media fallback and three-image limit.
  try {
    const parsed = imageUrls ? JSON.parse(imageUrls) : []
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.filter((value): value is string => typeof value === 'string' && !!value.trim()).slice(0, 3)
    }
  } catch {}
  return imageUrl ? [imageUrl] : []
}

export async function loadElectronicMenu(
  code: string,
  db: ElectronicMenuDatabase = prisma,
): Promise<ElectronicMenuData | null> {
  if (!isValidMenuCode(code)) return null
  const store = await db.store.findUnique({ where: { code }, select: STORE_SELECT })
  if (!store || store.status !== 'ACTIVE') return null

  // Products/categories belong to the tenant in the existing catalog model.
  // Stores within one tenant intentionally share this catalog; no storeId
  // product ownership or second menu catalog is introduced here.
  const [products, categories] = await Promise.all([
    db.product.findMany({
      where: { tenantId: store.tenantId, status: 'ACTIVE' },
      select: PRODUCT_SELECT,
      orderBy: { name: 'asc' },
      take: 200,
    }),
    db.productCategory.findMany({
      where: { tenantId: store.tenantId },
      select: CATEGORY_SELECT,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
  ])

  return {
    store: {
      code: store.code,
      name: store.name,
      currencyCode: store.currencyCode ?? 'USD',
      announcement: store.announcement ?? null,
      promoText: store.promoText ?? null,
      bannerUrl: store.bannerUrl ?? null,
    },
    products: products.map((product) => ({
      id: product.id,
      name: product.name,
      nameZh: product.nameZh ?? null,
      nameEn: product.nameEn ?? null,
      nameKm: product.nameKm ?? null,
      descZh: product.descZh ?? null,
      descEn: product.descEn ?? null,
      descKm: product.descKm ?? null,
      spec: product.spec ?? null,
      price: product.discountEnabled && product.discountPrice ? product.discountPrice.toNumber() : product.sellPrice.toNumber(),
      originalPrice: product.sellPrice.toNumber(),
      discountEnabled: product.discountEnabled && !!product.discountPrice,
      isRecommended: product.isRecommended,
      categoryId: product.categoryId ?? null,
      imageUrl: product.imageUrl ?? null,
      imageUrls: productImageUrls(product.imageUrls, product.imageUrl),
    })),
    categories: categories.map((category) => ({
      id: category.id,
      name: category.name,
      parentId: category.parentId ?? null,
      sortOrder: category.sortOrder,
    })),
  }
}
