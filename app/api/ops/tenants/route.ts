/**
 * GET  /api/ops/tenants  — list all tenants with aggregate stats
 * POST /api/ops/tenants  — create a new tenant + default store + owner user
 */
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { checkOpsAuth } from '@/lib/ops-auth'

// Test products seeded for every new tenant.
// Barcodes are prefixed DEMO- to be clearly non-production.
// Owner can disable or delete these after going live.
const DEMO_PRODUCTS = [
  { barcode: 'DEMO-0001', name: '【测试】样品商品甲', spec: '单件',  sellPrice: '10.00', status: 'ACTIVE' as const },
  { barcode: 'DEMO-0002', name: '【测试】样品商品乙', spec: '两件装', sellPrice: '18.00', status: 'ACTIVE' as const },
  { barcode: 'DEMO-0003', name: '【测试】样品商品丙', spec: null,    sellPrice: '5.50',  status: 'ACTIVE' as const },
]

function todayStart() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

// Query boundary for "last active" lookup — avoids full-table scan on SaleRecord.
// Tenants with no activity in the last 90 days show lastActiveAt = null (treated as inactive).
function ninetyDaysAgo() {
  const d = new Date()
  d.setDate(d.getDate() - 90)
  return d
}

export async function GET(req: NextRequest) {
  const opsRole = checkOpsAuth(req)
  if (!opsRole) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  // Default to ACTIVE only. Pass ?status=ARCHIVED or ?status=all to override.
  const statusParam = req.nextUrl.searchParams.get('status')
  const statusWhere =
    !statusParam || statusParam === 'ACTIVE' ? { status: 'ACTIVE' }
    : statusParam === 'ARCHIVED'             ? { status: 'ARCHIVED' }
    : {}                                      // 'all' — no filter

  const tenants = await prisma.tenant.findMany({ where: statusWhere, orderBy: { createdAt: 'desc' } })
  const ids = tenants.map((t) => t.id)

  const todayUtc = new Date().toISOString().slice(0, 10)

  const [storeGroups, users, todaySummaries, lastSaleRows] = await Promise.all([
    prisma.store.groupBy({
      by: ['tenantId'],
      where: { tenantId: { in: ids }, status: 'ACTIVE' },
      _count: { id: true },
    }),
    prisma.user.findMany({
      where: { tenantId: { in: ids }, status: 'ACTIVE' },
      select: { tenantId: true, role: true, telegramId: true },
    }),
    // Try summary table first for today's sale counts
    prisma.tenantDailySummary.findMany({
      where: { tenantId: { in: ids }, date: todayUtc },
      select: { tenantId: true, salesCount: true },
    }),
    prisma.saleRecord.findMany({
      where: { tenantId: { in: ids }, createdAt: { gte: ninetyDaysAgo() } },
      orderBy: { createdAt: 'desc' },
      distinct: ['tenantId'],
      select: { tenantId: true, createdAt: true },
    }),
  ])

  // Build lookup maps
  const storeCountMap = new Map(storeGroups.map((g) => [g.tenantId, g._count.id]))

  const userMap = new Map<string, { ownerBound: number; ownerTotal: number; staffBound: number; staffTotal: number }>()
  for (const u of users) {
    const cur = userMap.get(u.tenantId) ?? { ownerBound: 0, ownerTotal: 0, staffBound: 0, staffTotal: 0 }
    if (u.role === 'OWNER') {
      cur.ownerTotal++
      if (u.telegramId) cur.ownerBound++
    } else {
      cur.staffTotal++
      if (u.telegramId) cur.staffBound++
    }
    userMap.set(u.tenantId, cur)
  }

  // Today's sale count: use summary if available for ALL tenants; else fall back to raw
  const summarizedIds = new Set(todaySummaries.map((s) => s.tenantId))
  const allCovered = ids.every((id) => summarizedIds.has(id))

  let todaySaleCountMap: Map<string, number>
  if (allCovered && ids.length > 0) {
    todaySaleCountMap = new Map(todaySummaries.map((s) => [s.tenantId, s.salesCount]))
  } else {
    // Fallback: raw distinct-order count from SaleRecord
    const todaySaleRows = await prisma.saleRecord.findMany({
      where: {
        tenantId: { in: ids },
        saleType: 'SALE',
        orderNo: { not: null },
        createdAt: { gte: todayStart() },
      },
      select: { tenantId: true, orderNo: true },
    })
    const orderSets = new Map<string, Set<string>>()
    for (const row of todaySaleRows) {
      if (!orderSets.has(row.tenantId)) orderSets.set(row.tenantId, new Set())
      orderSets.get(row.tenantId)!.add(row.orderNo!)
    }
    todaySaleCountMap = new Map(Array.from(orderSets.entries()).map(([id, s]) => [id, s.size]))
  }

  const lastActiveMap = new Map(lastSaleRows.map((r) => [r.tenantId, r.createdAt.toISOString()]))

  const result = tenants.map((t) => ({
    id: t.id,
    name: t.name,
    status: t.status,
    tier: t.tier,
    createdAt: t.createdAt.toISOString(),
    storeCount: storeCountMap.get(t.id) ?? 0,
    ...(userMap.get(t.id) ?? { ownerBound: 0, ownerTotal: 0, staffBound: 0, staffTotal: 0 }),
    todaySaleCount: todaySaleCountMap.get(t.id) ?? 0,
    lastActiveAt: lastActiveMap.get(t.id) ?? null,
  }))

  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  const opsRole = checkOpsAuth(req)
  if (!opsRole) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  let body: { tenantName?: string; storeName?: string; tier?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 }) }

  const { tenantName, storeName, tier = 'LITE' } = body
  if (!tenantName?.trim()) return NextResponse.json({ error: 'MISSING_TENANT_NAME' }, { status: 400 })
  if (!storeName?.trim()) return NextResponse.json({ error: 'MISSING_STORE_NAME' }, { status: 400 })

  // Auto-generate owner credentials — username is unique within the tenant;
  // displayName defaults to a placeholder updated when the owner first binds.
  const ownerUsername = 'owner_' + crypto.randomBytes(3).toString('hex')
  const ownerDisplayName = tenantName.trim().slice(0, 10) + '老板'

  const validTier = ['LITE', 'STANDARD', 'MULTI_STORE'].includes(tier) ? tier : 'LITE'
  const storeCode = 'ST' + crypto.randomBytes(4).toString('hex').toUpperCase()

  const [tenant, store, user] = await prisma.$transaction(async (tx) => {
    const t = await tx.tenant.create({ data: { name: tenantName.trim(), tier: validTier } })
    const s = await tx.store.create({
      data: { tenantId: t.id, code: storeCode, name: storeName.trim() },
    })
    const u = await tx.user.create({
      data: {
        tenantId: t.id,
        username: ownerUsername.trim(),
        displayName: ownerDisplayName.trim(),
        role: 'OWNER',
      },
    })
    await tx.userStoreRole.create({
      data: { tenantId: t.id, userId: u.id, storeId: s.id, role: 'OWNER' },
    })
    // Seed 3 clearly-marked test products. Owner can DISABLE or replace them after setup.
    // No sale records, refunds, or staff bindings — all other data starts blank.
    await tx.product.createMany({
      data: DEMO_PRODUCTS.map((p) => ({ ...p, tenantId: t.id })),
    })
    return [t, s, u]
  })

  return NextResponse.json({
    tenantId: tenant.id,
    tenantName: tenant.name,
    storeId: store.id,
    storeName: store.name,
    userId: user.id,
    username: user.username,
  }, { status: 201 })
}
