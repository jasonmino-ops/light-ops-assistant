/**
 * GET  /api/ops/tenants  — list all tenants with aggregate stats
 * POST /api/ops/tenants  — create a new tenant + default store + owner user
 */
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { checkOpsAuth } from '@/lib/ops-auth'

function todayStart() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

export async function GET(req: NextRequest) {
  if (!checkOpsAuth(req)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const tenants = await prisma.tenant.findMany({ orderBy: { createdAt: 'desc' } })
  const ids = tenants.map((t) => t.id)

  const [storeGroups, users, todaySaleRows, lastSaleRows] = await Promise.all([
    prisma.store.groupBy({
      by: ['tenantId'],
      where: { tenantId: { in: ids }, status: 'ACTIVE' },
      _count: { id: true },
    }),
    prisma.user.findMany({
      where: { tenantId: { in: ids }, status: 'ACTIVE' },
      select: { tenantId: true, role: true, telegramId: true },
    }),
    prisma.saleRecord.findMany({
      where: {
        tenantId: { in: ids },
        saleType: 'SALE',
        orderNo: { not: null },
        createdAt: { gte: todayStart() },
      },
      select: { tenantId: true, orderNo: true },
    }),
    prisma.saleRecord.findMany({
      where: { tenantId: { in: ids } },
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

  // Count distinct orders per tenant
  const orderSets = new Map<string, Set<string>>()
  for (const row of todaySaleRows) {
    if (!orderSets.has(row.tenantId)) orderSets.set(row.tenantId, new Set())
    orderSets.get(row.tenantId)!.add(row.orderNo!)
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
    todaySaleCount: orderSets.get(t.id)?.size ?? 0,
    lastActiveAt: lastActiveMap.get(t.id) ?? null,
  }))

  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  if (!checkOpsAuth(req)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  let body: { tenantName?: string; storeName?: string; ownerUsername?: string; ownerDisplayName?: string; tier?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 }) }

  const { tenantName, storeName = '总店', ownerUsername, ownerDisplayName, tier = 'LITE' } = body
  if (!tenantName?.trim()) return NextResponse.json({ error: 'MISSING_TENANT_NAME' }, { status: 400 })
  if (!ownerUsername?.trim()) return NextResponse.json({ error: 'MISSING_OWNER_USERNAME' }, { status: 400 })
  if (!ownerDisplayName?.trim()) return NextResponse.json({ error: 'MISSING_OWNER_DISPLAY_NAME' }, { status: 400 })

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
