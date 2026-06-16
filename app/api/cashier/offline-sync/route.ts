/**
 * POST /api/cashier/offline-sync
 *
 * Server-side sync endpoint for /cashier Offline-02 local CASH orders.
 * This endpoint is intentionally not wired to the cashier UI yet.
 * It accepts only CASH + PAID_OFFLINE orders and creates normal SaleRecord
 * rows plus a PAID CASH PaymentIntent, guarded by OfflineSaleSyncMap idempotency.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateRecordNo } from '@/lib/record-no'
import { createHash } from 'crypto'
import type { Product } from '@prisma/client'

const MAX_ORDERS = 20
const MAX_ITEMS_PER_ORDER = 100
const AMOUNT_TOLERANCE = 0.01

type OfflineSyncItem = {
  productId?: unknown
  productName?: unknown
  barcode?: unknown
  unitPrice?: unknown
  quantity?: unknown
  lineTotal?: unknown
  snapshotPrice?: unknown
  snapshotName?: unknown
  spec?: unknown
  sugar?: unknown
}

type OfflineSyncOrder = {
  offlineOrderId?: unknown
  tenantId?: unknown
  storeId?: unknown
  storeCode?: unknown
  operatorUserId?: unknown
  operatorName?: unknown
  deviceId?: unknown
  createdAtLocal?: unknown
  createdAtClientTimestamp?: unknown
  items?: unknown
  subtotal?: unknown
  discountAmount?: unknown
  totalAmount?: unknown
  paymentMethod?: unknown
  paymentStatus?: unknown
  syncStatus?: unknown
  appVersion?: unknown
  cacheVersion?: unknown
}

type SyncResult = {
  offlineOrderId: string | null
  status: 'SYNCED' | 'DUPLICATE' | 'FAILED'
  serverSaleRecordId: string | null
  errorCode: string | null
  errorMessage: string | null
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asFiniteNumber(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

function fail(
  offlineOrderId: string | null,
  errorCode: string,
  errorMessage: string,
): SyncResult {
  return { offlineOrderId, status: 'FAILED', serverSaleRecordId: null, errorCode, errorMessage }
}

function hashPayload(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

async function markFailedIfPossible(params: {
  tenantId: string
  storeId: string
  deviceId: string
  offlineOrderId: string
  errorCode: string
  errorMessage: string
}) {
  try {
    await prisma.offlineSaleSyncMap.upsert({
      where: {
        storeId_deviceId_offlineOrderId: {
          storeId: params.storeId,
          deviceId: params.deviceId,
          offlineOrderId: params.offlineOrderId,
        },
      },
      create: {
        tenantId: params.tenantId,
        storeId: params.storeId,
        deviceId: params.deviceId,
        offlineOrderId: params.offlineOrderId,
        status: 'FAILED',
        lastErrorCode: params.errorCode,
        lastErrorMessage: params.errorMessage,
      },
      update: {
        status: 'FAILED',
        lastErrorCode: params.errorCode,
        lastErrorMessage: params.errorMessage,
      },
    })
  } catch (err) {
    console.warn('[offline-sync] failed to write failed marker', {
      offlineOrderId: params.offlineOrderId,
      errorCode: params.errorCode,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

async function syncOne(order: OfflineSyncOrder, batch: { storeId: string | null; storeCode: string | null; deviceId: string | null }): Promise<SyncResult> {
  const offlineOrderId = asNonEmptyString(order.offlineOrderId)
  if (!offlineOrderId) return fail(null, 'INVALID_PAYLOAD', 'offlineOrderId is required')

  const tenantId = asNonEmptyString(order.tenantId)
  const storeId = asNonEmptyString(order.storeId)
  const storeCode = asNonEmptyString(order.storeCode)
  const deviceId = asNonEmptyString(order.deviceId)
  if (!tenantId || !storeId || !storeCode || !deviceId) {
    return fail(offlineOrderId, 'INVALID_PAYLOAD', 'tenantId, storeId, storeCode and deviceId are required')
  }
  if ((batch.storeId && batch.storeId !== storeId) || (batch.storeCode && batch.storeCode !== storeCode) || (batch.deviceId && batch.deviceId !== deviceId)) {
    return fail(offlineOrderId, 'STORE_MISMATCH', 'Batch store/device fields do not match order fields')
  }
  const syncStatus = asNonEmptyString(order.syncStatus)
  if (syncStatus && syncStatus !== 'PENDING' && syncStatus !== 'FAILED') {
    return fail(offlineOrderId, 'INVALID_PAYLOAD', 'syncStatus must be PENDING or FAILED')
  }

  if (order.paymentMethod !== 'CASH') {
    await markFailedIfPossible({
      tenantId, storeId, deviceId, offlineOrderId,
      errorCode: 'INVALID_PAYMENT_METHOD',
      errorMessage: 'Only CASH offline orders can be synced',
    })
    return fail(offlineOrderId, 'INVALID_PAYMENT_METHOD', 'Only CASH offline orders can be synced')
  }
  if (order.paymentStatus !== 'PAID_OFFLINE') {
    await markFailedIfPossible({
      tenantId, storeId, deviceId, offlineOrderId,
      errorCode: 'INVALID_PAYMENT_METHOD',
      errorMessage: 'paymentStatus must be PAID_OFFLINE',
    })
    return fail(offlineOrderId, 'INVALID_PAYMENT_METHOD', 'paymentStatus must be PAID_OFFLINE')
  }

  const items = Array.isArray(order.items) ? order.items as OfflineSyncItem[] : []
  if (items.length === 0) {
    await markFailedIfPossible({ tenantId, storeId, deviceId, offlineOrderId, errorCode: 'EMPTY_ITEMS', errorMessage: 'items must be non-empty' })
    return fail(offlineOrderId, 'EMPTY_ITEMS', 'items must be non-empty')
  }
  if (items.length > MAX_ITEMS_PER_ORDER) {
    await markFailedIfPossible({ tenantId, storeId, deviceId, offlineOrderId, errorCode: 'INVALID_PAYLOAD', errorMessage: `items cannot exceed ${MAX_ITEMS_PER_ORDER}` })
    return fail(offlineOrderId, 'INVALID_PAYLOAD', `items cannot exceed ${MAX_ITEMS_PER_ORDER}`)
  }

  const totalAmount = asFiniteNumber(order.totalAmount)
  const discountAmount = asFiniteNumber(order.discountAmount) ?? 0
  if (totalAmount === null || totalAmount <= 0) {
    await markFailedIfPossible({ tenantId, storeId, deviceId, offlineOrderId, errorCode: 'INVALID_AMOUNT', errorMessage: 'totalAmount must be positive' })
    return fail(offlineOrderId, 'INVALID_AMOUNT', 'totalAmount must be positive')
  }

  const store = await prisma.store.findFirst({
    where: { id: storeId, code: storeCode, tenantId, status: 'ACTIVE' },
    select: { id: true, tenantId: true, code: true },
  })
  if (!store) {
    return fail(offlineOrderId, 'STORE_NOT_FOUND', 'Store was not found or inactive')
  }
  if (store.id !== storeId || store.code !== storeCode) {
    return fail(offlineOrderId, 'STORE_MISMATCH', 'storeId and storeCode do not match')
  }
  if (store.tenantId !== tenantId) {
    return fail(offlineOrderId, 'TENANT_MISMATCH', 'tenantId does not match store')
  }

  const requestedOperatorUserId = asNonEmptyString(order.operatorUserId)
  let operatorUserId = requestedOperatorUserId
  if (operatorUserId) {
    const operatorRole = await prisma.userStoreRole.findFirst({
      where: { tenantId, storeId, userId: operatorUserId, status: 'ACTIVE' },
      select: { userId: true },
    })
    if (!operatorRole) {
      await markFailedIfPossible({ tenantId, storeId, deviceId, offlineOrderId, errorCode: 'OPERATOR_NOT_FOUND', errorMessage: 'operatorUserId is not active in this store' })
      return fail(offlineOrderId, 'OPERATOR_NOT_FOUND', 'operatorUserId is not active in this store')
    }
  } else {
    const ownerRole = await prisma.userStoreRole.findFirst({
      where: { tenantId, storeId, role: 'OWNER', status: 'ACTIVE' },
      select: { userId: true },
    })
    if (!ownerRole) {
      await markFailedIfPossible({ tenantId, storeId, deviceId, offlineOrderId, errorCode: 'OPERATOR_NOT_FOUND', errorMessage: 'No active owner operator for this store' })
      return fail(offlineOrderId, 'OPERATOR_NOT_FOUND', 'No active owner operator for this store')
    }
    operatorUserId = ownerRole.userId
  }

  const existing = await prisma.offlineSaleSyncMap.findUnique({
    where: { storeId_deviceId_offlineOrderId: { storeId, deviceId, offlineOrderId } },
    select: { saleRecordId: true, status: true },
  })
  if (existing?.saleRecordId) {
    return {
      offlineOrderId,
      status: 'DUPLICATE',
      serverSaleRecordId: existing.saleRecordId,
      errorCode: 'DUPLICATE_OFFLINE_ORDER',
      errorMessage: null,
    }
  }

  const productIds = [...new Set(items.map((it) => asNonEmptyString(it.productId)).filter(Boolean) as string[])]
  const barcodes = [...new Set(items.map((it) => asNonEmptyString(it.barcode)).filter(Boolean) as string[])]
  if (productIds.length === 0 && barcodes.length === 0) {
    await markFailedIfPossible({ tenantId, storeId, deviceId, offlineOrderId, errorCode: 'PRODUCT_NOT_FOUND', errorMessage: 'No productId or barcode in items' })
    return fail(offlineOrderId, 'PRODUCT_NOT_FOUND', 'No productId or barcode in items')
  }

  const products = await prisma.product.findMany({
    where: {
      tenantId,
      status: 'ACTIVE',
      OR: [
        ...(productIds.length ? [{ id: { in: productIds } }] : []),
        ...(barcodes.length ? [{ barcode: { in: barcodes } }] : []),
      ],
    },
  })
  const byId = new Map(products.map((p) => [p.id, p]))
  const byBarcode = new Map(products.map((p) => [p.barcode, p]))

  let recomputedSubtotal = 0
  const normalizedItems: Array<{ product: Product; qty: number; lineAmount: { toNumber(): number } }> = []
  for (const item of items) {
    const productId = asNonEmptyString(item.productId)
    const barcode = asNonEmptyString(item.barcode)
    const product = productId ? byId.get(productId) : barcode ? byBarcode.get(barcode) : null
    if (!product) {
      await markFailedIfPossible({ tenantId, storeId, deviceId, offlineOrderId, errorCode: 'PRODUCT_NOT_FOUND', errorMessage: `Product not found: ${productId ?? barcode ?? 'unknown'}` })
      return fail(offlineOrderId, 'PRODUCT_NOT_FOUND', `Product not found: ${productId ?? barcode ?? 'unknown'}`)
    }
    if (product.tenantId !== tenantId) {
      await markFailedIfPossible({ tenantId, storeId, deviceId, offlineOrderId, errorCode: 'PRODUCT_STORE_MISMATCH', errorMessage: `Product tenant mismatch: ${product.id}` })
      return fail(offlineOrderId, 'PRODUCT_STORE_MISMATCH', `Product tenant mismatch: ${product.id}`)
    }
    const qty = asFiniteNumber(item.quantity)
    if (qty === null || qty <= 0) {
      await markFailedIfPossible({ tenantId, storeId, deviceId, offlineOrderId, errorCode: 'INVALID_PAYLOAD', errorMessage: `Invalid quantity for ${product.barcode}` })
      return fail(offlineOrderId, 'INVALID_PAYLOAD', `Invalid quantity for ${product.barcode}`)
    }
    const lineAmount = product.sellPrice.mul(qty)
    recomputedSubtotal += lineAmount.toNumber()
    normalizedItems.push({ product, qty, lineAmount })
  }

  const recomputedTotal = roundMoney(recomputedSubtotal - discountAmount)
  if (Math.abs(recomputedTotal - roundMoney(totalAmount)) > AMOUNT_TOLERANCE) {
    await markFailedIfPossible({
      tenantId, storeId, deviceId, offlineOrderId,
      errorCode: 'INVALID_AMOUNT',
      errorMessage: `Amount mismatch: expected ${recomputedTotal}, got ${totalAmount}`,
    })
    return fail(offlineOrderId, 'INVALID_AMOUNT', `Amount mismatch: expected ${recomputedTotal}, got ${totalAmount}`)
  }

  const clientTimestamp = asFiniteNumber(order.createdAtClientTimestamp)
  const offlineCreatedAtClientTimestamp = clientTimestamp ? new Date(clientTimestamp) : null
  const offlineCreatedAtLocal = asNonEmptyString(order.createdAtLocal)
  const syncedAt = new Date()

  try {
    return await prisma.$transaction(async (tx) => {
      const duplicate = await tx.offlineSaleSyncMap.findUnique({
        where: { storeId_deviceId_offlineOrderId: { storeId, deviceId, offlineOrderId } },
        select: { saleRecordId: true, status: true },
      })
      if (duplicate?.saleRecordId) {
        return {
          offlineOrderId,
          status: 'DUPLICATE' as const,
          serverSaleRecordId: duplicate.saleRecordId,
          errorCode: 'DUPLICATE_OFFLINE_ORDER',
          errorMessage: null,
        }
      }

      await tx.offlineSaleSyncMap.upsert({
        where: { storeId_deviceId_offlineOrderId: { storeId, deviceId, offlineOrderId } },
        create: { tenantId, storeId, deviceId, offlineOrderId, status: 'PENDING', rawPayloadHash: hashPayload(order) },
        update: { status: 'PENDING', rawPayloadHash: hashPayload(order), lastErrorCode: null, lastErrorMessage: null },
      })

      const orderNo = await generateRecordNo(tx, 'S', tenantId, storeId, store.code)
      let isFirst = true
      let firstSaleRecordId: string | null = null

      for (const item of normalizedItems) {
        const recordNo = isFirst
          ? orderNo
          : await generateRecordNo(tx, 'S', tenantId, storeId, store.code)
        isFirst = false

        const record = await tx.saleRecord.create({
          data: {
            tenantId,
            storeId,
            operatorUserId,
            recordNo,
            orderNo,
            saleType: 'SALE',
            status: 'COMPLETED',
            source: 'CASHIER_OFFLINE',
            offlineOrderId,
            offlineDeviceId: deviceId,
            offlineCreatedAtLocal,
            offlineCreatedAtClientTimestamp,
            offlineSyncedAt: syncedAt,
            offlineSyncStatus: 'SYNCED',
            inventoryException: null,
            productId: item.product.id,
            barcode: item.product.barcode,
            productNameSnapshot: item.product.name,
            specSnapshot: item.product.spec ?? null,
            unitPrice: item.product.sellPrice,
            quantity: item.qty,
            lineAmount: item.lineAmount.toNumber(),
            remark: '电脑收银台-离线补同步',
          },
        })
        if (!firstSaleRecordId) firstSaleRecordId = record.id
      }

      await tx.paymentIntent.create({
        data: {
          tenantId,
          storeId,
          operatorUserId,
          orderNo,
          paymentMethod: 'CASH',
          status: 'PAID',
          amount: recomputedTotal,
          paidAt: syncedAt,
        },
      })

      await tx.offlineSaleSyncMap.update({
        where: { storeId_deviceId_offlineOrderId: { storeId, deviceId, offlineOrderId } },
        data: {
          saleRecordId: firstSaleRecordId,
          status: 'SYNCED',
          syncedAt,
          rawPayloadHash: hashPayload(order),
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      })

      return {
        offlineOrderId,
        status: 'SYNCED' as const,
        serverSaleRecordId: firstSaleRecordId,
        errorCode: null,
        errorMessage: null,
      }
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await markFailedIfPossible({ tenantId, storeId, deviceId, offlineOrderId, errorCode: 'SERVER_ERROR', errorMessage: message })
    return fail(offlineOrderId, 'SERVER_ERROR', 'Failed to sync offline order')
  }
}

export async function POST(req: NextRequest) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_PAYLOAD', message: 'Invalid JSON body' }, { status: 400 })
  }

  const orders = Array.isArray(body?.orders) ? body.orders as OfflineSyncOrder[] : []
  const batch = {
    storeId: asNonEmptyString(body?.storeId),
    storeCode: asNonEmptyString(body?.storeCode),
    deviceId: asNonEmptyString(body?.deviceId),
  }
  if (orders.length === 0) {
    return NextResponse.json({ error: 'INVALID_PAYLOAD', message: 'orders must be a non-empty array' }, { status: 400 })
  }
  if (orders.length > MAX_ORDERS) {
    return NextResponse.json({ error: 'INVALID_PAYLOAD', message: `orders cannot exceed ${MAX_ORDERS}` }, { status: 400 })
  }

  const results: SyncResult[] = []
  for (const order of orders) {
    results.push(await syncOne(order, batch))
  }

  const successCount = results.filter((r) => r.status === 'SYNCED').length
  const duplicateCount = results.filter((r) => r.status === 'DUPLICATE').length
  const failedCount = results.filter((r) => r.status === 'FAILED').length

  return NextResponse.json({
    total: results.length,
    successCount,
    duplicateCount,
    failedCount,
    results,
  })
}
