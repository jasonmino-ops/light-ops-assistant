/**
 * GET /api/customer-orders/[id]/khqr — OWNER only
 *
 * 返回该顾客订单当前门店可用的 KHQR 收款码（图片优先，否则动态 payload）。
 * **不创建 PaymentIntent、不写库**，仅用于 /home 顾客订单 KHQR 弹层展示。
 * 收款确认仍走原 PATCH /api/customer-orders/[id]。
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { findKhqrConfig } from '@/lib/merchant-config'
import { generateKhqrPayload } from '@/lib/khqr'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  const { id } = await params
  const order = await prisma.customerOrder.findFirst({
    where: { id, tenantId: ctx.tenantId },
    select: { id: true, orderNo: true, storeId: true, totalAmount: true },
  })
  if (!order) {
    return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })
  }

  const config = await findKhqrConfig(ctx.tenantId, order.storeId)
  if (!config) {
    return NextResponse.json(
      { error: 'KHQR_NOT_CONFIGURED', message: 'KHQR 未配置' },
      { status: 400 },
    )
  }

  const amount = order.totalAmount.toNumber()
  const khqrPayload = generateKhqrPayload({ amount, orderNo: order.orderNo, config })

  return NextResponse.json({
    orderNo:      order.orderNo,
    totalAmount:  amount,
    khqrPayload,
    khqrImageUrl: config.khqrImageUrl,
  })
}
