import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { generateKhqrPayload } from '@/lib/khqr'
import { findKhqrConfig, type MerchantKhqrConfig } from '@/lib/merchant-config'

/**
 * POST /api/orders/:orderNo/checkout
 *
 * 将 PENDING_PAYMENT（挂单）订单转入收款流程：
 *  - CASH  → 创建 PaymentIntent(PAID)，SaleRecord → COMPLETED，即时完成
 *  - KHQR  → 创建 PaymentIntent(PENDING)，SaleRecord 保持 PENDING_PAYMENT 直到
 *            /api/payments/:id/confirm 调用后才更新为 COMPLETED
 *
 * 适用：DEFERRED_PAYMENT 门店，店员先挂单、后结账场景。
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

  // Verify PENDING_PAYMENT records exist for this order
  const records = await prisma.saleRecord.findMany({
    where: { orderNo, tenantId: ctx.tenantId, status: 'PENDING_PAYMENT' },
  })

  if (records.length === 0) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'No pending payment records found for this order' },
      { status: 404 },
    )
  }

  // Check PaymentIntent doesn't already exist (idempotency guard)
  const existingPi = await prisma.paymentIntent.findFirst({
    where: { orderNo, tenantId: ctx.tenantId },
  })
  if (existingPi) {
    return NextResponse.json(
      { error: 'ALREADY_CHECKED_OUT', paymentIntentId: existingPi.id, status: existingPi.status },
      { status: 409 },
    )
  }

  const totalAmount = records.reduce((sum, r) => sum + r.lineAmount.toNumber(), 0)

  // KHQR config pre-check
  let khqrConfig: MerchantKhqrConfig | null = null
  if (paymentMethod === 'KHQR') {
    khqrConfig = await findKhqrConfig(ctx.tenantId, ctx.storeId)
    if (!khqrConfig) {
      return NextResponse.json(
        { error: 'KHQR_NOT_CONFIGURED', message: '当前门店未配置 KHQR 收款，请联系老板' },
        { status: 422 },
      )
    }
  }

  try {
    const pi = await prisma.$transaction(async (tx) => {
      const khqrPayload =
        paymentMethod === 'KHQR' && khqrConfig
          ? generateKhqrPayload({ amount: totalAmount, orderNo, config: khqrConfig })
          : null

      const intent = await tx.paymentIntent.create({
        data: {
          tenantId: ctx.tenantId,
          storeId: ctx.storeId,
          operatorUserId: ctx.userId,
          orderNo,
          paymentMethod: paymentMethod as 'CASH' | 'KHQR',
          status: paymentMethod === 'CASH' ? 'PAID' : 'PENDING',
          amount: totalAmount,
          khqrPayload,
          provider: khqrConfig?.provider ?? null,
          merchantConfigId: khqrConfig?.id ?? null,
          paidAt: paymentMethod === 'CASH' ? new Date() : null,
        },
      })

      // CASH: immediately mark records as COMPLETED
      if (paymentMethod === 'CASH') {
        await tx.saleRecord.updateMany({
          where: { orderNo, tenantId: ctx.tenantId, status: 'PENDING_PAYMENT' },
          data: { status: 'COMPLETED' },
        })
      }
      // KHQR: records remain PENDING_PAYMENT until /api/payments/:id/confirm

      return intent
    })

    return NextResponse.json(
      {
        orderNo,
        totalAmount,
        paymentMethod,
        paymentIntentId: pi.id,
        khqrPayload: pi.khqrPayload,
        khqrImageUrl: khqrConfig?.khqrImageUrl ?? null,
        status: pi.status,
      },
      { status: 201 },
    )
  } catch (err) {
    console.error('[POST /api/orders/checkout]', err)
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
