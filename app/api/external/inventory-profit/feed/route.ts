import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  nextFeedCursor,
  parseFeedDataset,
  parseFeedLimit,
  parseFeedRange,
  sanitizeCustomerOrderItems,
} from '@/lib/inventory-profit/feed'

export const dynamic = 'force-dynamic'

function unavailable(error: string) {
  return NextResponse.json({ ok: false, error }, {
    status: 503,
    headers: { 'cache-control': 'no-store' },
  })
}

export async function GET(req: NextRequest) {
  const secret = process.env.INVENTORY_PROFIT_FEED_SECRET?.trim()
  const pilotStoreId = process.env.INVENTORY_PROFIT_PILOT_STORE_ID?.trim()
  if (!secret || !pilotStoreId) return unavailable('FEED_NOT_CONFIGURED')

  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, {
      status: 401,
      headers: { 'cache-control': 'no-store' },
    })
  }

  const dataset = parseFeedDataset(req.nextUrl.searchParams.get('dataset'))
  if (!dataset) {
    return NextResponse.json({ ok: false, error: 'INVALID_DATASET' }, { status: 400 })
  }

  const store = await prisma.store.findUnique({
    where: { id: pilotStoreId },
    select: { id: true, tenantId: true, code: true, status: true },
  })
  if (!store || store.status !== 'ACTIVE') return unavailable('PILOT_STORE_UNAVAILABLE')

  const limit = parseFeedLimit(req.nextUrl.searchParams.get('limit'))
  const cursor = req.nextUrl.searchParams.get('cursor')?.trim() || null
  const generatedAt = new Date().toISOString()

  if (dataset === 'products') {
    const products = await prisma.product.findMany({
      where: {
        tenantId: store.tenantId,
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: limit,
      select: {
        id: true,
        sku: true,
        barcode: true,
        name: true,
        status: true,
        updatedAt: true,
      },
    })
    const items = products.map((product) => ({
      id: product.id,
      sku: product.sku,
      barcode: product.barcode,
      name: product.name,
      status: product.status,
      updatedAt: product.updatedAt.toISOString(),
    }))
    return NextResponse.json({
      ok: true,
      schemaVersion: 1,
      dataset,
      generatedAt,
      items,
      nextCursor: nextFeedCursor(items, limit),
    }, { headers: { 'cache-control': 'no-store' } })
  }

  const range = parseFeedRange(
    req.nextUrl.searchParams.get('from'),
    req.nextUrl.searchParams.get('to'),
  )
  if (!range) {
    return NextResponse.json({ ok: false, error: 'INVALID_DATE_RANGE' }, { status: 400 })
  }

  if (dataset === 'customer-orders') {
    const orders = await prisma.customerOrder.findMany({
      where: {
        tenantId: store.tenantId,
        storeId: store.id,
        status: 'COMPLETED',
        paymentStatus: 'PAID',
        paidAt: { gte: range.from, lte: range.to },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: limit,
      select: {
        id: true,
        orderNo: true,
        itemsJson: true,
        totalAmount: true,
        paidAt: true,
        updatedAt: true,
      },
    })
    const items = orders.map((order) => ({
      id: order.id,
      orderNo: order.orderNo,
      items: sanitizeCustomerOrderItems(order.itemsJson),
      totalAmount: order.totalAmount.toNumber(),
      paidAt: order.paidAt?.toISOString() ?? null,
      updatedAt: order.updatedAt.toISOString(),
    }))
    return NextResponse.json({
      ok: true,
      schemaVersion: 1,
      dataset,
      generatedAt,
      items,
      nextCursor: nextFeedCursor(items, limit),
    }, { headers: { 'cache-control': 'no-store' } })
  }

  const saleType = dataset === 'refunds' ? 'REFUND' : 'SALE'
  const rows = await prisma.saleRecord.findMany({
    where: {
      tenantId: store.tenantId,
      storeId: store.id,
      saleType,
      status: 'COMPLETED',
      createdAt: { gte: range.from, lte: range.to },
      ...(cursor ? { id: { gt: cursor } } : {}),
    },
    orderBy: { id: 'asc' },
    take: limit,
    select: {
      id: true,
      recordNo: true,
      orderNo: true,
      originalSaleRecordId: true,
      productId: true,
      barcode: true,
      productNameSnapshot: true,
      specSnapshot: true,
      unitPrice: true,
      quantity: true,
      lineAmount: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  const items = rows.map((row) => dataset === 'refunds' ? {
    id: row.id,
    recordNo: row.recordNo,
    originalSaleRecordId: row.originalSaleRecordId,
    productId: row.productId,
    barcode: row.barcode,
    productName: row.productNameSnapshot,
    spec: row.specSnapshot,
    quantity: Math.abs(row.quantity.toNumber()),
    refundAmount: Math.abs(row.lineAmount.toNumber()),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  } : {
    id: row.id,
    recordNo: row.recordNo,
    orderNo: row.orderNo,
    productId: row.productId,
    barcode: row.barcode,
    productName: row.productNameSnapshot,
    spec: row.specSnapshot,
    unitPrice: row.unitPrice.toNumber(),
    quantity: row.quantity.toNumber(),
    lineAmount: row.lineAmount.toNumber(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  })

  return NextResponse.json({
    ok: true,
    schemaVersion: 1,
    dataset,
    generatedAt,
    items,
    nextCursor: nextFeedCursor(items, limit),
  }, { headers: { 'cache-control': 'no-store' } })
}
