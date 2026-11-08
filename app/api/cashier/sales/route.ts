/**
 * POST /api/cashier/sales
 *
 * Desktop POS endpoint. Requires logged-in store OWNER/STAFF or signed POS device token.
 * Identifies the store by storeCode, uses the authorized operatorUserId,
 * and records remark = '电脑收银台' on every sale line.
 *
 * Body: { storeCode, items: [{barcode, quantity}], paymentMethod: 'CASH'|'KHQR' }
 */
import { setTimeout as delay } from 'node:timers/promises'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateRecordNo } from '@/lib/record-no'
import { generateKhqrPayload } from '@/lib/khqr'
import { findKhqrConfig, type MerchantKhqrConfig } from '@/lib/merchant-config'
import { authorizeDesktopPosRequest, unauthorizedPosResponse } from '@/lib/desktop-pos-auth'
import { isDesktopPosRequest, resolveDesktopNetworkMode } from '@/lib/desktop-network-print'
import { isKhqrSupportedCurrency } from '@/lib/currency'
import { enqueueCashierNetworkJobs } from '@/lib/es-tray-relay/cashier-network-producer'
import { NETWORK_PROFILE, type NetworkSnapshot } from '@/e-shop-tray/src/networkContract'
import {
  requiresCashierManualPaymentConfirmation,
  resolveCashierPaymentIntentStatus,
} from '@/lib/cashier-payment-confirmation'
import {
  productUnitSnapshot,
  ProductUnitError,
  resolveProductSellingUnit,
} from '@/lib/product-unit'

type CartItem = { barcode: string; quantity: number; sugar?: string }

function sugarZh(sugar: string): string {
  if (sugar === 'no_sugar') return '无糖'
  if (sugar === '25')       return '微糖 25%'
  if (sugar === '50')       return '半糖 50%'
  if (sugar === '75')       return '少糖 75%'
  if (sugar === '100')      return '正常糖 100%'
  return sugar
}

function recordNoAtOffset(firstRecordNo: string, offset: number) {
  if (offset === 0) return firstRecordNo

  const separatorIndex = firstRecordNo.lastIndexOf('-')
  const firstSequence = Number(firstRecordNo.slice(separatorIndex + 1))
  if (separatorIndex < 0 || !Number.isSafeInteger(firstSequence)) {
    throw new Error('INVALID_GENERATED_RECORD_NO')
  }
  return `${firstRecordNo.slice(0, separatorIndex + 1)}${String(firstSequence + offset).padStart(4, '0')}`
}

export async function POST(req: NextRequest) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })
  }

  const { storeCode, items, paymentMethod = 'CASH', manualPaymentConfirmed = false } = body as {
    storeCode?: string
    items?: CartItem[]
    paymentMethod?: string
    manualPaymentConfirmed?: boolean
  }

  // Browser keeps the existing opt-in contract. Desktop requests are
  // revalidated against the current RC10 observation below.
  const desktopRequest = isDesktopPosRequest(req)
  const suppliedPrinting = body.printing !== undefined
  const validPrinting = suppliedPrinting
    && body.printing?.profile === NETWORK_PROFILE
    && Object.keys(body.printing).sort().join(',') === 'lang,mode,profile'
    && ['zh', 'en', 'km'].includes(body.printing.lang)
    && ['FRONT_ONLY', 'SHARED_PRINTER'].includes(body.printing.mode)
  if (suppliedPrinting && !validPrinting && !desktopRequest) {
    return NextResponse.json({ error: 'INVALID_NETWORK_PRINT_PROFILE' }, { status: 400 })
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
  if (requiresCashierManualPaymentConfirmation(paymentMethod, manualPaymentConfirmed === true)) {
    return NextResponse.json(
      { error: 'MANUAL_PAYMENT_CONFIRMATION_REQUIRED' },
      { status: 409 },
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
    select: { id: true, code: true, name: true, tenantId: true, status: true, currencyCode: true, printKitchenTicket: true, businessType: true },
  })
  if (!store || store.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })
  }
  const posAuth = await authorizeDesktopPosRequest(req, {
    tenantId: store.tenantId,
    storeId: store.id,
    storeCode: store.code,
  }, { allowStoreCodeFallback: false })
  if (!posAuth) {
    return unauthorizedPosResponse()
  }
  const desktopNetworkMode = desktopRequest
    ? await resolveDesktopNetworkMode({ tenantId: store.tenantId, storeId: store.id })
    : null
  // Unknown, stale, ambiguous, or disabled observations preserve the
  // successful legacy sale and receipt-preview path.
  const network = desktopRequest
    ? validPrinting && desktopNetworkMode !== null
    : validPrinting
  const effectivePrinting = network
    ? {
        profile: NETWORK_PROFILE,
        mode: desktopRequest ? desktopNetworkMode! : body.printing.mode,
        lang: body.printing.lang,
      }
    : null
  if (paymentMethod === 'KHQR' && !isKhqrSupportedCurrency(store.currencyCode)) {
    return NextResponse.json(
      { error: 'KHQR_UNSUPPORTED_CURRENCY', message: '当前门店货币不支持 KHQR，请使用现金收款' },
      { status: 422 },
    )
  }

  let saleLines
  try {
    saleLines = await Promise.all(items.map((item) => resolveProductSellingUnit(prisma, {
      tenantId: store.tenantId,
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

  // 门店未配置系统内图片时仍可使用柜台实体码，但不改变人工确认语义。
  let khqrConfig: MerchantKhqrConfig | null = null
  let khqrFallback = false
  if (paymentMethod === 'KHQR') {
    const cfg = await findKhqrConfig(store.tenantId, store.id)
    if (cfg) {
      khqrConfig = cfg
    } else {
      khqrFallback = true
    }
  }

  try {
    const writeSale = () => prisma.$transaction(async (tx) => {
      const recordClock = new Date()
      // Preserve receipt order without backdating a line into a prior numbering or reporting day.
      const cambodiaOffsetMs = 7 * 3_600_000
      const utcDayStartMs = new Date(recordClock).setUTCHours(0, 0, 0, 0)
      const reportDayStartMs = new Date(recordClock.getTime() + cambodiaOffsetMs).setUTCHours(0, 0, 0, 0) - cambodiaOffsetMs
      const lineSpanMs = saleLines.length - 1
      const firstLineMs = Math.max(utcDayStartMs, reportDayStartMs, recordClock.getTime() - lineSpanMs)
      const lastLineMs = firstLineMs + lineSpanMs
      // Release the transaction before waiting at a day boundary. No numbers or rows have been written.
      if (lastLineMs > recordClock.getTime()) return { lineTimesReadyAt: lastLineMs } as const

      const orderNo = await generateRecordNo(tx, 'S', store.tenantId, store.id, store.code, recordClock)
      let totalAmount = 0
      const saleRecordData = saleLines.map((line, index) => {
        const product = line.product
        totalAmount += line.lineAmount.toNumber()
        const sugar = items[index].sugar
        const sugarLabel = sugar ? sugarZh(sugar) : null

        return {
          tenantId: store.tenantId,
          storeId: store.id,
          operatorUserId: posAuth.operatorUserId,
          recordNo: recordNoAtOffset(orderNo, index),
          orderNo,
          createdAt: new Date(firstLineMs + index),
          saleType: 'SALE' as const,
          status: 'COMPLETED' as const,
          productId: product.id,
          productNameSnapshot: product.name,
          specSnapshot: [product.spec ?? null, sugarLabel].filter(Boolean).join(' / ') || null,
          ...productUnitSnapshot(line),
          remark: khqrFallback ? '电脑收银台-KHQR兜底' : '电脑收银台',
        }
      })
      const records = await tx.saleRecord.createManyAndReturn({
        data: saleRecordData,
        select: {
          recordNo: true,
          createdAt: true,
          productNameSnapshot: true,
          specSnapshot: true,
          sellingUnitNameSnapshot: true,
          sellingQuantity: true,
          quantity: true,
          unitPrice: true,
          lineAmount: true,
        },
      })
      const recordsByRecordNo = new Map(records.map((record) => [record.recordNo, record]))
      const firstRecord = recordsByRecordNo.get(orderNo)
      if (!firstRecord || recordsByRecordNo.size !== saleRecordData.length) {
        throw new Error('SALE_RECORD_BATCH_RESULT_MISMATCH')
      }
      const createdAt = firstRecord.createdAt.toISOString()
      const snapshotItems: NetworkSnapshot['items'] = []
      const kitchenItems: NetworkSnapshot['items'] = []
      if (network) {
        for (const [index, { recordNo }] of saleRecordData.entries()) {
          const record = recordsByRecordNo.get(recordNo)
          if (!record) throw new Error('SALE_RECORD_BATCH_RESULT_MISMATCH')
          const snapshotItem: NetworkSnapshot['items'][number] = {
            name: record.productNameSnapshot,
            spec: [record.specSnapshot, record.sellingUnitNameSnapshot].filter(Boolean).join(' / ') || null,
            qty: Number(record.sellingQuantity ?? record.quantity),
            price: Number(record.unitPrice), lineAmount: Number(record.lineAmount),
          }
          snapshotItems.push(snapshotItem)
          if (saleLines[index].product.printKitchenTicket) kitchenItems.push(snapshotItem)
        }
      }

      const khqrPayload = paymentMethod === 'KHQR' && khqrConfig
        ? generateKhqrPayload({ amount: totalAmount, orderNo, config: khqrConfig })
        : null

      const paymentIntentStatus = resolveCashierPaymentIntentStatus(
        paymentMethod,
        manualPaymentConfirmed === true,
      )
      const isPaid = paymentIntentStatus === 'PAID'
      const paidAt = isPaid ? new Date() : null
      if (paidAt && paidAt.getTime() < lastLineMs) throw new Error('SALE_RECORD_CLOCK_NOT_READY')
      const pi = await tx.paymentIntent.create({
        data: {
          tenantId: store.tenantId,
          storeId: store.id,
          operatorUserId: posAuth.operatorUserId,
          orderNo,
          paymentMethod: paymentMethod as 'CASH' | 'KHQR',
          status: paymentIntentStatus,
          amount: totalAmount,
          khqrPayload,
          provider: khqrConfig?.provider ?? null,
          merchantConfigId: khqrConfig?.id ?? null,
          paidAt,
        },
      })

      const printing = network ? await enqueueCashierNetworkJobs(tx, {
        tenantId: store.tenantId, storeId: store.id,
      }, {
        storeCode: store.code, storeName: store.name, orderNo,
        createdAt, cashierName: 'Desktop POS',
        paymentMethod: paymentMethod as 'CASH' | 'KHQR', currencyCode: store.currencyCode,
        totalAmount, lang: effectivePrinting!.lang, items: snapshotItems,
      }, effectivePrinting!.mode, store.printKitchenTicket ? kitchenItems : []) : undefined

      return {
        orderNo,
        totalAmount,
        itemCount: items.length,
        createdAt,
        paymentMethod,
        paymentIntentId: pi.id,
        khqrFallback,
        ...(printing ? { printing } : {}),
      }
    })

    let result = await writeSale()
    if (result.lineTimesReadyAt !== undefined) {
      const remainingMs = result.lineTimesReadyAt - Date.now()
      if (remainingMs >= saleLines.length) throw new Error('SALE_RECORD_CLOCK_NOT_READY')
      if (remainingMs >= 0) await delay(remainingMs + 1)
      result = await writeSale()
      if (result.lineTimesReadyAt !== undefined) throw new Error('SALE_RECORD_CLOCK_NOT_READY')
    }
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    console.error('[POST /api/cashier/sales]', err)
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
