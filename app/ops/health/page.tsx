'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

type CapabilityStatus = 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE'
type HealthStatus = 'OK' | 'WARN' | 'ISSUE' | 'UNAVAILABLE'

type Capability = {
  status: CapabilityStatus
  label: string
  reason: string
}

type AttentionItem = {
  tenantId: string
  tenantName: string
  storeId: string | null
  storeName: string | null
  storeCode: string | null
  issueType: string
  issueLabel: string
  count: number
  firstSeenAt: string | null
  lastSeenAt: string | null
  coverageLevel: CapabilityStatus
}

type HealthResponse = {
  generatedAt: string
  windows: {
    businessSince: string
    activeSince: string
    khqrStaleThresholdMinutes: number
  }
  agingPolicy: {
    currentHours: number
    historicalDays: number
    archivedDays: number
    cloudPrintPausedAt: string
    note: string
  }
  queryDurationMs: number
  system: {
    database: {
      status: HealthStatus
      latencyMs: number
      error: string | null
    }
    api500: Capability
  }
  business: {
    posSales: {
      success: { status: CapabilityStatus; orderCount: number; tenantCount: number; storeCount: number }
      failure: Capability
    }
    customerOrders: {
      submitted: { status: CapabilityStatus; orderCount: number; tenantCount: number; storeCount: number }
      paidCompleted: { status: CapabilityStatus; orderCount: number; tenantCount: number; storeCount: number }
      failure: Capability
    }
    khqr: {
      status: CapabilityStatus
      pendingCount: number
      pendingCreated24hCount: number
      stalePendingCount: number
      tenantCount: number
      storeCount: number
      earliestPendingAt: string | null
    }
    offlineSync: {
      status: CapabilityStatus
      pendingCount: number
      failedCount: number
      synced24hCount: number
      tenantCount: number
      storeCount: number
      earliestPendingAt: string | null
      latestFailedAt: string | null
      coverageNote: string
    }
    cloudPrint: {
      status: CapabilityStatus
      triggerSuccessCount: number
      triggerFailedCount: number
      triggerSkippedCount: number
      tenantCount: number
      storeCount: number
      latestFailedAt: string | null
      coverageNote: string
    }
    posAuthorization: {
      status: CapabilityStatus
      success24hCount: number
      pendingCount: number
      expiredCount: number
      tenantCount: number
      storeCount: number
      coverageNote: string
    }
  }
  merchantImpact: {
    activeTenantCount7d: number
    needsAttentionTenantCount: number
    identifiableAffectedTenantCount: number
    identifiableAffectedStoreCount: number
    noEffectiveOwnerTenantCount: number
    coverageNote: string
  }
  capabilityNotes: {
    available: Capability[]
    partial: Capability[]
    unavailable: Capability[]
  }
  issueBuckets: {
    current: AttentionItem[]
    recent: AttentionItem[]
    persistent: AttentionItem[]
    historical: AttentionItem[]
    archived: AttentionItem[]
  }
  issueCounts: {
    current: number
    recent: number
    persistent: number
    historical: number
    archived: number
  }
  attentionItems: AttentionItem[]
}

const STATUS_LABEL: Record<CapabilityStatus, string> = {
  AVAILABLE: '可直接统计',
  PARTIAL: '部分覆盖',
  UNAVAILABLE: '暂不可可靠统计',
}

function fmtTime(value: string | null) {
  if (!value) return '无记录'
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Phnom_Penh',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function fmtDateTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Phnom_Penh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusStyle(status: CapabilityStatus): React.CSSProperties {
  return {
    AVAILABLE: { color: '#166534', background: '#dcfce7', borderColor: '#86efac' },
    PARTIAL: { color: '#92400e', background: '#fef3c7', borderColor: '#fcd34d' },
    UNAVAILABLE: { color: '#991b1b', background: '#fee2e2', borderColor: '#fca5a5' },
  }[status]
}

export default function OpsHealthPage() {
  const [data, setData] = useState<HealthResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [showHistorical, setShowHistorical] = useState(false)
  const [showArchived, setShowArchived] = useState(false)

  function load(isRefresh = false) {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError('')
    fetch('/api/ops/health', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.error === 'FORBIDDEN' ? '无权限访问运行健康页' : '加载失败')
        }
        return res.json() as Promise<HealthResponse>
      })
      .then(setData)
      .catch((err: Error) => setError(err.message || '加载失败'))
      .finally(() => {
        setLoading(false)
        setRefreshing(false)
      })
  }

  useEffect(() => { load() }, [])

  const hasIssue = useMemo(() => {
    if (!data) return false
    return data.issueCounts.current > 0 || data.issueCounts.persistent > 0
  }, [data])

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div>
          <Link href="/ops" style={s.backLink}>← 返回运营后台</Link>
          <div style={s.kicker}>Ops Runtime Health V1</div>
          <h1 style={s.title}>运行健康</h1>
          <div style={s.subtitle}>查看平台核心业务链路和当前可识别异常</div>
          <div style={s.navLinks}>
            <Link href="/ops/overview" style={s.navLink}>查看运行概览</Link>
            <Link href="/system" style={s.navLink}>查看基础系统自检</Link>
          </div>
        </div>
        <button type="button" style={s.refreshBtn} onClick={() => load(true)} disabled={loading || refreshing}>
          {refreshing ? '刷新中...' : '刷新'}
        </button>
      </header>

      {loading && <div style={s.center}>加载中...</div>}
      {!loading && error && <div style={s.errorBox}>{error}</div>}

      {!loading && data && (
        <main style={s.main}>
          <section style={s.statusBand}>
            <div>
              <div style={s.bandTitle}>{hasIssue ? '存在可识别异常积压' : '当前未发现可识别异常积压'}</div>
              <div style={s.bandSub}>
                生成时间 {fmtDateTime(data.generatedAt)} · API 查询耗时 {data.queryDurationMs}ms · 业务窗口最近 24 小时
              </div>
            </div>
            <span style={{ ...s.statusPill, ...(hasIssue ? statusStyle('PARTIAL') : statusStyle('AVAILABLE')) }}>
              {hasIssue ? '需要关注' : '运行可见'}
            </span>
          </section>

          <Section title="系统运行">
            <div style={s.grid}>
              <Metric title="数据库连接" value={data.system.database.status === 'OK' ? '可用' : '不可用'} detail={`本次检查 ${data.system.database.latencyMs}ms`} tone={data.system.database.status === 'OK' ? 'good' : 'bad'} />
              <Metric title="检查生成时间" value={fmtTime(data.generatedAt)} detail="实时检查，不写历史健康记录" />
              <CapabilityCard capability={data.system.api500} />
            </div>
          </Section>

          <Section title="业务运行">
            <div style={s.grid}>
              <Metric title="POS 成功销售" value={data.business.posSales.success.orderCount} detail={`${data.business.posSales.success.tenantCount} 商户 · ${data.business.posSales.success.storeCount} 门店 · 按订单去重`} tone="good" />
              <CapabilityCard capability={data.business.posSales.failure} />
              <Metric title="顾客订单提交成功" value={data.business.customerOrders.submitted.orderCount} detail={`${data.business.customerOrders.submitted.tenantCount} 商户 · ${data.business.customerOrders.submitted.storeCount} 门店`} tone="good" />
              <Metric title="顾客订单已付款完成" value={data.business.customerOrders.paidCompleted.orderCount} detail={`${data.business.customerOrders.paidCompleted.tenantCount} 商户 · ${data.business.customerOrders.paidCompleted.storeCount} 门店`} tone="good" />
              <CapabilityCard capability={data.business.customerOrders.failure} />
              <Metric title="KHQR PENDING" value={data.business.khqr.pendingCount} detail={`24h 新建 ${data.business.khqr.pendingCreated24hCount} · 超 ${data.windows.khqrStaleThresholdMinutes} 分钟 ${data.business.khqr.stalePendingCount} · 最早 ${fmtTime(data.business.khqr.earliestPendingAt)}`} tone={data.business.khqr.stalePendingCount > 0 ? 'bad' : 'neutral'} />
              <Metric title="离线同步" value={`${data.business.offlineSync.pendingCount}/${data.business.offlineSync.failedCount}`} detail={`PENDING/FAILED · 24h SYNCED ${data.business.offlineSync.synced24hCount}`} tone={data.business.offlineSync.pendingCount + data.business.offlineSync.failedCount > 0 ? 'bad' : 'good'} />
              <Metric title="云打印触发" value={`${data.business.cloudPrint.triggerSuccessCount}/${data.business.cloudPrint.triggerFailedCount}`} detail={`SUCCESS/FAILED · SKIPPED ${data.business.cloudPrint.triggerSkippedCount} · 最近失败 ${fmtTime(data.business.cloudPrint.latestFailedAt)}`} tone={data.business.cloudPrint.triggerFailedCount > 0 ? 'bad' : 'good'} />
              <Metric title="POS 授权" value={`${data.business.posAuthorization.success24hCount}/${data.business.posAuthorization.pendingCount}/${data.business.posAuthorization.expiredCount}`} detail="24h 成功 / 当前待授权 / 当前过期" tone={data.business.posAuthorization.pendingCount + data.business.posAuthorization.expiredCount > 0 ? 'warn' : 'good'} />
            </div>
            <div style={s.note}>{data.business.offlineSync.coverageNote}</div>
            <div style={s.note}>{data.business.cloudPrint.coverageNote}</div>
          </Section>

          <Section title="商户影响">
            <div style={s.grid}>
              <Metric title="最近 7 天活跃商户" value={data.merchantImpact.activeTenantCount7d} detail="SaleRecord 或 CustomerOrder 有活动" tone="good" />
              <Metric title="需要关注商户" value={data.merchantImpact.needsAttentionTenantCount} detail={`无有效 OWNER ${data.merchantImpact.noEffectiveOwnerTenantCount} 个`} tone={data.merchantImpact.needsAttentionTenantCount > 0 ? 'bad' : 'good'} />
              <Metric title="可识别受影响商户" value={data.merchantImpact.identifiableAffectedTenantCount} detail={`${data.merchantImpact.identifiableAffectedStoreCount} 个门店`} tone={data.merchantImpact.identifiableAffectedTenantCount > 0 ? 'warn' : 'good'} />
            </div>
            <div style={s.note}>{data.merchantImpact.coverageNote}</div>
          </Section>

          <Section title="当前需要关注">
            {data.attentionItems.length === 0 ? (
              <div style={s.empty}>当前没有基于已有日志和状态记录识别出的关注项</div>
            ) : (
              <IssueList items={data.attentionItems} />
            )}
            <div style={s.note}>当前区只包含 current + persistent；历史异常和封存噪音不再长期占用当前运营注意力。</div>
          </Section>

          <Section title={`最近 24 小时新异常（${data.issueCounts.recent}）`}>
            <IssueList items={data.issueBuckets.recent} emptyText="最近 24 小时没有新的可识别异常" />
          </Section>

          <Section title={`历史异常（${data.issueCounts.historical}）`}>
            <button type="button" style={s.toggleBtn} onClick={() => setShowHistorical((value) => !value)}>
              {showHistorical ? '收起历史异常' : '查看历史异常'}
            </button>
            <div style={s.archiveHint}>超过 {data.agingPolicy.historicalDays} 天且最近没有复发；保留审计价值，不代表已自动修复。</div>
            {showHistorical && <IssueList items={data.issueBuckets.historical} emptyText="暂无历史异常" />}
          </Section>

          <Section title={`已封存噪音（${data.issueCounts.archived}）`}>
            <button type="button" style={s.toggleBtn} onClick={() => setShowArchived((value) => !value)}>
              {showArchived ? '收起封存噪音' : '查看封存噪音'}
            </button>
            <div style={s.archiveHint}>不删除原始记录。云打印暂停前的旧失败、超过 {data.agingPolicy.archivedDays} 天且未复发的问题默认封存。</div>
            {showArchived && (
              <>
                <div style={s.note}>历史离线失败未被删除，只是不再长期占用当前运营注意力。</div>
                <IssueList items={data.issueBuckets.archived} emptyText="暂无已封存噪音" />
              </>
            )}
          </Section>

          <Section title="统计能力说明">
            <div style={s.note}>{data.agingPolicy.note}</div>
            <CapabilityGroup title="可直接统计" items={data.capabilityNotes.available} />
            <CapabilityGroup title="部分覆盖" items={data.capabilityNotes.partial} />
            <CapabilityGroup title="暂不可可靠统计" items={data.capabilityNotes.unavailable} />
          </Section>
        </main>
      )}
    </div>
  )
}

function IssueList({ items, emptyText = '暂无记录' }: { items: AttentionItem[]; emptyText?: string }) {
  if (items.length === 0) {
    return <div style={s.empty}>{emptyText}</div>
  }
  return (
    <div style={s.issueList}>
      {items.map((item) => (
        <article key={`${item.issueType}-${item.tenantId}-${item.storeId ?? 'tenant'}-${item.firstSeenAt ?? 'first'}-${item.lastSeenAt ?? 'last'}`} style={s.issueCard}>
          <div style={s.issueTop}>
            <div>
              <div style={s.issueTitle}>{item.issueLabel}</div>
              <div style={s.issueMeta}>{item.tenantName} · {item.storeName ?? '租户级'} · {item.storeCode ?? '无 storeCode'}</div>
            </div>
            <span style={{ ...s.statusPill, ...statusStyle(item.coverageLevel) }}>{STATUS_LABEL[item.coverageLevel]}</span>
          </div>
          <div style={s.issueStats}>
            <span>数量 {item.count}</span>
            <span>首次 {fmtTime(item.firstSeenAt)}</span>
            <span>最近 {fmtTime(item.lastSeenAt)}</span>
          </div>
        </article>
      ))}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={s.section}>
      <h2 style={s.sectionTitle}>{title}</h2>
      {children}
    </section>
  )
}

function Metric({ title, value, detail, tone = 'neutral' }: { title: string; value: string | number; detail: string; tone?: 'neutral' | 'good' | 'warn' | 'bad' }) {
  const color = {
    neutral: '#111827',
    good: '#166534',
    warn: '#92400e',
    bad: '#991b1b',
  }[tone]
  return (
    <div style={s.card}>
      <div style={s.cardTitle}>{title}</div>
      <div style={{ ...s.metricValue, color }}>{value}</div>
      <div style={s.cardDetail}>{detail}</div>
    </div>
  )
}

function CapabilityCard({ capability }: { capability: Capability }) {
  return (
    <div style={s.card}>
      <div style={s.capRow}>
        <div style={s.cardTitle}>{capability.label}</div>
        <span style={{ ...s.statusPill, ...statusStyle(capability.status) }}>{STATUS_LABEL[capability.status]}</span>
      </div>
      <div style={s.cardDetailStrong}>{capability.reason}</div>
    </div>
  )
}

function CapabilityGroup({ title, items }: { title: string; items: Capability[] }) {
  return (
    <div style={s.capGroup}>
      <div style={s.capGroupTitle}>{title}</div>
      <div style={s.capList}>
        {items.map((item) => (
          <CapabilityCard key={`${item.status}-${item.label}`} capability={item} />
        ))}
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f6f7f9', color: '#111827' },
  header: {
    padding: '24px 18px 18px',
    background: '#ffffff',
    borderBottom: '1px solid #e5e7eb',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  backLink: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 36,
    padding: '0 10px',
    marginBottom: 10,
    border: '1px solid #d1d5db',
    borderRadius: 8,
    color: '#374151',
    background: '#f9fafb',
    fontSize: 13,
    fontWeight: 800,
    textDecoration: 'none',
  },
  kicker: { fontSize: 12, fontWeight: 800, color: '#2563eb', marginBottom: 6 },
  title: { fontSize: 24, lineHeight: 1.2, margin: 0, letterSpacing: 0 },
  subtitle: { fontSize: 13, color: '#6b7280', marginTop: 8, maxWidth: 680 },
  navLinks: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 },
  navLink: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 32,
    padding: '0 10px',
    border: '1px solid #dbeafe',
    borderRadius: 8,
    color: '#1d4ed8',
    background: '#eff6ff',
    textDecoration: 'none',
    fontSize: 12,
    fontWeight: 800,
  },
  refreshBtn: {
    border: '1px solid #bfdbfe',
    background: '#2563eb',
    color: '#fff',
    borderRadius: 8,
    padding: '9px 14px',
    fontSize: 13,
    fontWeight: 900,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  main: { maxWidth: 1180, margin: '0 auto', padding: '18px 14px 48px' },
  center: { padding: 32, textAlign: 'center', color: '#6b7280' },
  errorBox: {
    margin: 16,
    padding: 14,
    border: '1px solid #fecaca',
    borderRadius: 8,
    background: '#fef2f2',
    color: '#991b1b',
  },
  statusBand: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 16,
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'center',
    marginBottom: 14,
  },
  bandTitle: { fontSize: 18, fontWeight: 900 },
  bandSub: { fontSize: 12, color: '#6b7280', marginTop: 6 },
  statusPill: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 26,
    padding: '0 8px',
    border: '1px solid',
    borderRadius: 8,
    fontSize: 11,
    fontWeight: 900,
    whiteSpace: 'nowrap',
  },
  section: { marginTop: 18 },
  sectionTitle: { margin: '0 0 10px', fontSize: 16, fontWeight: 900 },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
    gap: 10,
  },
  card: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 14,
    minHeight: 96,
  },
  cardTitle: { fontSize: 12, fontWeight: 900, color: '#374151' },
  metricValue: { fontSize: 26, fontWeight: 950, lineHeight: 1, marginTop: 12 },
  cardDetail: { fontSize: 12, color: '#6b7280', marginTop: 10, lineHeight: 1.45 },
  cardDetailStrong: { fontSize: 13, color: '#374151', marginTop: 14, lineHeight: 1.5 },
  capRow: { display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' },
  note: {
    marginTop: 10,
    border: '1px solid #fed7aa',
    background: '#fff7ed',
    color: '#9a3412',
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: 12,
    lineHeight: 1.5,
  },
  capGroup: { marginTop: 12 },
  capGroupTitle: { fontSize: 13, fontWeight: 900, color: '#374151', marginBottom: 8 },
  capList: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: 10,
  },
  empty: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 18,
    color: '#6b7280',
    textAlign: 'center',
  },
  issueList: { display: 'flex', flexDirection: 'column', gap: 10 },
  issueCard: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 14,
  },
  issueTop: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' },
  issueTitle: { fontSize: 14, fontWeight: 900 },
  issueMeta: { fontSize: 12, color: '#6b7280', marginTop: 5 },
  issueStats: { display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12, color: '#374151', marginTop: 12 },
  toggleBtn: {
    border: '1px solid #dbeafe',
    background: '#eff6ff',
    color: '#1d4ed8',
    borderRadius: 8,
    minHeight: 34,
    padding: '0 12px',
    fontSize: 12,
    fontWeight: 900,
    cursor: 'pointer',
  },
  archiveHint: {
    margin: '8px 0 10px',
    fontSize: 12,
    color: '#6b7280',
    lineHeight: 1.5,
  },
}
