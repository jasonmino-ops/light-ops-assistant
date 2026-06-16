import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  assertShinhanCurrency,
  createShinhanDeeplinkPayment,
  formatShinhanAmount,
} from '@/lib/payments/shinhan'

function makeTrxId(orderNo: string): string {
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase()
  return `DXE-${orderNo.replace(/[^A-Za-z0-9]/g, '').slice(-18)}-${Date.now().toString(36).toUpperCase()}-${suffix}`
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params
  let body: { currency?: string } = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const currency = body.currency || 'USD'
  try {
    assertShinhanCurrency(currency)
  } catch {
    return NextResponse.json({ error: 'INVALID_CURRENCY' }, { status: 400 })
  }

  const order = await prisma.customerOrder.findFirst({
    where: { OR: [{ id: orderId }, { orderNo: orderId }] },
    select: {
      id: true,
      tenantId: true,
      storeId: true,
      orderNo: true,
      totalAmount: true,
      status: true,
      paymentStatus: true,
      paymentMethod: true,
    },
  })
  if (!order) return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })
  if (order.status === 'CANCELLED') return NextResponse.json({ error: 'ORDER_CANCELLED' }, { status: 409 })
  if (order.paymentStatus === 'PAID') return NextResponse.json({ error: 'ORDER_ALREADY_PAID' }, { status: 409 })

  const amount = formatShinhanAmount(order.totalAmount.toString())
  const trxId = makeTrxId(order.orderNo)
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000)

  const initial = await prisma.paymentTransaction.create({
    data: {
      tenantId: order.tenantId,
      storeId: order.storeId,
      customerOrderId: order.id,
      provider: 'SHINHAN',
      method: 'DEEPLINK',
      trxId,
      amount,
      currency,
      status: 'PENDING',
      expiresAt,
      requestPayload: { orderNo: order.orderNo, amount, currency, phase: 'init' },
    },
    select: { id: true, trxId: true },
  })

  try {
    const result = await createShinhanDeeplinkPayment({
      paymentId: initial.id,
      trxId,
      amount,
      currency,
      note: `CustomerOrder ${order.orderNo}`,
    })
    const updated = await prisma.paymentTransaction.update({
      where: { id: initial.id },
      data: {
        deepLinkUrl: result.deepLinkUrl,
        callbackUrl: result.callbackApiUrl,
        requestPayload: result.requestPayload,
        responsePayload: result.responsePayload,
      },
      select: { id: true, trxId: true, deepLinkUrl: true, status: true },
    })
    return NextResponse.json({
      paymentId: updated.id,
      trxId: updated.trxId,
      deepLinkUrl: updated.deepLinkUrl,
      status: updated.status,
    })
  } catch (e) {
    const errorCode = e instanceof Error ? e.message || e.name : 'SHINHAN_CREATE_FAILED'
    await prisma.paymentTransaction.update({
      where: { id: initial.id },
      data: {
        status: 'FAILED',
        errorCode,
        errorMessage: e instanceof Error ? e.message : String(e),
      },
    })
    return NextResponse.json({ error: errorCode }, { status: 502 })
  }
}
