'use client'

import { useState, useEffect, useCallback } from 'react'
import QRCode from 'react-qr-code'
import { apiFetch, OWNER_CTX } from '@/lib/api'
import { useLocale } from '@/app/components/LangProvider'
import LangToggleBtn from '@/app/components/LangToggleBtn'

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
  bound: boolean
  storeName: string
}

function fmtExpiry(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function InvitePage() {
  const { t } = useLocale()
  // ── Generate form ────────────────────────────────────────────────────────
  const [stores, setStores] = useState<Store[]>([])
  const [storeId, setStoreId] = useState('')
  const [label, setLabel] = useState('')
  const [expiresInHours, setExpiresInHours] = useState(48)
  const [maxUses, setMaxUses] = useState(1)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<BindTokenResult | null>(null)
  const [genError, setGenError] = useState('')
  const [copied, setCopied] = useState(false)

  // ── Member list ──────────────────────────────────────────────────────────
  const [members, setMembers] = useState<Member[]>([])
  const [unbinding, setUnbinding] = useState<string | null>(null) // userId being unbound

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
          label: label.trim() || undefined,
          expiresInHours,
          maxUses,
        }),
      }, OWNER_CTX)
      const body = await r.json()
      if (r.ok) setResult(body)
      else setGenError(body.message ?? body.error ?? t('invite.genFailed'))
    } catch {
      setGenError(t('common.networkError'))
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
    setLabel('')
  }

  // ── Unbind ───────────────────────────────────────────────────────────────
  async function unbind(userId: string, displayName: string) {
    if (!window.confirm(`${t('invite.unbindBtn')}「${displayName}」?`)) return
    setUnbinding(userId)
    try {
      const r = await apiFetch(`/api/admin/users/${userId}/unbind`, {
        method: 'POST',
      }, OWNER_CTX)
      const body = await r.json()
      if (r.ok) loadMembers()
      else window.alert(body.message ?? body.error ?? t('invite.unbindFailed'))
    } catch {
      window.alert(t('common.networkError'))
    } finally {
      setUnbinding(null)
    }
  }

  const qrValue = result?.tgLink ?? ''

  return (
    <div style={s.page}>
      <div style={{ ...s.header, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={s.headerTitle}>{t('invite.title')}</div>
        <LangToggleBtn />
      </div>

      <div style={s.body}>
        {/* ── Generate section ── */}
        <div style={s.sectionTitle}>{t('invite.genSection')}</div>

        {!result ? (
          <div style={s.card}>
            <div style={s.field}>
              <label style={s.fieldLabel}>{t('invite.fieldStore')}</label>
              {stores.length === 0 ? (
                <div style={s.placeholder}>{t('invite.loading')}</div>
              ) : (
                <select style={s.select} value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                  {stores.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                </select>
              )}
            </div>

            <div style={s.field}>
              <label style={s.fieldLabel}>{t('invite.fieldNote')}</label>
              <input
                style={s.input}
                type="text"
                placeholder={t('invite.notePlaceholder')}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={40}
              />
            </div>

            <div style={s.field}>
              <label style={s.fieldLabel}>{t('invite.fieldExpiry')}</label>
              <div style={s.radioRow}>
                {[{ h: 24, lbl: '24h' }, { h: 48, lbl: '48h' }, { h: 168, lbl: '7d' }].map(({ h, lbl }) => (
                  <button
                    key={h}
                    style={{ ...s.radioBtn, ...(expiresInHours === h ? s.radioBtnActive : {}) }}
                    onClick={() => setExpiresInHours(h)}
                  >{lbl}</button>
                ))}
              </div>
            </div>

            <div style={s.field}>
              <label style={s.fieldLabel}>{t('invite.fieldUses')}</label>
              <div style={s.radioRow}>
                {[1, 3, 5].map((n) => (
                  <button
                    key={n}
                    style={{ ...s.radioBtn, ...(maxUses === n ? s.radioBtnActive : {}) }}
                    onClick={() => setMaxUses(n)}
                  >{n}x</button>
                ))}
              </div>
            </div>

            {genError && <div style={s.errorMsg}>{genError}</div>}

            <button
              style={{ ...s.genBtn, opacity: loading ? 0.6 : 1 }}
              onClick={generate}
              disabled={loading || !storeId}
            >
              {loading ? t('invite.generating') : t('invite.genBtn')}
            </button>
          </div>
        ) : (
          <div style={s.resultWrap}>
            <div style={s.qrCard}>
              {qrValue
                ? <QRCode value={qrValue} size={180} style={{ display: 'block' }} />
                : <div style={s.noLink}>{t('invite.noTgLink')}</div>
              }
            </div>

            <div style={s.infoCard}>
              <InfoRow label={t('invite.infoRole')} value={result.role === 'OWNER' ? t('invite.roleOwner') : t('invite.roleStaff')} />
              <InfoRow label={t('invite.infoStore')} value={result.storeName} />
              <InfoRow label={t('invite.infoNote')} value={result.label ?? '—'} />
              <InfoRow label={t('invite.infoExpiry')} value={fmtExpiry(result.expiresAt)} />
              <InfoRow label={t('invite.infoMaxUses')} value={`${result.maxUses}x`} />
              <InfoRow label={t('invite.infoStatus')} value={t('invite.statusValid')} color="#52c41a" />
            </div>

            {result.tgLink && (
              <button style={s.copyBtn} onClick={copyLink}>
                {copied ? t('invite.copied') : t('invite.copyLink')}
              </button>
            )}

            <button style={s.resetBtn} onClick={reset}>{t('invite.genAnother')}</button>
          </div>
        )}

        {/* ── Members section ── */}
        <div style={{ ...s.sectionTitle, marginTop: 24 }}>{t('invite.membersSection')}</div>

        {members.length === 0 ? (
          <div style={s.emptyHint}>{t('invite.noMembers')}</div>
        ) : (
          <div style={s.memberList}>
            {members.map((m) => (
              <div key={m.id} style={s.memberCard}>
                <div style={s.memberLeft}>
                  <div style={s.memberName}>{m.displayName}</div>
                  <div style={s.memberMeta}>
                    <span style={m.role === 'OWNER' ? s.tagOwner : s.tagStaff}>
                      {m.role === 'OWNER' ? t('invite.roleOwner') : t('invite.roleStaff')}
                    </span>
                    <span style={s.metaDot}>·</span>
                    <span style={s.metaStore}>{m.storeName}</span>
                  </div>
                </div>
                <div style={s.memberRight}>
                  <span style={m.bound ? s.badgeBound : s.badgeUnbound}>
                    {m.bound ? t('invite.bound') : t('invite.unbound')}
                  </span>
                  {m.bound && (
                    <button
                      style={{ ...s.unbindBtn, opacity: unbinding === m.id ? 0.5 : 1 }}
                      disabled={unbinding === m.id}
                      onClick={() => unbind(m.id, m.displayName)}
                    >
                      {t('invite.unbindBtn')}
                    </button>
                  )}
                </div>
              </div>
            ))}
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
  headerSub: { fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 4 },

  body: { flex: 1, padding: '16px 12px 80px', maxWidth: 480, margin: '0 auto', width: '100%' },
  sectionTitle: { fontSize: 12, fontWeight: 700, color: '#8c8c8c', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 },

  card: {
    background: '#fff', borderRadius: 14, padding: '18px 16px',
    display: 'flex', flexDirection: 'column', gap: 16,
    boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
  },
  field: { display: 'flex', flexDirection: 'column', gap: 8 },
  fieldLabel: { fontSize: 12, fontWeight: 600, color: '#8c8c8c', textTransform: 'uppercase', letterSpacing: '0.04em' },
  select: { height: 44, border: '1.5px solid #e8e8e8', borderRadius: 8, padding: '0 12px', fontSize: 15, background: '#fafafa', color: '#1a1a1a' },
  input: { height: 44, border: '1.5px solid #e8e8e8', borderRadius: 8, padding: '0 12px', fontSize: 15, background: '#fafafa', outline: 'none' },
  placeholder: { fontSize: 14, color: '#bbb', padding: '10px 0' },

  radioRow: { display: 'flex', gap: 8 },
  radioBtn: { flex: 1, height: 36, border: '1.5px solid #e8e8e8', borderRadius: 8, background: '#fafafa', fontSize: 13, color: '#666', cursor: 'pointer' },
  radioBtnActive: { borderColor: '#1677ff', background: '#e6f4ff', color: '#1677ff', fontWeight: 700 },

  errorMsg: { fontSize: 13, color: '#ff4d4f', textAlign: 'center' },
  genBtn: { height: 48, background: '#1677ff', color: '#fff', border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 700, cursor: 'pointer' },

  resultWrap: { display: 'flex', flexDirection: 'column', gap: 12 },
  qrCard: { background: '#fff', borderRadius: 14, padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' },
  noLink: { fontSize: 13, color: '#aaa', textAlign: 'center', padding: '16px 0' },
  infoCard: { background: '#fff', borderRadius: 14, padding: '4px 16px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' },
  copyBtn: { height: 48, background: '#1677ff', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: 'pointer' },
  resetBtn: { height: 44, background: 'transparent', color: '#666', border: '1.5px solid #e8e8e8', borderRadius: 10, fontSize: 14, cursor: 'pointer' },

  emptyHint: { fontSize: 14, color: '#bbb', textAlign: 'center', padding: '20px 0' },
  memberList: { display: 'flex', flexDirection: 'column', gap: 8 },
  memberCard: {
    background: '#fff', borderRadius: 12, padding: '12px 14px',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
  },
  memberLeft: { display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 },
  memberName: { fontSize: 15, fontWeight: 600, color: '#1a1a1a' },
  memberMeta: { display: 'flex', alignItems: 'center', gap: 6 },
  metaDot: { color: '#d9d9d9', fontSize: 12 },
  metaStore: { fontSize: 12, color: '#8c8c8c' },

  tagOwner: { fontSize: 10, fontWeight: 700, background: '#fff7e6', color: '#fa8c16', border: '1px solid #ffd591', borderRadius: 4, padding: '1px 5px' },
  tagStaff: { fontSize: 10, fontWeight: 700, background: '#e6f4ff', color: '#1677ff', border: '1px solid #91caff', borderRadius: 4, padding: '1px 5px' },

  memberRight: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 },
  badgeBound: { fontSize: 11, fontWeight: 600, color: '#52c41a', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 10, padding: '2px 8px' },
  badgeUnbound: { fontSize: 11, color: '#aaa', background: '#fafafa', border: '1px solid #e8e8e8', borderRadius: 10, padding: '2px 8px' },
  unbindBtn: {
    fontSize: 12, fontWeight: 600, color: '#ff4d4f',
    background: '#fff1f0', border: '1px solid #ffa39e',
    borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
  },
}
