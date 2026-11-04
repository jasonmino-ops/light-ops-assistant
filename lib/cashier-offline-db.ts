'use client'

export const CASHIER_OFFLINE_DB_NAME = 'light_ops_cashier_offline'
export const CASHIER_OFFLINE_DB_VERSION = 3
export const CASHIER_CACHE_VERSION = 'cashier-offline-multi-unit-01'

const PRODUCT_STORE = 'cashier_products'
const META_STORE = 'cashier_meta'
const OFFLINE_ORDER_STORE = 'cashier_offline_orders'
const DEVICE_ID_KEY = 'cashier:deviceId'

export type CashierCachedProductInput = {
  id: string
  barcode: string
  sku?: string | null
  name: string
  spec: string | null
  sellPrice: number
  categoryId: string | null
  categoryName?: string | null
  imageUrl: string | null
  status?: string
  updatedAt?: string | null
  mainUnitName?: string | null
  auxUnitName?: string | null
  auxBarcode?: string | null
  auxConversionFactor?: number | null
  auxSellPrice?: number | null
  auxEnabled?: boolean
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
  sku?: string | null
  price: number
  category: string | null
  categoryId: string | null
  status: string
  imageUrl: string | null
  updatedAt: string | null
  cachedAt: string
  cacheVersion: string
  mainUnitName: string | null
  auxUnitName: string | null
  auxBarcode: string | null
  auxConversionFactor: number | null
  auxSellPrice: number | null
  auxEnabled: boolean
}

type CatalogCategory = { id: string; name: string; parentId: string | null }

export type CashierCatalogProof = { totalCount: number; digest: string; verifiedAt: number }

export type CashierProductCacheMeta = {
  storeCode: string
  storeId: string
  tenantId: string
  lastProductCacheAt: string
  productCount: number
  catalogProof?: CashierCatalogProof
  categories?: CatalogCategory[]
  appVersion: string
  cacheVersion: string
  deviceId: string
}

export type CashierOfflineOrderItem = {
  productId: string | null
  productName: string
  barcode: string
  unitPrice: number
  quantity: number
  lineTotal: number
  snapshotPrice: number
  snapshotName: string
  spec?: string | null
  sugar?: string | null
  sellingUnitType: 'MAIN' | 'AUX'
  sellingUnitName: string
  sellingConversionFactor: number
}

export type CashierOfflineOrder = {
  offlineOrderId: string
  tenantId: string
  storeId: string
  storeCode: string
  operatorUserId: string | null
  operatorName: string | null
  deviceId: string
  createdAtLocal: string
  createdAtClientTimestamp: number
  items: CashierOfflineOrderItem[]
  subtotal: number
  discountAmount: number
  totalAmount: number
  paymentMethod: 'CASH'
  paymentStatus: 'PAID_OFFLINE'
  syncStatus: 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED'
  syncAttemptCount: number
  lastSyncError: string | null
  serverSaleRecordId: string | null
  syncedAt: string | null
  appVersion: string
  cacheVersion: string
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
      if (!db.objectStoreNames.contains(OFFLINE_ORDER_STORE)) {
        const store = db.createObjectStore(OFFLINE_ORDER_STORE, { keyPath: 'offlineOrderId' })
        store.createIndex('storeCode', 'storeCode', { unique: false })
        store.createIndex('syncStatus', 'syncStatus', { unique: false })
        store.createIndex('storeCodeSyncStatus', ['storeCode', 'syncStatus'], { unique: false })
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

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

export function generateOfflineOrderId(storeCode: string, deviceId: string): string {
  const now = new Date()
  const ts = [
    now.getFullYear(),
    pad2(now.getMonth() + 1),
    pad2(now.getDate()),
    pad2(now.getHours()),
    pad2(now.getMinutes()),
    pad2(now.getSeconds()),
  ].join('')
  const deviceShort = deviceId.replace(/[^A-Za-z0-9]/g, '').slice(-6).toUpperCase() || 'DEVICE'
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `OFFLINE-${storeCode}-${deviceShort}-${ts}-${rand}`
}

export async function verifyCashierCatalog(
  products: ReadonlyArray<Pick<CashierCachedProductInput, 'id' | 'updatedAt'>>,
  proof: CashierCatalogProof,
): Promise<boolean> {
  if (!proof || !Number.isSafeInteger(proof.verifiedAt) || proof.verifiedAt <= 0 ||
      proof.totalCount !== products.length || !/^[a-f0-9]{64}$/.test(proof.digest)) return false
  const ids = new Set<string>()
  const revisions: string[] = []
  for (const { id, updatedAt } of products) {
    if (!id || !updatedAt || ids.has(id)) return false
    ids.add(id)
    revisions.push(JSON.stringify([id, updatedAt]))
  }
  const bytes = new TextEncoder().encode(revisions.sort().join('\n'))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  return proof.digest === hex
}

export async function cacheCashierProducts(input: {
  tenantId: string
  storeId: string
  storeCode: string
  products: CashierCachedProductInput[]
  categories: CatalogCategory[]
  proof: CashierCatalogProof
  signal?: AbortSignal
  appVersion?: string
}): Promise<CashierProductCacheMeta> {
  if (!await verifyCashierCatalog(input.products, input.proof)) {
    throw new Error('INCOMPLETE_CASHIER_CATALOG')
  }
  const now = new Date().toISOString()
  const deviceId = getCashierDeviceId()
  const rows = input.products.map((product): CashierCachedProduct => {
    return {
      cacheKey: `${input.storeCode}:${product.id}`,
      tenantId: input.tenantId,
      storeId: input.storeId,
      storeCode: input.storeCode,
      productId: product.id,
      name: product.name,
      spec: product.spec,
      barcode: product.barcode,
      sku: product.sku ?? null,
      price: product.sellPrice,
      category: product.categoryName ?? null,
      categoryId: product.categoryId,
      status: product.status ?? 'ACTIVE',
      imageUrl: product.imageUrl,
      updatedAt: product.updatedAt ?? null,
      cachedAt: now,
      cacheVersion: CASHIER_CACHE_VERSION,
      mainUnitName: product.mainUnitName ?? null,
      auxUnitName: product.auxUnitName ?? null,
      auxBarcode: product.auxBarcode ?? null,
      auxConversionFactor: product.auxConversionFactor ?? null,
      auxSellPrice: product.auxSellPrice ?? null,
      auxEnabled: product.auxEnabled === true,
    }
  })
  const meta: CashierProductCacheMeta = {
    storeCode: input.storeCode,
    storeId: input.storeId,
    tenantId: input.tenantId,
    lastProductCacheAt: now,
    productCount: rows.length,
    catalogProof: input.proof,
    categories: input.categories,
    appVersion: input.appVersion ?? 'web',
    cacheVersion: CASHIER_CACHE_VERSION,
    deviceId,
  }

  const db = await openCashierDb()
  try {
    input.signal?.throwIfAborted()
    const tx = db.transaction([PRODUCT_STORE, META_STORE], 'readwrite')
    const productStore = tx.objectStore(PRODUCT_STORE)
    const metaStore = tx.objectStore(META_STORE)
    const existing = metaStore.get(input.storeCode)
    let saved = meta
    existing.onsuccess = () => {
      const previous = existing.result as CashierProductCacheMeta | undefined
      if (previous?.tenantId === input.tenantId && previous.storeId === input.storeId &&
          previous.catalogProof && previous.catalogProof.verifiedAt >= input.proof.verifiedAt) {
        saved = previous
        return
      }
      // Remove only this store's old rows. Deletion, replacement and metadata
      // commit together, so a failed refresh leaves the previous snapshot intact.
      const cursor = productStore.index('storeCode').openKeyCursor(input.storeCode)
      cursor.onsuccess = () => {
        const key = cursor.result
        if (key) {
          productStore.delete(key.primaryKey)
          key.continue()
          return
        }
        for (const row of rows) productStore.put(row)
        metaStore.put(meta)
      }
    }
    const abort = () => { try { tx.abort() } catch {} }
    input.signal?.addEventListener('abort', abort, { once: true })
    try {
      await txDone(tx)
      return saved
    } finally {
      input.signal?.removeEventListener('abort', abort)
    }
  } finally {
    db.close()
  }
}

export async function getCashierProductCache(storeCode: string): Promise<{
  meta: CashierProductCacheMeta
  products: CashierCachedProduct[]
} | null> {
  const db = await openCashierDb()
  let meta: CashierProductCacheMeta | undefined
  let products: CashierCachedProduct[]
  try {
    const tx = db.transaction([PRODUCT_STORE, META_STORE], 'readonly')
    const metaRequest = tx.objectStore(META_STORE).get(storeCode)
    const productRequest = tx.objectStore(PRODUCT_STORE).index('storeCode').getAll(storeCode)
    await txDone(tx)
    meta = metaRequest.result
    products = productRequest.result
  } finally {
    db.close()
  }
  if (!meta || meta.storeCode !== storeCode) return null
  const { storeId, tenantId, catalogProof } = meta
  if (products.some(p => p.storeId !== storeId || p.tenantId !== tenantId)) return null
  if (catalogProof && (meta.productCount !== products.length || !await verifyCashierCatalog(
    products.map(p => ({ id: p.productId, updatedAt: p.updatedAt })), catalogProof,
  ))) return null
  return { meta, products }
}

export async function saveOfflineCashierOrder(order: Omit<CashierOfflineOrder, 'offlineOrderId'> & { offlineOrderId?: string }): Promise<CashierOfflineOrder> {
  const db = await openCashierDb()
  const offlineOrderId = order.offlineOrderId ?? generateOfflineOrderId(order.storeCode, order.deviceId)
  const row: CashierOfflineOrder = { ...order, offlineOrderId }
  const tx = db.transaction(OFFLINE_ORDER_STORE, 'readwrite')
  tx.objectStore(OFFLINE_ORDER_STORE).put(row)
  await txDone(tx)
  db.close()
  return row
}

export async function countPendingOfflineOrders(storeCode: string): Promise<number> {
  const db = await openCashierDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_ORDER_STORE, 'readonly')
    const store = tx.objectStore(OFFLINE_ORDER_STORE)
    const req = store.index('storeCode').getAll(storeCode)
    req.onsuccess = () => {
      db.close()
      const rows = (Array.isArray(req.result) ? req.result : []) as CashierOfflineOrder[]
      resolve(rows.filter((row) => row.syncStatus === 'PENDING' || row.syncStatus === 'FAILED').length)
    }
    req.onerror = () => {
      db.close()
      reject(req.error ?? new Error('INDEXEDDB_COUNT_OFFLINE_ORDERS_FAILED'))
    }
  })
}

export async function getPendingOfflineOrders(storeCode: string, limit = 20): Promise<CashierOfflineOrder[]> {
  const db = await openCashierDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_ORDER_STORE, 'readonly')
    const store = tx.objectStore(OFFLINE_ORDER_STORE)
    const req = store.index('storeCode').getAll(storeCode)
    req.onsuccess = () => {
      db.close()
      const rows = (Array.isArray(req.result) ? req.result : []) as CashierOfflineOrder[]
      resolve(
        rows
          .filter((row) => row.syncStatus === 'PENDING' || row.syncStatus === 'FAILED')
          .sort((a, b) => a.createdAtClientTimestamp - b.createdAtClientTimestamp)
          .slice(0, Math.max(1, Math.min(limit, 20))),
      )
    }
    req.onerror = () => {
      db.close()
      reject(req.error ?? new Error('INDEXEDDB_READ_OFFLINE_ORDERS_FAILED'))
    }
  })
}

export async function markOfflineOrdersSyncing(offlineOrderIds: string[]): Promise<void> {
  if (offlineOrderIds.length === 0) return
  const db = await openCashierDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OFFLINE_ORDER_STORE, 'readwrite')
    const store = tx.objectStore(OFFLINE_ORDER_STORE)
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error ?? new Error('INDEXEDDB_TX_FAILED'))
    }
    tx.onabort = () => {
      db.close()
      reject(tx.error ?? new Error('INDEXEDDB_TX_ABORTED'))
    }
    for (const offlineOrderId of offlineOrderIds) {
      const req = store.get(offlineOrderId)
      req.onsuccess = () => {
        const existing = (req.result as CashierOfflineOrder | undefined) ?? null
        if (!existing || existing.syncStatus === 'SYNCED') return
        store.put({ ...existing, syncStatus: 'SYNCING' })
      }
      req.onerror = () => reject(req.error ?? new Error('INDEXEDDB_READ_OFFLINE_ORDER_FAILED'))
    }
  })
}

export async function updateOfflineOrderSyncResult(input: {
  offlineOrderId: string
  syncStatus: 'SYNCED' | 'FAILED'
  serverSaleRecordId?: string | null
  error?: string | null
  syncedAt?: string | null
}): Promise<void> {
  const db = await openCashierDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OFFLINE_ORDER_STORE, 'readwrite')
    const store = tx.objectStore(OFFLINE_ORDER_STORE)
    const req = store.get(input.offlineOrderId)
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error ?? new Error('INDEXEDDB_TX_FAILED'))
    }
    tx.onabort = () => {
      db.close()
      reject(tx.error ?? new Error('INDEXEDDB_TX_ABORTED'))
    }
    req.onsuccess = () => {
      const existing = (req.result as CashierOfflineOrder | undefined) ?? null
      if (!existing) return
      store.put({
        ...existing,
        syncStatus: input.syncStatus,
        syncAttemptCount: existing.syncAttemptCount + 1,
        lastSyncError: input.syncStatus === 'FAILED' ? input.error ?? 'SYNC_FAILED' : null,
        serverSaleRecordId: input.serverSaleRecordId ?? existing.serverSaleRecordId,
        syncedAt: input.syncStatus === 'SYNCED' ? input.syncedAt ?? new Date().toISOString() : existing.syncedAt,
      })
    }
    req.onerror = () => reject(req.error ?? new Error('INDEXEDDB_READ_OFFLINE_ORDER_FAILED'))
  })
}

export async function markOfflineOrdersSyncFailed(offlineOrderIds: string[], error: string): Promise<void> {
  for (const offlineOrderId of offlineOrderIds) {
    await updateOfflineOrderSyncResult({
      offlineOrderId,
      syncStatus: 'FAILED',
      error,
    })
  }
}
