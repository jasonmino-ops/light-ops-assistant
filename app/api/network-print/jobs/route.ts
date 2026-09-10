import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/network-print/jobs
 *
 * Network（schemaVersion = 2）打印任务的只读观测面。烧机验证期间用来代替
 * “站在打印机前数纸”：把 EshopTrayPrintJob 已有的落库事实读出来并标出异常。
 *
 * 绝对只读：本路由只做 SELECT，不重打、不改状态、不取消、不重置、不删除。
 *
 * 门店隔离：租户与门店只从 getContext() 解析的会话取，query 里的 tenantId /
 * storeId 一律忽略，不作为权限依据，因此跨店跨租户不可见。
 *
 * 参数：
 *   range           TODAY（默认）| 7D | CUSTOM
 *   dateFrom/dateTo CUSTOM 时必填，yyyy-MM-dd，按 Asia/Phnom_Penh 自然日闭区间
 *   stuckMinutes    卡住阈值，默认 10，允许 1..1440
 */

// 柬埔寨在当代日期上是固定 +07:00，无夏令时，因此可以直接用固定偏移算自然日。
const TIMEZONE = 'Asia/Phnom_Penh'
const TZ_OFFSET_MS = 7 * 3_600_000
const DAY_MS = 86_400_000
const MAX_DAYS = 31
const DEFAULT_STUCK_MINUTES = 10
/** 明细与统计的扫描上限；超过时如实返回 truncated，不静默截断。 */
const MAX_SCAN_ROWS = 5000
/** 非终态状态：这些状态停留过久就是“卡住”。 */
const OPEN_STATUSES = ['PENDING', 'CLAIMED', 'EXECUTING'] as const
/** 失败面：FAILED / EXPIRED 都要按 resultCode 分组计数。 */
const FAILED_STATUSES = ['FAILED', 'EXPIRED'] as const

type RangeMode = 'TODAY' | '7D' | 'CUSTOM'

function localDate(at: Date) {
  return new Date(at.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10)
}

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function shiftDate(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

/** 本地自然日闭区间 → UTC 半开区间 [from, to)。 */
function dayBounds(dateFrom: string, dateTo: string) {
  return {
    from: new Date(Date.parse(`${dateFrom}T00:00:00Z`) - TZ_OFFSET_MS),
    to: new Date(Date.parse(`${shiftDate(dateTo, 1)}T00:00:00Z`) - TZ_OFFSET_MS),
  }
}

class QueryError extends Error {
  constructor(public readonly code: string, public readonly hint?: string) { super(code) }
}

function resolveRange(params: URLSearchParams, now: Date) {
  const raw = params.get('range') ?? 'TODAY'
  if (raw !== 'TODAY' && raw !== '7D' && raw !== 'CUSTOM') throw new QueryError('INVALID_RANGE')
  const mode = raw as RangeMode
  const today = localDate(now)
  let dateFrom = today
  let dateTo = today
  if (mode === '7D') dateFrom = shiftDate(today, -6)
  if (mode === 'CUSTOM') {
    dateFrom = params.get('dateFrom') ?? ''
    dateTo = params.get('dateTo') ?? ''
    if (!isValidDate(dateFrom) || !isValidDate(dateTo)) throw new QueryError('INVALID_DATE')
    if (dateFrom > dateTo) throw new QueryError('INVALID_DATE_RANGE', 'dateFrom 晚于 dateTo')
    const days = (Date.parse(`${dateTo}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`)) / DAY_MS + 1
    if (days > MAX_DAYS) throw new QueryError('INVALID_DATE_RANGE', `一次最多查询 ${MAX_DAYS} 天`)
  }
  return { mode, dateFrom, dateTo, ...dayBounds(dateFrom, dateTo) }
}

function resolveStuckMinutes(params: URLSearchParams) {
  const raw = params.get('stuckMinutes')
  if (raw === null || raw === '') return DEFAULT_STUCK_MINUTES
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > 1440) throw new QueryError('INVALID_STUCK_MINUTES')
  return value
}

/**
 * payload 防御性读取。payload 可能是任意历史形状，甚至已被判定为
 * STORED_PAYLOAD_INVALID，因此这里不复用会抛异常的 parseNetworkRequest：
 * 读不出来就返回 null，让页面显示“未知”，绝不因为一条脏数据整页失败。
 */
function readPayload(payload: unknown) {
  const root = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null
  const order = root?.order && typeof root.order === 'object' && !Array.isArray(root.order)
    ? root.order as Record<string, unknown>
    : null
  const role = typeof root?.role === 'string' ? root.role : null
  const rawMode = typeof root?.mode === 'string' ? root.mode : null
  return {
    orderNo: typeof order?.orderNo === 'string' ? order.orderNo : null,
    role,
    // 未知取值原样带出，不丢弃；只有已知的两个 mode 才参与漏单判定。
    mode: rawMode,
    cashierName: typeof order?.cashierName === 'string' ? order.cashierName : null,
    paymentMethod: typeof order?.paymentMethod === 'string' ? order.paymentMethod : null,
    totalAmount: typeof order?.totalAmount === 'number' ? order.totalAmount : null,
  }
}

type JobRow = {
  id: string
  createdAt: string
  updatedAt: string
  executingAt: string | null
  completedAt: string | null
  expiresAt: string
  nextAttemptAt: string
  leaseExpiresAt: string | null
  orderNo: string | null
  role: string | null
  mode: string | null
  status: string
  resultStatus: string | null
  resultCode: string | null
  resultMessage: string | null
  effectBoundary: string | null
  physicalCompletionKnown: boolean
  attemptCount: number
  maxAttempts: number
  claimAttempt: number
  cashierName: string | null
  paymentMethod: string | null
  totalAmount: number | null
  /** createdAt → completedAt；未完成为 null。 */
  durationMs: number | null
  /** 非终态任务的滞留时长，用于卡住判定。 */
  openAgeMs: number | null
}

function bump(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1
}

const DURATION_BUCKETS = [
  { key: '<5s', maxMs: 5_000 },
  { key: '5-15s', maxMs: 15_000 },
  { key: '15-60s', maxMs: 60_000 },
  { key: '1-5min', maxMs: 300_000 },
  { key: '>5min', maxMs: Number.POSITIVE_INFINITY },
] as const

function percentile(sorted: number[], ratio: number) {
  if (!sorted.length) return null
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))
  return sorted[index]
}

export async function GET(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })

  const params = req.nextUrl.searchParams
  let range: ReturnType<typeof resolveRange>
  let stuckMinutes: number
  const now = new Date()
  try {
    range = resolveRange(params, now)
    stuckMinutes = resolveStuckMinutes(params)
  } catch (error) {
    if (error instanceof QueryError) {
      return NextResponse.json({ error: error.code, message: error.hint }, { status: 400 })
    }
    throw error
  }

  // 权限依据只来自会话：query 里的 tenantId / storeId 不参与任何条件。
  const scope = { tenantId: ctx.tenantId, storeId: ctx.storeId }
  const window = { createdAt: { gte: range.from, lt: range.to } }
  // schemaVersion=2 才是 Network（network-v2）通道；v1 是旧 windows-queue relay，
  // 其 payload 没有 role / mode，混进来只会产生一片“未知”。数量单独报出，不静默丢弃。
  const networkWhere = { ...scope, schemaVersion: 2, ...window }

  const [store, totalJobCount, legacyJobCount, rows] = await Promise.all([
    prisma.store.findFirst({
      where: { id: ctx.storeId, tenantId: ctx.tenantId },
      select: { name: true, code: true },
    }),
    prisma.eshopTrayPrintJob.count({ where: networkWhere }),
    prisma.eshopTrayPrintJob.count({ where: { ...scope, schemaVersion: { not: 2 }, ...window } }),
    prisma.eshopTrayPrintJob.findMany({
      where: networkWhere,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_SCAN_ROWS,
      select: {
        id: true, createdAt: true, updatedAt: true, executingAt: true, completedAt: true,
        expiresAt: true, nextAttemptAt: true, leaseExpiresAt: true, payload: true,
        status: true, resultStatus: true, resultCode: true, resultMessage: true,
        effectBoundary: true, physicalCompletionKnown: true,
        attemptCount: true, maxAttempts: true, claimAttempt: true,
      },
    }),
  ])

  const jobs: JobRow[] = rows.map((row) => {
    const payload = readPayload(row.payload)
    const isOpen = (OPEN_STATUSES as readonly string[]).includes(row.status)
    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      executingAt: row.executingAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt.toISOString(),
      nextAttemptAt: row.nextAttemptAt.toISOString(),
      leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
      orderNo: payload.orderNo,
      role: payload.role,
      mode: payload.mode,
      status: row.status,
      resultStatus: row.resultStatus,
      resultCode: row.resultCode,
      resultMessage: row.resultMessage,
      effectBoundary: row.effectBoundary,
      physicalCompletionKnown: row.physicalCompletionKnown,
      attemptCount: row.attemptCount,
      maxAttempts: row.maxAttempts,
      claimAttempt: row.claimAttempt,
      cashierName: payload.cashierName,
      paymentMethod: payload.paymentMethod,
      totalAmount: payload.totalAmount,
      durationMs: row.completedAt ? row.completedAt.getTime() - row.createdAt.getTime() : null,
      openAgeMs: isOpen ? now.getTime() - row.createdAt.getTime() : null,
    }
  })

  // ── 1. 总量与分布 ─────────────────────────────────────────────────────────
  const byRole: Record<string, number> = {}
  const byStatus: Record<string, number> = {}
  const byMode: Record<string, number> = {}
  const byEffectBoundary: Record<string, number> = {}
  for (const job of jobs) {
    bump(byRole, job.role ?? 'UNKNOWN')
    bump(byStatus, job.status)
    bump(byMode, job.mode ?? 'UNKNOWN')
    bump(byEffectBoundary, job.effectBoundary ?? 'NONE')
  }

  // 订单分组。orderNo 读不出来的任务无法归入任何订单，单列出来而不是硬塞进某单。
  type OrderGroup = {
    orderNo: string
    roles: string[]
    modes: string[]
    firstCreatedAt: string
  }
  const orders = new Map<string, OrderGroup>()
  const jobsWithoutOrderNo: string[] = []
  for (const job of [...jobs].reverse()) { // 时间正序，让 firstCreatedAt 落在该单最早的任务上
    if (!job.orderNo) { jobsWithoutOrderNo.push(job.id); continue }
    const group = orders.get(job.orderNo) ?? {
      orderNo: job.orderNo, roles: [], modes: [], firstCreatedAt: job.createdAt,
    }
    group.roles.push(job.role ?? 'UNKNOWN')
    if (job.mode) group.modes.push(job.mode)
    orders.set(job.orderNo, group)
  }

  // ── 2. 漏单 ──────────────────────────────────────────────────────────────
  //
  // mode 判定依据：服务端不持久化门店级打印模式。mode 由每笔销售的 printing
  // intent 决定，并在入队时写进每个 job 的 payload.mode
  // （lib/es-tray-relay/cashier-network-producer.ts:14-22）；receive 时的
  // x-es-network-mode 只做瞬时一致性校验、不落库（lib/es-tray-relay/service.ts:327-355）。
  // 所以每单的历史 mode 就是它自己 payload 里的 mode，可靠还原，无需猜测。
  // 契约还禁止 FRONT_ONLY 携带 KITCHEN（e-shop-tray/src/networkContract.ts:62），
  // 因此 FRONT_ONLY 单“只有 FRONT”是正常的，绝不报成漏单。
  const missingRoleOrders: Array<{
    orderNo: string; mode: string; expectedRoles: string[]; presentRoles: string[]; missingRoles: string[]
    firstCreatedAt: string; modeConflict: boolean
  }> = []
  const modeUndeterminedOrders: Array<{ orderNo: string; presentRoles: string[]; firstCreatedAt: string; reason: string }> = []
  for (const group of orders.values()) {
    const known = group.modes.filter((mode) => mode === 'FRONT_ONLY' || mode === 'SHARED_PRINTER')
    if (!known.length) {
      modeUndeterminedOrders.push({
        orderNo: group.orderNo,
        presentRoles: [...new Set(group.roles)],
        firstCreatedAt: group.firstCreatedAt,
        reason: 'PAYLOAD_MODE_UNREADABLE',
      })
      continue
    }
    const modeConflict = new Set(known).size > 1
    // 冲突时取超集（SHARED_PRINTER），并标出冲突，让人看到而不是被静默合并。
    const mode = known.includes('SHARED_PRINTER') ? 'SHARED_PRINTER' : 'FRONT_ONLY'
    const expectedRoles = mode === 'SHARED_PRINTER' ? ['FRONT', 'KITCHEN'] : ['FRONT']
    const presentRoles = [...new Set(group.roles)]
    const missingRoles = expectedRoles.filter((role) => !presentRoles.includes(role))
    if (missingRoles.length) {
      missingRoleOrders.push({
        orderNo: group.orderNo, mode, expectedRoles, presentRoles, missingRoles,
        firstCreatedAt: group.firstCreatedAt, modeConflict,
      })
    }
  }

  // ── 3. 重复 ──────────────────────────────────────────────────────────────
  const pairs = new Map<string, { orderNo: string; role: string; jobIds: string[]; firstCreatedAt: string }>()
  for (const job of [...jobs].reverse()) {
    if (!job.orderNo) continue
    const key = `${job.orderNo}\u0000${job.role ?? 'UNKNOWN'}`
    const entry = pairs.get(key)
      ?? { orderNo: job.orderNo, role: job.role ?? 'UNKNOWN', jobIds: [], firstCreatedAt: job.createdAt }
    entry.jobIds.push(job.id)
    pairs.set(key, entry)
  }
  const duplicateJobs = [...pairs.values()]
    .filter((entry) => entry.jobIds.length > 1)
    .map((entry) => ({ ...entry, count: entry.jobIds.length }))
    .sort((a, b) => b.count - a.count || a.orderNo.localeCompare(b.orderNo))

  // ── 4. 卡住 ──────────────────────────────────────────────────────────────
  const stuckThresholdMs = stuckMinutes * 60_000
  const stuckJobs = jobs
    .filter((job) => job.openAgeMs !== null && job.openAgeMs > stuckThresholdMs)
    .map((job) => ({
      id: job.id, orderNo: job.orderNo, role: job.role, status: job.status,
      createdAt: job.createdAt, ageMs: job.openAgeMs as number,
      attemptCount: job.attemptCount, claimAttempt: job.claimAttempt,
      leaseExpiresAt: job.leaseExpiresAt, nextAttemptAt: job.nextAttemptAt, expiresAt: job.expiresAt,
    }))
    .sort((a, b) => b.ageMs - a.ageMs)

  // ── 5. 失败（按 resultCode 动态分组，未知取值原样保留）───────────────────
  const failedJobs = jobs.filter((job) => (FAILED_STATUSES as readonly string[]).includes(job.status))
  const failureByResultCode: Record<string, number> = {}
  for (const job of failedJobs) bump(failureByResultCode, job.resultCode ?? 'NO_RESULT_CODE')
  const failureGroups = Object.entries(failureByResultCode)
    .map(([resultCode, count]) => ({ resultCode, count }))
    .sort((a, b) => b.count - a.count || a.resultCode.localeCompare(b.resultCode))

  // ── 6. 不确定：CROSSING_UNKNOWN 必须与普通失败区分 ───────────────────────
  const uncertainJobs = jobs
    .filter((job) => job.effectBoundary === 'CROSSING_UNKNOWN')
    .map((job) => ({
      id: job.id, orderNo: job.orderNo, role: job.role, status: job.status,
      resultCode: job.resultCode, resultMessage: job.resultMessage,
      createdAt: job.createdAt, completedAt: job.completedAt, attemptCount: job.attemptCount,
    }))

  // ── 7. 重试与延迟 ────────────────────────────────────────────────────────
  const retriedJobs = jobs
    .filter((job) => job.attemptCount > 1)
    .map((job) => ({
      id: job.id, orderNo: job.orderNo, role: job.role, status: job.status,
      attemptCount: job.attemptCount, maxAttempts: job.maxAttempts, claimAttempt: job.claimAttempt,
      resultCode: job.resultCode, createdAt: job.createdAt, durationMs: job.durationMs,
    }))
    .sort((a, b) => b.attemptCount - a.attemptCount)
  const durations = jobs
    .map((job) => job.durationMs)
    .filter((value): value is number => value !== null && value >= 0)
    .sort((a, b) => a - b)
  const durationBuckets = DURATION_BUCKETS.map((bucket) => ({ bucket: bucket.key, count: 0 }))
  for (const value of durations) {
    const index = DURATION_BUCKETS.findIndex((bucket) => value < bucket.maxMs)
    durationBuckets[index === -1 ? DURATION_BUCKETS.length - 1 : index].count += 1
  }

  return NextResponse.json({
    generatedAt: now.toISOString(),
    timezone: TIMEZONE,
    readOnly: true,
    store: {
      storeId: ctx.storeId,
      storeName: store?.name ?? null,
      storeCode: store?.code ?? null,
    },
    range: {
      mode: range.mode, dateFrom: range.dateFrom, dateTo: range.dateTo,
      from: range.from.toISOString(), to: range.to.toISOString(),
    },
    stuckThresholdMinutes: stuckMinutes,
    scan: {
      totalJobCount,
      scannedJobCount: jobs.length,
      truncated: totalJobCount > jobs.length,
      maxScanRows: MAX_SCAN_ROWS,
      // v1（旧 windows-queue relay）任务不在本页口径内，但数量报出来，避免看着像“没有”。
      nonNetworkJobCount: legacyJobCount,
    },
    totals: {
      orderCount: orders.size,
      jobCount: jobs.length,
      jobsWithoutOrderNo: jobsWithoutOrderNo.length,
      byRole, byStatus, byMode, byEffectBoundary,
    },
    anomalies: {
      missingRoleOrders,
      modeUndeterminedOrders,
      duplicateJobs,
      stuckJobs,
      failures: { jobCount: failedJobs.length, groups: failureGroups },
      uncertainJobs,
      retriedJobs,
      durations: {
        completedCount: durations.length,
        buckets: durationBuckets,
        p50Ms: percentile(durations, 0.5),
        p95Ms: percentile(durations, 0.95),
        maxMs: durations.length ? durations[durations.length - 1] : null,
      },
    },
    jobs,
  })
}
