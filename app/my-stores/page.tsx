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
  const { lang } = useLocale()
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
          <div style={s.eyebrow}>E-Shop</div>
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
              <div style={s.salesLabel}>{copy.todaySales}</div>
              <div style={s.salesAmount}>{overviewSales}</div>
              <div style={s.metricRow}>
                <Metric label={copy.orders} value={String(data.overview.orderCount)} />
                <span style={s.metricDivider} />
                <Metric label={copy.averageOrder} value={averageOrder} />
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={s.metric}>
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
    padding: 'max(22px, env(safe-area-inset-top)) 16px calc(92px + env(safe-area-inset-bottom))',
  },
  shell: { width: '100%', maxWidth: 520, margin: '0 auto' },
  header: { padding: '10px 4px 24px' },
  eyebrow: { color: '#6e6e73', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' },
  title: { margin: '7px 0 4px', fontSize: 34, lineHeight: 1.08, letterSpacing: '-0.035em', fontWeight: 760 },
  subtitle: { margin: 0, color: '#6e6e73', fontSize: 15, lineHeight: 1.5 },
  overviewCard: {
    background: 'rgba(255,255,255,0.96)',
    border: '1px solid rgba(0,0,0,0.045)',
    borderRadius: 22,
    padding: '19px 20px 17px',
    boxShadow: '0 12px 36px rgba(0,0,0,0.055)',
  },
  sectionHeading: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 16, fontWeight: 650 },
  chevron: { color: '#8e8e93', fontSize: 25, lineHeight: 0.8, fontWeight: 300 },
  salesLabel: { marginTop: 24, color: '#6e6e73', fontSize: 13 },
  salesAmount: { marginTop: 3, fontSize: 32, lineHeight: 1.15, letterSpacing: '-0.035em', fontWeight: 720 },
  metricRow: { display: 'grid', gridTemplateColumns: '1fr 1px 1fr', alignItems: 'stretch', marginTop: 20, paddingTop: 16, borderTop: '1px solid #ededf0' },
  metricDivider: { width: 1, background: '#ededf0' },
  metric: { display: 'flex', flexDirection: 'column', gap: 3, padding: '0 14px' },
  metricValue: { fontSize: 18, fontWeight: 680, letterSpacing: '-0.015em' },
  metricLabel: { color: '#8e8e93', fontSize: 12 },
  storeList: { marginTop: 18, borderRadius: 19, overflow: 'hidden', background: '#fff', border: '1px solid rgba(0,0,0,0.045)' },
  storeRow: {
    width: '100%', minHeight: 76, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
    padding: '15px 18px', background: '#fff', border: 'none', borderBottom: '1px solid #ededf0', color: '#1d1d1f',
    textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
  },
  storeText: { display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 },
  storeName: { fontSize: 16, lineHeight: 1.3, fontWeight: 620, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  storeMeta: { color: '#6e6e73', fontSize: 13, lineHeight: 1.35 },
  storeChevron: { flex: '0 0 auto', color: '#a1a1a6', fontSize: 27, lineHeight: 1, fontWeight: 300 },
  empty: { padding: '26px 20px', color: '#6e6e73', fontSize: 14, textAlign: 'center' },
  errorBox: { marginTop: 16, padding: '12px 14px', borderRadius: 14, background: '#fff2f0', color: '#a8071a', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  retryButton: { border: 'none', borderRadius: 999, background: '#1d1d1f', color: '#fff', padding: '7px 12px', fontSize: 12, fontWeight: 650, cursor: 'pointer' },
  loadingCard: { minHeight: 180, borderRadius: 22, background: '#fff', padding: 22, display: 'flex', flexDirection: 'column', gap: 20 },
  skeleton: { display: 'block', height: 15, borderRadius: 999, background: 'linear-gradient(90deg,#eeeeef,#f7f7f8,#eeeeef)' },
}
