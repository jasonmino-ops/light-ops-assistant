/**
 * POST /api/cashier/sales
 *
 * Desktop/browser POS sale endpoint. Every online checkout must send one
 * stable Idempotency-Key. A retry replays the first committed sale result;
 * it never re-runs SaleRecord or PaymentIntent creation.
 */
import { createHash, randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateRecordNo } from '@/lib/record-no'
import { generateKhqrPayload } from '@/lib/khqr'
import { findKhqrConfig, type MerchantKhqrConfig } from '@/lib/merchant-config'
import { authorizeTransaction, transactionActorAuditData, transactionAuthorizationErrorResponse } from '@/lib/transaction-authorization'
import { isKhqrSupportedCurrency } from '@/lib/currency'
import {
  requiresCashierManualPaymentConfirmation,
  resolveCashierPaymentIntentStatus,
} from '@/lib/cashier-payment-confirmation'

const CASHIER_SALE_OPERATION = 'CASHIER_SALE_CREATE'
const CASHIER_SALE_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000

type CartItem = { barcode: string; quantity: number; sugar?: string }
type CashierSaleResult = {
  orderNo: string
  totalAmount: number
  itemCount: number
  createdAt: string
  paymentMethod: 'CASH' | 'KHQR'
  paymentIntentId: string
  khqrFallback: boolean
}
type IdempotencyResolution =
  | { kind: 'REPLAY'; result: CashierSaleResult }
  | { kind: 'CONFLICT'; error: 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH' | 'IDEMPOTENCY_KEY_EXPIRED' | 'IDEMPOTENCY_IN_PROGRESS' }
  | null
type IdempotencyConflictError = Extract<IdempotencyResolution, { kind: 'CONFLICT' }>['error']

function sugarZh(sugar: string) {
  if (sugar === 'no_sugar') return '无糖'
  if (sugar === '25') return '微糖 25%'
  if (sugar === '50') return '半糖 50%'
  if (sugar === '75') return '少糖 75%'
  if (sugar === '100') return '正常糖 100%'
  return sugar
}

function readIdempotencyKey(req: NextRequest) {
  const key = req.headers.get('idempotency-key')?.trim() ?? ''
  return /^[A-Za-z0-9._:-]{16,200}$/.test(key) ? key : null
}

function readCartItems(value: unknown): CartItem[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const items: CartItem[] = []
  for (const input of value) {
    if (!input || typeof input !== 'object') return null
    const item = input as { barcode?: unknown; quantity?: unknown; sugar?: unknown }
    if (typeof item.barcode !== 'string' || !item.barcode) return null
    const quantity = Number(item.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) return null
    items.push({
      barcode: item.barcode,
      quantity,
      ...(typeof item.sugar === 'string' && item.sugar ? { sugar: item.sugar } : {}),
    })
  }
  return items
}

function payloadFingerprint(input: {
  paymentMethod: 'CASH' | 'KHQR'
  manualPaymentConfirmed: boolean
  items: CartItem[]
}) {
  // The fingerprint intentionally contains only immutable business input, not
  // credentials, device tokens, or other request metadata.
  return createHash('sha256').update(JSON.stringify({
    paymentMethod: input.paymentMethod,
    manualPaymentConfirmed: input.paymentMethod === 'KHQR' && input.manualPaymentConfirmed,
    items: input.items.map((item) => ({
      barcode: item.barcode,
      quantity: item.quantity,
      sugar: item.sugar ?? null,
    })),
  })).digest('hex')
}

function readResultSnapshot(value: unknown): CashierSaleResult | null {
  if (!value || typeof value !== 'object') return null
  const result = value as Record<string, unknown>
  if (
    typeof result.orderNo !== 'string' ||
    typeof result.totalAmount !== 'number' ||
    typeof result.itemCount !== 'number' ||
    typeof result.createdAt !== 'string' ||
    (result.paymentMethod !== 'CASH' && result.paymentMethod !== 'KHQR') ||
    typeof result.paymentIntentId !== 'string' ||
    typeof result.khqrFallback !== 'boolean'
  ) return null
  return result as CashierSaleResult
}

function idempotencyConflictResponse(error: IdempotencyConflictError) {
  const message = error === 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH'
    ? '同一结算请求不能提交不同内容。'
    : error === 'IDEMPOTENCY_KEY_EXPIRED'
      ? '该结算请求已过期，请人工核对后重新发起。'
      : '同一结算正在处理，请安全重试。'
  return NextResponse.json({ error, message }, { status: 409 })
}

function saleResponse(result: CashierSaleResult, replayed: boolean) {
  return NextResponse.json(result, {
    status: 201,
    headers: replayed ? { 'Idempotency-Replayed': 'true' } : { 'Idempotency-Replayed': 'false' },
  })
}

function idempotencyWhere(input: {
  tenantId: string
  storeId: string
  actorType: string
  actorId: string
  idempotencyKey: string
}) {
  return {
    tenantId: input.tenantId,
    storeId: input.storeId,
    actorType: input.actorType,
    actorId: input.actorId,
    operation: CASHIER_SALE_OPERATION,
    idempotencyKey: input.idempotencyKey,
  }
}

function resolveExistingIdempotency(
  row: { payloadFingerprint: string; status: string; resultSnapshot: unknown; expiresAt: Date } | null,
  fingerprint: string,
  now: Date,
): IdempotencyResolution {
  if (!row) return null
  if (row.payloadFingerprint !== fingerprint) return { kind: 'CONFLICT', error: 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH' }
  if (row.expiresAt <= now) return { kind: 'CONFLICT', error: 'IDEMPOTENCY_KEY_EXPIRED' }
  if (row.status !== 'COMPLETED') return { kind: 'CONFLICT', error: 'IDEMPOTENCY_IN_PROGRESS' }
  const result = readResultSnapshot(row.resultSnapshot)
  return result ? { kind: 'REPLAY', result } : { kind: 'CONFLICT', error: 'IDEMPOTENCY_IN_PROGRESS' }
}

export async function POST(req: NextRequest) {
  let body: {
    storeCode?: unknown
    items?: unknown
    paymentMethod?: unknown
    manualPaymentConfirmed?: unknown
  }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })
  }

  const storeCode = typeof body.storeCode === 'string' ? body.storeCode.trim() : ''
  const paymentMethod = body.paymentMethod === undefined ? 'CASH' : body.paymentMethod
  const manualPaymentConfirmed = body.manualPaymentConfirmed === true
  if (!storeCode) return NextResponse.json({ error: 'MISSING_STORE_CODE' }, { status: 400 })
  if (paymentMethod !== 'CASH' && paymentMethod !== 'KHQR') {
    return NextResponse.json({ error: 'VALIDATION_ERROR', message: 'paymentMethod must be CASH or KHQR' }, { status: 400 })
  }
  if (requiresCashierManualPaymentConfirmation(paymentMethod, manualPaymentConfirmed)) {
    // Deliberately reject before reading or reserving an idempotency key. An
    // unconfirmed KHQR attempt must never block the later manual confirmation.
    return NextResponse.json({ error: 'MANUAL_PAYMENT_CONFIRMATION_REQUIRED' }, { status: 409 })
  }
  const idempotencyKey = readIdempotencyKey(req)
  if (!idempotencyKey) {
    return NextResponse.json({ error: 'IDEMPOTENCY_KEY_REQUIRED', message: '缺少有效的结算幂等键。' }, { status: 400 })
  }
  const items = readCartItems(body.items)
  if (!items) {
    return NextResponse.json({ error: 'VALIDATION_ERROR', message: 'items must be a non-empty array with positive quantities' }, { status: 400 })
  }

  const store = await prisma.store.findUnique({
    where: { code: storeCode },
    select: { id: true, code: true, tenantId: true, status: true, currencyCode: true },
  })
  if (!store || store.status !== 'ACTIVE') return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })

  // Authorization always runs before idempotency replay. A revoked device may
  // not use a historical key to read an earlier sale result.
  const authorization = await authorizeTransaction(req, {
    operation: 'POS_SALE_CREATE',
    store: { tenantId: store.tenantId, storeId: store.id, storeCode: store.code },
  })
  if (!authorization.ok) return transactionAuthorizationErrorResponse(authorization)
  const posAuth = authorization.authorization
  if (paymentMethod === 'KHQR' && !isKhqrSupportedCurrency(store.currencyCode)) {
    return NextResponse.json({ error: 'KHQR_UNSUPPORTED_CURRENCY', message: '当前门店货币不支持 KHQR，请使用现金收款' }, { status: 422 })
  }

  const fingerprint = payloadFingerprint({ paymentMethod, manualPaymentConfirmed, items })
  const scope = idempotencyWhere({
    tenantId: store.tenantId,
    storeId: store.id,
    actorType: posAuth.actorType,
    actorId: posAuth.actorId,
    idempotencyKey,
  })
  const now = new Date()
  const prior = resolveExistingIdempotency(
    await prisma.cashierSaleIdempotency.findFirst({ where: scope }),
    fingerprint,
    now,
  )
  if (prior?.kind === 'REPLAY') return saleResponse(prior.result, true)
  if (prior?.kind === 'CONFLICT') return idempotencyConflictResponse(prior.error)

  const barcodes = [...new Set(items.map((item) => item.barcode))]
  const products = await prisma.product.findMany({
    where: { tenantId: store.tenantId, barcode: { in: barcodes }, status: 'ACTIVE' },
  })
  const productMap = new Map(products.map((product) => [product.barcode, product]))
  for (const item of items) {
    if (!productMap.has(item.barcode)) return NextResponse.json({ error: 'PRODUCT_NOT_FOUND', barcode: item.barcode }, { status: 404 })
  }

  let khqrConfig: MerchantKhqrConfig | null = null
  let khqrFallback = false
  if (paymentMethod === 'KHQR') {
    const config = await findKhqrConfig(store.tenantId, store.id)
    if (config) khqrConfig = config
    else khqrFallback = true
  }

  try {
    const completed = await prisma.$transaction(async (tx): Promise<IdempotencyResolution | { kind: 'CREATED'; result: CashierSaleResult }> => {
      // PostgreSQL waits for an in-flight conflicting insert. Once that first
      // transaction commits, this transaction reads and replays its result.
      const inserted = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        INSERT INTO "CashierSaleIdempotency" (
          "id", "tenantId", "storeId", "actorType", "actorId", "operation",
          "idempotencyKey", "payloadFingerprint", "status", "expiresAt", "createdAt", "updatedAt"
        ) VALUES (
          ${randomUUID()}, ${store.tenantId}, ${store.id}, ${posAuth.actorType}, ${posAuth.actorId}, ${CASHIER_SALE_OPERATION},
          ${idempotencyKey}, ${fingerprint}, 'PROCESSING', ${new Date(now.getTime() + CASHIER_SALE_IDEMPOTENCY_TTL_MS)}, ${now}, ${now}
        )
        ON CONFLICT ("tenantId", "storeId", "actorType", "actorId", "operation", "idempotencyKey")
        DO NOTHING
        RETURNING "id"
      `)

      if (inserted.length === 0) {
        const existing = await tx.cashierSaleIdempotency.findFirst({ where: scope })
        return resolveExistingIdempotency(existing, fingerprint, new Date())
      }

      const orderNo = await generateRecordNo(tx, 'S', store.tenantId, store.id, store.code)
      let totalAmount = 0
      let firstCreatedAt: Date | null = null
      let isFirst = true
      const displayItems: Array<{
        productId: string
        name: string
        spec: string | null
        imageUrl: string | null
        price: number
        qty: number
        lineAmount: number
      }> = []

      for (const item of items) {
        const product = productMap.get(item.barcode)!
        const lineAmount = product.sellPrice.mul(item.quantity)
        totalAmount += lineAmount.toNumber()
        const recordNo = isFirst
          ? orderNo
          : await generateRecordNo(tx, 'S', store.tenantId, store.id, store.code)
        isFirst = false
        const specSnapshot = [product.spec ?? null, item.sugar ? sugarZh(item.sugar) : null].filter(Boolean).join(' / ') || null
        const record = await tx.saleRecord.create({
          data: {
            tenantId: store.tenantId,
            storeId: store.id,
            operatorUserId: posAuth.legacyOperatorUserId,
            ...transactionActorAuditData(posAuth),
            recordNo,
            orderNo,
            saleType: 'SALE',
            status: 'COMPLETED',
            productId: product.id,
            barcode: product.barcode,
            productNameSnapshot: product.name,
            specSnapshot,
            unitPrice: product.sellPrice,
            quantity: item.quantity,
            lineAmount,
            remark: khqrFallback ? '电脑收银台-KHQR兜底' : '电脑收银台',
          },
        })
        if (!firstCreatedAt) firstCreatedAt = record.createdAt
        displayItems.push({
          productId: product.id,
          name: product.name,
          spec: specSnapshot,
          imageUrl: product.imageUrl,
          price: product.sellPrice.toNumber(),
          qty: item.quantity,
          lineAmount: lineAmount.toNumber(),
        })
      }

      const khqrPayload = paymentMethod === 'KHQR' && khqrConfig
        ? generateKhqrPayload({ amount: totalAmount, orderNo, config: khqrConfig })
        : null
      const paymentIntentStatus = resolveCashierPaymentIntentStatus(paymentMethod, manualPaymentConfirmed)
      const paymentIntent = await tx.paymentIntent.create({
        data: {
          tenantId: store.tenantId,
          storeId: store.id,
          operatorUserId: posAuth.legacyOperatorUserId,
          ...transactionActorAuditData(posAuth),
          orderNo,
          paymentMethod,
          status: paymentIntentStatus,
          amount: totalAmount,
          khqrPayload,
          provider: khqrConfig?.provider ?? null,
          merchantConfigId: khqrConfig?.id ?? null,
          paidAt: paymentIntentStatus === 'PAID' ? new Date() : null,
        },
      })
      // The customer display is a UI mirror, not a payment authority. Keeping
      // its completion state in this same transaction prevents a replay from
      // producing a second terminal display transition for the sale.
      await tx.posSession.upsert({
        where: { tenantId_storeId: { tenantId: store.tenantId, storeId: store.id } },
        create: {
          tenantId: store.tenantId,
          storeId: store.id,
          storeCode: store.code,
          operatorUserId: posAuth.legacyOperatorUserId,
          status: 'COMPLETED',
          paymentMethod,
          paymentStatus: paymentIntentStatus,
          itemsJson: JSON.stringify(displayItems),
          totalAmount,
          itemCount: Math.round(displayItems.reduce((sum, item) => sum + item.qty, 0)),
          khqrPayload: null,
          khqrImageUrl: null,
          orderNo,
          message: null,
          completedAt: new Date(),
        },
        update: {
          operatorUserId: posAuth.legacyOperatorUserId,
          status: 'COMPLETED',
          paymentMethod,
          paymentStatus: paymentIntentStatus,
          itemsJson: JSON.stringify(displayItems),
          totalAmount,
          itemCount: Math.round(displayItems.reduce((sum, item) => sum + item.qty, 0)),
          khqrPayload: null,
          khqrImageUrl: null,
          orderNo,
          message: null,
          completedAt: new Date(),
        },
      })
      const result: CashierSaleResult = {
        orderNo,
        totalAmount,
        itemCount: items.length,
        createdAt: firstCreatedAt!.toISOString(),
        paymentMethod,
        paymentIntentId: paymentIntent.id,
        khqrFallback,
      }
      await tx.cashierSaleIdempotency.update({
        where: { id: inserted[0].id },
        data: {
          status: 'COMPLETED',
          resultSnapshot: result as Prisma.InputJsonValue,
          orderNo,
          paymentIntentId: paymentIntent.id,
        },
      })
      return { kind: 'CREATED', result }
    })

    if (completed?.kind === 'REPLAY') return saleResponse(completed.result, true)
    if (completed?.kind === 'CONFLICT') return idempotencyConflictResponse(completed.error)
    if (completed?.kind === 'CREATED') return saleResponse(completed.result, false)
    return idempotencyConflictResponse('IDEMPOTENCY_IN_PROGRESS')
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return idempotencyConflictResponse('IDEMPOTENCY_IN_PROGRESS')
    }
    console.error('[POST /api/cashier/sales]', error)
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
