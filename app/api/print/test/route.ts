/**
 * POST /api/print/test — 测试打印（OWNER + 高级版商户）
 * 不写真实订单，仅打印一张测试小票。
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { isPrinterConfigured, isPrintingTier, printReceipt, logPrintAttempt } from '@/lib/cloudPrinter'

export async function POST(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const tenant = await prisma.tenant.findUnique({
    where: { id: ctx.tenantId },
    select: { tier: true, name: true },
  })
  if (!isPrintingTier(tenant?.tier)) {
    return NextResponse.json(
      { error: 'TIER_REQUIRED', message: '自动打印为高级版功能；当前商户版本未启用' },
      { status: 403 },
    )
  }
  if (!isPrinterConfigured()) {
    return NextResponse.json({ error: 'PRINTER_NOT_CONFIGURED' }, { status: 500 })
  }

  const store = await prisma.store.findFirst({
    where: { id: ctx.storeId, tenantId: ctx.tenantId },
    select: { id: true, name: true },
  })
  const storeName = store?.name ?? tenant?.name ?? '店小二'
  const fakeOrderNo = `TEST-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now().toString().slice(-4)}`

  const result = await printReceipt({
    storeName,
    orderNo: fakeOrderNo,
    items: [
      { name: '测试商品 A', spec: '500ml', quantity: 1, price: 3.5, lineAmount: 3.5 },
      { name: '测试商品 B', spec: null, quantity: 2, price: 5,   lineAmount: 10  },
    ],
    totalAmount: 13.5,
    remark: '这是一张测试小票，请勿出餐',
  })

  await logPrintAttempt({
    tenantId: ctx.tenantId,
    storeId: store?.id ?? null,
    orderNo: fakeOrderNo,
    status: result.ok ? 'ok' : 'failed',
    error: result.ok ? undefined : (result.error ?? 'unknown'),
    reason: 'test',
  })

  // 不论成败都透传完整 result（含 parsedDiag / rawBody / request），便于前端 dashboard 展示诊断
  return NextResponse.json(
    { ...result, orderNo: fakeOrderNo },
    { status: result.ok ? 200 : 502 },
  )
}
