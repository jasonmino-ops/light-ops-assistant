import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NextRequest } from 'next/server'
import { prisma } from '../lib/prisma'
import * as menuRoute from '../app/api/public/electronic-menu/route'
import { GET as getExistingMenu } from '../app/api/public/menu/route'
import { loadElectronicMenu, type ElectronicMenuDatabase } from '../lib/electronic-menu-data'
import {
  MENU_REFRESH_MS,
  electronicMenuPath,
  groupElectronicMenu,
  isElectronicMenuPath,
  isValidMenuCode,
  menuCategoryLabel,
  menuProductDescription,
  menuProductName,
  type ElectronicMenuData,
  type MenuLang,
} from '../lib/electronic-menu'
import { shouldShowRecommendationBadge } from '../lib/product-recommendation'

type StoreRow = NonNullable<Awaited<ReturnType<ElectronicMenuDatabase['store']['findUnique']>>>
type ProductRow = Awaited<ReturnType<ElectronicMenuDatabase['product']['findMany']>>[number]
type CategoryRow = Awaited<ReturnType<ElectronicMenuDatabase['productCategory']['findMany']>>[number]
type FixtureProduct = ProductRow & { tenantId: string; status: string; barcode: string; imageStorageKey: string }
const decimal = (value: number) => ({ toNumber: () => value })

function product(id: string, name: string, overrides: Partial<FixtureProduct> = {}): FixtureProduct {
  return {
    id, name, tenantId: 'tenant-a', status: 'ACTIVE', barcode: 'PRIVATE_BARCODE', imageStorageKey: 'PRIVATE_KEY',
    nameZh: '中文名称', nameEn: 'English name', nameKm: 'ឈ្មោះ',
    descZh: '中文描述', descEn: 'English description', descKm: 'ការពិពណ៌នា',
    spec: 'Regular', sellPrice: decimal(10), discountPrice: null,
    discountEnabled: false, isRecommended: false, categoryId: 'drinks',
    imageUrl: 'https://images.example/product.png', imageUrls: null,
    ...overrides,
  }
}

function fixture() {
  const stores: Array<StoreRow & { id: string; contactPhone: string; storeAddress: string }> = [
    { id: 'private-store-a', code: 'STORE-A', name: 'Store A', status: 'ACTIVE', tenantId: 'tenant-a', currencyCode: 'USD', announcement: 'Announcement A', promoText: 'Promo A', bannerUrl: '/banner-a.png', contactPhone: 'PRIVATE_PHONE', storeAddress: 'PRIVATE_ADDRESS' },
    { id: 'private-store-a2', code: 'STORE-A2', name: 'Store A2', status: 'ACTIVE', tenantId: 'tenant-a', currencyCode: 'XAF', announcement: 'Announcement A2', promoText: null, bannerUrl: '/banner-a2.png', contactPhone: 'PRIVATE_PHONE', storeAddress: 'PRIVATE_ADDRESS' },
    { id: 'private-store-b', code: 'STORE-B', name: 'Store B', status: 'ACTIVE', tenantId: 'tenant-b', currencyCode: 'USD', announcement: null, promoText: null, bannerUrl: null, contactPhone: 'PRIVATE_PHONE', storeAddress: 'PRIVATE_ADDRESS' },
    { id: 'private-store-empty', code: 'EMPTY', name: 'Empty', status: 'ACTIVE', tenantId: 'tenant-empty', currencyCode: 'USD', announcement: null, promoText: null, bannerUrl: null, contactPhone: 'PRIVATE_PHONE', storeAddress: 'PRIVATE_ADDRESS' },
    { id: 'private-store-disabled', code: 'DISABLED', name: 'Disabled', status: 'DISABLED', tenantId: 'tenant-a', currencyCode: 'USD', announcement: null, promoText: null, bannerUrl: null, contactPhone: 'PRIVATE_PHONE', storeAddress: 'PRIVATE_ADDRESS' },
  ]
  const products = [
    product('z-last', 'Zulu', { isRecommended: true, discountEnabled: true, discountPrice: decimal(8) }),
    product('a-first', 'Alpha'),
    product('disabled-product', 'Hidden', { status: 'DISABLED' }),
    product('foreign-product', 'Foreign', { tenantId: 'tenant-b', categoryId: 'foreign-category' }),
  ]
  const categories: Array<CategoryRow & { tenantId: string }> = [
    { id: 'snacks', name: 'Snacks', parentId: null, sortOrder: 2, tenantId: 'tenant-a' },
    { id: 'drinks', name: '饮料', parentId: null, sortOrder: 1, tenantId: 'tenant-a' },
    { id: 'foreign-category', name: 'Foreign category', parentId: null, sortOrder: 0, tenantId: 'tenant-b' },
  ]
  const calls: Array<{ model: string; args: unknown }> = []
  const db: ElectronicMenuDatabase = {
    store: {
      async findUnique(args) {
        calls.push({ model: 'store', args })
        return stores.find((row) => row.code === args.where.code) ?? null
      },
    },
    product: {
      async findMany(args) {
        calls.push({ model: 'product', args })
        return products.filter((row) => row.tenantId === args.where.tenantId && row.status === args.where.status)
          .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).slice(0, args.take)
      },
    },
    productCategory: {
      async findMany(args) {
        calls.push({ model: 'category', args })
        return categories.filter((row) => row.tenantId === args.where.tenantId)
          .sort((a, b) => a.sortOrder - b.sortOrder || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      },
    },
  }
  return { stores, products, categories, calls, db }
}

async function withPrismaMock(db: ElectronicMenuDatabase, run: () => Promise<void>, allowLegacy = false) {
  const restore: Array<() => void> = []
  function replace(target: object, key: string, value: unknown) {
    const previous = Reflect.get(target, key)
    Reflect.set(target, key, value)
    restore.push(() => { Reflect.set(target, key, previous) })
  }
  const forbidden = () => { throw new Error('UNEXPECTED_PRIVATE_QUERY_OR_WRITE') }
  for (const delegate of [prisma.store, prisma.product, prisma.productCategory]) {
    for (const method of ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']) {
      replace(delegate, method, forbidden)
    }
  }
  replace(prisma.store, 'findUnique', db.store.findUnique)
  replace(prisma.product, 'findMany', db.product.findMany)
  replace(prisma.productCategory, 'findMany', db.productCategory.findMany)
  replace(prisma.storeCustomerContact, 'findUnique', forbidden)
  replace(prisma.marketingProductPage, 'findMany', allowLegacy ? async () => [{
    productId: 'a-first', detailImage1: 'https://images.example/OTHER_STORE_MARKETING.png',
  }] : forbidden)
  replace(prisma, '$queryRaw', allowLegacy ? async () => [] : forbidden)
  replace(prisma, '$executeRaw', forbidden)
  try {
    await run()
  } finally {
    restore.reverse().forEach((reset) => reset())
  }
}

function request(query: string, headers?: Record<string, string>) {
  return new NextRequest(`http://localhost/api/public/electronic-menu${query}`, { headers })
}

test('public URL/code validation is exact, bounded and independent of merchant identity', () => {
  assert.equal(MENU_REFRESH_MS, 30_000)
  for (const code of ['A', 'a-1_B', '1'.repeat(64)]) {
    assert.equal(isValidMenuCode(code), true)
    assert.equal(electronicMenuPath(code, 'km'), `/electronic-menu?code=${code}&lang=km`)
  }
  for (const code of ['', ' A', 'A ', 'A\n', 'A\r', 'A\t', '-A', '_A', 'a/b', 'a?b', 'a#b', 'a&b', 'a.b', '中文', 'Ａ', 'A'.repeat(65), null, undefined, 1]) {
    assert.equal(isValidMenuCode(code), false, String(code))
  }
  assert.equal(electronicMenuPath('A ', 'zh'), null)
  assert.equal(electronicMenuPath('A', 'fr' as MenuLang), null)
  assert.equal(isElectronicMenuPath('/electronic-menu'), true)
  assert.equal(isElectronicMenuPath('/electronic-menu/preview'), true)
  for (const path of ['/', '/menu', '/electronic-menu-evil', '/electronic-menus', '/foo/electronic-menu']) {
    assert.equal(isElectronicMenuPath(path), false)
  }
})

test('invalid, unknown and inactive stores fail before catalog reads; active empty store remains valid', async () => {
  const f = fixture()
  assert.equal(await loadElectronicMenu(' A', f.db), null)
  assert.equal(f.calls.length, 0)
  assert.equal(await loadElectronicMenu('UNKNOWN', f.db), null)
  assert.equal(await loadElectronicMenu('DISABLED', f.db), null)
  assert.deepEqual(f.calls.map((call) => call.model), ['store', 'store'])
  const empty = await loadElectronicMenu('EMPTY', f.db)
  assert.ok(empty)
  assert.deepEqual(empty.products, [])
  assert.deepEqual(empty.categories, [])
  assert.deepEqual(groupElectronicMenu(empty, 'en'), [])
})

test('store selection isolates tenant catalog and preserves same-tenant sharing with store-specific presentation', async () => {
  const f = fixture()
  const a = await loadElectronicMenu('STORE-A', f.db)
  const a2 = await loadElectronicMenu('STORE-A2', f.db)
  const b = await loadElectronicMenu('STORE-B', f.db)
  assert.ok(a && a2 && b)
  assert.deepEqual(a.products.map((row) => row.id), ['a-first', 'z-last'])
  assert.deepEqual(a.products, a2.products)
  assert.deepEqual(a.categories, a2.categories)
  assert.equal(a.store.name, 'Store A')
  assert.equal(a2.store.name, 'Store A2')
  assert.equal(a2.store.currencyCode, 'XAF')
  assert.equal(a2.store.announcement, 'Announcement A2')
  assert.equal(a2.store.bannerUrl, '/banner-a2.png')
  assert.deepEqual(b.products.map((row) => row.id), ['foreign-product'])
  assert.deepEqual(b.categories.map((row) => row.id), ['foreign-category'])
  assert.equal(await loadElectronicMenu('store-a', f.db), null, 'Store code is not silently case-folded')
  assert.deepEqual(a.categories.map((row) => row.id), ['drinks', 'snacks'])
})

test('only whitelisted columns are selected and projected; product ordering and 200-item bound remain unchanged', async () => {
  const f = fixture()
  for (let i = 0; i < 205; i++) f.products.push(product(`many-${i}`, `Item ${String(i).padStart(3, '0')}`))
  const data = await loadElectronicMenu('STORE-A', f.db)
  assert.ok(data)
  assert.equal(data.products.length, 200)
  assert.equal(data.products[0].name, 'Alpha')
  assert.equal(data.products[199].name, 'Item 198')
  assert.deepEqual(f.calls, [
    { model: 'store', args: { where: { code: 'STORE-A' }, select: { code: true, name: true, status: true, tenantId: true, currencyCode: true, announcement: true, promoText: true, bannerUrl: true } } },
    { model: 'product', args: { where: { tenantId: 'tenant-a', status: 'ACTIVE' }, select: { id: true, name: true, nameZh: true, nameEn: true, nameKm: true, descZh: true, descEn: true, descKm: true, spec: true, sellPrice: true, discountPrice: true, discountEnabled: true, isRecommended: true, categoryId: true, imageUrl: true, imageUrls: true }, orderBy: { name: 'asc' }, take: 200 } },
    { model: 'category', args: { where: { tenantId: 'tenant-a' }, select: { id: true, name: true, parentId: true, sortOrder: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] } },
  ])
  assert.deepEqual(Object.keys(data).sort(), ['categories', 'products', 'store'])
  assert.deepEqual(Object.keys(data.store).sort(), ['announcement', 'bannerUrl', 'code', 'currencyCode', 'name', 'promoText'])
  assert.deepEqual(Object.keys(data.products[0]).sort(), ['categoryId', 'descEn', 'descKm', 'descZh', 'discountEnabled', 'id', 'imageUrl', 'imageUrls', 'isRecommended', 'name', 'nameEn', 'nameKm', 'nameZh', 'originalPrice', 'price', 'spec'])
  assert.deepEqual(Object.keys(data.categories[0]).sort(), ['id', 'name', 'parentId', 'sortOrder'])
  assert.doesNotMatch(JSON.stringify(data), /PRIVATE_|tenantId|storeId|customerBound|marketingImageUrls|contactPhone|storeAddress|barcode|imageStorageKey/)
})

test('actual legacy GET and the new loader have identical catalog, discount and stored-media projections', async () => {
  const f = fixture()
  f.products.push(
    product('discount-off', 'Beta', { discountPrice: decimal(4), discountEnabled: false }),
    product('discount-missing', 'Gamma', { discountEnabled: true }),
    product('discount-zero', 'Omega', { discountPrice: decimal(0), discountEnabled: true }),
    product('images-list', 'Image A', { imageUrls: JSON.stringify(['', 2, 'https://images.example/animated.gif', 'https://images.example/2.png', 'https://images.example/3.webp', 'https://images.example/4.png']) }),
    product('images-malformed', 'Image B', { imageUrls: '{bad json' }),
    product('images-empty', 'Image C', { imageUrls: '[]' }),
    product('images-invalid', 'Image D', { imageUrls: '[false, " "]' }),
    product('no-image', 'Image E', { imageUrl: null, imageUrls: null }),
  )
  await withPrismaMock(f.db, async () => {
    const current = await loadElectronicMenu('STORE-A')
    assert.ok(current)
    const legacyResponse = await getExistingMenu(new NextRequest('http://localhost/api/public/menu?code=STORE-A'))
    const legacy = await legacyResponse.json()
    assert.equal(legacyResponse.status, 200)
    assert.deepEqual(current.categories, legacy.categories)
    assert.deepEqual(current.products, legacy.products.map((row: Record<string, unknown>) => {
      const { marketingImageUrls: _marketingImages, ...catalogProduct } = row
      return catalogProduct
    }))
    assert.ok(legacy.products.find((row: { id: string }) => row.id === 'a-first').marketingImageUrls.length > 0)
    assert.equal(current.products.find((row) => row.id === 'z-last')?.price, 8)
    assert.equal(current.products.find((row) => row.id === 'discount-off')?.price, 10)
    assert.equal(current.products.find((row) => row.id === 'discount-missing')?.discountEnabled, false)
    assert.equal(current.products.find((row) => row.id === 'discount-zero')?.price, 0, 'Existing Decimal-object semantics are preserved')
    assert.deepEqual(current.products.find((row) => row.id === 'images-list')?.imageUrls, ['https://images.example/animated.gif', 'https://images.example/2.png', 'https://images.example/3.webp'])
    assert.deepEqual(current.products.find((row) => row.id === 'images-invalid')?.imageUrls, [])
  }, true)
})

test('grouping retains product/category order, iced-coffee priority and every orphan product', async () => {
  const f = fixture()
  const base = await loadElectronicMenu('STORE-A', f.db)
  assert.ok(base)
  const data: ElectronicMenuData = {
    ...base,
    categories: [
      { id: 'drinks', name: '饮料', parentId: null, sortOrder: 0 },
      { id: 'child', name: '果汁', parentId: 'drinks', sortOrder: 1 },
      { id: 'iced', name: 'Iced Coffee', parentId: null, sortOrder: 2 },
      { id: 'snacks', name: '小吃', parentId: null, sortOrder: 3 },
      { id: 'orphan', name: 'Orphan', parentId: 'missing-parent', sortOrder: 4 },
    ],
    products: ['drinks', 'child', 'iced', 'orphan', 'missing-category', null].map((categoryId, index) => ({
      ...base.products[0], id: `p${index}`, name: `Product ${index}`, categoryId, isRecommended: index === 1,
    })),
  }
  const original = JSON.stringify(data)
  const groups = groupElectronicMenu(data, 'en')
  assert.deepEqual(groups.map((group) => [group.id, group.title, group.items.map((item) => item.id)]), [
    ['iced', 'Iced Coffee', ['p2']], ['drinks', 'Drinks', ['p0', 'p1']], ['__other', 'Others', ['p3', 'p4', 'p5']],
  ])
  assert.equal(JSON.stringify(data), original, 'Grouping must not mutate the input snapshot')
  assert.deepEqual(groupElectronicMenu({ ...data, categories: [] }, 'km')[0].items, data.products)
  assert.equal(groupElectronicMenu({ ...data, categories: [] }, 'km')[0].title, 'ទំនិញទាំងអស់')
  assert.equal(shouldShowRecommendationBadge(groups[1].items[0]), false)
  assert.equal(shouldShowRecommendationBadge(groups[1].items[1]), true)
})

test('three-language display falls back exactly to Chinese and original catalog values', async () => {
  const data = await loadElectronicMenu('STORE-A', fixture().db)
  assert.ok(data)
  const p = data.products[0]
  assert.deepEqual(['zh', 'en', 'km'].map((lang) => menuProductName(p, lang as MenuLang)), ['中文名称', 'English name', 'ឈ្មោះ'])
  assert.equal(menuProductName({ ...p, nameEn: '' }, 'en'), '中文名称')
  assert.equal(menuProductName({ ...p, nameKm: null, nameZh: null }, 'km'), 'Alpha')
  assert.equal(menuProductName({ ...p, nameZh: null }, 'zh'), 'Alpha')
  assert.equal(menuProductName({ ...p, nameEn: ' ' }, 'en'), ' ')
  assert.equal(menuProductDescription(p, 'km'), 'ការពិពណ៌នា')
  assert.equal(menuProductDescription({ ...p, descEn: null }, 'en'), '中文描述')
  assert.equal(menuProductDescription({ ...p, descKm: null, descZh: null }, 'km'), null)
  assert.equal(menuCategoryLabel(' 饮料 ', 'en'), 'Drinks')
  assert.equal(menuCategoryLabel('Custom category ', 'km'), 'Custom category ')
})

test('GET rejects ambiguous selectors and malformed codes before any query, with no-store errors', async () => {
  const f = fixture()
  const invalidQueries = ['', '?code=', '?code=A&code=B', '?code=A&code=A', '?code=STORE-A&storeId=private-store-b', '?code=STORE-A&tenantId=tenant-b', '?code=STORE-A&storeCode=STORE-B', '?code=STORE-A&tgId=1', '?code=STORE-A&token=secret', '?code=STORE-A&lang=en', '?code=STORE-A&unknown=1', '?code=%20STORE-A', '?code=STORE-A%20', '?code=STORE-A%0A', '?code=%2FSTORE-A', '?code=%FF', `?code=${'A'.repeat(65)}`]
  await withPrismaMock(f.db, async () => {
    for (const query of invalidQueries) {
      const response = await menuRoute.GET(request(query))
      assert.equal(response.status, 400, query)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      assert.deepEqual(await response.json(), { error: 'INVALID_REQUEST' })
    }
  })
  assert.equal(f.calls.length, 0)
})

test('anonymous repeat GET refreshes data without writes or identity-based selection', async () => {
  const f = fixture()
  await withPrismaMock(f.db, async () => {
    const spoofedIdentity = { authorization: 'Bearer other-tenant', cookie: 'auth-session=other-store', 'x-tenant-id': 'tenant-b', 'x-store-id': 'private-store-b', 'x-role': 'OWNER' }
    const first = await menuRoute.GET(request('?code=STORE-A', spoofedIdentity))
    assert.equal(first.status, 200)
    assert.equal(first.headers.get('cache-control'), 'no-store')
    const firstData = await first.json()
    assert.equal(firstData.store.code, 'STORE-A')
    assert.deepEqual(firstData.products.map((row: { id: string }) => row.id), ['a-first', 'z-last'])
    f.products.find((row) => row.id === 'a-first')!.sellPrice = decimal(12)
    f.products.find((row) => row.id === 'z-last')!.status = 'DISABLED'
    const second = await menuRoute.GET(request('?code=STORE-A'))
    const updated = await second.json()
    assert.equal(updated.products[0].price, 12)
    assert.deepEqual(updated.products.map((row: { id: string }) => row.id), ['a-first'])
    f.stores[0].status = 'DISABLED'
    const disabled = await menuRoute.GET(request('?code=STORE-A'))
    assert.equal(disabled.status, 404)
    assert.deepEqual(await disabled.json(), { error: 'STORE_NOT_FOUND' })
    const unknown = await menuRoute.GET(request('?code=UNKNOWN'))
    assert.equal(unknown.status, 404)
    assert.equal(unknown.headers.get('cache-control'), 'no-store')
  })
  assert.deepEqual(f.calls.map((call) => call.model), ['store', 'product', 'category', 'store', 'product', 'category', 'store', 'store'])
  assert.deepEqual(Object.keys(menuRoute), ['GET'], 'Only GET is implemented; Next handles unsupported methods')
})

test('database failures produce generic retryable errors without leaking internal details', async () => {
  for (const failingModel of ['store', 'product', 'productCategory'] as const) {
    const f = fixture()
    const fail = async () => { throw new Error('INTERNAL_DATABASE_URL tenant-secret raw SQL') }
    if (failingModel === 'store') f.db.store.findUnique = fail
    else f.db[failingModel].findMany = fail
    await withPrismaMock(f.db, async () => {
      const response = await menuRoute.GET(request('?code=STORE-A'))
      assert.equal(response.status, 503)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      assert.deepEqual(await response.json(), { error: 'MENU_UNAVAILABLE' })
    })
  }
})
