import { after, NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { lockOrderSettlement, orderRecordStore } from '@/lib/order-settlement-lock'
import { inventoryDisplayedCurrency, recordInventoryOrderCurrency } from '@/lib/native-inventory/order-currency'
import { getContext } from '@/lib/context'
import { generateKhqrPayload } from '@/lib/khqr'
import { findKhqrConfig, type MerchantKhqrConfig } from '@/lib/merchant-config'
import { isKhqrSupportedCurrency } from '@/lib/currency'
import { notifyCashierGateway } from '@/lib/cashier-realtime-notify'

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

  const tenantScope = { tenantId: ctx.tenantId, ...(ctx.role === 'STAFF' ? { storeId: ctx.storeId } : {}) }
  // Verify PENDING_PAYMENT records exist for this order
  const records = await prisma.saleRecord.findMany({
    where: { orderNo, ...tenantScope, status: 'PENDING_PAYMENT' },
  })

  if (records.length === 0) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'No pending payment records found for this order' },
      { status: 404 },
    )
  }

  // Dining bills share SaleRecord but must settle through the dining meal
  // state machine. The legacy order checkout must never create a second
  // PaymentIntent or bypass batch/void/print invariants.
  if (records.some((record) => record.diningBatchId)) {
    return NextResponse.json(
      { error: 'DINING_CHECKOUT_REQUIRED', message: '堂食账单请从堂食页面整桌结账' },
      { status: 409 },
    )
  }

  const storeId = records[0].storeId
  if (records.some((record) => record.storeId !== storeId)) return NextResponse.json({ error: 'INVALID_ORDER_SCOPE' }, { status: 409 })
  const scope = { orderNo, tenantId: ctx.tenantId, storeId }
  const paymentScope = { orderNo, tenantId: ctx.tenantId }
  const totalAmount = records.reduce((sum, r) => sum + r.lineAmount.toNumber(), 0)

  // Prepare KHQR outside the transaction. A locked replay of an existing
  // intent takes precedence even if the store can no longer create one.
  let khqrConfig: MerchantKhqrConfig | null = null
  let khqrUnavailable: { status: number; error: string; message?: string } | null = null
  if (paymentMethod === 'KHQR') {
    const store = await prisma.store.findFirst({
      where: { id: storeId, tenantId: ctx.tenantId, status: 'ACTIVE' },
      select: { currencyCode: true },
    })
    if (!store) {
      khqrUnavailable = { status: 404, error: 'STORE_NOT_FOUND' }
    } else if (!isKhqrSupportedCurrency(store.currencyCode)) {
      khqrUnavailable = { status: 422, error: 'KHQR_UNSUPPORTED_CURRENCY', message: '当前门店货币不支持 KHQR，请使用现金收款' }
    } else {
      khqrConfig = await findKhqrConfig(ctx.tenantId, storeId)
      if (!khqrConfig) {
        khqrUnavailable = { status: 422, error: 'KHQR_NOT_CONFIGURED', message: '当前门店未配置 KHQR 收款，请联系老板' }
      }
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockOrderSettlement(tx, ctx.tenantId, orderNo)
      if (await orderRecordStore(tx, scope) !== storeId) return { kind: 'CHANGED' as const }
      const prior = await tx.paymentIntent.findFirst({ where: paymentScope })
      if (prior) return { kind: 'REPLAY' as const, intent: prior }
      if (khqrUnavailable) return { kind: 'KHQR_UNAVAILABLE' as const, failure: khqrUnavailable }
      const pending = await tx.saleRecord.count({ where: { ...scope, status: 'PENDING_PAYMENT' } })
      if (pending !== records.length) return { kind: 'CHANGED' as const }

      const khqrPayload =
        paymentMethod === 'KHQR' && khqrConfig
          ? generateKhqrPayload({ amount: totalAmount, orderNo, config: khqrConfig })
          : null

      const store = await tx.store.findFirstOrThrow({
        where: { id: storeId, tenantId: ctx.tenantId },
        select: { currencyCode: true },
      })
      await recordInventoryOrderCurrency(tx, {
        tenantId: ctx.tenantId, storeId, kind: 'POS_PAYMENT',
        currencyCode: khqrConfig?.currency ?? inventoryDisplayedCurrency(body.displayedCurrency, store.currencyCode),
      })
      const intent = await tx.paymentIntent.create({
        data: {
          tenantId: ctx.tenantId,
          storeId,
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
          where: { ...scope, status: 'PENDING_PAYMENT' },
          data: { status: 'COMPLETED' },
        })
      }
      // KHQR: records remain PENDING_PAYMENT until /api/payments/:id/confirm

      return { kind: 'CHECKED_OUT' as const, intent }
    })
    if (result.kind === 'CHANGED') return NextResponse.json({ error: 'ORDER_STATE_CHANGED' }, { status: 409 })
    if (result.kind === 'KHQR_UNAVAILABLE') {
      const { status, ...failure } = result.failure
      return NextResponse.json(failure, { status })
    }
    const pi = result.intent
    if (result.kind === 'REPLAY') {
      return NextResponse.json({ error: 'ALREADY_CHECKED_OUT', paymentIntentId: pi.id, status: pi.status }, { status: 409 })
    }

    if (paymentMethod === 'CASH') {
      after(() => notifyCashierGateway({
        tenantId: records[0].tenantId,
        storeId: records[0].storeId,
        type: 'pending_orders_changed',
      }))
    }

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
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const committed = await prisma.paymentIntent.findFirst({ where: paymentScope })
      if (committed && (ctx.role === 'OWNER' || committed.storeId === storeId)) {
        return NextResponse.json(
          { error: 'ALREADY_CHECKED_OUT', paymentIntentId: committed.id, status: committed.status },
          { status: 409 },
        )
      }
    }
    console.error('[POST /api/orders/checkout]', err)
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
