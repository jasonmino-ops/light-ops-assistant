'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { apiFetch, OWNER_CTX } from '@/lib/api'
import { useLocale } from '@/app/components/LangProvider'
import LangToggleBtn from '@/app/components/LangToggleBtn'

const SESSION_KEY = 'tg-authed-uid'

async function doLogout() {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
  sessionStorage.removeItem(SESSION_KEY)
  window.location.reload()
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Dimension = 'GLOBAL' | 'STORE' | 'STAFF'

type TopProduct = {
  name: string
  spec: string | null
  totalQty: number
}

type SummaryResult = {
  dateFrom: string
  dateTo: string
  dimension: Dimension
  storeName: string | null
  operatorDisplayName: string | null
  totalSaleAmount: number
  totalRefundAmount: number
  netAmount: number
  saleOrderCount: number
  refundOrderCount: number
  topProducts: TopProduct[]
}

// ─── Seed data (replace with API-driven options when auth is done) ─────────────

const STORES = [
  { id: 'seed-store-a', name: '总店' },
  { id: 'seed-store-b', name: '分店' },
]

const STAFFS = [
  { id: 'seed-user-staff-a', name: '小张（总店）' },
  { id: 'seed-user-staff-b', name: '小李（分店）' },
]

// DIM_LABEL is now computed dynamically inside the component using t()

// ─── Utils ────────────────────────────────────────────────────────────────────

function fmtAmount(n: number) {
  const abs = Math.abs(n).toFixed(2)
  return n < 0 ? `-$${abs}` : `$${abs}`
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { t } = useLocale()
  const [today] = useState(() => new Date().toISOString().slice(0, 10))
  const DIM_LABEL: Record<Dimension, string> = {
    GLOBAL: t('dashboard.dimGlobal'),
    STORE: t('dashboard.dimStore'),
    STAFF: t('dashboard.dimStaff'),
  }
  const [dimension, setDimension] = useState<Dimension>('GLOBAL')
  const [storeId, setStoreId] = useState(STORES[0].id)
  const [operatorUserId, setOperatorUserId] = useState(STAFFS[0].id)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SummaryResult | null>(null)

  const load = useCallback(
    async (dim: Dimension, sid: string, uid: string) => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ dateFrom: today, dateTo: today })
        if (dim === 'STORE') params.set('storeId', sid)
        if (dim === 'STAFF') params.set('operatorUserId', uid)

        const res = await apiFetch(`/api/summary?${params}`, undefined, OWNER_CTX)
        const body = await res.json()
        if (res.ok) {
          setResult(body)
        } else {
          setError(body.message ?? t('dashboard.loadFailed'))
        }
      } catch {
        setError(t('common.networkError'))
      } finally {
        setLoading(false)
      }
    },
    [today],
  )

  useEffect(() => {
    load(dimension, storeId, operatorUserId)
  }, [dimension, storeId, operatorUserId, load])

  function handleDimension(d: Dimension) {
    if (d === dimension) return
    setDimension(d)
    setResult(null)
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={s.page}>
      {/* Brand header */}
      <div style={s.header}>
        <div>
          <div style={s.brandName}>{t('dashboard.brandName')}</div>
          <div style={s.brandSub}>{t('dashboard.title')} · {today}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <LangToggleBtn />
          <Link href="/system" style={s.switchBtn}>系统</Link>
          <button
            style={s.refreshBtn}
            onClick={() => load(dimension, storeId, operatorUserId)}
            disabled={loading}
          >
            {loading ? '…' : t('dashboard.refresh')}
          </button>
        </div>
      </div>

      <div style={s.body}>
        {/* Dimension tabs */}
        <div style={s.dimRow}>
          {(['GLOBAL', 'STORE', 'STAFF'] as Dimension[]).map((d) => (
            <button
              key={d}
              style={{ ...s.dimBtn, ...(dimension === d ? s.dimBtnActive : {}) }}
              onClick={() => handleDimension(d)}
            >
              {DIM_LABEL[d]}
            </button>
          ))}
        </div>

        {/* Selector */}
        {dimension === 'STORE' && (
          <div style={s.selectorCard}>
            <div style={s.selectorLabel}>{t('dashboard.selectStore')}</div>
            <select
              style={s.select}
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
            >
              {STORES.map((st) => (
                <option key={st.id} value={st.id}>{st.name}</option>
              ))}
            </select>
          </div>
        )}

        {dimension === 'STAFF' && (
          <div style={s.selectorCard}>
            <div style={s.selectorLabel}>{t('dashboard.selectStaff')}</div>
            <select
              style={s.select}
              value={operatorUserId}
              onChange={(e) => setOperatorUserId(e.target.value)}
            >
              {STAFFS.map((st) => (
                <option key={st.id} value={st.id}>{st.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div style={s.loadingWrap}>
            <div style={s.skeleton} />
            <div style={{ ...s.skeleton, height: 88, marginTop: 10 }} />
            <div style={{ ...s.skeleton, height: 120, marginTop: 10 }} />
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div style={s.errorCard}>{error}</div>
        )}

        {/* Overview */}
        {!loading && result && <Overview result={result} t={t} />}
      </div>
    </div>
  )
}

// ─── Overview ─────────────────────────────────────────────────────────────────

function Overview({ result, t }: { result: SummaryResult; t: (k: string) => string }) {
  const subLabel =
    result.dimension === 'STORE'
      ? (result.storeName ?? '—')
      : result.dimension === 'STAFF'
      ? (result.operatorDisplayName ?? '—')
      : t('dashboard.subAll')

  return (
    <div>
      {/* Hero — net income */}
      <div style={ov.heroCard}>
        <div style={ov.heroSub}>{subLabel}</div>
        <div style={ov.heroLabel}>{t('dashboard.heroLabel')}</div>
        <div
          style={{
            ...ov.heroAmount,
            color: result.netAmount >= 0 ? '#a0f0a0' : '#ffccc7',
          }}
        >
          {fmtAmount(result.netAmount)}
        </div>
      </div>

      {/* Metrics 2×2 grid */}
      <div style={ov.grid}>
        <MetricCell label={t('dashboard.saleStat')} value={fmtAmount(result.totalSaleAmount)} />
        <MetricCell
          label={t('dashboard.refundStat')}
          value={fmtAmount(result.totalRefundAmount)}
          red={result.totalRefundAmount < 0}
        />
        <MetricCell label={t('dashboard.saleCount')} value={String(result.saleOrderCount)} unit={t('dashboard.orderUnit')} />
        <MetricCell label={t('dashboard.refundCount')} value={String(result.refundOrderCount)} unit={t('dashboard.orderUnit')} />
      </div>

      {/* Top 3 products */}
      <div style={ov.topCard}>
        <div style={ov.topTitle}>{t('dashboard.topTitle')}</div>
        {result.topProducts.length === 0 ? (
          <div style={ov.emptyTop}>{t('dashboard.noSales')}</div>
        ) : (
          result.topProducts.map((p, i) => (
            <div
              key={i}
              style={{
                ...ov.topRow,
                ...(i === result.topProducts.length - 1
                  ? { borderBottom: 'none', marginBottom: 0, paddingBottom: 0 }
                  : {}),
              }}
            >
              <div
                style={{
                  ...ov.rank,
                  ...(i === 0 ? ov.rank1 : i === 1 ? ov.rank2 : ov.rank3),
                }}
              >
                {i + 1}
              </div>
              <div style={ov.topName}>
                {p.name}
                {p.spec && <span style={ov.topSpec}> · {p.spec}</span>}
              </div>
              <div style={ov.topQty}>{p.totalQty} {t('dashboard.qtyUnit')}</div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function MetricCell({
  label,
  value,
  unit,
  red,
}: {
  label: string
  value: string
  unit?: string
  red?: boolean
}) {
  return (
    <div style={mc.cell}>
      <div style={{ ...mc.value, ...(red ? { color: 'var(--red)' } : {}) }}>
        {value}
        {unit && <span style={mc.unit}>{unit}</span>}
      </div>
      <div style={mc.label}>{label}</div>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'var(--bg)',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    background: 'var(--blue)',
    padding: '16px 16px 20px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  brandName: {
    fontSize: 18,
    fontWeight: 700,
    color: '#fff',
    letterSpacing: '0.02em',
  },
  brandSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 2,
  },
  switchBtn: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.75)',
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.3)',
    borderRadius: 12,
    padding: '3px 9px',
    cursor: 'pointer',
  },
  refreshBtn: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
    background: 'rgba(255,255,255,0.15)',
    border: '1px solid rgba(255,255,255,0.3)',
    borderRadius: 14,
    padding: '4px 14px',
    minWidth: 52,
  },
  body: {
    flex: 1,
    padding: '12px 12px 0',
    maxWidth: 480,
    margin: '0 auto',
    width: '100%',
  },
  dimRow: {
    display: 'flex',
    gap: 8,
    marginBottom: 10,
  },
  dimBtn: {
    flex: 1,
    height: 38,
    border: '1.5px solid var(--border)',
    borderRadius: 20,
    background: '#f7f8fa',
    fontSize: 14,
    color: 'var(--muted)',
    fontWeight: 500,
    cursor: 'pointer',
  },
  dimBtnActive: {
    background: 'var(--blue)',
    borderColor: 'var(--blue)',
    color: '#fff',
    fontWeight: 700,
  },
  selectorCard: {
    background: 'var(--card)',
    borderRadius: 'var(--radius)',
    padding: '12px 14px',
    marginBottom: 10,
  },
  selectorLabel: {
    fontSize: 11,
    color: 'var(--muted)',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    marginBottom: 8,
  },
  select: {
    height: 42,
    padding: '0 12px',
    border: '1.5px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 15,
    background: '#f7f8fa',
    outline: 'none',
    width: '100%',
    appearance: 'auto' as const,
  },
  loadingWrap: {
    marginTop: 4,
  },
  skeleton: {
    height: 160,
    borderRadius: 'var(--radius)',
    background: 'var(--card)',
    animation: 'pulse 1.4s ease-in-out infinite',
  },
  errorCard: {
    background: '#fff0f0',
    border: '1px solid #ffc0c0',
    borderRadius: 'var(--radius)',
    padding: '14px 16px',
    fontSize: 14,
    color: 'var(--red)',
    marginTop: 4,
  },
}

const ov: Record<string, React.CSSProperties> = {
  heroCard: {
    background: 'var(--blue)',
    borderRadius: 'var(--radius)',
    padding: '20px 18px 22px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    marginBottom: 10,
  },
  heroSub: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
    marginBottom: 6,
  },
  heroLabel: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
  },
  heroAmount: {
    fontSize: 44,
    fontWeight: 800,
    letterSpacing: '-0.03em',
    lineHeight: 1.1,
    marginTop: 2,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    background: 'var(--card)',
    borderRadius: 'var(--radius)',
    overflow: 'hidden',
    marginBottom: 10,
  },
  topCard: {
    background: 'var(--card)',
    borderRadius: 'var(--radius)',
    padding: '14px 16px',
    marginBottom: 12,
  },
  topTitle: {
    fontSize: 12,
    color: 'var(--muted)',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    marginBottom: 12,
  },
  topRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 12,
    marginBottom: 12,
    borderBottom: '1px solid var(--border)',
  },
  emptyTop: {
    fontSize: 14,
    color: 'var(--muted)',
    textAlign: 'center' as const,
    padding: '10px 0',
  },
  rank: {
    width: 26,
    height: 26,
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    fontWeight: 800,
    flexShrink: 0,
  },
  rank1: {
    background: '#ffe066',
    color: '#7a5400',
  },
  rank2: {
    background: '#d4d4d4',
    color: '#444',
  },
  rank3: {
    background: '#e8c19c',
    color: '#6b3a1f',
  },
  topName: {
    flex: 1,
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  topSpec: {
    fontWeight: 400,
    color: 'var(--muted)',
    fontSize: 13,
  },
  topQty: {
    fontSize: 15,
    fontWeight: 700,
    color: 'var(--blue)',
    flexShrink: 0,
  },
}

const mc: Record<string, React.CSSProperties> = {
  cell: {
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    borderTop: '1px solid var(--border)',
    borderRight: '1px solid var(--border)',
  },
  value: {
    fontSize: 20,
    fontWeight: 700,
    color: 'var(--text)',
  },
  unit: {
    fontSize: 12,
    fontWeight: 400,
    color: 'var(--muted)',
    marginLeft: 3,
  },
  label: {
    fontSize: 12,
    color: 'var(--muted)',
  },
}
