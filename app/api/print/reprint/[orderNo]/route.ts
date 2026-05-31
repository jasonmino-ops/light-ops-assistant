/**
 * POST /api/print/reprint/[orderNo] — 重打指定订单（OWNER + 高级版商户）
 * 仅支持 CustomerOrder（顾客 H5 下单）；SaleRecord（线下销售）暂不支持。
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import {
  isPrinterConfigured,
  isPrintingTier,
  printReceipt,
  logPrintAttempt,
  type ReceiptItem,
} from '@/lib/cloudPrinter'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderNo: string }> },
) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const tenant = await prisma.tenant.findUnique({
    where: { id: ctx.tenantId },
    select: { tier: true },
  })
  if (!isPrintingTier(tenant?.tier)) {
    return NextResponse.json({ error: 'TIER_REQUIRED', message: '需要高级版' }, { status: 403 })
  }
  if (!isPrinterConfigured()) {
    return NextResponse.json({ error: 'PRINTER_NOT_CONFIGURED' }, { status: 500 })
  }

  const { orderNo } = await params
  const order = await prisma.customerOrder.findUnique({
    where: { orderNo },
    select: {
      id: true, orderNo: true, tenantId: true, storeId: true,
      itemsJson: true, totalAmount: true, remark: true, tableNo: true,
    },
  })
  if (!order || order.tenantId !== ctx.tenantId) {
    return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 })
  }
  const store = await prisma.store.findUnique({
    where: { id: order.storeId },
    select: { name: true },
  })

  // 解析 itemsJson → ReceiptItem[]
  let items: ReceiptItem[] = []
  try {
    const raw = JSON.parse(order.itemsJson) as Array<{
      name?: string; spec?: string | null; quantity?: number; price?: number; lineAmount?: number; sugar?: string | null
    }>
    items = raw.map((it) => ({
      name:       it.name       ?? '商品',
      spec:       it.spec       ?? null,
      quantity:   typeof it.quantity   === 'number' ? it.quantity   : 1,
      price:      typeof it.price      === 'number' ? it.price      : 0,
      lineAmount: typeof it.lineAmount === 'number' ? it.lineAmount : 0,
      sugar:      it.sugar      ?? null,
    }))
  } catch {
    return NextResponse.json({ error: 'ITEMS_PARSE_ERROR' }, { status: 500 })
  }

  const result = await printReceipt({
    storeName:   store?.name ?? '店小二',
    orderNo:     order.orderNo,
    tableNo:     order.tableNo,
    items,
    totalAmount: order.totalAmount.toNumber(),
    remark:      order.remark,
  })

  await logPrintAttempt({
    tenantId: ctx.tenantId,
    storeId:  order.storeId,
    orderNo:  order.orderNo,
    status:   result.ok ? 'ok' : 'failed',
    error:    result.ok ? undefined : (result.error ?? 'unknown'),
    reason:   'reprint',
  })

  return NextResponse.json(
    { ...result, orderNo: order.orderNo },
    { status: result.ok ? 200 : 502 },
  )
}
