/**
 * GET /api/pos/session/current?storeCode=XXX
 * 电脑端 /desktop 每 1.5s 轮询读 PosSession（公开 storeCode 入口，与 /api/cashier/store 同模式）。
 * 返回 null session = 当前门店无草稿（idle）。serverNow 用于客户端"完成 N 秒后回 idle"判断。
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { findKhqrConfig } from '@/lib/merchant-config'

type PosItem = {
  productId: string
  name: string
  spec: string | null
  price: number
  qty: number
  lineAmount: number
  imageUrl?: string | null
}

type RecentOrder = {
  orderNo: string
  totalAmount: number
  paymentMethod: string | null
  status: string
  createdAt: string
}

function parseItems(raw: string | null | undefined): PosItem[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is PosItem => !!x && typeof x === 'object')
  } catch { return [] }
}

export async function GET(req: NextRequest) {
  const storeCode = req.nextUrl.searchParams.get('storeCode')?.trim()
  if (!storeCode) {
    return NextResponse.json({ error: 'MISSING_STORE_CODE' }, { status: 400 })
  }

  const store = await prisma.store.findUnique({
    where: { code: storeCode },
    select: { id: true, code: true, tenantId: true, name: true, status: true },
  })
  if (!store || store.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })
  }

  const row = await prisma.posSession.findUnique({
    where: { tenantId_storeId: { tenantId: store.tenantId, storeId: store.id } },
    select: {
      status: true, paymentMethod: true, paymentStatus: true,
      itemsJson: true, totalAmount: true, itemCount: true,
      khqrPayload: true, khqrImageUrl: true,
      orderNo: true, message: true,
      completedAt: true, updatedAt: true,
    },
  })

  const recentRows = await prisma.saleRecord.findMany({
    where: {
      tenantId: store.tenantId,
      storeId: store.id,
      saleType: 'SALE',
      status: 'COMPLETED',
    },
    select: {
      recordNo: true,
      orderNo: true,
      lineAmount: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })

  const recentMap = new Map<string, RecentOrder>()
  for (const sale of recentRows) {
    const key = sale.orderNo ?? sale.recordNo
    const existing = recentMap.get(key)
    if (existing) {
      existing.totalAmount += sale.lineAmount.toNumber()
      continue
    }
    recentMap.set(key, {
      orderNo: key,
      totalAmount: sale.lineAmount.toNumber(),
      paymentMethod: null,
      status: 'COMPLETED',
      createdAt: sale.createdAt.toISOString(),
    })
  }
  const recentOrders = Array.from(recentMap.values()).slice(0, 3)
  const recentOrderKeys = recentOrders.map((order) => order.orderNo)
  const paymentRows = recentOrderKeys.length > 0
    ? await prisma.paymentIntent.findMany({
        where: {
          tenantId: store.tenantId,
          storeId: store.id,
          orderNo: { in: recentOrderKeys },
        },
        select: { orderNo: true, paymentMethod: true, status: true },
      })
    : []
  for (const payment of paymentRows) {
    const order = recentMap.get(payment.orderNo)
    if (!order) continue
    order.paymentMethod = payment.paymentMethod
    order.status = payment.status
  }

  const khqrFallbackConfig = row?.paymentMethod === 'KHQR' && !row.khqrPayload && !row.khqrImageUrl
    ? await findKhqrConfig(store.tenantId, store.id)
    : null

  return NextResponse.json({
    storeCode: store.code,
    storeName: store.name,
    serverNow: new Date().toISOString(),
    session: row ? {
      status: row.status,
      paymentMethod: row.paymentMethod,
      paymentStatus: row.paymentStatus,
      items: parseItems(row.itemsJson),
      totalAmount: row.totalAmount.toNumber(),
      itemCount: row.itemCount,
      khqrPayload: row.khqrPayload,
      khqrImageUrl: row.khqrImageUrl ?? khqrFallbackConfig?.khqrImageUrl ?? null,
      orderNo: row.orderNo,
      message: row.message,
      completedAt: row.completedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    } : null,
    recentOrders: recentOrders.map((o) => ({
      ...o,
      totalAmount: Number(o.totalAmount.toFixed(2)),
    })),
  })
}
