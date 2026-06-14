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

const DRAFT_TIMEOUT_MS = 5 * 60 * 1000
const CHECKOUT_TIMEOUT_MS = 10 * 60 * 1000

type DisplayProduct = {
  id: string
  name: string
  spec: string | null
  sellPrice: number
  imageUrl: string
  totalQty?: number
}

function parseItems(raw: string | null | undefined): PosItem[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is PosItem => !!x && typeof x === 'object')
  } catch { return [] }
}

function parseImageUrls(imageUrls: string | null, imageUrl: string | null): string[] {
  try {
    const parsed = imageUrls ? JSON.parse(imageUrls) : []
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, 3)
    }
  } catch {}
  return imageUrl ? [imageUrl] : []
}

function cleanDisplayImageUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  const value = raw.trim()
  if (!value) return null
  if (value.startsWith('http://') || value.startsWith('https://')) return value
  if (value.startsWith('/')) return value
  if (value.startsWith('data:image/') && value.includes(',')) return value
  return null
}

export async function GET(req: NextRequest) {
  const storeCode = req.nextUrl.searchParams.get('storeCode')?.trim()
  if (!storeCode) {
    return NextResponse.json({ error: 'MISSING_STORE_CODE' }, { status: 400 })
  }

  const store = await prisma.store.findUnique({
    where: { code: storeCode },
    select: { id: true, code: true, tenantId: true, name: true, status: true, bannerUrl: true },
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

  const weekStart = new Date()
  weekStart.setHours(0, 0, 0, 0)
  weekStart.setDate(weekStart.getDate() - 6)
  const weeklyHotRows = await prisma.saleRecord.groupBy({
    by: ['productId'],
    where: {
      tenantId: store.tenantId,
      storeId: store.id,
      saleType: 'SALE',
      status: 'COMPLETED',
      createdAt: { gte: weekStart },
    },
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: 'desc' } },
    take: 6,
  })
  const weeklyProductIds = weeklyHotRows
    .map((row) => row.productId)
    .filter((id): id is string => !!id)
  const weeklyQtyMap = new Map(weeklyHotRows.map((row) => [
    row.productId,
    row._sum.quantity?.toNumber() ?? 0,
  ]))
  const weeklyProductRows = weeklyProductIds.length > 0
    ? await prisma.product.findMany({
        where: {
          tenantId: store.tenantId,
          id: { in: weeklyProductIds },
          status: 'ACTIVE',
        },
        select: { id: true, name: true, spec: true, sellPrice: true, imageUrl: true, imageUrls: true },
      })
    : []
  const weeklyProductMap = new Map(weeklyProductRows.map((p) => [p.id, p]))

  const fallbackRows = await prisma.product.findMany({
    where: {
      tenantId: store.tenantId,
      status: 'ACTIVE',
      OR: [
        { imageUrl: { not: null } },
        { imageUrls: { not: null } },
      ],
    },
    select: { id: true, name: true, spec: true, sellPrice: true, imageUrl: true, imageUrls: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
    take: 12,
  })

  function toDisplayProduct(p: { id: string; name: string; spec: string | null; sellPrice: { toNumber(): number }; imageUrl: string | null; imageUrls: string | null }, totalQty?: number): DisplayProduct | null {
    const imageUrl = cleanDisplayImageUrl(p.imageUrl) ?? cleanDisplayImageUrl(parseImageUrls(p.imageUrls, p.imageUrl)[0])
    if (!imageUrl) return null
    return {
      id: p.id,
      name: p.name,
      spec: p.spec,
      sellPrice: p.sellPrice.toNumber(),
      imageUrl,
      ...(totalQty !== undefined ? { totalQty } : {}),
    }
  }

  const displayProductMap = new Map<string, DisplayProduct>()
  for (const id of weeklyProductIds) {
    const product = weeklyProductMap.get(id)
    const displayProduct = product ? toDisplayProduct(product, weeklyQtyMap.get(id) ?? 0) : null
    if (displayProduct) displayProductMap.set(displayProduct.id, displayProduct)
    if (displayProductMap.size >= 3) break
  }
  for (const product of fallbackRows) {
    if (displayProductMap.size >= 3) break
    if (displayProductMap.has(product.id)) continue
    const displayProduct = toDisplayProduct(product)
    if (displayProduct) displayProductMap.set(displayProduct.id, displayProduct)
  }
  const displayProducts = Array.from(displayProductMap.values()).slice(0, 3)

  const items = parseItems(row?.itemsJson)
  const missingImageProductIds = items
    .filter((item) => !cleanDisplayImageUrl(item.imageUrl))
    .map((item) => item.productId)
  const productImageRows = missingImageProductIds.length > 0
    ? await prisma.product.findMany({
        where: {
          tenantId: store.tenantId,
          id: { in: [...new Set(missingImageProductIds)] },
          status: 'ACTIVE',
        },
        select: { id: true, imageUrl: true, imageUrls: true },
      })
    : []
  const productImageMap = new Map(productImageRows.map((p) => [
    p.id,
    cleanDisplayImageUrl(p.imageUrl) ?? cleanDisplayImageUrl(parseImageUrls(p.imageUrls, p.imageUrl)[0]),
  ]))
  const displayItems = items.map((item) => ({
    ...item,
    imageUrl: cleanDisplayImageUrl(item.imageUrl) ?? productImageMap.get(item.productId) ?? null,
  }))
  const now = new Date()
  const ageMs = row ? now.getTime() - row.updatedAt.getTime() : 0
  const displayStatus = row?.status === 'DRAFT' && displayItems.length > 0 && ageMs > DRAFT_TIMEOUT_MS
    ? 'EXPIRED_DRAFT'
    : row?.status === 'AWAITING_PAYMENT' && displayItems.length > 0 && ageMs > CHECKOUT_TIMEOUT_MS
      ? 'EXPIRED_CHECKOUT'
      : row?.status ?? null

  const khqrConfig = await findKhqrConfig(store.tenantId, store.id)
  const storeKhqrImageUrl = cleanDisplayImageUrl(khqrConfig?.khqrImageUrl)
  const khqrImageUrl = cleanDisplayImageUrl(row?.khqrImageUrl)
    ?? storeKhqrImageUrl

  return NextResponse.json({
    storeCode: store.code,
    storeName: store.name,
    storeBannerUrl: cleanDisplayImageUrl(store.bannerUrl),
    storeKhqrImageUrl,
    displayProducts,
    serverNow: now.toISOString(),
    session: row ? {
      status: row.status,
      displayStatus,
      paymentMethod: row.paymentMethod,
      paymentStatus: row.paymentStatus,
      items: displayItems,
      totalAmount: row.totalAmount.toNumber(),
      itemCount: row.itemCount,
      khqrPayload: row.khqrPayload,
      khqrImageUrl,
      orderNo: row.orderNo,
      message: row.message,
      completedAt: row.completedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    } : null,
  })
}
