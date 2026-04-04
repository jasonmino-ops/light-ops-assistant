/**
 * GET   /api/ops/tenants/[tenantId]  — tenant detail with members + today's stats
 * PATCH /api/ops/tenants/[tenantId]  — update tier
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
        staffNumber: true,
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
    tier: tenant.tier,
    createdAt: tenant.createdAt.toISOString(),
    stores,
    members: users.map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      role: u.role,
      bound: !!u.telegramId,
      staffNumber: u.staffNumber ?? null,
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

const VALID_TIERS = ['LITE', 'STANDARD', 'MULTI_STORE']
const VALID_STATUS = ['ACTIVE', 'ARCHIVED']

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  if (!checkOpsAuth(req)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  const { tenantId } = await params

  let body: { tier?: string; status?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 }) }

  const data: { tier?: string; status?: string } = {}
  if (body.tier !== undefined) {
    if (!VALID_TIERS.includes(body.tier)) return NextResponse.json({ error: 'INVALID_TIER' }, { status: 400 })
    data.tier = body.tier
  }
  if (body.status !== undefined) {
    if (!VALID_STATUS.includes(body.status)) return NextResponse.json({ error: 'INVALID_STATUS' }, { status: 400 })
    data.status = body.status
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'NO_CHANGE' }, { status: 400 })

  await prisma.tenant.update({ where: { id: tenantId }, data })
  return NextResponse.json({ ok: true, ...data })
}
