'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import QRCode from 'react-qr-code'
import { apiFetch, OWNER_CTX } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

type Store = { id: string; name: string; code: string }
type Member = { id: string; username: string; displayName: string; role: string; bound: boolean; staffNumber: number | null; storeName: string }
type TodayStats = { saleCount: number; saleAmount: number; refundCount: number; lastActiveAt: string | null }

type TenantDetail = {
  id: string
  name: string
  status: string
  tier: string
  createdAt: string
  stores: Store[]
  members: Member[]
  today: TodayStats
}

const TIER_META: Record<string, { label: string; color: string; bg: string; border: string; desc: string; scan: string }> = {
  LITE:        { label: '轻试用版',     color: '#389e0d', bg: '#f6ffed', border: '#b7eb8f', desc: '手机即用，适合个体小摊初次体验数字化',     scan: '摄像头扫码（强制）· 连续5次失败提示手动输入' },
  STANDARD:    { label: '标准收银版',   color: '#1677ff', bg: '#e6f4ff', border: '#91caff', desc: '单店实体零售，含商品管理与条码扫描',         scan: 'HID扫码枪优先 · 输入框默认聚焦 · 5次失败切换摄像头' },
  MULTI_STORE: { label: '门店标准化版', color: '#722ed1', bg: '#f9f0ff', border: '#d3adf7', desc: '多门店连锁，老板视角概览与店员模式',         scan: '继承标准收银版扫码策略 · 打印/贴标能力单独定义' },
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
            ['状态', detail.status === 'ACTIVE' ? '✅ 运营中' : '🔴 已归档停用'],
            ['创建时间', new Date(detail.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })],
            ['门店数', String(detail.stores.length)],
            ['成员数', String(detail.members.length)],
          ]} />
        </Section>

        {/* Lifecycle actions */}
        <Section title="商户管理">
          <LifecyclePanel tenantId={detail.id} currentStatus={detail.status} onChanged={load} />
        </Section>

        {/* Tier */}
        <Section title="产品档次">
          <TierPanel tenantId={detail.id} currentTier={detail.tier} onChanged={load} />
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

// ─── TierPanel ───────────────────────────────────────────────────────────────

function TierPanel({ tenantId, currentTier, onChanged }: { tenantId: string; currentTier: string; onChanged: () => void }) {
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const tm = TIER_META[currentTier] ?? TIER_META.LITE

  async function changeTier(tier: string) {
    if (tier === currentTier) return
    setSaving(true)
    setErr(null)
    try {
      const r = await apiFetch(`/api/ops/tenants/${tenantId}`, {
        method: 'PATCH',
        body: JSON.stringify({ tier }),
      }, OWNER_CTX)
      if (r.ok) onChanged()
      else setErr('更新失败')
    } catch {
      setErr('网络错误')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ ...s.tierBadge, background: tm.bg, color: tm.color, borderColor: tm.border }}>{tm.label}</span>
        <span style={{ fontSize: 12, color: '#888' }}>{tm.desc}</span>
      </div>
      <div style={{ fontSize: 11, color: '#aaa', marginBottom: 12, paddingLeft: 2 }}>
        📷 扫码策略：{tm.scan}
      </div>
      <div style={s.tierRow}>
        {Object.entries(TIER_META).map(([key, meta]) => (
          <button
            key={key}
            disabled={saving}
            onClick={() => changeTier(key)}
            style={{
              ...s.tierBtn,
              ...(currentTier === key ? { background: meta.bg, color: meta.color, borderColor: meta.border, fontWeight: 700 } : {}),
            }}
          >
            {meta.label}
          </button>
        ))}
      </div>
      {err && <div style={s.errMsg}>{err}</div>}
    </div>
  )
}

// ─── LifecyclePanel ───────────────────────────────────────────────────────────

function LifecyclePanel({ tenantId, currentStatus, onChanged }: { tenantId: string; currentStatus: string; onChanged: () => void }) {
  const [saving, setSaving] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const isActive = currentStatus === 'ACTIVE'

  async function toggleStatus() {
    const next = isActive ? 'ARCHIVED' : 'ACTIVE'
    const msg = isActive ? `确认归档/停用该商户？停用后商户前台将立即无法使用（现有 session 被拒绝）。` : `确认恢复该商户为运营状态？`
    if (!confirm(msg)) return
    setSaving(true)
    setErr(null)
    try {
      const r = await apiFetch(`/api/ops/tenants/${tenantId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next }),
      }, OWNER_CTX)
      if (r.ok) onChanged()
      else setErr('操作失败')
    } catch {
      setErr('网络错误')
    } finally {
      setSaving(false)
    }
  }

  async function downloadBackup() {
    setDownloading(true)
    setErr(null)
    try {
      const r = await apiFetch(`/api/ops/tenants/${tenantId}/export`, undefined, OWNER_CTX)
      if (!r.ok) { setErr('导出失败'); return }
      const blob = await r.blob()
      const cd = r.headers.get('content-disposition') ?? ''
      const match = cd.match(/filename="([^"]+)"/)
      const filename = match?.[1] ?? `tenant_${tenantId}_export.json`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setErr('网络错误')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button
          style={{
            ...s.actionBtn,
            background: isActive ? '#fff1f0' : '#f6ffed',
            color: isActive ? '#ff4d4f' : '#52c41a',
            borderColor: isActive ? '#ffa39e' : '#b7eb8f',
            opacity: saving ? 0.6 : 1,
          }}
          disabled={saving}
          onClick={toggleStatus}
        >
          {saving ? '…' : isActive ? '停用商户' : '恢复运营'}
        </button>
        <button
          style={{ ...s.actionBtn, opacity: downloading ? 0.6 : 1 }}
          disabled={downloading}
          onClick={downloadBackup}
        >
          {downloading ? '导出中…' : '下载数据备份'}
        </button>
      </div>
      {!isActive && (
        <div style={{ fontSize: 12, color: '#fa8c16', marginTop: 8, background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 6, padding: '6px 10px' }}>
          ⚠️ 该商户已归档停用，前台所有 API 调用将被拒绝（401）。数据保留。如需永久删除请先导出备份，联系技术人员手动处理。
        </div>
      )}
      {err && <div style={s.errMsg}>{err}</div>}
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
  const [copied, setCopied] = useState(false)
  const qrRef = useRef<HTMLDivElement>(null)

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

  function copyLink() {
    if (!result?.tgLink) return
    navigator.clipboard.writeText(result.tgLink).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function downloadQR() {
    const svg = qrRef.current?.querySelector('svg')
    if (!svg) return
    const size = 240
    const xml = new XMLSerializer().serializeToString(svg)
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, size, size)
      ctx.drawImage(img, 0, 0, size, size)
      const a = document.createElement('a')
      a.href = canvas.toDataURL('image/png')
      const roleLabel = result?.role === 'OWNER' ? 'owner' : 'staff'
      a.download = `bind_qr_${roleLabel}.png`
      a.click()
    }
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)))
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
            <div ref={qrRef} style={s.qrWrap}>
              <QRCode value={result.tgLink} size={160} />
            </div>
          )}
          {result.tgLink && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button style={s.qrActionBtn} onClick={copyLink}>
                {copied ? '已复制 ✓' : '复制链接'}
              </button>
              <button style={s.qrActionBtn} onClick={downloadQR}>
                下载二维码
              </button>
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
                <div style={s.memberSub}>
                  {m.username}
                  {m.staffNumber != null && <span style={s.staffNumBadge}>#{m.staffNumber}</span>}
                  {' · '}{m.storeName}
                </div>
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
  memberSub: { fontSize: 11, color: '#bbb', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 },
  staffNumBadge: { fontSize: 10, fontWeight: 700, color: '#1677ff', background: '#e6f4ff', border: '1px solid #91caff', borderRadius: 4, padding: '0 4px' },
  memberRight: { display: 'flex', alignItems: 'center', gap: 8 },
  boundBadge: { fontSize: 12, fontWeight: 600 },
  unbindBtn: {
    height: 28, padding: '0 12px', background: '#fff1f0', color: '#ff4d4f',
    border: '1px solid #ffa39e', borderRadius: 6, fontSize: 12, cursor: 'pointer',
  },

  tierBadge: {
    fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 10,
    border: '1px solid', flexShrink: 0,
  },
  tierRow: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  tierBtn: {
    height: 32, padding: '0 14px', border: '1.5px solid #e8e8e8',
    borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
    background: '#f5f5f5', color: '#888',
  },
  errMsg: { fontSize: 13, color: '#ff4d4f', marginBottom: 8 },
  infoMsg: { fontSize: 13, color: '#52c41a', marginBottom: 8, padding: '8px 12px', background: '#f6ffed', borderRadius: 6, border: '1px solid #b7eb8f' },
  actionBtn: {
    height: 34, padding: '0 16px', border: '1.5px solid #e8e8e8',
    borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: '#f5f5f5', color: '#666',
  },
  qrActionBtn: {
    flex: 1, height: 32, border: '1.5px solid #d6e4ff', borderRadius: 6,
    fontSize: 12, fontWeight: 600, cursor: 'pointer', background: '#f0f7ff', color: '#1677ff',
  },
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
