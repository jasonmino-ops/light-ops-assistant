'use client'

/**
 * Network 打印任务只读查询页。
 *
 * 用途：V727 烧机验证期间不站在打印机前也能核对打印结果——所有事实已经在
 * EshopTrayPrintJob 里，本页只把它读出来并把异常排在前面。
 *
 * 绝对只读：页面不提供重打、改状态、取消、重置、删除中的任何一个动作，
 * 只有「刷新」这一个会发请求的按钮，且它只是重新 GET。
 *
 * 触摸屏约束：正文字号 >= 14px，可点区域 >= 44px。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api'

type RangeMode = 'TODAY' | '7D' | 'CUSTOM'

type Job = {
  id: string
  createdAt: string
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
  durationMs: number | null
  openAgeMs: number | null
}

type JobsResponse = {
  generatedAt: string
  timezone: string
  store: { storeId: string; storeName: string | null; storeCode: string | null }
  range: { mode: RangeMode; dateFrom: string; dateTo: string; from: string; to: string }
  stuckThresholdMinutes: number
  scan: {
    totalJobCount: number
    scannedJobCount: number
    truncated: boolean
    maxScanRows: number
    nonNetworkJobCount: number
  }
  totals: {
    orderCount: number
    jobCount: number
    jobsWithoutOrderNo: number
    byRole: Record<string, number>
    byStatus: Record<string, number>
    byMode: Record<string, number>
    byEffectBoundary: Record<string, number>
  }
  anomalies: {
    missingRoleOrders: Array<{
      orderNo: string; mode: string; expectedRoles: string[]; presentRoles: string[]
      missingRoles: string[]; firstCreatedAt: string; modeConflict: boolean
    }>
    modeUndeterminedOrders: Array<{ orderNo: string; presentRoles: string[]; firstCreatedAt: string; reason: string }>
    duplicateJobs: Array<{ orderNo: string; role: string; jobIds: string[]; firstCreatedAt: string; count: number }>
    stuckJobs: Array<{
      id: string; orderNo: string | null; role: string | null; status: string; createdAt: string
      ageMs: number; attemptCount: number; claimAttempt: number
      leaseExpiresAt: string | null; nextAttemptAt: string; expiresAt: string
    }>
    failures: { jobCount: number; groups: Array<{ resultCode: string; count: number }> }
    uncertainJobs: Array<{
      id: string; orderNo: string | null; role: string | null; status: string
      resultCode: string | null; resultMessage: string | null
      createdAt: string; completedAt: string | null; attemptCount: number
    }>
    retriedJobs: Array<{
      id: string; orderNo: string | null; role: string | null; status: string
      attemptCount: number; maxAttempts: number; claimAttempt: number
      resultCode: string | null; createdAt: string; durationMs: number | null
    }>
    durations: {
      completedCount: number
      buckets: Array<{ bucket: string; count: number }>
      p50Ms: number | null
      p95Ms: number | null
      maxMs: number | null
    }
  }
  jobs: Job[]
}

type Filter = 'ALL' | 'STUCK' | 'FAILED' | 'UNCERTAIN' | 'RETRIED'

const FAILED_STATUSES = ['FAILED', 'EXPIRED']

const STATUS_LABEL: Record<string, string> = {
  PENDING: '待领取',
  CLAIMED: '已领取',
  EXECUTING: '执行中',
  SUCCEEDED: '成功',
  FAILED: '失败',
  EXPIRED: '过期',
}

const ROLE_LABEL: Record<string, string> = {
  FRONT: '前台小票',
  KITCHEN: '厨房小票',
  UNKNOWN: '未知',
}

const MODE_LABEL: Record<string, string> = {
  FRONT_ONLY: '仅前台',
  SHARED_PRINTER: '前台+厨房',
  UNKNOWN: '未知',
}

const BOUNDARY_LABEL: Record<string, string> = {
  CROSSED: '已到打印机',
  NOT_CROSSED: '未到打印机',
  CROSSING_UNKNOWN: '不确定',
  NONE: '—',
}

/** 未知取值一律原样显示，不做白名单丢弃，也不因此崩溃。 */
function label(dict: Record<string, string>, value: string | null | undefined, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback
  return dict[value] ?? value
}

function fmtTime(value: string | null) {
  if (!value) return '—'
  const at = new Date(value)
  if (!Number.isFinite(at.getTime())) return value
  return at.toLocaleString('zh-CN', {
    timeZone: 'Asia/Phnom_Penh',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function fmtDuration(ms: number | null) {
  if (ms === null || !Number.isFinite(ms)) return '—'
  if (ms < 0) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  if (minutes < 60) return `${minutes}分${seconds}秒`
  return `${Math.floor(minutes / 60)}小时${minutes % 60}分`
}

function localToday() {
  return new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10)
}

function shiftLocalDate(days: number) {
  return new Date(Date.now() + 7 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10)
}

export default function NetworkPrintJobsPage() {
  const [rangeMode, setRangeMode] = useState<RangeMode>('TODAY')
  const [dateFrom, setDateFrom] = useState(shiftLocalDate(-6))
  const [dateTo, setDateTo] = useState(localToday())
  const [stuckMinutes, setStuckMinutes] = useState('10')
  // 只在切换时间范围或点「刷新」时才发请求：改日期 / 改阈值不会边打字边查库。
  const [applied, setApplied] = useState({ rangeMode: 'TODAY' as RangeMode, dateFrom: shiftLocalDate(-6), dateTo: localToday(), stuckMinutes: '10', token: 0 })
  const [filter, setFilter] = useState<Filter>('ALL')
  const [data, setData] = useState<JobsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  function applyRange(mode: RangeMode) {
    setRangeMode(mode)
    setApplied((prev) => ({ ...prev, rangeMode: mode, dateFrom, dateTo, token: prev.token + 1 }))
  }

  function refresh() {
    setApplied((prev) => ({ ...prev, rangeMode, dateFrom, dateTo, stuckMinutes, token: prev.token + 1 }))
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const params = new URLSearchParams({ range: applied.rangeMode })
    if (applied.rangeMode === 'CUSTOM') {
      params.set('dateFrom', applied.dateFrom)
      params.set('dateTo', applied.dateTo)
    }
    const minutes = Number(applied.stuckMinutes)
    if (Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440) {
      params.set('stuckMinutes', String(minutes))
    }
    try {
      const res = await apiFetch(`/api/network-print/jobs?${params.toString()}`, { cache: 'no-store' })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        const code = body && typeof body === 'object' ? String((body as { error?: string }).error ?? '') : ''
        const message = body && typeof body === 'object' ? (body as { message?: string }).message : undefined
        throw new Error(
          code === 'MISSING_CONTEXT' ? '未登录或会话已失效，请重新进入后再查看'
            : code === 'INVALID_DATE' || code === 'INVALID_DATE_RANGE' ? (message ?? '时间范围不合法')
            : code === 'INVALID_STUCK_MINUTES' ? '卡住阈值需为 1–1440 之间的整数分钟'
            : `加载失败${code ? `（${code}）` : ''}`,
        )
      }
      setData(body as JobsResponse)
    } catch (err) {
      setData(null)
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [applied])

  useEffect(() => { void load() }, [load])

  const stuckIds = useMemo(
    () => new Set((data?.anomalies.stuckJobs ?? []).map((job) => job.id)),
    [data],
  )

  const visibleJobs = useMemo(() => {
    const jobs = data?.jobs ?? []
    switch (filter) {
      case 'STUCK': return jobs.filter((job) => stuckIds.has(job.id))
      case 'FAILED': return jobs.filter((job) => FAILED_STATUSES.includes(job.status))
      case 'UNCERTAIN': return jobs.filter((job) => job.effectBoundary === 'CROSSING_UNKNOWN')
      case 'RETRIED': return jobs.filter((job) => job.attemptCount > 1)
      default: return jobs
    }
  }, [data, filter, stuckIds])

  const anomalyCount = data
    ? data.anomalies.missingRoleOrders.length + data.anomalies.duplicateJobs.length
      + data.anomalies.stuckJobs.length + data.anomalies.failures.jobCount
      + data.anomalies.uncertainJobs.length
    : 0

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={s.kicker}>Network Print Observability · 只读</div>
        <h1 style={s.title}>网络打印任务查询</h1>
        <div style={s.subtitle}>
          门店：{data ? (data.store.storeName ?? '未命名门店') : '读取中'}
          {data?.store.storeCode ? ` · ${data.store.storeCode}` : ''}
          {' · '}门店由登录会话决定，本页不可切换他店
        </div>
      </header>

      <section style={s.controls}>
        <div style={s.controlRow}>
          {([['TODAY', '今天'], ['7D', '近 7 天'], ['CUSTOM', '自定义']] as Array<[RangeMode, string]>).map(([mode, text]) => (
            <button
              key={mode}
              type="button"
              style={{ ...s.tab, ...(rangeMode === mode ? s.tabActive : null) }}
              onClick={() => applyRange(mode)}
            >
              {text}
            </button>
          ))}
          <button type="button" style={s.refreshBtn} onClick={refresh} disabled={loading}>
            {loading ? '刷新中…' : '刷新'}
          </button>
        </div>

        {rangeMode === 'CUSTOM' && (
          <div style={s.controlRow}>
            <label style={s.fieldLabel}>
              开始
              <input type="date" value={dateFrom} max={localToday()} style={s.input}
                onChange={(e) => setDateFrom(e.target.value)} />
            </label>
            <label style={s.fieldLabel}>
              结束
              <input type="date" value={dateTo} max={localToday()} style={s.input}
                onChange={(e) => setDateTo(e.target.value)} />
            </label>
          </div>
        )}

        <div style={s.controlRow}>
          <label style={s.fieldLabel}>
            卡住阈值（分钟）
            <input type="number" min={1} max={1440} step={1} value={stuckMinutes} style={s.input}
              onChange={(e) => setStuckMinutes(e.target.value)} />
          </label>
          <div style={s.meta}>
            改完日期或阈值后点「刷新」生效
            {data ? ` · 当前口径 ${data.range.dateFrom} ~ ${data.range.dateTo}（${data.timezone}）· 生成于 ${fmtTime(data.generatedAt)}` : ''}
          </div>
        </div>
      </section>

      {loading && !data && <div style={s.center}>加载中…</div>}
      {error && <div style={s.errorBox}>{error}</div>}

      {data && (
        <main style={s.main}>
          <section style={{ ...s.band, ...(anomalyCount > 0 ? s.bandAlert : s.bandOk) }}>
            <div style={s.bandTitle}>
              {anomalyCount > 0 ? `发现 ${anomalyCount} 项待核对的异常` : '本时段未发现异常'}
            </div>
            <div style={s.bandSub}>
              共 {data.totals.orderCount} 单 / {data.totals.jobCount} 个打印任务
              {data.scan.truncated
                ? ` · 时段内共 ${data.scan.totalJobCount} 条，本页只统计了最近 ${data.scan.maxScanRows} 条，请缩小时间范围`
                : ''}
              {data.scan.nonNetworkJobCount > 0
                ? ` · 另有 ${data.scan.nonNetworkJobCount} 条旧版（非 network-v2）任务不在本页口径内`
                : ''}
              {data.totals.jobsWithoutOrderNo > 0
                ? ` · ${data.totals.jobsWithoutOrderNo} 条任务读不出订单号`
                : ''}
            </div>
          </section>

          {/* 七类异常计数条 */}
          <section style={s.cards}>
            <Stat title="① 总量 / role 分布" value={`${data.totals.orderCount} 单 · ${data.totals.jobCount} 任务`}
              detail={Object.entries(data.totals.byRole).map(([role, n]) => `${label(ROLE_LABEL, role)} ${n}`).join(' · ') || '无任务'}
              tone="neutral" />
            <Stat title="② 漏单" value={data.anomalies.missingRoleOrders.length}
              detail={data.anomalies.modeUndeterminedOrders.length > 0
                ? `另有 ${data.anomalies.modeUndeterminedOrders.length} 单无法判定`
                : '按各单 payload 记录的打印模式判定'}
              tone={data.anomalies.missingRoleOrders.length > 0 ? 'bad' : 'good'} />
            <Stat title="③ 重复" value={data.anomalies.duplicateJobs.length}
              detail="同一订单号 + role 出现多个任务"
              tone={data.anomalies.duplicateJobs.length > 0 ? 'bad' : 'good'} />
            <Stat title="④ 卡住" value={data.anomalies.stuckJobs.length}
              detail={`待领取 / 已领取 / 执行中 超过 ${data.stuckThresholdMinutes} 分钟`}
              tone={data.anomalies.stuckJobs.length > 0 ? 'bad' : 'good'} />
            <Stat title="⑤ 失败" value={data.anomalies.failures.jobCount}
              detail={data.anomalies.failures.groups.slice(0, 3).map((g) => `${g.resultCode} ${g.count}`).join(' · ') || '无失败任务'}
              tone={data.anomalies.failures.jobCount > 0 ? 'bad' : 'good'} />
            <Stat title="⑥ 不确定" value={data.anomalies.uncertainJobs.length}
              detail="effectBoundary = CROSSING_UNKNOWN，需人工到机器旁确认"
              tone={data.anomalies.uncertainJobs.length > 0 ? 'unknown' : 'good'} />
            <Stat title="⑦ 重试 / 耗时" value={data.anomalies.retriedJobs.length}
              detail={`重试任务数 · 已完成 ${data.anomalies.durations.completedCount} 条中位 ${fmtDuration(data.anomalies.durations.p50Ms)} / P95 ${fmtDuration(data.anomalies.durations.p95Ms)}`}
              tone={data.anomalies.retriedJobs.length > 0 ? 'warn' : 'good'} />
          </section>

          {/* ⑥ 不确定单独突出：它不是普通失败，纸可能已经出了一半 */}
          {data.anomalies.uncertainJobs.length > 0 && (
            <Section title="⑥ 效果不确定（CROSSING_UNKNOWN）" tone="unknown">
              <div style={s.noteUnknown}>
                这些任务的打印数据可能已经部分写入打印机。系统按设计不会自动重放，
                需要人工到 V727 打印机旁确认纸是否出了、出了几张。这与「失败」不同：失败是确定没打。
              </div>
              <Table head={['创建时间', '订单号', 'role', '状态', 'resultCode', '完成时间', '尝试次数', '提示']}>
                {data.anomalies.uncertainJobs.map((job) => (
                  <tr key={job.id}>
                    <Td>{fmtTime(job.createdAt)}</Td>
                    <Td mono>{job.orderNo ?? '—'}</Td>
                    <Td>{label(ROLE_LABEL, job.role)}</Td>
                    <Td>{label(STATUS_LABEL, job.status)}</Td>
                    <Td mono>{job.resultCode ?? '—'}</Td>
                    <Td>{fmtTime(job.completedAt)}</Td>
                    <Td>{job.attemptCount}</Td>
                    <Td>{job.resultMessage ?? '—'}</Td>
                  </tr>
                ))}
              </Table>
            </Section>
          )}

          {/* ② 漏单 */}
          <Section title="② 漏单（应有的 role 缺失）" tone={data.anomalies.missingRoleOrders.length > 0 ? 'bad' : 'good'}>
            <div style={s.note}>
              判定依据：每个任务入队时把当笔销售的打印模式写进 payload.mode。
              「仅前台」（FRONT_ONLY）本来每单只出前台小票，只有 FRONT 属正常；
              「前台+厨房」（SHARED_PRINTER）才要求 FRONT 与 KITCHEN 同时存在。
              服务端不保存门店级模式，因此本页只用各单自己记录的模式，不做推测。
            </div>
            {data.anomalies.missingRoleOrders.length === 0
              ? <div style={s.empty}>无漏单</div>
              : (
                <Table head={['首个任务时间', '订单号', '打印模式', '应有 role', '实有 role', '缺失', '备注']}>
                  {data.anomalies.missingRoleOrders.map((order) => (
                    <tr key={order.orderNo}>
                      <Td>{fmtTime(order.firstCreatedAt)}</Td>
                      <Td mono>{order.orderNo}</Td>
                      <Td>{label(MODE_LABEL, order.mode)}</Td>
                      <Td>{order.expectedRoles.map((role) => label(ROLE_LABEL, role)).join(' + ')}</Td>
                      <Td>{order.presentRoles.map((role) => label(ROLE_LABEL, role)).join(' + ') || '—'}</Td>
                      <Td><span style={s.pillBad}>{order.missingRoles.map((role) => label(ROLE_LABEL, role)).join(' + ')}</span></Td>
                      <Td>{order.modeConflict ? '同一单内出现两种模式，已按前台+厨房判定' : '—'}</Td>
                    </tr>
                  ))}
                </Table>
              )}
            {data.anomalies.modeUndeterminedOrders.length > 0 && (
              <>
                <div style={s.subheading}>无法判定（payload 读不出打印模式，不计为漏单）</div>
                <Table head={['首个任务时间', '订单号', '实有 role', '原因']}>
                  {data.anomalies.modeUndeterminedOrders.map((order) => (
                    <tr key={order.orderNo}>
                      <Td>{fmtTime(order.firstCreatedAt)}</Td>
                      <Td mono>{order.orderNo}</Td>
                      <Td>{order.presentRoles.map((role) => label(ROLE_LABEL, role)).join(' + ') || '—'}</Td>
                      <Td mono>{order.reason}</Td>
                    </tr>
                  ))}
                </Table>
              </>
            )}
          </Section>

          {/* ③ 重复 */}
          <Section title="③ 重复（同一订单号 + role 多个任务）" tone={data.anomalies.duplicateJobs.length > 0 ? 'bad' : 'good'}>
            {data.anomalies.duplicateJobs.length === 0
              ? <div style={s.empty}>无重复</div>
              : (
                <Table head={['首个任务时间', '订单号', 'role', '任务数', '任务 ID']}>
                  {data.anomalies.duplicateJobs.map((entry) => (
                    <tr key={`${entry.orderNo}-${entry.role}`}>
                      <Td>{fmtTime(entry.firstCreatedAt)}</Td>
                      <Td mono>{entry.orderNo}</Td>
                      <Td>{label(ROLE_LABEL, entry.role)}</Td>
                      <Td><span style={s.pillBad}>{entry.count}</span></Td>
                      <Td mono>{entry.jobIds.join(', ')}</Td>
                    </tr>
                  ))}
                </Table>
              )}
          </Section>

          {/* ④ 卡住 */}
          <Section title={`④ 卡住（超过 ${data.stuckThresholdMinutes} 分钟未终结）`} tone={data.anomalies.stuckJobs.length > 0 ? 'bad' : 'good'}>
            {data.anomalies.stuckJobs.length === 0
              ? <div style={s.empty}>无卡住任务</div>
              : (
                <Table head={['创建时间', '订单号', 'role', '状态', '已滞留', '尝试次数', 'claim 次数', '租约到期', '下次尝试', '任务过期']}>
                  {data.anomalies.stuckJobs.map((job) => (
                    <tr key={job.id}>
                      <Td>{fmtTime(job.createdAt)}</Td>
                      <Td mono>{job.orderNo ?? '—'}</Td>
                      <Td>{label(ROLE_LABEL, job.role)}</Td>
                      <Td>{label(STATUS_LABEL, job.status)}</Td>
                      <Td><span style={s.pillBad}>{fmtDuration(job.ageMs)}</span></Td>
                      <Td>{job.attemptCount}</Td>
                      <Td>{job.claimAttempt}</Td>
                      <Td>{fmtTime(job.leaseExpiresAt)}</Td>
                      <Td>{fmtTime(job.nextAttemptAt)}</Td>
                      <Td>{fmtTime(job.expiresAt)}</Td>
                    </tr>
                  ))}
                </Table>
              )}
          </Section>

          {/* ⑤ 失败 */}
          <Section title="⑤ 失败（FAILED / EXPIRED，按 resultCode 分组）" tone={data.anomalies.failures.jobCount > 0 ? 'bad' : 'good'}>
            {data.anomalies.failures.groups.length === 0
              ? <div style={s.empty}>无失败任务</div>
              : (
                <Table head={['resultCode', '任务数']}>
                  {data.anomalies.failures.groups.map((group) => (
                    <tr key={group.resultCode}>
                      <Td mono>{group.resultCode}</Td>
                      <Td><span style={s.pillBad}>{group.count}</span></Td>
                    </tr>
                  ))}
                </Table>
              )}
          </Section>

          {/* ⑦ 重试与延迟 */}
          <Section title="⑦ 重试与延迟" tone={data.anomalies.retriedJobs.length > 0 ? 'warn' : 'good'}>
            <div style={s.note}>
              耗时按 createdAt → completedAt 计算，只统计已终结的任务；
              已完成 {data.anomalies.durations.completedCount} 条，
              中位 {fmtDuration(data.anomalies.durations.p50Ms)} ·
              P95 {fmtDuration(data.anomalies.durations.p95Ms)} ·
              最长 {fmtDuration(data.anomalies.durations.maxMs)}
            </div>
            <div style={s.buckets}>
              {data.anomalies.durations.buckets.map((bucket) => (
                <div key={bucket.bucket} style={s.bucket}>
                  <div style={s.bucketValue}>{bucket.count}</div>
                  <div style={s.bucketLabel}>{bucket.bucket}</div>
                </div>
              ))}
            </div>
            {data.anomalies.retriedJobs.length === 0
              ? <div style={s.empty}>无重试任务</div>
              : (
                <Table head={['创建时间', '订单号', 'role', '状态', '尝试次数', 'claim 次数', 'resultCode', '耗时']}>
                  {data.anomalies.retriedJobs.map((job) => (
                    <tr key={job.id}>
                      <Td>{fmtTime(job.createdAt)}</Td>
                      <Td mono>{job.orderNo ?? '—'}</Td>
                      <Td>{label(ROLE_LABEL, job.role)}</Td>
                      <Td>{label(STATUS_LABEL, job.status)}</Td>
                      <Td><span style={s.pillWarn}>{job.attemptCount}/{job.maxAttempts}</span></Td>
                      <Td>{job.claimAttempt}</Td>
                      <Td mono>{job.resultCode ?? '—'}</Td>
                      <Td>{fmtDuration(job.durationMs)}</Td>
                    </tr>
                  ))}
                </Table>
              )}
          </Section>

          {/* 任务明细 */}
          <Section title="任务明细" tone="neutral">
            <div style={s.controlRow}>
              {([['ALL', `全部 ${data.jobs.length}`],
                ['STUCK', `卡住 ${data.anomalies.stuckJobs.length}`],
                ['FAILED', `失败 ${data.anomalies.failures.jobCount}`],
                ['UNCERTAIN', `不确定 ${data.anomalies.uncertainJobs.length}`],
                ['RETRIED', `重试 ${data.anomalies.retriedJobs.length}`]] as Array<[Filter, string]>).map(([key, text]) => (
                <button key={key} type="button"
                  style={{ ...s.tab, ...(filter === key ? s.tabActive : null) }}
                  onClick={() => setFilter(key)}>
                  {text}
                </button>
              ))}
            </div>
            {visibleJobs.length === 0
              ? <div style={s.empty}>本时段没有符合条件的任务</div>
              : (
                <Table head={['创建时间', '订单号', 'role', '模式', '状态', 'resultCode', '效果边界', '尝试次数', '耗时', '收银员']}>
                  {visibleJobs.map((job) => {
                    const uncertain = job.effectBoundary === 'CROSSING_UNKNOWN'
                    const failed = FAILED_STATUSES.includes(job.status)
                    const stuck = stuckIds.has(job.id)
                    return (
                      <tr key={job.id} style={uncertain ? s.rowUnknown : failed ? s.rowBad : stuck ? s.rowWarn : undefined}>
                        <Td>{fmtTime(job.createdAt)}</Td>
                        <Td mono>{job.orderNo ?? '—'}</Td>
                        <Td>{label(ROLE_LABEL, job.role)}</Td>
                        <Td>{label(MODE_LABEL, job.mode)}</Td>
                        <Td>
                          {label(STATUS_LABEL, job.status)}
                          {stuck && !failed ? <span style={s.pillWarn}>滞留 {fmtDuration(job.openAgeMs)}</span> : null}
                        </Td>
                        <Td mono>{job.resultCode ?? '—'}</Td>
                        <Td>
                          <span style={uncertain ? s.pillUnknown : undefined}>
                            {label(BOUNDARY_LABEL, job.effectBoundary, '—')}
                          </span>
                        </Td>
                        <Td>{job.attemptCount}/{job.maxAttempts}</Td>
                        <Td>{fmtDuration(job.durationMs)}</Td>
                        <Td>{job.cashierName ?? '—'}</Td>
                      </tr>
                    )
                  })}
                </Table>
              )}
            <div style={s.note}>
              physicalCompletionKnown 恒为 false 属正常设计：云端只知道数据是否交给打印机，
              不知道纸是否真的出完，因此本页不把它当告警。
            </div>
          </Section>

          <section style={s.footer}>
            状态分布：{Object.entries(data.totals.byStatus).map(([key, n]) => `${label(STATUS_LABEL, key)} ${n}`).join(' · ') || '无'}
            {' ｜ '}模式分布：{Object.entries(data.totals.byMode).map(([key, n]) => `${label(MODE_LABEL, key)} ${n}`).join(' · ') || '无'}
            {' ｜ '}效果边界：{Object.entries(data.totals.byEffectBoundary).map(([key, n]) => `${label(BOUNDARY_LABEL, key)} ${n}`).join(' · ') || '无'}
            <div style={s.footerNote}>本页只读：不提供重打、改状态、取消、重置或删除。</div>
          </section>
        </main>
      )}
    </div>
  )
}

function Section({ title, tone, children }: {
  title: string
  tone: 'good' | 'bad' | 'warn' | 'unknown' | 'neutral'
  children: React.ReactNode
}) {
  return (
    <section style={{ ...s.section, borderLeft: `6px solid ${TONE_COLOR[tone]}` }}>
      <h2 style={s.sectionTitle}>{title}</h2>
      {children}
    </section>
  )
}

function Stat({ title, value, detail, tone }: {
  title: string
  value: string | number
  detail: string
  tone: 'good' | 'bad' | 'warn' | 'unknown' | 'neutral'
}) {
  return (
    <div style={{ ...s.card, borderTop: `4px solid ${TONE_COLOR[tone]}` }}>
      <div style={s.cardTitle}>{title}</div>
      <div style={{ ...s.cardValue, color: TONE_COLOR[tone] }}>{value}</div>
      <div style={s.cardDetail}>{detail}</div>
    </div>
  )
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div style={s.tableWrap}>
      <table style={s.table}>
        <thead>
          <tr>{head.map((cell) => <th key={cell} style={s.th}>{cell}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return <td style={{ ...s.td, ...(mono ? s.mono : null) }}>{children}</td>
}

const TONE_COLOR: Record<'good' | 'bad' | 'warn' | 'unknown' | 'neutral', string> = {
  good: '#166534',
  bad: '#b91c1c',
  warn: '#b45309',
  // 不确定用紫色，刻意与红色失败区分开
  unknown: '#6d28d9',
  neutral: '#334155',
}

const s: Record<string, React.CSSProperties> = {
  page: { padding: 16, background: '#f8fafc', minHeight: '100vh', color: '#0f172a', fontSize: 15, lineHeight: 1.6 },
  header: { marginBottom: 16 },
  kicker: { fontSize: 14, color: '#64748b', letterSpacing: 1 },
  title: { fontSize: 26, fontWeight: 700, margin: '4px 0' },
  subtitle: { fontSize: 14, color: '#475569' },
  controls: {
    background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12,
    padding: 12, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10,
  },
  controlRow: { display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  tab: {
    minHeight: 44, minWidth: 96, padding: '0 18px', fontSize: 16, borderRadius: 10,
    border: '1px solid #cbd5e1', background: '#fff', color: '#334155', cursor: 'pointer',
  },
  tabActive: { background: '#1d4ed8', borderColor: '#1d4ed8', color: '#fff', fontWeight: 600 },
  refreshBtn: {
    minHeight: 44, minWidth: 110, padding: '0 20px', fontSize: 16, fontWeight: 600, borderRadius: 10,
    border: '1px solid #0f172a', background: '#0f172a', color: '#fff', cursor: 'pointer', marginLeft: 'auto',
  },
  fieldLabel: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, color: '#334155' },
  input: {
    minHeight: 44, minWidth: 150, padding: '0 12px', fontSize: 16,
    border: '1px solid #cbd5e1', borderRadius: 10, background: '#fff', color: '#0f172a',
  },
  meta: { fontSize: 14, color: '#64748b' },
  center: { padding: 32, textAlign: 'center', fontSize: 16, color: '#475569' },
  errorBox: {
    padding: 14, borderRadius: 10, background: '#fee2e2', border: '1px solid #fca5a5',
    color: '#991b1b', fontSize: 15, marginBottom: 16,
  },
  main: { display: 'flex', flexDirection: 'column', gap: 16 },
  band: { borderRadius: 12, padding: 14, border: '1px solid' },
  bandOk: { background: '#dcfce7', borderColor: '#86efac' },
  bandAlert: { background: '#fef3c7', borderColor: '#fcd34d' },
  bandTitle: { fontSize: 19, fontWeight: 700 },
  bandSub: { fontSize: 14, color: '#334155', marginTop: 4 },
  cards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 },
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 12 },
  cardTitle: { fontSize: 14, color: '#475569' },
  cardValue: { fontSize: 24, fontWeight: 700, margin: '4px 0' },
  cardDetail: { fontSize: 14, color: '#64748b', wordBreak: 'break-word' },
  section: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 14 },
  sectionTitle: { fontSize: 18, fontWeight: 700, margin: '0 0 10px' },
  subheading: { fontSize: 15, fontWeight: 600, margin: '14px 0 8px', color: '#475569' },
  note: { fontSize: 14, color: '#475569', margin: '8px 0' },
  noteUnknown: {
    fontSize: 15, color: '#4c1d95', background: '#f5f3ff', border: '1px solid #ddd6fe',
    borderRadius: 10, padding: 12, margin: '0 0 10px',
  },
  empty: { fontSize: 15, color: '#64748b', padding: '10px 0' },
  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  th: {
    textAlign: 'left', padding: '10px 10px', borderBottom: '2px solid #e2e8f0',
    fontSize: 14, color: '#475569', whiteSpace: 'nowrap',
  },
  td: { padding: '10px 10px', borderBottom: '1px solid #f1f5f9', fontSize: 14, verticalAlign: 'top' },
  mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', wordBreak: 'break-all' },
  rowBad: { background: '#fef2f2' },
  rowWarn: { background: '#fffbeb' },
  rowUnknown: { background: '#f5f3ff' },
  pillBad: {
    display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 14,
    background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5',
  },
  pillWarn: {
    display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 14,
    background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d', marginLeft: 6,
  },
  pillUnknown: {
    display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 14,
    background: '#ede9fe', color: '#5b21b6', border: '1px solid #c4b5fd', fontWeight: 600,
  },
  buckets: { display: 'flex', flexWrap: 'wrap', gap: 10, margin: '10px 0' },
  bucket: {
    minWidth: 92, padding: '10px 12px', borderRadius: 10,
    background: '#f1f5f9', border: '1px solid #e2e8f0', textAlign: 'center',
  },
  bucketValue: { fontSize: 20, fontWeight: 700, color: '#0f172a' },
  bucketLabel: { fontSize: 14, color: '#64748b' },
  footer: { fontSize: 14, color: '#475569', padding: '4px 2px 24px' },
  footerNote: { marginTop: 6, color: '#64748b' },
}
