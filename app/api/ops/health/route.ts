import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkOpsAuth } from '@/lib/ops-auth'

type CapabilityStatus = 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE'
type HealthStatus = 'OK' | 'WARN' | 'ISSUE' | 'UNAVAILABLE'
type IssueType =
  | 'KHQR_STALE_PENDING'
  | 'OFFLINE_PENDING'
  | 'OFFLINE_FAILED'
  | 'PRINT_TRIGGER_FAILED'
  | 'POS_AUTH_PENDING'
  | 'POS_AUTH_EXPIRED'
  | 'OWNER_BINDING_INCOMPLETE'

type IssueBucket = 'current' | 'recent' | 'persistent' | 'historical' | 'archived'

const DAY_MS = 24 * 60 * 60 * 1000
const SEVEN_DAYS_MS = 7 * DAY_MS
const THIRTY_DAYS_MS = 30 * DAY_MS
const KHQR_STALE_MS = 30 * 60 * 1000
const MAX_ATTENTION_ITEMS = 20
const CLOUD_PRINT_PAUSED_AT = new Date('2026-07-13T01:05:08+07:00')

type StoreRef = {
  tenantId: string
  tenantName: string
  storeId: string | null
  storeName: string | null
  storeCode: string | null
}

type AttentionDraft = StoreRef & {
  issueType: IssueType
  issueLabel: string
  count: number
  firstSeenAt: Date | null
  lastSeenAt: Date | null
  coverageLevel: CapabilityStatus
}

function iso(value: Date | null | undefined) {
  return value ? value.toISOString() : null
}

function capability(status: CapabilityStatus, label: string, reason: string) {
  return { status, label, reason }
}

function uniqCount<T>(values: T[]) {
  return new Set(values.filter(Boolean)).size
}

function minDate(values: (Date | null | undefined)[]) {
  const dates = values.filter(Boolean) as Date[]
  if (dates.length === 0) return null
  return dates.reduce((min, value) => value < min ? value : min, dates[0])
}

function maxDate(values: (Date | null | undefined)[]) {
  const dates = values.filter(Boolean) as Date[]
  if (dates.length === 0) return null
  return dates.reduce((max, value) => value > max ? value : max, dates[0])
}

function readJsonObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readExpiresAt(value: unknown) {
  const raw = readJsonObject(value).expiresAt
  if (typeof raw !== 'string') return null
  const time = new Date(raw)
  return Number.isNaN(time.getTime()) ? null : time
}

function groupKey(tenantId: string, storeId: string | null, issueType: IssueType) {
  return `${issueType}::${tenantId}::${storeId ?? '_tenant'}`
}

function bucketGroupKey(tenantId: string, issueType: IssueType) {
  return `${issueType}::${tenantId}`
}

function pushIssue(map: Map<string, AttentionDraft>, input: AttentionDraft) {
  const key = groupKey(input.tenantId, input.storeId, input.issueType)
  const current = map.get(key)
  if (!current) {
    map.set(key, input)
    return
  }
  current.count += input.count
  current.firstSeenAt = minDate([current.firstSeenAt, input.firstSeenAt])
  current.lastSeenAt = maxDate([current.lastSeenAt, input.lastSeenAt])
}

function pushBucketIssue(map: Map<string, AttentionDraft>, input: AttentionDraft) {
  const key = bucketGroupKey(input.tenantId, input.issueType)
  const current = map.get(key)
  if (!current) {
    map.set(key, input)
    return
  }
  current.count += input.count
  current.firstSeenAt = minDate([current.firstSeenAt, input.firstSeenAt])
  current.lastSeenAt = maxDate([current.lastSeenAt, input.lastSeenAt])
  if (current.storeId !== input.storeId) {
    current.storeId = null
    current.storeName = '多门店'
    current.storeCode = null
  }
}

function attentionItem(issue: AttentionDraft) {
  return {
    tenantId: issue.tenantId,
    tenantName: issue.tenantName,
    storeId: issue.storeId,
    storeName: issue.storeName,
    storeCode: issue.storeCode,
    issueType: issue.issueType,
    issueLabel: issue.issueLabel,
    count: issue.count,
    firstSeenAt: iso(issue.firstSeenAt),
    lastSeenAt: iso(issue.lastSeenAt),
    coverageLevel: issue.coverageLevel,
  }
}

function sortIssues(values: AttentionDraft[]) {
  return values.sort((a, b) => (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0))
}

function pushToBucket(buckets: Record<IssueBucket, Map<string, AttentionDraft>>, bucket: IssueBucket, issue: AttentionDraft) {
  pushBucketIssue(buckets[bucket], issue)
}

function refForStore(storeMap: Map<string, StoreRef>, tenantMap: Map<string, string>, tenantId: string, storeId: string | null): StoreRef {
  if (storeId) {
    const store = storeMap.get(storeId)
    if (store) return store
  }
  return {
    tenantId,
    tenantName: tenantMap.get(tenantId) ?? tenantId,
    storeId,
    storeName: storeId,
    storeCode: null,
  }
}

export async function GET(req: NextRequest) {
  const opsRole = await checkOpsAuth(req)
  if (!opsRole) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const generatedAt = new Date()
  const since24h = new Date(generatedAt.getTime() - DAY_MS)
  const since7d = new Date(generatedAt.getTime() - SEVEN_DAYS_MS)
  const since30d = new Date(generatedAt.getTime() - THIRTY_DAYS_MS)
  const staleKhqrBefore = new Date(generatedAt.getTime() - KHQR_STALE_MS)

  const dbStartedAt = Date.now()
  let databaseStatus: HealthStatus = 'OK'
  let databaseError: string | null = null
  try {
    await prisma.$queryRaw`SELECT 1`
  } catch (error) {
    databaseStatus = 'UNAVAILABLE'
    databaseError = error instanceof Error ? error.message.slice(0, 120) : 'DATABASE_CHECK_FAILED'
  }
  const databaseLatencyMs = Date.now() - dbStartedAt

  const [
    tenants,
    stores,
    effectiveOwners,
    sales24h,
    customerOrders24h,
    paidCustomerOrders24h,
    khqrPending,
    offlineRows,
    printLogs,
    posAuthRows,
    recentSaleTenants,
    recentCustomerOrderTenants,
  ] = await Promise.all([
    prisma.tenant.findMany({
      select: { id: true, name: true, status: true },
    }),
    prisma.store.findMany({
      select: { id: true, tenantId: true, name: true, code: true, status: true },
    }),
    prisma.user.findMany({
      where: {
        role: 'OWNER',
        status: 'ACTIVE',
        storeRoles: { some: { role: 'OWNER', status: 'ACTIVE' } },
      },
      select: { tenantId: true },
    }),
    prisma.saleRecord.findMany({
      where: {
        saleType: 'SALE',
        status: 'COMPLETED',
        createdAt: { gte: since24h },
      },
      select: { id: true, tenantId: true, storeId: true, orderNo: true },
    }),
    prisma.customerOrder.findMany({
      where: { createdAt: { gte: since24h } },
      select: { id: true, tenantId: true, storeId: true },
    }),
    prisma.customerOrder.findMany({
      where: {
        status: 'COMPLETED',
        paymentStatus: 'PAID',
        paidAt: { gte: since24h },
      },
      select: { id: true, tenantId: true, storeId: true },
    }),
    prisma.paymentIntent.findMany({
      where: {
        paymentMethod: 'KHQR',
        status: 'PENDING',
      },
      select: { tenantId: true, storeId: true, orderNo: true, createdAt: true },
    }),
    prisma.offlineSaleSyncMap.findMany({
      where: {
        status: { in: ['PENDING', 'FAILED', 'SYNCED'] },
      },
      orderBy: { updatedAt: 'desc' },
      take: 500,
      select: {
        tenantId: true,
        storeId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        syncedAt: true,
        lastErrorCode: true,
      },
    }),
    prisma.operationLog.findMany({
      where: {
        actionType: 'PRINT_RECEIPT',
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: { tenantId: true, storeId: true, status: true, createdAt: true, message: true },
    }),
    prisma.operationLog.findMany({
      where: {
        actionType: 'POS_DEVICE_AUTH_REQUEST',
        targetType: 'POS_DEVICE',
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: { tenantId: true, storeId: true, status: true, createdAt: true, payloadSnapshot: true },
    }),
    prisma.saleRecord.groupBy({
      by: ['tenantId'],
      where: { createdAt: { gte: since7d } },
    }),
    prisma.customerOrder.groupBy({
      by: ['tenantId'],
      where: { createdAt: { gte: since7d } },
    }),
  ])

  const khqrSaleRecords = await prisma.saleRecord.findMany({
    where: { orderNo: { in: khqrPending.map((row) => row.orderNo) } },
    select: { orderNo: true, status: true },
  })
  const completedKhqrOrderNos = new Set(khqrSaleRecords.filter((row) => row.status === 'COMPLETED' && row.orderNo).map((row) => row.orderNo as string))

  const tenantMap = new Map(tenants.map((tenant) => [tenant.id, tenant.name]))
  const storeMap = new Map<string, StoreRef>()
  for (const store of stores) {
    storeMap.set(store.id, {
      tenantId: store.tenantId,
      tenantName: tenantMap.get(store.tenantId) ?? store.tenantId,
      storeId: store.id,
      storeName: store.name,
      storeCode: store.code,
    })
  }

  const saleOrderKeys = new Set<string>()
  const saleTenantIds = new Set<string>()
  const saleStoreIds = new Set<string>()
  for (const sale of sales24h) {
    saleOrderKeys.add(sale.orderNo ?? sale.id)
    saleTenantIds.add(sale.tenantId)
    saleStoreIds.add(sale.storeId)
  }

  const submittedTenantIds = new Set(customerOrders24h.map((order) => order.tenantId))
  const submittedStoreIds = new Set(customerOrders24h.map((order) => order.storeId))
  const paidTenantIds = new Set(paidCustomerOrders24h.map((order) => order.tenantId))
  const paidStoreIds = new Set(paidCustomerOrders24h.map((order) => order.storeId))

  const khqrPending24h = khqrPending.filter((row) => row.createdAt >= since24h)
  const khqrStale = khqrPending.filter((row) => row.createdAt <= staleKhqrBefore)
  const khqrStale24h = khqrStale.filter((row) => row.createdAt >= since24h)
  const khqrStale7d = khqrStale.filter((row) => row.createdAt >= since7d)
  const khqrStaleHistorical = khqrStale.filter((row) => row.createdAt < since7d)
  const khqrStaleArchived = khqrStaleHistorical.filter((row) => row.createdAt < since30d && completedKhqrOrderNos.has(row.orderNo))

  const offlinePending = offlineRows.filter((row) => row.status === 'PENDING')
  const offlineFailed = offlineRows.filter((row) => row.status === 'FAILED')
  const offlineSynced24h = offlineRows.filter((row) => row.status === 'SYNCED' && row.syncedAt && row.syncedAt >= since24h)
  const offlinePending24h = offlinePending.filter((row) => row.createdAt >= since24h || row.updatedAt >= since24h)
  const offlinePendingStale = offlinePending.filter((row) => row.createdAt <= staleKhqrBefore)
  const offlineFailed24h = offlineFailed.filter((row) => row.updatedAt >= since24h)
  const offlineFailed7d = offlineFailed.filter((row) => row.updatedAt >= since7d)
  const offlineFailedHistorical = offlineFailed.filter((row) => row.updatedAt < since7d)
  const offlineFailedArchived = offlineFailedHistorical.filter((row) => row.updatedAt < since30d)

  const printLogs24h = printLogs.filter((row) => row.createdAt >= since24h)
  const printSuccess = printLogs24h.filter((row) => row.status === 'SUCCESS')
  const printFailed = printLogs24h.filter((row) => row.status === 'FAILED')
  const printSkipped = printLogs24h.filter((row) => row.status === 'FAILED' && row.message?.startsWith('tier_'))
  const printFailedAfterPause = printLogs.filter((row) => row.status === 'FAILED' && row.createdAt >= CLOUD_PRINT_PAUSED_AT)
  const printFailedBeforePause = printLogs.filter((row) => row.status === 'FAILED' && row.createdAt < CLOUD_PRINT_PAUSED_AT)
  const printFailed24hAfterPause = printFailedAfterPause.filter((row) => row.createdAt >= since24h)
  const printFailedArchived = printFailedBeforePause

  const posAuthRows24h = posAuthRows.filter((row) => row.createdAt >= since24h)
  const posAuthSuccess = posAuthRows24h.filter((row) => row.status === 'SUCCESS')
  const posAuthOpen = posAuthRows.filter((row) => row.status !== 'SUCCESS')
  const posAuthPending = posAuthOpen.filter((row) => {
    const expiresAt = readExpiresAt(row.payloadSnapshot)
    return expiresAt ? expiresAt > generatedAt : false
  })
  const posAuthExpired = posAuthOpen.filter((row) => {
    const expiresAt = readExpiresAt(row.payloadSnapshot)
    return expiresAt ? expiresAt <= generatedAt : false
  })
  const posAuthPending24h = posAuthPending.filter((row) => row.createdAt >= since24h)
  const posAuthExpired24h = posAuthExpired.filter((row) => row.createdAt >= since24h)
  const posAuthOpen7d = posAuthOpen.filter((row) => row.createdAt >= since7d)
  const posAuthHistorical = posAuthOpen.filter((row) => row.createdAt < since7d)

  const activeTenantIds7d = new Set([
    ...recentSaleTenants.map((row) => row.tenantId),
    ...recentCustomerOrderTenants.map((row) => row.tenantId),
  ])
  const effectiveOwnerTenantIds = new Set(effectiveOwners.map((owner) => owner.tenantId))
  const noEffectiveOwnerTenants = tenants.filter((tenant) => tenant.status === 'ACTIVE' && !effectiveOwnerTenantIds.has(tenant.id))

  const issues = new Map<string, AttentionDraft>()
  const issueBuckets: Record<IssueBucket, Map<string, AttentionDraft>> = {
    current: new Map(),
    recent: new Map(),
    persistent: new Map(),
    historical: new Map(),
    archived: new Map(),
  }

  function issueFor(ref: StoreRef, issueType: IssueType, issueLabel: string, count: number, firstSeenAt: Date | null, lastSeenAt: Date | null, coverageLevel: CapabilityStatus): AttentionDraft {
    return { ...ref, issueType, issueLabel, count, firstSeenAt, lastSeenAt, coverageLevel }
  }

  for (const row of khqrStale24h) {
    const ref = refForStore(storeMap, tenantMap, row.tenantId, row.storeId)
    const issue = issueFor(ref, 'KHQR_STALE_PENDING', 'KHQR 超过 30 分钟仍 PENDING', 1, row.createdAt, row.createdAt, 'AVAILABLE')
    pushIssue(issues, issue)
    pushToBucket(issueBuckets, 'current', issue)
    pushToBucket(issueBuckets, 'recent', issue)
  }
  for (const row of khqrStale7d) {
    const ref = refForStore(storeMap, tenantMap, row.tenantId, row.storeId)
    pushToBucket(issueBuckets, 'persistent', issueFor(ref, 'KHQR_STALE_PENDING', 'KHQR 最近 7 天仍有 PENDING', 1, row.createdAt, row.createdAt, 'AVAILABLE'))
  }
  for (const row of khqrStaleHistorical) {
    const ref = refForStore(storeMap, tenantMap, row.tenantId, row.storeId)
    const label = completedKhqrOrderNos.has(row.orderNo) ? '历史支付状态待核对' : '历史 KHQR PENDING'
    pushToBucket(issueBuckets, khqrStaleArchived.includes(row) ? 'archived' : 'historical', issueFor(ref, 'KHQR_STALE_PENDING', label, 1, row.createdAt, row.createdAt, 'AVAILABLE'))
  }

  for (const row of offlinePending) {
    const ref = refForStore(storeMap, tenantMap, row.tenantId, row.storeId)
    const issue = issueFor(ref, 'OFFLINE_PENDING', '离线订单待同步', 1, row.createdAt, row.updatedAt, 'AVAILABLE')
    if (offlinePending24h.includes(row)) {
      pushIssue(issues, issue)
      pushToBucket(issueBuckets, 'current', issue)
      pushToBucket(issueBuckets, 'recent', issue)
    }
    if (offlinePendingStale.includes(row)) {
      pushIssue(issues, issue)
      pushToBucket(issueBuckets, 'persistent', issue)
    }
  }
  for (const row of offlineFailed24h) {
    const ref = refForStore(storeMap, tenantMap, row.tenantId, row.storeId)
    const issue = issueFor(ref, 'OFFLINE_FAILED', row.lastErrorCode ? `离线同步失败：${row.lastErrorCode}` : '离线同步失败', 1, row.createdAt, row.updatedAt, 'AVAILABLE')
    pushIssue(issues, issue)
    pushToBucket(issueBuckets, 'current', issue)
    pushToBucket(issueBuckets, 'recent', issue)
  }
  for (const row of offlineFailed7d) {
    const ref = refForStore(storeMap, tenantMap, row.tenantId, row.storeId)
    pushToBucket(issueBuckets, 'persistent', issueFor(ref, 'OFFLINE_FAILED', row.lastErrorCode ? `离线同步失败：${row.lastErrorCode}` : '离线同步失败', 1, row.createdAt, row.updatedAt, 'AVAILABLE'))
  }
  for (const row of offlineFailedHistorical) {
    const ref = refForStore(storeMap, tenantMap, row.tenantId, row.storeId)
    pushToBucket(issueBuckets, offlineFailedArchived.includes(row) ? 'archived' : 'historical', issueFor(ref, 'OFFLINE_FAILED', row.lastErrorCode ? `历史离线同步失败：${row.lastErrorCode}` : '历史离线同步失败', 1, row.createdAt, row.updatedAt, 'AVAILABLE'))
  }
  for (const row of printFailed24hAfterPause) {
    const ref = refForStore(storeMap, tenantMap, row.tenantId, row.storeId)
    const issue = issueFor(ref, 'PRINT_TRIGGER_FAILED', '云打印暂停后仍有触发失败', 1, row.createdAt, row.createdAt, 'PARTIAL')
    pushIssue(issues, issue)
    pushToBucket(issueBuckets, 'current', issue)
    pushToBucket(issueBuckets, 'recent', issue)
    pushToBucket(issueBuckets, 'persistent', issue)
  }
  for (const row of printFailedArchived) {
    const ref = refForStore(storeMap, tenantMap, row.tenantId, row.storeId)
    pushToBucket(issueBuckets, 'archived', issueFor(ref, 'PRINT_TRIGGER_FAILED', '已暂停云打印历史失败', 1, row.createdAt, row.createdAt, 'PARTIAL'))
  }
  for (const row of posAuthPending24h) {
    const ref = refForStore(storeMap, tenantMap, row.tenantId, row.storeId)
    const issue = issueFor(ref, 'POS_AUTH_PENDING', 'POS 设备授权待确认', 1, row.createdAt, row.createdAt, 'PARTIAL')
    pushIssue(issues, issue)
    pushToBucket(issueBuckets, 'current', issue)
    pushToBucket(issueBuckets, 'recent', issue)
  }
  for (const row of posAuthExpired24h) {
    const ref = refForStore(storeMap, tenantMap, row.tenantId, row.storeId)
    const issue = issueFor(ref, 'POS_AUTH_EXPIRED', 'POS 设备授权已过期', 1, row.createdAt, row.createdAt, 'PARTIAL')
    pushIssue(issues, issue)
    pushToBucket(issueBuckets, 'current', issue)
    pushToBucket(issueBuckets, 'recent', issue)
  }
  for (const row of posAuthOpen7d) {
    const expiresAt = readExpiresAt(row.payloadSnapshot)
    const type: IssueType = expiresAt && expiresAt > generatedAt ? 'POS_AUTH_PENDING' : 'POS_AUTH_EXPIRED'
    const ref = refForStore(storeMap, tenantMap, row.tenantId, row.storeId)
    pushToBucket(issueBuckets, 'persistent', issueFor(ref, type, type === 'POS_AUTH_PENDING' ? 'POS 授权最近 7 天仍待确认' : 'POS 授权最近 7 天有过期', 1, row.createdAt, row.createdAt, 'PARTIAL'))
  }
  for (const row of posAuthHistorical) {
    const expiresAt = readExpiresAt(row.payloadSnapshot)
    const type: IssueType = expiresAt && expiresAt > generatedAt ? 'POS_AUTH_PENDING' : 'POS_AUTH_EXPIRED'
    const ref = refForStore(storeMap, tenantMap, row.tenantId, row.storeId)
    pushToBucket(issueBuckets, 'historical', issueFor(ref, type, type === 'POS_AUTH_PENDING' ? '历史 POS 授权待确认' : '历史 POS 授权过期', 1, row.createdAt, row.createdAt, 'PARTIAL'))
  }
  for (const tenant of noEffectiveOwnerTenants) {
    const ref = refForStore(storeMap, tenantMap, tenant.id, null)
    const issue = issueFor(ref, 'OWNER_BINDING_INCOMPLETE', 'ACTIVE 商户无有效 OWNER', 1, generatedAt, generatedAt, 'AVAILABLE')
    pushIssue(issues, issue)
    pushToBucket(issueBuckets, 'current', issue)
  }

  const currentIssues = sortIssues(Array.from(issueBuckets.current.values()))
  const recentIssues = sortIssues(Array.from(issueBuckets.recent.values()))
  const persistentIssues = sortIssues(Array.from(issueBuckets.persistent.values()))
  const historicalIssues = sortIssues(Array.from(issueBuckets.historical.values()))
  const archivedNoise = sortIssues(Array.from(issueBuckets.archived.values()))

  const attentionIssueMap = new Map<string, AttentionDraft>()
  for (const issue of [...currentIssues, ...persistentIssues]) {
    pushBucketIssue(attentionIssueMap, issue)
  }
  const attentionIssueValues = sortIssues(Array.from(attentionIssueMap.values()))
  const attentionItems = attentionIssueValues
    .slice(0, MAX_ATTENTION_ITEMS)
    .map(attentionItem)

  const affectedTenantIds = new Set(attentionIssueValues.map((issue) => issue.tenantId))
  const affectedStoreIds = new Set(attentionIssueValues.map((issue) => issue.storeId).filter(Boolean) as string[])
  const needsAttentionTenantIds = new Set(attentionIssueValues.map((issue) => issue.tenantId))

  return NextResponse.json({
    generatedAt: generatedAt.toISOString(),
    windows: {
      businessSince: since24h.toISOString(),
      activeSince: since7d.toISOString(),
      khqrStaleThresholdMinutes: KHQR_STALE_MS / 60000,
    },
    agingPolicy: {
      currentHours: 24,
      historicalDays: 7,
      archivedDays: 30,
      cloudPrintPausedAt: CLOUD_PRINT_PAUSED_AT.toISOString(),
      note: '分类仅在查询层完成，不写入数据库；历史和封存记录保留原始审计数据。',
    },
    queryDurationMs: Date.now() - dbStartedAt,
    system: {
      database: {
        status: databaseStatus,
        latencyMs: databaseLatencyMs,
        error: databaseError,
      },
      api500: capability('UNAVAILABLE', '暂不可可靠统计', '未接入统一服务端错误日志，当前无法从数据库可靠统计全站 API 500。'),
    },
    business: {
      posSales: {
        success: {
          status: 'AVAILABLE' as const,
          orderCount: saleOrderKeys.size,
          tenantCount: saleTenantIds.size,
          storeCount: saleStoreIds.size,
        },
        failure: capability('UNAVAILABLE', '暂不可可靠统计', '当前失败销售多数不落库，暂不可可靠统计。'),
      },
      customerOrders: {
        submitted: {
          status: 'AVAILABLE' as const,
          orderCount: customerOrders24h.length,
          tenantCount: submittedTenantIds.size,
          storeCount: submittedStoreIds.size,
        },
        paidCompleted: {
          status: 'AVAILABLE' as const,
          orderCount: paidCustomerOrders24h.length,
          tenantCount: paidTenantIds.size,
          storeCount: paidStoreIds.size,
        },
        failure: capability('UNAVAILABLE', '暂不可可靠统计', '当前下单失败未统一落库，暂不可可靠统计。'),
      },
      khqr: {
        status: 'AVAILABLE' as const,
        pendingCount: khqrPending.length,
        pendingCreated24hCount: khqrPending24h.length,
        stalePendingCount: khqrStale.length,
        tenantCount: uniqCount(khqrPending.map((row) => row.tenantId)),
        storeCount: uniqCount(khqrPending.map((row) => row.storeId)),
        earliestPendingAt: iso(minDate(khqrPending.map((row) => row.createdAt))),
      },
      offlineSync: {
        status: 'AVAILABLE' as const,
        pendingCount: offlinePending.length,
        failedCount: offlineFailed.length,
        synced24hCount: offlineSynced24h.length,
        tenantCount: uniqCount([...offlinePending, ...offlineFailed].map((row) => row.tenantId)),
        storeCount: uniqCount([...offlinePending, ...offlineFailed].map((row) => row.storeId)),
        earliestPendingAt: iso(minDate(offlinePending.map((row) => row.createdAt))),
        latestFailedAt: iso(maxDate(offlineFailed.map((row) => row.updatedAt))),
        coverageNote: '该数据只覆盖已进入服务端同步流程的离线订单；客户端尚未上传的本地订单不可见。',
      },
      cloudPrint: {
        status: 'PARTIAL' as const,
        triggerSuccessCount: printSuccess.length,
        triggerFailedCount: printFailed.length,
        triggerSkippedCount: printSkipped.length,
        tenantCount: uniqCount(printLogs24h.map((row) => row.tenantId)),
        storeCount: uniqCount(printLogs24h.map((row) => row.storeId).filter(Boolean) as string[]),
        latestFailedAt: iso(maxDate(printFailed.map((row) => row.createdAt))),
        coverageNote: '成功仅代表服务端打印调用或触发成功，不代表打印机物理出纸成功。',
      },
      posAuthorization: {
        status: 'PARTIAL' as const,
        success24hCount: posAuthSuccess.length,
        pendingCount: posAuthPending.length,
        expiredCount: posAuthExpired.length,
        tenantCount: uniqCount(posAuthRows24h.map((row) => row.tenantId)),
        storeCount: uniqCount(posAuthRows24h.map((row) => row.storeId).filter(Boolean) as string[]),
        coverageNote: 'SUCCESS 表示授权完成；待授权和过期基于白名单读取的 expiresAt 推断，token 和完整 payload 不返回。',
      },
    },
    merchantImpact: {
      activeTenantCount7d: activeTenantIds7d.size,
      needsAttentionTenantCount: needsAttentionTenantIds.size,
      identifiableAffectedTenantCount: affectedTenantIds.size,
      identifiableAffectedStoreCount: affectedStoreIds.size,
      noEffectiveOwnerTenantCount: noEffectiveOwnerTenants.length,
      coverageNote: '当前影响范围仅覆盖已有数据库日志和状态记录，不代表全站所有失败。',
    },
    capabilityNotes: {
      available: [
        capability('AVAILABLE', '数据库连接和本次查询耗时', '通过当前请求内的轻量 Prisma 查询获得。'),
        capability('AVAILABLE', 'POS 成功销售', '基于 SaleRecord COMPLETED 销售记录，并按 orderNo 去重。'),
        capability('AVAILABLE', '顾客订单提交和已付款完成', '基于 CustomerOrder createdAt / paidAt 统计。'),
        capability('AVAILABLE', 'KHQR PENDING', '基于 PaymentIntent KHQR PENDING 当前状态。'),
        capability('AVAILABLE', '离线同步状态', '基于 OfflineSaleSyncMap 服务端记录。'),
      ],
      partial: [
        capability('PARTIAL', '云打印触发结果', '覆盖云打印服务端调用，不覆盖浏览器 window.print 或物理出纸结果。'),
        capability('PARTIAL', 'POS 授权状态', '授权完成可统计；待授权和过期由 OperationLog payloadSnapshot.expiresAt 安全推断。'),
        capability('PARTIAL', '受影响商户和门店', '仅覆盖 KHQR、离线同步、打印、POS 授权已有记录。'),
      ],
      unavailable: [
        capability('UNAVAILABLE', '全站 API 500', '未接入统一服务端错误日志。'),
        capability('UNAVAILABLE', 'POS 销售失败', '多数失败不会创建 SaleRecord 或 OperationLog。'),
        capability('UNAVAILABLE', '顾客下单失败', '下单失败未统一落库。'),
        capability('UNAVAILABLE', 'Telegram 绑定失败', '绑定失败未统一写数据库日志。'),
        capability('UNAVAILABLE', '浏览器打印真实成功', 'window.print 不产生服务端可验证日志。'),
        capability('UNAVAILABLE', '打印机物理成功', '现有数据无法确认真实出纸。'),
      ],
    },
    issueBuckets: {
      current: currentIssues.slice(0, MAX_ATTENTION_ITEMS).map(attentionItem),
      recent: recentIssues.slice(0, MAX_ATTENTION_ITEMS).map(attentionItem),
      persistent: persistentIssues.slice(0, MAX_ATTENTION_ITEMS).map(attentionItem),
      historical: historicalIssues.slice(0, MAX_ATTENTION_ITEMS).map(attentionItem),
      archived: archivedNoise.slice(0, MAX_ATTENTION_ITEMS).map(attentionItem),
    },
    issueCounts: {
      current: currentIssues.length,
      recent: recentIssues.length,
      persistent: persistentIssues.length,
      historical: historicalIssues.length,
      archived: archivedNoise.length,
    },
    attentionItems,
  })
}
