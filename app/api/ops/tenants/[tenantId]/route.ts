/**
 * GET /api/ops/tenants/[tenantId]  — tenant detail with members + today's stats
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkOpsAuth } from '@/lib/ops-auth'

function todayStart() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  if (!checkOpsAuth(req)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  const { tenantId } = await params

  const [tenant, stores, users, todayRecords, lastSale] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId } }),
    prisma.store.findMany({
      where: { tenantId, status: 'ACTIVE' },
      select: { id: true, name: true, code: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.user.findMany({
      where: { tenantId, status: 'ACTIVE' },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        telegramId: true,
        storeRoles: {
          where: { status: 'ACTIVE' },
          take: 1,
          select: { store: { select: { name: true } } },
        },
      },
    }),
    prisma.saleRecord.findMany({
      where: { tenantId, createdAt: { gte: todayStart() } },
      select: { saleType: true, lineAmount: true, orderNo: true },
    }),
    prisma.saleRecord.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
  ])

  if (!tenant) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  // Compute today's stats
  const saleOrders = new Set<string>()
  let saleAmount = 0
  let refundCount = 0
  for (const r of todayRecords) {
    if (r.saleType === 'SALE') {
      if (r.orderNo) saleOrders.add(r.orderNo)
      saleAmount += Number(r.lineAmount)
    } else {
      refundCount++
    }
  }

  return NextResponse.json({
    id: tenant.id,
    name: tenant.name,
    status: tenant.status,
    createdAt: tenant.createdAt.toISOString(),
    stores,
    members: users.map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      role: u.role,
      bound: !!u.telegramId,
      storeName: u.storeRoles[0]?.store.name ?? '—',
    })),
    today: {
      saleCount: saleOrders.size,
      saleAmount: Math.round(saleAmount * 100) / 100,
      refundCount,
      lastActiveAt: lastSale?.createdAt.toISOString() ?? null,
    },
  })
}
