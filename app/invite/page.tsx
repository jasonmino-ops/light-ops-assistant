'use client'

import { useState, useEffect, useCallback } from 'react'
import QRCode from 'react-qr-code'
import { apiFetch, OWNER_CTX } from '@/lib/api'

type Store = { id: string; name: string }

type BindTokenResult = {
  token: string
  role: string
  storeId: string
  storeName: string
  label: string | null
  expiresAt: string
  maxUses: number
  tgLink: string | null
}

type Member = {
  id: string
  username: string
  displayName: string
  role: 'OWNER' | 'STAFF'
  status: 'ACTIVE' | 'DISABLED'
  bound: boolean
  staffNumber: number | null
  storeName: string
}

function fmtExpiry(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function InvitePage() {
  // ── Generate form ────────────────────────────────────────────────────────
  const [stores, setStores] = useState<Store[]>([])
  const [storeId, setStoreId] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<BindTokenResult | null>(null)
  const [genError, setGenError] = useState('')
  const [copied, setCopied] = useState(false)

  // ── Member list ──────────────────────────────────────────────────────────
  const [members, setMembers] = useState<Member[]>([])
  const [showArchived, setShowArchived] = useState(false)
  const [unbinding, setUnbinding] = useState<string | null>(null)
  const [resigning, setResigning] = useState<string | null>(null)

  const loadMembers = useCallback((withArchived: boolean) => {
    const url = withArchived ? '/api/admin/users?includeArchived=true' : '/api/admin/users'
    apiFetch(url, undefined, OWNER_CTX)
      .then((r) => (r.ok ? r.json() : []))
      .then(setMembers)
      .catch(() => {})
  }, [])

  useEffect(() => {
    apiFetch('/api/stores', undefined, OWNER_CTX)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Store[]) => {
        setStores(list)
        if (list.length > 0) setStoreId(list[0].id)
      })
      .catch(() => {})

    loadMembers(false)
  }, [loadMembers])

  // ── Generate ─────────────────────────────────────────────────────────────
  async function generate() {
    if (!storeId) return
    setLoading(true)
    setGenError('')
    setResult(null)
    try {
      const r = await apiFetch('/api/admin/bind-tokens', {
        method: 'POST',
        body: JSON.stringify({
          storeId,
          role: 'STAFF',
          expiresInHours: 24,
          maxUses: 1,
        }),
      }, OWNER_CTX)
      const body = await r.json()
      if (r.ok) setResult(body)
      else setGenError(body.message ?? body.error ?? '生成失败')
    } catch {
      setGenError('网络错误，请重试')
    } finally {
      setLoading(false)
    }
  }

  function copyLink() {
    if (!result?.tgLink) return
    navigator.clipboard.writeText(result.tgLink).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function reset() {
    setResult(null)
    setGenError('')
    loadMembers(showArchived)
  }

  // ── Unbind ───────────────────────────────────────────────────────────────
  async function unbind(userId: string, label: string) {
    if (!window.confirm(`确认解绑「${label}」的 Telegram 账号？`)) return
    setUnbinding(userId)
    try {
      const r = await apiFetch(`/api/admin/users/${userId}/unbind`, { method: 'POST' }, OWNER_CTX)
      const body = await r.json()
      if (r.ok) loadMembers(showArchived)
      else window.alert(body.message ?? body.error ?? '解绑失败')
    } catch {
      window.alert('网络错误')
    } finally {
      setUnbinding(null)
    }
  }

  // ── Resign ───────────────────────────────────────────────────────────────
  async function resign(userId: string, label: string) {
    if (!window.confirm(`确认将「${label}」离职归档？\n将解绑账号并停用，历史销售记录保留。`)) return
    setResigning(userId)
    try {
      const r = await apiFetch(`/api/admin/users/${userId}/resign`, { method: 'POST' }, OWNER_CTX)
      const body = await r.json()
      if (r.ok) loadMembers(showArchived)
      else window.alert(body.message ?? body.error ?? '归档失败')
    } catch {
      window.alert('网络错误')
    } finally {
      setResigning(null)
    }
  }

  function toggleArchived() {
    const next = !showArchived
    setShowArchived(next)
    loadMembers(next)
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function memberLabel(m: Member) {
    return m.staffNumber != null ? `员工 #${m.staffNumber}` : '老板'
  }

  const qrValue = result?.tgLink ?? ''

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div style={s.headerTitle}>添加新员工</div>
      </div>

      <div style={s.body}>
        {/* ── Generate section ── */}
        {!result ? (
          <div style={s.card}>
            {stores.length > 1 && (
              <div style={s.field}>
                <label style={s.fieldLabel}>门店</label>
                <select style={s.select} value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                  {stores.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                </select>
              </div>
            )}

            <div style={s.tipBox}>
              员工扫码后自行填写名字，有效期 24 小时，限 1 人使用
            </div>

            {genError && <div style={s.errorMsg}>{genError}</div>}

            <button
              style={{ ...s.genBtn, opacity: loading ? 0.6 : 1 }}
              onClick={generate}
              disabled={loading || !storeId}
            >
              {loading ? '生成中…' : '生成员工绑定码'}
            </button>
          </div>
        ) : (
          <div style={s.resultWrap}>
            <div style={s.qrCard}>
              {qrValue
                ? <QRCode value={qrValue} size={200} style={{ display: 'block' }} />
                : <div style={s.noLink}>未配置 Telegram Bot，无法生成链接</div>
              }
            </div>

            <div style={s.infoCard}>
              <InfoRow label="门店" value={result.storeName} />
              <InfoRow label="有效至" value={fmtExpiry(result.expiresAt)} />
              <InfoRow label="状态" value="有效" color="#52c41a" />
            </div>

            {result.tgLink && (
              <button style={s.copyBtn} onClick={copyLink}>
                {copied ? '已复制 ✓' : '复制邀请链接'}
              </button>
            )}

            <button style={s.resetBtn} onClick={reset}>再生成一个</button>
          </div>
        )}

        {/* ── Members section ── */}
        <div style={s.memberHeader}>
          <span style={s.sectionTitle}>成员</span>
          <button
            type="button"
            onClick={toggleArchived}
            style={s.archivedToggle}
          >
            {showArchived ? '隐藏已停用' : '查看已停用员工'}
          </button>
        </div>

        {members.filter((m) => m.status === 'ACTIVE' || showArchived).length === 0 ? (
          <div style={s.emptyHint}>暂无成员</div>
        ) : (
          <div style={s.memberList}>
            {members
              .filter((m) => m.status === 'ACTIVE' || showArchived)
              .map((m) => {
                const isArchived = m.status === 'DISABLED'
                const label = memberLabel(m)
                return (
                  <div key={m.id} style={{ ...s.memberCard, opacity: isArchived ? 0.55 : 1 }}>
                    <div style={s.memberLeft}>
                      {/* Primary: role badge + number */}
                      <div style={s.memberPrimary}>
                        <span style={m.role === 'OWNER' ? s.tagOwner : s.tagStaff}>
                          {m.role === 'OWNER' ? '老板' : `员工 #${m.staffNumber ?? '?'}`}
                        </span>
                        {isArchived && <span style={s.tagArchived}>已停用</span>}
                      </div>
                      {/* Secondary: display name (if set and not just placeholder) */}
                      {m.displayName && (
                        <div style={s.memberSub}>{m.displayName}</div>
                      )}
                    </div>
                    <div style={s.memberRight}>
                      {!isArchived && (
                        <span style={m.bound ? s.badgeBound : s.badgeUnbound}>
                          {m.bound ? '已绑定' : '未绑定'}
                        </span>
                      )}
                      {!isArchived && m.bound && (
                        <button
                          style={{ ...s.unbindBtn, opacity: unbinding === m.id ? 0.5 : 1 }}
                          disabled={unbinding === m.id}
                          onClick={() => unbind(m.id, label)}
                        >
                          解绑
                        </button>
                      )}
                      {!isArchived && m.role === 'STAFF' && (
                        <button
                          style={{ ...s.resignBtn, opacity: resigning === m.id ? 0.5 : 1 }}
                          disabled={resigning === m.id}
                          onClick={() => resign(m.id, label)}
                        >
                          离职
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
          </div>
        )}
      </div>
    </div>
  )
}

function InfoRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={ir.row}>
      <span style={ir.label}>{label}</span>
      <span style={{ ...ir.value, ...(color ? { color } : {}) }}>{value}</span>
    </div>
  )
}

const ir: Record<string, React.CSSProperties> = {
  row: { display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #f5f5f5' },
  label: { fontSize: 13, color: '#8c8c8c' },
  value: { fontSize: 13, fontWeight: 600, color: '#1a1a1a' },
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f5f7fa', display: 'flex', flexDirection: 'column' },
  header: { background: '#1677ff', padding: '18px 16px 22px' },
  headerTitle: { fontSize: 18, fontWeight: 700, color: '#fff' },

  body: { flex: 1, padding: '16px 12px 80px', maxWidth: 480, margin: '0 auto', width: '100%' },
  sectionTitle: { fontSize: 12, fontWeight: 700, color: '#8c8c8c', textTransform: 'uppercase', letterSpacing: '0.05em' },

  card: {
    background: '#fff', borderRadius: 14, padding: '18px 16px',
    display: 'flex', flexDirection: 'column', gap: 14,
    boxShadow: '0 2px 12px rgba(0,0,0,0.06)', marginBottom: 20,
  },
  field: { display: 'flex', flexDirection: 'column', gap: 8 },
  fieldLabel: { fontSize: 12, fontWeight: 600, color: '#8c8c8c' },
  select: { height: 44, border: '1.5px solid #e8e8e8', borderRadius: 8, padding: '0 12px', fontSize: 15, background: '#fafafa', color: '#1a1a1a' },

  tipBox: {
    fontSize: 13, color: '#8c8c8c', background: '#f8f8f8',
    borderRadius: 8, padding: '10px 12px', lineHeight: 1.6,
  },
  errorMsg: { fontSize: 13, color: '#ff4d4f', textAlign: 'center' },
  genBtn: { height: 48, background: '#1677ff', color: '#fff', border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 700, cursor: 'pointer' },

  resultWrap: { display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 },
  qrCard: { background: '#fff', borderRadius: 14, padding: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' },
  noLink: { fontSize: 13, color: '#aaa', textAlign: 'center', padding: '16px 0' },
  infoCard: { background: '#fff', borderRadius: 14, padding: '4px 16px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' },
  copyBtn: { height: 48, background: '#1677ff', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: 'pointer' },
  resetBtn: { height: 44, background: 'transparent', color: '#666', border: '1.5px solid #e8e8e8', borderRadius: 10, fontSize: 14, cursor: 'pointer' },

  memberHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  archivedToggle: { fontSize: 11, color: '#aaa', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 },

  emptyHint: { fontSize: 14, color: '#bbb', textAlign: 'center', padding: '20px 0' },
  memberList: { display: 'flex', flexDirection: 'column', gap: 8 },
  memberCard: {
    background: '#fff', borderRadius: 12, padding: '12px 14px',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
  },
  memberLeft: { display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 },
  memberPrimary: { display: 'flex', alignItems: 'center', gap: 6 },
  memberSub: { fontSize: 12, color: '#8c8c8c' },

  tagOwner: { fontSize: 12, fontWeight: 700, background: '#fff7e6', color: '#fa8c16', border: '1px solid #ffd591', borderRadius: 6, padding: '2px 8px' },
  tagStaff: { fontSize: 12, fontWeight: 700, background: '#e6f4ff', color: '#1677ff', border: '1px solid #91caff', borderRadius: 6, padding: '2px 8px' },
  tagArchived: { fontSize: 10, fontWeight: 700, background: '#f5f5f5', color: '#bbb', border: '1px solid #e8e8e8', borderRadius: 4, padding: '1px 5px' },

  memberRight: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 },
  badgeBound: { fontSize: 11, fontWeight: 600, color: '#52c41a', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 10, padding: '2px 8px' },
  badgeUnbound: { fontSize: 11, color: '#aaa', background: '#fafafa', border: '1px solid #e8e8e8', borderRadius: 10, padding: '2px 8px' },
  unbindBtn: {
    fontSize: 12, fontWeight: 600, color: '#ff4d4f',
    background: '#fff1f0', border: '1px solid #ffa39e',
    borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
  },
  resignBtn: {
    fontSize: 12, fontWeight: 600, color: '#8c8c8c',
    background: '#f5f5f5', border: '1px solid #d9d9d9',
    borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
  },
}
