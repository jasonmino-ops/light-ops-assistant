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

type OrderItem = { productId: string; quantity: number; sugar?: string }

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
  let body: {
    storeCode?: string; items?: OrderItem[]; customerTelegramId?: string
    remark?: string; lang?: string; couponId?: string
    pickupMethod?: 'dineIn' | 'delivery' | string
    tableNo?: string
    customerName?: string; customerPhone?: string
    deliveryAddress?: string; deliveryNote?: string
    deliveryLat?: number; deliveryLng?: number
    deliveryAddressPhotoUrl?: string  // 可为 data URL 或外部 URL
    campaignCode?: string; campaignIntent?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const { storeCode, items, customerTelegramId, remark } = body
  const tableNo = typeof body.tableNo === 'string' ? body.tableNo.trim().slice(0, 20) || null : null
  const rawCampaignCode   = typeof body.campaignCode   === 'string' ? body.campaignCode.trim()   : ''
  const rawCampaignIntent = typeof body.campaignIntent === 'string' ? body.campaignIntent.trim() : ''
  const couponId = typeof body.couponId === 'string' ? body.couponId.trim() : ''

  // 配送/上门字段（可选；当 pickupMethod=delivery 时强制电话+地址非空）
  const pickupMethod    = (body.pickupMethod ?? '').trim()
  const customerName    = (body.customerName    ?? '').trim().slice(0, 60) || null
  const customerPhone   = (body.customerPhone   ?? '').trim().slice(0, 40) || null
  const deliveryAddress = (body.deliveryAddress ?? '').trim().slice(0, 500) || null
  const deliveryNote    = (body.deliveryNote    ?? '').trim().slice(0, 300) || null
  const latRaw = Number(body.deliveryLat)
  const lngRaw = Number(body.deliveryLng)
  const deliveryLat = Number.isFinite(latRaw) && latRaw >= -90  && latRaw <= 90  ? latRaw : null
  const deliveryLng = Number.isFinite(lngRaw) && lngRaw >= -180 && lngRaw <= 180 ? lngRaw : null
  if (pickupMethod === 'delivery') {
    if (!customerPhone || !deliveryAddress) {
      return NextResponse.json({ error: 'DELIVERY_INFO_REQUIRED', message: '请填写联系电话和送货/上门地址' }, { status: 400 })
    }
  }

  // 门牌/位置照片：本期只接受 Storage 等 https URL；不再接收 base64 data URL。
  // 旧订单的 base64（deliveryAddressPhotoData）保留，但新订单不写入该字段。
  const rawPhoto = typeof body.deliveryAddressPhotoUrl === 'string' ? body.deliveryAddressPhotoUrl.trim() : ''
  const deliveryAddressPhotoUrl: string | null =
    rawPhoto && /^https?:\/\//i.test(rawPhoto) ? rawPhoto.slice(0, 1000) : null
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
  let subtotal = 0
  const itemsForJson = items.map((item) => {
    const p = productMap.get(item.productId)!
    const price = p.sellPrice.toNumber()
    const lineAmount = price * item.quantity
    subtotal += lineAmount
    return { productId: item.productId, name: p.name, spec: p.spec ?? null, price, quantity: item.quantity, lineAmount, ...(item.sugar ? { sugar: item.sugar } : {}) }
  })
  subtotal = +subtotal.toFixed(2)
  const trimmedTgId = customerTelegramId?.trim() || null

  // ── 校验优惠券（如有） ───────────────────────────────────────────────────
  let discountAmount = 0
  let couponSnapshot: { id: string; name: string; type: 'AMOUNT_OFF' | 'PERCENT_OFF' } | null = null
  if (couponId) {
    if (!trimmedTgId) {
      return NextResponse.json({ error: 'COUPON_NEED_TG', message: '使用优惠券需绑定 Telegram 顾客身份' }, { status: 400 })
    }
    const coupon = await prisma.customerCoupon.findFirst({
      where: {
        id: couponId, tenantId: store.tenantId, telegramId: trimmedTgId, status: 'AVAILABLE',
        OR: [{ storeId: store.id }, { storeId: null }],
      },
    })
    if (!coupon) {
      return NextResponse.json({ error: 'COUPON_INVALID', message: '优惠券不可用' }, { status: 400 })
    }
    if (coupon.expiresAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'COUPON_EXPIRED', message: '优惠券已过期' }, { status: 400 })
    }
    const minSpend = coupon.minSpend.toNumber()
    if (subtotal < minSpend) {
      return NextResponse.json({ error: 'COUPON_MIN_NOT_MET', message: `未满 ${minSpend.toFixed(2)} 不可用` }, { status: 400 })
    }
    if (coupon.type === 'AMOUNT_OFF') discountAmount = Math.min(Number(coupon.amountOff ?? 0), subtotal)
    else if (coupon.type === 'PERCENT_OFF') {
      const p = Math.max(0, Math.min(100, Number(coupon.percentOff ?? 0)))
      discountAmount = +((subtotal * p) / 100).toFixed(2)
    }
    discountAmount = +Math.max(0, discountAmount).toFixed(2)
    couponSnapshot = { id: coupon.id, name: coupon.name, type: coupon.type as 'AMOUNT_OFF' | 'PERCENT_OFF' }
  }

  const payableAmount = +Math.max(0, subtotal - discountAmount).toFixed(2)
  const totalAmount = payableAmount

  // ── 推广归因（非阻断，CampaignLink 不存在时静默忽略） ────────────────────
  let campaignAttribution: {
    sourcePlatform: string; campaignCode: string
    campaignLinkId: string; campaignIntent: string
  } | null = null
  if (rawCampaignCode) {
    try {
      const cl = await prisma.campaignLink.findUnique({
        where: { code: rawCampaignCode },
        select: { id: true, sourcePlatform: true },
      })
      if (cl) {
        campaignAttribution = {
          sourcePlatform: cl.sourcePlatform,
          campaignCode:   rawCampaignCode,
          campaignLinkId: cl.id,
          campaignIntent: rawCampaignIntent || 'order',
        }
      }
    } catch { /* 查询失败不阻断下单 */ }
  }

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

  // ── 事务：创建订单 + 核销优惠券 ─────────────────────────────────────────
  // 单券并发防御：UPDATE WHERE status='AVAILABLE'，影响行 = 0 → 已被他人核销
  let order
  try {
    order = await prisma.$transaction(async (tx) => {
      const created = await tx.customerOrder.create({
        data: {
          tenantId:           store.tenantId,
          storeId:            store.id,
          storeCode:          store.code,
          orderNo,
          customerTelegramId: trimmedTgId,
          customerLang:       lang,
          customerName,
          customerPhone,
          deliveryAddress,
          deliveryNote,
          deliveryLat,
          deliveryLng,
          deliveryAddressPhotoUrl,
          tableNo,
          // 新订单不写入 deliveryAddressPhotoData（base64 旧方案已停用，旧订单数据保留）
          itemsJson:          JSON.stringify(itemsForJson),
          totalAmount:        String(payableAmount.toFixed(2)),
          status:             'PENDING',
          remark:             typeof remark === 'string' && remark.trim() ? remark.trim().slice(0, 500) : null,
          ...(campaignAttribution ?? {}),
        },
      })

      if (couponSnapshot) {
        // 占券 where 重复所有关键约束（防 id 注入 / 跨租户 / 跨店 / 跨人 / 过期 / 已用）
        const upd = await tx.customerCoupon.updateMany({
          where: {
            id:         couponSnapshot.id,
            tenantId:   store.tenantId,
            telegramId: trimmedTgId!,
            status:     'AVAILABLE',
            expiresAt:  { gt: new Date() },
            OR: [{ storeId: store.id }, { storeId: null }],
          },
          data: { status: 'USED', usedAt: new Date(), usedOrderNo: created.orderNo },
        })
        if (upd.count !== 1) throw new Error('COUPON_ALREADY_USED')
        await tx.couponRedemption.create({
          data: {
            tenantId:   store.tenantId,
            storeId:    store.id,
            couponId:   couponSnapshot.id,
            telegramId: trimmedTgId!,
            orderNo:    created.orderNo,
            discountAmount: String(discountAmount.toFixed(2)),
          },
        })
      }

      return created
    })
  } catch (e) {
    if ((e as Error).message === 'COUPON_ALREADY_USED') {
      return NextResponse.json({ error: 'COUPON_ALREADY_USED', message: '该优惠券已被使用' }, { status: 409 })
    }
    throw e
  }

  // ── 通知 OWNER ────────────────────────────────────────────────────────────
  await notifyOwner(store.tenantId, store.name, order.orderNo, itemsForJson, totalAmount, {
    tableNo, pickupMethod, customerName, customerPhone, deliveryAddress, deliveryNote, deliveryLat, deliveryLng,
    deliveryAddressPhotoUrl,
  }, campaignAttribution).catch(
    (e) => console.error('[customer-order] notify owner failed:', e),
  )

  // ── 自动云打印（仅 STANDARD/MULTI_STORE，fire-and-forget，失败不阻塞订单） ──
  void (async () => {
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: store.tenantId },
        select: { tier: true },
      })
      const { autoPrintCustomerOrder, isPrintingTier, logPrintAttempt } = await import('@/lib/cloudPrinter')
      if (!isPrintingTier(tenant?.tier)) {
        await logPrintAttempt({
          tenantId: store.tenantId, storeId: store.id, orderNo: order.orderNo,
          status: 'skipped', reason: `tier_${tenant?.tier ?? 'unknown'}`,
        })
        return
      }
      await autoPrintCustomerOrder({
        tenantId:    store.tenantId,
        storeId:     store.id,
        storeName:   store.name,
        orderNo:     order.orderNo,
        tableNo,
        items:       itemsForJson,
        totalAmount,
        remark:      typeof remark === 'string' && remark.trim() ? remark.trim() : null,
      })
    } catch (e) {
      console.error('[customer-order] auto-print error:', e)
    }
  })()

  return NextResponse.json({
    orderNo:        order.orderNo,
    totalAmount:    payableAmount,
    subtotal,
    discountAmount,
    payableAmount,
    coupon:         couponSnapshot,
    itemCount:      items.reduce((s, i) => s + i.quantity, 0),
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
