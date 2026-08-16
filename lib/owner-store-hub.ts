import { prisma } from './prisma'

type DbClient = typeof prisma

export type OwnerSessionIdentity = {
  tenantId: string
  userId: string
  role: 'OWNER' | 'STAFF'
}

export type OwnerStoreAccess = {
  tenantId: string
  userId: string
  storeId: string
  storeName: string
  currencyCode: string
  createdAt: Date
}

export type OwnerStoreMetric = {
  id: string
  name: string
  currencyCode: string
  todaySalesAmount: number
  todayOrderCount: number
  todayAverageOrderValue: number
}

export type OwnerStoreHub = {
  date: string
  overview: {
    salesAmount: number | null
    orderCount: number
    averageOrderValue: number | null
    currencyCode: string | null
    totalsByCurrency: Array<{
      currencyCode: string
      salesAmount: number
      orderCount: number
      averageOrderValue: number
    }>
  }
  stores: OwnerStoreMetric[]
}

export function getOwnerLandingPath(ownerStoreCount: number) {
  return ownerStoreCount >= 2 ? '/my-stores' : '/home'
}

export function canExtendOwnerAcrossTenant(existingRoles: string[], invitationRole: string) {
  return invitationRole === 'OWNER' &&
    existingRoles.length > 0 &&
    existingRoles.every((role) => role === 'OWNER')
}

export function findAuthorizedOwnerStore(stores: OwnerStoreAccess[], storeId: string) {
  return stores.find((store) => store.storeId === storeId) ?? null
}

export async function getTrustedOwnerTelegramId(
  session: OwnerSessionIdentity,
  db: DbClient = prisma,
) {
  if (session.role !== 'OWNER') return null

  const user = await db.user.findFirst({
    where: {
      id: session.userId,
      tenantId: session.tenantId,
      role: 'OWNER',
      status: 'ACTIVE',
    },
    select: { telegramId: true },
  })

  return user?.telegramId?.trim() || null
}

/**
 * Resolves only explicit, active OWNER memberships for this Telegram identity.
 * Tenant/user/store consistency is checked again in application code because
 * UserStoreRole.tenantId is not backed by a compound tenant foreign key.
 */
export async function getActiveOwnerStoresByTelegramId(
  telegramId: string,
  db: DbClient = prisma,
): Promise<OwnerStoreAccess[]> {
  const rows = await db.userStoreRole.findMany({
    where: {
      role: 'OWNER',
      status: 'ACTIVE',
      user: {
        is: {
          telegramId,
          role: 'OWNER',
          status: 'ACTIVE',
          tenant: { is: { status: 'ACTIVE' } },
        },
      },
      store: { is: { status: 'ACTIVE' } },
    },
    orderBy: [{ createdAt: 'asc' }, { storeId: 'asc' }],
    select: {
      tenantId: true,
      userId: true,
      storeId: true,
      createdAt: true,
      user: { select: { tenantId: true } },
      store: {
        select: {
          id: true,
          tenantId: true,
          name: true,
          currencyCode: true,
        },
      },
    },
  })

  const seenStoreIds = new Set<string>()
  const stores: OwnerStoreAccess[] = []
  for (const row of rows) {
    if (row.storeId !== row.store.id) continue
    if (row.tenantId !== row.user.tenantId || row.tenantId !== row.store.tenantId) continue
    if (seenStoreIds.has(row.storeId)) continue
    seenStoreIds.add(row.storeId)
    stores.push({
      tenantId: row.tenantId,
      userId: row.userId,
      storeId: row.storeId,
      storeName: row.store.name,
      currencyCode: row.store.currencyCode,
      createdAt: row.createdAt,
    })
  }
  return stores
}

export async function getOwnerStoresForSession(
  session: OwnerSessionIdentity,
  db: DbClient = prisma,
) {
  const telegramId = await getTrustedOwnerTelegramId(session, db)
  if (!telegramId) return []
  return getActiveOwnerStoresByTelegramId(telegramId, db)
}

export function utcDayBounds(now = new Date()) {
  const date = now.toISOString().slice(0, 10)
  return {
    date,
    from: new Date(`${date}T00:00:00.000Z`),
    to: new Date(`${date}T23:59:59.999Z`),
  }
}

function numberValue(value: unknown) {
  if (typeof value === 'number') return value
  if (value && typeof value === 'object' && 'toNumber' in value) {
    return (value as { toNumber(): number }).toNumber()
  }
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function rounded(value: number) {
  return Number(value.toFixed(2))
}

export async function buildOwnerStoreHub(
  stores: OwnerStoreAccess[],
  now = new Date(),
  db: DbClient = prisma,
): Promise<OwnerStoreHub> {
  const { date, from, to } = utcDayBounds(now)
  if (stores.length === 0) {
    return {
      date,
      overview: {
        salesAmount: 0,
        orderCount: 0,
        averageOrderValue: 0,
        currencyCode: null,
        totalsByCurrency: [],
      },
      stores: [],
    }
  }

  // Each pair is derived server-side from an active OWNER membership.
  const authorizedScope = stores.map((store) => ({
    tenantId: store.tenantId,
    storeId: store.storeId,
  }))

  const [recordTotals, saleOrders, customerOrderTotals] = await Promise.all([
    db.saleRecord.groupBy({
      by: ['tenantId', 'storeId'],
      where: {
        OR: authorizedScope,
        status: 'COMPLETED',
        createdAt: { gte: from, lte: to },
      },
      _sum: { lineAmount: true },
    }),
    db.saleRecord.groupBy({
      by: ['tenantId', 'storeId', 'orderNo'],
      where: {
        OR: authorizedScope,
        saleType: 'SALE',
        status: 'COMPLETED',
        orderNo: { not: null },
        createdAt: { gte: from, lte: to },
      },
    }),
    db.customerOrder.groupBy({
      by: ['tenantId', 'storeId'],
      where: {
        OR: authorizedScope,
        status: 'COMPLETED',
        paymentStatus: 'PAID',
        paidAt: { gte: from, lte: to },
      },
      _sum: { totalAmount: true },
      _count: { _all: true },
    }),
  ])

  const keyOf = (tenantId: string, storeId: string) => `${tenantId}\u0000${storeId}`
  const recordAmountByStore = new Map(
    recordTotals.map((row) => [keyOf(row.tenantId, row.storeId), numberValue(row._sum.lineAmount)]),
  )
  const saleOrderCountByStore = new Map<string, number>()
  for (const row of saleOrders) {
    const key = keyOf(row.tenantId, row.storeId)
    saleOrderCountByStore.set(key, (saleOrderCountByStore.get(key) ?? 0) + 1)
  }
  const customerByStore = new Map(
    customerOrderTotals.map((row) => [
      keyOf(row.tenantId, row.storeId),
      {
        amount: numberValue(row._sum.totalAmount),
        count: row._count._all,
      },
    ]),
  )

  const metrics: OwnerStoreMetric[] = stores.map((store) => {
    const key = keyOf(store.tenantId, store.storeId)
    const customer = customerByStore.get(key) ?? { amount: 0, count: 0 }
    const salesAmount = rounded((recordAmountByStore.get(key) ?? 0) + customer.amount)
    const orderCount = (saleOrderCountByStore.get(key) ?? 0) + customer.count
    return {
      id: store.storeId,
      name: store.storeName,
      currencyCode: store.currencyCode,
      todaySalesAmount: salesAmount,
      todayOrderCount: orderCount,
      todayAverageOrderValue: orderCount > 0 ? rounded(salesAmount / orderCount) : 0,
    }
  })

  const currencyTotals = new Map<string, { salesAmount: number; orderCount: number }>()
  for (const metric of metrics) {
    const current = currencyTotals.get(metric.currencyCode) ?? { salesAmount: 0, orderCount: 0 }
    current.salesAmount += metric.todaySalesAmount
    current.orderCount += metric.todayOrderCount
    currencyTotals.set(metric.currencyCode, current)
  }
  const totalsByCurrency = Array.from(currencyTotals.entries()).map(([currencyCode, total]) => ({
    currencyCode,
    salesAmount: rounded(total.salesAmount),
    orderCount: total.orderCount,
    averageOrderValue: total.orderCount > 0 ? rounded(total.salesAmount / total.orderCount) : 0,
  }))
  const orderCount = metrics.reduce((sum, metric) => sum + metric.todayOrderCount, 0)
  const singleCurrency = totalsByCurrency.length === 1 ? totalsByCurrency[0] : null

  return {
    date,
    overview: {
      salesAmount: singleCurrency?.salesAmount ?? null,
      orderCount,
      averageOrderValue: singleCurrency?.averageOrderValue ?? null,
      currencyCode: singleCurrency?.currencyCode ?? null,
      totalsByCurrency,
    },
    stores: metrics,
  }
}
