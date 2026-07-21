'use client'

import { useState, useEffect, useCallback } from 'react'
import QRCode from 'react-qr-code'
import { apiFetch, OWNER_CTX } from '@/lib/api'
import { publicCustomerEntryUrl } from '@/lib/public-url'
import { useLocale } from '@/app/components/LangProvider'
import LangToggleBtn from '@/app/components/LangToggleBtn'
import { useWorkMode } from '@/app/components/WorkModeProvider'

type Store = { id: string; name: string; code: string }

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

function fmtExpiry(iso: string, lang: 'zh' | 'km' | 'en') {
  const locale = lang === 'km' ? 'km-KH' : lang === 'en' ? 'en-US' : 'zh-CN'
  return new Date(iso).toLocaleString(locale, {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function InvitePage() {
  const { lang, t } = useLocale()
  const {
    realRole, isOwnerInStaffMode,
    storeName: contextStoreName, tenantName: contextTenantName,
  } = useWorkMode()
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

  const [customerStoreId, setCustomerStoreId] = useState('')
  const [customerCopied, setCustomerCopied] = useState(false)
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
          setStoresError(t('invite.storesNotFound'))
        } else {
          setStores(list)
          setStoreId(list[0].id)
          setCustomerStoreId(list[0].id)
        }
      })
      .catch(() => setStoresError(t('invite.storesLoadFailed')))
      .finally(() => setStoresLoading(false))
    loadMembers()
  }, [loadMembers, lang])

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
      else setGenError(body.message ?? body.error ?? t('invite.genFailed'))
    } catch {
      setGenError(t('common.networkError'))
    } finally {
      setLoading(false)
    }
  }

  function copyLink() {
    if (!result?.tgLink) return
    const text = result.tgLink

    // Clipboard API may be unavailable in some Android WebViews — fall back to execCommand
    const doFallback = () => {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      try {
        document.execCommand('copy')
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch {
        // Copy failed silently — button stays unchanged, user can long-press to copy manually
      }
      document.body.removeChild(ta)
    }

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }).catch(doFallback)
    } else {
      doFallback()
    }
  }

  function reset() {
    setResult(null)
    setGenError('')
    setCopied(false)
    loadMembers()
  }

  async function unbind(userId: string, name: string) {
    const confirmText = t('invite.unbindConfirm').replace('{name}', name)
    if (!window.confirm(confirmText)) return
    setUnbinding(userId)
    try {
      const r = await apiFetch(`/api/admin/users/${userId}/unbind`, { method: 'POST' }, OWNER_CTX)
      const body = await r.json()
      if (r.ok) loadMembers()
      else window.alert(body.message ?? body.error ?? t('invite.unbindFailed'))
    } catch {
      window.alert(t('common.networkError'))
    } finally {
      setUnbinding(null)
    }
  }

  const activeMembers = members.filter((m) => m.status === 'ACTIVE')
  const owners = activeMembers.filter((m) => m.role === 'OWNER')
  const staff = activeMembers.filter((m) => m.role === 'STAFF')
  const currentStoreName = stores.find((st) => st.id === storeId)?.name ?? contextStoreName ?? contextTenantName ?? 'E-Shop'
  const storeInitial = currentStoreName.trim().slice(0, 1).toUpperCase() || '店'

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div style={s.brandLeft}>
          <span style={s.brandAvatar}>{storeInitial}</span>
          <div style={s.brandText}>
            <div style={s.headerTitle}>{currentStoreName}</div>
            <div style={s.headerSub}>{t('home.brandSub')}</div>
          </div>
        </div>
        <div style={s.headerTools}>
          <LangToggleBtn />
          {realRole === 'OWNER' && (
            <span style={isOwnerInStaffMode ? s.modeTag : { ...s.modeTag, ...s.modeTagOwner }}>
              {isOwnerInStaffMode ? t('home.modeLabelStaff') : t('home.modeLabelOwner')}
            </span>
          )}
        </div>
      </div>

      <div style={s.body}>
        <div style={s.heroCard}>
          <div>
            <div style={s.heroEyebrow}>{t('invite.heroEyebrow')}</div>
            <div style={s.heroTitle}>{t('invite.heroTitle')}</div>
            <div style={s.heroDesc}>{t('invite.heroDesc')}</div>
          </div>
          <div style={s.statRow}>
            <StatPill label={t('invite.activeMembers')} value={String(activeMembers.length)} />
            <StatPill label={t('invite.groupOwner')} value={String(owners.length)} />
            <StatPill label={t('invite.groupStaff')} value={String(staff.length)} />
          </div>
        </div>

        {/* ── Generate section ── */}
        {!result ? (
          <div style={s.card}>
            <div style={s.cardHeaderCompact}>
              <div style={s.cardTitle}>{t('invite.primaryActionsTitle')}</div>
              <div style={s.cardDesc}>{t('invite.primaryActionsDesc')}</div>
            </div>
            {stores.length > 1 && (
              <div style={s.field}>
                <label style={s.fieldLabel}>{t('invite.infoStore')}</label>
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
                  <span style={s.btnLabel}>{t('invite.ownerCodeTitle')}</span>
                  <span style={s.btnSub}>{storesLoading ? t('common.loading') : t('invite.ownerCodeDesc')}</span>
                </span>
              </button>
              <button
                style={{ ...s.staffBtn, opacity: (storesLoading || !storeId || loading) ? 0.4 : 1 }}
                onClick={() => generate('STAFF')}
                disabled={storesLoading || !storeId || loading}
              >
                <span style={s.btnIcon}>👤</span>
                <span style={s.btnText}>
                  <span style={s.btnLabel}>{t('invite.staffCodeTitle')}</span>
                  <span style={s.btnSub}>{storesLoading ? t('common.loading') : t('invite.staffCodeDesc')}</span>
                </span>
              </button>
            </div>
          </div>
        ) : (
          <div style={s.resultWrap}>
            <button type="button" style={s.backBtn} onClick={reset}>
              {t('invite.backToInvite')}
            </button>

            <div style={s.qrCard}>
              {result.tgLink
                ? <QRCode value={result.tgLink} size={200} style={{ display: 'block' }} />
                : <div style={s.noLink}>{t('invite.noTelegramBot')}</div>
              }
            </div>

            <div style={s.infoCard}>
              <InfoRow label={t('invite.typeLabel')} value={result.role === 'OWNER' ? t('invite.ownerCodeTitle') : t('invite.staffCodeTitle')} />
              <InfoRow label={t('invite.infoStore')} value={result.storeName} />
              <InfoRow label={t('invite.validUntil')} value={fmtExpiry(result.expiresAt, lang)} />
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
                  {copied ? t('invite.copied') : t('invite.copyLink')}
                </button>
                <div style={s.sendHint}>{t('invite.sendHint')}</div>
              </>
            )}
            <button style={s.resetBtn} onClick={reset}>{t('invite.resetBtn')}</button>
          </div>
        )}

        {/* ── Customer order code ── */}
        <div style={s.sectionCard}>
          <div style={s.sectionHeader}>
            <div>
              <div style={s.sectionTitle}>{t('invite.customerEntrancesTitle')}</div>
              <div style={s.sectionDesc}>{t('invite.customerEntrancesDesc')}</div>
            </div>
          </div>
          <CustomerCodeCard
            stores={stores}
            customerStoreId={customerStoreId}
            setCustomerStoreId={setCustomerStoreId}
            copied={customerCopied}
            setCopied={setCustomerCopied}
          />

          {/* ── Table QR codes ── */}
          <div style={{ ...s.customerCard, ...s.slimCard, gap: 10 }}>
            <div style={s.customerDesc}>
              {t('invite.tableQrDesc')}
            </div>
            <button
              style={s.secondaryActionBtn}
              onClick={() => { window.location.href = '/table-qrcodes' }}
            >
              {t('invite.tableQrManage')}
            </button>
          </div>
        </div>

        {/* ── Members section ── */}
        <div style={s.sectionLabel}>{t('invite.membersTitle')}</div>

        {/* Owner block */}
        {owners.length > 0 && (
          <div style={s.memberGroup}>
            <div style={s.groupLabel}>{t('invite.groupOwner')}</div>
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
          <div style={s.groupLabel}>{t('invite.groupStaff')}</div>
          {staff.length === 0 ? (
            <div style={s.emptyHint}>{t('invite.noStaff')}</div>
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
  const { t } = useLocale()
  const name = m.displayName || m.username
  return (
    <div style={s.memberCard}>
      <div style={s.memberLeft}>
        <div style={s.memberName}>{name}</div>
        <div style={s.memberMeta}>
          <span style={m.role === 'OWNER' ? s.tagOwner : s.tagStaff}>
            {m.role === 'OWNER' ? t('invite.groupOwner') : t('invite.groupStaff')}
          </span>
          <span style={m.bound ? s.badgeBound : s.badgeUnbound}>
            {m.bound ? t('invite.bound') : t('invite.unbound')}
          </span>
        </div>
      </div>
      {m.bound && (
        <button
          style={{ ...s.unbindBtn, opacity: unbinding === m.id ? 0.5 : 1 }}
          disabled={unbinding === m.id}
          onClick={() => onUnbind(m.id, name)}
        >
          {t('invite.unbindBtn')}
        </button>
      )}
    </div>
  )
}

function CustomerCodeCard({
  stores,
  customerStoreId,
  setCustomerStoreId,
  copied,
  setCopied,
}: {
  stores: Store[]
  customerStoreId: string
  setCustomerStoreId: (id: string) => void
  copied: boolean
  setCopied: (v: boolean) => void
}) {
  const { t } = useLocale()
  const current = stores.find((st) => st.id === customerStoreId)
  const url = current ? publicCustomerEntryUrl(current.code) : ''

  function copy() {
    if (!url) return

    const doFallback = () => {
      const ta = document.createElement('textarea')
      ta.value = url
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      try {
        document.execCommand('copy')
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch {}
      document.body.removeChild(ta)
    }

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }).catch(doFallback)
    } else {
      doFallback()
    }
  }

  return (
    <>
      <div style={s.customerCard}>
        <div style={s.cardTitle}>{t('invite.customerCodeTitle')}</div>
        <div style={s.customerDesc}>{t('invite.customerCodeDesc')}</div>

        {stores.length > 1 && (
          <div style={s.field}>
            <label style={s.fieldLabel}>{t('invite.customerCodeStoreLabel')}</label>
            <select
              style={s.select}
              value={customerStoreId}
              onChange={(e) => setCustomerStoreId(e.target.value)}
            >
              {stores.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
            </select>
          </div>
        )}

        <div style={s.qrCard}>
          {url
            ? <QRCode value={url} size={200} style={{ display: 'block' }} />
            : <div style={s.noLink}>—</div>
          }
        </div>

        {url && (
          <>
            <div style={s.linkBox}>
              <a href={url} target="_blank" rel="noreferrer" style={s.linkText}>{url}</a>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={copied ? { ...s.copyBtn, background: '#52c41a' } : s.copyBtn} onClick={copy}>
                {copied ? t('invite.copied') : t('invite.copyLink')}
              </button>
              <button
                style={{ height: 48, flex: '0 0 auto', padding: '0 16px', background: '#f0f6ff', color: '#1d4ed8', border: '1.5px solid #93c5fd', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
              >
                {t('invite.openLink')}
              </button>
            </div>
          </>
        )}
      </div>
    </>
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

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div style={s.statPill}>
      <span style={s.statValue}>{value}</span>
      <span style={s.statLabel}>{label}</span>
    </div>
  )
}

const ir: Record<string, React.CSSProperties> = {
  row: { display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f5f5f5' },
  label: { fontSize: 13, color: '#8c8c8c' },
  value: { fontSize: 13, fontWeight: 600, color: '#1a1a1a' },
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f7f8fa', display: 'flex', flexDirection: 'column' },
  header: {
    padding: '2px 2px 10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    maxWidth: 520,
    margin: '0 auto',
    width: '100%',
    boxSizing: 'border-box',
    minHeight: 56,
  },
  brandLeft: { display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 0, flex: 1 },
  brandAvatar: {
    width: 44,
    height: 44,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #111827 0%, #4b5563 100%)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 18,
    fontWeight: 900,
    boxShadow: '0 10px 24px rgba(15,23,42,0.16)',
    flexShrink: 0,
  },
  brandText: { minWidth: 0 },
  headerTitle: { fontSize: 18, fontWeight: 800, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2 },
  headerSub: { fontSize: 11, color: '#6b7280', marginTop: 3, fontWeight: 500 },
  headerTools: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0, minWidth: 118 },
  modeTag: {
    minHeight: 30,
    borderRadius: 999,
    border: '1px solid #e5e7eb',
    background: '#fff',
    color: '#374151',
    padding: '0 10px',
    fontSize: 11,
    fontWeight: 700,
    whiteSpace: 'nowrap',
    boxShadow: '0 4px 14px rgba(15,23,42,0.06)',
    display: 'inline-flex',
    alignItems: 'center',
  },
  modeTagOwner: { background: '#fff7ed', color: '#c2410c', borderColor: '#fed7aa' },

  body: { flex: 1, padding: '4px 14px 88px', maxWidth: 520, margin: '0 auto', width: '100%', boxSizing: 'border-box' },
  heroCard: {
    background: 'linear-gradient(135deg,#eff6ff 0%,#fff7ed 58%,#ffffff 100%)',
    borderRadius: 24,
    padding: '13px 14px',
    boxShadow: '0 14px 30px rgba(37,99,235,0.08)',
    marginBottom: 10,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.15fr) minmax(150px, 0.85fr)',
    gap: 10,
    alignItems: 'center',
  },
  heroEyebrow: { fontSize: 10, color: '#2563eb', fontWeight: 850, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '0.04em' },
  heroTitle: { fontSize: 22, lineHeight: 1.08, fontWeight: 900, color: '#111827' },
  heroDesc: { fontSize: 12, color: '#4b5563', lineHeight: 1.38, marginTop: 5 },
  statRow: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 },
  statPill: { background: 'rgba(255,255,255,0.82)', border: '1px solid rgba(255,255,255,0.92)', borderRadius: 14, padding: '8px 5px', textAlign: 'center' as const },
  statValue: { display: 'block', fontSize: 17, fontWeight: 950, color: '#111827', lineHeight: 1 },
  statLabel: { display: 'block', fontSize: 10, color: '#6b7280', marginTop: 3, whiteSpace: 'nowrap' },

  card: {
    background: '#fff', borderRadius: 22, padding: '13px 14px',
    display: 'flex', flexDirection: 'column', gap: 12,
    boxShadow: '0 10px 28px rgba(15,23,42,0.06)', marginBottom: 10,
  },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  cardHeaderCompact: { display: 'grid', gap: 3 },
  cardTitle: { fontSize: 16, fontWeight: 850, color: '#111827' },
  cardDesc: { fontSize: 12, color: '#6b7280', marginTop: 3, lineHeight: 1.45 },
  field: { display: 'flex', flexDirection: 'column', gap: 8 },
  fieldLabel: { fontSize: 12, fontWeight: 600, color: '#8c8c8c' },
  select: { height: 44, border: '1.5px solid #e8e8e8', borderRadius: 8, padding: '0 12px', fontSize: 15, background: '#fafafa', color: '#1a1a1a' },
  errorMsg: { fontSize: 13, color: '#ff4d4f', textAlign: 'center' },

  actionRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 },
  ownerBtn: {
    flex: 1, display: 'flex', alignItems: 'center', gap: 10,
    background: 'linear-gradient(135deg,#fff7ed,#ffffff)', border: '1px solid #fed7aa', borderRadius: 18,
    padding: '13px 11px', cursor: 'pointer', textAlign: 'left' as const,
    boxShadow: '0 8px 18px rgba(249,115,22,0.08)',
  },
  staffBtn: {
    flex: 1, display: 'flex', alignItems: 'center', gap: 10,
    background: 'linear-gradient(135deg,#eff6ff,#ffffff)', border: '1px solid #bfdbfe', borderRadius: 18,
    padding: '13px 11px', cursor: 'pointer', textAlign: 'left' as const,
    boxShadow: '0 8px 18px rgba(37,99,235,0.08)',
  },
  btnIcon: { fontSize: 22, lineHeight: 1 },
  btnText: { display: 'flex', flexDirection: 'column', gap: 2 },
  btnLabel: { fontSize: 13, fontWeight: 700, color: '#1a1a1a' },
  btnSub: { fontSize: 11, color: '#8c8c8c' },

  resultWrap: { display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 },
  backBtn: {
    alignSelf: 'flex-start',
    background: 'none',
    border: 'none',
    padding: 0,
    color: '#1677ff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  qrCard: { background: '#fff', borderRadius: 18, padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 28px rgba(15,23,42,0.06)' },
  noLink: { fontSize: 13, color: '#aaa', textAlign: 'center', padding: '16px 0' },
  infoCard: { background: '#fff', borderRadius: 18, padding: '4px 16px', boxShadow: '0 10px 28px rgba(15,23,42,0.06)' },
  copyBtn: { height: 48, background: '#1677ff', color: '#fff', border: 'none', borderRadius: 14, fontSize: 15, fontWeight: 750, cursor: 'pointer' },
  resetBtn: { height: 44, background: 'transparent', color: '#666', border: '1.5px solid #e8e8e8', borderRadius: 10, fontSize: 14, cursor: 'pointer' },

  sectionLabel: { fontSize: 12, fontWeight: 700, color: '#8c8c8c', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 10 },
  sectionCard: { background: '#fff', borderRadius: 22, padding: '16px 16px 4px', boxShadow: '0 10px 28px rgba(15,23,42,0.06)', marginBottom: 12 },
  sectionHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: 850, color: '#111827' },
  sectionDesc: { fontSize: 12, color: '#6b7280', lineHeight: 1.45, marginTop: 3 },

  customerCard: {
    background: '#fff', borderRadius: 18, padding: '16px 16px',
    display: 'flex', flexDirection: 'column', gap: 12,
    boxShadow: '0 10px 28px rgba(15,23,42,0.06)', marginBottom: 12,
  },
  slimCard: { boxShadow: 'none', border: '1px solid #eef2f7', background: '#fbfdff' },
  secondaryActionBtn: { height: 44, background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0', borderRadius: 14, fontSize: 14, fontWeight: 750, cursor: 'pointer' },
  customerDesc: { fontSize: 13, color: '#8c8c8c', lineHeight: 1.5 },

  memberGroup: { marginBottom: 16 },
  groupLabel: { fontSize: 11, fontWeight: 700, color: '#bbb', marginBottom: 6, paddingLeft: 2 },

  memberCard: {
    background: '#fff', borderRadius: 16, padding: '12px 14px',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    boxShadow: '0 8px 20px rgba(15,23,42,0.05)', marginBottom: 8,
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
