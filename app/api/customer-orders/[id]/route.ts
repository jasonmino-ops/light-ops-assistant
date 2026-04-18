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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })

  const { id } = await params

  let body: { status?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const { status: newStatus } = body
  if (!newStatus) return NextResponse.json({ error: 'MISSING_STATUS' }, { status: 400 })

  const order = await prisma.customerOrder.findFirst({
    where: { id, tenantId: ctx.tenantId },
  })
  if (!order) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

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
    select: { id: true, orderNo: true, status: true, customerTelegramId: true, totalAmount: true },
  })

  // 若顾客有 Telegram ID，异步发送状态变更通知
  if (updated.customerTelegramId) {
    const msgMap: Record<string, string> = {
      CONFIRMED: `✅ 您的订单已确认\n订单号：${updated.orderNo}\n商家正在为您准备，请等待联系。`,
      COMPLETED: `🎉 您的订单已完成\n订单号：${updated.orderNo}\n感谢您的购买！`,
      CANCELLED: `❌ 您的订单已取消\n订单号：${updated.orderNo}\n如有疑问请联系商家。`,
    }
    const text = msgMap[newStatus]
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
