import { after, NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { generateRecordNo } from '@/lib/record-no'
import { generateKhqrPayload } from '@/lib/khqr'
import { findKhqrConfig, type MerchantKhqrConfig } from '@/lib/merchant-config'
import { isKhqrSupportedCurrency } from '@/lib/currency'
import { notifyCashierGateway } from '@/lib/cashier-realtime-notify'
import {
  decimalToMoney,
  productUnitSnapshot,
  ProductUnitError,
  resolveProductSellingUnit,
} from '@/lib/product-unit'

/**
 * POST /api/sales
 *
 * SALE:   body = { saleType:'SALE', items:[{barcode, quantity}] }
 *         一次结账生成一个 orderNo，多个商品行各自有 recordNo 但共享同一 orderNo。
 *         价格从数据库权威获取，前端传入的 unitPrice 被忽略。
 *
 * REFUND: body = { saleType:'REFUND', originalSaleRecordId, refundQty, refundReason, remark? }
 *         退款针对单条 SaleRecord 行，逻辑不变。
 *
 * ── 餐饮场景扩展预留（未启用）────────────────────────────────────────────────────
 * 当前零售路径：建单即 COMPLETED + CASH→PaymentIntent PAID / KHQR→PaymentIntent PENDING。
 * 未来餐饮"先下单后结账"路径扩展点：
 *   1. 接受 paymentMethod: 'DEFER'（或 body.deferred: true）
 *   2. SaleRecord.status = 'PENDING_PAYMENT'（代替 COMPLETED）
 *   3. 不创建 PaymentIntent — 等待收银员发起结账
 *   4. 结账时由新的 POST /api/orders/:orderNo/checkout 创建 PaymentIntent
 *      并将 SaleRecord.status 更新为 COMPLETED
 * 本路径当前不激活，只预留枚举值和注释。
 */
export async function POST(req: NextRequest) {
  const ctx = await getContext(req)
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

  if (saleType === 'SALE' && body.paymentMethod === 'DEFER') return handleDeferredSale(ctx, body)
  if (saleType === 'SALE') return handleSale(ctx, body)
  if (saleType === 'REFUND') return handleRefund(ctx, body)

  return NextResponse.json(
    { error: 'VALIDATION_ERROR', message: 'saleType must be SALE or REFUND' },
    { status: 400 },
  )
}

// ─── SALE ─────────────────────────────────────────────────────────────────────

type CartItem = { barcode: string; quantity: number }

function recordNoAtOffset(firstRecordNo: string, offset: number) {
  if (offset === 0) return firstRecordNo

  const separatorIndex = firstRecordNo.lastIndexOf('-')
  const firstSequence = Number(firstRecordNo.slice(separatorIndex + 1))
  if (separatorIndex < 0 || !Number.isSafeInteger(firstSequence)) {
    throw new Error('INVALID_GENERATED_RECORD_NO')
  }

  return `${firstRecordNo.slice(0, separatorIndex + 1)}${String(firstSequence + offset).padStart(4, '0')}`
}

async function handleSale(
  ctx: { tenantId: string; userId: string; storeId: string },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any,
) {
  const { items, paymentMethod = 'CASH' } = body as { items: CartItem[]; paymentMethod?: string }

  if (paymentMethod !== 'CASH' && paymentMethod !== 'KHQR') {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', message: 'paymentMethod must be CASH or KHQR' },
      { status: 400 },
    )
  }

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', message: 'items must be a non-empty array' },
      { status: 400 },
    )
  }

  // 校验每条明细
  for (const it of items) {
    if (!it.barcode || typeof it.barcode !== 'string') {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'each item must have a barcode string' },
        { status: 400 },
      )
    }
    const qty = Number(it.quantity)
    if (!Number.isFinite(qty) || qty <= 0) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: `quantity for barcode ${it.barcode} must be positive` },
        { status: 400 },
      )
    }
  }

  // 获取门店信息
  const store = await prisma.store.findFirst({
    where: { id: ctx.storeId, tenantId: ctx.tenantId, status: 'ACTIVE' },
    select: { code: true, currencyCode: true, businessType: true },
  })
  if (!store) {
    return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 400 })
  }
  if (paymentMethod === 'KHQR' && !isKhqrSupportedCurrency(store.currencyCode)) {
    return NextResponse.json(
      { error: 'KHQR_UNSUPPORTED_CURRENCY', message: '当前门店货币不支持 KHQR，请使用现金收款' },
      { status: 422 },
    )
  }

  let saleLines
  try {
    saleLines = await Promise.all(items.map((item) => resolveProductSellingUnit(prisma, {
      tenantId: ctx.tenantId,
      businessType: store.businessType,
      barcode: item.barcode,
      quantity: item.quantity,
    })))
  } catch (error) {
    if (error instanceof ProductUnitError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status })
    }
    throw error
  }

  // KHQR 配置前置检查（事务外快速失败，避免创建半成品记录）
  let khqrConfig: MerchantKhqrConfig | null = null
  if (paymentMethod === 'KHQR') {
    const cfg = await findKhqrConfig(ctx.tenantId, ctx.storeId)
    if (!cfg) {
      return NextResponse.json(
        { error: 'KHQR_NOT_CONFIGURED', message: '当前门店未配置 KHQR 收款，请联系老板' },
        { status: 422 },
      )
    }
    khqrConfig = cfg
  }

  const totalAmount = saleLines.reduce((sum, line) => sum + line.lineAmount.toNumber(), 0)

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 生成第一条记录号，同时用作整单的 orderNo
      const orderNo = await generateRecordNo(tx, 'S', ctx.tenantId, ctx.storeId, store.code)

      const saleRecordData = saleLines.map((line, index) => ({
        tenantId: ctx.tenantId,
        storeId: ctx.storeId,
        operatorUserId: ctx.userId,
        recordNo: recordNoAtOffset(orderNo, index),
        orderNo,
        saleType: 'SALE' as const,
        status: 'COMPLETED' as const,
        productId: line.product.id,
        productNameSnapshot: line.product.name,
        specSnapshot: line.product.spec ?? null,
        ...productUnitSnapshot(line),
      }))

      const records = await tx.saleRecord.createManyAndReturn({
        data: saleRecordData,
        select: { id: true, recordNo: true, createdAt: true },
      })
      const recordsByRecordNo = new Map(records.map((record) => [record.recordNo, record]))
      const firstRecord = recordsByRecordNo.get(orderNo)
      if (!firstRecord || records.length !== saleRecordData.length) {
        throw new Error('SALE_RECORD_BATCH_RESULT_MISMATCH')
      }

      await tx.operationLog.createMany({
        data: saleRecordData.map(({ recordNo }) => {
          const record = recordsByRecordNo.get(recordNo)
          if (!record) throw new Error('SALE_RECORD_BATCH_RESULT_MISMATCH')
          return {
            tenantId: ctx.tenantId,
            storeId: ctx.storeId,
            userId: ctx.userId,
            actionType: 'CREATE_SALE',
            targetType: 'SaleRecord',
            targetId: record.id,
            status: 'SUCCESS' as const,
            message: `Sale line created: ${recordNo} (order ${orderNo})`,
            saleRecordId: record.id,
          }
        }),
      })

      const khqrPayload = paymentMethod === 'KHQR' && khqrConfig
        ? generateKhqrPayload({ amount: totalAmount, orderNo, config: khqrConfig })
        : null

      const pi = await tx.paymentIntent.create({
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

      return {
        orderNo,
        totalAmount,
        itemCount: items.length,
        createdAt: firstRecord.createdAt.toISOString(),
        paymentMethod,
        paymentIntentId: pi.id,
        khqrPayload,
        khqrImageUrl: khqrConfig?.khqrImageUrl ?? null,
      }
    })

    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    console.error('[POST /api/sales SALE]', err)
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}

// ─── DEFERRED SALE ────────────────────────────────────────────────────────────

/**
 * 挂单模式（DEFERRED_PAYMENT 门店）：先建单 PENDING_PAYMENT，不创建 PaymentIntent。
 * 后续由 POST /api/orders/:orderNo/checkout 发起收款。
 */
async function handleDeferredSale(
  ctx: { tenantId: string; userId: string; storeId: string },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any,
) {
  const { items } = body as { items: CartItem[] }

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', message: 'items must be a non-empty array' },
      { status: 400 },
    )
  }

  for (const it of items) {
    if (!it.barcode || typeof it.barcode !== 'string') {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'each item must have a barcode string' },
        { status: 400 },
      )
    }
    const qty = Number(it.quantity)
    if (!Number.isFinite(qty) || qty <= 0) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: `quantity for barcode ${it.barcode} must be positive` },
        { status: 400 },
      )
    }
  }

  const store = await prisma.store.findFirst({
    where: { id: ctx.storeId, tenantId: ctx.tenantId, status: 'ACTIVE' },
    select: { id: true, tenantId: true, code: true, businessType: true },
  })
  if (!store) return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 400 })

  let saleLines
  try {
    saleLines = await Promise.all(items.map((item) => resolveProductSellingUnit(prisma, {
      tenantId: ctx.tenantId,
      businessType: store.businessType,
      barcode: item.barcode,
      quantity: item.quantity,
    })))
  } catch (error) {
    if (error instanceof ProductUnitError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status })
    }
    throw error
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const orderNo = await generateRecordNo(tx, 'S', ctx.tenantId, ctx.storeId, store.code)

      let totalAmount = 0
      let firstCreatedAt: Date | null = null
      let isFirst = true

      for (const line of saleLines) {
        totalAmount += line.lineAmount.toNumber()

        const recordNo = isFirst
          ? orderNo
          : await generateRecordNo(tx, 'S', ctx.tenantId, ctx.storeId, store.code)
        isFirst = false

        const record = await tx.saleRecord.create({
          data: {
            tenantId: ctx.tenantId,
            storeId: ctx.storeId,
            operatorUserId: ctx.userId,
            recordNo,
            orderNo,
            saleType: 'SALE',
            status: 'PENDING_PAYMENT',  // 挂单状态，待收款
            productId: line.product.id,
            productNameSnapshot: line.product.name,
            specSnapshot: line.product.spec ?? null,
            ...productUnitSnapshot(line),
          },
        })

        if (!firstCreatedAt) firstCreatedAt = record.createdAt
      }

      return { orderNo, totalAmount, itemCount: items.length, createdAt: firstCreatedAt!.toISOString() }
    })

    after(() => notifyCashierGateway({
      tenantId: store.tenantId,
      storeId: store.id,
      type: 'pending_orders_changed',
    }))

    return NextResponse.json({ ...result, paymentMethod: 'DEFER' }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/sales DEFER]', err)
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}

// ─── REFUND ───────────────────────────────────────────────────────────────────

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

  const store = await prisma.store.findFirst({
    where: { id: ctx.storeId, tenantId: ctx.tenantId, status: 'ACTIVE' },
    select: { code: true },
  })
  if (!store) {
    return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 400 })
  }

  const remarkValue =
    typeof remark === 'string' && remark.trim() !== '' ? remark.trim() : null

  try {
    const record = await prisma.$transaction(async (tx) => {
      const original = await tx.saleRecord.findFirst({
        where: {
          id: originalSaleRecordId,
          tenantId: ctx.tenantId,
          saleType: 'SALE',
          status: 'COMPLETED',
        },
        include: {
          refundChildren: {
            where: { saleType: 'REFUND', status: 'COMPLETED' },
            select: { quantity: true, sellingQuantity: true, lineAmount: true },
          },
        },
      })
      if (!original) {
        throw new ProductUnitError('NOT_FOUND', 404, 'Original sale record not found or not eligible for refund')
      }

      const unitType = original.sellingUnitType === 'AUX' ? 'AUX' : 'MAIN'
      const factor = original.sellingConversionFactor ?? 1
      if (unitType === 'AUX' && !Number.isInteger(rQty)) {
        throw new ProductUnitError('AUX_REFUND_MUST_BE_INTEGER', 400, '辅单位只能按整包装退款')
      }
      const originalSellingQty = original.sellingQuantity?.abs() ?? original.quantity.abs().div(factor)
      const refundedSellingQty = original.refundChildren.reduce(
        (sum, child) => sum.add(child.sellingQuantity?.abs() ?? child.quantity.abs().div(factor)),
        new Prisma.Decimal(0),
      )
      const availableSellingQty = originalSellingQty.sub(refundedSellingQty)
      const requestedSellingQty = new Prisma.Decimal(rQty)
      if (requestedSellingQty.gt(availableSellingQty)) {
        throw new ProductUnitError(
          'REFUND_QTY_EXCEEDED',
          422,
          `最多可退 ${availableSellingQty.toString()}`,
          { availableQty: availableSellingQty.toNumber() },
        )
      }

      const refundedBaseQty = original.refundChildren.reduce(
        (sum, child) => sum.add(child.quantity.abs()),
        new Prisma.Decimal(0),
      )
      const baseRefundQty = requestedSellingQty.mul(factor)
      const newRefundedBaseQty = refundedBaseQty.add(baseRefundQty)
      const updated = await tx.saleRecord.updateMany({
        where: { id: original.id, refundedQty: original.refundedQty },
        data: { refundedQty: newRefundedBaseQty },
      })
      if (updated.count !== 1) {
        throw new ProductUnitError('REFUND_CONFLICT', 409, '退款数量已变化，请刷新后重试')
      }

      const refundedAmount = original.refundChildren.reduce(
        (sum, child) => sum.add(child.lineAmount.abs()),
        new Prisma.Decimal(0),
      )
      const lineAmount = requestedSellingQty.eq(availableSellingQty)
        ? original.lineAmount.abs().sub(refundedAmount).neg()
        : decimalToMoney(original.unitPrice.mul(requestedSellingQty)).neg()
      const recordNo = await generateRecordNo(tx, 'R', ctx.tenantId, ctx.storeId, store.code)

      const refund = await tx.saleRecord.create({
        data: {
          tenantId: ctx.tenantId,
          storeId: ctx.storeId,
          operatorUserId: ctx.userId,
          recordNo,
          orderNo: recordNo, // 退款单也有自己的 orderNo
          saleType: 'REFUND',
          status: 'COMPLETED',
          originalSaleRecordId: original.id,
          productId: original.productId ?? null,
          barcode: original.barcode,
          productNameSnapshot: original.productNameSnapshot,
          specSnapshot: original.specSnapshot ?? null,
          unitPrice: original.unitPrice,
          quantity: baseRefundQty.neg(),
          lineAmount,
          ...(original.sellingUnitType && original.sellingUnitNameSnapshot && original.sellingQuantity && original.sellingConversionFactor ? {
            sellingUnitType: unitType,
            sellingUnitNameSnapshot: original.sellingUnitNameSnapshot,
            sellingQuantity: requestedSellingQty.neg(),
            sellingConversionFactor: factor,
          } : {}),
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
    if (err instanceof ProductUnitError) {
      return NextResponse.json({ error: err.code, message: err.message, ...err.details }, { status: err.status })
    }
    console.error('[POST /api/sales REFUND]', err)
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
