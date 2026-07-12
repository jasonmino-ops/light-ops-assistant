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

const DAY_MS = 24 * 60 * 60 * 1000
const SEVEN_DAYS_MS = 7 * DAY_MS
const KHQR_STALE_MS = 30 * 60 * 1000
const MAX_ATTENTION_ITEMS = 20

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
    printLogs24h,
    posAuthRows24h,
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
      select: { tenantId: true, storeId: true, createdAt: true },
    }),
    prisma.offlineSaleSyncMap.findMany({
      where: {
        OR: [
          { status: { in: ['PENDING', 'FAILED'] } },
          { status: 'SYNCED', syncedAt: { gte: since24h } },
        ],
      },
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
        createdAt: { gte: since24h },
      },
      select: { tenantId: true, storeId: true, status: true, createdAt: true, message: true },
    }),
    prisma.operationLog.findMany({
      where: {
        actionType: 'POS_DEVICE_AUTH_REQUEST',
        targetType: 'POS_DEVICE',
        createdAt: { gte: since24h },
      },
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

  const offlinePending = offlineRows.filter((row) => row.status === 'PENDING')
  const offlineFailed = offlineRows.filter((row) => row.status === 'FAILED')
  const offlineSynced24h = offlineRows.filter((row) => row.status === 'SYNCED')

  const printSuccess = printLogs24h.filter((row) => row.status === 'SUCCESS')
  const printFailed = printLogs24h.filter((row) => row.status === 'FAILED')
  const printSkipped = printLogs24h.filter((row) => row.status === 'FAILED' && row.message?.startsWith('tier_'))

  const posAuthSuccess = posAuthRows24h.filter((row) => row.status === 'SUCCESS')
  const posAuthOpen = posAuthRows24h.filter((row) => row.status !== 'SUCCESS')
  const posAuthPending = posAuthOpen.filter((row) => {
    const expiresAt = readExpiresAt(row.payloadSnapshot)
    return expiresAt ? expiresAt > generatedAt : false
  })
  const posAuthExpired = posAuthOpen.filter((row) => {
    const expiresAt = readExpiresAt(row.payloadSnapshot)
    return expiresAt ? expiresAt <= generatedAt : false
  })

  const activeTenantIds7d = new Set([
    ...recentSaleTenants.map((row) => row.tenantId),
    ...recentCustomerOrderTenants.map((row) => row.tenantId),
  ])
  const effectiveOwnerTenantIds = new Set(effectiveOwners.map((owner) => owner.tenantId))
  const noEffectiveOwnerTenants = tenants.filter((tenant) => tenant.status === 'ACTIVE' && !effectiveOwnerTenantIds.has(tenant.id))

  const issues = new Map<string, AttentionDraft>()
  for (const row of khqrStale) {
    const ref = refForStore(storeMap, tenantMap, row.tenantId, row.storeId)
    pushIssue(issues, {
      ...ref,
      issueType: 'KHQR_STALE_PENDING',
      issueLabel: 'KHQR 超过 30 分钟仍 PENDING',
      count: 1,
      firstSeenAt: row.createdAt,
      lastSeenAt: row.createdAt,
      coverageLevel: 'AVAILABLE',
    })
  }
  for (const row of offlinePending) {
    const ref = refForStore(storeMap, tenantMap, row.tenantId, row.storeId)
    pushIssue(issues, {
      ...ref,
      issueType: 'OFFLINE_PENDING',
      issueLabel: '离线订单待同步',
      count: 1,
      firstSeenAt: row.createdAt,
      lastSeenAt: row.updatedAt,
      coverageLevel: 'AVAILABLE',
    })
  }
  for (const row of offlineFailed) {
    const ref = refForStore(storeMap, tenantMap, row.tenantId, row.storeId)
    pushIssue(issues, {
      ...ref,
      issueType: 'OFFLINE_FAILED',
      issueLabel: row.lastErrorCode ? `离线同步失败：${row.lastErrorCode}` : '离线同步失败',
      count: 1,
      firstSeenAt: row.createdAt,
      lastSeenAt: row.updatedAt,
      coverageLevel: 'AVAILABLE',
    })
  }
  for (const row of printFailed) {
    const ref = refForStore(storeMap, tenantMap, row.tenantId, row.storeId)
    pushIssue(issues, {
      ...ref,
      issueType: 'PRINT_TRIGGER_FAILED',
      issueLabel: '云打印触发失败',
      count: 1,
      firstSeenAt: row.createdAt,
      lastSeenAt: row.createdAt,
      coverageLevel: 'PARTIAL',
    })
  }
  for (const row of posAuthPending) {
    const ref = refForStore(storeMap, tenantMap, row.tenantId, row.storeId)
    pushIssue(issues, {
      ...ref,
      issueType: 'POS_AUTH_PENDING',
      issueLabel: 'POS 设备授权待确认',
      count: 1,
      firstSeenAt: row.createdAt,
      lastSeenAt: row.createdAt,
      coverageLevel: 'PARTIAL',
    })
  }
  for (const row of posAuthExpired) {
    const ref = refForStore(storeMap, tenantMap, row.tenantId, row.storeId)
    pushIssue(issues, {
      ...ref,
      issueType: 'POS_AUTH_EXPIRED',
      issueLabel: 'POS 设备授权已过期',
      count: 1,
      firstSeenAt: row.createdAt,
      lastSeenAt: row.createdAt,
      coverageLevel: 'PARTIAL',
    })
  }

  const attentionItems = Array.from(issues.values())
    .sort((a, b) => (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0))
    .slice(0, MAX_ATTENTION_ITEMS)
    .map(attentionItem)

  const affectedTenantIds = new Set(Array.from(issues.values()).map((issue) => issue.tenantId))
  const affectedStoreIds = new Set(Array.from(issues.values()).map((issue) => issue.storeId).filter(Boolean) as string[])
  const needsAttentionTenantIds = new Set([
    ...affectedTenantIds,
    ...noEffectiveOwnerTenants.map((tenant) => tenant.id),
  ])

  return NextResponse.json({
    generatedAt: generatedAt.toISOString(),
    windows: {
      businessSince: since24h.toISOString(),
      activeSince: since7d.toISOString(),
      khqrStaleThresholdMinutes: KHQR_STALE_MS / 60000,
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
    attentionItems,
  })
}
