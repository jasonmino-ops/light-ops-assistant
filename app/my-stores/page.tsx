'use client'

import { useEffect, useState } from 'react'
import { apiFetch, OWNER_CTX } from '@/lib/api'
import { formatMoney } from '@/lib/currency'
import { useLocale, type Lang } from '@/app/components/LangProvider'
import { useWorkMode } from '@/app/components/WorkModeProvider'

const DEV_OWNER_CTX = process.env.NODE_ENV !== 'production' ? OWNER_CTX : undefined

type StoreMetric = {
  id: string
  name: string
  currencyCode: string
  todaySalesAmount: number
  todayOrderCount: number
}

type HubData = {
  date: string
  overview: {
    salesAmount: number | null
    orderCount: number
    averageOrderValue: number | null
    currencyCode: string | null
    totalsByCurrency: Array<{
      currencyCode: string
      salesAmount: number
      orderCount: number
      averageOrderValue: number
    }>
  }
  stores: StoreMetric[]
}

const COPY: Record<Lang, {
  title: string
  subtitle: string
  overview: string
  overviewHint: string
  today: string
  allStores: string
  close: string
  dataNote: string
  todaySales: string
  orders: string
  averageOrder: string
  orderUnit: string
  empty: string
  loadFailed: string
  selectFailed: string
  retry: string
  mixedCurrency: string
}> = {
  zh: {
    title: '我的店铺',
    subtitle: '选择一家店进入 E-Shop',
    overview: '全部店铺经营概览',
    overviewHint: '查看全部店铺今日经营数据',
    today: '今天',
    allStores: '全部店铺',
    close: '关闭',
    dataNote: '数据仅供参考，实时数据请以各店铺为准',
    todaySales: '今日销售',
    orders: '订单',
    averageOrder: '客单价',
    orderUnit: '单',
    empty: '暂未找到可进入的 OWNER 店铺',
    loadFailed: '店铺信息加载失败，请重试',
    selectFailed: '无法进入该店铺，请重试',
    retry: '重新加载',
    mixedCurrency: '多币种',
  },
  en: {
    title: 'My Stores',
    subtitle: 'Choose a store to enter E-Shop',
    overview: 'All stores overview',
    overviewHint: "View today's performance across stores",
    today: 'Today',
    allStores: 'All stores',
    close: 'Close',
    dataNote: 'Figures are for reference. Each store remains the source of truth.',
    todaySales: 'Today sales',
    orders: 'Orders',
    averageOrder: 'Avg. order',
    orderUnit: 'orders',
    empty: 'No OWNER stores are available',
    loadFailed: 'Unable to load stores. Please retry.',
    selectFailed: 'Unable to enter this store. Please retry.',
    retry: 'Reload',
    mixedCurrency: 'Multiple currencies',
  },
  km: {
    title: 'ហាងរបស់ខ្ញុំ',
    subtitle: 'ជ្រើសរើសហាងដើម្បីចូល E-Shop',
    overview: 'ទិដ្ឋភាពរួមហាងទាំងអស់',
    overviewHint: 'មើលទិន្នន័យអាជីវកម្មថ្ងៃនេះរបស់ហាងទាំងអស់',
    today: 'ថ្ងៃនេះ',
    allStores: 'ហាងទាំងអស់',
    close: 'បិទ',
    dataNote: 'ទិន្នន័យសម្រាប់យោងប៉ុណ្ណោះ សូមយកទិន្នន័យតាមហាងនីមួយៗជាគោល',
    todaySales: 'ការលក់ថ្ងៃនេះ',
    orders: 'ការបញ្ជាទិញ',
    averageOrder: 'មធ្យមក្នុងមួយការបញ្ជាទិញ',
    orderUnit: 'ការបញ្ជាទិញ',
    empty: 'រកមិនឃើញហាង OWNER ដែលអាចចូលបានទេ',
    loadFailed: 'មិនអាចទាញព័ត៌មានហាងបានទេ សូមព្យាយាមម្ដងទៀត',
    selectFailed: 'មិនអាចចូលហាងនេះបានទេ សូមព្យាយាមម្ដងទៀត',
    retry: 'ផ្ទុកឡើងវិញ',
    mixedCurrency: 'រូបិយប័ណ្ណច្រើន',
  },
}

export default function MyStoresPage() {
  const { lang, setLang } = useLocale()
  const { realRole } = useWorkMode()
  const copy = COPY[lang] ?? COPY.zh
  const [data, setData] = useState<HubData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [loadKey, setLoadKey] = useState(0)
  const [selectingStoreId, setSelectingStoreId] = useState<string | null>(null)
  const [overviewOpen, setOverviewOpen] = useState(false)

  useEffect(() => {
    if (realRole !== 'OWNER') {
      window.location.replace('/home')
      return
    }

    setLoading(true)
    setError('')
    apiFetch('/api/owner/stores', { cache: 'no-store' }, DEV_OWNER_CTX)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status))
        return res.json() as Promise<HubData>
      })
      .then(setData)
      .catch(() => {
        setData(null)
        setError(copy.loadFailed)
      })
      .finally(() => setLoading(false))
  }, [realRole, loadKey, copy.loadFailed])

  async function selectStore(storeId: string) {
    if (selectingStoreId) return
    setSelectingStoreId(storeId)
    setError('')
    try {
      const res = await apiFetch('/api/owner/stores/select', {
        method: 'POST',
        body: JSON.stringify({ storeId }),
      }, DEV_OWNER_CTX)
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.ok) throw new Error(body.error ?? String(res.status))

      // Summary cache is store-session specific in practice but its legacy key
      // is not. Remove only that UI cache before entering the newly selected store.
      for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
        const key = sessionStorage.key(index)
        if (key?.startsWith('home-summary:')) sessionStorage.removeItem(key)
      }
      window.location.replace('/home')
    } catch {
      setSelectingStoreId(null)
      setError(copy.selectFailed)
    }
  }

  const overviewSales = data?.overview.totalsByCurrency.length
    ? data.overview.totalsByCurrency
        .map((total) => formatMoney(total.salesAmount, total.currencyCode))
        .join(' · ')
    : formatMoney(0, data?.overview.currencyCode)
  const averageOrder = data?.overview.averageOrderValue == null
    ? copy.mixedCurrency
    : formatMoney(data.overview.averageOrderValue, data.overview.currencyCode)

  return (
    <main style={s.page}>
      <style>{`
        .owner-overview-trigger {
          transform: scale(1);
          transition: transform 150ms ease, box-shadow 150ms ease;
        }
        .owner-overview-trigger:focus { outline: none; }
        .owner-overview-trigger:focus-visible {
          box-shadow: 0 0 0 3px rgba(115, 87, 217, 0.22), 0 9px 26px rgba(67, 75, 132, 0.075);
        }
        .owner-overview-trigger:active { transform: scale(0.97); }
        .owner-store-row {
          transform: translateZ(0);
          transition: transform 150ms ease, box-shadow 150ms ease;
        }
        .owner-store-row:focus { outline: none; }
        .owner-store-row:focus-visible {
          box-shadow: 0 0 0 3px rgba(115, 87, 217, 0.18), 0 8px 22px rgba(55, 70, 122, 0.07);
        }
        .owner-store-row:active { transform: scale(0.985); }
        @keyframes ownerSheetIn {
          from { transform: translateY(24px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes ownerBackdropIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .owner-overview-trigger, .owner-store-row { transition: none; }
          .owner-sheet, .owner-sheet-backdrop { animation: none !important; }
        }
      `}</style>
      <div style={s.shell}>
        <header style={s.header}>
          <div style={s.headerTopRow}>
            <div style={s.eyebrow}>E-Shop</div>
            <LangDropdown lang={lang} setLang={setLang} />
          </div>
          <h1 style={s.title}>{copy.title}</h1>
          <p style={s.subtitle}>{copy.subtitle}</p>
        </header>

        {loading ? (
          <div style={s.loadingCard} aria-live="polite">
            <span style={{ ...s.skeleton, width: '58%' }} />
            <span style={{ ...s.skeleton, width: '86%', height: 42 }} />
            <span style={{ ...s.skeleton, width: '72%' }} />
          </div>
        ) : data ? (
          <>
            <button
              type="button"
              className="owner-overview-trigger"
              style={s.overviewTrigger}
              aria-haspopup="dialog"
              aria-expanded={overviewOpen}
              onClick={() => setOverviewOpen(true)}
            >
              <HubIcon kind="overview" color="#7357d9" background="#eee9ff" />
              <span style={s.overviewTriggerText}>
                <span style={s.overviewTriggerTitle}>{copy.overview}</span>
                <span style={s.overviewTriggerHint}>{copy.overviewHint}</span>
              </span>
              <span style={s.overviewTriggerChevron}>›</span>
            </button>

            <section style={s.overviewCard} aria-label={copy.overview}>
              <div style={s.metricRow}>
                <Metric icon="sales" label={copy.todaySales} value={overviewSales} />
                <Metric icon="orders" label={copy.orders} value={String(data.overview.orderCount)} divided />
                <Metric icon="average" label={copy.averageOrder} value={averageOrder} divided />
              </div>
            </section>

            <section style={s.storeList} aria-label={copy.title}>
              {data.stores.length === 0 ? (
                <div style={s.empty}>{copy.empty}</div>
              ) : data.stores.map((store, index) => {
                const selecting = selectingStoreId === store.id
                const tone = STORE_TONES[index % STORE_TONES.length]
                return (
                  <button
                    key={store.id}
                    type="button"
                    className="owner-store-row"
                    style={s.storeRow}
                    disabled={!!selectingStoreId}
                    onClick={() => selectStore(store.id)}
                  >
                    <HubIcon kind="store" color={tone.color} background={tone.background} size={44} />
                    <span style={s.storeText}>
                      <span style={s.storeName}>{store.name}</span>
                      <span style={s.storeMeta}>
                        {formatMoney(store.todaySalesAmount, store.currencyCode)} · {store.todayOrderCount} {copy.orderUnit}
                      </span>
                    </span>
                    <span style={s.storeChevron}>{selecting ? '…' : '›'}</span>
                  </button>
                )
              })}
            </section>
          </>
        ) : null}

        {error && (
          <div style={s.errorBox} role="alert">
            <span>{error}</span>
            {!data && (
              <button type="button" style={s.retryButton} onClick={() => setLoadKey((key) => key + 1)}>
                {copy.retry}
              </button>
            )}
          </div>
        )}
      </div>

      {overviewOpen && data && (
        <div
          className="owner-sheet-backdrop"
          style={s.sheetBackdrop}
          onClick={() => setOverviewOpen(false)}
        >
          <section
            className="owner-sheet"
            style={s.sheet}
            role="dialog"
            aria-modal="true"
            aria-label={copy.overview}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={s.sheetGrabber} aria-hidden="true" />
            <div style={s.sheetHeader}>
              <div>
                <h2 style={s.sheetTitle}>{copy.overview}</h2>
                <div style={s.sheetDate}>{copy.today}</div>
              </div>
              <button
                type="button"
                aria-label={copy.close}
                style={s.sheetClose}
                onClick={() => setOverviewOpen(false)}
              >
                ×
              </button>
            </div>

            <div style={s.sheetSummaryCard}>
              <div style={s.sheetSummaryTitle}>{copy.allStores}</div>
              <div style={s.sheetMetricGrid}>
                <SheetMetric label={copy.todaySales} value={overviewSales} />
                <SheetMetric label={copy.orders} value={String(data.overview.orderCount)} divided />
                <SheetMetric label={copy.averageOrder} value={averageOrder} divided />
              </div>
            </div>

            <div style={s.sheetStoreList}>
              {data.stores.map((store, index) => {
                const tone = STORE_TONES[index % STORE_TONES.length]
                const storeAverage = store.todayOrderCount > 0
                  ? store.todaySalesAmount / store.todayOrderCount
                  : 0
                return (
                  <div key={store.id} style={s.sheetStoreRow}>
                    <HubIcon kind="store" color={tone.color} background={tone.background} size={38} />
                    <div style={s.sheetStoreText}>
                      <div style={s.sheetStoreName}>{store.name}</div>
                      <div style={s.sheetStoreMeta}>
                        {formatMoney(store.todaySalesAmount, store.currencyCode)} · {store.todayOrderCount} {copy.orderUnit} · {copy.averageOrder} {formatMoney(storeAverage, store.currencyCode)}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            <div style={s.sheetNote}>{copy.dataNote}</div>
          </section>
        </div>
      )}
    </main>
  )
}

function LangDropdown({ lang, setLang }: { lang: Lang; setLang: (value: Lang) => void }) {
  const [open, setOpen] = useState(false)
  const items: Array<{ code: Lang; flag: string; label: string }> = [
    { code: 'zh', flag: '🇨🇳', label: '中文' },
    { code: 'en', flag: '🇬🇧', label: 'English' },
    { code: 'km', flag: '🇰🇭', label: 'ភាសាខ្មែរ' },
  ]
  const current = items.find((item) => item.code === lang) ?? items[0]

  return (
    <div style={s.languageControl}>
      <button
        type="button"
        aria-label="Language"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        style={s.languageButton}
      >
        <span style={s.languageFlag}>{current.flag}</span>
        <span>{current.label}</span>
        <span style={s.languageCaret}>▾</span>
      </button>
      {open && (
        <>
          <div aria-hidden="true" onClick={() => setOpen(false)} style={s.languageDismiss} />
          <div style={s.languageMenu} role="menu">
            {items.map((item) => {
              const active = item.code === lang
              return (
                <button
                  key={item.code}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => {
                    if (!active) setLang(item.code)
                    setOpen(false)
                  }}
                  style={{ ...s.languageOption, ...(active ? s.languageOptionActive : {}) }}
                >
                  <span style={s.languageOptionFlag}>{item.flag}</span>
                  <span style={s.languageOptionLabel}>{item.label}</span>
                  <span style={{ ...s.languageCheck, opacity: active ? 1 : 0 }}>✓</span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

type HubIconKind = 'overview' | 'sales' | 'orders' | 'average' | 'store'

const STORE_TONES = [
  { color: '#6c5ce7', background: '#eeeaff' },
  { color: '#4386d8', background: '#e8f3ff' },
  { color: '#c8783c', background: '#fff0e5' },
  { color: '#3f9c82', background: '#e6f7f1' },
]

function HubIcon({
  kind,
  color,
  background,
  size = 38,
}: {
  kind: HubIconKind
  color: string
  background: string
  size?: number
}) {
  return (
    <span style={{ ...s.iconBadge, width: size, height: size, color, background }} aria-hidden="true">
      <svg width={size >= 44 ? 23 : 19} height={size >= 44 ? 23 : 19} viewBox="0 0 24 24" fill="none">
        {kind === 'overview' && (
          <>
            <path d="M5 18v-5M12 18V6M19 18v-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M3.5 20h17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </>
        )}
        {kind === 'sales' && (
          <>
            <rect x="3.5" y="6.5" width="17" height="12" rx="3" stroke="currentColor" strokeWidth="1.8" />
            <path d="M4.5 10h15M15.5 14.5h2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </>
        )}
        {kind === 'orders' && (
          <>
            <rect x="5" y="4" width="14" height="17" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
            <path d="M9 3h6v3H9zM8.5 11h7M8.5 15h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </>
        )}
        {kind === 'average' && (
          <>
            <circle cx="8" cy="9" r="3" stroke="currentColor" strokeWidth="1.8" />
            <path d="M3.5 18c.8-2.7 2.3-4 4.5-4s3.7 1.3 4.5 4M15 8h5M17.5 5.5v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </>
        )}
        {kind === 'store' && (
          <>
            <path d="M4 10.5V20h16v-9.5M3 10.5l2-6h14l2 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3 10.5c0 1.4 1 2.5 2.3 2.5s2.3-1.1 2.3-2.5c0 1.4 1 2.5 2.3 2.5s2.3-1.1 2.3-2.5c0 1.4 1 2.5 2.3 2.5s2.3-1.1 2.3-2.5c0 1.4 1 2.5 2.3 2.5s2.3-1.1 2.3-2.5M9.5 20v-4.5h5V20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </>
        )}
      </svg>
    </span>
  )
}

function Metric({
  icon,
  label,
  value,
  divided = false,
}: {
  icon: Extract<HubIconKind, 'sales' | 'orders' | 'average'>
  label: string
  value: string
  divided?: boolean
}) {
  const tone = icon === 'sales'
    ? { color: '#36a476', background: '#e8f7f1' }
    : icon === 'orders'
      ? { color: '#4c8fdd', background: '#eaf3ff' }
      : { color: '#d18a42', background: '#fff2e5' }

  return (
    <div style={{ ...s.metric, ...(divided ? s.metricDivided : {}) }}>
      <HubIcon kind={icon} {...tone} size={30} />
      <span style={s.metricValue}>{value}</span>
      <span style={s.metricLabel}>{label}</span>
    </div>
  )
}

function SheetMetric({ label, value, divided = false }: { label: string; value: string; divided?: boolean }) {
  return (
    <div style={{ ...s.sheetMetric, ...(divided ? s.sheetMetricDivided : {}) }}>
      <span style={s.sheetMetricLabel}>{label}</span>
      <span style={s.sheetMetricValue}>{value}</span>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'radial-gradient(circle at 92% 4%, rgba(221,211,255,0.78), transparent 34%), radial-gradient(circle at 4% 52%, rgba(211,232,255,0.72), transparent 38%), linear-gradient(155deg, #f7f8ff 0%, #edf4ff 48%, #f4efff 100%)',
    color: '#1d1d1f',
    padding: 'max(18px, env(safe-area-inset-top)) 16px calc(92px + env(safe-area-inset-bottom))',
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif',
  },
  shell: { width: '100%', maxWidth: 520, margin: '0 auto' },
  header: { padding: '4px 4px 20px' },
  headerTopRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, minHeight: 38 },
  eyebrow: { color: '#7466c9', fontSize: 12, fontWeight: 750, letterSpacing: '0.08em', textTransform: 'uppercase' },
  title: { margin: '12px 0 5px', fontSize: 36, lineHeight: 1.05, letterSpacing: '-0.04em', fontWeight: 760 },
  subtitle: { margin: 0, color: '#6e6e73', fontSize: 15, lineHeight: 1.5 },
  overviewTrigger: {
    width: '100%', minHeight: 66, display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px',
    border: '1px solid rgba(115,87,217,0.12)', borderRadius: 18, background: 'rgba(255,255,255,0.76)',
    color: '#1d1d1f', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
    boxShadow: '0 9px 26px rgba(67,75,132,0.075)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
    WebkitTapHighlightColor: 'transparent',
  },
  overviewTriggerText: { minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 3 },
  overviewTriggerTitle: { fontSize: 15, lineHeight: 1.3, fontWeight: 720, letterSpacing: '-0.012em' },
  overviewTriggerHint: { color: '#81818a', fontSize: 11, lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  overviewTriggerChevron: { flex: '0 0 auto', color: '#7965ca', fontSize: 26, lineHeight: 1, fontWeight: 320 },
  overviewCard: {
    marginTop: 10,
    background: 'rgba(255,255,255,0.72)',
    border: '1px solid rgba(255,255,255,0.86)',
    borderRadius: 18,
    padding: '13px 12px 12px',
    boxShadow: '0 9px 24px rgba(57,72,125,0.07)',
    backdropFilter: 'blur(18px)',
    WebkitBackdropFilter: 'blur(18px)',
  },
  metricRow: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', alignItems: 'stretch' },
  metric: { minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '0 7px', textAlign: 'center' },
  metricDivided: { borderLeft: '1px solid rgba(94,99,122,0.10)' },
  metricValue: { marginTop: 2, fontSize: 16, lineHeight: 1.2, fontWeight: 740, letterSpacing: '-0.025em', overflowWrap: 'anywhere' },
  metricLabel: { color: '#85858d', fontSize: 10, lineHeight: 1.25 },
  storeList: { marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 },
  storeRow: {
    width: '100%', minHeight: 76, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    padding: '13px 15px 13px 13px', background: 'rgba(255,255,255,0.78)', border: '1px solid rgba(255,255,255,0.88)', borderRadius: 18, color: '#1d1d1f',
    textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 8px 22px rgba(55,70,122,0.07)',
    backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
    WebkitTapHighlightColor: 'transparent',
  },
  storeText: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 },
  storeName: { fontSize: 15, lineHeight: 1.3, fontWeight: 690, letterSpacing: '-0.012em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  storeMeta: { color: '#74747d', fontSize: 12, lineHeight: 1.35 },
  storeChevron: { flex: '0 0 auto', color: '#8f79d2', fontSize: 25, lineHeight: 1, fontWeight: 320 },
  empty: { padding: '26px 20px', borderRadius: 18, background: 'rgba(255,255,255,0.76)', border: '1px solid rgba(255,255,255,0.88)', color: '#6e6e73', fontSize: 14, textAlign: 'center', backdropFilter: 'blur(16px)' },
  errorBox: { marginTop: 16, padding: '12px 14px', borderRadius: 14, background: '#fff2f0', color: '#a8071a', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  retryButton: { border: 'none', borderRadius: 999, background: '#1d1d1f', color: '#fff', padding: '7px 12px', fontSize: 12, fontWeight: 650, cursor: 'pointer' },
  loadingCard: { minHeight: 160, borderRadius: 20, background: 'rgba(255,255,255,0.72)', padding: 20, display: 'flex', flexDirection: 'column', gap: 18, border: '1px solid rgba(255,255,255,0.88)', backdropFilter: 'blur(16px)' },
  skeleton: { display: 'block', height: 15, borderRadius: 999, background: 'linear-gradient(90deg,#ebeaf4,#f7f6fb,#ebeaf4)' },
  iconBadge: { flex: '0 0 auto', borderRadius: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
  languageControl: { position: 'relative', flex: '0 0 auto' },
  languageButton: {
    minHeight: 36, minWidth: 104, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    padding: '7px 10px', borderRadius: 999, border: '1px solid rgba(101,92,160,0.10)', background: 'rgba(255,255,255,0.74)',
    color: '#1d1d1f', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer',
    boxShadow: '0 5px 18px rgba(56,66,120,0.06)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', WebkitTapHighlightColor: 'transparent',
  },
  languageFlag: { fontSize: 15, lineHeight: 1 },
  languageCaret: { marginLeft: 1, color: '#8e8e93', fontSize: 9 },
  languageDismiss: { position: 'fixed', inset: 0, zIndex: 50 },
  languageMenu: {
    position: 'absolute', top: 'calc(100% + 7px)', right: 0, zIndex: 60, minWidth: 164, padding: 5,
    borderRadius: 14, border: '1px solid rgba(0,0,0,0.08)', background: 'rgba(255,255,255,0.98)',
    boxShadow: '0 14px 38px rgba(0,0,0,0.14)', backdropFilter: 'blur(18px)',
  },
  languageOption: {
    width: '100%', minHeight: 40, display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px',
    border: 'none', borderRadius: 10, background: 'transparent', color: '#1d1d1f', fontFamily: 'inherit',
    fontSize: 13, textAlign: 'left', cursor: 'pointer',
  },
  languageOptionActive: { background: '#eef6ff' },
  languageOptionFlag: { fontSize: 17, lineHeight: 1 },
  languageOptionLabel: { flex: 1 },
  languageCheck: { color: '#007aff', fontSize: 13, fontWeight: 700 },
  sheetBackdrop: {
    position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    background: 'rgba(24,28,48,0.30)', backdropFilter: 'blur(5px)', WebkitBackdropFilter: 'blur(5px)',
    animation: 'ownerBackdropIn 180ms ease-out',
  },
  sheet: {
    width: '100%', maxWidth: 540, minHeight: '52vh', maxHeight: '76vh', overflowY: 'auto',
    borderRadius: '24px 24px 0 0', border: '1px solid rgba(255,255,255,0.9)', borderBottom: 'none',
    background: 'rgba(250,251,255,0.97)', boxShadow: '0 -18px 54px rgba(25,31,62,0.18)',
    padding: '8px 16px calc(20px + env(safe-area-inset-bottom))',
    animation: 'ownerSheetIn 220ms cubic-bezier(0.22, 1, 0.36, 1)',
  },
  sheetGrabber: { width: 38, height: 5, margin: '2px auto 10px', borderRadius: 999, background: '#d7d7dc' },
  sheetHeader: { minHeight: 54, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, padding: '2px 0 12px' },
  sheetTitle: { margin: 0, fontSize: 19, lineHeight: 1.25, fontWeight: 760, letterSpacing: '-0.025em' },
  sheetDate: { marginTop: 5, color: '#8a8a93', fontSize: 12, lineHeight: 1.3 },
  sheetClose: {
    flex: '0 0 auto', width: 36, height: 36, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    border: 'none', borderRadius: '50%', background: '#ececf1', color: '#696970', fontSize: 23, lineHeight: 1,
    cursor: 'pointer', fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent',
  },
  sheetSummaryCard: {
    padding: '14px', borderRadius: 18, background: '#fff', border: '1px solid rgba(65,74,114,0.07)',
    boxShadow: '0 6px 20px rgba(50,61,106,0.055)',
  },
  sheetSummaryTitle: { fontSize: 14, fontWeight: 720, letterSpacing: '-0.01em' },
  sheetMetricGrid: { marginTop: 13, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
  sheetMetric: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4, paddingRight: 9 },
  sheetMetricDivided: { borderLeft: '1px solid #ededf2', paddingLeft: 11 },
  sheetMetricLabel: { color: '#8a8a93', fontSize: 10, lineHeight: 1.25 },
  sheetMetricValue: { fontSize: 17, lineHeight: 1.25, fontWeight: 740, letterSpacing: '-0.02em', overflowWrap: 'anywhere' },
  sheetStoreList: { marginTop: 11, overflow: 'hidden', borderRadius: 18, background: '#fff', border: '1px solid rgba(65,74,114,0.07)' },
  sheetStoreRow: { minHeight: 68, display: 'flex', alignItems: 'center', gap: 11, padding: '12px 13px', borderBottom: '1px solid #efeff3' },
  sheetStoreText: { minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 4 },
  sheetStoreName: { fontSize: 14, lineHeight: 1.3, fontWeight: 690, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  sheetStoreMeta: { color: '#74747d', fontSize: 11, lineHeight: 1.45, overflowWrap: 'anywhere' },
  sheetNote: { padding: '14px 8px 2px', color: '#92929a', fontSize: 10, lineHeight: 1.5, textAlign: 'center' },
}
