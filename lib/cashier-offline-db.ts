'use client'

export const CASHIER_OFFLINE_DB_NAME = 'light_ops_cashier_offline'
export const CASHIER_OFFLINE_DB_VERSION = 2
export const CASHIER_CACHE_VERSION = 'cashier-offline-02'

const PRODUCT_STORE = 'cashier_products'
const META_STORE = 'cashier_meta'
const OFFLINE_ORDER_STORE = 'cashier_offline_orders'
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
