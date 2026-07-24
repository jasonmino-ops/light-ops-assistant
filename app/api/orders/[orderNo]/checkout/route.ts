import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { checkoutDeferredOrder } from '@/lib/order-checkout'

/**
 * POST /api/orders/:orderNo/checkout
 *
 * 将 PENDING_PAYMENT（挂单）订单转入收款流程：
 *  - CASH  → 创建 PaymentIntent(PAID)，SaleRecord → COMPLETED，即时完成
 *  - KHQR  → 创建 PaymentIntent(PENDING)，SaleRecord 保持 PENDING_PAYMENT 直到
 *            /api/payments/:id/confirm 调用后才更新为 COMPLETED
 *
 * 适用：DEFERRED_PAYMENT 门店，店员先挂单、后结账场景（手机商户端）。
 * 状态机与并发/幂等保护统一在 lib/order-checkout.ts，浏览器端复用同一逻辑。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderNo: string }> },
) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })

  const { orderNo } = await params

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })
  }

  const { paymentMethod = 'CASH' } = body as { paymentMethod?: 'CASH' | 'KHQR' }

  if (paymentMethod !== 'CASH' && paymentMethod !== 'KHQR') {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', message: 'paymentMethod must be CASH or KHQR' },
      { status: 400 },
    )
  }

  const store = await prisma.store.findFirst({
    where: { id: ctx.storeId, tenantId: ctx.tenantId, status: 'ACTIVE' },
    select: { currencyCode: true },
  })
  if (!store) return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })

  const result = await checkoutDeferredOrder(prisma, {
    tenantId: ctx.tenantId,
    storeId: ctx.storeId,
    operatorUserId: ctx.userId,
    orderNo,
    paymentMethod,
    currencyCode: store.currencyCode,
  })

  if (!result.ok) {
    switch (result.error) {
      case 'NOT_FOUND':
        return NextResponse.json(
          { error: 'NOT_FOUND', message: 'No pending payment records found for this order' },
          { status: 404 },
        )
      case 'KHQR_UNSUPPORTED_CURRENCY':
        return NextResponse.json(
          { error: 'KHQR_UNSUPPORTED_CURRENCY', message: '当前门店货币不支持 KHQR，请使用现金收款' },
          { status: 422 },
        )
      case 'KHQR_NOT_CONFIGURED':
        return NextResponse.json(
          { error: 'KHQR_NOT_CONFIGURED', message: '当前门店未配置 KHQR 收款，请联系老板' },
          { status: 422 },
        )
      case 'ORDER_CANCELLED':
        return NextResponse.json({ error: 'ORDER_CANCELLED' }, { status: 422 })
      case 'ALREADY_COMPLETED':
        return NextResponse.json({ error: 'ALREADY_COMPLETED' }, { status: 409 })
      case 'PAYMENT_NOT_RESUMABLE':
        return NextResponse.json({ error: 'PAYMENT_NOT_RESUMABLE', status: result.piStatus }, { status: 409 })
      case 'STATE_INCONSISTENT':
      default:
        return NextResponse.json({ error: 'ORDER_STATE_INCONSISTENT' }, { status: 409 })
    }
  }

  // 已存在支付意图（既有 / 并发回收）→ 保持原有幂等语义：ALREADY_CHECKED_OUT
  if (!result.created) {
    return NextResponse.json(
      { error: 'ALREADY_CHECKED_OUT', paymentIntentId: result.pi.id, status: result.pi.status },
      { status: 409 },
    )
  }

  return NextResponse.json(
    {
      orderNo,
      totalAmount: result.totalAmount,
      paymentMethod,
      paymentIntentId: result.pi.id,
      khqrPayload: result.pi.khqrPayload,
      khqrImageUrl: result.khqrImageUrl,
      status: result.pi.status,
    },
    { status: 201 },
  )
}
