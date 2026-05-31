'use client'

import { useEffect, useState, CSSProperties } from 'react'
import { useParams } from 'next/navigation'

// ── Types ────────────────────────────────────────────────────────────────────

type Lang = 'zh' | 'en' | 'km'

type LinkStat = {
  code: string; videoTitle: string | null
  viewCount: number; clickCount: number; orderCount: number; salesAmount: number
  commissionType: string | null; commissionValue: number | null
  estimatedCommission: number; settlementStatus: string
  settledAt: string | null; createdAt: string
}

type DashboardData = {
  creator: {
    name: string; displayName: string | null; tiktokHandle: string | null
    preferredLang: string | null
  }
  summary: {
    totalViews: number; totalClicks: number; totalOrders: number
    totalSalesAmount: number; totalEstimatedCommission: number
    totalSettledCommission: number; totalUnsettledCommission: number
  }
  links: LinkStat[]
}

// ── i18n ─────────────────────────────────────────────────────────────────────

const LANGS: Lang[] = ['zh', 'en', 'km']
const LANG_LABELS: Record<Lang, string> = { zh: '中', en: 'EN', km: 'ខ្មែរ' }
const LS_KEY = 'creatorDashboardLang'

const I18N: Record<Lang, {
  views: string; clicks: string; orders: string; sales: string
  commission: string; settled: string; unsettled: string
  links: string; salesAmt: string; commRule: string; settledOn: string
  settledBadge: string; unsettledBadge: string
  noLinks: string; loading: string
  notFound: string; notFoundHint: string; poweredBy: string
}> = {
  zh: {
    views:          '总浏览',
    clicks:         '总点击',
    orders:         '总订单',
    sales:          '总成交',
    commission:     '预计佣金',
    settled:        '已结算',
    unsettled:      '待结算',
    links:          '推广链接明细',
    salesAmt:       '成交',
    commRule:       '佣金规则',
    settledOn:      '已结算于',
    settledBadge:   '已结算',
    unsettledBadge: '未结算',
    noLinks:        '暂无推广链接数据',
    loading:        '加载中…',
    notFound:       '看板链接不存在或已失效',
    notFoundHint:   '请联系商家获取最新看板链接',
    poweredBy:      '由店小二 · E-Life 驱动',
  },
  en: {
    views:          'Total Views',
    clicks:         'Total Clicks',
    orders:         'Orders',
    sales:          'Revenue',
    commission:     'Est. Commission',
    settled:        'Settled',
    unsettled:      'Pending',
    links:          'Campaign Links',
    salesAmt:       'Sales',
    commRule:       'Rate',
    settledOn:      'Settled on',
    settledBadge:   'Settled',
    unsettledBadge: 'Unsettled',
    noLinks:        'No campaign links yet',
    loading:        'Loading…',
    notFound:       'Dashboard link not found or expired',
    notFoundHint:   'Please contact the shop for the latest link',
    poweredBy:      'Powered by 店小二 · E-Life',
  },
  km: {
    views:          'ការមើលសរុប',
    clicks:         'ការចុចសរុប',
    orders:         'បញ្ជាទិញ',
    sales:          'ប្រាក់ចំណូល',
    commission:     'កម្រៃប៉ាន់ស្មាន',
    settled:        'បានទូទាត់',
    unsettled:      'មិនទាន់ទូទាត់',
    links:          'តំណភ្ជាប់ផ្សព្វផ្សាយ',
    salesAmt:       'លក់បាន',
    commRule:       'អត្រាកម្រៃ',
    settledOn:      'ទូទាត់នៅ',
    settledBadge:   'បានទូទាត់',
    unsettledBadge: 'មិនទាន់',
    noLinks:        'មិនទាន់មានតំណភ្ជាប់',
    loading:        'កំពុងផ្ទុក…',
    notFound:       'តំណភ្ជាប់មិនមាន ឬ​ផុតកំណត់',
    notFoundHint:   'សូមទំនាក់ទំនងហាងដើម្បីទទួលបានតំណភ្ជាប់ថ្មី',
    poweredBy:      'ដំណើរការដោយ 店小二 · E-Life',
  },
}

function detectLang(urlLang: string | null, preferredLang: string | null): Lang {
  if (urlLang && LANGS.includes(urlLang as Lang)) return urlLang as Lang
  try {
    const saved = localStorage.getItem(LS_KEY)
    if (saved && LANGS.includes(saved as Lang)) return saved as Lang
  } catch { /* ssr */ }
  if (preferredLang && LANGS.includes(preferredLang as Lang)) return preferredLang as Lang
  const nav = navigator.language?.slice(0, 2).toLowerCase()
  if (nav === 'km' || nav === 'kh') return 'km'
  if (nav === 'en') return 'en'
  return 'zh'
}

function commLabel(type: string | null, value: number | null, lang: Lang): string {
  if (!type || value == null) return lang === 'zh' ? '无佣金' : lang === 'en' ? 'No commission' : 'គ្មានកម្រៃ'
  if (type === 'percent') return `${value}%`
  return `$${value.toFixed(2)}/${lang === 'zh' ? '单' : lang === 'en' ? 'order' : 'ការបញ្ជា'}`
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function CreatorDashboard() {
  const { token } = useParams<{ token: string }>()
  const [data,    setData]    = useState<DashboardData | null>(null)
  const [invalid, setInvalid] = useState(false)
  const [loading, setLoading] = useState(true)
  const [lang,    setLang]    = useState<Lang>('zh')

  useEffect(() => {
    fetch(`/api/creator-public/${token}`)
      .then((r) => {
        if (r.status === 404) { setInvalid(true); setLoading(false); return null }
        return r.json()
      })
      .then((d: DashboardData | null) => {
        if (d) {
          setData(d)
          // Language detection runs once after data is available
          const urlLang = new URLSearchParams(window.location.search).get('lang')
          setLang(detectLang(urlLang, d.creator.preferredLang))
          setLoading(false)
        }
      })
      .catch(() => { setInvalid(true); setLoading(false) })
  }, [token])

  function switchLang(l: Lang) {
    setLang(l)
    try { localStorage.setItem(LS_KEY, l) } catch { /* ssr */ }
  }

  function T(key: keyof typeof I18N['zh']): string { return I18N[lang][key] }

  // ── Styles ──────────────────────────────────────────────────────────────────

  const s: Record<string, CSSProperties> = {
    wrap:     { minHeight: '100dvh', background: '#f9fafb', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans Khmer",sans-serif' },
    inner:    { maxWidth: 480, margin: '0 auto', padding: '24px 16px 64px' },
    topBar:   { display: 'flex', justifyContent: 'flex-end', marginBottom: 16, gap: 4 },
    header:   { marginBottom: 20 },
    name:     { fontSize: 22, fontWeight: 800, color: '#111827', margin: '0 0 4px' },
    handle:   { fontSize: 14, color: '#6b7280' },
    grid:     { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 },
    statCard: { background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: '14px 16px' },
    statVal:  { fontSize: 22, fontWeight: 800, color: '#111827', margin: '0 0 2px' },
    statLbl:  { fontSize: 11, color: '#9ca3af', fontWeight: 500 },
    card:     { background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: '14px 16px', marginBottom: 10 },
    sectionH: { fontSize: 14, fontWeight: 700, color: '#111827', margin: '0 0 14px' },
    code:     { fontSize: 15, fontWeight: 700, color: '#07c160', letterSpacing: '0.04em' },
    row:      { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
    stat:     { fontSize: 11, color: '#9ca3af', marginTop: 3 },
    commCard: { background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: '14px 16px', marginBottom: 16 },
    commRow:  { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 },
    poweredBy:{ textAlign: 'center' as const, fontSize: 11, color: '#d1d5db', marginTop: 32 },
  }

  function langBtn(active: boolean): CSSProperties {
    return {
      padding: '3px 8px', fontSize: 11, fontWeight: 600, borderRadius: 12,
      border: '1px solid', cursor: 'pointer',
      background:  active ? '#07c160' : '#f3f4f6',
      color:       active ? '#fff'    : '#6b7280',
      borderColor: active ? '#07c160' : '#e5e7eb',
    }
  }

  function badge(settled: boolean): CSSProperties {
    return {
      display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
      background: settled ? '#f0fdf4' : '#fef9c3',
      color:      settled ? '#15803d' : '#854d0e',
    }
  }

  // ── Error / loading states ───────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={s.wrap}>
        <div style={{ ...s.inner, paddingTop: 80, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>
          {I18N[lang].loading}
        </div>
      </div>
    )
  }

  if (invalid || !data) {
    return (
      <div style={s.wrap}>
        <div style={{ ...s.inner, paddingTop: 60 }}>
          <div style={s.topBar}>
            {LANGS.map((l) => (
              <button key={l} style={langBtn(l === lang)} onClick={() => switchLang(l)}>{LANG_LABELS[l]}</button>
            ))}
          </div>
          <div style={{ textAlign: 'center' as const }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🔗</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#374151', marginBottom: 8 }}>{T('notFound')}</div>
            <div style={{ fontSize: 13, color: '#9ca3af' }}>{T('notFoundHint')}</div>
          </div>
        </div>
      </div>
    )
  }

  const { creator, summary, links } = data

  return (
    <div style={s.wrap}>
      <div style={s.inner}>

        {/* 语言切换 */}
        <div style={s.topBar}>
          {LANGS.map((l) => (
            <button key={l} style={langBtn(l === lang)} onClick={() => switchLang(l)}>{LANG_LABELS[l]}</button>
          ))}
        </div>

        {/* 头部 */}
        <div style={s.header}>
          <h1 style={s.name}>{creator.displayName ?? creator.name}</h1>
          {creator.tiktokHandle && <div style={s.handle}>🎵 @{creator.tiktokHandle}</div>}
        </div>

        {/* 流量概览 */}
        <div style={s.grid}>
          <div style={s.statCard}>
            <div style={s.statVal}>{summary.totalViews}</div>
            <div style={s.statLbl}>👁 {T('views')}</div>
          </div>
          <div style={s.statCard}>
            <div style={s.statVal}>{summary.totalClicks}</div>
            <div style={s.statLbl}>🛒 {T('clicks')}</div>
          </div>
          <div style={s.statCard}>
            <div style={s.statVal}>{summary.totalOrders}</div>
            <div style={s.statLbl}>📦 {T('orders')}</div>
          </div>
          <div style={s.statCard}>
            <div style={{ ...s.statVal, fontSize: 18 }}>${summary.totalSalesAmount.toFixed(2)}</div>
            <div style={s.statLbl}>💰 {T('sales')}</div>
          </div>
        </div>

        {/* 佣金概览 */}
        {summary.totalEstimatedCommission > 0 && (
          <div style={s.commCard}>
            <div style={s.commRow}>
              <span style={{ fontSize: 13, color: '#15803d', fontWeight: 600 }}>💵 {T('commission')}</span>
              <span style={{ fontSize: 20, fontWeight: 800, color: '#15803d' }}>
                ${summary.totalEstimatedCommission.toFixed(2)}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 20 }}>
              <div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>{T('settled')}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#374151' }}>
                  ${summary.totalSettledCommission.toFixed(2)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>{T('unsettled')}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: summary.totalUnsettledCommission > 0 ? '#b45309' : '#9ca3af' }}>
                  ${summary.totalUnsettledCommission.toFixed(2)}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 推广链接明细 */}
        {links.length > 0 && (
          <div>
            <div style={s.sectionH}>{T('links')}</div>
            {links.map((lk) => {
              const isSettled = lk.settlementStatus === 'settled'
              const settledDate = lk.settledAt
                ? new Date(lk.settledAt).toLocaleDateString(lang === 'zh' ? 'zh-CN' : lang === 'en' ? 'en-US' : 'km-KH')
                : ''
              return (
                <div key={lk.code} style={s.card}>
                  <div style={s.row}>
                    <span style={s.code}>/v/{lk.code}</span>
                    <span style={badge(isSettled)}>{isSettled ? T('settledBadge') : T('unsettledBadge')}</span>
                  </div>
                  {lk.videoTitle && (
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>🎬 {lk.videoTitle}</div>
                  )}
                  <div style={s.stat}>
                    👁 {lk.viewCount}　🛒 {lk.clickCount}　📦 {lk.orderCount}
                  </div>
                  <div style={{ ...s.stat, marginTop: 2 }}>
                    💰 {T('salesAmt')} ${lk.salesAmount.toFixed(2)}
                    {lk.estimatedCommission > 0 && (
                      <span style={{ marginLeft: 8 }}>
                        {T('commRule')} {commLabel(lk.commissionType, lk.commissionValue, lang)}　${lk.estimatedCommission.toFixed(2)}
                      </span>
                    )}
                  </div>
                  {isSettled && lk.settledAt && (
                    <div style={{ ...s.stat, marginTop: 3, color: '#15803d' }}>
                      ✓ {T('settledOn')} {settledDate}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {links.length === 0 && (
          <div style={{ textAlign: 'center' as const, fontSize: 13, color: '#9ca3af', padding: '24px 0' }}>
            {T('noLinks')}
          </div>
        )}

        <div style={s.poweredBy}>{T('poweredBy')}</div>
      </div>
    </div>
  )
}
