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
  const [stores, setStores] = useState<Store[]>([])
  const [storeId, setStoreId] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<BindTokenResult | null>(null)
  const [genError, setGenError] = useState('')
  const [copied, setCopied] = useState(false)

  const [members, setMembers] = useState<Member[]>([])
  const [unbinding, setUnbinding] = useState<string | null>(null)

  const loadMembers = useCallback(() => {
    apiFetch('/api/admin/users', undefined, OWNER_CTX)
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
    loadMembers()
  }, [loadMembers])

  async function generate(role: 'OWNER' | 'STAFF') {
    if (!storeId) return
    setLoading(true)
    setGenError('')
    setResult(null)
    try {
      const r = await apiFetch('/api/admin/bind-tokens', {
        method: 'POST',
        body: JSON.stringify({ storeId, role, expiresInHours: 24, maxUses: 1 }),
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
    loadMembers()
  }

  async function unbind(userId: string, name: string) {
    if (!window.confirm(`确认解绑「${name}」的 Telegram 账号？`)) return
    setUnbinding(userId)
    try {
      const r = await apiFetch(`/api/admin/users/${userId}/unbind`, { method: 'POST' }, OWNER_CTX)
      const body = await r.json()
      if (r.ok) loadMembers()
      else window.alert(body.message ?? body.error ?? '解绑失败')
    } catch {
      window.alert('网络错误')
    } finally {
      setUnbinding(null)
    }
  }

  const activeMembers = members.filter((m) => m.status === 'ACTIVE')
  const owners = activeMembers.filter((m) => m.role === 'OWNER')
  const staff = activeMembers.filter((m) => m.role === 'STAFF')

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div style={s.headerTitle}>开通与邀请</div>
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

            {genError && <div style={s.errorMsg}>{genError}</div>}

            <div style={s.actionRow}>
              <button
                style={{ ...s.ownerBtn, opacity: loading ? 0.6 : 1 }}
                onClick={() => generate('OWNER')}
                disabled={loading || !storeId}
              >
                <span style={s.btnIcon}>🏪</span>
                <span style={s.btnText}>
                  <span style={s.btnLabel}>老板开通码</span>
                  <span style={s.btnSub}>用于新增商户</span>
                </span>
              </button>
              <button
                style={{ ...s.staffBtn, opacity: loading ? 0.6 : 1 }}
                onClick={() => generate('STAFF')}
                disabled={loading || !storeId}
              >
                <span style={s.btnIcon}>👤</span>
                <span style={s.btnText}>
                  <span style={s.btnLabel}>员工绑定码</span>
                  <span style={s.btnSub}>用于邀请员工</span>
                </span>
              </button>
            </div>
          </div>
        ) : (
          <div style={s.resultWrap}>
            <div style={s.qrCard}>
              {result.tgLink
                ? <QRCode value={result.tgLink} size={200} style={{ display: 'block' }} />
                : <div style={s.noLink}>未配置 Telegram Bot，无法生成链接</div>
              }
            </div>

            <div style={s.infoCard}>
              <InfoRow label="类型" value={result.role === 'OWNER' ? '老板开通码' : '员工绑定码'} />
              <InfoRow label="门店" value={result.storeName} />
              <InfoRow label="有效至" value={fmtExpiry(result.expiresAt)} />
            </div>

            {result.tgLink && (
              <>
                {/* Show the actual link text so the URL can be visually verified */}
                <div style={s.linkBox}>
                  <a href={result.tgLink} target="_blank" rel="noreferrer" style={s.linkText}>
                    {result.tgLink}
                  </a>
                </div>
                <button style={s.copyBtn} onClick={copyLink}>
                  {copied ? '已复制 ✓' : '复制邀请链接'}
                </button>
              </>
            )}
            <button style={s.resetBtn} onClick={reset}>重新生成</button>
          </div>
        )}

        {/* ── Members section ── */}
        <div style={s.sectionLabel}>门店成员</div>

        {/* Owner block */}
        {owners.length > 0 && (
          <div style={s.memberGroup}>
            <div style={s.groupLabel}>老板</div>
            {owners.map((m) => (
              <MemberCard
                key={m.id}
                member={m}
                unbinding={unbinding}
                onUnbind={unbind}
              />
            ))}
          </div>
        )}

        {/* Staff block */}
        <div style={s.memberGroup}>
          <div style={s.groupLabel}>员工</div>
          {staff.length === 0 ? (
            <div style={s.emptyHint}>暂无员工</div>
          ) : (
            staff.map((m) => (
              <MemberCard
                key={m.id}
                member={m}
                unbinding={unbinding}
                onUnbind={unbind}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function MemberCard({
  member: m,
  unbinding,
  onUnbind,
}: {
  member: Member
  unbinding: string | null
  onUnbind: (id: string, name: string) => void
}) {
  const name = m.displayName || m.username
  return (
    <div style={s.memberCard}>
      <div style={s.memberLeft}>
        <div style={s.memberName}>{name}</div>
        <div style={s.memberMeta}>
          <span style={m.role === 'OWNER' ? s.tagOwner : s.tagStaff}>
            {m.role === 'OWNER' ? '老板' : '员工'}
          </span>
          <span style={m.bound ? s.badgeBound : s.badgeUnbound}>
            {m.bound ? '已绑定' : '未绑定'}
          </span>
        </div>
      </div>
      {m.bound && (
        <button
          style={{ ...s.unbindBtn, opacity: unbinding === m.id ? 0.5 : 1 }}
          disabled={unbinding === m.id}
          onClick={() => onUnbind(m.id, name)}
        >
          解绑
        </button>
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={ir.row}>
      <span style={ir.label}>{label}</span>
      <span style={ir.value}>{value}</span>
    </div>
  )
}

const ir: Record<string, React.CSSProperties> = {
  row: { display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f5f5f5' },
  label: { fontSize: 13, color: '#8c8c8c' },
  value: { fontSize: 13, fontWeight: 600, color: '#1a1a1a' },
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f5f7fa', display: 'flex', flexDirection: 'column' },
  header: { background: '#1677ff', padding: '18px 16px 22px' },
  headerTitle: { fontSize: 18, fontWeight: 700, color: '#fff' },

  body: { flex: 1, padding: '16px 12px 80px', maxWidth: 480, margin: '0 auto', width: '100%' },

  card: {
    background: '#fff', borderRadius: 14, padding: '18px 16px',
    display: 'flex', flexDirection: 'column', gap: 16,
    boxShadow: '0 2px 12px rgba(0,0,0,0.06)', marginBottom: 24,
  },
  field: { display: 'flex', flexDirection: 'column', gap: 8 },
  fieldLabel: { fontSize: 12, fontWeight: 600, color: '#8c8c8c' },
  select: { height: 44, border: '1.5px solid #e8e8e8', borderRadius: 8, padding: '0 12px', fontSize: 15, background: '#fafafa', color: '#1a1a1a' },
  errorMsg: { fontSize: 13, color: '#ff4d4f', textAlign: 'center' },

  actionRow: { display: 'flex', gap: 10 },
  ownerBtn: {
    flex: 1, display: 'flex', alignItems: 'center', gap: 10,
    background: '#fff7e6', border: '1.5px solid #ffd591', borderRadius: 12,
    padding: '14px 12px', cursor: 'pointer', textAlign: 'left' as const,
  },
  staffBtn: {
    flex: 1, display: 'flex', alignItems: 'center', gap: 10,
    background: '#e6f4ff', border: '1.5px solid #91caff', borderRadius: 12,
    padding: '14px 12px', cursor: 'pointer', textAlign: 'left' as const,
  },
  btnIcon: { fontSize: 22, lineHeight: 1 },
  btnText: { display: 'flex', flexDirection: 'column', gap: 2 },
  btnLabel: { fontSize: 13, fontWeight: 700, color: '#1a1a1a' },
  btnSub: { fontSize: 11, color: '#8c8c8c' },

  resultWrap: { display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 },
  qrCard: { background: '#fff', borderRadius: 14, padding: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' },
  noLink: { fontSize: 13, color: '#aaa', textAlign: 'center', padding: '16px 0' },
  infoCard: { background: '#fff', borderRadius: 14, padding: '4px 16px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' },
  copyBtn: { height: 48, background: '#1677ff', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: 'pointer' },
  resetBtn: { height: 44, background: 'transparent', color: '#666', border: '1.5px solid #e8e8e8', borderRadius: 10, fontSize: 14, cursor: 'pointer' },

  sectionLabel: { fontSize: 12, fontWeight: 700, color: '#8c8c8c', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 10 },
  memberGroup: { marginBottom: 16 },
  groupLabel: { fontSize: 11, fontWeight: 700, color: '#bbb', marginBottom: 6, paddingLeft: 2 },

  memberCard: {
    background: '#fff', borderRadius: 12, padding: '12px 14px',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    boxShadow: '0 1px 6px rgba(0,0,0,0.05)', marginBottom: 8,
  },
  memberLeft: { display: 'flex', flexDirection: 'column', gap: 5, flex: 1, minWidth: 0 },
  memberName: { fontSize: 15, fontWeight: 600, color: '#1a1a1a' },
  memberMeta: { display: 'flex', alignItems: 'center', gap: 6 },

  tagOwner: { fontSize: 11, fontWeight: 700, background: '#fff7e6', color: '#fa8c16', border: '1px solid #ffd591', borderRadius: 6, padding: '2px 7px' },
  tagStaff: { fontSize: 11, fontWeight: 700, background: '#e6f4ff', color: '#1677ff', border: '1px solid #91caff', borderRadius: 6, padding: '2px 7px' },

  badgeBound: { fontSize: 11, color: '#52c41a', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 10, padding: '2px 7px' },
  badgeUnbound: { fontSize: 11, color: '#aaa', background: '#fafafa', border: '1px solid #e8e8e8', borderRadius: 10, padding: '2px 7px' },

  emptyHint: { fontSize: 13, color: '#bbb', textAlign: 'center', padding: '14px 0' },

  unbindBtn: {
    fontSize: 12, fontWeight: 600, color: '#ff4d4f',
    background: '#fff1f0', border: '1px solid #ffa39e',
    borderRadius: 6, padding: '5px 12px', cursor: 'pointer', flexShrink: 0,
  },

  linkBox: { width: '100%', background: '#f8f8f8', borderRadius: 8, padding: '8px 10px' },
  linkText: { fontSize: 11, color: '#1677ff', wordBreak: 'break-all' as const, textDecoration: 'none' },
}
