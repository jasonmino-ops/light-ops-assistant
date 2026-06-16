'use client'

export const CASHIER_OFFLINE_DB_NAME = 'light_ops_cashier_offline'
export const CASHIER_OFFLINE_DB_VERSION = 1
export const CASHIER_CACHE_VERSION = 'cashier-offline-01'

const PRODUCT_STORE = 'cashier_products'
const META_STORE = 'cashier_meta'
const DEVICE_ID_KEY = 'cashier:deviceId'

export type CashierCachedProductInput = {
  id: string
  barcode: string
  name: string
  spec: string | null
  sellPrice: number
  categoryId: string | null
  categoryName?: string | null
  imageUrl: string | null
  status?: string
  updatedAt?: string | null
}

export type CashierCachedProduct = {
  cacheKey: string
  tenantId: string
  storeId: string
  storeCode: string
  productId: string
  name: string
  spec: string | null
  barcode: string
  price: number
  category: string | null
  categoryId: string | null
  status: string
  imageUrl: string | null
  updatedAt: string | null
  cachedAt: string
  cacheVersion: string
}

export type CashierProductCacheMeta = {
  storeCode: string
  storeId: string
  tenantId: string
  lastProductCacheAt: string
  productCount: number
  appVersion: string
  cacheVersion: string
  deviceId: string
}

function requireIndexedDB() {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    throw new Error('INDEXEDDB_NOT_AVAILABLE')
  }
  return window.indexedDB
}

function openCashierDb(): Promise<IDBDatabase> {
  const indexedDB = requireIndexedDB()
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CASHIER_OFFLINE_DB_NAME, CASHIER_OFFLINE_DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(PRODUCT_STORE)) {
        const store = db.createObjectStore(PRODUCT_STORE, { keyPath: 'cacheKey' })
        store.createIndex('storeCode', 'storeCode', { unique: false })
        store.createIndex('barcode', 'barcode', { unique: false })
        store.createIndex('productId', 'productId', { unique: false })
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'storeCode' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('INDEXEDDB_OPEN_FAILED'))
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('INDEXEDDB_TX_FAILED'))
    tx.onabort = () => reject(tx.error ?? new Error('INDEXEDDB_TX_ABORTED'))
  })
}

export function getCashierDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY)
    if (existing) return existing
    const rand = Math.random().toString(36).slice(2, 10).toUpperCase()
    const id = `DEV-${Date.now().toString(36).toUpperCase()}-${rand}`
    localStorage.setItem(DEVICE_ID_KEY, id)
    return id
  } catch {
    return `DEV-${Date.now().toString(36).toUpperCase()}`
  }
}

export async function cacheCashierProducts(input: {
  tenantId: string
  storeId: string
  storeCode: string
  products: CashierCachedProductInput[]
  appVersion?: string
}): Promise<CashierProductCacheMeta> {
  const db = await openCashierDb()
  const now = new Date().toISOString()
  const deviceId = getCashierDeviceId()
  const tx = db.transaction([PRODUCT_STORE, META_STORE], 'readwrite')
  const productStore = tx.objectStore(PRODUCT_STORE)
  const metaStore = tx.objectStore(META_STORE)

  for (const product of input.products) {
    const row: CashierCachedProduct = {
      cacheKey: `${input.storeCode}:${product.id}`,
      tenantId: input.tenantId,
      storeId: input.storeId,
      storeCode: input.storeCode,
      productId: product.id,
      name: product.name,
      spec: product.spec,
      barcode: product.barcode,
      price: product.sellPrice,
      category: product.categoryName ?? null,
      categoryId: product.categoryId,
      status: product.status ?? 'ACTIVE',
      imageUrl: product.imageUrl,
      updatedAt: product.updatedAt ?? null,
      cachedAt: now,
      cacheVersion: CASHIER_CACHE_VERSION,
    }
    productStore.put(row)
  }

  const meta: CashierProductCacheMeta = {
    storeCode: input.storeCode,
    storeId: input.storeId,
    tenantId: input.tenantId,
    lastProductCacheAt: now,
    productCount: input.products.length,
    appVersion: input.appVersion ?? 'web',
    cacheVersion: CASHIER_CACHE_VERSION,
    deviceId,
  }
  metaStore.put(meta)
  await txDone(tx)
  db.close()
  return meta
}

export async function getCashierProductCacheMeta(storeCode: string): Promise<CashierProductCacheMeta | null> {
  const db = await openCashierDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readonly')
    const req = tx.objectStore(META_STORE).get(storeCode)
    req.onsuccess = () => {
      db.close()
      resolve((req.result as CashierProductCacheMeta | undefined) ?? null)
    }
    req.onerror = () => {
      db.close()
      reject(req.error ?? new Error('INDEXEDDB_READ_FAILED'))
    }
  })
}

export async function getCachedCashierProducts(storeCode: string): Promise<CashierCachedProduct[]> {
  const db = await openCashierDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PRODUCT_STORE, 'readonly')
    const req = tx.objectStore(PRODUCT_STORE).index('storeCode').getAll(storeCode)
    req.onsuccess = () => {
      db.close()
      resolve((Array.isArray(req.result) ? req.result : []) as CashierCachedProduct[])
    }
    req.onerror = () => {
      db.close()
      reject(req.error ?? new Error('INDEXEDDB_READ_PRODUCTS_FAILED'))
    }
  })
}
