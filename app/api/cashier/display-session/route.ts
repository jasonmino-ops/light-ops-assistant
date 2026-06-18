/**
 * POST /api/cashier/display-session
 *
 * Public cashier mirror endpoint. It only updates PosSession for
 * /desktop/display and never creates SaleRecord or PaymentIntent.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { findKhqrConfig } from '@/lib/merchant-config'
import { generateKhqrPayload } from '@/lib/khqr'

type ClientItem = {
  productId?: unknown
  name?: unknown
  spec?: unknown
  imageUrl?: unknown
  price?: unknown
  qty?: unknown
  lineAmount?: unknown
}

type CleanItem = {
  productId: string
  name: string
  spec: string | null
  imageUrl: string | null
  price: number
  qty: number
  lineAmount: number
}

const ALLOWED_STATUS = new Set(['DRAFT', 'AWAITING_PAYMENT', 'COMPLETED', 'CANCELLED'])
const ALLOWED_PAYMENT_METHOD = new Set(['CASH', 'KHQR'])
const MAX_ITEMS = 100

function cleanItems(raw: unknown): CleanItem[] {
  if (!Array.isArray(raw)) return []
  const out: CleanItem[] = []
  for (const r of raw.slice(0, MAX_ITEMS) as ClientItem[]) {
    if (!r || typeof r !== 'object') continue
    const productId = typeof r.productId === 'string' ? r.productId.slice(0, 64) : ''
    const name = typeof r.name === 'string' ? r.name.slice(0, 200) : ''
    if (!productId || !name) continue
    const price = Number(r.price)
    const qty = Number(r.qty)
    const line = Number(r.lineAmount)
    if (!Number.isFinite(price) || !Number.isFinite(qty) || qty <= 0) continue
    out.push({
      productId,
      name,
      spec: typeof r.spec === 'string' && r.spec.trim() ? r.spec.slice(0, 200) : null,
      imageUrl: cleanImageUrl(r.imageUrl),
      price: +price.toFixed(2),
      qty: +qty.toFixed(3),
      lineAmount: Number.isFinite(line) ? +line.toFixed(2) : +(price * qty).toFixed(2),
    })
  }
  return out
}

function cleanImageUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value) return null
  if (value.startsWith('http://') || value.startsWith('https://')) return value.slice(0, 2048)
  if (value.startsWith('/')) return value.slice(0, 2048)
  if (value.startsWith('data:image/') && value.includes(',')) return value.slice(0, 300000)
  return null
}

export async function POST(req: NextRequest) {
  let body: {
    storeCode?: unknown
    status?: unknown
    paymentMethod?: unknown
    paymentStatus?: unknown
    items?: unknown
    orderNo?: unknown
    message?: unknown
  }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const storeCode = typeof body.storeCode === 'string' ? body.storeCode.trim() : ''
  if (!storeCode) {
    return NextResponse.json({ error: 'MISSING_STORE_CODE' }, { status: 400 })
  }

  const store = await prisma.store.findUnique({
    where: { code: storeCode },
    select: { id: true, code: true, tenantId: true, status: true },
  })
  if (!store || store.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })
  }

  const status = typeof body.status === 'string' && ALLOWED_STATUS.has(body.status) ? body.status : 'DRAFT'
  const items = status === 'CANCELLED' ? [] : cleanItems(body.items)
  const totalAmount = items.reduce((sum, item) => sum + item.lineAmount, 0)
  const itemCount = Math.round(items.reduce((sum, item) => sum + item.qty, 0))
  const paymentMethod = typeof body.paymentMethod === 'string' && ALLOWED_PAYMENT_METHOD.has(body.paymentMethod)
    ? body.paymentMethod
    : null
  const paymentStatus = body.paymentStatus === 'PAID' || body.paymentStatus === 'PENDING'
    ? body.paymentStatus
    : null
  const orderNo = typeof body.orderNo === 'string' && body.orderNo.trim() ? body.orderNo.trim().slice(0, 64) : null
  const message = typeof body.message === 'string' && body.message.trim() ? body.message.trim().slice(0, 200) : null

  let khqrPayload: string | null = null
  let khqrImageUrl: string | null = null
  if (status === 'AWAITING_PAYMENT' && paymentMethod === 'KHQR' && items.length > 0) {
    const config = await findKhqrConfig(store.tenantId, store.id)
    if (config) {
      khqrImageUrl = cleanImageUrl(config.khqrImageUrl)
      khqrPayload = generateKhqrPayload({
        amount: +totalAmount.toFixed(2),
        orderNo: orderNo ?? `CASHIER-${store.code}-${Math.round(totalAmount * 100)}`,
        config,
      })
    }
  }

  try {
    await prisma.posSession.upsert({
      where: { tenantId_storeId: { tenantId: store.tenantId, storeId: store.id } },
      create: {
        tenantId: store.tenantId,
        storeId: store.id,
        storeCode: store.code,
        status,
        paymentMethod,
        paymentStatus,
        itemsJson: JSON.stringify(items),
        totalAmount: +totalAmount.toFixed(2),
        itemCount,
        khqrPayload,
        khqrImageUrl,
        orderNo,
        message,
        completedAt: status === 'COMPLETED' || status === 'CANCELLED' ? new Date() : null,
      },
      update: {
        status,
        paymentMethod,
        paymentStatus,
        itemsJson: JSON.stringify(items),
        totalAmount: +totalAmount.toFixed(2),
        itemCount,
        khqrPayload,
        khqrImageUrl,
        orderNo,
        message,
        completedAt: status === 'COMPLETED' || status === 'CANCELLED' ? new Date() : null,
      },
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[cashier/display-session] update failed', e)
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}
