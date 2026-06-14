/**
 * GET /api/pos/session/current?storeCode=XXX
 * 电脑端 /desktop 每 1.5s 轮询读 PosSession（公开 storeCode 入口，与 /api/cashier/store 同模式）。
 * 返回 null session = 当前门店无草稿（idle）。serverNow 用于客户端"完成 N 秒后回 idle"判断。
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type PosItem = {
  productId: string
  name: string
  spec: string | null
  price: number
  qty: number
  lineAmount: number
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
      khqrImageUrl: row.khqrImageUrl,
      orderNo: row.orderNo,
      message: row.message,
      completedAt: row.completedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    } : null,
  })
}
