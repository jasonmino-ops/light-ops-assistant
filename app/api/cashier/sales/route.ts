/**
 * POST /api/cashier/sales
 *
 * Desktop POS endpoint. Requires logged-in store OWNER/STAFF or signed POS device token.
 * Identifies the store by storeCode, uses the authorized operatorUserId,
 * and records remark = '电脑收银台' on every sale line.
 *
 * Body: { storeCode, items: [{barcode, quantity}], paymentMethod: 'CASH'|'KHQR', clientSubmissionKey }
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateRecordNo } from '@/lib/record-no'
import { generateKhqrPayload } from '@/lib/khqr'
import { findKhqrConfig, type MerchantKhqrConfig } from '@/lib/merchant-config'
import { authorizeDesktopPosRequest, unauthorizedPosResponse } from '@/lib/desktop-pos-auth'
import { isKhqrSupportedCurrency } from '@/lib/currency'

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

  const { storeCode, items, paymentMethod = 'CASH', clientSubmissionKey } = body as {
    storeCode?: string
    items?: CartItem[]
    paymentMethod?: string
    clientSubmissionKey?: string
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
  if (
    typeof clientSubmissionKey !== 'string' ||
    clientSubmissionKey.trim().length < 12 ||
    clientSubmissionKey.trim().length > 160
  ) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', message: 'clientSubmissionKey is required' },
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
    select: {
      id: true,
      code: true,
      tenantId: true,
      status: true,
      currencyCode: true,
      businessType: true,
      kitchenTicketEnabled: true,
    },
  })
  if (!store || store.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })
  }
  const activeStore = store
  const posAuth = await authorizeDesktopPosRequest(req, {
    tenantId: activeStore.tenantId,
    storeId: activeStore.id,
    storeCode: activeStore.code,
  }, { allowStoreCodeFallback: true })
  if (!posAuth) {
    return unauthorizedPosResponse()
  }
  if (paymentMethod === 'KHQR' && !isKhqrSupportedCurrency(activeStore.currencyCode)) {
    return NextResponse.json(
      { error: 'KHQR_UNSUPPORTED_CURRENCY', message: '当前门店货币不支持 KHQR，请使用现金收款' },
      { status: 422 },
    )
  }

  const submissionKey = clientSubmissionKey.trim()
  async function replayExistingSubmission() {
    const existingPayment = await prisma.paymentIntent.findUnique({
      where: {
        tenantId_storeId_clientSubmissionKey: {
          tenantId: activeStore.tenantId,
          storeId: activeStore.id,
          clientSubmissionKey: submissionKey,
        },
      },
      select: {
        id: true,
        orderNo: true,
        amount: true,
        paymentMethod: true,
        status: true,
        khqrPayload: true,
        createdAt: true,
        merchantConfig: { select: { khqrImageUrl: true } },
      },
    })
    if (!existingPayment) return null
    const firstRecord = await prisma.saleRecord.findFirst({
      where: { tenantId: activeStore.tenantId, storeId: activeStore.id, orderNo: existingPayment.orderNo, saleType: 'SALE' },
      select: { id: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })
    const itemCount = await prisma.saleRecord.count({
      where: { tenantId: activeStore.tenantId, storeId: activeStore.id, orderNo: existingPayment.orderNo, saleType: 'SALE' },
    })
    return NextResponse.json({
      orderNo: existingPayment.orderNo,
      totalAmount: existingPayment.amount.toNumber(),
      itemCount,
      createdAt: firstRecord?.createdAt.toISOString() ?? existingPayment.createdAt.toISOString(),
      firstSaleRecordId: firstRecord?.id ?? null,
      paymentMethod: existingPayment.paymentMethod,
      paymentIntentId: existingPayment.id,
      paymentStatus: existingPayment.status,
      khqrPayload: existingPayment.khqrPayload,
      khqrImageUrl: existingPayment.merchantConfig?.khqrImageUrl ?? null,
      replayed: true,
    })
  }
  const existingResponse = await replayExistingSubmission()
  if (existingResponse) return existingResponse

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

  // A KHQR sale must remain PENDING until the existing confirm endpoint succeeds.
  let khqrConfig: MerchantKhqrConfig | null = null
  if (paymentMethod === 'KHQR') {
    const cfg = await findKhqrConfig(store.tenantId, store.id)
    if (cfg) {
      khqrConfig = cfg
    } else {
      return NextResponse.json(
        { error: 'KHQR_NOT_CONFIGURED', message: '当前门店未配置 KHQR 收款码' },
        { status: 422 },
      )
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const orderNo = await generateRecordNo(tx, 'S', store.tenantId, store.id, store.code)
      let totalAmount = 0
      let firstCreatedAt: Date | null = null
      let firstSaleRecordId: string | null = null
      let isFirst = true
      const isPaid = paymentMethod === 'CASH'

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
            operatorUserId: posAuth.operatorUserId,
            recordNo,
            orderNo,
            saleType: 'SALE',
            status: isPaid ? 'COMPLETED' : 'PENDING_PAYMENT',
            productId: product.id,
            barcode: product.barcode,
            productNameSnapshot: product.name,
            specSnapshot,
            unitPrice: product.sellPrice,
            quantity: qty,
            lineAmount,
            remark: '电脑收银台',
            printToKitchenSnapshot: (
              store.businessType === 'FOOD' &&
              store.kitchenTicketEnabled &&
              product.printToKitchen
            ),
          },
        })
        if (!firstCreatedAt) firstCreatedAt = record.createdAt
        if (!firstSaleRecordId) firstSaleRecordId = record.id
      }

      const khqrPayload = paymentMethod === 'KHQR' && khqrConfig
        ? generateKhqrPayload({ amount: totalAmount, orderNo, config: khqrConfig })
        : null

      const pi = await tx.paymentIntent.create({
        data: {
          tenantId: store.tenantId,
          storeId: store.id,
          operatorUserId: posAuth.operatorUserId,
          orderNo,
          paymentMethod: paymentMethod as 'CASH' | 'KHQR',
          status: isPaid ? 'PAID' : 'PENDING',
          clientSubmissionKey: submissionKey,
          amount: totalAmount,
          khqrPayload,
          provider: khqrConfig?.provider ?? null,
          merchantConfigId: khqrConfig?.id ?? null,
          paidAt: isPaid ? new Date() : null,
        },
      })

      return {
        orderNo,
        totalAmount,
        itemCount: items.length,
        createdAt: firstCreatedAt!.toISOString(),
        firstSaleRecordId,
        paymentMethod,
        paymentIntentId: pi.id,
        paymentStatus: pi.status,
        khqrPayload: pi.khqrPayload,
        khqrImageUrl: khqrConfig?.khqrImageUrl ?? null,
        replayed: false,
      }
    })

    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    // A simultaneous retry can race the pre-read. The database key protects the
    // write, and this response reuses the winner instead of reporting a false
    // transaction failure to the POS.
    if ((err as { code?: string }).code === 'P2002') {
      const replay = await replayExistingSubmission()
      if (replay) return replay
    }
    console.error('[POST /api/cashier/sales]', err)
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
