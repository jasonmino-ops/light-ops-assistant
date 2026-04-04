'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { apiFetch, OWNER_CTX } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

type TenantRow = {
  id: string
  name: string
  status: string
  tier: string
  createdAt: string
  storeCount: number
  ownerBound: number
  ownerTotal: number
  staffBound: number
  staffTotal: number
  todaySaleCount: number
  lastActiveAt: string | null
}

const TIER_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  LITE:        { label: '轻试用版',     color: '#389e0d', bg: '#f6ffed', border: '#b7eb8f' },
  STANDARD:    { label: '标准收银版',   color: '#1677ff', bg: '#e6f4ff', border: '#91caff' },
  MULTI_STORE: { label: '门店标准化版', color: '#722ed1', bg: '#f9f0ff', border: '#d3adf7' },
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type StatusFilter = 'ACTIVE' | 'ARCHIVED' | 'all'

export default function OpsPage() {
  const [authState, setAuthState] = useState<'checking' | 'ok' | 'denied'>('checking')
  const [tenants, setTenants] = useState<TenantRow[]>([])
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ACTIVE')
  const [opsRole, setOpsRole] = useState<string>('')

  // ── Auth check ─────────────────────────────────────────────────────────────
  useEffect(() => {
    apiFetch('/api/ops/check', undefined, OWNER_CTX)
      .then(async (r) => {
        if (r.ok) {
          const data = await r.json()
          setOpsRole(data.opsRole ?? '')
          setAuthState('ok')
        } else {
          setAuthState('denied')
        }
      })
      .catch(() => setAuthState('denied'))
  }, [])

  // ── Load tenants ───────────────────────────────────────────────────────────
  async function loadTenants(filter: StatusFilter = statusFilter) {
    setLoading(true)
    try {
      const url = filter === 'ACTIVE' ? '/api/ops/tenants' : `/api/ops/tenants?status=${filter}`
      const r = await apiFetch(url, undefined, OWNER_CTX)
      if (r.ok) setTenants(await r.json())
    } finally {
      setLoading(false)
    }
  }

  function applyFilter(f: StatusFilter) {
    setStatusFilter(f)
    loadTenants(f)
  }

  useEffect(() => {
    if (authState === 'ok') loadTenants()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState])

  // ─── Render: checking / denied ─────────────────────────────────────────────
  if (authState === 'checking') {
    return (
      <div style={s.center}>
        <div style={s.spinner} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    )
  }
  if (authState === 'denied') {
    return (
      <div style={s.center}>
        <div style={{ fontSize: 40 }}>⛔</div>
        <p style={{ color: '#ff4d4f', fontWeight: 600 }}>无权限访问内部后台</p>
        <Link href="/dashboard" style={s.backLink}>← 返回概览</Link>
      </div>
    )
  }

  // ─── Render: main ──────────────────────────────────────────────────────────
  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <div style={s.headerTitle}>🔧 内部运营后台</div>
          <div style={s.headerSub}>{tenants.length} 个商户</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {opsRole === 'SUPER_ADMIN' && (
            <Link href="/ops/admins" style={s.sysLink}>管理员</Link>
          )}
          <Link href="/system" style={s.sysLink}>系统自检</Link>
          <button style={s.createBtn} onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? '取消' : '+ 新增商户'}
          </button>
        </div>
      </div>

      <div style={s.body}>

        {/* ── Status filter tabs ── */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {([
            { key: 'ACTIVE',   label: '运营中' },
            { key: 'ARCHIVED', label: '已归档' },
            { key: 'all',      label: '全部' },
          ] as { key: StatusFilter; label: string }[]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => applyFilter(key)}
              style={{
                height: 30, padding: '0 14px', fontSize: 12, fontWeight: statusFilter === key ? 700 : 400,
                border: `1.5px solid ${statusFilter === key ? '#1677ff' : '#e8e8e8'}`,
                borderRadius: 20, cursor: 'pointer',
                background: statusFilter === key ? '#e6f4ff' : '#fff',
                color: statusFilter === key ? '#1677ff' : '#888',
              }}
            >{label}</button>
          ))}
        </div>

        {/* ── Create form ── */}
        {showCreate && (
          <CreateForm
            onCreated={(id) => { setShowCreate(false); loadTenants(); window.location.href = `/ops/${id}` }}
            onCancel={() => setShowCreate(false)}
          />
        )}

        {/* ── Tenant list ── */}
        {loading && tenants.length === 0 ? (
          <div style={s.emptyHint}>加载中…</div>
        ) : tenants.length === 0 ? (
          <div style={s.emptyHint}>暂无商户，点击「新增商户」创建第一个。</div>
        ) : (
          tenants.map((t) => <TenantCard key={t.id} tenant={t} />)
        )}

      </div>
    </div>
  )
}

// ─── TenantCard ───────────────────────────────────────────────────────────────

function TenantCard({ tenant: t }: { tenant: TenantRow }) {
  const active = t.status === 'ACTIVE'
  const lastActive = t.lastActiveAt
    ? new Date(t.lastActiveAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '无记录'

  return (
    <Link href={`/ops/${t.id}`} style={s.card}>
      <div style={s.cardTop}>
        <div style={s.cardName}>{t.name}</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {(() => { const tm = TIER_META[t.tier] ?? TIER_META.LITE; return (
            <span style={{ ...s.statusBadge, background: tm.bg, color: tm.color, borderColor: tm.border }}>{tm.label}</span>
          )})()}
          <span style={active ? { ...s.statusBadge, background: '#f6ffed', color: '#52c41a', borderColor: '#b7eb8f' } : { ...s.statusBadge, background: '#fff1f0', color: '#ff4d4f', borderColor: '#ffa39e' }}>
            {active ? '运营中' : '已归档'}
          </span>
        </div>
      </div>
      <div style={s.cardId}>ID: {t.id.slice(0, 16)}…</div>

      <div style={s.statsRow}>
        <StatPill icon="🏪" label="门店" value={String(t.storeCount)} />
        <StatPill icon="👑" label="老板" value={`${t.ownerBound}/${t.ownerTotal}`} color={t.ownerBound === t.ownerTotal && t.ownerTotal > 0 ? '#52c41a' : '#fa8c16'} />
        <StatPill icon="👤" label="员工" value={`${t.staffBound}/${t.staffTotal}`} />
        <StatPill icon="📦" label="今日单" value={String(t.todaySaleCount)} color={t.todaySaleCount > 0 ? '#1677ff' : undefined} />
      </div>

      <div style={s.cardFooter}>
        <span style={s.cardMeta}>最近活跃：{lastActive}</span>
        <span style={s.cardArrow}>查看详情 →</span>
      </div>
    </Link>
  )
}

function StatPill({ icon, label, value, color }: { icon: string; label: string; value: string; color?: string }) {
  return (
    <div style={s.statPill}>
      <span style={s.statIcon}>{icon}</span>
      <span style={s.statLabel}>{label}</span>
      <span style={{ ...s.statValue, color: color ?? '#333' }}>{value}</span>
    </div>
  )
}

// ─── CreateForm ───────────────────────────────────────────────────────────────

const TIER_OPTIONS = [
  { value: 'LITE',        label: '轻试用版' },
  { value: 'STANDARD',    label: '标准收银版' },
  { value: 'MULTI_STORE', label: '门店标准化版' },
]

function CreateForm({ onCreated, onCancel }: { onCreated: (tenantId: string) => void; onCancel: () => void }) {
  const [form, setForm] = useState({ tenantName: '', storeName: '总店', tier: 'LITE' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function set(k: keyof typeof form, v: string) { setForm((f) => ({ ...f, [k]: v })) }

  async function submit() {
    if (!form.tenantName.trim()) {
      setError('请填写商户名')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const r = await apiFetch('/api/ops/tenants', {
        method: 'POST',
        body: JSON.stringify(form),
      }, OWNER_CTX)
      const body = await r.json()
      if (r.ok) onCreated(body.tenantId)
      else setError(body.message ?? body.error ?? '创建失败')
    } catch {
      setError('网络错误，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={s.createForm}>
      <div style={s.formTitle}>新增商户</div>
      <div style={s.formGrid}>
        <Field label="商户名 *" value={form.tenantName} onChange={(v) => set('tenantName', v)} placeholder="张记超市" />
        <Field label="门店名" value={form.storeName} onChange={(v) => set('storeName', v)} placeholder="总店" />
      </div>
      <div style={{ marginTop: 12 }}>
        <div style={s.fieldLabel}>产品档次</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          {TIER_OPTIONS.map(({ value, label }) => {
            const tm = TIER_META[value]
            const active = form.tier === value
            return (
              <button
                key={value}
                type="button"
                onClick={() => set('tier', value)}
                style={{
                  flex: 1, height: 34, border: `1.5px solid ${active ? tm.border : '#e8e8e8'}`,
                  borderRadius: 6, fontSize: 12, fontWeight: active ? 700 : 400,
                  background: active ? tm.bg : '#f5f5f5', color: active ? tm.color : '#888',
                  cursor: 'pointer',
                }}
              >{label}</button>
            )
          })}
        </div>
      </div>
      {error && <div style={s.errorMsg}>{error}</div>}
      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <button style={s.cancelBtn} onClick={onCancel}>取消</button>
        <button style={{ ...s.submitFormBtn, opacity: submitting ? 0.7 : 1 }} disabled={submitting} onClick={submit}>
          {submitting ? '创建中…' : '确认创建'}
        </button>
      </div>
      <p style={{ ...s.emptyHint, marginTop: 10 }}>老板账号自动生成，创建后跳转详情页生成绑定码</p>
    </div>
  )
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <div style={s.fieldLabel}>{label}</div>
      <input style={s.fieldInput} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f0f2f5', paddingBottom: 40 },
  header: {
    background: '#1a1a2e', padding: '18px 20px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: 700 },
  headerSub: { color: 'rgba(255,255,255,0.45)', fontSize: 12, marginTop: 2 },
  sysLink: { color: 'rgba(255,255,255,0.6)', fontSize: 13, textDecoration: 'none' },
  createBtn: {
    height: 34, padding: '0 16px', background: '#1677ff', color: '#fff',
    border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  body: { maxWidth: 680, margin: '0 auto', padding: '14px 12px' },

  card: {
    display: 'block', background: '#fff', borderRadius: 12, padding: '14px 16px',
    marginBottom: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', textDecoration: 'none',
    color: 'inherit', cursor: 'pointer',
  },
  cardTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  cardName: { fontSize: 16, fontWeight: 700, color: '#1a1a1a' },
  statusBadge: {
    fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
    border: '1px solid', letterSpacing: '0.02em',
  },
  cardId: { fontSize: 11, color: '#ccc', fontFamily: 'monospace', marginBottom: 12 },
  statsRow: { display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  statPill: {
    display: 'flex', alignItems: 'center', gap: 4, background: '#f8f8f8',
    borderRadius: 6, padding: '4px 10px', border: '1px solid #f0f0f0',
  },
  statIcon: { fontSize: 13 },
  statLabel: { fontSize: 11, color: '#aaa' },
  statValue: { fontSize: 13, fontWeight: 700 },
  cardFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  cardMeta: { fontSize: 12, color: '#bbb' },
  cardArrow: { fontSize: 12, color: '#1677ff', fontWeight: 600 },

  createForm: {
    background: '#fff', borderRadius: 12, padding: '18px 16px',
    marginBottom: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    border: '1.5px solid #1677ff33',
  },
  formTitle: { fontSize: 14, fontWeight: 700, color: '#1677ff', marginBottom: 14 },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  fieldLabel: { fontSize: 12, color: '#888', marginBottom: 4 },
  fieldInput: {
    width: '100%', height: 38, border: '1.5px solid #e8e8e8', borderRadius: 6,
    padding: '0 10px', fontSize: 14, outline: 'none', boxSizing: 'border-box',
  },
  errorMsg: { fontSize: 13, color: '#ff4d4f', marginTop: 8 },
  cancelBtn: {
    height: 38, padding: '0 18px', background: '#f5f5f5', border: '1px solid #e0e0e0',
    borderRadius: 6, fontSize: 13, cursor: 'pointer',
  },
  submitFormBtn: {
    flex: 1, height: 38, background: '#1677ff', color: '#fff',
    border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer',
  },

  center: {
    minHeight: '100vh', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 12, background: '#f0f2f5',
  },
  spinner: {
    width: 32, height: 32, borderRadius: '50%', border: '3px solid #e8e8e8',
    borderTopColor: '#1677ff', animation: 'spin 0.8s linear infinite',
  },
  backLink: { fontSize: 14, color: '#1677ff', textDecoration: 'none' },
  emptyHint: { fontSize: 13, color: '#bbb', textAlign: 'center', padding: '20px 0' },
}
