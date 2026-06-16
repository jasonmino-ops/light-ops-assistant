import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import {
  inquireShinhanTransaction,
  markPaymentPaidIfValid,
  normalizeShinhanCallback,
} from '@/lib/payments/shinhan'

export async function POST(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })

  let body: { paymentId?: string; trxId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const payment = await prisma.paymentTransaction.findFirst({
    where: {
      tenantId: ctx.tenantId,
      ...(ctx.role === 'STAFF' ? { storeId: ctx.storeId } : {}),
      ...(body.paymentId ? { id: body.paymentId } : body.trxId ? { trxId: body.trxId } : { id: '__missing__' }),
    },
  })
  if (!payment) return NextResponse.json({ error: 'PAYMENT_NOT_FOUND' }, { status: 404 })

  try {
    const inquiryPayload = await inquireShinhanTransaction({ trxId: payment.trxId })
    const resultPayload =
      inquiryPayload?.result && typeof inquiryPayload.result === 'object'
        ? { ...inquiryPayload.result, trxId: payment.trxId }
        : { ...inquiryPayload, trxId: payment.trxId }
    const normalized = normalizeShinhanCallback(resultPayload)
    const code = normalized.responseCode ?? inquiryPayload?.response?.code

    if (code === '200') {
      const paid = await markPaymentPaidIfValid({
        trxId: payment.trxId,
        amount: normalized.paymentAmount ?? payment.amount.toString(),
        payload: resultPayload,
        source: 'inquiry',
      })
      if (!paid.ok) return NextResponse.json({ error: paid.errorCode }, { status: 400 })
    } else {
      await prisma.paymentTransaction.update({
        where: { id: payment.id },
        data: {
          inquiryPayload: inquiryPayload as Prisma.InputJsonValue,
          errorCode: code ? String(code) : 'SHINHAN_INQUIRY_PENDING',
          errorMessage: inquiryPayload?.response?.message ? String(inquiryPayload.response.message) : null,
        },
      })
    }

    const latest = await prisma.paymentTransaction.findUnique({
      where: { id: payment.id },
      select: { id: true, trxId: true, status: true, paidAt: true, inquiryPayload: true },
    })
    return NextResponse.json({
      payment: latest ? { ...latest, paidAt: latest.paidAt?.toISOString() ?? null } : null,
    })
  } catch (e) {
    await prisma.paymentTransaction.update({
      where: { id: payment.id },
      data: {
        errorCode: e instanceof Error ? e.message : 'SHINHAN_INQUIRY_FAILED',
        errorMessage: e instanceof Error ? e.message : String(e),
      },
    })
    return NextResponse.json({ error: 'SHINHAN_INQUIRY_FAILED' }, { status: 502 })
  }
}
