/**
 * GET /api/cashier/orders?storeCode=xxx
 *
 * Public (storeCode-authenticated). Returns PENDING + CONFIRMED customer orders
 * for the desktop cashier panel. Polling endpoint.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const storeCode = req.nextUrl.searchParams.get('storeCode')?.trim()
  if (!storeCode) return NextResponse.json({ error: 'MISSING_STORE_CODE' }, { status: 400 })

  const store = await prisma.store.findUnique({
    where: { code: storeCode },
    select: { id: true, tenantId: true, status: true },
  })
  if (!store || store.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })
  }

  const orders = await prisma.customerOrder.findMany({
    where: { tenantId: store.tenantId, storeCode, status: { in: ['PENDING', 'CONFIRMED'] } },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: {
      id: true, orderNo: true, tableNo: true,
      itemsJson: true, totalAmount: true, status: true,
      remark: true, createdAt: true,
    },
  })

  return NextResponse.json(orders.map((o) => ({
    id: o.id,
    orderNo: o.orderNo,
    tableNo: o.tableNo,
    items: JSON.parse(o.itemsJson),
    totalAmount: o.totalAmount.toNumber(),
    status: o.status,
    remark: o.remark,
    createdAt: o.createdAt.toISOString(),
  })))
}
