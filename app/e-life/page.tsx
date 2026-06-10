'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import ELifeBottomNav from './components/ELifeBottomNav'

const BRAND = '#07c160'

type Lang = 'zh' | 'en' | 'km'
type RecentStore = { code: string; name: string; lastVisitedAt: string; imageUrl?: string | null }
type ShopDisplay = { code: string; name: string; subtitle: string; image: string }
type FeaturedStore = { code: string; name: string; businessType: string; imageUrl: string | null }

// ─── Translations ─────────────────────────────────────────────────────────────

const T = {
  zh: {
    brandSub: '超生活', slogan: '你的生活，一触即达', city: '金边', langLabel: '中文',
    searchPlaceholder: '搜索商家、服务、商品...',
    frequentShops: '我的常去', manage: '管理',
    categories: '精选分类',
    recommend: '为你推荐', recommendSub: '发现附近好店', more: '更多',
    memberTitle: 'E-Life 会员专享', memberSub: '优惠券 · 积分 · 商户福利', memberBtn: '立即开通',
    navHome: '首页', navCategory: '分类', navOrders: '我的订单', navProfile: '我的',
    langTitle: '选择语言 / Language',
    scanTitle: '扫码点单', scanDesc: '扫描门店码、桌台码或优惠券码',
    scanStore: '门店码', scanStoreDesc: '扫码进入商户主页',
    scanTable: '桌台码', scanTableDesc: '扫码在店内点单',
    scanCoupon: '优惠券码', scanCouponDesc: '扫码领取优惠',
    scanBtn: '打开扫码',
    addFav: '添加常去', discoverShops: '发现好店', toastComingSoon: '更多商户即将上线，敬请期待',
    toastVisitFirst: '请先访问一家商户', toastRecommendSoon: '更多推荐即将开放',
    viewAll: '查看全部', recommended: '推荐商户',
    scanEnter: '输入门店码', scanPlaceholder: 'ST8194AE60 或粘贴链接', scanGo: '进入店铺', scanInvalid: '无法识别门店码',
    addFrequent: '加入常去', addedFrequent: '已加入', removeFrequent: '移除',
    manageFrequentTitle: '常去商户管理', noFrequent: '还没有常去商户', noMoreRecommendations: '暂无更多推荐商户',
    close: '关闭',
  },
  en: {
    brandSub: 'Super Life', slogan: 'Your Life, One Touch Away', city: 'Phnom Penh', langLabel: 'EN',
    searchPlaceholder: 'Search shops, services, products...',
    frequentShops: 'My Favorites', manage: 'Manage',
    categories: 'Categories',
    recommend: 'For You', recommendSub: 'Discover nearby shops', more: 'More',
    memberTitle: 'E-Life Membership', memberSub: 'Coupons · Points · Rewards', memberBtn: 'Join Now',
    navHome: 'Home', navCategory: 'Category', navOrders: 'My Orders', navProfile: 'Me',
    langTitle: 'Language',
    scanTitle: 'Scan to Order', scanDesc: 'Scan store code, table code or coupon code',
    scanStore: 'Store Code', scanStoreDesc: 'Scan to enter store page',
    scanTable: 'Table Code', scanTableDesc: 'Scan to order at table',
    scanCoupon: 'Coupon Code', scanCouponDesc: 'Scan to claim coupon',
    scanBtn: 'Open Scanner',
    addFav: 'Add Favorite', discoverShops: 'Discover', toastComingSoon: 'More shops coming soon',
    toastVisitFirst: 'Please visit a store first', toastRecommendSoon: 'More recommendations coming soon',
    viewAll: 'View All', recommended: 'Recommended',
    scanEnter: 'Enter Store Code', scanPlaceholder: 'ST8194AE60 or paste link', scanGo: 'Enter Store', scanInvalid: 'Invalid store code',
    addFrequent: 'Add favorite', addedFrequent: 'Added', removeFrequent: 'Remove',
    manageFrequentTitle: 'Manage favorites', noFrequent: 'No favorite stores yet', noMoreRecommendations: 'No more recommended stores',
    close: 'Close',
  },
  km: {
    brandSub: 'ជីវិតល្អ', slogan: 'ជីវិតរបស់អ្នក មួយប៉ះ', city: 'ភ្នំពេញ', langLabel: 'ខ្មែរ',
    searchPlaceholder: 'ស្វែងរកហាង សេវាកម្ម ផលិតផល...',
    frequentShops: 'កន្លែងញឹកញាប់', manage: 'គ្រប់គ្រង',
    categories: 'ប្រភេទ',
    recommend: 'សម្រាប់អ្នក', recommendSub: 'រកឃើញហាងល្អ', more: 'បន្ថែម',
    memberTitle: 'សមាជិក E-Life', memberSub: 'គូប៉ុង · ពិន្ទុ · រង្វាន់', memberBtn: 'ចូលរួម',
    navHome: 'ទំព័រដើម', navCategory: 'ប្រភេទ', navOrders: 'ការបញ្ជាទិញ', navProfile: 'ខ្ញុំ',
    langTitle: 'ភាសា',
    scanTitle: 'ស្កេនបញ្ជាទិញ', scanDesc: 'ស្កេនកូដហាង កូដតុ ឬកូដគូប៉ុង',
    scanStore: 'កូដហាង', scanStoreDesc: 'ស្កេនដើម្បីចូលហាង',
    scanTable: 'កូដតុ', scanTableDesc: 'ស្កេនដើម្បីបញ្ជាទិញ',
    scanCoupon: 'កូដគូប៉ុង', scanCouponDesc: 'ស្កេនដើម្បីទទួលគូប៉ុង',
    scanBtn: 'បើកស្កេន',
    addFav: 'បន្ថែម', discoverShops: 'រកឃើញ', toastComingSoon: 'ហាងបន្ថែមនឹងមកដល់',
    toastVisitFirst: 'សូមចូលទស្សនាហាងមុន', toastRecommendSoon: 'ការណែនាំបន្ថែមនឹងមកដល់',
    viewAll: 'មើលទាំងអស់', recommended: 'ណែនាំ',
    scanEnter: 'បញ្ចូលកូដហាង', scanPlaceholder: 'ST8194AE60 ឬបិទភ្ជាប់', scanGo: 'ចូលហាង', scanInvalid: 'មិនអាចសម្គាល់កូដហាង',
    addFrequent: 'បន្ថែម', addedFrequent: 'បានបន្ថែម', removeFrequent: 'ដកចេញ',
    manageFrequentTitle: 'គ្រប់គ្រងហាងញឹកញាប់', noFrequent: 'មិនទាន់មានហាងញឹកញាប់', noMoreRecommendations: 'មិនមានហាងណែនាំបន្ថែម',
    close: 'បិទ',
  },
}

const LANG_OPTIONS: { code: Lang; label: string; sub: string }[] = [
  { code: 'zh', label: '中文', sub: 'Chinese' },
  { code: 'en', label: 'English', sub: 'English' },
  { code: 'km', label: 'ខ្មែរ', sub: 'Khmer' },
]

const CATEGORIES: {
  id: number
  type: string
  names: Record<Lang, string>
  icon: string
  color: string
  bg: string
}[] = [
  { id: 1, type: 'food',          names: { zh: '美食餐饮', en: 'Food',      km: 'អាហារ'    }, icon: 'utensils',    color: 'rgba(249,115,22,0.7)',  bg: 'rgba(255,247,237,0.8)' },
  { id: 2, type: 'retail',        names: { zh: '零售超市', en: 'Grocery',   km: 'គ្រឿងទេស' }, icon: 'shopping-bag', color: 'rgba(16,185,129,0.7)',  bg: 'rgba(236,253,245,0.8)' },
  { id: 3, type: 'cafe',          names: { zh: '咖啡饮品', en: 'Coffee',    km: 'កាហ្វេ'   }, icon: 'coffee',       color: 'rgba(245,158,11,0.7)',  bg: 'rgba(255,251,235,0.8)' },
  { id: 4, type: 'service',       names: { zh: '生活服务', en: 'Services',  km: 'សេវាកម្ម' }, icon: 'wrench',       color: 'rgba(59,130,246,0.7)',  bg: 'rgba(239,246,255,0.8)' },
  { id: 5, type: 'entertainment', names: { zh: '休闲娱乐', en: 'Leisure',   km: 'កម្សាន្ត' }, icon: 'gamepad',      color: 'rgba(236,72,153,0.7)',  bg: 'rgba(253,242,248,0.8)' },
  { id: 6, type: 'health',        names: { zh: '医疗健康', en: 'Health',    km: 'សុខភាព'   }, icon: 'heart',        color: 'rgba(248,113,113,0.7)', bg: 'rgba(254,242,242,0.8)' },
  { id: 7, type: 'auto',          names: { zh: '汽车服务', en: 'Auto',      km: 'រថយន្ត'   }, icon: 'car',          color: 'rgba(100,116,139,0.7)', bg: 'rgba(248,250,252,0.8)' },
  { id: 8, type: 'kids',          names: { zh: '亲子教育', en: 'Education', km: 'អប់រំ'    }, icon: 'graduation',   color: 'rgba(99,102,241,0.7)',  bg: 'rgba(238,242,255,0.8)' },
]

// 无封面图时按索引循环使用的备用真实照片（Unsplash，按 idx 循环）
const FALLBACK_IMAGES = [
  'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=200&h=200&fit=crop',
  'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=200&h=200&fit=crop',
  'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=200&h=200&fit=crop',
]

const BIZ_LABEL: Record<string, Record<Lang, string>> = {
  FOOD:    { zh: '美食餐饮', en: 'Food & Drink', km: 'អាហារ' },
  RETAIL:  { zh: '零售购物', en: 'Retail',       km: 'ហាងលក់' },
  SERVICE: { zh: '生活服务', en: 'Services',      km: 'សេវាកម្ម' },
  GENERAL: { zh: '综合商户', en: 'General',       km: 'ទូទៅ' },
}


// ─── Helpers ──────────────────────────────────────────────────────────────────

// 从扫码内容或手动输入中提取 storeCode（ST 开头字母数字串）
function extractStoreCode(raw: string): string | null {
  const s = raw.trim()
  // 直接门店码：ST + 4~16位字母数字
  if (/^ST[A-Za-z0-9]{4,16}$/.test(s)) return s
  // URL 参数：?code=STxxxx 或 &code=STxxxx
  const codeMatch = s.match(/[?&]code=(ST[A-Za-z0-9]{4,16})/)
  if (codeMatch) return codeMatch[1]
  // startapp=STxxxx 或 startapp_STxxxx
  const startMatch = s.match(/startapp[=_](ST[A-Za-z0-9]{4,16})/)
  if (startMatch) return startMatch[1]
  return null
}

function readTelegramInitData(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).Telegram?.WebApp?.initData ?? ''
}

function saveRecentStores(stores: RecentStore[]) {
  try { localStorage.setItem('eLife_recentStores', JSON.stringify(stores.slice(0, 6))) } catch { /* ignore */ }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ELifeHomePage() {
  const router = useRouter()
  const [lang, setLang]                 = useState<Lang>('zh')
  const [showLangPanel, setShowLangPanel] = useState(false)
  const [showScanPanel, setShowScanPanel] = useState(false)
  const [showManualInput, setShowManualInput] = useState(false)
  const [manualCode, setManualCode]           = useState('')
  const [toast, setToast]               = useState<string | null>(null)
  const [search, setSearch]             = useState('')
  const [recentStores, setRecentStores]     = useState<RecentStore[]>([])
  const [featuredStores, setFeaturedStores] = useState<FeaturedStore[] | null>(null)
  const [showFrequentManager, setShowFrequentManager] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem('eLife_recentStores')
      if (saved) {
        const parsed = JSON.parse(saved) as RecentStore[]
        if (Array.isArray(parsed) && parsed.length > 0) setRecentStores(parsed)
      }
      const savedLang = localStorage.getItem('eLife_lang') as Lang | null
      if (savedLang && (['zh', 'en', 'km'] as string[]).includes(savedLang)) setLang(savedLang)
    } catch { /* ignore */ }

    // 为你推荐：从后端拉取真实商户（无 auth，公开接口）
    fetch('/api/e-life/featured-stores')
      .then((r) => r.json())
      .then((body) => {
        if (Array.isArray(body.stores)) {
          setFeaturedStores(
            body.stores.map((s: { storeCode: string; storeName: string; businessType: string; bannerUrl: string | null }) => ({
              code: s.storeCode, name: s.storeName, businessType: s.businessType, imageUrl: s.bannerUrl,
            }))
          )
        }
      })
      .catch(() => { /* 静默失败，保持 mock fallback */ })

    // 有 Telegram initData 时从后端读取真实最近访问（覆盖 localStorage）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tg = (window as any).Telegram?.WebApp
    if (tg?.initData) {
      fetch('/api/e-life/recent-stores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData: tg.initData }),
      })
        .then((r) => r.json())
        .then((body) => {
          if (body.ok && Array.isArray(body.stores) && body.stores.length > 0) {
            setRecentStores(
              body.stores.map((s: { storeCode: string; storeName: string; lastSeenAt: string; bannerUrl?: string | null }) => ({
                code: s.storeCode, name: s.storeName, lastVisitedAt: s.lastSeenAt, imageUrl: s.bannerUrl ?? null,
              }))
            )
            saveRecentStores(
              body.stores.map((s: { storeCode: string; storeName: string; lastSeenAt: string; bannerUrl?: string | null }) => ({
                code: s.storeCode, name: s.storeName, lastVisitedAt: s.lastSeenAt, imageUrl: s.bannerUrl ?? null,
              }))
            )
          }
        })
        .catch(() => { /* 静默失败，localStorage 结果保持 */ })
    }
  }, [])

  function changeLang(l: Lang) {
    setLang(l)
    setShowLangPanel(false)
    try { localStorage.setItem('eLife_lang', l) } catch { /* ignore */ }
  }

  const t = T[lang]

  type DisplayCard = { type: 'store'; shop: ShopDisplay } | { type: 'add' } | { type: 'discover' }
  const displayCards: DisplayCard[] = (() => {
    const stores: DisplayCard[] = recentStores.slice(0, 6).map(s => ({
      type: 'store' as const, shop: { code: s.code, name: s.name, subtitle: '', image: s.imageUrl ?? '' },
    }))
    return [...stores, { type: 'add' }]
  })()

  const lastCode = recentStores[0]?.code ?? ''

  function navTo(path: string) { router.push(path) }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2200)
  }

  function closeScanPanel() {
    setShowScanPanel(false)
    setShowManualInput(false)
    setManualCode('')
  }

  function handleScanResult(raw: string) {
    const code = extractStoreCode(raw)
    if (code) {
      closeScanPanel()
      navTo(`/menu?code=${encodeURIComponent(code)}&from=scan`)
    } else {
      showToast(t.scanInvalid)
    }
  }

  function handleScanBtn() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tg = (window as any).Telegram?.WebApp
    if (typeof tg?.showScanQrPopup === 'function') {
      tg.showScanQrPopup({ text: t.scanDesc }, (text: string) => {
        tg.closeScanQrPopup?.()
        handleScanResult(text)
        return true
      })
    } else {
      setShowManualInput(true)
    }
  }

  function isFrequent(code: string) {
    return recentStores.some((store) => store.code === code)
  }

  function removeFrequent(code: string) {
    const next = recentStores.filter((store) => store.code !== code)
    setRecentStores(next)
    saveRecentStores(next)
    const initData = readTelegramInitData()
    if (initData) {
      fetch('/api/e-life/recent-stores', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, storeCode: code }),
      }).catch(() => { /* local state already updated */ })
    }
  }

  function addFrequent(shop: { code: string; name: string; imageUrl?: string | null }) {
    if (isFrequent(shop.code)) return
    const next = [
      { code: shop.code, name: shop.name, lastVisitedAt: new Date().toISOString(), imageUrl: shop.imageUrl ?? null },
      ...recentStores,
    ].slice(0, 6)
    setRecentStores(next)
    saveRecentStores(next)
    const initData = readTelegramInitData()
    if (initData) {
      fetch('/api/e-life/recent-stores', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, storeCode: shop.code }),
      }).catch(() => { /* local state already updated */ })
    }
  }

  const recommendedStores = featuredStores ?? []
  const storesToAdd = recommendedStores.filter((shop) => !isFrequent(shop.code))

  return (
    <div style={s.page}>

      {/* ── Header ── */}
      <header style={s.header}>
        <div style={s.headerInner}>
          {/* Brand row */}
          <div style={s.brandRow}>
            <div>
              <h1 style={s.brandH1}>
                <span style={{ color: BRAND }}>E-Life</span>
                <span style={s.brandSubText}> {t.brandSub}</span>
              </h1>
              <p style={s.slogan}>{t.slogan}</p>
            </div>
            <div style={s.headerRight}>
              <button style={s.textBtn}>
                <MapPinIcon />
                <span>{t.city}</span>
              </button>
              <button style={s.textBtn} onClick={() => setShowLangPanel(true)}>
                <GlobeIcon />
                <span>{t.langLabel}</span>
              </button>
              <button style={s.iconBtn}>
                <BellIcon />
                <span style={s.bellDot} />
              </button>
              <button style={s.iconBtn} onClick={() => navTo('/e-life/me')}>
                <UserSmIcon />
              </button>
            </div>
          </div>

          {/* Search */}
          <div style={s.searchBar}>
            <SearchIcon />
            <input
              type="text"
              placeholder={t.searchPlaceholder}
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={s.searchInput}
            />
          </div>
        </div>
      </header>

      {/* ── Language Panel ── */}
      {showLangPanel && (
        <>
          <div style={s.overlay} onClick={() => setShowLangPanel(false)} />
          <div style={s.sheet}>
            <h3 style={s.sheetTitle}>{t.langTitle}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {LANG_OPTIONS.map(item => (
                <button
                  key={item.code}
                  style={{ ...s.langOpt, ...(lang === item.code ? s.langOptActive : {}) }}
                  onClick={() => changeLang(item.code)}
                >
                  <div style={{ textAlign: 'left' }}>
                    <p style={{ ...s.langOptLabel, ...(lang === item.code ? { color: BRAND } : {}) }}>{item.label}</p>
                    <p style={s.langOptSub}>{item.sub}</p>
                  </div>
                  {lang === item.code && <CheckIcon />}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── Scan Panel ── */}
      {showScanPanel && (
        <>
          <div style={s.overlay} onClick={closeScanPanel} />
          <div style={s.sheet}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 600, color: '#1a1a1a', margin: 0 }}>{t.scanTitle}</h3>
                <p style={{ fontSize: 11, color: '#8c8c8c', margin: '2px 0 0' }}>{t.scanDesc}</p>
              </div>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6 }} onClick={closeScanPanel}>
                <XIcon />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              {([
                { icon: 'store',  label: t.scanStore,  desc: t.scanStoreDesc,  color: '#10b981', bg: '#ecfdf5' },
                { icon: 'grid',   label: t.scanTable,  desc: t.scanTableDesc,  color: '#3b82f6', bg: '#eff6ff' },
                { icon: 'ticket', label: t.scanCoupon, desc: t.scanCouponDesc, color: '#f59e0b', bg: '#fffbeb' },
              ] as const).map((item, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, background: 'rgba(0,0,0,0.03)' }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: item.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {item.icon === 'store'  && <StoreIcon  color={item.color} />}
                    {item.icon === 'grid'   && <Grid3Icon  color={item.color} />}
                    {item.icon === 'ticket' && <TicketIcon color={item.color} />}
                  </div>
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 500, color: '#1a1a1a', margin: 0 }}>{item.label}</p>
                    <p style={{ fontSize: 11, color: '#8c8c8c', margin: 0 }}>{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <button
              style={{ width: '100%', padding: '12px 0', background: BRAND, color: '#fff', border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              onClick={handleScanBtn}
            >
              <ScanLineIcon color="#fff" />
              {t.scanBtn}
            </button>
            {showManualInput && (
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p style={{ fontSize: 12, color: '#8c8c8c', margin: 0 }}>{t.scanEnter}</p>
                <input
                  type="text"
                  placeholder={t.scanPlaceholder}
                  value={manualCode}
                  onChange={e => setManualCode(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleScanResult(manualCode) }}
                  autoFocus
                  style={{ width: '100%', padding: '10px 12px', fontSize: 14, border: '1px solid rgba(0,0,0,0.15)', borderRadius: 10, outline: 'none', boxSizing: 'border-box' }}
                />
                <button
                  onClick={() => handleScanResult(manualCode)}
                  style={{ width: '100%', padding: '11px 0', background: BRAND, color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                >
                  {t.scanGo}
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Main ── */}
      <main style={s.main}>

        {/* § My Frequent Shops */}
        <section>
          <div style={{ ...s.secHead, marginBottom: 10 }}>
            <h2 style={s.secTitle}>{t.frequentShops}</h2>
            <button style={s.moreBtn} onClick={() => setShowFrequentManager(true)}>
              {t.manage} <ChevronRightIcon />
            </button>
          </div>
          {/* 横向滚动，负 margin 撑破容器边距以实现全宽视觉 */}
          <div style={{ margin: '0 -22px', overflowX: 'auto', scrollbarWidth: 'none' }}>
            <div style={{ display: 'flex', gap: 10, paddingLeft: 22, paddingRight: 22, paddingBottom: 4 }}>
              {displayCards.map((card, idx) => {
                if (card.type === 'store') {
                  const shop = card.shop
                  return (
                    <div key={idx} style={{ minWidth: 110, flexShrink: 0, cursor: 'pointer' }} onClick={() => navTo(`/menu?code=${encodeURIComponent(shop.code)}&from=e-life`)}>
                      <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', aspectRatio: '1/1', border: '1px solid rgba(0,0,0,0.08)' }}>
                        <img src={shop.image || FALLBACK_IMAGES[idx % FALLBACK_IMAGES.length]} alt={shop.name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.74) 0%, rgba(0,0,0,0.22) 55%, transparent 100%)' }} />
                        <button
                          style={s.removeBtn}
                          onClick={(e) => { e.stopPropagation(); removeFrequent(shop.code) }}
                        >
                          {t.removeFrequent}
                        </button>
                        <div style={{ position: 'absolute', bottom: 8, left: 8, right: 8 }}>
                          <p style={{ fontSize: 14, color: '#fff', fontWeight: 700, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textShadow: '0 1px 5px rgba(0,0,0,0.8)' }}>{shop.name}</p>
                        </div>
                      </div>
                    </div>
                  )
                }
                if (card.type === 'add') {
                  return (
                    <div key={idx} style={{ minWidth: 110, flexShrink: 0, cursor: 'pointer' }} onClick={() => setShowFrequentManager(true)}>
                      <div style={s.addFrequentCard}>
                        <div style={s.addFrequentIcon}>
                          <PlusIcon size={22} />
                        </div>
                        <span style={{ fontSize: 12, color: BRAND, fontWeight: 500 }}>{t.addFav}</span>
                      </div>
                    </div>
                  )
                }
                return (
                  <div key={idx} style={{ minWidth: 110, flexShrink: 0, cursor: 'pointer' }} onClick={() => showToast(t.toastComingSoon)}>
                    <div style={{ aspectRatio: '1/1', borderRadius: 14, background: 'linear-gradient(135deg, #f0fdf4, #ecfdf5)', border: '1px solid rgba(7,193,96,0.12)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(7,193,96,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <CompassIcon />
                      </div>
                      <span style={{ fontSize: 12, color: BRAND, fontWeight: 500 }}>{t.discoverShops}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* § Categories */}
        <section>
          <h2 style={{ ...s.secTitle, marginBottom: 8 }}>{t.categories}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', rowGap: 8 }}>
            {CATEGORIES.map(cat => (
              <button key={cat.id} style={s.catBtn} onClick={() => navTo(`/e-life/category?type=${cat.type}`)}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: cat.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <CatIcon type={cat.icon} color={cat.color} />
                </div>
                <span style={{ fontSize: 14, color: '#1f2937', fontWeight: 500 }}>{cat.names[lang]}</span>
              </button>
            ))}
          </div>
        </section>

        {/* § Member Banner */}
        <section>
          <div style={{ ...s.memberBanner, cursor: 'pointer' }} onClick={() => navTo('/e-life/membership')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: `rgba(7,193,96,0.1)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CrownIcon />
              </div>
              <div>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: '#111827', margin: 0 }}>{t.memberTitle}</h3>
                <p style={{ fontSize: 11, color: '#9ca3af', margin: 0 }}>{t.memberSub}</p>
              </div>
            </div>
            <button style={s.memberBtn} onClick={e => { e.stopPropagation(); navTo('/e-life/membership') }}>{t.memberBtn}</button>
          </div>
        </section>

        {/* § Recommended — only rendered when OPS has set at least 1 featured store */}
        {featuredStores !== null && featuredStores.length > 0 && (
          <section>
            <div style={s.secHead}>
              <div>
                <h2 style={s.secTitle}>{t.recommend}</h2>
                <p style={{ fontSize: 12, color: '#9ca3af', margin: '2px 0 0' }}>{t.recommendSub}</p>
              </div>
              <button style={s.moreBtn} onClick={() => showToast(t.toastRecommendSoon)}>
                {t.viewAll} <ChevronRightIcon />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {featuredStores.slice(0, 2).map((shop, idx) => (
                <div
                  key={shop.code}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: '#fff', borderRadius: 14, border: '1px solid rgba(0,0,0,0.06)', cursor: 'pointer', minHeight: 88 }}
                  onClick={() => navTo(`/menu?code=${encodeURIComponent(shop.code)}&from=e-life`)}
                >
                  <div style={{ width: 80, height: 80, borderRadius: 10, overflow: 'hidden', flexShrink: 0 }}>
                    <img
                      src={shop.imageUrl ?? FALLBACK_IMAGES[idx % FALLBACK_IMAGES.length]}
                      alt={shop.name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 700, color: '#111827', margin: '0 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shop.name}</h3>
                    <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 6px' }}>{BIZ_LABEL[shop.businessType]?.[lang] ?? shop.businessType}</p>
                    <span style={{ display: 'inline-block', fontSize: 11, color: BRAND, background: 'rgba(7,193,96,0.08)', padding: '2px 8px', borderRadius: 4, fontWeight: 500 }}>{t.recommended}</span>
                    <button
                      style={{ ...s.addBtn, ...(isFrequent(shop.code) ? s.addBtnDone : {}) }}
                      onClick={(e) => {
                        e.stopPropagation()
                        addFrequent({ code: shop.code, name: shop.name, imageUrl: shop.imageUrl })
                      }}
                      disabled={isFrequent(shop.code)}
                    >
                      {isFrequent(shop.code) ? t.addedFrequent : t.addFrequent}
                    </button>
                  </div>
                  <ChevronRightIcon size={14} color="rgba(0,0,0,0.2)" />
                </div>
              ))}
            </div>
          </section>
        )}

      </main>

      {/* ── Frequent Store Manager ── */}
      {showFrequentManager && (
        <>
          <div style={s.overlay} onClick={() => setShowFrequentManager(false)} />
          <div style={s.managerSheet}>
            <div style={s.managerHeader}>
              <h3 style={s.managerTitle}>{t.manageFrequentTitle}</h3>
              <button style={s.managerCloseBtn} onClick={() => setShowFrequentManager(false)}>{t.close}</button>
            </div>

            <div style={s.managerSection}>
              <h4 style={s.managerSectionTitle}>{t.frequentShops}</h4>
              {recentStores.length === 0 ? (
                <p style={s.emptyText}>{t.noFrequent}</p>
              ) : (
                <div style={s.managerList}>
                  {recentStores.map((store, idx) => (
                    <div
                      key={store.code}
                      style={s.managerRow}
                      onClick={() => navTo(`/menu?code=${encodeURIComponent(store.code)}&from=e-life`)}
                    >
                      <img
                        src={store.imageUrl ?? FALLBACK_IMAGES[idx % FALLBACK_IMAGES.length]}
                        alt={store.name}
                        style={s.managerThumb}
                      />
                      <div style={s.managerRowText}>
                        <p style={s.managerStoreName}>{store.name}</p>
                      </div>
                      <button
                        style={s.managerRemoveBtn}
                        onClick={(e) => { e.stopPropagation(); removeFrequent(store.code) }}
                      >
                        {t.removeFrequent}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={s.managerSection}>
              <h4 style={s.managerSectionTitle}>{t.recommended}</h4>
              {recommendedStores.length === 0 ? (
                <p style={s.emptyText}>{t.noMoreRecommendations}</p>
              ) : (
                <>
                  <div style={s.managerList}>
                    {recommendedStores.map((shop, idx) => {
                      const added = isFrequent(shop.code)
                      return (
                        <div
                          key={shop.code}
                          style={s.managerRow}
                          onClick={() => navTo(`/menu?code=${encodeURIComponent(shop.code)}&from=e-life`)}
                        >
                          <img
                            src={shop.imageUrl ?? FALLBACK_IMAGES[idx % FALLBACK_IMAGES.length]}
                            alt={shop.name}
                            style={s.managerThumb}
                          />
                          <div style={s.managerRowText}>
                            <p style={s.managerStoreName}>{shop.name}</p>
                            <p style={s.managerStoreSub}>{BIZ_LABEL[shop.businessType]?.[lang] ?? shop.businessType}</p>
                          </div>
                          <button
                            style={{ ...s.managerAddBtn, ...(added ? s.managerAddBtnDone : {}) }}
                            disabled={added}
                            onClick={(e) => {
                              e.stopPropagation()
                              addFrequent({ code: shop.code, name: shop.name, imageUrl: shop.imageUrl })
                            }}
                          >
                            {added ? t.addedFrequent : t.addFrequent}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                  {storesToAdd.length === 0 && <p style={s.emptyText}>{t.noMoreRecommendations}</p>}
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 'calc(64px + env(safe-area-inset-bottom, 0px) + 12px)', left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.72)', color: '#fff', fontSize: 13, padding: '9px 18px', borderRadius: 20, whiteSpace: 'nowrap', zIndex: 200, pointerEvents: 'none' }}>
          {toast}
        </div>
      )}

      {/* ── Bottom Nav ── */}
      <ELifeBottomNav lang={lang} />
    </div>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────

type IP = { size?: number; color?: string; strokeWidth?: number }

function SearchIcon({ size = 14, color = 'rgba(140,140,140,0.5)' }: IP) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
    </svg>
  )
}

function MapPinIcon({ size = 12, color = '#8c8c8c' }: IP) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
    </svg>
  )
}

function GlobeIcon({ size = 12, color = '#8c8c8c' }: IP) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
    </svg>
  )
}

function BellIcon({ size = 16, color = '#8c8c8c' }: IP) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>
    </svg>
  )
}

function UserSmIcon({ size = 16, color = '#8c8c8c', strokeWidth = 2 }: IP) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
    </svg>
  )
}

function CheckIcon({ size = 16, color = BRAND }: IP) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  )
}

function ChevronRightIcon({ size = 12, color = `rgba(7,193,96,0.6)` }: IP) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  )
}


function CrownIcon({ size = 14, color = BRAND }: IP) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m2 4 3 12h14l3-12-6 4-4-7-4 7-6-4z"/><line x1="5" y1="20" x2="19" y2="20"/>
    </svg>
  )
}

function ScanLineIcon({ size = 18, color = '#8c8c8c', strokeWidth = 1.5 }: IP) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7V5a2 2 0 012-2h2"/><path d="M17 3h2a2 2 0 012 2v2"/>
      <path d="M21 17v2a2 2 0 01-2 2h-2"/><path d="M7 21H5a2 2 0 01-2-2v-2"/>
      <line x1="3" y1="12" x2="21" y2="12"/>
    </svg>
  )
}

function XIcon({ size = 16, color = '#8c8c8c' }: IP) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  )
}

function StoreIcon({ size = 16, color = '#10b981' }: IP) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l1-6h16l1 6"/><path d="M3 9h18v11a1 1 0 01-1 1H4a1 1 0 01-1-1z"/>
      <path d="M9 9v11M15 9v11"/>
    </svg>
  )
}

function Grid3Icon({ size = 16, color = '#3b82f6' }: IP) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
      <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
    </svg>
  )
}

function TicketIcon({ size = 16, color = '#f59e0b' }: IP) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 9a3 3 0 000 6v2a2 2 0 002 2h16a2 2 0 002-2v-2a3 3 0 000-6V7a2 2 0 00-2-2H4a2 2 0 00-2 2z"/>
      <line x1="13" y1="5" x2="13" y2="7"/><line x1="13" y1="17" x2="13" y2="19"/><line x1="13" y1="11" x2="13" y2="13"/>
    </svg>
  )
}

function PlusIcon({ size = 16, color = BRAND }: IP) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  )
}

function CompassIcon({ size = 16, color = BRAND }: IP) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>
    </svg>
  )
}

function CatIcon({ type, color }: { type: string; color: string }) {
  const p = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none' as const, stroke: color, strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (type === 'utensils') return <svg {...p}><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 002-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 00-5 5v6c0 1.1.9 2 2 2h3v7"/></svg>
  if (type === 'shopping-bag') return <svg {...p}><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
  if (type === 'coffee') return <svg {...p}><path d="M17 8h1a4 4 0 010 8h-1"/><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4z"/><line x1="6" y1="2" x2="6" y2="4"/><line x1="10" y1="2" x2="10" y2="4"/><line x1="14" y1="2" x2="14" y2="4"/></svg>
  if (type === 'wrench') return <svg {...p}><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>
  if (type === 'gamepad') return <svg {...p}><path d="M17.32 5H6.68a4 4 0 00-3.978 3.59l-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 003 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 019.828 16h4.344a2 2 0 011.414.586L17 18c.5.5 1 1 2 1a3 3 0 003-3c0-1.544-.604-6.584-.685-7.258l-.017-.151A4 4 0 0017.32 5z"/><line x1="6" y1="11" x2="10" y2="11"/><line x1="8" y1="9" x2="8" y2="13"/></svg>
  if (type === 'heart') return <svg {...p}><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
  if (type === 'car') return <svg {...p}><path d="M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v9a2 2 0 01-2 2h-3"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>
  if (type === 'graduation') return <svg {...p}><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
  return null
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100dvh',
    background: '#F7F8FA',
    maxWidth: 448,
    margin: '0 auto',
    position: 'relative',
    overflowX: 'hidden',
    paddingBottom: 80,
  },

  // ── Header
  header: {
    position: 'sticky',
    top: 0,
    zIndex: 50,
    background: 'linear-gradient(to bottom, #EEFBF3, #ffffff)',
  },
  headerInner: { padding: '12px 20px 10px' },
  brandRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  brandH1: {
    fontSize: 18,
    fontWeight: 700,
    margin: 0,
    lineHeight: 1.2,
    letterSpacing: '-0.02em',
  },
  brandSubText: { color: '#1a1a1a', fontWeight: 600 },
  slogan: { fontSize: 11, color: `rgba(7,193,96,0.65)`, margin: '2px 0 0', fontWeight: 500 },
  headerRight: { display: 'flex', alignItems: 'center' },
  textBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    fontSize: 12,
    color: '#555',
    background: 'transparent',
    border: 'none',
    borderRadius: 9999,
    padding: '6px 8px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  iconBtn: {
    position: 'relative',
    padding: 6,
    background: 'transparent',
    border: 'none',
    borderRadius: 9999,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 6,
    height: 6,
    background: '#ef4444',
    borderRadius: '50%',
  },
  searchBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: '#fff',
    borderRadius: 9999,
    height: 36,
    padding: '0 12px',
    border: '1px solid rgba(0,0,0,0.1)',
    boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
  },
  searchInput: {
    flex: 1,
    border: 'none',
    outline: 'none',
    background: 'transparent',
    fontSize: 14,
    color: '#333',
  },

  // ── Main
  main: {
    padding: '12px 22px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  secHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  secTitle: { fontSize: 17, fontWeight: 700, color: '#111827', margin: 0 },
  moreBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    fontSize: 11,
    color: `rgba(7,193,96,0.6)`,
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontWeight: 500,
    padding: 0,
  },

  // ── Categories
  catBtn: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: '4px 0',
  },

  // ── Member Banner
  memberBanner: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 12,
    background: 'linear-gradient(to right, #F5FAF7, #FFFBF2, #F5FAF7)',
    padding: 12,
    border: `1px solid rgba(7,193,96,0.08)`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  memberBtn: {
    padding: '6px 14px',
    background: 'linear-gradient(to right, rgba(251,191,36,0.9), rgba(245,158,11,0.9))',
    color: '#fff',
    border: 'none',
    borderRadius: 9999,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    flexShrink: 0,
  },
  removeBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 2,
    border: 'none',
    borderRadius: 999,
    background: 'rgba(0,0,0,0.58)',
    color: '#fff',
    fontSize: 11,
    fontWeight: 700,
    padding: '4px 8px',
    cursor: 'pointer',
  },
  addBtn: {
    display: 'block',
    marginTop: 8,
    border: `1px solid rgba(7,193,96,0.25)`,
    borderRadius: 999,
    background: '#fff',
    color: BRAND,
    fontSize: 11,
    fontWeight: 700,
    padding: '4px 10px',
    cursor: 'pointer',
  },
  addBtnDone: {
    color: '#9ca3af',
    borderColor: 'rgba(0,0,0,0.08)',
    background: '#f9fafb',
    cursor: 'default',
  },
  addFrequentCard: {
    aspectRatio: '1/1',
    borderRadius: 14,
    border: '1.5px dashed rgba(7,193,96,0.48)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    background: 'rgba(7,193,96,0.05)',
    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.7)',
  },
  addFrequentIcon: {
    width: 38,
    height: 38,
    borderRadius: '50%',
    background: 'rgba(7,193,96,0.14)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Panels
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.2)',
    zIndex: 100,
  },
  sheet: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    background: '#fff',
    borderRadius: '16px 16px 0 0',
    zIndex: 101,
    padding: 20,
    paddingBottom: 'max(20px, env(safe-area-inset-bottom))',
  },
  sheetTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: '#1a1a1a',
    textAlign: 'center',
    margin: '0 0 16px',
  },
  langOpt: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    padding: 12,
    borderRadius: 12,
    background: 'rgba(0,0,0,0.03)',
    border: '1px solid transparent',
    cursor: 'pointer',
  },
  langOptActive: {
    background: `rgba(7,193,96,0.05)`,
    border: `1px solid rgba(7,193,96,0.2)`,
  },
  langOptLabel: { fontSize: 14, fontWeight: 500, color: '#1a1a1a', margin: 0 },
  langOptSub: { fontSize: 11, color: '#8c8c8c', margin: '1px 0 0' },
  managerSheet: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: '82dvh',
    overflowY: 'auto',
    background: '#fff',
    borderRadius: '18px 18px 0 0',
    zIndex: 101,
    padding: 18,
    paddingBottom: 'max(22px, env(safe-area-inset-bottom))',
    boxShadow: '0 -12px 30px rgba(0,0,0,0.14)',
  },
  managerHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
  },
  managerTitle: {
    fontSize: 17,
    fontWeight: 800,
    color: '#111827',
    margin: 0,
  },
  managerCloseBtn: {
    border: 'none',
    borderRadius: 999,
    background: '#f3f4f6',
    color: '#4b5563',
    fontSize: 12,
    fontWeight: 700,
    padding: '7px 12px',
    cursor: 'pointer',
  },
  managerSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    marginTop: 12,
  },
  managerSectionTitle: {
    fontSize: 14,
    fontWeight: 800,
    color: '#111827',
    margin: 0,
  },
  managerList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  managerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 14,
    border: '1px solid rgba(0,0,0,0.06)',
    background: '#fff',
    cursor: 'pointer',
    minHeight: 66,
  },
  managerThumb: {
    width: 46,
    height: 46,
    borderRadius: 10,
    objectFit: 'cover',
    flexShrink: 0,
    background: '#f3f4f6',
  },
  managerRowText: {
    flex: 1,
    minWidth: 0,
  },
  managerStoreName: {
    fontSize: 14,
    fontWeight: 800,
    color: '#111827',
    margin: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  managerStoreSub: {
    fontSize: 11,
    color: '#6b7280',
    margin: '3px 0 0',
  },
  managerRemoveBtn: {
    border: 'none',
    borderRadius: 999,
    background: '#fee2e2',
    color: '#b91c1c',
    fontSize: 12,
    fontWeight: 800,
    padding: '7px 12px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  managerAddBtn: {
    border: `1px solid rgba(7,193,96,0.22)`,
    borderRadius: 999,
    background: 'rgba(7,193,96,0.08)',
    color: BRAND,
    fontSize: 12,
    fontWeight: 800,
    padding: '7px 12px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  managerAddBtnDone: {
    borderColor: 'rgba(0,0,0,0.08)',
    background: '#f3f4f6',
    color: '#9ca3af',
    cursor: 'default',
  },
  emptyText: {
    margin: 0,
    padding: '12px 10px',
    borderRadius: 12,
    background: '#f9fafb',
    color: '#6b7280',
    fontSize: 13,
  },

}
