'use client'

import { useEffect, useMemo, useState } from 'react'

type RunStatus =
  | 'NORMAL'
  | 'BINDING_INCOMPLETE'
  | 'OPENED_UNUSED'
  | 'INACTIVE_RECENTLY'
  | 'NEEDS_ATTENTION'

type OverviewTenant = {
  tenantId: string
  tenantName: string
  tenantStatus: string
  createdAt: string
  storeCount: number
  storeNames: string[]
  storeCodes: string[]
  ownerBound: boolean
  hasEffectiveOwner: boolean
  staffCount: number
  lastSaleAt: string | null
  lastCustomerOrderAt: string | null
  lastActivityAt: string | null
  offlinePendingCount: number
  currencies: string[]
  runStatus: RunStatus
}

type OverviewSummary = {
  tenantCount: number
  storeCount: number
  ownerBoundTenantCount: number
  noEffectiveOwnerTenantCount: number
  activeTenantCount7d: number
  inactiveNoRecentBusinessTenantCount7d: number
  offlinePendingTenantCount: number
  offlinePendingStoreCount: number
  needsAttentionTenantCount: number
}

type OverviewResponse = {
  generatedAt: string
  since: string
  summary: OverviewSummary
  tenants: OverviewTenant[]
}

type StatusFilter = 'ALL' | RunStatus

const STATUS_META: Record<RunStatus, { label: string; tone: 'good' | 'warn' | 'idle' | 'bad' }> = {
  NORMAL: { label: '正常运行', tone: 'good' },
  BINDING_INCOMPLETE: { label: '未完成绑定', tone: 'bad' },
  OPENED_UNUSED: { label: '已开通未使用', tone: 'idle' },
  INACTIVE_RECENTLY: { label: '近期不活跃', tone: 'warn' },
  NEEDS_ATTENTION: { label: '需要关注', tone: 'bad' },
}

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'ALL', label: '全部' },
  { key: 'NORMAL', label: '正常运行' },
  { key: 'BINDING_INCOMPLETE', label: '未完成绑定' },
  { key: 'OPENED_UNUSED', label: '已开通未使用' },
  { key: 'INACTIVE_RECENTLY', label: '近期不活跃' },
  { key: 'NEEDS_ATTENTION', label: '需要关注' },
]

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

function fmtDate(value: string) {
  return new Date(value).toLocaleDateString('zh-CN', {
    timeZone: 'Asia/Phnom_Penh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

function compact(values: string[], max = 3) {
  if (values.length === 0) return '无'
  const shown = values.slice(0, max).join(' / ')
  return values.length > max ? `${shown} 等 ${values.length} 个` : shown
}

export default function OpsOverviewPage() {
  const [data, setData] = useState<OverviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')

  useEffect(() => {
    let cancelled = false
    fetch('/api/ops/overview', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.error === 'FORBIDDEN' ? '无权限访问运营观察页' : '加载失败')
        }
        return res.json() as Promise<OverviewResponse>
      })
      .then((body) => {
        if (!cancelled) setData(body)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || '加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const filteredTenants = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return (data?.tenants ?? []).filter((tenant) => {
      if (statusFilter !== 'ALL' && tenant.runStatus !== statusFilter) return false
      if (!keyword) return true
      const haystack = [
        tenant.tenantName,
        ...tenant.storeNames,
        ...tenant.storeCodes,
      ].join(' ').toLowerCase()
      return haystack.includes(keyword)
    })
  }, [data?.tenants, query, statusFilter])

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <div style={s.kicker}>Ops Visibility Foundation V1</div>
          <h1 style={s.title}>运营观察台</h1>
          <div style={s.subtitle}>只读查看商户基础运行状态，不进入商户身份，不触发任何写操作。</div>
        </div>
        <div style={s.readonlyBadge}>GET only</div>
      </div>

      {loading && (
        <div style={s.center}>加载中...</div>
      )}

      {!loading && error && (
        <div style={s.errorBox}>{error}</div>
      )}

      {!loading && data && (
        <main style={s.main}>
          <section style={s.summaryGrid}>
            <Metric label="商户总数" value={data.summary.tenantCount} />
            <Metric label="门店总数" value={data.summary.storeCount} />
            <Metric label="已绑定 OWNER 商户" value={data.summary.ownerBoundTenantCount} />
            <Metric label="无有效 OWNER 商户" value={data.summary.noEffectiveOwnerTenantCount} tone="bad" />
            <Metric label="最近 7 天活跃商户" value={data.summary.activeTenantCount7d} tone="good" />
            <Metric label="7 天无销售和顾客订单" value={data.summary.inactiveNoRecentBusinessTenantCount7d} tone="warn" />
            <Metric label="离线待同步商户/门店" value={`${data.summary.offlinePendingTenantCount}/${data.summary.offlinePendingStoreCount}`} tone="warn" />
            <Metric label="需要关注商户" value={data.summary.needsAttentionTenantCount} tone="bad" />
          </section>

          <section style={s.notice}>
            离线待同步仅统计已经到达服务端的 OfflineSaleSyncMap PENDING 记录，不代表收银客户端中所有尚未上传的离线订单。
          </section>

          <section style={s.toolbar}>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索商户、门店或 storeCode"
              style={s.search}
            />
            <div style={s.filters}>
              {FILTERS.map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => setStatusFilter(filter.key)}
                  style={{
                    ...s.filterBtn,
                    ...(statusFilter === filter.key ? s.filterBtnActive : {}),
                  }}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </section>

          <section style={s.listHeader}>
            <span>商户列表</span>
            <span style={s.muted}>当前显示 {filteredTenants.length} / {data.tenants.length}</span>
          </section>

          <section style={s.list}>
            {filteredTenants.length === 0 ? (
              <div style={s.empty}>没有符合条件的商户</div>
            ) : filteredTenants.map((tenant) => (
              <TenantRow key={tenant.tenantId} tenant={tenant} />
            ))}
          </section>
        </main>
      )}
    </div>
  )
}

function Metric({ label, value, tone = 'neutral' }: { label: string; value: number | string; tone?: 'neutral' | 'good' | 'warn' | 'bad' }) {
  const color = {
    neutral: '#1f2937',
    good: '#166534',
    warn: '#92400e',
    bad: '#991b1b',
  }[tone]
  return (
    <div style={s.metric}>
      <div style={{ ...s.metricValue, color }}>{value}</div>
      <div style={s.metricLabel}>{label}</div>
    </div>
  )
}

function TenantRow({ tenant }: { tenant: OverviewTenant }) {
  const meta = STATUS_META[tenant.runStatus]
  return (
    <article style={s.row}>
      <div style={s.rowTop}>
        <div style={s.tenantBlock}>
          <div style={s.tenantName}>{tenant.tenantName}</div>
          <div style={s.tenantMeta}>
            <span>{tenant.tenantStatus}</span>
            <span>创建 {fmtDate(tenant.createdAt)}</span>
            <span>{tenant.storeCount} 家门店</span>
          </div>
        </div>
        <span style={{ ...s.statusBadge, ...badgeStyle(meta.tone) }}>{meta.label}</span>
      </div>

      <div style={s.infoGrid}>
        <Info label="门店" value={compact(tenant.storeNames)} />
        <Info label="storeCode" value={compact(tenant.storeCodes)} mono />
        <Info label="OWNER" value={tenant.hasEffectiveOwner ? (tenant.ownerBound ? '已绑定' : '有效但未绑定 Telegram') : '无有效 OWNER'} tone={tenant.ownerBound ? 'good' : 'bad'} />
        <Info label="STAFF" value={`${tenant.staffCount} 人`} />
        <Info label="最近销售" value={fmtTime(tenant.lastSaleAt)} />
        <Info label="最近顾客订单" value={fmtTime(tenant.lastCustomerOrderAt)} />
        <Info label="最近业务活动" value={fmtTime(tenant.lastActivityAt)} />
        <Info label="离线待同步" value={`${tenant.offlinePendingCount} 条`} tone={tenant.offlinePendingCount > 0 ? 'bad' : 'good'} />
        <Info label="货币" value={tenant.currencies.length > 0 ? tenant.currencies.join(' / ') : '无'} />
      </div>
    </article>
  )
}

function Info({ label, value, mono = false, tone = 'neutral' }: { label: string; value: string; mono?: boolean; tone?: 'neutral' | 'good' | 'bad' }) {
  const color = tone === 'good' ? '#166534' : tone === 'bad' ? '#991b1b' : '#111827'
  return (
    <div style={s.info}>
      <div style={s.infoLabel}>{label}</div>
      <div style={{ ...s.infoValue, color, fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' : undefined }}>{value}</div>
    </div>
  )
}

function badgeStyle(tone: 'good' | 'warn' | 'idle' | 'bad'): React.CSSProperties {
  return {
    good: { color: '#166534', background: '#dcfce7', borderColor: '#86efac' },
    warn: { color: '#92400e', background: '#fef3c7', borderColor: '#fcd34d' },
    idle: { color: '#374151', background: '#f3f4f6', borderColor: '#d1d5db' },
    bad: { color: '#991b1b', background: '#fee2e2', borderColor: '#fca5a5' },
  }[tone]
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
  kicker: { fontSize: 12, fontWeight: 800, color: '#2563eb', marginBottom: 6 },
  title: { fontSize: 24, lineHeight: 1.2, margin: 0, letterSpacing: 0 },
  subtitle: { fontSize: 13, color: '#6b7280', marginTop: 8, maxWidth: 680 },
  readonlyBadge: {
    border: '1px solid #bfdbfe',
    background: '#eff6ff',
    color: '#1d4ed8',
    borderRadius: 8,
    padding: '6px 10px',
    fontSize: 12,
    fontWeight: 800,
    whiteSpace: 'nowrap',
  },
  main: { maxWidth: 1180, margin: '0 auto', padding: '18px 14px 48px' },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: 10,
  },
  metric: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 14,
    minHeight: 78,
  },
  metricValue: { fontSize: 24, fontWeight: 900, lineHeight: 1 },
  metricLabel: { fontSize: 12, color: '#6b7280', marginTop: 10 },
  notice: {
    marginTop: 12,
    background: '#fff7ed',
    border: '1px solid #fed7aa',
    color: '#9a3412',
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: 12,
  },
  toolbar: {
    marginTop: 14,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  search: {
    height: 38,
    minWidth: 240,
    flex: '1 1 260px',
    border: '1px solid #d1d5db',
    borderRadius: 8,
    padding: '0 12px',
    fontSize: 14,
    background: '#fff',
    outline: 'none',
  },
  filters: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  filterBtn: {
    height: 32,
    padding: '0 11px',
    border: '1px solid #d1d5db',
    borderRadius: 8,
    background: '#fff',
    color: '#4b5563',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
  },
  filterBtnActive: { borderColor: '#2563eb', background: '#eff6ff', color: '#1d4ed8' },
  listHeader: {
    marginTop: 18,
    marginBottom: 8,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 14,
    fontWeight: 900,
  },
  muted: { color: '#6b7280', fontSize: 12, fontWeight: 500 },
  list: { display: 'flex', flexDirection: 'column', gap: 10 },
  row: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 14,
  },
  rowTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  tenantBlock: { minWidth: 0 },
  tenantName: { fontSize: 16, fontWeight: 900, color: '#111827', wordBreak: 'break-word' },
  tenantMeta: { display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12, color: '#6b7280', marginTop: 5 },
  statusBadge: {
    flexShrink: 0,
    border: '1px solid',
    borderRadius: 999,
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: 'nowrap',
  },
  infoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: 8,
  },
  info: { background: '#f9fafb', borderRadius: 8, padding: '9px 10px', minWidth: 0 },
  infoLabel: { fontSize: 11, color: '#6b7280', marginBottom: 5 },
  infoValue: { fontSize: 13, fontWeight: 800, wordBreak: 'break-word' },
  center: { padding: 40, textAlign: 'center', color: '#6b7280' },
  errorBox: {
    maxWidth: 520,
    margin: '30px auto',
    background: '#fee2e2',
    border: '1px solid #fca5a5',
    color: '#991b1b',
    borderRadius: 8,
    padding: 14,
    fontSize: 14,
  },
  empty: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 24,
    textAlign: 'center',
    color: '#6b7280',
  },
}
