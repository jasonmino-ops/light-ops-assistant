/**
 * GET /api/ops/overview
 *
 * Read-only Ops visibility foundation. This endpoint intentionally returns a
 * strict whitelist and does not write OperationLog, issue delegate sessions, or
 * call merchant OWNER APIs.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkOpsAuth } from '@/lib/ops-auth'

type RunStatus =
  | 'NORMAL'
  | 'BINDING_INCOMPLETE'
  | 'OPENED_UNUSED'
  | 'INACTIVE_RECENTLY'
  | 'NEEDS_ATTENTION'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

function iso(value: Date | null | undefined) {
  return value ? value.toISOString() : null
}

function maxDate(a: Date | null | undefined, b: Date | null | undefined) {
  if (!a) return b ?? null
  if (!b) return a
  return a.getTime() >= b.getTime() ? a : b
}

function computeRunStatus(input: {
  hasEffectiveOwner: boolean
  offlinePendingCount: number
  hasAnySale: boolean
  hasAnyCustomerOrder: boolean
  lastActivityAt: Date | null
  since: Date
}): RunStatus {
  if (!input.hasEffectiveOwner) return 'BINDING_INCOMPLETE'
  if (input.offlinePendingCount > 0) return 'NEEDS_ATTENTION'
  if (!input.hasAnySale && !input.hasAnyCustomerOrder) return 'OPENED_UNUSED'
  if (input.lastActivityAt && input.lastActivityAt >= input.since) return 'NORMAL'
  return 'INACTIVE_RECENTLY'
}

export async function GET(req: NextRequest) {
  const opsRole = await checkOpsAuth(req)
  if (!opsRole) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const since = new Date(Date.now() - SEVEN_DAYS_MS)

  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      status: true,
      createdAt: true,
    },
  })
  const tenantIds = tenants.map((tenant) => tenant.id)

  const [
    stores,
    effectiveOwners,
    effectiveStaff,
    lastSales,
    anySales,
    recentSaleTenants,
    lastCustomerOrders,
    anyCustomerOrders,
    recentCustomerOrderTenants,
    offlinePendingRows,
  ] = await Promise.all([
    prisma.store.findMany({
      where: { tenantId: { in: tenantIds } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        tenantId: true,
        name: true,
        code: true,
        status: true,
        currencyCode: true,
      },
    }),
    prisma.user.findMany({
      where: {
        tenantId: { in: tenantIds },
        role: 'OWNER',
        status: 'ACTIVE',
        storeRoles: { some: { role: 'OWNER', status: 'ACTIVE' } },
      },
      select: {
        id: true,
        tenantId: true,
        telegramId: true,
      },
    }),
    prisma.user.findMany({
      where: {
        tenantId: { in: tenantIds },
        role: 'STAFF',
        status: 'ACTIVE',
        storeRoles: { some: { role: 'STAFF', status: 'ACTIVE' } },
      },
      select: {
        id: true,
        tenantId: true,
      },
    }),
    prisma.saleRecord.groupBy({
      by: ['tenantId'],
      where: { tenantId: { in: tenantIds } },
      _max: { createdAt: true },
    }),
    prisma.saleRecord.groupBy({
      by: ['tenantId'],
      where: { tenantId: { in: tenantIds } },
    }),
    prisma.saleRecord.groupBy({
      by: ['tenantId'],
      where: { tenantId: { in: tenantIds }, createdAt: { gte: since } },
    }),
    prisma.customerOrder.groupBy({
      by: ['tenantId'],
      where: { tenantId: { in: tenantIds } },
      _max: { createdAt: true },
    }),
    prisma.customerOrder.groupBy({
      by: ['tenantId'],
      where: { tenantId: { in: tenantIds } },
    }),
    prisma.customerOrder.groupBy({
      by: ['tenantId'],
      where: { tenantId: { in: tenantIds }, createdAt: { gte: since } },
    }),
    // Counts only records that already reached the server. This is not a count
    // of every offline order still sitting on a cashier client.
    prisma.offlineSaleSyncMap.findMany({
      where: { tenantId: { in: tenantIds }, status: 'PENDING' },
      select: { tenantId: true, storeId: true },
    }),
  ])

  const storesByTenant = new Map<string, typeof stores>()
  for (const store of stores) {
    const list = storesByTenant.get(store.tenantId) ?? []
    list.push(store)
    storesByTenant.set(store.tenantId, list)
  }

  const ownerState = new Map<string, { hasEffectiveOwner: boolean; ownerBound: boolean }>()
  for (const owner of effectiveOwners) {
    const current = ownerState.get(owner.tenantId) ?? { hasEffectiveOwner: false, ownerBound: false }
    current.hasEffectiveOwner = true
    if (owner.telegramId) current.ownerBound = true
    ownerState.set(owner.tenantId, current)
  }

  const staffIdsByTenant = new Map<string, Set<string>>()
  for (const staff of effectiveStaff) {
    const set = staffIdsByTenant.get(staff.tenantId) ?? new Set<string>()
    set.add(staff.id)
    staffIdsByTenant.set(staff.tenantId, set)
  }

  const lastSaleByTenant = new Map(lastSales.map((row) => [row.tenantId, row._max.createdAt]))
  const lastOrderByTenant = new Map(lastCustomerOrders.map((row) => [row.tenantId, row._max.createdAt]))
  const anySaleTenantIds = new Set(anySales.map((row) => row.tenantId))
  const anyCustomerOrderTenantIds = new Set(anyCustomerOrders.map((row) => row.tenantId))
  const recentActiveTenantIds = new Set([
    ...recentSaleTenants.map((row) => row.tenantId),
    ...recentCustomerOrderTenants.map((row) => row.tenantId),
  ])

  const offlineCountByTenant = new Map<string, number>()
  const offlineStoreIds = new Set<string>()
  for (const row of offlinePendingRows) {
    offlineCountByTenant.set(row.tenantId, (offlineCountByTenant.get(row.tenantId) ?? 0) + 1)
    offlineStoreIds.add(row.storeId)
  }

  const rows = tenants.map((tenant) => {
    const tenantStores = storesByTenant.get(tenant.id) ?? []
    const storeNames = tenantStores.map((store) => store.name)
    const storeCodes = tenantStores.map((store) => store.code)
    const currencies = Array.from(new Set(tenantStores.map((store) => store.currencyCode))).sort()
    const owner = ownerState.get(tenant.id) ?? { hasEffectiveOwner: false, ownerBound: false }
    const lastSaleAt = lastSaleByTenant.get(tenant.id) ?? null
    const lastCustomerOrderAt = lastOrderByTenant.get(tenant.id) ?? null
    const lastActivityAt = maxDate(lastSaleAt, lastCustomerOrderAt)
    const offlinePendingCount = offlineCountByTenant.get(tenant.id) ?? 0
    const runStatus = computeRunStatus({
      hasEffectiveOwner: owner.hasEffectiveOwner,
      offlinePendingCount,
      hasAnySale: anySaleTenantIds.has(tenant.id),
      hasAnyCustomerOrder: anyCustomerOrderTenantIds.has(tenant.id),
      lastActivityAt,
      since,
    })

    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantStatus: tenant.status,
      createdAt: tenant.createdAt.toISOString(),
      storeCount: tenantStores.length,
      storeNames,
      storeCodes,
      ownerBound: owner.ownerBound,
      hasEffectiveOwner: owner.hasEffectiveOwner,
      staffCount: staffIdsByTenant.get(tenant.id)?.size ?? 0,
      lastSaleAt: iso(lastSaleAt),
      lastCustomerOrderAt: iso(lastCustomerOrderAt),
      lastActivityAt: iso(lastActivityAt),
      offlinePendingCount,
      currencies,
      runStatus,
    }
  })

  const summary = {
    tenantCount: tenants.length,
    storeCount: stores.length,
    ownerBoundTenantCount: rows.filter((row) => row.ownerBound).length,
    noEffectiveOwnerTenantCount: rows.filter((row) => !row.hasEffectiveOwner).length,
    activeTenantCount7d: recentActiveTenantIds.size,
    inactiveNoRecentBusinessTenantCount7d: rows.filter((row) => !recentActiveTenantIds.has(row.tenantId)).length,
    offlinePendingTenantCount: offlineCountByTenant.size,
    offlinePendingStoreCount: offlineStoreIds.size,
    needsAttentionTenantCount: rows.filter((row) => row.runStatus === 'NEEDS_ATTENTION').length,
  }

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    since: since.toISOString(),
    summary,
    tenants: rows,
  })
}
