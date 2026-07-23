import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authorizeTransaction, transactionAuthorizationErrorResponse } from '@/lib/transaction-authorization'

/**
 * POST /api/orders/:orderNo/cancel
 *
 * 取消挂单（PENDING_PAYMENT）订单：
 *  - 将所有 PENDING_PAYMENT SaleRecord 置为 CANCELLED
 *  - 若存在 PENDING PaymentIntent，同步置为 CANCELLED
 *
 * 已 COMPLETED / 已 CANCELLED 订单不可再取消（返回 409）。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderNo: string }> },
) {
  const initialAuthorization = await authorizeTransaction(req, { operation: 'ORDER_CANCEL' })
  if (!initialAuthorization.ok) return transactionAuthorizationErrorResponse(initialAuthorization)
  const initialCtx = initialAuthorization.authorization

  const { orderNo } = await params

  // Check records exist and are cancellable
  const records = await prisma.saleRecord.findMany({
    where: { orderNo, tenantId: initialCtx.tenantId },
    select: { id: true, status: true, storeId: true },
  })

  if (records.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }
  const storeId = records[0].storeId
  if (!records.every((record) => record.storeId === storeId)) return NextResponse.json({ error: 'ORDER_STORE_MISMATCH' }, { status: 409 })
  const store = await prisma.store.findFirst({
    where: { id: storeId, tenantId: initialCtx.tenantId, status: 'ACTIVE' },
    select: { id: true, code: true, tenantId: true },
  })
  if (!store) return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })
  const authorization = await authorizeTransaction(req, { operation: 'ORDER_CANCEL', store: {
    tenantId: store.tenantId, storeId: store.id, storeCode: store.code,
  } })
  if (!authorization.ok) return transactionAuthorizationErrorResponse(authorization)
  const ctx = authorization.authorization

  const alreadyCancelled = records.every((r) => r.status === 'CANCELLED')
  if (alreadyCancelled) {
    return NextResponse.json({ error: 'ALREADY_CANCELLED' }, { status: 409 })
  }

  const hasCompleted = records.some((r) => r.status === 'COMPLETED')
  if (hasCompleted) {
    return NextResponse.json(
      { error: 'ALREADY_COMPLETED', message: '已完成订单不可取消' },
      { status: 409 },
    )
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Cancel all PENDING_PAYMENT records
      await tx.saleRecord.updateMany({
        where: { orderNo, tenantId: ctx.tenantId, status: 'PENDING_PAYMENT' },
        data: { status: 'CANCELLED' },
      })

      // Cancel any pending PaymentIntent
      await tx.paymentIntent.updateMany({
        where: { orderNo, tenantId: ctx.tenantId, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      })
    })

    return NextResponse.json({ orderNo, status: 'CANCELLED' })
  } catch (err) {
    console.error('[POST /api/orders/cancel]', err)
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
