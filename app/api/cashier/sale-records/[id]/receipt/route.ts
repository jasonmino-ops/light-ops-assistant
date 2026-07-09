/**
 * GET /api/cashier/sale-records/[id]/receipt?storeCode=xxx
 *
 * Desktop POS endpoint. Requires logged-in store OWNER/STAFF or signed POS device token.
 * Reconstructs a browser-printable 80mm SaleRecord receipt without changing
 * the SaleRecord write path or schema.
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
    select: { id: true, code: true, tenantId: true, status: true, name: true },
  })
  if (!store || store.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })
  }
  const posAuth = await authorizeDesktopPosRequest(req, {
    tenantId: store.tenantId,
    storeId: store.id,
    storeCode: store.code,
  })
  if (!posAuth) {
    return unauthorizedPosResponse()
  }

  const anchor = await prisma.saleRecord.findFirst({
    where: {
      id,
      tenantId: store.tenantId,
      storeId: store.id,
      saleType: 'SALE',
    },
    select: { id: true, orderNo: true, recordNo: true },
  })
  if (!anchor) return NextResponse.json({ error: 'SALE_RECORD_NOT_FOUND' }, { status: 404 })

  const lines = await prisma.saleRecord.findMany({
    where: anchor.orderNo
      ? {
          tenantId: store.tenantId,
          storeId: store.id,
          orderNo: anchor.orderNo,
          saleType: 'SALE',
        }
      : {
          id: anchor.id,
          tenantId: store.tenantId,
          storeId: store.id,
          saleType: 'SALE',
        },
    include: {
      operatorUser: { select: { displayName: true } },
      member: { select: { memberCode: true, name: true, phone: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  if (lines.length === 0) return NextResponse.json({ error: 'SALE_RECORD_NOT_FOUND' }, { status: 404 })

  const orderNo = anchor.orderNo ?? anchor.recordNo
  const paymentIntent = orderNo
    ? await prisma.paymentIntent.findUnique({
        where: { orderNo },
        select: { paymentMethod: true, status: true, amount: true, paidAt: true },
      })
    : null

  const totalAmount = lines.reduce((sum, line) => sum + line.lineAmount.toNumber(), 0)
  const memberBalanceUsed = lines.reduce((sum, line) => sum + line.memberBalanceUsed.toNumber(), 0)
  const first = lines[0]
  const member = lines.find((line) => line.member)?.member ?? null
  const offlineDeviceId = lines.find((line) => line.offlineDeviceId)?.offlineDeviceId ?? null

  const extraLines = [
    paymentIntent?.status ? { label: '支付状态', value: paymentIntent.status } : null,
    offlineDeviceId ? { label: '设备', value: offlineDeviceId } : null,
    member ? { label: '会员', value: [member.name, member.memberCode, member.phone].filter(Boolean).join(' / ') } : null,
    memberBalanceUsed > 0 ? { label: '会员支付', value: `$${memberBalanceUsed.toFixed(2)}` } : null,
  ].filter((line): line is { label: string; value: string } => !!line && !!line.value)

  return NextResponse.json({
    receipt: {
      storeName: store.name,
      orderNo,
      createdAt: first.createdAt.toISOString(),
      cashierName: first.operatorUser.displayName || 'Desktop POS',
      paymentMethod: paymentIntent?.paymentMethod ?? 'CASH',
      totalAmount,
      extraLines,
      items: lines.map((line) => ({
        name: line.productNameSnapshot,
        spec: line.specSnapshot,
        qty: line.quantity.toNumber(),
        price: line.unitPrice.toNumber(),
        lineAmount: line.lineAmount.toNumber(),
      })),
    },
    source: {
      saleRecordId: anchor.id,
      orderNo,
      lineCount: lines.length,
    },
  })
}
