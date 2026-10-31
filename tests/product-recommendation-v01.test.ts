import assert from 'node:assert/strict'
import fs from 'node:fs'
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
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
  printKitchenTicket: boolean
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
  findFirst: (args: unknown) => Promise<Record<string, unknown> | null>
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
  storeFindFirst: storeDelegate.findFirst,
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
  printKitchenTicket: true,
  status: 'ACTIVE',
  categoryId: 'category-recommendation-test',
  imageUrl: null,
  imageUrls: null,
}
let storeBusinessType = 'GENERAL'
let raceBarcodeVisible: string | null = null

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
    if (raceBarcodeVisible && where.barcode === raceBarcodeVisible) return product
    if (Array.isArray(where.OR) && where.OR.some((condition) => (
      condition && typeof condition === 'object' && (condition as { barcode?: unknown }).barcode === product.barcode
    ))) return product
    return null
  }
  productDelegate.findMany = async () => [product]
  productDelegate.update = async ({ data }) => {
    if (data.barcode === 'REC-PATCH-RACE') {
      raceBarcodeVisible = 'REC-PATCH-RACE'
      throw new Prisma.PrismaClientKnownRequestError('simulated concurrent primary-barcode conflict', {
        code: 'P2002', clientVersion: 'test', meta: { modelName: 'Product' },
      })
    }
    product = { ...product, ...data }
    return product
  }
  productDelegate.create = async ({ data }) => {
    if (data.barcode === 'REC-POST-RACE') {
      raceBarcodeVisible = 'REC-POST-RACE'
      throw new Prisma.PrismaClientKnownRequestError('simulated concurrent primary-barcode conflict', {
        code: 'P2002', clientVersion: 'test', meta: { modelName: 'Product' },
      })
    }
    return {
      ...product,
      id: 'created-recommendation-test',
      barcode: String(data.barcode),
      name: String(data.name),
      sellPrice: decimal(Number(data.sellPrice)),
      discountPrice: data.discountPrice == null ? null : decimal(Number(data.discountPrice)),
      discountEnabled: data.discountEnabled === true,
      isRecommended: data.isRecommended === true,
      printKitchenTicket: data.printKitchenTicket !== false,
      categoryId: typeof data.categoryId === 'string' ? data.categoryId : null,
    }
  }
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
  storeDelegate.findFirst = async () => ({ businessType: storeBusinessType })
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
    const rereadBody = await rereadResponse.json()
    assert.equal(rereadBody.isRecommended, true)
    assert.equal('primaryBarcode' in rereadBody, false, 'GENERAL product response must retain its legacy DTO')
    assert.equal('multiUnitEligible' in rereadBody, false, 'GENERAL product response must not expose multi-unit fields')

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

    // Kitchen routing is an independent OWNER-controlled product attribute.
    const disableKitchenResponse = await updateProduct(
      ownerRequest(`/api/products/${product.id}`, 'PATCH', { printKitchenTicket: false }),
      { params: Promise.resolve({ id: product.id }) },
    )
    assert.equal(disableKitchenResponse.status, 200)
    assert.equal((await disableKitchenResponse.json()).printKitchenTicket, false)
    const kitchenReread = await getProducts(ownerRequest(`/api/products?barcode=${product.barcode}`))
    assert.equal((await kitchenReread.json()).printKitchenTicket, false)

    const compatibleCreate = await createProduct(ownerRequest('/api/products', 'POST', {
      barcode: 'REC-KITCHEN-DEFAULT', name: 'Kitchen default product', sellPrice: 5,
    }))
    assert.equal(compatibleCreate.status, 201)
    assert.equal((await compatibleCreate.json()).printKitchenTicket, true)

    const duplicateCreate = await createProduct(ownerRequest('/api/products', 'POST', {
      barcode: product.barcode, name: 'Duplicate main barcode', sellPrice: 5,
    }))
    assert.equal(duplicateCreate.status, 409)
    assert.equal((await duplicateCreate.json()).error, 'BARCODE_EXISTS')

    const duplicatePatch = await updateProduct(
      ownerRequest(`/api/products/${product.id}`, 'PATCH', { barcode: product.barcode }),
      { params: Promise.resolve({ id: product.id }) },
    )
    assert.equal(duplicatePatch.status, 409)
    assert.equal((await duplicatePatch.json()).error, 'DUPLICATE_BARCODE')

    raceBarcodeVisible = null
    const concurrentDuplicateCreate = await createProduct(ownerRequest('/api/products', 'POST', {
      barcode: 'REC-POST-RACE', name: 'Concurrent duplicate main barcode', sellPrice: 5,
    }))
    assert.equal(concurrentDuplicateCreate.status, 409)
    assert.equal((await concurrentDuplicateCreate.json()).error, 'BARCODE_EXISTS')

    raceBarcodeVisible = null
    const concurrentDuplicatePatch = await updateProduct(
      ownerRequest(`/api/products/${product.id}`, 'PATCH', { barcode: 'REC-PATCH-RACE' }),
      { params: Promise.resolve({ id: product.id }) },
    )
    assert.equal(concurrentDuplicatePatch.status, 409)
    assert.equal((await concurrentDuplicatePatch.json()).error, 'DUPLICATE_BARCODE')
    raceBarcodeVisible = null

    const nonRetailMultiUnit = await createProduct(ownerRequest('/api/products', 'POST', {
      barcode: 'REC-GENERAL-AUX', name: 'General auxiliary blocked', sellPrice: 5,
      auxUnitName: 'case', auxBarcode: 'REC-GENERAL-AUX-CASE', auxConversionFactor: 12,
      auxSellPrice: 25, auxEnabled: true,
    }))
    assert.equal(nonRetailMultiUnit.status, 403)
    assert.equal((await nonRetailMultiUnit.json()).error, 'MULTI_UNIT_NOT_AVAILABLE')

    storeBusinessType = 'RETAIL'
    const retailMultiUnit = await createProduct(ownerRequest('/api/products', 'POST', {
      barcode: 'REC-RETAIL-MAIN', name: 'Retail auxiliary enabled', sellPrice: 2.5,
      mainUnitName: 'bottle', auxUnitName: 'case', auxBarcode: 'REC-RETAIL-AUX',
      auxConversionFactor: 12, auxSellPrice: 11.25, auxEnabled: true,
    }))
    assert.equal(retailMultiUnit.status, 201)
    const retailBody = await retailMultiUnit.json()
    assert.deepEqual(
      [retailBody.mainUnitName, retailBody.auxUnitName, retailBody.auxBarcode, retailBody.auxConversionFactor, retailBody.auxSellPrice, retailBody.auxEnabled],
      ['bottle', 'case', 'REC-RETAIL-AUX', 12, 11.25, true],
    )
    storeBusinessType = 'GENERAL'

    const invalidKitchenFlag = await createProduct(ownerRequest('/api/products', 'POST', {
      barcode: 'REC-KITCHEN-INVALID', name: 'Invalid kitchen flag', sellPrice: 5,
      printKitchenTicket: 'false',
    }))
    assert.equal(invalidKitchenFlag.status, 400)
    assert.equal((await invalidKitchenFlag.json()).error, 'INVALID_PRINT_KITCHEN_TICKET')

    // Compatibility check: bulk import neither opts products in nor overwrites an existing flag.
    const importSource = fs.readFileSync('app/api/products/import/confirm/route.ts', 'utf8')
    assert.doesNotMatch(importSource, /isRecommended/)
    assert.doesNotMatch(importSource, /printKitchenTicket/)
    const photoMatchSource = fs.readFileSync('app/api/products/photo-recognize-draft/route.ts', 'utf8')
    assert.match(photoMatchSource, /printKitchenTicket: true/)
    assert.match(photoMatchSource, /printKitchenTicket: p\.printKitchenTicket/)
    const productPageSource = fs.readFileSync('app/products/page.tsx', 'utf8')
    assert.match(productPageSource, /printKitchenTicket: match\.printKitchenTicket/)
    const migration = fs.readFileSync('prisma/migrations/20260825090000_add_product_is_recommended/migration.sql', 'utf8')
    assert.match(migration, /"isRecommended" BOOLEAN NOT NULL DEFAULT false/)
    const kitchenMigration = fs.readFileSync('prisma/migrations/20260914143000_add_kitchen_item_routing/migration.sql', 'utf8')
    assert.match(kitchenMigration, /"printKitchenTicket" BOOLEAN NOT NULL DEFAULT true/)
    assert.match(kitchenMigration, /"kitchenJobSuppressed" BOOLEAN NOT NULL DEFAULT false/)
  } finally {
    productDelegate.findFirst = originals.productFindFirst
    productDelegate.findMany = originals.productFindMany
    productDelegate.create = originals.productCreate
    productDelegate.update = originals.productUpdate
    categoryDelegate.findMany = originals.categoryFindMany
    storeDelegate.findUnique = originals.storeFindUnique
    storeDelegate.findFirst = originals.storeFindFirst
    marketingDelegate.findMany = originals.marketingFindMany
    mutablePrisma.$queryRaw = originals.queryRaw
  }

  console.log('product recommendation and kitchen routing attributes: cases passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
