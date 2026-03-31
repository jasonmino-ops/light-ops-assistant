import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { generateRecordNo } from '@/lib/record-no'

/**
 * POST /api/sales
 *
 * Handles both SALE and REFUND via the saleType field.
 *
 * Identity is taken from headers (x-tenant-id, x-user-id, x-store-id, x-role).
 * storeId and operatorUserId from the request body are always ignored.
 *
 * SALE:   unitPrice re-fetched from DB; lineAmount = quantity × unitPrice (positive)
 * REFUND: lineAmount = -refundQty × originalUnitPrice (negative); availableQty
 *         re-computed server-side; body value is never trusted.
 */
export async function POST(req: NextRequest) {
  const ctx = getContext(req)
  if (!ctx) {
    return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })
  }

  const { saleType } = body

  if (saleType === 'SALE') {
    return handleSale(ctx, body)
  }
  if (saleType === 'REFUND') {
    return handleRefund(ctx, body)
  }

  return NextResponse.json(
    { error: 'VALIDATION_ERROR', message: 'saleType must be SALE or REFUND' },
    { status: 400 },
  )
}

// ---------------------------------------------------------------------------
// SALE branch
// ---------------------------------------------------------------------------

async function handleSale(
  ctx: { tenantId: string; userId: string; storeId: string },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any,
) {
  const { barcode, quantity, remark } = body

  if (!barcode || typeof barcode !== 'string') {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', message: 'barcode is required' },
      { status: 400 },
    )
  }

  const qty = Number(quantity)
  if (!Number.isFinite(qty) || qty <= 0) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', message: 'quantity must be a positive number' },
      { status: 400 },
    )
  }

  // Authoritative price from DB — never trust body.unitPrice
  const product = await prisma.product.findFirst({
    where: { tenantId: ctx.tenantId, barcode, status: 'ACTIVE' },
  })
  if (!product) {
    return NextResponse.json({ error: 'PRODUCT_NOT_FOUND' }, { status: 404 })
  }

  const store = await prisma.store.findFirst({
    where: { id: ctx.storeId, tenantId: ctx.tenantId, status: 'ACTIVE' },
    select: { code: true },
  })
  if (!store) {
    return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 400 })
  }

  const unitPrice = product.sellPrice                  // Prisma Decimal
  const qtyDecimal = new Prisma.Decimal(qty)           // explicit Decimal cast
  const lineAmount = unitPrice.mul(qtyDecimal)
  const remarkValue = typeof remark === 'string' && remark.trim() !== ''
    ? remark.trim()
    : null

  try {
    const record = await prisma.$transaction(async (tx) => {
      const recordNo = await generateRecordNo(tx, 'S', ctx.tenantId, ctx.storeId, store.code)

      const sale = await tx.saleRecord.create({
        data: {
          tenantId: ctx.tenantId,
          storeId: ctx.storeId,
          operatorUserId: ctx.userId,
          recordNo,
          saleType: 'SALE',
          status: 'COMPLETED',
          productId: product.id,
          barcode: product.barcode,
          productNameSnapshot: product.name,
          specSnapshot: product.spec ?? null,
          unitPrice,
          quantity: qtyDecimal,
          lineAmount,
          remark: remarkValue,
        },
      })

      await tx.operationLog.create({
        data: {
          tenantId: ctx.tenantId,
          storeId: ctx.storeId,
          userId: ctx.userId,
          actionType: 'CREATE_SALE',
          targetType: 'SaleRecord',
          targetId: sale.id,
          status: 'SUCCESS',
          message: `Sale created: ${recordNo}`,
          saleRecordId: sale.id,
        },
      })

      return sale
    })

    return NextResponse.json(
      {
        id: record.id,
        recordNo: record.recordNo,
        saleType: record.saleType,
        lineAmount: record.lineAmount.toNumber(),
        createdAt: record.createdAt.toISOString(),
      },
      { status: 201 },
    )
  } catch (err) {
    console.error('[POST /api/sales SALE]', err)
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// REFUND branch
// ---------------------------------------------------------------------------

async function handleRefund(
  ctx: { tenantId: string; userId: string; storeId: string },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any,
) {
  const { originalSaleRecordId, refundQty, refundReason, remark } = body

  if (!originalSaleRecordId || typeof originalSaleRecordId !== 'string') {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', message: 'originalSaleRecordId is required' },
      { status: 400 },
    )
  }

  const rQty = Number(refundQty)
  if (!Number.isFinite(rQty) || rQty <= 0) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', message: 'refundQty must be a positive number' },
      { status: 400 },
    )
  }

  if (!refundReason || typeof refundReason !== 'string' || refundReason.trim() === '') {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', message: 'refundReason is required' },
      { status: 400 },
    )
  }

  // Fetch original sale record — must belong to same tenant, must be SALE type
  const original = await prisma.saleRecord.findFirst({
    where: {
      id: originalSaleRecordId,
      tenantId: ctx.tenantId,
      saleType: 'SALE',
      status: 'COMPLETED',
    },
    include: {
      refundChildren: {
        where: { saleType: 'REFUND', status: 'COMPLETED' },
        select: { quantity: true },
      },
    },
  })

  if (!original) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'Original sale record not found or not eligible for refund' },
      { status: 404 },
    )
  }

  // Re-compute availableQty server-side — never trust body
  const refundedSoFar = original.refundChildren.reduce(
    (sum, r) => sum.add(r.quantity.abs()),
    new Prisma.Decimal(0),
  )
  const availableQty = original.quantity.sub(refundedSoFar)

  const rQtyDecimal = new Prisma.Decimal(rQty)
  if (rQtyDecimal.greaterThan(availableQty)) {
    return NextResponse.json(
      {
        error: 'REFUND_QTY_EXCEEDED',
        message: `Refund quantity ${rQty} exceeds available quantity ${availableQty.toNumber()}`,
        availableQty: availableQty.toNumber(),
      },
      { status: 422 },
    )
  }

  const store = await prisma.store.findFirst({
    where: { id: ctx.storeId, tenantId: ctx.tenantId, status: 'ACTIVE' },
    select: { code: true },
  })
  if (!store) {
    return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 400 })
  }

  const lineAmount = original.unitPrice.mul(rQtyDecimal).negated() // negative
  const remarkValue = typeof remark === 'string' && remark.trim() !== ''
    ? remark.trim()
    : null

  try {
    const record = await prisma.$transaction(async (tx) => {
      const recordNo = await generateRecordNo(tx, 'R', ctx.tenantId, ctx.storeId, store.code)

      const refund = await tx.saleRecord.create({
        data: {
          tenantId: ctx.tenantId,
          storeId: ctx.storeId,
          operatorUserId: ctx.userId,
          recordNo,
          saleType: 'REFUND',
          status: 'COMPLETED',
          originalSaleRecordId: original.id,
          productId: original.productId ?? null,
          barcode: original.barcode,
          productNameSnapshot: original.productNameSnapshot,
          specSnapshot: original.specSnapshot ?? null,
          unitPrice: original.unitPrice,
          quantity: rQtyDecimal.negated(),
          lineAmount,
          refundReason: refundReason.trim(),
          remark: remarkValue,
        },
      })

      await tx.operationLog.create({
        data: {
          tenantId: ctx.tenantId,
          storeId: ctx.storeId,
          userId: ctx.userId,
          actionType: 'CREATE_REFUND',
          targetType: 'SaleRecord',
          targetId: refund.id,
          status: 'SUCCESS',
          message: `Refund created: ${recordNo} for original ${original.recordNo}`,
          saleRecordId: refund.id,
        },
      })

      return refund
    })

    return NextResponse.json(
      {
        id: record.id,
        recordNo: record.recordNo,
        saleType: record.saleType,
        lineAmount: record.lineAmount.toNumber(),
        createdAt: record.createdAt.toISOString(),
      },
      { status: 201 },
    )
  } catch (err) {
    console.error('[POST /api/sales REFUND]', err)
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
