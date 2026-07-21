import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  isShinhanPaidCallback,
  markPaymentPaidIfValid,
  normalizeShinhanCallback,
} from '@/lib/payments/shinhan'

async function readCallbackPayload(req: NextRequest): Promise<Record<string, unknown>> {
  const payload: Record<string, unknown> = {}
  req.nextUrl.searchParams.forEach((value, key) => { payload[key] = value })
  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    const body = await req.json().catch(() => null)
    if (body && typeof body === 'object') Object.assign(payload, body)
  } else if (contentType.includes('application/x-www-form-urlencoded')) {
    const text = await req.text().catch(() => '')
    const form = new URLSearchParams(text)
    form.forEach((value, key) => { payload[key] = value })
  }
  return payload
}

export async function POST(req: NextRequest) {
  const payload = await readCallbackPayload(req)
  const cb = normalizeShinhanCallback(payload)
  if (!cb.trxId) {
    return NextResponse.json({ success: false, error: 'MISSING_TRX_ID' }, { status: 400 })
  }

  const payment = await prisma.paymentTransaction.findUnique({ where: { trxId: cb.trxId } })
  if (!payment) {
    return NextResponse.json({ success: false, error: 'PAYMENT_NOT_FOUND' }, { status: 404 })
  }

  if (!isShinhanPaidCallback(cb)) {
    await prisma.paymentTransaction.update({
      where: { id: payment.id },
      data: {
        status: 'FAILED',
        callbackPayload: payload as Prisma.InputJsonValue,
        errorCode: cb.responseCode ?? cb.respondCode ?? 'SHINHAN_CALLBACK_FAILED',
        errorMessage: cb.responseMessage ?? cb.respondMessage ?? 'Shinhan callback failed',
        providerTrxCode: cb.trxCode ?? cb.txnCode ?? payment.providerTrxCode,
      },
    })
    return NextResponse.json({ success: true, status: 'FAILED' })
  }

  const result = await markPaymentPaidIfValid({
    trxId: cb.trxId,
    amount: cb.paymentAmount,
    payload,
    source: 'callback',
  })
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.errorCode }, { status: 400 })
  }
  return NextResponse.json({ success: true, status: 'PAID' })
}

export function GET() {
  return NextResponse.json(
    { success: false, error: 'METHOD_NOT_ALLOWED' },
    { status: 405, headers: { Allow: 'POST' } },
  )
}
