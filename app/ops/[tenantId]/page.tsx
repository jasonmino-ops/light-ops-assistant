'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import QRCode from 'react-qr-code'
import { apiFetch, OWNER_CTX } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

type Store = { id: string; name: string; code: string }
type Member = { id: string; username: string; displayName: string; role: string; bound: boolean; storeName: string }
type TodayStats = { saleCount: number; saleAmount: number; refundCount: number; lastActiveAt: string | null }

type TenantDetail = {
  id: string
  name: string
  status: string
  createdAt: string
  stores: Store[]
  members: Member[]
  today: TodayStats
}

type GenResult = { token: string; role: string; storeName: string; expiresAt: string; tgLink: string | null }

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TenantDetailPage() {
  const { tenantId } = useParams<{ tenantId: string }>()
  const [detail, setDetail] = useState<TenantDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const r = await apiFetch(`/api/ops/tenants/${tenantId}`, undefined, OWNER_CTX)
      if (r.ok) setDetail(await r.json())
      else setError('加载失败')
    } catch {
      setError('网络错误')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [tenantId])

  if (loading) return (
    <div style={s.center}>
      <div style={s.spinner} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
  if (error || !detail) return (
    <div style={s.center}>
      <p style={{ color: '#ff4d4f' }}>{error ?? '未找到商户'}</p>
      <Link href="/ops" style={s.backLink}>← 返回列表</Link>
    </div>
  )

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.header}>
        <div>
          <div style={s.headerTitle}>{detail.name}</div>
          <div style={s.headerSub}>ID: {detail.id.slice(0, 20)}…</div>
        </div>
        <Link href="/ops" style={s.backLink}>← 返回列表</Link>
      </div>

      <div style={s.body}>

        {/* Basic info */}
        <Section title="基本信息">
          <InfoGrid rows={[
            ['状态', detail.status === 'ACTIVE' ? '✅ 运营中' : '🔴 停用'],
            ['创建时间', new Date(detail.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })],
            ['门店数', String(detail.stores.length)],
            ['成员数', String(detail.members.length)],
          ]} />
        </Section>

        {/* Today stats */}
        <Section title="今日数据">
          <div style={s.statsRow}>
            <StatBox label="成交单数" value={String(detail.today.saleCount)} color="#1677ff" />
            <StatBox label="成交金额" value={`¥${detail.today.saleAmount.toFixed(2)}`} color="#52c41a" />
            <StatBox label="退款次数" value={String(detail.today.refundCount)} color={detail.today.refundCount > 0 ? '#ff4d4f' : '#bbb'} />
            <StatBox label="最近活跃"
              value={detail.today.lastActiveAt
                ? new Date(detail.today.lastActiveAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                : '无记录'}
              color="#888"
            />
          </div>
        </Section>

        {/* Bind code generator */}
        <Section title="生成绑定码">
          <GenCodePanel tenantId={detail.id} stores={detail.stores} />
        </Section>

        {/* Member list */}
        <Section title="成员列表">
          <MemberList tenantId={detail.id} members={detail.members} onUnbound={load} />
        </Section>

      </div>
    </div>
  )
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={s.section}>
      <div style={s.sectionTitle}>{title}</div>
      {children}
    </div>
  )
}

// ─── InfoGrid ─────────────────────────────────────────────────────────────────

function InfoGrid({ rows }: { rows: [string, string][] }) {
  return (
    <div style={s.infoGrid}>
      {rows.map(([label, value]) => (
        <div key={label} style={s.infoRow}>
          <span style={s.infoLabel}>{label}</span>
          <span style={s.infoValue}>{value}</span>
        </div>
      ))}
    </div>
  )
}

// ─── StatBox ─────────────────────────────────────────────────────────────────

function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={s.statBox}>
      <div style={{ ...s.statBoxValue, color: color ?? '#333' }}>{value}</div>
      <div style={s.statBoxLabel}>{label}</div>
    </div>
  )
}

// ─── GenCodePanel ─────────────────────────────────────────────────────────────

function GenCodePanel({ tenantId, stores }: { tenantId: string; stores: Store[] }) {
  const [storeId, setStoreId] = useState(stores[0]?.id ?? '')
  const [role, setRole] = useState<'OWNER' | 'STAFF'>('OWNER')
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState<GenResult | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function generate() {
    if (!storeId) { setErr('请选择门店'); return }
    setGenerating(true)
    setErr(null)
    setResult(null)
    try {
      const r = await apiFetch(`/api/ops/tenants/${tenantId}/tokens`, {
        method: 'POST',
        body: JSON.stringify({ storeId, role, expiresInHours: 24 }),
      }, OWNER_CTX)
      const body = await r.json()
      if (r.ok) setResult(body)
      else setErr(body.error ?? '生成失败')
    } catch {
      setErr('网络错误')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div>
      <div style={s.genRow}>
        <select style={s.select} value={storeId} onChange={(e) => setStoreId(e.target.value)}>
          {stores.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
        </select>
        <button
          style={{ ...s.roleBtn, ...(role === 'OWNER' ? s.roleBtnActive : {}) }}
          onClick={() => setRole('OWNER')}
        >老板码</button>
        <button
          style={{ ...s.roleBtn, ...(role === 'STAFF' ? s.roleBtnActive : {}) }}
          onClick={() => setRole('STAFF')}
        >员工码</button>
        <button style={{ ...s.genBtn, opacity: generating ? 0.7 : 1 }} disabled={generating} onClick={generate}>
          {generating ? '生成中…' : '生成'}
        </button>
      </div>
      {err && <div style={s.errMsg}>{err}</div>}
      {result && (
        <div style={s.genResult}>
          <div style={s.genMeta}>
            <span style={s.genTag}>{result.role === 'OWNER' ? '老板' : '员工'} · {result.storeName}</span>
            <span style={s.genExp}>过期：{new Date(result.expiresAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          {result.tgLink && (
            <div style={s.qrWrap}>
              <QRCode value={result.tgLink} size={160} />
            </div>
          )}
          {result.tgLink && (
            <div style={s.tgLinkBox}>
              <a href={result.tgLink} target="_blank" rel="noreferrer" style={s.tgLink}>{result.tgLink}</a>
            </div>
          )}
          <div style={s.tokenBox}>Token: <code>{result.token}</code></div>
        </div>
      )}
    </div>
  )
}

// ─── MemberList ───────────────────────────────────────────────────────────────

function MemberList({ tenantId, members, onUnbound }: { tenantId: string; members: Member[]; onUnbound: () => void }) {
  const [unbinding, setUnbinding] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  async function unbind(userId: string, displayName: string) {
    if (!confirm(`确认解绑「${displayName}」的 Telegram 账号？`)) return
    setUnbinding(userId)
    setMsg(null)
    try {
      const r = await apiFetch(`/api/ops/tenants/${tenantId}/members/${userId}/unbind`, { method: 'POST' }, OWNER_CTX)
      const body = await r.json()
      if (r.ok) { setMsg(`已解绑：${body.displayName}`); onUnbound() }
      else setMsg(body.error ?? '解绑失败')
    } catch {
      setMsg('网络错误')
    } finally {
      setUnbinding(null)
    }
  }

  if (members.length === 0) return <div style={s.emptyHint}>暂无成员</div>

  return (
    <div>
      {msg && <div style={s.infoMsg}>{msg}</div>}
      <div style={s.memberList}>
        {members.map((m) => (
          <div key={m.id} style={s.memberRow}>
            <div style={s.memberLeft}>
              <span style={{ ...s.roleBadge, background: m.role === 'OWNER' ? '#fff7e6' : '#f6f6f6', color: m.role === 'OWNER' ? '#fa8c16' : '#666' }}>
                {m.role === 'OWNER' ? '老板' : '员工'}
              </span>
              <div>
                <div style={s.memberName}>{m.displayName || m.username}</div>
                <div style={s.memberSub}>{m.username} · {m.storeName}</div>
              </div>
            </div>
            <div style={s.memberRight}>
              <span style={{ ...s.boundBadge, color: m.bound ? '#52c41a' : '#bbb' }}>
                {m.bound ? '已绑定' : '未绑定'}
              </span>
              {m.bound && (
                <button
                  style={{ ...s.unbindBtn, opacity: unbinding === m.id ? 0.6 : 1 }}
                  disabled={unbinding === m.id}
                  onClick={() => unbind(m.id, m.displayName || m.username)}
                >
                  {unbinding === m.id ? '…' : '解绑'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
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
  headerSub: { color: 'rgba(255,255,255,0.45)', fontSize: 11, marginTop: 2, fontFamily: 'monospace' },
  backLink: { color: 'rgba(255,255,255,0.7)', fontSize: 13, textDecoration: 'none' },
  body: { maxWidth: 680, margin: '0 auto', padding: '14px 12px' },

  section: {
    background: '#fff', borderRadius: 12, padding: '14px 16px',
    marginBottom: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
  },
  sectionTitle: { fontSize: 13, fontWeight: 700, color: '#888', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.04em' },

  infoGrid: { display: 'flex', flexDirection: 'column', gap: 8 },
  infoRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  infoLabel: { fontSize: 13, color: '#888' },
  infoValue: { fontSize: 13, fontWeight: 600, color: '#333' },

  statsRow: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 },
  statBox: { background: '#f8f8f8', borderRadius: 8, padding: '10px 8px', textAlign: 'center' },
  statBoxValue: { fontSize: 16, fontWeight: 700 },
  statBoxLabel: { fontSize: 11, color: '#aaa', marginTop: 4 },

  genRow: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 },
  select: {
    flex: 1, minWidth: 120, height: 34, border: '1.5px solid #e8e8e8',
    borderRadius: 6, padding: '0 8px', fontSize: 13, background: '#fff',
  },
  roleBtn: {
    height: 34, padding: '0 14px', border: '1.5px solid #e8e8e8',
    borderRadius: 6, fontSize: 13, cursor: 'pointer', background: '#f5f5f5', color: '#666',
  },
  roleBtnActive: { background: '#1677ff', color: '#fff', borderColor: '#1677ff' },
  genBtn: {
    height: 34, padding: '0 18px', background: '#1677ff', color: '#fff',
    border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  genResult: {
    background: '#f8faff', borderRadius: 10, padding: '14px',
    border: '1px solid #d6e4ff', marginTop: 4,
  },
  genMeta: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  genTag: { fontSize: 13, fontWeight: 700, color: '#1677ff' },
  genExp: { fontSize: 12, color: '#888' },
  qrWrap: { display: 'flex', justifyContent: 'center', marginBottom: 12, padding: '12px', background: '#fff', borderRadius: 8 },
  tgLinkBox: { marginBottom: 8 },
  tgLink: { fontSize: 11, color: '#1677ff', wordBreak: 'break-all' },
  tokenBox: { fontSize: 11, color: '#888', fontFamily: 'monospace' },

  memberList: { display: 'flex', flexDirection: 'column', gap: 1 },
  memberRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 4px', borderBottom: '1px solid #f5f5f5',
  },
  memberLeft: { display: 'flex', alignItems: 'center', gap: 10 },
  roleBadge: { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, border: '1px solid #f0f0f0' },
  memberName: { fontSize: 14, fontWeight: 600, color: '#1a1a1a' },
  memberSub: { fontSize: 11, color: '#bbb', marginTop: 2 },
  memberRight: { display: 'flex', alignItems: 'center', gap: 8 },
  boundBadge: { fontSize: 12, fontWeight: 600 },
  unbindBtn: {
    height: 28, padding: '0 12px', background: '#fff1f0', color: '#ff4d4f',
    border: '1px solid #ffa39e', borderRadius: 6, fontSize: 12, cursor: 'pointer',
  },

  errMsg: { fontSize: 13, color: '#ff4d4f', marginBottom: 8 },
  infoMsg: { fontSize: 13, color: '#52c41a', marginBottom: 8, padding: '8px 12px', background: '#f6ffed', borderRadius: 6, border: '1px solid #b7eb8f' },
  emptyHint: { fontSize: 13, color: '#bbb', textAlign: 'center', padding: '16px 0' },
  center: {
    minHeight: '100vh', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 12, background: '#f0f2f5',
  },
  spinner: {
    width: 32, height: 32, borderRadius: '50%', border: '3px solid #e8e8e8',
    borderTopColor: '#1677ff', animation: 'spin 0.8s linear infinite',
  },
}
