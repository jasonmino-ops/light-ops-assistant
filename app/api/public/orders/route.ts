import { after, NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { sendAndLogMessage } from '@/lib/telegram'
import {
  cleanTrackingText,
  cleanVisitorId,
  createCustomerJourneyEvent,
} from '@/lib/customer-journey'
import { notifyCashierGateway } from '@/lib/cashier-realtime-notify'

/**
 * POST /api/public/orders
 *
 * 顾客端公开下单接口（无需登录）。
 * 请求体：{ storeCode, items: [{productId, quantity}], customerTelegramId? }
 *
 * 服务端二次校验商品价格（不信任前端价格），确认商品均 ACTIVE 后创建 CustomerOrder。
 * 订单创建后异步通知门店 OWNER 的 Telegram（fire-and-forget，不阻塞响应）。
 */

type OrderItem = { productId: string; quantity: number; sugar?: string }

class SubmissionError extends Error {
  constructor(public readonly status: number, code: string, public readonly detail?: string) { super(code) }
}

// v1 uses fixed fields and ordered lines, not the caller's JSON object key order.
// Null/absent optional text is equivalent; these limits match the existing write contract.
function submissionText(value: unknown, max?: number): string | null {
  if (value == null) return null
  if (typeof value !== 'string') throw new SubmissionError(400, 'INVALID_REQUEST')
  const s = value.trim()
  return (max == null ? s : s.slice(0, max)) || null
}

function submissionCoordinate(value: unknown, limit: number): number | null {
  if (value == null || value === '') return null
  if (typeof value !== 'number' && typeof value !== 'string') throw new SubmissionError(400, 'INVALID_REQUEST')
  const n = Number(value)
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null
}

function submissionConflict(error: unknown): 'KEY' | 'ORDER_NO' | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return null
  const meta = error.meta as Record<string, any> | undefined
  // Prisma/adapter-pg may expose target fields or the original structured constraint.
  const constraint = meta?.driverAdapterError?.cause?.constraint
  const target: unknown = meta?.target ?? constraint?.fields
  // adapter-pg 7.6 reports quoted PostgreSQL identifiers in cause.constraint.fields.
  // Normalize identifiers only, never classify by free-form error messages.
  const fields: unknown = Array.isArray(target) ? target.map(field => typeof field === 'string' && /^"(?:[^"]|"")+"$/.test(field)
    ? field.slice(1, -1).replace(/""/g, '"') : field) : target
  const name: unknown = typeof constraint === 'string' ? constraint : constraint?.index ?? constraint?.name
  if (fields === 'CustomerOrder_submission_key' || name === 'CustomerOrder_submission_key'
    || (Array.isArray(fields) && fields.length === 3 && ['tenantId', 'storeId', 'submissionKey'].every(k => fields.includes(k)))) return 'KEY'
  if (fields === 'CustomerOrder_orderNo_key' || name === 'CustomerOrder_orderNo_key'
    || (Array.isArray(fields) && fields.length === 1 && fields[0] === 'orderNo')) return 'ORDER_NO'
  return null
}

function replaySubmission(row: { submissionHash: string | null; submissionVersion: number | null; submissionResponse: Prisma.JsonValue; orderNo: string }, hash: string) {
  if (row.submissionHash !== hash || row.submissionVersion !== 1) throw new SubmissionError(409, 'IDEMPOTENCY_KEY_CONFLICT')
  const receipt = row.submissionResponse
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
    || receipt.orderNo !== row.orderNo || typeof receipt.totalAmount !== 'number') {
    throw new SubmissionError(503, 'SUBMISSION_RECEIPT_UNAVAILABLE')
  }
  return receipt
}

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
  const key = req.headers.get('idempotency-key') ?? ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(key)) {
    return NextResponse.json({ error: 'INVALID_IDEMPOTENCY_KEY', submissionState: 'NOT_COMMITTED' }, { status: 400 })
  }
  let raw: Record<string, unknown>
  try {
    raw = await req.json()
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid body')
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON', submissionState: 'NOT_COMMITTED' }, { status: 400 })
  }

  try {
    const storeCode = submissionText(raw.storeCode)
    if (!storeCode) throw new SubmissionError(400, 'MISSING_STORE_CODE')
    if (!Array.isArray(raw.items) || raw.items.length === 0) throw new SubmissionError(400, 'EMPTY_CART')
    const items: OrderItem[] = raw.items.map((value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SubmissionError(400, 'INVALID_REQUEST')
      const line = value as Record<string, unknown>
      const productId = submissionText(line.productId)
      if (!productId) throw new SubmissionError(400, 'INVALID_REQUEST')
      if (!Number.isSafeInteger(line.quantity) || (line.quantity as number) <= 0) throw new SubmissionError(400, 'INVALID_QUANTITY')
      const sugar = submissionText(line.sugar)
      return { productId, quantity: line.quantity as number, ...(sugar ? { sugar } : {}) }
    })
    const tableNo = submissionText(raw.tableNo, 20)
    const remark = submissionText(raw.remark, 500)
    const trimmedTgId = submissionText(raw.customerTelegramId)
    const couponId = submissionText(raw.couponId)
    const pickupMethod = submissionText(raw.pickupMethod) ?? ''
    const customerName = submissionText(raw.customerName, 60)
    const customerPhone = submissionText(raw.customerPhone, 40)
    const deliveryAddress = submissionText(raw.deliveryAddress, 500)
    const deliveryNote = submissionText(raw.deliveryNote, 300)
    const deliveryLat = submissionCoordinate(raw.deliveryLat, 90)
    const deliveryLng = submissionCoordinate(raw.deliveryLng, 180)
    const photo = submissionText(raw.deliveryAddressPhotoUrl)
    const deliveryAddressPhotoUrl = photo && /^https?:\/\//i.test(photo) ? photo.slice(0, 1000) : null
    const rawCampaignCode = submissionText(raw.campaignCode) ?? ''
    const rawCampaignIntent = submissionText(raw.campaignIntent) ?? ''
    const orderSource = cleanTrackingText(raw.orderSource)
    const landingSource = cleanTrackingText(raw.source)
    const landingCampaign = cleanTrackingText(raw.campaign, 120)
    const landingVisitorId = cleanVisitorId(raw.visitorId)
    const lang = pickLang(raw.lang), T = MSG[lang]
    const normalized = { version: 1, storeCode, items, tableNo, remark, customerTelegramId: trimmedTgId,
      couponId, pickupMethod, customerName, customerPhone, deliveryAddress, deliveryNote, deliveryLat, deliveryLng,
      deliveryAddressPhotoUrl, campaignCode: rawCampaignCode, campaignIntent: rawCampaignIntent,
      orderSource, source: landingSource, campaign: landingCampaign, visitorId: landingVisitorId, lang }
    const hash = createHash('sha256').update(JSON.stringify(normalized), 'utf8').digest('hex')
    const store = await prisma.store.findUnique({
      where: { code: storeCode }, select: { id: true, name: true, code: true, status: true, tenantId: true },
    })
    if (!store) throw new SubmissionError(404, 'STORE_NOT_FOUND', T.storeNotFound)
    const whereKey = { tenantId_storeId_submissionKey: { tenantId: store.tenantId, storeId: store.id, submissionKey: key } }
    const existing = await prisma.customerOrder.findUnique({ where: whereKey })
    if (existing) return NextResponse.json(replaySubmission(existing, hash))

    // Attribution is optional and outside the short transaction. SQL failures must
    // not be caught inside a PostgreSQL transaction and then treated as recoverable.
    let campaignAttribution: { sourcePlatform: string; campaignCode: string; campaignLinkId: string | null; campaignIntent: string } | null = null
    if (rawCampaignCode) {
      const cl = await prisma.campaignLink.findUnique({ where: { code: rawCampaignCode }, select: { id: true, sourcePlatform: true } }).catch(() => null)
      if (cl) campaignAttribution = { sourcePlatform: cl.sourcePlatform, campaignCode: rawCampaignCode, campaignLinkId: cl.id, campaignIntent: rawCampaignIntent || 'order' }
    }
    if (!campaignAttribution && orderSource === 'landing') {
      campaignAttribution = { sourcePlatform: 'landing', campaignCode: landingCampaign ?? '', campaignLinkId: null, campaignIntent: landingSource ? `landing:${landingSource}` : 'landing' }
    }

    const createSubmission = async (tx: Prisma.TransactionClient) => {
      // Same-prefix stores share the legacy globally-unique orderNo namespace.
      // A transaction-scoped lock is compatible with transaction-mode pooling.
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      const prefix = `C-${dateStr}-${store.code.toUpperCase().slice(0, 6)}-`
      const lockKey = createHash('sha256').update(`customer-order-number:v1:${prefix}`).digest().readBigInt64BE(0)
      await tx.$queryRaw`SELECT set_config('lock_timeout', '3000', true)`
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${lockKey}::bigint) IS NULL AS locked`
      const prior = await tx.customerOrder.findUnique({ where: whereKey })
      if (prior) return { kind: 'REPLAY' as const, receipt: replaySubmission(prior, hash) }
      const currentStore = await tx.store.findFirst({ where: { id: store.id, tenantId: store.tenantId, code: storeCode } })
      if (!currentStore || currentStore.status !== 'ACTIVE') throw new SubmissionError(404, 'STORE_NOT_FOUND', T.storeNotFound)
      if (pickupMethod === 'delivery' && (!customerPhone || !deliveryAddress)) throw new SubmissionError(400, 'DELIVERY_INFO_REQUIRED', '请填写联系电话和送货/上门地址')

      const products = await tx.product.findMany({
        where: { id: { in: items.map(i => i.productId) }, tenantId: store.tenantId, status: 'ACTIVE' },
        select: { id: true, name: true, spec: true, sellPrice: true, discountPrice: true, discountEnabled: true, printKitchenTicket: true },
      })
      const productMap = new Map(products.map(p => [p.id, p]))
      let subtotal = 0, saleSubtotal = 0
      const itemsForJson = items.map(item => {
        const p = productMap.get(item.productId)
        if (!p) throw new SubmissionError(400, 'PRODUCT_UNAVAILABLE', T.productUnavailable)
        const originalPrice = p.sellPrice.toNumber()
        const price = p.discountEnabled && p.discountPrice ? p.discountPrice.toNumber() : originalPrice
        const lineAmount = price * item.quantity
        subtotal += originalPrice * item.quantity
        saleSubtotal += lineAmount
        return { productId: item.productId, name: p.name, spec: p.spec ?? null, originalPrice, price, quantity: item.quantity, lineAmount,
          printKitchenTicket: p.printKitchenTicket, ...(item.sugar ? { sugar: item.sugar } : {}) }
      })
      if (!Number.isFinite(subtotal) || !Number.isFinite(saleSubtotal) || subtotal > 9_999_999_999.99 || saleSubtotal > 9_999_999_999.99) throw new SubmissionError(400, 'INVALID_AMOUNT')
      subtotal = +subtotal.toFixed(2); saleSubtotal = +saleSubtotal.toFixed(2)
      const productDiscountAmount = +(subtotal - saleSubtotal).toFixed(2)
      let couponDiscountAmount = 0
      let couponSnapshot: { id: string; name: string; type: 'AMOUNT_OFF' | 'PERCENT_OFF' } | null = null
      if (couponId) {
        if (!trimmedTgId) throw new SubmissionError(400, 'COUPON_NEED_TG', '使用优惠券需绑定 Telegram 顾客身份')
        const coupon = await tx.customerCoupon.findFirst({
          where: { id: couponId, tenantId: store.tenantId, telegramId: trimmedTgId, status: 'AVAILABLE', OR: [{ storeId: store.id }, { storeId: null }] },
        })
        if (!coupon) throw new SubmissionError(400, 'COUPON_INVALID', '优惠券不可用')
        if (coupon.expiresAt.getTime() <= Date.now()) throw new SubmissionError(400, 'COUPON_EXPIRED', '优惠券已过期')
        const minSpend = coupon.minSpend.toNumber()
        if (saleSubtotal < minSpend) throw new SubmissionError(400, 'COUPON_MIN_NOT_MET', `未满 ${minSpend.toFixed(2)} 不可用`)
        if (coupon.type === 'AMOUNT_OFF') couponDiscountAmount = Math.min(Number(coupon.amountOff ?? 0), saleSubtotal)
        else if (coupon.type === 'PERCENT_OFF') couponDiscountAmount = saleSubtotal * Math.max(0, Math.min(100, Number(coupon.percentOff ?? 0))) / 100
        couponDiscountAmount = +Math.max(0, couponDiscountAmount).toFixed(2)
        couponSnapshot = { id: coupon.id, name: coupon.name, type: coupon.type as 'AMOUNT_OFF' | 'PERCENT_OFF' }
      }
      const discountAmount = +(productDiscountAmount + couponDiscountAmount).toFixed(2)
      const payableAmount = +Math.max(0, saleSubtotal - couponDiscountAmount).toFixed(2)
      const pattern = `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([0-9]+)$`
      const maxima = await tx.$queryRaw<Array<{ max: string }>>`SELECT COALESCE(MAX((substring("orderNo" from ${pattern}))::numeric), 0)::text AS max FROM "CustomerOrder" WHERE "orderNo" ~ ${pattern}`
      const orderNo = prefix + (BigInt(maxima[0].max) + BigInt(1)).toString().padStart(4, '0')
      const receipt = { orderNo, totalAmount: payableAmount, subtotal, discountAmount, payableAmount, coupon: couponSnapshot,
        itemCount: items.reduce((n, i) => n + i.quantity, 0), message: T.submitted,
        labels: { submitted: T.submitted, orderNo: T.orderNo, total: T.total, statusPending: T.statusPending }, lang }
      const created = await tx.customerOrder.create({ data: {
        tenantId: store.tenantId, storeId: store.id, storeCode: store.code, orderNo,
        submissionKey: key, submissionHash: hash, submissionVersion: 1, submissionResponse: receipt,
        customerTelegramId: trimmedTgId, customerLang: lang, customerName, customerPhone, deliveryAddress, deliveryNote,
        deliveryLat, deliveryLng, deliveryAddressPhotoUrl, tableNo, remark,
        itemsJson: JSON.stringify(itemsForJson), totalAmount: payableAmount.toFixed(2), status: 'PENDING', ...(campaignAttribution ?? {}),
      } })
      if (couponSnapshot) {
        const upd = await tx.customerCoupon.updateMany({
          where: { id: couponSnapshot.id, tenantId: store.tenantId, telegramId: trimmedTgId!, status: 'AVAILABLE', expiresAt: { gt: new Date() }, OR: [{ storeId: store.id }, { storeId: null }] },
          data: { status: 'USED', usedAt: new Date(), usedOrderNo: created.orderNo },
        })
        if (upd.count !== 1) throw new SubmissionError(409, 'COUPON_ALREADY_USED', '该优惠券已被使用')
        await tx.couponRedemption.create({ data: { tenantId: store.tenantId, storeId: store.id, couponId: couponSnapshot.id,
          telegramId: trimmedTgId!, orderNo: created.orderNo, discountAmount: couponDiscountAmount.toFixed(2) } })
      }
      return { kind: 'CREATED' as const, receipt, created, itemsForJson }
    }

    let order: Awaited<ReturnType<typeof createSubmission>> | undefined
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        order = await prisma.$transaction(createSubmission, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5_000, timeout: 15_000 })
        break
      } catch (error) {
        const conflict = submissionConflict(error)
        if (conflict) {
          // The rejected transaction has ended. Never query inside an aborted tx.
          const prior = await prisma.customerOrder.findUnique({ where: whereKey })
          if (prior) return NextResponse.json(replaySubmission(prior, hash))
          if (conflict === 'ORDER_NO' && attempt < 2) continue
          throw new SubmissionError(503, 'SUBMISSION_RETRY_SAME_KEY')
        }
        throw error
      }
    }
    if (!order) throw new SubmissionError(503, 'SUBMISSION_RETRY_SAME_KEY')
    if (order.kind === 'REPLAY') return NextResponse.json(order.receipt)

    // Business commit is complete. Wake/notification failures cannot turn a
    // successful order into a misleading whole-request failure; replays do not wake.
    try {
      after(() => notifyCashierGateway({
        tenantId: store.tenantId,
        storeId: store.id,
        type: 'orders_changed',
      }))
    } catch { console.error('[customer-order] post-commit wake scheduling failed') }
    if (orderSource === 'landing') {
      await createCustomerJourneyEvent({ eventType: 'order_conversion', storeId: store.id, storeCode: store.code,
        visitorId: landingVisitorId, source: landingSource, campaign: landingCampaign, language: lang,
        orderId: order.created.id, eventKey: `order_conversion:${order.created.id}` }).catch(() => console.error('[customer-order] post-commit attribution failed'))
    }
    await notifyOwner(store.tenantId, store.name, order.created.orderNo, order.itemsForJson, order.receipt.totalAmount,
      { tableNo, pickupMethod, customerName, customerPhone, deliveryAddress, deliveryNote, deliveryLat, deliveryLng, deliveryAddressPhotoUrl },
      campaignAttribution).catch(() => console.error('[customer-order] post-commit owner notification failed'))
    return NextResponse.json(order.receipt)
  } catch (error) {
    if (error instanceof SubmissionError) return NextResponse.json({ error: error.message, message: error.detail,
      submissionState: error.status < 500 ? 'NOT_COMMITTED' : 'UNKNOWN', retryWithSameKey: error.status >= 500 }, { status: error.status })
    const e = error as { code?: string; meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } } }
    const sqlState = e.meta?.code ?? e.meta?.driverAdapterError?.cause?.originalCode
    const retry = e.code === 'P2034' || (e.code === 'P2010' && ['40001', '40P01', '55P03'].includes(sqlState ?? ''))
    console.error('[customer-order] submission transaction failed', { code: e.code ?? 'UNKNOWN' })
    return NextResponse.json({ error: retry ? 'SUBMISSION_RETRY_SAME_KEY' : 'ORDER_SUBMISSION_FAILED', submissionState: 'UNKNOWN', retryWithSameKey: true }, { status: retry ? 503 : 500 })
  }
}

// ── 通知老板 Telegram ─────────────────────────────────────────────────────────

function notifySugarZh(sugar: string): string {
  if (sugar === 'no_sugar') return '无糖'
  if (sugar === '25')       return '微糖 25%'
  if (sugar === '50')       return '半糖 50%'
  if (sugar === '75')       return '少糖 75%'
  if (sugar === '100')      return '正常糖 100%'
  return sugar
}

async function notifyOwner(
  tenantId: string,
  storeName: string,
  orderNo: string,
  items: { name: string; spec: string | null; quantity: number; price: number; sugar?: string }[],
  totalAmount: number,
  delivery: {
    tableNo: string | null
    pickupMethod: string
    customerName: string | null; customerPhone: string | null
    deliveryAddress: string | null; deliveryNote: string | null
    deliveryLat: number | null; deliveryLng: number | null
    deliveryAddressPhotoUrl: string | null
  },
  attribution: {
    sourcePlatform: string | null
    campaignCode: string | null
    campaignLinkId: string | null
    campaignIntent: string | null
  } | null,
) {
  const owner = await prisma.user.findFirst({
    where: { tenantId, role: 'OWNER', status: 'ACTIVE', telegramId: { not: null } },
    select: { telegramId: true },
  })
  if (!owner?.telegramId) return

  const itemLines = items
    .map((i) => {
      const sugarText = i.sugar ? notifySugarZh(i.sugar) : null
      const opts = [i.spec, sugarText].filter(Boolean).join('／')
      return `  · ${i.name}${opts ? ` (${opts})` : ''} × ${i.quantity}`
    })
    .join('\n')

  let deliveryBlock = ''
  if (delivery.pickupMethod === 'delivery' && (delivery.customerPhone || delivery.deliveryAddress)) {
    const lines: string[] = ['🚚 送货/上门信息']
    if (delivery.customerName)    lines.push(`联系人：${delivery.customerName}`)
    if (delivery.customerPhone)   lines.push(`电话：${delivery.customerPhone}`)
    if (delivery.deliveryAddress) lines.push(`地址：${delivery.deliveryAddress}`)
    if (delivery.deliveryNote)    lines.push(`备注：${delivery.deliveryNote}`)
    if (delivery.deliveryLat != null && delivery.deliveryLng != null) {
      lines.push(`地图：https://maps.google.com/?q=${delivery.deliveryLat},${delivery.deliveryLng}`)
    }
    if (delivery.deliveryAddressPhotoUrl) {
      lines.push(`门牌照片：${delivery.deliveryAddressPhotoUrl}`)
    }
    deliveryBlock = `\n${lines.join('\n')}\n─────────────`
  }

  let sourceBlock = ''
  if (attribution?.campaignLinkId) {
    const link = await prisma.campaignLink.findUnique({
      where: { id: attribution.campaignLinkId },
      select: { creatorName: true, videoTitle: true, targetUrl: true },
    }).catch(() => null)
    const platform = attribution.sourcePlatform
      ? attribution.sourcePlatform.charAt(0).toUpperCase() + attribution.sourcePlatform.slice(1)
      : '推广'
    const landingType = link?.targetUrl.startsWith('/p/') ? '营销页' : '菜单页'
    const lines = [`📣 来源：${platform} ${landingType}`]
    if (link?.creatorName) lines.push(`博主：${link.creatorName}`)
    if (attribution.campaignCode) lines.push(`短链：${attribution.campaignCode}`)
    if (link?.videoTitle) lines.push(`视频：${link.videoTitle}`)
    sourceBlock = `\n${lines.join('\n')}\n─────────────`
  }

  const text =
    `🛒 新顾客订单\n` +
    `门店：${storeName}\n` +
    `订单号：${orderNo}\n` +
    (delivery.tableNo ? `桌号：${delivery.tableNo}\n` : '') +
    `─────────────\n` +
    `${itemLines}\n` +
    `─────────────${sourceBlock}${deliveryBlock}\n` +
    `合计：$${totalAmount.toFixed(2)}\n\n` +
    `状态：待确认`

  await sendAndLogMessage({ recipientTelegramId: owner.telegramId, text, tenantId, sentBy: 'SYSTEM' })
}
