import assert from 'node:assert/strict'
import fs from 'node:fs'
import { NextRequest } from 'next/server'
import { prisma } from '../lib/prisma'
import { shouldShowRecommendationBadge } from '../lib/product-recommendation'
import { GET as getProducts, POST as createProduct } from '../app/api/products/route'
import { PATCH as updateProduct } from '../app/api/products/[id]/route'
import { GET as getPublicMenu } from '../app/api/public/menu/route'

type DecimalLike = { toNumber: () => number }
type ProductRecord = {
  id: string
  tenantId: string
  barcode: string
  name: string
  nameZh: string | null
  nameEn: string | null
  nameKm: string | null
  descZh: string | null
  descEn: string | null
  descKm: string | null
  spec: string | null
  sellPrice: DecimalLike
  discountPrice: DecimalLike | null
  discountEnabled: boolean
  isRecommended: boolean
  status: 'ACTIVE' | 'DISABLED'
  categoryId: string | null
  imageUrl: string | null
  imageUrls: string | null
}

const decimal = (value: number): DecimalLike => ({ toNumber: () => value })

function ownerRequest(path: string, method: 'GET' | 'POST' | 'PATCH' = 'GET', body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': 'tenant-recommendation-test',
      'x-user-id': 'owner-recommendation-test',
      'x-store-id': 'store-recommendation-test',
      'x-role': 'OWNER',
    },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  })
}

const productDelegate = prisma.product as unknown as {
  findFirst: (args: { where: Record<string, unknown> }) => Promise<ProductRecord | null>
  findMany: (args: unknown) => Promise<ProductRecord[]>
  create: (args: { data: Record<string, unknown> }) => Promise<ProductRecord>
  update: (args: { data: Record<string, unknown> }) => Promise<ProductRecord>
}
const categoryDelegate = prisma.productCategory as unknown as {
  findMany: (args: unknown) => Promise<Array<{ id: string; name: string; parentId: string | null; sortOrder: number }>>
}
const storeDelegate = prisma.store as unknown as {
  findUnique: (args: unknown) => Promise<Record<string, unknown>>
}
const marketingDelegate = prisma.marketingProductPage as unknown as {
  findMany: (args: unknown) => Promise<unknown[]>
}
const mutablePrisma = prisma as unknown as {
  $queryRaw: (...args: unknown[]) => Promise<Record<string, unknown>[]>
}

const originals = {
  productFindFirst: productDelegate.findFirst,
  productFindMany: productDelegate.findMany,
  productCreate: productDelegate.create,
  productUpdate: productDelegate.update,
  categoryFindMany: categoryDelegate.findMany,
  storeFindUnique: storeDelegate.findUnique,
  marketingFindMany: marketingDelegate.findMany,
  queryRaw: mutablePrisma.$queryRaw,
}

let product: ProductRecord = {
  id: 'product-recommendation-test',
  tenantId: 'tenant-recommendation-test',
  barcode: 'REC-001',
  name: 'Alpha product',
  nameZh: null,
  nameEn: null,
  nameKm: null,
  descZh: null,
  descEn: null,
  descKm: null,
  spec: null,
  sellPrice: decimal(10),
  discountPrice: null,
  discountEnabled: false,
  isRecommended: false,
  status: 'ACTIVE',
  categoryId: 'category-recommendation-test',
  imageUrl: null,
  imageUrls: null,
}

async function main() {
  // Case 1: being first in a category is irrelevant when the explicit flag is false.
  const firstInCategory = { ...product, isRecommended: false }
  assert.equal(shouldShowRecommendationBadge(firstInCategory), false)

  // Case 2: a later product displays the badge when the explicit flag is true.
  const secondInCategory = { ...product, name: 'Beta product', isRecommended: true }
  assert.equal(shouldShowRecommendationBadge(secondInCategory), true)

  // Case 3: discount state does not imply recommendation.
  const discountOnly = { ...product, discountEnabled: true, discountPrice: decimal(8), isRecommended: false }
  assert.equal(discountOnly.discountEnabled, true)
  assert.equal(shouldShowRecommendationBadge(discountOnly), false)

  // Case 4: discount and recommendation can coexist independently.
  const discountAndRecommendation = { ...discountOnly, isRecommended: true }
  assert.equal(discountAndRecommendation.discountEnabled, true)
  assert.equal(shouldShowRecommendationBadge(discountAndRecommendation), true)

  productDelegate.findFirst = async ({ where }) => {
    if (where.id === product.id || where.barcode === product.barcode) return product
    return null
  }
  productDelegate.findMany = async () => [product]
  productDelegate.update = async ({ data }) => {
    product = { ...product, ...data }
    return product
  }
  productDelegate.create = async ({ data }) => ({
    ...product,
    id: 'created-recommendation-test',
    barcode: String(data.barcode),
    name: String(data.name),
    sellPrice: decimal(Number(data.sellPrice)),
    discountPrice: data.discountPrice == null ? null : decimal(Number(data.discountPrice)),
    discountEnabled: data.discountEnabled === true,
    isRecommended: data.isRecommended === true,
    categoryId: typeof data.categoryId === 'string' ? data.categoryId : null,
  })
  categoryDelegate.findMany = async () => [{
    id: 'category-recommendation-test',
    name: 'Category',
    parentId: null,
    sortOrder: 0,
  }]
  storeDelegate.findUnique = async () => ({
    id: 'store-recommendation-test',
    name: 'Recommendation Test Store',
    status: 'ACTIVE',
    tenantId: 'tenant-recommendation-test',
    bannerUrl: null,
    announcement: null,
    promoText: null,
    businessType: 'GENERAL',
    currencyCode: 'USD',
  })
  marketingDelegate.findMany = async () => []
  mutablePrisma.$queryRaw = async () => [{
    id: 'store-recommendation-test',
    contactPhone: null,
    contactTelegram: null,
    contactWhatsApp: null,
    storeAddress: null,
    storeLat: null,
    storeLng: null,
  }]

  try {
    // Case 5: OWNER false -> true persists and is returned by the authenticated product API.
    const enableResponse = await updateProduct(
      ownerRequest(`/api/products/${product.id}`, 'PATCH', { isRecommended: true }),
      { params: Promise.resolve({ id: product.id }) },
    )
    assert.equal(enableResponse.status, 200)
    assert.equal((await enableResponse.json()).isRecommended, true)
    const rereadResponse = await getProducts(ownerRequest(`/api/products?barcode=${product.barcode}`))
    assert.equal((await rereadResponse.json()).isRecommended, true)

    // Case 6: OWNER true -> false reaches the public menu DTO and removes the badge decision.
    const disableResponse = await updateProduct(
      ownerRequest(`/api/products/${product.id}`, 'PATCH', { isRecommended: false }),
      { params: Promise.resolve({ id: product.id }) },
    )
    assert.equal(disableResponse.status, 200)
    assert.equal((await disableResponse.json()).isRecommended, false)
    const menuResponse = await getPublicMenu(new NextRequest('http://localhost/api/public/menu?code=REC-STORE'))
    assert.equal(menuResponse.status, 200)
    const menuBody = await menuResponse.json()
    assert.equal(menuBody.products[0].isRecommended, false)
    assert.equal(shouldShowRecommendationBadge(menuBody.products[0]), false)

    // Compatibility check: create accepts an explicit recommendation value.
    const createResponse = await createProduct(ownerRequest('/api/products', 'POST', {
      barcode: 'REC-NEW',
      name: 'Created recommended product',
      sellPrice: 12,
      isRecommended: true,
    }))
    assert.equal(createResponse.status, 201)
    assert.equal((await createResponse.json()).isRecommended, true)

    // Compatibility check: bulk import neither opts products in nor overwrites an existing flag.
    const importSource = fs.readFileSync('app/api/products/import/confirm/route.ts', 'utf8')
    assert.doesNotMatch(importSource, /isRecommended/)
    const migration = fs.readFileSync('prisma/migrations/20260825090000_add_product_is_recommended/migration.sql', 'utf8')
    assert.match(migration, /"isRecommended" BOOLEAN NOT NULL DEFAULT false/)
  } finally {
    productDelegate.findFirst = originals.productFindFirst
    productDelegate.findMany = originals.productFindMany
    productDelegate.create = originals.productCreate
    productDelegate.update = originals.productUpdate
    categoryDelegate.findMany = originals.categoryFindMany
    storeDelegate.findUnique = originals.storeFindUnique
    marketingDelegate.findMany = originals.marketingFindMany
    mutablePrisma.$queryRaw = originals.queryRaw
  }

  console.log('product recommendation V0.1: 8 cases passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
