import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { generateRecordNo } from '@/lib/record-no'
import { generateKhqrPayload, KhqrProviderConfig } from '@/lib/khqr'

/**
 * POST /api/sales
 *
 * SALE:   body = { saleType:'SALE', items:[{barcode, quantity}] }
 *         一次结账生成一个 orderNo，多个商品行各自有 recordNo 但共享同一 orderNo。
 *         价格从数据库权威获取，前端传入的 unitPrice 被忽略。
 *
 * REFUND: body = { saleType:'REFUND', originalSaleRecordId, refundQty, refundReason, remark? }
 *         退款针对单条 SaleRecord 行，逻辑不变。
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

  if (saleType === 'SALE') return handleSale(ctx, body)
  if (saleType === 'REFUND') return handleRefund(ctx, body)

  return NextResponse.json(
    { error: 'VALIDATION_ERROR', message: 'saleType must be SALE or REFUND' },
    { status: 400 },
  )
}

// ─── SALE ─────────────────────────────────────────────────────────────────────

type CartItem = { barcode: string; quantity: number }

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
    select: { code: true },
  })
  if (!store) {
    return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 400 })
  }

  // 批量获取商品（价格以数据库为权威）
  const barcodes = [...new Set(items.map((i) => i.barcode))]
  const products = await prisma.product.findMany({
    where: { tenantId: ctx.tenantId, barcode: { in: barcodes }, status: 'ACTIVE' },
  })
  const productMap = new Map(products.map((p) => [p.barcode, p]))

  for (const it of items) {
    if (!productMap.has(it.barcode)) {
      return NextResponse.json(
        { error: 'PRODUCT_NOT_FOUND', barcode: it.barcode },
        { status: 404 },
      )
    }
  }

  // KHQR 配置前置检查（事务外快速失败，避免创建半成品记录）
  let khqrConfig: KhqrProviderConfig & { id: string } | null = null
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

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 生成第一条记录号，同时用作整单的 orderNo
      const orderNo = await generateRecordNo(tx, 'S', ctx.tenantId, ctx.storeId, store.code)

      let totalAmount = 0
      let firstCreatedAt: Date | null = null
      let isFirst = true

      for (const it of items) {
        const product = productMap.get(it.barcode)!
        const qty = Number(it.quantity)
        const lineAmount = product.sellPrice.mul(qty)
        totalAmount += lineAmount.toNumber()

        // 第一件商品复用 orderNo 作为 recordNo；后续各自生成新 recordNo
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
            status: 'COMPLETED',
            productId: product.id,
            barcode: product.barcode,
            productNameSnapshot: product.name,
            specSnapshot: product.spec ?? null,
            unitPrice: product.sellPrice,
            quantity: qty,
            lineAmount,
          },
        })

        if (!firstCreatedAt) firstCreatedAt = record.createdAt

        await tx.operationLog.create({
          data: {
            tenantId: ctx.tenantId,
            storeId: ctx.storeId,
            userId: ctx.userId,
            actionType: 'CREATE_SALE',
            targetType: 'SaleRecord',
            targetId: record.id,
            status: 'SUCCESS',
            message: `Sale line created: ${recordNo} (order ${orderNo})`,
            saleRecordId: record.id,
          },
        })
      }

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
        createdAt: firstCreatedAt!.toISOString(),
        paymentMethod,
        paymentIntentId: pi.id,
        khqrPayload,
      }
    })

    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    console.error('[POST /api/sales SALE]', err)
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}

// ─── KHQR config lookup ───────────────────────────────────────────────────────

/**
 * 按优先级查找门店的 KHQR 支付配置：
 *  1. 当前 storeId 的专属启用配置
 *  2. 租户级默认配置（storeId = null, isDefault = true）
 *  3. 两者都没有 → 返回 null（调用方应拒绝 KHQR 并提示）
 */
async function findKhqrConfig(tenantId: string, storeId: string) {
  const storeConfig = await prisma.merchantPaymentConfig.findFirst({
    where: { tenantId, storeId, khqrEnabled: true, isActive: true },
  })
  if (storeConfig) return storeConfig

  return prisma.merchantPaymentConfig.findFirst({
    where: { tenantId, storeId: null, khqrEnabled: true, isActive: true, isDefault: true },
  })
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

  const refundedSoFar = original.refundChildren.reduce(
    (sum, r) => sum + Math.abs(r.quantity.toNumber()),
    0,
  )
  const availableQty = original.quantity.toNumber() - refundedSoFar

  if (rQty > availableQty) {
    return NextResponse.json(
      { error: 'REFUND_QTY_EXCEEDED', availableQty },
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

  const lineAmount = -(original.unitPrice.toNumber() * rQty)
  const remarkValue =
    typeof remark === 'string' && remark.trim() !== '' ? remark.trim() : null

  try {
    const record = await prisma.$transaction(async (tx) => {
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
          quantity: -rQty,
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
