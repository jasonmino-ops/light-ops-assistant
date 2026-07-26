/**
 * GET /api/cashier/sale-records/[id]/tickets?storeCode=xxx
 *
 * Returns printable ticket data only after the order payment is PAID. Kitchen
 * lines are selected exclusively from the immutable sale-line snapshot; this
 * prevents later product configuration edits from changing a completed order.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authorizeDesktopPosRequest, unauthorizedPosResponse } from '@/lib/desktop-pos-auth'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const storeCode = req.nextUrl.searchParams.get('storeCode')?.trim()
  if (!storeCode) return NextResponse.json({ error: 'MISSING_STORE_CODE' }, { status: 400 })

  const store = await prisma.store.findUnique({
    where: { code: storeCode },
    select: {
      id: true,
      code: true,
      tenantId: true,
      status: true,
      name: true,
      currencyCode: true,
      businessType: true,
      kitchenTicketEnabled: true,
    },
  })
  if (!store || store.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })
  }
  const posAuth = await authorizeDesktopPosRequest(req, {
    tenantId: store.tenantId,
    storeId: store.id,
    storeCode: store.code,
  }, { allowStoreCodeFallback: true })
  if (!posAuth) return unauthorizedPosResponse()

  const anchor = await prisma.saleRecord.findFirst({
    where: { id, tenantId: store.tenantId, storeId: store.id, saleType: 'SALE' },
    select: { id: true, orderNo: true, recordNo: true },
  })
  if (!anchor) return NextResponse.json({ error: 'SALE_RECORD_NOT_FOUND' }, { status: 404 })

  const orderNo = anchor.orderNo ?? anchor.recordNo
  const paymentIntent = await prisma.paymentIntent.findUnique({
    where: { orderNo },
    select: { status: true },
  })
  if (!paymentIntent || paymentIntent.status !== 'PAID') {
    return NextResponse.json({ error: 'PAYMENT_NOT_CONFIRMED' }, { status: 409 })
  }

  const lines = await prisma.saleRecord.findMany({
    where: {
      tenantId: store.tenantId,
      storeId: store.id,
      orderNo,
      saleType: 'SALE',
      status: 'COMPLETED',
    },
    orderBy: { createdAt: 'asc' },
  })
  if (lines.length === 0) return NextResponse.json({ error: 'SALE_RECORD_NOT_FOUND' }, { status: 404 })

  const first = lines[0]
  const kitchenItems = store.businessType === 'FOOD' && store.kitchenTicketEnabled
    ? lines
        .filter((line) => line.printToKitchenSnapshot)
        .map((line) => ({
          name: line.productNameSnapshot,
          spec: line.specSnapshot,
          quantity: line.quantity.toNumber(),
        }))
    : []

  return NextResponse.json({
    kitchenTicket: kitchenItems.length > 0
      ? {
          storeName: store.name,
          orderNo,
          createdAt: first.createdAt.toISOString(),
          items: kitchenItems,
        }
      : null,
    source: {
      saleRecordId: anchor.id,
      orderNo,
      kitchenEnabled: store.businessType === 'FOOD' && store.kitchenTicketEnabled,
      kitchenLineCount: kitchenItems.length,
    },
  })
}
