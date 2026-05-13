import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendAndLogMessage } from '@/lib/telegram'

/**
 * POST /api/public/orders
 *
 * 顾客端公开下单接口（无需登录）。
 * 请求体：{ storeCode, items: [{productId, quantity}], customerTelegramId? }
 *
 * 服务端二次校验商品价格（不信任前端价格），确认商品均 ACTIVE 后创建 CustomerOrder。
 * 订单创建后异步通知门店 OWNER 的 Telegram（fire-and-forget，不阻塞响应）。
 */

type OrderItem = { productId: string; quantity: number }

// 顾客 H5 三语文案（按下单时 lang 返回；商户通知保持中文）
type Lang = 'zh' | 'en' | 'km'
const MSG: Record<Lang, {
  submitted: string; orderNo: string; total: string; statusPending: string
  emptyCart: string; storeNotFound: string; productUnavailable: string; invalidQty: string
}> = {
  zh: {
    submitted: '订单已提交',
    orderNo:   '订单号',
    total:     '合计',
    statusPending: '待商家确认',
    emptyCart: '购物车为空',
    storeNotFound: '门店不存在或已暂停营业',
    productUnavailable: '部分商品已下架，请刷新页面后重试',
    invalidQty: '商品数量无效',
  },
  en: {
    submitted: 'Order placed',
    orderNo:   'Order No.',
    total:     'Total',
    statusPending: 'Awaiting confirmation',
    emptyCart: 'Cart is empty',
    storeNotFound: 'Store not found or unavailable',
    productUnavailable: 'Some items are unavailable. Please refresh and try again.',
    invalidQty: 'Invalid quantity',
  },
  km: {
    submitted: 'បញ្ជាទិញបានដាក់ស្នើ',
    orderNo:   'លេខបញ្ជា',
    total:     'សរុប',
    statusPending: 'រង់ចាំការបញ្ជាក់',
    emptyCart: 'រទេះទិញទំនិញទទេ',
    storeNotFound: 'រកមិនឃើញហាង ឬហាងបិទ',
    productUnavailable: 'ទំនិញខ្លះអស់ហើយ សូម refresh',
    invalidQty: 'ចំនួនមិនត្រឹមត្រូវ',
  },
}

function pickLang(v: unknown): Lang {
  return v === 'en' || v === 'km' ? v : 'zh'
}

export async function POST(req: NextRequest) {
  let body: { storeCode?: string; items?: OrderItem[]; customerTelegramId?: string; remark?: string; lang?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const { storeCode, items, customerTelegramId, remark } = body
  const lang = pickLang(body.lang)
  const T = MSG[lang]

  if (!storeCode) {
    return NextResponse.json({ error: 'MISSING_STORE_CODE' }, { status: 400 })
  }
  if (!items?.length) {
    return NextResponse.json({ error: 'EMPTY_CART', message: T.emptyCart }, { status: 400 })
  }

  // ── 查门店 ────────────────────────────────────────────────────────────────
  const store = await prisma.store.findUnique({
    where: { code: storeCode },
    select: { id: true, name: true, code: true, status: true, tenantId: true },
  })

  if (!store || store.status !== 'ACTIVE') {
    return NextResponse.json(
      { error: 'STORE_NOT_FOUND', message: T.storeNotFound },
      { status: 404 },
    )
  }

  // ── 校验商品（服务端权威价格） ──────────────────────────────────────────
  const productIds = items.map((i) => i.productId)
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, tenantId: store.tenantId, status: 'ACTIVE' },
    select: { id: true, name: true, spec: true, sellPrice: true },
  })

  const productMap = new Map(products.map((p) => [p.id, p]))

  for (const item of items) {
    if (!productMap.has(item.productId)) {
      return NextResponse.json(
        { error: 'PRODUCT_UNAVAILABLE', message: T.productUnavailable },
        { status: 400 },
      )
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      return NextResponse.json(
        { error: 'INVALID_QUANTITY', message: T.invalidQty },
        { status: 400 },
      )
    }
  }

  // ── 服务端计算总金额 ────────────────────────────────────────────────────
  let totalAmount = 0
  const itemsForJson = items.map((item) => {
    const p = productMap.get(item.productId)!
    const price = p.sellPrice.toNumber()
    const lineAmount = price * item.quantity
    totalAmount += lineAmount
    return { productId: item.productId, name: p.name, spec: p.spec ?? null, price, quantity: item.quantity, lineAmount }
  })

  // ── 生成 orderNo：格式 C-yyyyMMdd-STORECODE-seq ─────────────────────────
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '')
  const startOfDay = new Date(now); startOfDay.setUTCHours(0, 0, 0, 0)
  const endOfDay   = new Date(now); endOfDay.setUTCHours(23, 59, 59, 999)

  const todayCount = await prisma.customerOrder.count({
    where: { storeId: store.id, createdAt: { gte: startOfDay, lte: endOfDay } },
  })

  const seq     = String(todayCount + 1).padStart(4, '0')
  const orderNo = `C-${dateStr}-${store.code.toUpperCase().slice(0, 6)}-${seq}`

  // ── 创建订单 ──────────────────────────────────────────────────────────────
  const order = await prisma.customerOrder.create({
    data: {
      tenantId:           store.tenantId,
      storeId:            store.id,
      storeCode:          store.code,
      orderNo,
      customerTelegramId: customerTelegramId?.trim() || null,
      itemsJson:          JSON.stringify(itemsForJson),
      totalAmount:        String(totalAmount.toFixed(2)),
      status:             'PENDING',
      remark:             typeof remark === 'string' && remark.trim() ? remark.trim().slice(0, 500) : null,
    },
  })

  // ── 通知 OWNER ────────────────────────────────────────────────────────────
  await notifyOwner(store.tenantId, store.name, order.orderNo, itemsForJson, totalAmount).catch(
    (e) => console.error('[customer-order] notify owner failed:', e),
  )

  return NextResponse.json({
    orderNo:     order.orderNo,
    totalAmount: Number(totalAmount.toFixed(2)),
    itemCount:   items.reduce((s, i) => s + i.quantity, 0),
    // 三语文案，由 H5 顾客下单时 lang 决定；客户端可直接展示无需自己映射
    message:     T.submitted,
    labels: {
      submitted:     T.submitted,
      orderNo:       T.orderNo,
      total:         T.total,
      statusPending: T.statusPending,
    },
    lang,
  })
}

// ── 通知老板 Telegram ─────────────────────────────────────────────────────────

async function notifyOwner(
  tenantId: string,
  storeName: string,
  orderNo: string,
  items: { name: string; spec: string | null; quantity: number; price: number }[],
  totalAmount: number,
) {
  const owner = await prisma.user.findFirst({
    where: { tenantId, role: 'OWNER', status: 'ACTIVE', telegramId: { not: null } },
    select: { telegramId: true },
  })
  if (!owner?.telegramId) return

  const itemLines = items
    .map((i) => `  · ${i.name}${i.spec ? ` (${i.spec})` : ''} × ${i.quantity}`)
    .join('\n')

  const text =
    `🛒 新顾客订单\n` +
    `门店：${storeName}\n` +
    `订单号：${orderNo}\n` +
    `─────────────\n` +
    `${itemLines}\n` +
    `─────────────\n` +
    `合计：$${totalAmount.toFixed(2)}\n\n` +
    `状态：待确认`

  await sendAndLogMessage({ recipientTelegramId: owner.telegramId, text, tenantId, sentBy: 'SYSTEM' })
}
