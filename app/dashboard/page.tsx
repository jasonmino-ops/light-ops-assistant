'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
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
  const [dimMenuOpen, setDimMenuOpen]           = useState(false)

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
        {/* KHQR 当前模式提示（第一阶段：静态图 + 人工确认；动态码后续接入） */}
        <div style={s.khqrNotice}>
          <span style={s.khqrNoticeIcon}>📱</span>
          <div style={s.khqrNoticeBody}>
            <div style={s.khqrNoticeTitle}>{t('dashboard.khqrModeNoticeTitle')}</div>
            <div style={s.khqrNoticeText}>{t('dashboard.khqrModeNoticeBody')}</div>
          </div>
        </div>

        {/* 首页门头快捷管理（OWNER only — dashboard 本就 OWNER 才能进） */}
        <BannerQuickPanel t={t} />

        {/* 云打印机面板（高级版） */}
        <PrinterPanel />

        {/* 门店经营查询入口（合并 GLOBAL / STORE / STAFF） */}
        <div style={s.dimMenuWrap}>
          <button
            type="button"
            style={s.dimMenuToggle}
            onClick={() => setDimMenuOpen((v) => !v)}
          >
            <span style={s.dimMenuToggleLeft}>
              <span style={s.dimMenuIcon}>📊</span>
              <span>
                <span style={s.dimMenuTitle}>{t('dashboard.dimMenuTitle')}</span>
                <span style={s.dimMenuCurrent}>· {DIM_LABEL[dimension]}</span>
              </span>
            </span>
            <span style={s.dimMenuArrow}>{dimMenuOpen ? '▴' : '▾'}</span>
          </button>
          {dimMenuOpen && (
            <div style={s.dimMenuPanel}>
              {([
                { key: 'GLOBAL', label: t('dashboard.dimAll') },
                { key: 'STORE',  label: t('dashboard.dimByStore') },
                { key: 'STAFF',  label: t('dashboard.dimByStaff') },
              ] as { key: Dimension; label: string }[]).map((d) => (
                <button
                  key={d.key}
                  type="button"
                  style={{ ...s.dimMenuItem, ...(dimension === d.key ? s.dimMenuItemOn : {}) }}
                  onClick={() => { handleDimension(d.key); setDimMenuOpen(false) }}
                >
                  {d.label}
                </button>
              ))}
            </div>
          )}
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

        {/* 大入口区：顾客资产 + 门店配置（上移到 Overview 下方，保证首屏可见） */}
        <div style={s.bigEntryRow}>
          <Link href="/customers" style={s.bigEntryCard}>
            <div style={{ ...s.bigEntryIcon, background: 'linear-gradient(135deg,#69b1ff,#1677ff)' }}>👥</div>
            <div style={s.bigEntryBody}>
              <div style={s.bigEntryTitle}>{t('dashboard.customersCenter')}</div>
              <div style={s.bigEntryDesc}>{t('dashboard.customersCenterDesc')}</div>
            </div>
            <span style={s.bigEntryArrow}>›</span>
          </Link>
          <button
            type="button"
            style={s.bigEntryCard}
            onClick={() => setShowStoreConfig((v) => !v)}
          >
            <div style={{ ...s.bigEntryIcon, background: 'linear-gradient(135deg,#ffc069,#fa8c16)' }}>🏪</div>
            <div style={s.bigEntryBody}>
              <div style={s.bigEntryTitle}>{t('dashboard.storeSettings')}</div>
              <div style={s.bigEntryDesc}>{t('dashboard.storeSettingsDesc')}</div>
            </div>
            <span style={s.bigEntryArrow}>{showStoreConfig ? '▴' : '›'}</span>
          </button>
        </div>
        {showStoreConfig && <StoreConfigPanel t={t} />}

        {/* Hot products (GLOBAL / STORE only) — 合并为 tab 切换 */}
        {dimension !== 'STAFF' && (
          <HotSection
            weekHot={weekHot}
            monthHot={monthHot}
            loading={hotLoading}
            t={t}
          />
        )}

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
  const [tab, setTab] = useState<'week' | 'month'>('week')
  const products = tab === 'week' ? weekHot : monthHot
  return (
    <div style={hot.singleCard}>
      <div style={hot.tabRow}>
        <button
          type="button"
          style={{ ...hot.tabBtn, ...(tab === 'week' ? hot.tabBtnOn : {}) }}
          onClick={() => setTab('week')}
        >
          {t('dashboard.weekHotTitle')}
        </button>
        <button
          type="button"
          style={{ ...hot.tabBtn, ...(tab === 'month' ? hot.tabBtnOn : {}) }}
          onClick={() => setTab('month')}
        >
          {t('dashboard.monthHotTitle')}
        </button>
      </div>
      <HotColumn title="" products={products} loading={loading} t={t} />
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
      {title && <div style={hot.colTitle}>{title}</div>}
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

type StoreConfig = {
  id: string; name: string; checkoutMode: string
  bannerUrl: string | null; announcement: string | null; promoText: string | null
}

function StoreConfigPanel({ t }: { t: (k: string) => string }) {
  const [stores, setStores]           = useState<StoreConfig[]>([])
  const [pending, setPending]         = useState<Record<string, string>>({})
  const [saving, setSaving]           = useState<Record<string, boolean>>({})
  const [saved, setSaved]             = useState<Record<string, boolean>>({})
  const [saveError, setSaveError]     = useState<Record<string, string>>({})
  const [bannerUrls, setBannerUrls]   = useState<Record<string, string | null>>({})
  const [bannerLoading, setBannerLoading] = useState<Record<string, boolean>>({})
  const [bannerErr, setBannerErr]     = useState<Record<string, string>>({})
  const [annDraft, setAnnDraft]       = useState<Record<string, string>>({})
  const [annSaving, setAnnSaving]     = useState<Record<string, boolean>>({})
  const [annSaved, setAnnSaved]       = useState<Record<string, boolean>>({})
  const [annErr, setAnnErr]           = useState<Record<string, string>>({})
  const [promoDraft, setPromoDraft]   = useState<Record<string, string>>({})
  const [promoSaving, setPromoSaving] = useState<Record<string, boolean>>({})
  const [promoSaved, setPromoSaved]   = useState<Record<string, boolean>>({})
  const [promoErr, setPromoErr]       = useState<Record<string, string>>({})
  // 编辑态 + 编辑前快照（用于取消恢复）
  const [annEditing, setAnnEditing]   = useState<Record<string, boolean>>({})
  const [annOrig, setAnnOrig]         = useState<Record<string, string>>({})
  const [promoEditing, setPromoEditing] = useState<Record<string, boolean>>({})
  const [promoOrig, setPromoOrig]     = useState<Record<string, string>>({})
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  useEffect(() => {
    apiFetch('/api/stores', { cache: 'no-store' }, OWNER_CTX)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: StoreConfig[]) => {
        setStores(list)
        const initMode: Record<string, string> = {}
        const initBanner: Record<string, string | null> = {}
        const initAnn: Record<string, string> = {}
        const initPromo: Record<string, string> = {}
        list.forEach((s) => {
          initMode[s.id]   = s.checkoutMode
          initBanner[s.id] = s.bannerUrl ?? null
          initAnn[s.id]    = s.announcement ?? ''
          initPromo[s.id]  = s.promoText ?? ''
        })
        setPending(initMode)
        setBannerUrls(initBanner)
        setAnnDraft(initAnn)
        setPromoDraft(initPromo)
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

  async function handleBannerUpload(sid: string, file: File) {
    setBannerLoading((v) => ({ ...v, [sid]: true }))
    setBannerErr((v) => ({ ...v, [sid]: '' }))
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`/api/stores/${sid}/banner`, {
        method: 'POST',
        headers: { ...(OWNER_CTX as Record<string, string>) },
        body: formData,
      })
      const body = await res.json().catch(() => null)
      if (res.ok && body?.bannerUrl) {
        setBannerUrls((v) => ({ ...v, [sid]: body.bannerUrl }))
      } else {
        setBannerErr((v) => ({ ...v, [sid]: body?.error ?? '上传失败' }))
      }
    } catch {
      setBannerErr((v) => ({ ...v, [sid]: '网络错误，请重试' }))
    } finally {
      setBannerLoading((v) => ({ ...v, [sid]: false }))
    }
  }

  async function handleBannerDelete(sid: string) {
    setBannerLoading((v) => ({ ...v, [sid]: true }))
    setBannerErr((v) => ({ ...v, [sid]: '' }))
    try {
      const res = await apiFetch(`/api/stores/${sid}/banner`, { method: 'DELETE' }, OWNER_CTX)
      if (res.ok) {
        setBannerUrls((v) => ({ ...v, [sid]: null }))
      } else {
        const body = await res.json().catch(() => null)
        setBannerErr((v) => ({ ...v, [sid]: body?.error ?? '删除失败' }))
      }
    } catch {
      setBannerErr((v) => ({ ...v, [sid]: '网络错误，请重试' }))
    } finally {
      setBannerLoading((v) => ({ ...v, [sid]: false }))
    }
  }

  async function handleSaveAnn(sid: string) {
    setAnnSaving((v) => ({ ...v, [sid]: true }))
    setAnnSaved((v) => ({ ...v, [sid]: false }))
    setAnnErr((v) => ({ ...v, [sid]: '' }))
    try {
      const res = await apiFetch(`/api/stores/${sid}/menu-config`, {
        method: 'PATCH',
        body: JSON.stringify({ announcement: annDraft[sid] ?? '' }),
      }, OWNER_CTX)
      if (res.ok) {
        setAnnSaved((v) => ({ ...v, [sid]: true }))
        setAnnEditing((v) => ({ ...v, [sid]: false }))
        setTimeout(() => setAnnSaved((v) => ({ ...v, [sid]: false })), 2000)
      } else {
        const body = await res.json().catch(() => null)
        setAnnErr((v) => ({ ...v, [sid]: body?.error ?? '保存失败' }))
      }
    } catch {
      setAnnErr((v) => ({ ...v, [sid]: '网络错误，请重试' }))
    } finally {
      setAnnSaving((v) => ({ ...v, [sid]: false }))
    }
  }

  async function handleSavePromo(sid: string) {
    setPromoSaving((v) => ({ ...v, [sid]: true }))
    setPromoSaved((v) => ({ ...v, [sid]: false }))
    setPromoErr((v) => ({ ...v, [sid]: '' }))
    try {
      const res = await apiFetch(`/api/stores/${sid}/menu-config`, {
        method: 'PATCH',
        body: JSON.stringify({ promoText: promoDraft[sid] ?? '' }),
      }, OWNER_CTX)
      if (res.ok) {
        setPromoSaved((v) => ({ ...v, [sid]: true }))
        setPromoEditing((v) => ({ ...v, [sid]: false }))
        setTimeout(() => setPromoSaved((v) => ({ ...v, [sid]: false })), 2000)
      } else {
        const body = await res.json().catch(() => null)
        setPromoErr((v) => ({ ...v, [sid]: body?.error ?? '保存失败' }))
      }
    } catch {
      setPromoErr((v) => ({ ...v, [sid]: '网络错误，请重试' }))
    } finally {
      setPromoSaving((v) => ({ ...v, [sid]: false }))
    }
  }

  function startEditAnn(sid: string) {
    setAnnOrig((v) => ({ ...v, [sid]: annDraft[sid] ?? '' }))
    setAnnEditing((v) => ({ ...v, [sid]: true }))
    setAnnErr((v) => ({ ...v, [sid]: '' }))
  }
  function cancelEditAnn(sid: string) {
    setAnnDraft((v) => ({ ...v, [sid]: annOrig[sid] ?? '' }))
    setAnnEditing((v) => ({ ...v, [sid]: false }))
    setAnnErr((v) => ({ ...v, [sid]: '' }))
  }
  function startEditPromo(sid: string) {
    setPromoOrig((v) => ({ ...v, [sid]: promoDraft[sid] ?? '' }))
    setPromoEditing((v) => ({ ...v, [sid]: true }))
    setPromoErr((v) => ({ ...v, [sid]: '' }))
  }
  function cancelEditPromo(sid: string) {
    setPromoDraft((v) => ({ ...v, [sid]: promoOrig[sid] ?? '' }))
    setPromoEditing((v) => ({ ...v, [sid]: false }))
    setPromoErr((v) => ({ ...v, [sid]: '' }))
  }

  if (stores.length === 0) return null

  return (
    <div style={sc.card}>
      {stores.map((store) => (
        <div key={store.id} style={sc.row}>
          <div style={sc.storeName}>{store.name}</div>

          {/* 结账模式 */}
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

          {/* 顾客页展示配置 */}
          <div style={sc.menuSection}>
            <div style={sc.menuSectionTitle}>{t('dashboard.menuDisplay')}</div>

            {/* 头图 */}
            <div style={sc.fieldLabel}>{t('dashboard.menuBannerTitle')}</div>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              style={{ display: 'none' }}
              ref={(el) => { fileRefs.current[store.id] = el }}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleBannerUpload(store.id, file)
                e.target.value = ''
              }}
            />
            {bannerUrls[store.id] ? (
              <div style={sc.bannerPreviewWrap}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={bannerUrls[store.id]!}
                  alt="banner"
                  style={sc.bannerPreview}
                />
                <div style={sc.bannerBtns}>
                  <button
                    style={sc.bannerBtn}
                    disabled={bannerLoading[store.id]}
                    onClick={() => fileRefs.current[store.id]?.click()}
                  >
                    {bannerLoading[store.id] ? t('dashboard.menuBannerUploading') : t('dashboard.menuBannerReplace')}
                  </button>
                  <button
                    style={{ ...sc.bannerBtn, ...sc.bannerBtnDanger }}
                    disabled={bannerLoading[store.id]}
                    onClick={() => handleBannerDelete(store.id)}
                  >
                    {bannerLoading[store.id] ? t('dashboard.menuBannerDeleting') : t('dashboard.menuBannerDelete')}
                  </button>
                </div>
              </div>
            ) : (
              <div style={sc.bannerEmpty}>
                <span style={sc.bannerEmptyText}>{t('dashboard.menuBannerNoImage')}</span>
                <button
                  style={sc.bannerBtn}
                  disabled={bannerLoading[store.id]}
                  onClick={() => fileRefs.current[store.id]?.click()}
                >
                  {bannerLoading[store.id] ? t('dashboard.menuBannerUploading') : t('dashboard.menuBannerUpload')}
                </button>
              </div>
            )}
            {bannerErr[store.id] ? <div style={sc.errMsg}>{bannerErr[store.id]}</div> : null}

            {/* 公告 — 修改/保存/取消 三态 */}
            <div style={sc.fieldLabel}>{t('dashboard.menuAnnouncement')}</div>
            {annEditing[store.id] ? (
              <>
                <textarea
                  style={sc.textarea}
                  rows={2}
                  placeholder={t('dashboard.menuAnnouncementPh')}
                  value={annDraft[store.id] ?? ''}
                  onChange={(e) => {
                    setAnnDraft((v) => ({ ...v, [store.id]: e.target.value }))
                    setAnnErr((v) => ({ ...v, [store.id]: '' }))
                  }}
                  autoFocus
                />
                <div style={sc.fieldAction}>
                  {annErr[store.id] && <span style={sc.errMsg}>{annErr[store.id]}</span>}
                  <button
                    type="button"
                    style={sc.cancelBtn}
                    onClick={() => cancelEditAnn(store.id)}
                    disabled={annSaving[store.id]}
                  >
                    {t('dashboard.cancelBtn')}
                  </button>
                  <button
                    type="button"
                    style={sc.saveBtn}
                    onClick={() => handleSaveAnn(store.id)}
                    disabled={annSaving[store.id]}
                  >
                    {annSaving[store.id] ? '…' : t('dashboard.saveBtnFull')}
                  </button>
                </div>
              </>
            ) : (
              <div style={sc.readonlyRow}>
                <div style={sc.readonlyText}>
                  {annDraft[store.id]?.trim()
                    ? annDraft[store.id]
                    : <span style={sc.readonlyMuted}>{t('dashboard.annNonePlaceholder')}</span>}
                </div>
                {annSaved[store.id] && <span style={sc.savedHint}>{t('dashboard.modeSaved')}</span>}
                <button
                  type="button"
                  style={sc.editBtn}
                  onClick={() => startEditAnn(store.id)}
                >
                  {t('dashboard.editBtn')}
                </button>
              </div>
            )}

            {/* 活动文案 — 修改/保存/取消 三态 */}
            <div style={sc.fieldLabel}>{t('dashboard.menuPromoText')}</div>
            {promoEditing[store.id] ? (
              <>
                <textarea
                  style={sc.textarea}
                  rows={2}
                  placeholder={t('dashboard.menuPromoTextPh')}
                  value={promoDraft[store.id] ?? ''}
                  onChange={(e) => {
                    setPromoDraft((v) => ({ ...v, [store.id]: e.target.value }))
                    setPromoErr((v) => ({ ...v, [store.id]: '' }))
                  }}
                  autoFocus
                />
                <div style={sc.fieldAction}>
                  {promoErr[store.id] && <span style={sc.errMsg}>{promoErr[store.id]}</span>}
                  <button
                    type="button"
                    style={sc.cancelBtn}
                    onClick={() => cancelEditPromo(store.id)}
                    disabled={promoSaving[store.id]}
                  >
                    {t('dashboard.cancelBtn')}
                  </button>
                  <button
                    type="button"
                    style={sc.saveBtn}
                    onClick={() => handleSavePromo(store.id)}
                    disabled={promoSaving[store.id]}
                  >
                    {promoSaving[store.id] ? '…' : t('dashboard.saveBtnFull')}
                  </button>
                </div>
              </>
            ) : (
              <div style={sc.readonlyRow}>
                <div style={sc.readonlyText}>
                  {promoDraft[store.id]?.trim()
                    ? promoDraft[store.id]
                    : <span style={sc.readonlyMuted}>{t('dashboard.promoNonePlaceholder')}</span>}
                </div>
                {promoSaved[store.id] && <span style={sc.savedHint}>{t('dashboard.modeSaved')}</span>}
                <button
                  type="button"
                  style={sc.editBtn}
                  onClick={() => startEditPromo(store.id)}
                >
                  {t('dashboard.editBtn')}
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── 首页门头快捷管理（OWNER 可见，dashboard 顶部直达） ────────────────────

function BannerQuickPanel({ t }: { t: (k: string) => string }) {
  type S = { id: string; name: string; bannerUrl: string | null }
  const [stores, setStores]   = useState<S[]>([])
  const [activeId, setActiveId] = useState<string>('')
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [err, setErr]         = useState<Record<string, string>>({})
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  useEffect(() => {
    apiFetch('/api/stores', { cache: 'no-store' }, OWNER_CTX)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: S[]) => {
        setStores(list)
        if (list.length > 0) setActiveId(list[0].id)
      })
      .catch(() => {})
  }, [])

  async function upload(sid: string, file: File) {
    setLoading((v) => ({ ...v, [sid]: true }))
    setErr((v) => ({ ...v, [sid]: '' }))
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api/stores/${sid}/banner`, {
        method: 'POST',
        headers: { ...(OWNER_CTX as Record<string, string>) },
        body: form,
      })
      const body = await res.json().catch(() => null)
      if (res.ok && body?.bannerUrl) {
        setStores((prev) => prev.map((s) => (s.id === sid ? { ...s, bannerUrl: body.bannerUrl } : s)))
      } else {
        setErr((v) => ({ ...v, [sid]: body?.error ?? '上传失败' }))
      }
    } catch {
      setErr((v) => ({ ...v, [sid]: '网络错误' }))
    } finally {
      setLoading((v) => ({ ...v, [sid]: false }))
    }
  }

  async function del(sid: string) {
    setLoading((v) => ({ ...v, [sid]: true }))
    setErr((v) => ({ ...v, [sid]: '' }))
    try {
      const res = await apiFetch(`/api/stores/${sid}/banner`, { method: 'DELETE' }, OWNER_CTX)
      if (res.ok) {
        setStores((prev) => prev.map((s) => (s.id === sid ? { ...s, bannerUrl: null } : s)))
      } else {
        const body = await res.json().catch(() => null)
        setErr((v) => ({ ...v, [sid]: body?.error ?? '删除失败' }))
      }
    } catch {
      setErr((v) => ({ ...v, [sid]: '网络错误' }))
    } finally {
      setLoading((v) => ({ ...v, [sid]: false }))
    }
  }

  if (stores.length === 0) return null
  const active = stores.find((s) => s.id === activeId) ?? stores[0]
  const busy = !!loading[active.id]

  return (
    <div style={bq.card}>
      <div style={bq.header}>
        <span style={bq.title}>🏪 {t('dashboard.bannerQuickTitle')}</span>
        {stores.length > 1 && (
          <select
            style={bq.select}
            value={activeId}
            onChange={(e) => setActiveId(e.target.value)}
          >
            {stores.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
          </select>
        )}
      </div>

      <input
        ref={(el) => { fileRefs.current[active.id] = el }}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) upload(active.id, f)
          e.target.value = ''
        }}
      />

      {active.bannerUrl ? (
        <div style={bq.previewBox}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={active.bannerUrl} alt={active.name} style={bq.previewImg} />
          <div style={bq.actions}>
            <button
              type="button"
              style={bq.btn}
              disabled={busy}
              onClick={() => fileRefs.current[active.id]?.click()}
            >
              {busy ? '…' : t('products.imageReplace')}
            </button>
            <button
              type="button"
              style={{ ...bq.btn, ...bq.btnDanger }}
              disabled={busy}
              onClick={() => del(active.id)}
            >
              {busy ? '…' : t('products.imageDelete')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          style={bq.uploadEmpty}
          disabled={busy}
          onClick={() => fileRefs.current[active.id]?.click()}
        >
          <span style={bq.uploadIcon}>📷</span>
          <span style={bq.uploadText}>{busy ? '…' : t('dashboard.bannerNoneHint')}</span>
        </button>
      )}
      {err[active.id] && <div style={bq.err}>{err[active.id]}</div>}
    </div>
  )
}

const bq: Record<string, React.CSSProperties> = {
  card: { background: 'var(--card)', borderRadius: 'var(--radius)', padding: '12px 14px', marginBottom: 10 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 10 },
  title: { fontSize: 14, fontWeight: 700, color: 'var(--text)' },
  select: { fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', maxWidth: 140 },
  previewBox: { display: 'flex', flexDirection: 'column' as const, gap: 8 },
  previewImg: { width: '100%', height: 96, objectFit: 'cover' as const, borderRadius: 8, border: '1px solid var(--border)', background: '#f5f5f5' },
  actions: { display: 'flex', gap: 8 },
  btn: { flex: 1, height: 34, fontSize: 13, fontWeight: 600, background: '#fff', border: '1.5px solid var(--border)', borderRadius: 6, color: 'var(--text)', cursor: 'pointer' },
  btnDanger: { color: 'var(--red)', borderColor: '#ffa39e' },
  uploadEmpty: {
    width: '100%', height: 80,
    border: '1.5px dashed var(--border)', borderRadius: 10,
    background: '#fafafa', color: 'var(--muted)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    cursor: 'pointer', fontSize: 13, fontWeight: 500,
  },
  uploadIcon: { fontSize: 18, lineHeight: 1 },
  uploadText: {},
  err: { fontSize: 12, color: '#d97706', marginTop: 6 },
}

// ─── 云打印机面板（高级版功能 / LITE 显示升级提示） ────────────────────────

type PrintStatus = {
  configured: boolean
  tier: string
  tierEnabled: boolean
  recent: Array<{ orderNo: string | null; status: string; message: string | null; at: string }>
  diag?: unknown | null
}

function PrinterPanel() {
  const [data, setData]       = useState<PrintStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState(false)
  const [reprinting, setReprinting] = useState(false)
  const [diagnosing, setDiagnosing] = useState(false)
  const [diag, setDiag]       = useState<unknown | null>(null)
  const [binding, setBinding] = useState(false)
  const [msg, setMsg]         = useState<{ ok: boolean; text: string } | null>(null)

  const refresh = useCallback(() => {
    setLoading(true)
    apiFetch('/api/print/status', { cache: 'no-store' }, OWNER_CTX)
      .then((r) => r.json())
      .then((body) => { if (!body?.error) setData(body) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { refresh() }, [refresh])

  async function handleTest() {
    setTesting(true); setMsg(null); setDiag(null)
    try {
      const r = await apiFetch('/api/print/test', { method: 'POST' }, OWNER_CTX)
      const body = await r.json().catch(() => ({}))
      // 失败时显示完整 printMsg 诊断（含 parsedDiag.code / message / dataCode / dataMessage / reqId）
      if (!r.ok || !body?.ok) {
        setDiag(body)
        const pd = body?.parsedDiag as { message?: unknown; dataMessage?: unknown } | undefined
        const errMsg = String(pd?.dataMessage ?? pd?.message ?? body?.error ?? body?.message ?? '打印失败')
        setMsg({ ok: false, text: `打印失败：${errMsg}` })
      } else {
        setMsg({ ok: true, text: '✓ 测试小票已发送' })
      }
      refresh()
    } catch {
      setMsg({ ok: false, text: '网络错误' })
    } finally {
      setTesting(false)
    }
  }

  async function handleBindDevice() {
    setBinding(true); setMsg(null); setDiag(null)
    try {
      const r = await apiFetch('/api/print/bind', { method: 'POST' }, OWNER_CTX)
      const body = await r.json().catch(() => ({}))
      setDiag(body)  // 完整 response（含 rawBody / request / tokenDiag）
      if (r.ok && body?.ok) {
        setMsg({ ok: true, text: '✓ 设备绑定/确认成功' })
        refresh()
      } else {
        setMsg({ ok: false, text: body?.errorMessage ?? body?.message ?? body?.error ?? '绑定失败，请看下方完整响应' })
      }
    } catch {
      setMsg({ ok: false, text: '网络错误' })
    } finally {
      setBinding(false)
    }
  }

  async function handleDiagnose() {
    setDiagnosing(true); setMsg(null); setDiag(null)
    try {
      const r = await apiFetch('/api/print/status?diagnose=1', { cache: 'no-store' }, OWNER_CTX)
      const body = await r.json().catch(() => ({}))
      if (r.ok) {
        setDiag(body.diag ?? null)
        const d = body.diag as { tokenObtained?: boolean; errorMessage?: string } | null
        if (d?.tokenObtained) {
          setMsg({ ok: true, text: '✓ token 拉取成功，打印机可用' })
          refresh()
        } else {
          setMsg({ ok: false, text: d?.errorMessage ? `token 失败：${d.errorMessage}` : 'token 拉取失败，请查看下方诊断' })
        }
      } else {
        setMsg({ ok: false, text: body.error ?? 'HTTP error' })
      }
    } catch {
      setMsg({ ok: false, text: '网络错误' })
    } finally {
      setDiagnosing(false)
    }
  }

  async function handleReprintLast() {
    if (!data) return
    const last = data.recent.find((r) => r.status === 'SUCCESS' && r.orderNo && !r.orderNo.startsWith('TEST-') && !r.orderNo.startsWith('BIND-'))
    if (!last?.orderNo) { setMsg({ ok: false, text: '暂无可重打的真实订单' }); return }
    setReprinting(true); setMsg(null); setDiag(null)
    try {
      const r = await apiFetch(`/api/print/reprint/${encodeURIComponent(last.orderNo)}`, { method: 'POST' }, OWNER_CTX)
      const body = await r.json().catch(() => ({}))
      if (!r.ok || !body?.ok) {
        setDiag(body)
        const pd = body?.parsedDiag as { message?: unknown; dataMessage?: unknown } | undefined
        const errMsg = String(pd?.dataMessage ?? pd?.message ?? body?.error ?? body?.message ?? '重打失败')
        setMsg({ ok: false, text: `重打失败：${errMsg}` })
      } else {
        setMsg({ ok: true, text: `✓ 已重打 ${last.orderNo}` })
      }
      refresh()
    } catch {
      setMsg({ ok: false, text: '网络错误' })
    } finally {
      setReprinting(false)
    }
  }

  if (loading) return <div style={pp.card}><div style={pp.muted}>加载中…</div></div>
  if (!data) return null

  return (
    <div style={pp.card}>
      <div style={pp.header}>
        <span style={pp.title}>🖨️ 云打印机</span>
        <span style={data.tierEnabled
          ? (data.configured ? pp.badgeOk : pp.badgeWarn)
          : pp.badgeOff}>
          {data.tierEnabled
            ? (data.configured ? '已启用 · 自动出票' : '需配置环境变量')
            : `${data.tier} 版 · 自动打印未开放`}
        </span>
      </div>

      {!data.tierEnabled && (
        <div style={pp.upgradeHint}>
          自动打印为高级版（STANDARD / MULTI_STORE）功能，当前商户版本为 {data.tier}。
        </div>
      )}

      {data.tierEnabled && (
        <>
          <div style={pp.actionsRow}>
            <button type="button" style={pp.btn} disabled={testing || !data.configured} onClick={handleTest}>
              {testing ? '打印中…' : '🧾 测试打印'}
            </button>
            <button type="button" style={pp.btn} disabled={reprinting || !data.configured} onClick={handleReprintLast}>
              {reprinting ? '重打中…' : '↻ 重打最近订单'}
            </button>
          </div>
          <div style={pp.actionsRow}>
            <button type="button" style={pp.btnDiag} disabled={diagnosing} onClick={handleDiagnose}>
              {diagnosing ? '诊断中…' : '🔍 token 诊断（强制重拉）'}
            </button>
            <button type="button" style={pp.btnDiag} disabled={binding || !data.configured} onClick={handleBindDevice}>
              {binding ? '绑定中…' : '🔗 绑定 / 确认设备'}
            </button>
          </div>
        </>
      )}

      {msg && (
        <div style={msg.ok ? pp.msgOk : pp.msgErr}>{msg.text}</div>
      )}

      {diag !== null && (
        <pre style={pp.diagBox}>{JSON.stringify(diag, null, 2)}</pre>
      )}

      {data.recent.length > 0 && (
        <>
          <div style={pp.recentTitle}>最近 {data.recent.length} 条打印日志</div>
          <div style={pp.recentList}>
            {data.recent.map((r, i) => (
              <div key={i} style={pp.recentRow}>
                <span style={r.status === 'SUCCESS' ? pp.recentOk : pp.recentFail}>
                  {r.status === 'SUCCESS' ? '✓' : '✕'}
                </span>
                <span style={pp.recentOrder}>{r.orderNo ?? '—'}</span>
                <span style={pp.recentTime}>{new Date(r.at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                {r.message && <span style={pp.recentMsg}>{r.message.slice(0, 30)}</span>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

const pp: Record<string, React.CSSProperties> = {
  card: { background: 'var(--card)', borderRadius: 'var(--radius)', padding: '12px 14px', marginBottom: 10 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { fontSize: 14, fontWeight: 700, color: 'var(--text)' },
  muted: { fontSize: 12, color: 'var(--muted)' },
  badgeOk:   { fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: '#f6ffed', color: '#52c41a', border: '1px solid #b7eb8f' },
  badgeWarn: { fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: '#fffbe6', color: '#d97706', border: '1px solid #ffe58f' },
  badgeOff:  { fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: '#fafafa', color: '#999',   border: '1px solid #d9d9d9' },
  upgradeHint: { fontSize: 12, color: '#888', background: '#fafafa', borderRadius: 8, padding: '8px 10px', marginBottom: 6 },
  actionsRow: { display: 'flex', gap: 8, marginBottom: 8 },
  btn: { flex: 1, height: 36, fontSize: 13, fontWeight: 600, background: '#fff', border: '1.5px solid var(--blue)', color: 'var(--blue)', borderRadius: 8, cursor: 'pointer' },
  btnDiag: { flex: 1, height: 32, fontSize: 12, fontWeight: 600, background: '#fafafa', border: '1px dashed #d9d9d9', color: '#666', borderRadius: 8, cursor: 'pointer' },
  diagBox: {
    fontSize: 10, lineHeight: 1.4, color: '#1a1a1a',
    background: '#f7f8fa',
    border: '1px solid #e8e8e8',
    borderRadius: 6, padding: '8px 10px',
    overflowX: 'auto' as const, maxHeight: 240,
    whiteSpace: 'pre-wrap' as const, wordBreak: 'break-all' as const,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    marginTop: 4,
  } as React.CSSProperties,

  msgOk:  { fontSize: 12, color: '#52c41a', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 6, padding: '6px 10px', marginBottom: 6 },
  msgErr: { fontSize: 12, color: '#cf1322', background: '#fff1f0', border: '1px solid #ffa39e', borderRadius: 6, padding: '6px 10px', marginBottom: 6 },
  recentTitle: { fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginTop: 4, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '0.04em' },
  recentList: { display: 'flex', flexDirection: 'column' as const, gap: 4 },
  recentRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#666' },
  recentOk:   { color: '#52c41a', fontWeight: 700, width: 12 },
  recentFail: { color: '#cf1322', fontWeight: 700, width: 12 },
  recentOrder: { fontFamily: 'monospace' as const, color: '#1a1a1a', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  recentTime: { color: '#aaa' },
  recentMsg:  { color: '#aaa', fontStyle: 'italic' as const, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
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
  body: { flex: 1, padding: '14px 14px 0', maxWidth: 480, margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column' as const, gap: 4 },

  // ── KHQR 当前模式提示（第一阶段静态图模式） ──
  khqrNotice: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    background: '#fffbe6',
    border: '1px solid #ffe58f',
    borderRadius: 10,
    padding: '10px 12px',
    marginBottom: 10,
  },
  khqrNoticeIcon: { fontSize: 18, lineHeight: 1.3, flexShrink: 0 },
  khqrNoticeBody: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' as const, gap: 2 },
  khqrNoticeTitle: { fontSize: 12, fontWeight: 700, color: '#7c4a00' },
  khqrNoticeText: { fontSize: 11, color: '#ad6800', lineHeight: 1.5 },
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

  // ── 门店经营查询单入口 + 抽屉 ──
  dimMenuWrap: {
    background: 'var(--card)',
    borderRadius: 'var(--radius)',
    marginBottom: 10,
    overflow: 'hidden' as const,
  },
  dimMenuToggle: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '11px 14px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left' as const,
  },
  dimMenuToggleLeft: { display: 'flex', alignItems: 'center', gap: 10 },
  dimMenuIcon: { fontSize: 18, lineHeight: 1 },
  dimMenuTitle: { fontSize: 14, fontWeight: 700, color: 'var(--text)' },
  dimMenuCurrent: { fontSize: 12, color: 'var(--muted)', marginLeft: 6, fontWeight: 500 },
  dimMenuArrow: { fontSize: 14, color: 'var(--muted)' },
  dimMenuPanel: {
    display: 'flex',
    flexDirection: 'column' as const,
    borderTop: '1px solid var(--border)',
  },
  dimMenuItem: {
    padding: '11px 14px',
    background: 'none',
    border: 'none',
    borderBottom: '1px solid var(--border)',
    textAlign: 'left' as const,
    fontSize: 13,
    color: 'var(--text)',
    cursor: 'pointer',
    fontWeight: 500,
  },
  dimMenuItemOn: {
    background: 'var(--bg)',
    color: 'var(--blue)',
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

  // ── 大入口卡（顾客资产 / 门店配置） ──
  bigEntryRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 10,
    marginTop: 16,
    marginBottom: 8,
  },
  bigEntryCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    background: 'var(--card)',
    borderRadius: 'var(--radius)',
    padding: '14px 12px',
    border: 'none',
    cursor: 'pointer',
    textDecoration: 'none',
    color: 'inherit',
    textAlign: 'left' as const,
    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
  },
  bigEntryIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 20,
    color: '#fff',
    flexShrink: 0,
    boxShadow: '0 2px 6px rgba(0,0,0,0.10)',
  },
  bigEntryBody: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' as const, gap: 2 },
  bigEntryTitle: { fontSize: 14, fontWeight: 700, color: 'var(--text)' },
  bigEntryDesc: { fontSize: 11, color: 'var(--muted)' },
  bigEntryArrow: { fontSize: 18, color: 'var(--muted)', flexShrink: 0 },
}

const ov: Record<string, React.CSSProperties> = {
  heroCard: {
    background: 'var(--blue)',
    borderRadius: 'var(--radius)',
    padding: '12px 18px 14px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    marginBottom: 8,
  },
  heroSub: { fontSize: 11, color: 'rgba(255,255,255,0.72)', marginBottom: 2 },
  heroLabel: { fontSize: 11, color: 'rgba(255,255,255,0.7)' },
  heroAmount: { fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.1, marginTop: 0 },
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
  // 兼容旧引用（已不再用）
  wrap: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
    marginBottom: 12,
  },
  // 单卡 + tab 切换
  singleCard: {
    background: 'var(--card)',
    borderRadius: 'var(--radius)',
    padding: '12px 14px 10px',
    marginBottom: 12,
  },
  tabRow: {
    display: 'flex',
    gap: 8,
    marginBottom: 10,
    borderBottom: '1px solid var(--border)',
  },
  tabBtn: {
    background: 'none',
    border: 'none',
    padding: '6px 10px 8px',
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--muted)',
    cursor: 'pointer',
    borderBottom: '2px solid transparent',
    marginBottom: -1,
  },
  tabBtnOn: {
    color: 'var(--blue)',
    borderBottomColor: 'var(--blue)',
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
  saveBtn: { fontSize: 13, fontWeight: 600, padding: '6px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' as const },
  cancelBtn: { fontSize: 13, fontWeight: 600, padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)', background: '#fff', color: 'var(--muted)', cursor: 'pointer', whiteSpace: 'nowrap' as const },
  editBtn: { fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 6, border: '1px solid var(--blue)', background: '#fff', color: 'var(--blue)', cursor: 'pointer', whiteSpace: 'nowrap' as const, flexShrink: 0 },
  readonlyRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: '#f7f8fa', borderRadius: 8, border: '1px solid var(--border)' },
  readonlyText: { flex: 1, fontSize: 13, color: 'var(--text)', minWidth: 0, lineHeight: 1.4, wordBreak: 'break-word' as const },
  readonlyMuted: { color: '#bbb', fontWeight: 400 },
  errMsg: { fontSize: 12, color: '#d97706', marginTop: 4 },
  menuSection: { marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--border)' },
  menuSectionTitle: { fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' as const, letterSpacing: '0.04em', marginBottom: 10 },
  fieldLabel: { fontSize: 12, color: 'var(--muted)', marginBottom: 4, marginTop: 8 },
  fieldAction: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 6 },
  savedHint: { fontSize: 12, color: '#16a34a', fontWeight: 600 },
  textarea: { width: '100%', fontSize: 13, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', resize: 'vertical' as const, outline: 'none', lineHeight: 1.5, boxSizing: 'border-box' as const },
  bannerPreviewWrap: { borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', marginBottom: 4 },
  bannerPreview: { width: '100%', height: 120, objectFit: 'cover' as const, display: 'block' },
  bannerBtns: { display: 'flex', gap: 8, padding: '8px 8px' },
  bannerEmpty: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 8, border: '1px dashed var(--border)', background: 'var(--bg)', marginBottom: 4 },
  bannerEmptyText: { fontSize: 12, color: 'var(--muted)' },
  bannerBtn: { fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', cursor: 'pointer' },
  bannerBtnDanger: { color: '#dc2626', borderColor: '#fca5a5' },
}
