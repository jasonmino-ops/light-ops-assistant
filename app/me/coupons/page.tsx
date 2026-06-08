'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import CustomerBottomNav from '@/app/components/CustomerBottomNav'

const PRIMARY = '#ff6b00'

type Lang = 'zh' | 'en' | 'km'
type Tab  = 'available' | 'used' | 'expired'

type CouponItem = {
  id: string
  name: string
  type: 'AMOUNT_OFF' | 'PERCENT_OFF'
  amountOff: number | null
  percentOff: number | null
  minSpend: number
  expiresAt: string
  usedAt: string | null
  status: 'AVAILABLE' | 'USED' | 'EXPIRED' | 'CANCELLED'
  storeScope: 'STORE' | 'TENANT'
}

const T: Record<Lang, Record<string, string>> = {
  zh: {
    title: '我的优惠券', back: '返回', available: '可用', used: '已使用', expired: '已过期',
    use: '去使用', empty: '暂无优惠券', loading: '加载中…',
    minSpend: '满', off: '减', validUntil: '有效期至', usedAt: '使用时间',
    needTg: '请在 Telegram 内打开本店点单页查看优惠券', noStore: '缺少门店参数', netErr: '网络错误，请刷新重试',
  },
  en: {
    title: 'My Coupons', back: 'Back', available: 'Available', used: 'Used', expired: 'Expired',
    use: 'Use Now', empty: 'No coupons', loading: 'Loading…',
    minSpend: 'Min', off: 'Off', validUntil: 'Valid until', usedAt: 'Used at',
    needTg: 'Please open from Telegram to view coupons', noStore: 'Missing store code', netErr: 'Network error',
  },
  km: {
    title: 'គូប៉ុងរបស់ខ្ញុំ', back: 'ត្រឡប់', available: 'ប្រើបាន', used: 'បានប្រើ', expired: 'អស់សុពលភាព',
    use: 'ប្រើឥឡូវ', empty: 'គ្មានគូប៉ុង', loading: 'កំពុងផ្ទុក…',
    minSpend: 'អប្បបរមា', off: 'បញ្ចុះ', validUntil: 'សុពលភាពដល់', usedAt: 'ប្រើនៅ',
    needTg: 'សូមបើកពី Telegram', noStore: 'ខ្វះកូដហាង', netErr: 'បញ្ហាបណ្តាញ',
  },
}

const LANG_LABELS: Record<Lang, string> = { zh: '中', en: 'EN', km: 'ខ្មែរ' }

function normalizeLang(value: string | null | undefined): Lang | null {
  const s = (value ?? '').toLowerCase()
  if (!s) return null
  if (s === 'zh' || s.startsWith('zh-') || s.startsWith('zh_')) return 'zh'
  if (s === 'en' || s.startsWith('en-') || s.startsWith('en_')) return 'en'
  if (s === 'km' || s.startsWith('km-') || s.startsWith('kh') || s === 'km_kh') return 'km'
  return null
}

function pickInitialLang(params: URLSearchParams, tgLang?: string | null): Lang {
  const fromUrl = normalizeLang(params.get('lang'))
  if (fromUrl) return fromUrl
  try {
    const saved = normalizeLang(localStorage.getItem('menu_lang'))
    if (saved) return saved
  } catch { /* ignore */ }
  const fromTg = normalizeLang(tgLang)
  if (fromTg) return fromTg
  for (const l of navigator.languages ?? []) {
    const normalized = normalizeLang(l)
    if (normalized) return normalized
  }
  return normalizeLang(navigator.language) ?? 'km'
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString('zh-CN', { year: '2-digit', month: '2-digit', day: '2-digit' }) }
  catch { return iso }
}

export default function MyCouponsPage() {
  const [lang, setLang]       = useState<Lang>('km')
  const [storeCode, setCode]  = useState('')
  const [tgId, setTgId]       = useState('')
  const [tab, setTab]         = useState<Tab>('available')
  const [loading, setLoading] = useState(true)
  const [errMsg, setErrMsg]   = useState('')
  const [data, setData]       = useState<{ available: CouponItem[]; used: CouponItem[]; expired: CouponItem[] } | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code') ?? ''
    setCode(code)

    let tgIdLocal: string | null = null
    let tgLang: string | null = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tg = (window as any).Telegram?.WebApp
    if (tg?.initData) {
      try {
        const userStr = new URLSearchParams(tg.initData).get('user')
        if (userStr) {
          const u = JSON.parse(userStr)
          if (u?.id != null) tgIdLocal = String(u.id)
          tgLang = typeof u?.language_code === 'string' ? u.language_code : null
        }
      } catch { /* ignore */ }
    }
    setLang(pickInitialLang(params, tgLang))
    if (tgIdLocal) setTgId(tgIdLocal)

    if (!code) {
      setErrMsg('NO_STORE'); setLoading(false); return
    }
    if (!tgIdLocal) {
      setErrMsg('NEED_TG'); setLoading(false); return
    }

    fetch(`/api/customer/coupons?code=${encodeURIComponent(code)}&tgId=${encodeURIComponent(tgIdLocal)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((b) => {
        if (b?.error) setErrMsg(b.message ?? b.error)
        else setData({ available: b.available ?? [], used: b.used ?? [], expired: b.expired ?? [] })
      })
      .catch(() => setErrMsg('NET_ERR'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    try { localStorage.setItem('menu_lang', lang) } catch { /* ignore */ }
  }, [lang])

  const ui = T[lang]
  const qs = storeCode ? `?code=${encodeURIComponent(storeCode)}` : ''
  const list = useMemo(() => {
    if (!data) return [] as CouponItem[]
    return data[tab]
  }, [data, tab])

  return (
    <main style={s.page}>
      <div style={s.header}>
        <Link href={`/me${qs}`} style={s.headerBack}>‹ {ui.back}</Link>
        <span style={s.headerTitle}>{ui.title}</span>
        <div style={s.langSwitch}>
          {(['zh', 'en', 'km'] as Lang[]).map((l) => (
            <button key={l} type="button" style={{ ...s.langBtn, ...(lang === l ? s.langBtnOn : {}) }} onClick={() => setLang(l)}>
              {LANG_LABELS[l]}
            </button>
          ))}
        </div>
      </div>

      <div style={s.body}>
        <div style={s.tabs}>
          {(['available', 'used', 'expired'] as Tab[]).map((k) => (
            <button
              key={k}
              type="button"
              style={{ ...s.tab, ...(tab === k ? s.tabActive : {}) }}
              onClick={() => setTab(k)}
            >
              {ui[k]}
              {data && <span style={s.tabCount}>{data[k].length}</span>}
            </button>
          ))}
        </div>

        {loading && <div style={s.empty}><div style={s.emptyIcon}>⏳</div><div>{ui.loading}</div></div>}

        {!loading && errMsg === 'NO_STORE' && <div style={s.empty}><div style={s.emptyIcon}>⚠️</div><div>{ui.noStore}</div></div>}
        {!loading && errMsg === 'NEED_TG' && <div style={s.empty}><div style={s.emptyIcon}>📲</div><div>{ui.needTg}</div></div>}
        {!loading && errMsg && !['NO_STORE', 'NEED_TG'].includes(errMsg) && (
          <div style={s.empty}><div style={s.emptyIcon}>❌</div><div>{errMsg === 'NET_ERR' ? ui.netErr : errMsg}</div></div>
        )}

        {!loading && !errMsg && list.length === 0 && (
          <div style={s.empty}><div style={s.emptyIcon}>🎟️</div><div>{ui.empty}</div></div>
        )}

        {!loading && !errMsg && list.length > 0 && (
          <div style={s.list}>
            {list.map((c) => <CouponCard key={c.id} c={c} ui={ui} storeCode={storeCode} canUse={tab === 'available'} />)}
          </div>
        )}
      </div>

      <CustomerBottomNav code={storeCode} lang={lang} />
    </main>
  )
}

function CouponCard({ c, ui, storeCode, canUse }: { c: CouponItem; ui: Record<string, string>; storeCode: string; canUse: boolean }) {
  const valueLabel = c.type === 'AMOUNT_OFF'
    ? <span>$<b style={{ fontSize: 28 }}>{(c.amountOff ?? 0).toFixed(2)}</b></span>
    : <span><b style={{ fontSize: 28 }}>{c.percentOff ?? 0}</b>%</span>
  return (
    <div style={s.card}>
      <div style={s.cardLeft}>
        <div style={s.cardValue}>{valueLabel}</div>
        <div style={s.cardMin}>{ui.minSpend} ${c.minSpend.toFixed(2)}</div>
      </div>
      <div style={s.cardRight}>
        <div style={s.cardName}>{c.name}</div>
        <div style={s.cardMeta}>
          {c.status === 'USED' && c.usedAt
            ? `${ui.usedAt} ${fmtDate(c.usedAt)}`
            : `${ui.validUntil} ${fmtDate(c.expiresAt)}`}
        </div>
        {canUse ? (
          <Link href={`/menu?code=${encodeURIComponent(storeCode)}&couponId=${encodeURIComponent(c.id)}`} style={s.useBtn}>
            {ui.use} ›
          </Link>
        ) : (
          <div style={s.statusTag}>{c.status === 'USED' ? ui.used : ui.expired}</div>
        )}
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100dvh', background: '#f0f0f0', maxWidth: 480, margin: '0 auto', paddingBottom: 80, position: 'relative' as const },
  header: { background: '#fff', padding: '12px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #ebebeb', position: 'sticky' as const, top: 0, zIndex: 20 },
  headerBack: { fontSize: 13, color: '#666', textDecoration: 'none', background: 'none', border: 'none', cursor: 'pointer', padding: 0, minWidth: 70 },
  headerTitle: { fontSize: 15, fontWeight: 700, color: '#1a1a1a' },
  langSwitch: { display: 'flex', background: '#f5f5f5', borderRadius: 12, padding: 2, gap: 1, minWidth: 70 },
  langBtn: { border: 'none', background: 'transparent', color: '#888', fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 10, cursor: 'pointer', lineHeight: 1.4 },
  langBtnOn: { background: '#fff', color: PRIMARY, boxShadow: '0 1px 2px rgba(0,0,0,0.1)' },
  body: { padding: '12px 12px' },

  tabs: { display: 'flex', background: '#fff', borderRadius: 12, padding: 4, marginBottom: 12 },
  tab: { flex: 1, padding: '8px 0', background: 'none', border: 'none', fontSize: 13, fontWeight: 600, color: '#888', cursor: 'pointer', borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4 },
  tabActive: { color: '#fff', background: PRIMARY },
  tabCount: { fontSize: 11, fontWeight: 700, opacity: 0.8 },

  list: { display: 'flex', flexDirection: 'column' as const, gap: 10 },
  card: { display: 'flex', background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' },
  cardLeft: { width: 120, padding: '14px 8px', background: `linear-gradient(135deg, #ff8c00 0%, ${PRIMARY} 100%)`, color: '#fff', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', gap: 4 },
  cardValue: { color: '#fff', fontWeight: 700, fontSize: 14, lineHeight: 1.1 },
  cardMin: { color: 'rgba(255,255,255,0.9)', fontSize: 11, fontWeight: 600 },
  cardRight: { flex: 1, padding: '12px 14px', display: 'flex', flexDirection: 'column' as const, gap: 4 },
  cardName: { fontSize: 14, fontWeight: 700, color: '#1a1a1a' },
  cardMeta: { fontSize: 11, color: '#888', flex: 1 },
  useBtn: { alignSelf: 'flex-end' as const, fontSize: 12, fontWeight: 700, color: '#fff', background: PRIMARY, padding: '6px 12px', borderRadius: 8, textDecoration: 'none' },
  statusTag: { alignSelf: 'flex-end' as const, fontSize: 11, fontWeight: 600, color: '#bbb', background: '#f5f5f5', padding: '4px 10px', borderRadius: 8 },

  empty: { padding: '60px 20px', textAlign: 'center' as const, color: '#bbb', fontSize: 14, background: '#fff', borderRadius: 12 },
  emptyIcon: { fontSize: 48, marginBottom: 12, opacity: 0.4 },
}
