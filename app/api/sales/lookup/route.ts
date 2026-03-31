import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

/**
 * GET /api/sales/lookup?recordNo=<recordNo>
 *
 * Refund page step 1: find the original SALE record by recordNo and return
 * its items list with per-item refund status so the user can select which
 * item to refund.
 *
 * v1: one SaleRecord = one product line, so items always has one element.
 * The array structure is kept to avoid a future breaking change.
 *
 * refundedQty and availableQty are computed server-side from refundChildren —
 * the client must never send these values; they are authoritative only here
 * and in the write path (POST /api/sales REFUND branch).
 */
export async function GET(req: NextRequest) {
  const ctx = getContext(req)
  if (!ctx) {
    return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  }

  const recordNo = req.nextUrl.searchParams.get('recordNo')
  if (!recordNo) {
    return NextResponse.json(
      { error: 'MISSING_PARAM', message: 'recordNo is required' },
      { status: 400 },
    )
  }

  const record = await prisma.saleRecord.findFirst({
    where: {
      recordNo,
      tenantId: ctx.tenantId,
    },
    include: {
      store: { select: { name: true } },
      operatorUser: { select: { displayName: true } },
      refundChildren: {
        where: { saleType: 'REFUND', status: 'COMPLETED' },
        select: { quantity: true },
      },
    },
  })

  if (!record) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }

  // Reject if the record is itself a REFUND — you cannot refund a refund
  if (record.saleType === 'REFUND') {
    return NextResponse.json(
      { error: 'NOT_REFUNDABLE', reason: 'IS_REFUND_RECORD' },
      { status: 422 },
    )
  }

  if (record.status !== 'COMPLETED') {
    return NextResponse.json(
      { error: 'NOT_REFUNDABLE', reason: 'NOT_COMPLETED' },
      { status: 422 },
    )
  }

  const refundedQty = record.refundChildren.reduce(
    (sum, r) => sum.add(r.quantity.abs()),
    new Prisma.Decimal(0),
  )
  const availableQty = record.quantity.sub(refundedQty)
  const refundable = availableQty.greaterThan(0)

  if (!refundable) {
    return NextResponse.json(
      { error: 'NOT_REFUNDABLE', reason: 'FULLY_REFUNDED' },
      { status: 422 },
    )
  }

  return NextResponse.json({
    originalRecordNo: record.recordNo,
    createdAt: record.createdAt.toISOString(),
    storeName: record.store.name,
    operatorDisplayName: record.operatorUser.displayName,
    items: [
      {
        saleRecordId: record.id,
        barcode: record.barcode,
        productNameSnapshot: record.productNameSnapshot,
        specSnapshot: record.specSnapshot,
        unitPrice: record.unitPrice.toNumber(),
        originalQty: record.quantity.toNumber(),
        refundedQty: refundedQty.toNumber(),
        availableQty: availableQty.toNumber(),
        refundable,
      },
    ],
  })
}
