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

const STATUS_MSG: Record<'CONFIRMED'|'COMPLETED'|'CANCELLED', Record<Lang, (orderNo: string) => string>> = {
  CONFIRMED: {
    zh: (n) => `✅ 您的订单已确认\n订单号：${n}\n商家正在为您准备，请等待联系。`,
    en: (n) => `✅ Your order is confirmed\nOrder No.: ${n}\nThe merchant is preparing your order. Please wait for contact.`,
    km: (n) => `✅ ការបញ្ជាទិញរបស់អ្នកត្រូវបានបញ្ជាក់\nលេខបញ្ជាទិញ៖ ${n}\nហាងកំពុងរៀបចំ សូមរង់ចាំការទាក់ទង។`,
  },
  COMPLETED: {
    zh: (n) => `🎉 您的订单已完成\n订单号：${n}\n请完成付款后提货，感谢您的购买！`,
    en: (n) => `🎉 Your order is completed\nOrder No.: ${n}\nPlease complete payment to pick up. Thank you for your purchase!`,
    km: (n) => `🎉 ការបញ្ជាទិញរបស់អ្នកបានបញ្ចប់\nលេខបញ្ជាទិញ៖ ${n}\nសូមបញ្ចប់ការទូទាត់ ហើយយកទំនិញ។ សូមអរគុណ!`,
  },
  CANCELLED: {
    zh: (n) => `❌ 您的订单已取消\n订单号：${n}\n如有疑问请联系商家。`,
    en: (n) => `❌ Your order is cancelled\nOrder No.: ${n}\nPlease contact the merchant if you have any questions.`,
    km: (n) => `❌ ការបញ្ជាទិញរបស់អ្នកត្រូវបានបោះបង់\nលេខបញ្ជាទិញ៖ ${n}\nបើមានសំណួរ សូមទាក់ទងហាង។`,
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
    const tpl = STATUS_MSG[newStatus as 'CONFIRMED'|'COMPLETED'|'CANCELLED']
    const text = tpl ? tpl[lang](updated.orderNo) : null
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
