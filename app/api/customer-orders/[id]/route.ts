import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { sendAndLogMessage } from '@/lib/telegram'

/**
 * PATCH /api/customer-orders/[id]
 *
 * 更新顾客订单状态。OWNER 和 STAFF 均可操作。
 * 允许的状态流转：
 *   PENDING   → CONFIRMED | CANCELLED
 *   CONFIRMED → COMPLETED | CANCELLED
 */

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PENDING:   ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['COMPLETED', 'CANCELLED'],
}

const STATUS_LABELS: Record<string, string> = {
  CONFIRMED: '已确认',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
}

type Lang = 'zh' | 'en' | 'km'

function normalizeLang(v: string | null | undefined): Lang {
  const s = (v ?? '').toLowerCase()
  if (s === 'zh' || s.startsWith('zh-') || s.startsWith('zh_')) return 'zh'
  if (s === 'en' || s.startsWith('en-') || s.startsWith('en_')) return 'en'
  if (s === 'km' || s.startsWith('km-') || s.startsWith('kh') || s === 'km_kh') return 'km'
  return 'zh'
}

function shortOrderNo(orderNo: string): string {
  // 取末段（C-YYYYMMDD-STORE-####）的最后一段；不足则取末 4 位
  const seg = orderNo.split('-').pop() ?? orderNo
  return `#${seg.slice(-6) || seg}`
}

type TplCtx = { no: string; total: string }

const STATUS_MSG: Record<string, Record<Lang, (c: TplCtx) => string>> = {
  PENDING: {
    zh: ({ no, total }) => `主人，您的订单 ${no} 已收到，我们正在为您安排 ❤️\n金额：$${total}`,
    en: ({ no, total }) => `Hi! Your order ${no} has been received — we're getting it ready for you ❤️\nTotal: $${total}`,
    km: ({ no, total }) => `សួស្តីម្ចាស់! ការបញ្ជាទិញ ${no} ត្រូវបានទទួល យើងកំពុងរៀបចំ ❤️\nចំនួន: $${total}`,
  },
  CONFIRMED: {
    zh: ({ no, total }) => `主人，您的订单 ${no} 正在处理中，请稍候 ✨\n金额：$${total}`,
    en: ({ no, total }) => `Hi! Your order ${no} is being prepared — please hold on ✨\nTotal: $${total}`,
    km: ({ no, total }) => `សួស្តីម្ចាស់! ការបញ្ជាទិញ ${no} កំពុងដំណើរការ សូមរង់ចាំបន្តិច ✨\nចំនួន: $${total}`,
  },
  READY: {
    zh: ({ no, total }) => `主人，您的订单 ${no} 已准备完成，感谢您的支持 🎉\n金额：$${total}`,
    en: ({ no, total }) => `Hi! Your order ${no} is ready — thanks for your support 🎉\nTotal: $${total}`,
    km: ({ no, total }) => `សួស្តីម្ចាស់! ការបញ្ជាទិញ ${no} បានរៀបចំរួចរាល់ សូមអរគុណ 🎉\nចំនួន: $${total}`,
  },
  COMPLETED: {
    zh: ({ no, total }) => `主人，您的订单 ${no} 已准备完成，感谢您的支持 🎉\n金额：$${total}`,
    en: ({ no, total }) => `Hi! Your order ${no} is ready — thanks for your support 🎉\nTotal: $${total}`,
    km: ({ no, total }) => `សួស្តីម្ចាស់! ការបញ្ជាទិញ ${no} បានរៀបចំរួចរាល់ សូមអរគុណ 🎉\nចំនួន: $${total}`,
  },
  OUT_FOR_DELIVERY: {
    zh: ({ no }) => `主人，您的订单 ${no} 正在赶来，请注意查收 🚀`,
    en: ({ no }) => `Hi! Your order ${no} is on the way — please be ready 🚀`,
    km: ({ no }) => `សួស្តីម្ចាស់! ការបញ្ជាទិញ ${no} កំពុងដឹកមកដល់ សូមត្រៀមទទួល 🚀`,
  },
  CANCELLED: {
    zh: ({ no }) => `很抱歉主人，您的订单 ${no} 未能完成，请联系商家 🙏`,
    en: ({ no }) => `Sorry — your order ${no} could not be completed. Please contact the merchant 🙏`,
    km: ({ no }) => `សុំទោសម្ចាស់! ការបញ្ជាទិញ ${no} មិនអាចបញ្ចប់បាន សូមទាក់ទងហាង 🙏`,
  },
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })

  const { id } = await params

  let body: { status?: string; paymentMethod?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const order = await prisma.customerOrder.findFirst({
    where: { id, tenantId: ctx.tenantId },
  })
  if (!order) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  // ── 分支 A：收款登记 ────────────────────────────────────────────────────────
  if (body.paymentMethod) {
    const { paymentMethod } = body
    if (!['CASH', 'QR'].includes(paymentMethod)) {
      return NextResponse.json({ error: 'INVALID_PAYMENT_METHOD' }, { status: 400 })
    }
    if (order.status !== 'COMPLETED') {
      return NextResponse.json({ error: 'ORDER_NOT_COMPLETED' }, { status: 400 })
    }
    if (order.paymentStatus === 'PAID') {
      return NextResponse.json({ error: 'ALREADY_PAID' }, { status: 400 })
    }

    const updated = await prisma.customerOrder.update({
      where: { id },
      data: {
        paymentStatus: 'PAID',
        paymentMethod,
        paidAt: new Date(),
        paidAmount: order.totalAmount,
      },
      select: { id: true, orderNo: true, status: true, paymentStatus: true, paymentMethod: true },
    })

    return NextResponse.json({
      id: updated.id,
      orderNo: updated.orderNo,
      status: updated.status,
      paymentStatus: updated.paymentStatus,
      paymentMethod: updated.paymentMethod,
    })
  }

  // ── 分支 B：状态流转 ────────────────────────────────────────────────────────
  const { status: newStatus } = body
  if (!newStatus) return NextResponse.json({ error: 'MISSING_ACTION' }, { status: 400 })

  const allowed = ALLOWED_TRANSITIONS[order.status] ?? []
  if (!allowed.includes(newStatus)) {
    return NextResponse.json(
      { error: 'INVALID_TRANSITION', message: `不能从 ${order.status} 转为 ${newStatus}` },
      { status: 400 },
    )
  }

  const updated = await prisma.customerOrder.update({
    where: { id },
    data: { status: newStatus },
    select: { id: true, orderNo: true, status: true, customerTelegramId: true, totalAmount: true, customerLang: true, storeCode: true },
  })

  // 若顾客有 Telegram ID，异步发送状态变更通知（走顾客端机器人）
  if (updated.customerTelegramId) {
    // 语言决议：customerLang → StoreCustomerContact.telegramLanguageCode → 'zh'
    let lang: Lang | null = updated.customerLang ? normalizeLang(updated.customerLang) : null
    if (!lang) {
      const contact = await prisma.storeCustomerContact.findFirst({
        where: { tenantId: ctx.tenantId, telegramId: updated.customerTelegramId },
        select: { telegramLanguageCode: true },
      }).catch(() => null)
      lang = normalizeLang(contact?.telegramLanguageCode)
    }
    const tpl = STATUS_MSG[newStatus]
    const text = tpl ? tpl[lang]({
      no:    shortOrderNo(updated.orderNo),
      total: updated.totalAmount.toNumber().toFixed(2),
    }) : null
    if (text) {
      sendAndLogMessage({
        recipientTelegramId: updated.customerTelegramId,
        text,
        tenantId: ctx.tenantId,
        sentBy: 'SYSTEM',
        botToken: process.env.CUSTOMER_BOT_TOKEN,
      }).catch((e) => console.error('[customer-order] 通知顾客失败:', e))
    }
  }

  return NextResponse.json({
    id: updated.id,
    orderNo: updated.orderNo,
    status: updated.status,
    statusLabel: STATUS_LABELS[updated.status] ?? updated.status,
  })
}
