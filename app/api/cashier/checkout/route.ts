/**
 * POST /api/cashier/checkout
 *
 * 浏览器员工端结算一笔门店"待收款挂单"（SaleRecord.status=PENDING_PAYMENT）。
 *
 * 授权边界与 /api/cashier/sales 完全一致（正式浏览器员工端边界）：
 *   - 已登录且有权访问该门店的账号；或
 *   - 已签发、绑定具体门店与设备的正式 POS 设备身份。
 * 不接受 storeCode + x-lightops-client 的弱回退（allowStoreCodeFallback: false），
 * tenant/store 由可信身份校验，跨店结账被拒绝。
 *
 * 收款状态机复用 lib/order-checkout.ts（与手机端同一套逻辑）：
 *   - CASH  → 原子完成（PaymentIntent PAID + 明细 COMPLETED）
 *   - KHQR  → 仅创建 PENDING PaymentIntent，明细保持 PENDING_PAYMENT，
 *             完成必须走既有受控确认链 /api/payments/:id/confirm。
 * 本接口不接受客户端 manualPaymentConfirmed，不存在 KHQR 直接置 PAID 的旁路。
 *
 * Body: { storeCode, orderNo, paymentMethod: 'CASH'|'KHQR' }
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authorizeDesktopPosRequest, unauthorizedPosResponse } from '@/lib/desktop-pos-auth'
import { checkoutDeferredOrder } from '@/lib/order-checkout'

export async function POST(req: NextRequest) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })
  }

  const { storeCode, orderNo, paymentMethod = 'CASH' } = body as {
    storeCode?: string
    orderNo?: string
    paymentMethod?: string
  }

  if (!storeCode?.trim()) {
    return NextResponse.json({ error: 'MISSING_STORE_CODE' }, { status: 400 })
  }
  if (!orderNo?.trim()) {
    return NextResponse.json({ error: 'MISSING_ORDER_NO' }, { status: 400 })
  }
  if (paymentMethod !== 'CASH' && paymentMethod !== 'KHQR') {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', message: 'paymentMethod must be CASH or KHQR' },
      { status: 400 },
    )
  }

  const store = await prisma.store.findUnique({
    where: { code: storeCode.trim() },
    select: { id: true, code: true, tenantId: true, status: true, currencyCode: true },
  })
  if (!store || store.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })
  }
  const posAuth = await authorizeDesktopPosRequest(req, {
    tenantId: store.tenantId,
    storeId: store.id,
    storeCode: store.code,
  }, { allowStoreCodeFallback: false })
  if (!posAuth) {
    return unauthorizedPosResponse()
  }

  const result = await checkoutDeferredOrder(prisma, {
    tenantId: store.tenantId,
    storeId: store.id,
    operatorUserId: posAuth.operatorUserId,
    orderNo: orderNo.trim(),
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
        return NextResponse.json({ error: 'ORDER_CANCELLED', message: '该挂单已取消，无法结算' }, { status: 422 })
      case 'ALREADY_COMPLETED':
        return NextResponse.json({ error: 'ALREADY_COMPLETED', message: '该挂单已完成' }, { status: 409 })
      case 'PAYMENT_NOT_RESUMABLE':
        return NextResponse.json(
          { error: 'PAYMENT_NOT_RESUMABLE', message: '该挂单支付已终止，请按门店支付规则处理', status: result.piStatus },
          { status: 409 },
        )
      case 'STATE_INCONSISTENT':
      default:
        return NextResponse.json({ error: 'ORDER_STATE_INCONSISTENT', message: '订单状态不一致，请刷新后重试' }, { status: 409 })
    }
  }

  const { pi } = result
  // pi.status: CASH→PAID（已完成）；KHQR→PENDING（待既有确认链完成）
  const completed = pi.status === 'PAID'
  return NextResponse.json(
    {
      orderNo: orderNo.trim(),
      totalAmount: result.totalAmount,
      paymentMethod: pi.paymentMethod,
      paymentIntentId: pi.id,
      paymentStatus: pi.status,
      completed,
      recovered: !result.created,
      khqrPayload: pi.khqrPayload,
      khqrImageUrl: result.khqrImageUrl,
    },
    { status: result.created ? 201 : 200 },
  )
}
