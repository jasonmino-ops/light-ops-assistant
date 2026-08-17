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
            <section style={s.overviewCard} aria-label={copy.overview}>
              <div style={s.sectionHeading}>
                <span>{copy.overview}</span>
                <span style={s.chevron}>›</span>
              </div>
              <div style={s.metricRow}>
                <Metric label={copy.todaySales} value={overviewSales} />
                <Metric label={copy.orders} value={String(data.overview.orderCount)} divided />
                <Metric label={copy.averageOrder} value={averageOrder} divided />
              </div>
            </section>

            <section style={s.storeList} aria-label={copy.title}>
              {data.stores.length === 0 ? (
                <div style={s.empty}>{copy.empty}</div>
              ) : data.stores.map((store) => {
                const selecting = selectingStoreId === store.id
                return (
                  <button
                    key={store.id}
                    type="button"
                    style={s.storeRow}
                    disabled={!!selectingStoreId}
                    onClick={() => selectStore(store.id)}
                  >
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

function Metric({ label, value, divided = false }: { label: string; value: string; divided?: boolean }) {
  return (
    <div style={{ ...s.metric, ...(divided ? s.metricDivided : {}) }}>
      <span style={s.metricValue}>{value}</span>
      <span style={s.metricLabel}>{label}</span>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f5f5f7',
    color: '#1d1d1f',
    padding: 'max(18px, env(safe-area-inset-top)) 16px calc(92px + env(safe-area-inset-bottom))',
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif',
  },
  shell: { width: '100%', maxWidth: 520, margin: '0 auto' },
  header: { padding: '4px 4px 22px' },
  headerTopRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, minHeight: 38 },
  eyebrow: { color: '#6e6e73', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' },
  title: { margin: '12px 0 5px', fontSize: 36, lineHeight: 1.05, letterSpacing: '-0.04em', fontWeight: 760 },
  subtitle: { margin: 0, color: '#6e6e73', fontSize: 15, lineHeight: 1.5 },
  overviewCard: {
    background: '#fff',
    border: '1px solid rgba(0,0,0,0.055)',
    borderRadius: 20,
    padding: '16px 17px 15px',
    boxShadow: '0 8px 26px rgba(0,0,0,0.045)',
  },
  sectionHeading: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 15, fontWeight: 680, letterSpacing: '-0.01em' },
  chevron: { color: '#aeaeb2', fontSize: 23, lineHeight: 0.8, fontWeight: 300 },
  metricRow: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', alignItems: 'stretch', marginTop: 14, paddingTop: 14, borderTop: '1px solid #ededf0' },
  metric: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5, padding: '0 10px 0 0' },
  metricDivided: { borderLeft: '1px solid #ededf0', padding: '0 8px 0 12px' },
  metricValue: { fontSize: 17, lineHeight: 1.2, fontWeight: 700, letterSpacing: '-0.02em', overflowWrap: 'anywhere' },
  metricLabel: { color: '#8e8e93', fontSize: 11, lineHeight: 1.25 },
  storeList: { marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 },
  storeRow: {
    width: '100%', minHeight: 72, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
    padding: '14px 16px 14px 17px', background: '#fff', border: '1px solid rgba(0,0,0,0.055)', borderRadius: 18, color: '#1d1d1f',
    textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 18px rgba(0,0,0,0.035)',
    WebkitTapHighlightColor: 'transparent',
  },
  storeText: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 },
  storeName: { fontSize: 16, lineHeight: 1.3, fontWeight: 660, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  storeMeta: { color: '#6e6e73', fontSize: 13, lineHeight: 1.35 },
  storeChevron: { flex: '0 0 auto', color: '#aeaeb2', fontSize: 26, lineHeight: 1, fontWeight: 300 },
  empty: { padding: '26px 20px', borderRadius: 18, background: '#fff', border: '1px solid rgba(0,0,0,0.055)', color: '#6e6e73', fontSize: 14, textAlign: 'center' },
  errorBox: { marginTop: 16, padding: '12px 14px', borderRadius: 14, background: '#fff2f0', color: '#a8071a', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  retryButton: { border: 'none', borderRadius: 999, background: '#1d1d1f', color: '#fff', padding: '7px 12px', fontSize: 12, fontWeight: 650, cursor: 'pointer' },
  loadingCard: { minHeight: 160, borderRadius: 20, background: '#fff', padding: 20, display: 'flex', flexDirection: 'column', gap: 18, border: '1px solid rgba(0,0,0,0.055)' },
  skeleton: { display: 'block', height: 15, borderRadius: 999, background: 'linear-gradient(90deg,#eeeeef,#f7f7f8,#eeeeef)' },
  languageControl: { position: 'relative', flex: '0 0 auto' },
  languageButton: {
    minHeight: 36, minWidth: 104, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    padding: '7px 10px', borderRadius: 999, border: '1px solid rgba(0,0,0,0.08)', background: 'rgba(255,255,255,0.94)',
    color: '#1d1d1f', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer',
    boxShadow: '0 4px 16px rgba(0,0,0,0.045)', WebkitTapHighlightColor: 'transparent',
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
}
