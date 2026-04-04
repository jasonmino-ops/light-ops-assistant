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
  if (!checkOpsAuth(req)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
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

  const payload = {
    exportedAt: new Date().toISOString(),
    tenant: {
      id: tenant.id, name: tenant.name,
      status: tenant.status, tier: tenant.tier,
      createdAt: tenant.createdAt.toISOString(),
    },
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
    saleRecords: sales.filter((r) => r.saleType === 'SALE').map(mapSale),
    refundRecords: sales.filter((r) => r.saleType === 'REFUND').map(mapSale),
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
