/**
 * PATCH /api/cashier/orders/[id]?storeCode=xxx
 *
 * Public (storeCode-authenticated). Advances order status from the desktop cashier.
 * Allowed: PENDING → CONFIRMED | CANCELLED, CONFIRMED → COMPLETED | CANCELLED.
 * No Telegram notification sent in v1; mobile /home sees status via its own poll.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const ALLOWED: Record<string, string[]> = {
  PENDING:   ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['COMPLETED', 'CANCELLED'],
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const storeCode = req.nextUrl.searchParams.get('storeCode')?.trim()
  if (!storeCode) return NextResponse.json({ error: 'MISSING_STORE_CODE' }, { status: 400 })

  const store = await prisma.store.findUnique({
    where: { code: storeCode },
    select: { tenantId: true, status: true },
  })
  if (!store || store.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })
  }

  let body: { status?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })
  }
  const { status: newStatus } = body
  if (!newStatus) return NextResponse.json({ error: 'MISSING_STATUS' }, { status: 400 })

  const order = await prisma.customerOrder.findFirst({
    where: { id, storeCode, tenantId: store.tenantId },
    select: { id: true, status: true },
  })
  if (!order) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  if (!(ALLOWED[order.status] ?? []).includes(newStatus)) {
    return NextResponse.json({ error: 'INVALID_TRANSITION' }, { status: 422 })
  }

  const updated = await prisma.customerOrder.update({
    where: { id },
    data: { status: newStatus },
    select: { id: true, status: true },
  })
  return NextResponse.json(updated)
}
