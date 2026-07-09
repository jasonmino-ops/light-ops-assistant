/**
 * POST /api/cashier/member-balance-pay
 *
 * Desktop POS endpoint. Requires logged-in store OWNER/STAFF or signed POS device token, then creates
 * the same SaleRecord/PaymentIntent shape as /api/cashier/sales, but pays by
 * Member.balance in one transaction with a CONSUME ledger.
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { generateRecordNo } from '@/lib/record-no'
import { authorizeDesktopPosRequest, unauthorizedPosResponse } from '@/lib/desktop-pos-auth'

type CartItem = { barcode: string; quantity: number; sugar?: string }

function sugarZh(sugar: string): string {
  if (sugar === 'no_sugar') return '无糖'
  if (sugar === '25') return '微糖 25%'
  if (sugar === '50') return '半糖 50%'
  if (sugar === '75') return '少糖 75%'
  if (sugar === '100') return '正常糖 100%'
  return sugar
}

export async function POST(req: NextRequest) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })
  }

  const { storeCode, items, memberId } = body as {
    storeCode?: string
    items?: CartItem[]
    memberId?: string
  }

  if (!storeCode?.trim()) return NextResponse.json({ error: 'MISSING_STORE_CODE' }, { status: 400 })
  if (!memberId?.trim()) return NextResponse.json({ error: 'MISSING_MEMBER_ID' }, { status: 400 })
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'VALIDATION_ERROR', message: 'items must be a non-empty array' }, { status: 400 })
  }
  for (const it of items) {
    if (!it.barcode || typeof it.barcode !== 'string') {
      return NextResponse.json({ error: 'VALIDATION_ERROR', message: 'each item must have a barcode string' }, { status: 400 })
    }
    const qty = Number(it.quantity)
    if (!Number.isFinite(qty) || qty <= 0) {
      return NextResponse.json({ error: 'VALIDATION_ERROR', message: `quantity for barcode ${it.barcode} must be positive` }, { status: 400 })
    }
  }

  const store = await prisma.store.findUnique({
    where: { code: storeCode.trim() },
    select: { id: true, code: true, tenantId: true, status: true },
  })
  if (!store || store.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })
  }
  const posAuth = await authorizeDesktopPosRequest(req, {
    tenantId: store.tenantId,
    storeId: store.id,
    storeCode: store.code,
  }, { allowStoreCodeFallback: true })
  if (!posAuth) {
    return unauthorizedPosResponse()
  }

  const member = await prisma.member.findFirst({
    where: {
      id: memberId,
      tenantId: store.tenantId,
      storeId: store.id,
      status: 'ACTIVE',
    },
    select: { id: true, name: true, memberCode: true, balance: true },
  })
  if (!member) return NextResponse.json({ error: 'MEMBER_NOT_FOUND' }, { status: 404 })

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

  const totalAmount = items.reduce((sum, it) => {
    const product = productMap.get(it.barcode)!
    const qty = new Prisma.Decimal(String(Number(it.quantity)))
    return sum.plus(product.sellPrice.mul(qty))
  }, new Prisma.Decimal(0))

  if (totalAmount.lte(0)) {
    return NextResponse.json({ error: 'INVALID_AMOUNT' }, { status: 400 })
  }
  if (member.balance.lt(totalAmount)) {
    return NextResponse.json({
      error: 'INSUFFICIENT_BALANCE',
      balance: member.balance.toString(),
      required: totalAmount.toString(),
    }, { status: 400 })
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const debitResult = await tx.member.updateMany({
        where: {
          id: member.id,
          tenantId: store.tenantId,
          storeId: store.id,
          status: 'ACTIVE',
          balance: { gte: totalAmount },
        },
        data: { balance: { decrement: totalAmount } },
      })
      if (debitResult.count !== 1) throw new Error('INSUFFICIENT_BALANCE')

      const debitedMember = await tx.member.findFirst({
        where: { id: member.id, tenantId: store.tenantId, storeId: store.id },
        select: { id: true, balance: true },
      })
      if (!debitedMember) throw new Error('MEMBER_NOT_FOUND')

      const balanceAfter = debitedMember.balance
      const balanceBefore = balanceAfter.plus(totalAmount)
      const orderNo = await generateRecordNo(tx, 'S', store.tenantId, store.id, store.code)
      let firstCreatedAt: Date | null = null
      let firstSaleRecordId: string | null = null
      let isFirst = true

      for (const it of items) {
        const product = productMap.get(it.barcode)!
        const qty = new Prisma.Decimal(String(Number(it.quantity)))
        const lineAmount = product.sellPrice.mul(qty)
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
            status: 'COMPLETED',
            productId: product.id,
            barcode: product.barcode,
            productNameSnapshot: product.name,
            specSnapshot,
            unitPrice: product.sellPrice,
            quantity: qty,
            lineAmount,
            remark: '电脑收银台-会员余额',
            memberId: debitedMember.id,
            memberBalanceUsed: lineAmount,
          },
        })
        if (!firstCreatedAt) firstCreatedAt = record.createdAt
        if (!firstSaleRecordId) firstSaleRecordId = record.id
      }

      await tx.memberBalanceLedger.create({
        data: {
          tenantId: store.tenantId,
          storeId: store.id,
          memberId: debitedMember.id,
          type: 'CONSUME',
          sourceType: 'SALE_RECORD',
          sourceId: firstSaleRecordId,
          amount: totalAmount.negated(),
          balanceBefore,
          balanceAfter,
          operatorUserId: posAuth.operatorUserId,
          note: '/cashier 会员余额支付',
        },
      })

      const paymentIntent = await tx.paymentIntent.create({
        data: {
          tenantId: store.tenantId,
          storeId: store.id,
          operatorUserId: posAuth.operatorUserId,
          orderNo,
          paymentMethod: 'MEMBER_BALANCE',
          status: 'PAID',
          amount: totalAmount,
          paidAt: new Date(),
        },
      })

      return {
        orderNo,
        totalAmount: totalAmount.toString(),
        itemCount: items.length,
        createdAt: firstCreatedAt!.toISOString(),
        paymentMethod: 'MEMBER_BALANCE',
        paymentIntentId: paymentIntent.id,
        memberBalanceAfter: balanceAfter.toString(),
      }
    })

    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    if (err instanceof Error && err.message === 'INSUFFICIENT_BALANCE') {
      return NextResponse.json({ error: 'INSUFFICIENT_BALANCE' }, { status: 400 })
    }
    if (err instanceof Error && err.message === 'MEMBER_NOT_FOUND') {
      return NextResponse.json({ error: 'MEMBER_NOT_FOUND' }, { status: 404 })
    }
    console.error('[POST /api/cashier/member-balance-pay]', err)
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
