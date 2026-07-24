/**
 * POST /api/cashier/checkout
 *
 * Desktop POS endpoint. Requires logged-in store OWNER/STAFF or signed POS device token.
 *
 * 将本门店一笔"待收款挂单"（SaleRecord.status = PENDING_PAYMENT，共享同一 orderNo）
 * 转入收款并完成：
 *   - CASH               → PaymentIntent(PAID)，明细行 → COMPLETED
 *   - KHQR + 人工确认已收 → PaymentIntent(PAID)，明细行 → COMPLETED
 *   - KHQR 未确认         → 409 MANUAL_PAYMENT_CONFIRMATION_REQUIRED
 *
 * 语义与 POST /api/cashier/sales 完全一致（复用同一收款判定），区别仅在于：
 * 本接口作用于"已存在"的挂单记录，不新建 SaleRecord，从而让手机端挂单能在浏览器端闭环收款。
 *
 * Body: { storeCode, orderNo, paymentMethod: 'CASH'|'KHQR', manualPaymentConfirmed? }
 *
 * 仅操作现有 SaleRecord / PaymentIntent，不引入新模型、不改支付流程。
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateKhqrPayload } from '@/lib/khqr'
import { findKhqrConfig, type MerchantKhqrConfig } from '@/lib/merchant-config'
import { authorizeDesktopPosRequest, unauthorizedPosResponse } from '@/lib/desktop-pos-auth'
import { isKhqrSupportedCurrency } from '@/lib/currency'
import {
  requiresCashierManualPaymentConfirmation,
  resolveCashierPaymentIntentStatus,
} from '@/lib/cashier-payment-confirmation'

export async function POST(req: NextRequest) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })
  }

  const { storeCode, orderNo, paymentMethod = 'CASH', manualPaymentConfirmed = false } = body as {
    storeCode?: string
    orderNo?: string
    paymentMethod?: string
    manualPaymentConfirmed?: boolean
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
  if (requiresCashierManualPaymentConfirmation(paymentMethod, manualPaymentConfirmed === true)) {
    return NextResponse.json(
      { error: 'MANUAL_PAYMENT_CONFIRMATION_REQUIRED' },
      { status: 409 },
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
  if (paymentMethod === 'KHQR' && !isKhqrSupportedCurrency(store.currencyCode)) {
    return NextResponse.json(
      { error: 'KHQR_UNSUPPORTED_CURRENCY', message: '当前门店货币不支持 KHQR，请使用现金收款' },
      { status: 422 },
    )
  }

  // 本门店该挂单的所有待收款明细行
  const records = await prisma.saleRecord.findMany({
    where: {
      orderNo: orderNo.trim(),
      tenantId: store.tenantId,
      storeId: store.id,
      status: 'PENDING_PAYMENT',
    },
  })
  if (records.length === 0) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'No pending payment records found for this order' },
      { status: 404 },
    )
  }

  // 幂等：已进入收款流程则拒绝重复结账
  const existingPi = await prisma.paymentIntent.findFirst({
    where: { orderNo: orderNo.trim(), tenantId: store.tenantId },
  })
  if (existingPi) {
    return NextResponse.json(
      { error: 'ALREADY_CHECKED_OUT', paymentIntentId: existingPi.id, status: existingPi.status },
      { status: 409 },
    )
  }

  const totalAmount = records.reduce((sum, r) => sum + r.lineAmount.toNumber(), 0)

  // KHQR 配置：未配置系统内图片时仍可使用柜台实体码兜底，不改变人工确认语义
  let khqrConfig: MerchantKhqrConfig | null = null
  let khqrFallback = false
  if (paymentMethod === 'KHQR') {
    const cfg = await findKhqrConfig(store.tenantId, store.id)
    if (cfg) khqrConfig = cfg
    else khqrFallback = true
  }

  const paymentIntentStatus = resolveCashierPaymentIntentStatus(
    paymentMethod,
    manualPaymentConfirmed === true,
  )
  const isPaid = paymentIntentStatus === 'PAID'

  try {
    const pi = await prisma.$transaction(async (tx) => {
      const khqrPayload = paymentMethod === 'KHQR' && khqrConfig
        ? generateKhqrPayload({ amount: totalAmount, orderNo: orderNo.trim(), config: khqrConfig })
        : null

      const intent = await tx.paymentIntent.create({
        data: {
          tenantId: store.tenantId,
          storeId: store.id,
          operatorUserId: posAuth.operatorUserId,
          orderNo: orderNo.trim(),
          paymentMethod: paymentMethod as 'CASH' | 'KHQR',
          status: paymentIntentStatus,
          amount: totalAmount,
          khqrPayload,
          provider: khqrConfig?.provider ?? null,
          merchantConfigId: khqrConfig?.id ?? null,
          paidAt: isPaid ? new Date() : null,
        },
      })

      if (isPaid) {
        await tx.saleRecord.updateMany({
          where: { orderNo: orderNo.trim(), tenantId: store.tenantId, storeId: store.id, status: 'PENDING_PAYMENT' },
          data: { status: 'COMPLETED' },
        })
      }

      return intent
    })

    return NextResponse.json(
      {
        orderNo: orderNo.trim(),
        totalAmount,
        itemCount: records.length,
        paymentMethod,
        paymentIntentId: pi.id,
        khqrPayload: pi.khqrPayload,
        khqrImageUrl: khqrConfig?.khqrImageUrl ?? null,
        khqrFallback,
        status: pi.status,
      },
      { status: 201 },
    )
  } catch (err) {
    console.error('[POST /api/cashier/checkout]', err)
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
