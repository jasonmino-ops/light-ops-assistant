/**
 * POST /api/pos/session/update
 * 手机 /sale 端 cart / payStep / pendingPayment 变化时 fire-and-forget upsert。
 * 写 PosSession 一张表；与主销售链路（SaleRecord / PaymentIntent）完全解耦。
 *
 * 安全契约：
 *  - getContext 强校验 tenantId/storeId/userId；body 不接受任何 id
 *  - 路由不导入 prisma.saleRecord / paymentIntent / product.create / customerOrder
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

type ClientItem = { productId?: unknown; name?: unknown; spec?: unknown; imageUrl?: unknown; price?: unknown; qty?: unknown; lineAmount?: unknown }
type CleanItem  = { productId: string; name: string; spec: string | null; imageUrl: string | null; price: number; qty: number; lineAmount: number }

const ALLOWED_STATUS         = new Set(['DRAFT', 'AWAITING_PAYMENT'])
const ALLOWED_PAYMENT_METHOD = new Set(['CASH', 'KHQR'])
const ALLOWED_PAYMENT_STATUS = new Set(['PENDING', 'PAID'])
const MAX_ITEMS = 100

function cleanItems(raw: unknown): CleanItem[] {
  if (!Array.isArray(raw)) return []
  const out: CleanItem[] = []
  for (const r of raw.slice(0, MAX_ITEMS) as ClientItem[]) {
    if (!r || typeof r !== 'object') continue
    const productId = typeof r.productId === 'string' ? r.productId.slice(0, 64) : ''
    const name = typeof r.name === 'string' ? r.name.slice(0, 200) : ''
    if (!productId || !name) continue
    const price = Number(r.price); const qty = Number(r.qty); const line = Number(r.lineAmount)
    if (!Number.isFinite(price) || !Number.isFinite(qty) || qty <= 0) continue
    out.push({
      productId, name,
      spec: typeof r.spec === 'string' && r.spec.trim() ? r.spec.slice(0, 200) : null,
      imageUrl: typeof r.imageUrl === 'string' && r.imageUrl.trim() ? r.imageUrl.slice(0, 2048) : null,
      price: +price.toFixed(2),
      qty: +qty.toFixed(3),
      lineAmount: Number.isFinite(line) ? +line.toFixed(2) : +(price * qty).toFixed(2),
    })
  }
  return out
}

export async function POST(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })

  let body: { items?: unknown; paymentMethod?: unknown; paymentStatus?: unknown;
    khqrPayload?: unknown; khqrImageUrl?: unknown; status?: unknown; message?: unknown }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const store = await prisma.store.findFirst({
    where: { id: ctx.storeId, tenantId: ctx.tenantId, status: 'ACTIVE' },
    select: { id: true, code: true, tenantId: true },
  })
  if (!store) return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })

  const items = cleanItems(body.items)
  const totalAmount = items.reduce((s, i) => s + i.lineAmount, 0)
  const itemCount = items.reduce((s, i) => s + i.qty, 0)

  const status = typeof body.status === 'string' && ALLOWED_STATUS.has(body.status) ? body.status : 'DRAFT'
  const paymentMethod = typeof body.paymentMethod === 'string' && ALLOWED_PAYMENT_METHOD.has(body.paymentMethod) ? body.paymentMethod : null
  const paymentStatus = typeof body.paymentStatus === 'string' && ALLOWED_PAYMENT_STATUS.has(body.paymentStatus) ? body.paymentStatus : null
  const khqrPayload = typeof body.khqrPayload === 'string' && body.khqrPayload ? body.khqrPayload.slice(0, 1024) : null
  const khqrImageUrl = typeof body.khqrImageUrl === 'string' && body.khqrImageUrl ? body.khqrImageUrl.slice(0, 300000) : null
  const message = typeof body.message === 'string' && body.message ? body.message.slice(0, 200) : null

  try {
    await prisma.posSession.upsert({
      where: { tenantId_storeId: { tenantId: store.tenantId, storeId: store.id } },
      create: {
        tenantId: store.tenantId, storeId: store.id, storeCode: store.code,
        operatorUserId: ctx.userId, status,
        paymentMethod, paymentStatus,
        itemsJson: JSON.stringify(items),
        totalAmount: +totalAmount.toFixed(2),
        itemCount: Math.round(itemCount),
        khqrPayload, khqrImageUrl,
        orderNo: null, message, completedAt: null,
      },
      update: {
        operatorUserId: ctx.userId, status,
        paymentMethod, paymentStatus,
        itemsJson: JSON.stringify(items),
        totalAmount: +totalAmount.toFixed(2),
        itemCount: Math.round(itemCount),
        khqrPayload, khqrImageUrl,
        orderNo: null, message, completedAt: null,
      },
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[pos/session/update] upsert failed', e)
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}
