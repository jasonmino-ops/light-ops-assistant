'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { apiFetch, OWNER_CTX } from '@/lib/api'
import { useLocale } from '@/app/components/LangProvider'
import LangToggleBtn from '@/app/components/LangToggleBtn'

// ─── Types ────────────────────────────────────────────────────────────────────

type Dimension = 'GLOBAL' | 'STORE' | 'STAFF'
type TimePeriod = 'TODAY' | 'WEEK' | 'MONTH' | 'CUSTOM'

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
  cashSaleAmount?: number
  khqrSaleAmount?: number
}

// ─── Seed data ─────────────────────────────────────────────────────────────────

const STORES = [
  { id: 'seed-store-a', name: '总店' },
  { id: 'seed-store-b', name: '分店' },
]

const STAFFS = [
  { id: 'seed-user-staff-a', name: '小张（总店）' },
  { id: 'seed-user-staff-b', name: '小李（分店）' },
]

// ─── Utils ────────────────────────────────────────────────────────────────────

function fmtAmount(n: number) {
  const abs = Math.abs(n).toFixed(2)
  return n < 0 ? `-$${abs}` : `$${abs}`
}

function getWeekStart(today: string): string {
  const d = new Date(today + 'T00:00:00.000Z')
  const dow = d.getUTCDay()
  const diff = dow === 0 ? 6 : dow - 1 // 周一为起点
  d.setUTCDate(d.getUTCDate() - diff)
  return d.toISOString().slice(0, 10)
}

function getMonthStart(today: string): string {
  return today.slice(0, 8) + '01'
}

function getPeriodRange(
  period: TimePeriod,
  today: string,
  cFrom: string,
  cTo: string,
): { from: string; to: string } {
  switch (period) {
    case 'TODAY':  return { from: today, to: today }
    case 'WEEK':   return { from: getWeekStart(today), to: today }
    case 'MONTH':  return { from: getMonthStart(today), to: today }
    case 'CUSTOM': return { from: cFrom || today, to: cTo || today }
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { t } = useLocale()
  const [today] = useState(() => new Date().toISOString().slice(0, 10))

  const DIM_LABEL: Record<Dimension, string> = {
    GLOBAL: t('dashboard.dimGlobal'),
    STORE:  t('dashboard.dimStore'),
    STAFF:  t('dashboard.dimStaff'),
  }
  const PERIOD_LABEL: Record<TimePeriod, string> = {
    TODAY:  t('dashboard.periodToday'),
    WEEK:   t('dashboard.periodWeek'),
    MONTH:  t('dashboard.periodMonth'),
    CUSTOM: t('dashboard.periodCustom'),
  }

  const [dimension, setDimension]               = useState<Dimension>('GLOBAL')
  const [storeId, setStoreId]                   = useState(STORES[0].id)
  const [operatorUserId, setOperatorUserId]     = useState(STAFFS[0].id)
  const [timePeriod, setTimePeriod]             = useState<TimePeriod>('TODAY')
  const [customFrom, setCustomFrom]             = useState('')
  const [customTo, setCustomTo]                 = useState('')
  const [loading, setLoading]                   = useState(true)
  const [error, setError]                       = useState<string | null>(null)
  const [result, setResult]                     = useState<SummaryResult | null>(null)
  const [weekHot, setWeekHot]                   = useState<TopProduct[]>([])
  const [monthHot, setMonthHot]                 = useState<TopProduct[]>([])
  const [hotLoading, setHotLoading]             = useState(false)
  const [showStoreConfig, setShowStoreConfig]   = useState(false)

  const load = useCallback(
    async (dim: Dimension, sid: string, uid: string, period: TimePeriod, cFrom: string, cTo: string) => {
      setLoading(true)
      setError(null)
      try {
        const { from, to } = getPeriodRange(period, today, cFrom, cTo)
        const params = new URLSearchParams({ dateFrom: from, dateTo: to })
        if (dim === 'STORE') params.set('storeId', sid)
        if (dim === 'STAFF') params.set('operatorUserId', uid)

        const res = await apiFetch(`/api/summary?${params}`, undefined, OWNER_CTX)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let body: any
        try { body = await res.json() } catch { body = null }
        if (res.ok && body) {
          setResult(body)
        } else {
          setError(body?.message ?? t('dashboard.loadFailed'))
        }
      } catch {
        setError(t('common.networkError'))
      } finally {
        setLoading(false)
      }
    },
    [today], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const loadHot = useCallback(
    async (dim: Dimension, sid: string) => {
      if (dim === 'STAFF') {
        setWeekHot([])
        setMonthHot([])
        return
      }
      setHotLoading(true)
      const weekFrom  = getWeekStart(today)
      const monthFrom = getMonthStart(today)
      try {
        const buildParams = (from: string) => {
          const pp = new URLSearchParams({ dateFrom: from, dateTo: today })
          if (dim === 'STORE') pp.set('storeId', sid)
          return pp.toString()
        }
        const [wRes, mRes] = await Promise.all([
          apiFetch(`/api/summary?${buildParams(weekFrom)}`,  undefined, OWNER_CTX),
          apiFetch(`/api/summary?${buildParams(monthFrom)}`, undefined, OWNER_CTX),
        ])
        const [wBody, mBody] = await Promise.all([
          wRes.ok ? wRes.json() : null,
          mRes.ok ? mRes.json() : null,
        ])
        setWeekHot((wBody?.topProducts  as TopProduct[] | undefined) ?? [])
        setMonthHot((mBody?.topProducts as TopProduct[] | undefined) ?? [])
      } catch {
        // silent
      } finally {
        setHotLoading(false)
      }
    },
    [today],
  )

  useEffect(() => {
    if (timePeriod === 'CUSTOM' && (!customFrom || !customTo)) return
    load(dimension, storeId, operatorUserId, timePeriod, customFrom, customTo)
  }, [dimension, storeId, operatorUserId, timePeriod, customFrom, customTo, load])

  useEffect(() => {
    loadHot(dimension, storeId)
  }, [dimension, storeId, loadHot])

  function handleDimension(d: Dimension) {
    if (d === dimension) return
    setDimension(d)
    setResult(null)
  }

  const heroLabelText = (() => {
    switch (timePeriod) {
      case 'TODAY':  return t('dashboard.heroLabelToday')
      case 'WEEK':   return t('dashboard.heroLabelWeek')
      case 'MONTH':  return t('dashboard.heroLabelMonth')
      case 'CUSTOM': return t('dashboard.heroLabelRange')
    }
  })()

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
            onClick={() => {
              load(dimension, storeId, operatorUserId, timePeriod, customFrom, customTo)
              loadHot(dimension, storeId)
            }}
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

        {/* Store selector */}
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

        {/* Staff selector */}
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

        {/* Time period tabs */}
        <div style={s.periodRow}>
          {(['TODAY', 'WEEK', 'MONTH', 'CUSTOM'] as TimePeriod[]).map((p) => (
            <button
              key={p}
              style={{ ...s.periodBtn, ...(timePeriod === p ? s.periodBtnActive : {}) }}
              onClick={() => setTimePeriod(p)}
            >
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>

        {/* Custom date range */}
        {timePeriod === 'CUSTOM' && (
          <div style={s.customRow}>
            <input
              type="date"
              style={s.dateInput}
              value={customFrom}
              max={customTo || today}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
            <span style={s.dateSep}>—</span>
            <input
              type="date"
              style={s.dateInput}
              value={customTo}
              min={customFrom}
              max={today}
              onChange={(e) => setCustomTo(e.target.value)}
            />
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div style={s.loadingWrap}>
            <div style={s.skeleton} />
            <div style={{ ...s.skeleton, height: 88, marginTop: 10 }} />
            <div style={{ ...s.skeleton, height: 88, marginTop: 10 }} />
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div style={s.errorCard}>{error}</div>
        )}

        {/* Overview */}
        {!loading && result && (
          <Overview result={result} t={t} heroLabel={heroLabelText} />
        )}

        {/* Hot products (GLOBAL / STORE only) */}
        {dimension !== 'STAFF' && (
          <HotSection
            weekHot={weekHot}
            monthHot={monthHot}
            loading={hotLoading}
            t={t}
          />
        )}

        {/* Store config — collapsed entry */}
        <div
          style={s.configEntry}
          onClick={() => setShowStoreConfig((v) => !v)}
        >
          <span style={s.configLabel}>{t('dashboard.storeSettings')}</span>
          <span style={s.configArrow}>{showStoreConfig ? '▴' : '▾'}</span>
        </div>
        {showStoreConfig && <StoreConfigPanel t={t} />}

        <div style={{ height: 24 }} />
      </div>
    </div>
  )
}

// ─── Overview ─────────────────────────────────────────────────────────────────

function Overview({
  result,
  t,
  heroLabel,
}: {
  result: SummaryResult
  t: (k: string) => string
  heroLabel: string
}) {
  const subLabel =
    result.dimension === 'STORE'
      ? (result.storeName ?? '—')
      : result.dimension === 'STAFF'
      ? (result.operatorDisplayName ?? '—')
      : t('dashboard.subAll')

  return (
    <div>
      {/* Hero */}
      <div style={ov.heroCard}>
        <div style={ov.heroSub}>{subLabel}</div>
        <div style={ov.heroLabel}>{heroLabel}</div>
        <div style={{ ...ov.heroAmount, color: result.netAmount >= 0 ? '#a0f0a0' : '#ffccc7' }}>
          {fmtAmount(result.netAmount)}
        </div>
      </div>

      {/* Metrics 2×2 */}
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

      {/* Payment breakdown */}
      {((result.cashSaleAmount ?? 0) > 0 || (result.khqrSaleAmount ?? 0) > 0) && (
        <div style={ov.payGrid}>
          <PayCell icon="💵" label={t('dashboard.cashSaleLabel')} value={fmtAmount(result.cashSaleAmount ?? 0)} />
          <PayCell icon="📱" label={t('dashboard.khqrSaleLabel')} value={fmtAmount(result.khqrSaleAmount ?? 0)} />
        </div>
      )}
    </div>
  )
}

// ─── HotSection ───────────────────────────────────────────────────────────────

function HotSection({
  weekHot,
  monthHot,
  loading,
  t,
}: {
  weekHot: TopProduct[]
  monthHot: TopProduct[]
  loading: boolean
  t: (k: string) => string
}) {
  return (
    <div style={hot.wrap}>
      <HotColumn title={t('dashboard.weekHotTitle')} products={weekHot} loading={loading} t={t} />
      <HotColumn title={t('dashboard.monthHotTitle')} products={monthHot} loading={loading} t={t} />
    </div>
  )
}

function HotColumn({
  title,
  products,
  loading,
  t,
}: {
  title: string
  products: TopProduct[]
  loading: boolean
  t: (k: string) => string
}) {
  return (
    <div style={hot.col}>
      <div style={hot.colTitle}>{title}</div>
      {loading ? (
        <div style={hot.empty}>…</div>
      ) : products.length === 0 ? (
        <div style={hot.empty}>{t('dashboard.noSales')}</div>
      ) : (
        products.map((p, i) => (
          <div
            key={i}
            style={{
              ...hot.row,
              ...(i === products.length - 1 ? { borderBottom: 'none', marginBottom: 0, paddingBottom: 0 } : {}),
            }}
          >
            <div style={{ ...hot.rank, ...(i === 0 ? hot.rank1 : i === 1 ? hot.rank2 : hot.rank3) }}>
              {i + 1}
            </div>
            <div style={hot.name}>
              {p.name}
              {p.spec && <span style={hot.spec}> · {p.spec}</span>}
            </div>
            <div style={hot.qty}>{p.totalQty}{t('dashboard.qtyUnit')}</div>
          </div>
        ))
      )}
    </div>
  )
}

// ─── StoreConfigPanel ─────────────────────────────────────────────────────────

type StoreConfig = { id: string; name: string; checkoutMode: string }

function StoreConfigPanel({ t }: { t: (k: string) => string }) {
  const [stores, setStores] = useState<StoreConfig[]>([])
  const [pending, setPending] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [saved, setSaved] = useState<Record<string, boolean>>({})
  const [saveError, setSaveError] = useState<Record<string, string>>({})

  useEffect(() => {
    apiFetch('/api/stores', { cache: 'no-store' }, OWNER_CTX)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: StoreConfig[]) => {
        setStores(list)
        const init: Record<string, string> = {}
        list.forEach((s) => { init[s.id] = s.checkoutMode })
        setPending(init)
      })
      .catch(() => {})
  }, [])

  async function handleSave(sid: string) {
    setSaving((v) => ({ ...v, [sid]: true }))
    setSaved((v) => ({ ...v, [sid]: false }))
    setSaveError((v) => ({ ...v, [sid]: '' }))
    try {
      const res = await apiFetch(`/api/stores/${sid}/checkout-mode`, {
        method: 'PATCH',
        body: JSON.stringify({ checkoutMode: pending[sid] }),
      }, OWNER_CTX)
      if (res.ok) {
        const body = await res.json().catch(() => null)
        if (body?.checkoutMode) setPending((v) => ({ ...v, [sid]: body.checkoutMode }))
        setSaved((v) => ({ ...v, [sid]: true }))
        setTimeout(() => setSaved((v) => ({ ...v, [sid]: false })), 2000)
      } else {
        const body = await res.json().catch(() => null)
        setSaveError((v) => ({ ...v, [sid]: body?.message ?? body?.error ?? '保存失败' }))
      }
    } catch {
      setSaveError((v) => ({ ...v, [sid]: '网络错误，请重试' }))
    } finally {
      setSaving((v) => ({ ...v, [sid]: false }))
    }
  }

  if (stores.length === 0) return null

  return (
    <div style={sc.card}>
      {stores.map((store) => (
        <div key={store.id} style={sc.row}>
          <div style={sc.storeName}>{store.name}</div>
          <div style={sc.label}>{t('dashboard.checkoutMode')}</div>
          <div style={sc.controls}>
            <select
              style={sc.select}
              value={pending[store.id] ?? store.checkoutMode}
              onChange={(e) => {
                setPending((v) => ({ ...v, [store.id]: e.target.value }))
                setSaveError((v) => ({ ...v, [store.id]: '' }))
              }}
            >
              <option value="DIRECT_PAYMENT">{t('dashboard.modeDirect')}</option>
              <option value="DEFERRED_PAYMENT">{t('dashboard.modeDeferred')}</option>
            </select>
            <button
              style={sc.saveBtn}
              onClick={() => handleSave(store.id)}
              disabled={saving[store.id]}
            >
              {saved[store.id] ? t('dashboard.modeSaved') : saving[store.id] ? '…' : t('dashboard.saveMode')}
            </button>
          </div>
          {saveError[store.id] ? <div style={sc.errMsg}>{saveError[store.id]}</div> : null}
        </div>
      ))}
    </div>
  )
}

function MetricCell({ label, value, unit, red }: { label: string; value: string; unit?: string; red?: boolean }) {
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

function PayCell({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div style={pc.cell}>
      <span style={pc.icon}>{icon}</span>
      <div style={pc.text}>
        <div style={pc.val}>{value}</div>
        <div style={pc.lbl}>{label}</div>
      </div>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' },
  header: {
    background: 'var(--blue)',
    padding: '16px 16px 20px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  brandName: { fontSize: 18, fontWeight: 700, color: '#fff', letterSpacing: '0.02em' },
  brandSub: { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
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
  body: { flex: 1, padding: '12px 12px 0', maxWidth: 480, margin: '0 auto', width: '100%' },
  dimRow: { display: 'flex', gap: 8, marginBottom: 10 },
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
  dimBtnActive: { background: 'var(--blue)', borderColor: 'var(--blue)', color: '#fff', fontWeight: 700 },
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
  periodRow: { display: 'flex', gap: 6, marginBottom: 10 },
  periodBtn: {
    flex: 1,
    height: 34,
    border: '1.5px solid var(--border)',
    borderRadius: 16,
    background: '#f7f8fa',
    fontSize: 13,
    color: 'var(--muted)',
    fontWeight: 500,
    cursor: 'pointer',
  },
  periodBtnActive: {
    background: 'var(--blue)',
    borderColor: 'var(--blue)',
    color: '#fff',
    fontWeight: 700,
  },
  customRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: 'var(--card)',
    borderRadius: 'var(--radius)',
    padding: '10px 12px',
    marginBottom: 10,
  },
  dateInput: {
    flex: 1,
    height: 38,
    padding: '0 10px',
    border: '1.5px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 14,
    background: '#f7f8fa',
    color: 'var(--text)',
    outline: 'none',
  },
  dateSep: { fontSize: 14, color: 'var(--muted)', flexShrink: 0 },
  loadingWrap: { marginTop: 4 },
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
  configEntry: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: 'var(--card)',
    borderRadius: 'var(--radius)',
    padding: '12px 16px',
    marginTop: 12,
    cursor: 'pointer',
  },
  configLabel: { fontSize: 14, fontWeight: 600, color: 'var(--muted)' },
  configArrow: { fontSize: 14, color: 'var(--muted)' },
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
  heroSub: { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginBottom: 6 },
  heroLabel: { fontSize: 13, color: 'rgba(255,255,255,0.7)' },
  heroAmount: { fontSize: 44, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.1, marginTop: 2 },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    background: 'var(--card)',
    borderRadius: 'var(--radius)',
    overflow: 'hidden',
    marginBottom: 10,
  },
  payGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 },
}

const hot: Record<string, React.CSSProperties> = {
  wrap: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
    marginBottom: 12,
  },
  col: {
    background: 'var(--card)',
    borderRadius: 'var(--radius)',
    padding: '12px 12px',
  },
  colTitle: {
    fontSize: 11,
    color: 'var(--muted)',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    marginBottom: 10,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 8,
    marginBottom: 8,
    borderBottom: '1px solid var(--border)',
  },
  empty: { fontSize: 12, color: 'var(--muted)', textAlign: 'center' as const, padding: '8px 0' },
  rank: {
    width: 22,
    height: 22,
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 800,
    flexShrink: 0,
  },
  rank1: { background: '#ffe066', color: '#7a5400' },
  rank2: { background: '#d4d4d4', color: '#444' },
  rank3: { background: '#e8c19c', color: '#6b3a1f' },
  name: {
    flex: 1,
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  spec: { fontWeight: 400, color: 'var(--muted)', fontSize: 11 },
  qty: { fontSize: 13, fontWeight: 700, color: 'var(--blue)', flexShrink: 0 },
}

const mc: Record<string, React.CSSProperties> = {
  cell: { padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 4, borderTop: '1px solid var(--border)', borderRight: '1px solid var(--border)' },
  value: { fontSize: 20, fontWeight: 700, color: 'var(--text)' },
  unit: { fontSize: 12, fontWeight: 400, color: 'var(--muted)', marginLeft: 3 },
  label: { fontSize: 12, color: 'var(--muted)' },
}

const pc: Record<string, React.CSSProperties> = {
  cell: { background: 'var(--card)', borderRadius: 'var(--radius)', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 },
  icon: { fontSize: 22, flexShrink: 0 },
  text: { display: 'flex', flexDirection: 'column', gap: 2 },
  val: { fontSize: 17, fontWeight: 700, color: 'var(--text)' },
  lbl: { fontSize: 11, color: 'var(--muted)' },
}

const sc: Record<string, React.CSSProperties> = {
  card: { background: 'var(--card)', borderRadius: 'var(--radius)', padding: '14px 16px', marginTop: 0 },
  row: { paddingBottom: 12, marginBottom: 12, borderBottom: '1px solid var(--border)' },
  storeName: { fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 6 },
  label: { fontSize: 12, color: 'var(--muted)', marginBottom: 6 },
  controls: { display: 'flex', gap: 8, alignItems: 'center' },
  select: { flex: 1, fontSize: 14, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' },
  saveBtn: { fontSize: 13, fontWeight: 600, padding: '6px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' },
  errMsg: { fontSize: 12, color: '#d97706', marginTop: 4 },
}
