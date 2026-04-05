'use client'

import { useState, useEffect, useCallback } from 'react'
import QRCode from 'react-qr-code'
import { apiFetch, OWNER_CTX } from '@/lib/api'
import zh from '@/lib/i18n/zh'
import km from '@/lib/i18n/km'

function bi(zhStr: string, kmStr: string) {
  return (
    <>
      {zhStr}
      <br />
      <span style={{ fontSize: '0.85em', opacity: 0.72 }}>{kmStr}</span>
    </>
  )
}

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
  const [storesLoading, setStoresLoading] = useState(true)
  const [storesError, setStoresError] = useState('')
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
    setStoresLoading(true)
    setStoresError('')
    apiFetch('/api/stores', undefined, OWNER_CTX)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((list: Store[]) => {
        if (list.length === 0) {
          setStoresError('未找到门店信息，请联系管理员')
        } else {
          setStores(list)
          setStoreId(list[0].id)
        }
      })
      .catch(() => setStoresError('加载门店信息失败，请刷新重试'))
      .finally(() => setStoresLoading(false))
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
        <div style={s.headerTitle}>{bi(zh.invite.headerTitle, km.invite.headerTitle)}</div>
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

            {storesError && <div style={s.errorMsg}>{storesError}</div>}
            {genError && <div style={s.errorMsg}>{genError}</div>}

            <div style={s.actionRow}>
              <button
                style={{ ...s.ownerBtn, opacity: (storesLoading || !storeId || loading) ? 0.4 : 1 }}
                onClick={() => generate('OWNER')}
                disabled={storesLoading || !storeId || loading}
              >
                <span style={s.btnIcon}>🏪</span>
                <span style={s.btnText}>
                  <span style={s.btnLabel}>{bi(zh.invite.ownerCodeTitle, km.invite.ownerCodeTitle)}</span>
                  <span style={s.btnSub}>{storesLoading ? bi(zh.common.loading, km.common.loading) : bi(zh.invite.ownerCodeDesc, km.invite.ownerCodeDesc)}</span>
                </span>
              </button>
              <button
                style={{ ...s.staffBtn, opacity: (storesLoading || !storeId || loading) ? 0.4 : 1 }}
                onClick={() => generate('STAFF')}
                disabled={storesLoading || !storeId || loading}
              >
                <span style={s.btnIcon}>👤</span>
                <span style={s.btnText}>
                  <span style={s.btnLabel}>{bi(zh.invite.staffCodeTitle, km.invite.staffCodeTitle)}</span>
                  <span style={s.btnSub}>{storesLoading ? bi(zh.common.loading, km.common.loading) : bi(zh.invite.staffCodeDesc, km.invite.staffCodeDesc)}</span>
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
              <InfoRow label={bi(zh.invite.typeLabel, km.invite.typeLabel)} value={result.role === 'OWNER' ? bi(zh.invite.ownerCodeTitle, km.invite.ownerCodeTitle) : bi(zh.invite.staffCodeTitle, km.invite.staffCodeTitle)} />
              <InfoRow label={bi(zh.invite.infoStore, km.invite.infoStore)} value={result.storeName} />
              <InfoRow label={bi(zh.invite.validUntil, km.invite.validUntil)} value={fmtExpiry(result.expiresAt)} />
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
                  {copied ? bi(zh.invite.copied, km.invite.copied) : bi(zh.invite.copyLink, km.invite.copyLink)}
                </button>
                <div style={s.sendHint}>{bi(zh.invite.sendHint, km.invite.sendHint)}</div>
              </>
            )}
            <button style={s.resetBtn} onClick={reset}>{bi(zh.invite.resetBtn, km.invite.resetBtn)}</button>
          </div>
        )}

        {/* ── Members section ── */}
        <div style={s.sectionLabel}>{bi(zh.invite.membersTitle, km.invite.membersTitle)}</div>

        {/* Owner block */}
        {owners.length > 0 && (
          <div style={s.memberGroup}>
            <div style={s.groupLabel}>{bi(zh.invite.groupOwner, km.invite.groupOwner)}</div>
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
          <div style={s.groupLabel}>{bi(zh.invite.groupStaff, km.invite.groupStaff)}</div>
          {staff.length === 0 ? (
            <div style={s.emptyHint}>{bi(zh.invite.noStaff, km.invite.noStaff)}</div>
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
            {m.role === 'OWNER' ? bi(zh.invite.groupOwner, km.invite.groupOwner) : bi(zh.invite.groupStaff, km.invite.groupStaff)}
          </span>
          <span style={m.bound ? s.badgeBound : s.badgeUnbound}>
            {m.bound ? bi(zh.invite.bound, km.invite.bound) : bi(zh.invite.unbound, km.invite.unbound)}
          </span>
        </div>
      </div>
      {m.bound && (
        <button
          style={{ ...s.unbindBtn, opacity: unbinding === m.id ? 0.5 : 1 }}
          disabled={unbinding === m.id}
          onClick={() => onUnbind(m.id, name)}
        >
          {bi(zh.invite.unbindBtn, km.invite.unbindBtn)}
        </button>
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
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
  sendHint: { fontSize: 12, color: '#8c8c8c', textAlign: 'center' as const, lineHeight: 1.5 },
}
