/**
 * POST /api/cashier/sales
 *
 * Public endpoint — no Telegram session required.
 * Identifies the store by storeCode, uses the store OWNER as operatorUserId,
 * and records remark = '电脑收银台' on every sale line.
 *
 * Body: { storeCode, items: [{barcode, quantity}], paymentMethod: 'CASH'|'KHQR' }
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateRecordNo } from '@/lib/record-no'
import { generateKhqrPayload } from '@/lib/khqr'
import { findKhqrConfig, type MerchantKhqrConfig } from '@/lib/merchant-config'

type CartItem = { barcode: string; quantity: number; sugar?: string }

function sugarZh(sugar: string): string {
  if (sugar === 'no_sugar') return '无糖'
  if (sugar === '25')       return '微糖 25%'
  if (sugar === '50')       return '半糖 50%'
  if (sugar === '75')       return '少糖 75%'
  if (sugar === '100')      return '正常糖 100%'
  return sugar
}

export async function POST(req: NextRequest) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })
  }

  const { storeCode, items, paymentMethod = 'CASH' } = body as {
    storeCode?: string
    items?: CartItem[]
    paymentMethod?: string
  }

  if (!storeCode?.trim()) {
    return NextResponse.json({ error: 'MISSING_STORE_CODE' }, { status: 400 })
  }
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

  // Resolve store
  const store = await prisma.store.findUnique({
    where: { code: storeCode.trim() },
    select: { id: true, code: true, tenantId: true, status: true },
  })
  if (!store || store.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })
  }

  // Use store OWNER as operatorUserId
  const ownerRole = await prisma.userStoreRole.findFirst({
    where: { storeId: store.id, role: 'OWNER', status: 'ACTIVE' },
    select: { userId: true },
  })
  if (!ownerRole) {
    return NextResponse.json({ error: 'STORE_NO_OWNER' }, { status: 500 })
  }

  // Validate products
  const barcodes = [...new Set(items.map((i) => i.barcode))]
  const products = await prisma.product.findMany({
    where: { tenantId: store.tenantId, barcode: { in: barcodes }, status: 'ACTIVE' },
  })
  const productMap = new Map(products.map((p) => [p.barcode, p]))
  for (const it of items) {
    if (!productMap.has(it.barcode)) {
      return NextResponse.json({ error: 'PRODUCT_NOT_FOUND', barcode: it.barcode }, { status: 404 })
    }
  }

  // KHQR config pre-check
  let khqrConfig: MerchantKhqrConfig | null = null
  if (paymentMethod === 'KHQR') {
    const cfg = await findKhqrConfig(store.tenantId, store.id)
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
      const orderNo = await generateRecordNo(tx, 'S', store.tenantId, store.id, store.code)
      let totalAmount = 0
      let firstCreatedAt: Date | null = null
      let isFirst = true

      for (const it of items) {
        const product = productMap.get(it.barcode)!
        const qty = Number(it.quantity)
        const lineAmount = product.sellPrice.mul(qty)
        totalAmount += lineAmount.toNumber()

        const recordNo = isFirst
          ? orderNo
          : await generateRecordNo(tx, 'S', store.tenantId, store.id, store.code)
        isFirst = false

        const sugarLabel = it.sugar ? sugarZh(it.sugar) : null
        const specSnapshot = [product.spec ?? null, sugarLabel].filter(Boolean).join(' / ') || null

        const record = await tx.saleRecord.create({
          data: {
            tenantId: store.tenantId,
            storeId: store.id,
            operatorUserId: ownerRole.userId,
            recordNo,
            orderNo,
            saleType: 'SALE',
            status: 'COMPLETED',
            productId: product.id,
            barcode: product.barcode,
            productNameSnapshot: product.name,
            specSnapshot,
            unitPrice: product.sellPrice,
            quantity: qty,
            lineAmount,
            remark: '电脑收银台',
          },
        })
        if (!firstCreatedAt) firstCreatedAt = record.createdAt
      }

      const khqrPayload = paymentMethod === 'KHQR' && khqrConfig
        ? generateKhqrPayload({ amount: totalAmount, orderNo, config: khqrConfig })
        : null

      const pi = await tx.paymentIntent.create({
        data: {
          tenantId: store.tenantId,
          storeId: store.id,
          operatorUserId: ownerRole.userId,
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
      }
    })

    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    console.error('[POST /api/cashier/sales]', err)
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
