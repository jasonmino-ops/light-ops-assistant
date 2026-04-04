/**
 * GET /api/ops/tenants/[tenantId]/export
 *
 * Returns a JSON file download with all tenant data:
 * tenant info, stores, members, products, sale records, refund records.
 *
 * NOTE: True hard-delete is intentionally not implemented here.
 * SaleRecord / Product / User all have FK → Tenant with no cascade deletes
 * configured. Hard-deleting a tenant would require deleting all child records
 * in the correct order, is irreversible, and violates financial audit requirements.
 * Use status=INACTIVE to stop a tenant; export first if data archival is needed.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkOpsAuth } from '@/lib/ops-auth'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const opsRole = checkOpsAuth(req)
  if (!opsRole) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  if (opsRole === 'BD') return NextResponse.json({ error: 'FORBIDDEN', message: 'BD 角色无数据导出权限' }, { status: 403 })
  const { tenantId } = await params

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
  if (!tenant) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  const [stores, members, products, sales] = await Promise.all([
    prisma.store.findMany({
      where: { tenantId },
      select: { id: true, code: true, name: true, status: true, createdAt: true },
    }),
    prisma.user.findMany({
      where: { tenantId },
      select: {
        id: true, username: true, displayName: true, role: true,
        status: true, staffNumber: true, telegramId: true, createdAt: true,
      },
    }),
    prisma.product.findMany({
      where: { tenantId },
      select: {
        id: true, barcode: true, sku: true, name: true,
        spec: true, sellPrice: true, status: true, createdAt: true,
      },
    }),
    prisma.saleRecord.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      take: 50000,
      select: {
        id: true, recordNo: true, storeId: true, operatorUserId: true,
        saleType: true, status: true, productId: true, barcode: true,
        productNameSnapshot: true, specSnapshot: true,
        unitPrice: true, quantity: true, lineAmount: true,
        orderNo: true, originalSaleRecordId: true, refundedQty: true,
        refundReason: true, remark: true, createdAt: true,
      },
    }),
  ])

  type SaleRow = typeof sales[number]
  const mapSale = (r: SaleRow) => ({
    ...r,
    unitPrice: r.unitPrice.toNumber(),
    quantity: r.quantity.toNumber(),
    lineAmount: r.lineAmount.toNumber(),
    refundedQty: r.refundedQty?.toNumber() ?? null,
    createdAt: r.createdAt.toISOString(),
  })

  // ── Business summary ────────────────────────────────────────────────────────
  const saleRows = sales.filter((r) => r.saleType === 'SALE')
  const refundRows = sales.filter((r) => r.saleType === 'REFUND')
  const totalRevenue = saleRows.reduce((s, r) => s + r.lineAmount.toNumber(), 0)
  const totalRefundAmt = refundRows.reduce((s, r) => s + r.lineAmount.toNumber(), 0)
  const uniqueOrders = new Set(saleRows.map((r) => r.orderNo).filter(Boolean)).size

  // Top 5 products by quantity sold
  const productQty = new Map<string, { name: string; qty: number }>()
  for (const r of saleRows) {
    const key = r.productNameSnapshot + (r.specSnapshot ? ` (${r.specSnapshot})` : '')
    const cur = productQty.get(key) ?? { name: key, qty: 0 }
    cur.qty += r.quantity.toNumber()
    productQty.set(key, cur)
  }
  const topProducts = [...productQty.values()]
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5)

  const dateRange = saleRows.length > 0
    ? { from: saleRows[saleRows.length - 1].createdAt.toISOString(), to: saleRows[0].createdAt.toISOString() }
    : null

  const summary = {
    totalOrders: uniqueOrders,
    totalSaleLines: saleRows.length,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalRefunds: refundRows.length,
    totalRefundAmount: Math.round(totalRefundAmt * 100) / 100,
    netRevenue: Math.round((totalRevenue - totalRefundAmt) * 100) / 100,
    productCount: products.length,
    memberCount: members.length,
    storeCount: stores.length,
    topProducts,
    dateRange,
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    tenant: {
      id: tenant.id, name: tenant.name,
      status: tenant.status, tier: tenant.tier,
      createdAt: tenant.createdAt.toISOString(),
    },
    summary,
    stores: stores.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() })),
    members: members.map((m) => ({
      ...m,
      telegramId: m.telegramId ? '(bound)' : null, // redacted for privacy
      createdAt: m.createdAt.toISOString(),
    })),
    products: products.map((p) => ({
      ...p,
      sellPrice: p.sellPrice.toNumber(),
      createdAt: p.createdAt.toISOString(),
    })),
    saleRecords: saleRows.map(mapSale),
    refundRecords: refundRows.map(mapSale),
  }

  const slug = tenant.name.replace(/[^\w\u4e00-\u9fa5]/g, '_')
  const date = new Date().toISOString().slice(0, 10)

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="tenant_${slug}_${date}.json"`,
    },
  })
}
