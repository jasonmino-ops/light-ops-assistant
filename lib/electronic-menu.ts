import type { PublicMenuCatalog, PublicMenuProduct, PublicMenuCategory } from '@/lib/public-menu-data'

export type MenuLang = 'zh' | 'en' | 'km'

export type ElectronicMenuProduct = PublicMenuProduct
export type ElectronicMenuCategory = PublicMenuCategory

export type ElectronicMenuData = {
  store: {
    code: string
    name: string
    currencyCode: string
    announcement: string | null
    promoText: string | null
    bannerUrl: string | null
  }
  products: ElectronicMenuProduct[]
  categories: ElectronicMenuCategory[]
}

// The public H5 response additionally contains contacts/customer binding/marketing.
// This adapter only narrows the shared catalog; it does not recalculate business values.
export function projectElectronicMenuData(catalog: PublicMenuCatalog): ElectronicMenuData {
  const { store, products, categories } = catalog
  return {
    store: {
      code: store.code, name: store.name, currencyCode: store.currencyCode ?? 'USD',
      announcement: store.announcement ?? null, promoText: store.promoText ?? null,
      bannerUrl: store.bannerUrl ?? null,
    },
    products,
    categories,
  }
}

export const MENU_REFRESH_MS = 30_000

export function isElectronicMenuPath(path: string): boolean {
  return path === '/electronic-menu' || path.startsWith('/electronic-menu/')
}

export function isValidMenuCode(code: unknown): code is string {
  return typeof code === 'string' && code.length > 0 && code.length <= 64
    && /^[A-Za-z0-9]/.test(code) && !/[^A-Za-z0-9_-]/.test(code)
}

export function electronicMenuPath(code: string, lang: MenuLang): string | null {
  if (!isValidMenuCode(code) || !['zh', 'en', 'km'].includes(lang)) return null
  return `/electronic-menu?code=${encodeURIComponent(code)}&lang=${lang}`
}

export function menuProductName(product: ElectronicMenuProduct, lang: MenuLang): string {
  if (lang === 'en') return product.nameEn || product.nameZh || product.name
  if (lang === 'km') return product.nameKm || product.nameZh || product.name
  return product.nameZh || product.name
}

export function menuProductDescription(product: ElectronicMenuProduct, lang: MenuLang): string | null {
  if (lang === 'en') return product.descEn || product.descZh || null
  if (lang === 'km') return product.descKm || product.descZh || null
  return product.descZh || null
}

// The existing catalog stores one category name. Match /menu's display fallback
// without inventing translated database fields or changing the catalog itself.
const CATEGORY_LABELS: Record<string, Record<MenuLang, string>> = {
  '全部': { zh: '全部商品', en: 'All Items', km: 'ទំនិញទាំងអស់' },
  '全部商品': { zh: '全部商品', en: 'All Items', km: 'ទំនិញទាំងអស់' },
  '其他': { zh: '其他', en: 'Others', km: 'ផ្សេងៗ' },
  '主食': { zh: '主食', en: 'Main', km: 'អាហារសំខាន់' },
  '主菜': { zh: '主菜', en: 'Main', km: 'អាហារសំខាន់' },
  '套餐': { zh: '套餐', en: 'Combo', km: 'ឈុត' },
  '米饭': { zh: '米饭', en: 'Rice', km: 'បាយ' },
  '面条': { zh: '面条', en: 'Noodles', km: 'មី' },
  '面食': { zh: '面食', en: 'Noodles', km: 'មី' },
  '小吃': { zh: '小吃', en: 'Snacks', km: 'អាហារសម្រន់' },
  '零食': { zh: '零食', en: 'Snacks', km: 'អាហារសម្រន់' },
  '炒菜': { zh: '炒菜', en: 'Stir-fry', km: 'បំពង' },
  '烧烤': { zh: '烧烤', en: 'BBQ', km: 'អាំង' },
  '凉菜': { zh: '凉菜', en: 'Cold Dishes', km: 'អាហារត្រជាក់' },
  '汤': { zh: '汤', en: 'Soup', km: 'ស៊ុប' },
  '汤类': { zh: '汤类', en: 'Soup', km: 'ស៊ុប' },
  '饮料': { zh: '饮料', en: 'Drinks', km: 'ភេសជ្ជៈ' },
  '酒水': { zh: '酒水', en: 'Beverages', km: 'ភេសជ្ជៈ' },
  '咖啡': { zh: '咖啡', en: 'Coffee', km: 'កាហ្វេ' },
  '奶茶': { zh: '奶茶', en: 'Milk Tea', km: 'តែទឹកដោះ' },
  '果汁': { zh: '果汁', en: 'Juice', km: 'ទឹកផ្លែឈើ' },
  '甜品': { zh: '甜品', en: 'Dessert', km: 'បង្អែម' },
  '蛋糕': { zh: '蛋糕', en: 'Cake', km: 'នំខេក' },
  '面包': { zh: '面包', en: 'Bread', km: 'នំប៉័ង' },
  '日化用品': { zh: '日化用品', en: 'Daily Goods', km: 'ប្រើប្រាស់ប្រចាំថ្ងៃ' },
  '宠物用品': { zh: '宠物用品', en: 'Pet Supplies', km: 'សម្រាប់សត្វចិញ្ចឹម' },
  '方便食品': { zh: '方便食品', en: 'Instant Food', km: 'អាហារភ្លាមៗ' },
}

export function menuCategoryLabel(name: string, lang: MenuLang): string {
  return CATEGORY_LABELS[name.trim()]?.[lang] ?? name
}

export function groupElectronicMenu(data: ElectronicMenuData, lang: MenuLang): Array<{
  id: string
  title: string
  items: ElectronicMenuProduct[]
}> {
  // Queries already supply category sortOrder/name and product name ordering.
  // Only apply the existing /menu iced-coffee priority; never sort by price,
  // recommendation, translated name or client locale.
  const parents = data.categories.filter((category) => !category.parentId).sort((a, b) => {
    const icedA = /冰咖啡|iced\s*coffee/i.test(a.name)
    const icedB = /冰咖啡|iced\s*coffee/i.test(b.name)
    return Number(icedB) - Number(icedA)
  })
  if (parents.length === 0) {
    return data.products.length > 0
      ? [{ id: '__all', title: menuCategoryLabel('全部商品', lang), items: data.products }]
      : []
  }

  const groups: Array<{ id: string; title: string; items: ElectronicMenuProduct[] }> = []
  const included = new Set<string>()
  for (const parent of parents) {
    const categoryIds = new Set([
      parent.id,
      ...data.categories.filter((category) => category.parentId === parent.id).map((category) => category.id),
    ])
    const items = data.products.filter((product) => product.categoryId !== null && categoryIds.has(product.categoryId))
    if (items.length > 0) {
      groups.push({ id: parent.id, title: menuCategoryLabel(parent.name, lang), items })
      items.forEach((product) => included.add(product.id))
    }
  }

  // Keep every active product visible, including historical orphan categories.
  const others = data.products.filter((product) => !included.has(product.id))
  if (others.length > 0) groups.push({ id: '__other', title: menuCategoryLabel('其他', lang), items: others })
  return groups
}
