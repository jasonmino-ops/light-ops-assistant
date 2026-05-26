'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'

const BRAND = '#07c160'

type Lang = 'zh' | 'en' | 'km'
type RecentStore = { code: string; name: string; lastVisitedAt: string }
type ShopDisplay = { code: string; name: string; subtitle: string; image: string }

// ─── Translations ─────────────────────────────────────────────────────────────

const T = {
  zh: {
    brandSub: '超生活', slogan: '你的生活，一触即达', city: '金边', langLabel: '中文',
    searchPlaceholder: '搜索商家、服务、商品...',
    frequentShops: '我的常去', manage: '管理',
    categories: '精选分类',
    recommend: '为你推荐', recommendSub: '发现附近好店', more: '更多',
    memberTitle: 'E-Life 会员专享', memberSub: '优惠券 · 积分 · 商户福利', memberBtn: '立即开通',
    navHome: '首页', navScan: '扫一扫', navOrders: '我的订单', navProfile: '我的',
    langTitle: '选择语言 / Language',
    scanTitle: '扫码点单', scanDesc: '扫描门店码、桌台码或优惠券码',
    scanStore: '门店码', scanStoreDesc: '扫码进入商户主页',
    scanTable: '桌台码', scanTableDesc: '扫码在店内点单',
    scanCoupon: '优惠券码', scanCouponDesc: '扫码领取优惠',
    scanBtn: '打开扫码',
  },
  en: {
    brandSub: 'Super Life', slogan: 'Your Life, One Touch Away', city: 'Phnom Penh', langLabel: 'EN',
    searchPlaceholder: 'Search shops, services, products...',
    frequentShops: 'My Favorites', manage: 'Manage',
    categories: 'Categories',
    recommend: 'For You', recommendSub: 'Discover nearby shops', more: 'More',
    memberTitle: 'E-Life Membership', memberSub: 'Coupons · Points · Rewards', memberBtn: 'Join Now',
    navHome: 'Home', navScan: 'Scan', navOrders: 'My Orders', navProfile: 'Me',
    langTitle: 'Language',
    scanTitle: 'Scan to Order', scanDesc: 'Scan store code, table code or coupon code',
    scanStore: 'Store Code', scanStoreDesc: 'Scan to enter store page',
    scanTable: 'Table Code', scanTableDesc: 'Scan to order at table',
    scanCoupon: 'Coupon Code', scanCouponDesc: 'Scan to claim coupon',
    scanBtn: 'Open Scanner',
  },
  km: {
    brandSub: 'ជីវិតល្អ', slogan: 'ជីវិតរបស់អ្នក មួយប៉ះ', city: 'ភ្នំពេញ', langLabel: 'ខ្មែរ',
    searchPlaceholder: 'ស្វែងរកហាង សេវាកម្ម ផលិតផល...',
    frequentShops: 'កន្លែងញឹកញាប់', manage: 'គ្រប់គ្រង',
    categories: 'ប្រភេទ',
    recommend: 'សម្រាប់អ្នក', recommendSub: 'រកឃើញហាងល្អ', more: 'បន្ថែម',
    memberTitle: 'សមាជិក E-Life', memberSub: 'គូប៉ុង · ពិន្ទុ · រង្វាន់', memberBtn: 'ចូលរួម',
    navHome: 'ទំព័រដើម', navScan: 'ស្កេន', navOrders: 'ការបញ្ជាទិញ', navProfile: 'ខ្ញុំ',
    langTitle: 'ភាសា',
    scanTitle: 'ស្កេនបញ្ជាទិញ', scanDesc: 'ស្កេនកូដហាង កូដតុ ឬកូដគូប៉ុង',
    scanStore: 'កូដហាង', scanStoreDesc: 'ស្កេនដើម្បីចូលហាង',
    scanTable: 'កូដតុ', scanTableDesc: 'ស្កេនដើម្បីបញ្ជាទិញ',
    scanCoupon: 'កូដគូប៉ុង', scanCouponDesc: 'ស្កេនដើម្បីទទួលគូប៉ុង',
    scanBtn: 'បើកស្កេន',
  },
}

type TLocale = typeof T[Lang]

const LANG_OPTIONS: { code: Lang; label: string; sub: string }[] = [
  { code: 'zh', label: '中文', sub: 'Chinese' },
  { code: 'en', label: 'English', sub: 'English' },
  { code: 'km', label: 'ខ្មែរ', sub: 'Khmer' },
]

// ─── Static mock data ──────────────────────────────────────────────────────────

const FREQUENT_MOCK: ShopDisplay[] = [
  {
    code: 'luckin-chaoyangmen',
    name: '瑞幸咖啡',
    subtitle: '朝阳门店',
    image: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=200&h=200&fit=crop',
  },
  {
    code: 'hema-wangjing',
    name: '盒马鲜生',
    subtitle: '望京店',
    image: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=200&h=200&fit=crop',
  },
  {
    code: 'starbucks-sanlitun',
    name: '星巴克',
    subtitle: '三里屯店',
    image: 'https://images.unsplash.com/photo-1453614512568-c4024d13c247?w=200&h=200&fit=crop',
  },
]

const CATEGORIES: {
  id: number
  names: Record<Lang, string>
  icon: string
  color: string
  bg: string
}[] = [
  { id: 1, names: { zh: '美食餐饮', en: 'Food',      km: 'អាហារ'    }, icon: 'utensils',    color: 'rgba(249,115,22,0.7)',  bg: 'rgba(255,247,237,0.8)' },
  { id: 2, names: { zh: '零售超市', en: 'Grocery',   km: 'គ្រឿងទេស' }, icon: 'shopping-bag', color: 'rgba(16,185,129,0.7)',  bg: 'rgba(236,253,245,0.8)' },
  { id: 3, names: { zh: '咖啡饮品', en: 'Coffee',    km: 'កាហ្វេ'   }, icon: 'coffee',       color: 'rgba(245,158,11,0.7)',  bg: 'rgba(255,251,235,0.8)' },
  { id: 4, names: { zh: '生活服务', en: 'Services',  km: 'សេវាកម្ម' }, icon: 'wrench',       color: 'rgba(59,130,246,0.7)',  bg: 'rgba(239,246,255,0.8)' },
  { id: 5, names: { zh: '休闲娱乐', en: 'Leisure',   km: 'កម្សាន្ត' }, icon: 'gamepad',      color: 'rgba(236,72,153,0.7)',  bg: 'rgba(253,242,248,0.8)' },
  { id: 6, names: { zh: '医疗健康', en: 'Health',    km: 'សុខភាព'   }, icon: 'heart',        color: 'rgba(248,113,113,0.7)', bg: 'rgba(254,242,242,0.8)' },
  { id: 7, names: { zh: '汽车服务', en: 'Auto',      km: 'រថយន្ត'   }, icon: 'car',          color: 'rgba(100,116,139,0.7)', bg: 'rgba(248,250,252,0.8)' },
  { id: 8, names: { zh: '亲子教育', en: 'Education', km: 'អប់រំ'    }, icon: 'graduation',   color: 'rgba(99,102,241,0.7)',  bg: 'rgba(238,242,255,0.8)' },
]

// 无封面图时的备用渐变色板（按索引循环）
const CARD_GRADIENTS = [
  'linear-gradient(135deg, #34d399 0%, #059669 100%)',
  'linear-gradient(135deg, #60a5fa 0%, #2563eb 100%)',
  'linear-gradient(135deg, #f9a8d4 0%, #db2777 100%)',
]

const RECOMMENDED_MOCK = [
  {
    code: 'dintaifung-main',
    name: '鼎泰丰',
    category: '台式料理',
    image: 'https://images.unsplash.com/photo-1496116218417-1a781b1c416c?w=400&h=300&fit=crop',
    rating: 4.9,
    distance: '1.2km',
    tags: ['小笼包', '必吃榜'],
  },
  {
    code: 'heytea-flagship',
    name: '喜茶',
    category: '新茶饮',
    image: 'https://images.unsplash.com/photo-1558857563-b371033873b8?w=400&h=300&fit=crop',
    rating: 4.8,
    distance: '0.8km',
    tags: ['人气爆款', '新品'],
  },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ELifeHomePage() {
  const router = useRouter()
  const [lang, setLang]                 = useState<Lang>('zh')
  const [showLangPanel, setShowLangPanel] = useState(false)
  const [showScanPanel, setShowScanPanel] = useState(false)
  const [search, setSearch]             = useState('')
  const [recentStores, setRecentStores] = useState<RecentStore[]>([])

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
  }, [])

  function changeLang(l: Lang) {
    setLang(l)
    setShowLangPanel(false)
    try { localStorage.setItem('eLife_lang', l) } catch { /* ignore */ }
  }

  const t = T[lang]

  // 常去：优先真实访问记录，不足 3 个时用 FREQUENT_MOCK 补满
  const recentAsDisplay: ShopDisplay[] = recentStores.slice(0, 3).map(s => ({
    code: s.code, name: s.name, subtitle: '', image: '',
  }))
  const shopsToShow: ShopDisplay[] = recentStores.length === 0
    ? FREQUENT_MOCK
    : [
        ...recentAsDisplay,
        ...FREQUENT_MOCK.filter(m => !recentAsDisplay.some(r => r.code === m.code)),
      ].slice(0, 3)

  function navTo(path: string) { router.push(path) }

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
              <button style={s.iconBtn} onClick={() => navTo('/me')}>
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
          <div style={s.overlay} onClick={() => setShowScanPanel(false)} />
          <div style={s.sheet}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 600, color: '#1a1a1a', margin: 0 }}>{t.scanTitle}</h3>
                <p style={{ fontSize: 11, color: '#8c8c8c', margin: '2px 0 0' }}>{t.scanDesc}</p>
              </div>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6 }} onClick={() => setShowScanPanel(false)}>
                <XIcon />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              {([
                { icon: 'store',  label: t.scanStore,  desc: t.scanStoreDesc,  color: '#10b981', bg: '#ecfdf5' },
                { icon: 'grid',   label: t.scanTable,  desc: t.scanTableDesc,  color: '#3b82f6', bg: '#eff6ff' },
                { icon: 'ticket', label: t.scanCoupon, desc: t.scanCouponDesc, color: '#f59e0b', bg: '#fffbeb' },
              ] as const).map((item, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, background: 'rgba(0,0,0,0.03)', cursor: 'pointer' }}>
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
            <button style={{ width: '100%', padding: '12px 0', background: BRAND, color: '#fff', border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <ScanLineIcon color="#fff" />
              {t.scanBtn}
            </button>
          </div>
        </>
      )}

      {/* ── Main ── */}
      <main style={s.main}>

        {/* § My Frequent Shops */}
        <section>
          <div style={s.secHead}>
            <h2 style={s.secTitle}>{t.frequentShops}</h2>
            <button style={s.moreBtn}>
              {t.manage} <ChevronRightIcon />
            </button>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            {shopsToShow.map((shop, idx) => (
              <div
                key={idx}
                style={{ flex: 1, cursor: 'pointer' }}
                onClick={() => navTo(`/menu?code=${encodeURIComponent(shop.code)}&from=e-life`)}
              >
                {/* 固定宽高比容器，所有子层用 absolute inset:0 铺满 */}
                <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', marginBottom: 6, aspectRatio: '1/1', border: '1px solid rgba(0,0,0,0.08)' }}>
                  {/* 底层：图片 or 品牌渐变 */}
                  {shop.image ? (
                    <img
                      src={shop.image}
                      alt={shop.name}
                      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  ) : (
                    <div style={{ position: 'absolute', inset: 0, background: CARD_GRADIENTS[idx % CARD_GRADIENTS.length], display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontSize: 40, color: 'rgba(255,255,255,0.92)', fontWeight: 700, lineHeight: 1, userSelect: 'none' }}>
                        {shop.name.charAt(0)}
                      </span>
                    </div>
                  )}
                  {/* 暗角渐变：图片和渐变背景均叠加 */}
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.52) 0%, rgba(0,0,0,0.1) 50%, transparent 100%)' }} />
                  {/* 店名文字 */}
                  <div style={{ position: 'absolute', bottom: 8, left: 8, right: 8 }}>
                    <p style={{ fontSize: 11, color: '#fff', fontWeight: 600, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>{shop.name}</p>
                    {shop.subtitle && <p style={{ fontSize: 9, color: 'rgba(255,255,255,0.85)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shop.subtitle}</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* § Categories */}
        <section>
          <h2 style={{ ...s.secTitle, marginBottom: 8 }}>{t.categories}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', rowGap: 8 }}>
            {CATEGORIES.map(cat => (
              <button key={cat.id} style={s.catBtn}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: cat.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <CatIcon type={cat.icon} color={cat.color} />
                </div>
                <span style={{ fontSize: 10, color: 'rgba(26,26,26,0.65)', fontWeight: 500 }}>{cat.names[lang]}</span>
              </button>
            ))}
          </div>
        </section>

        {/* § Recommended */}
        <section>
          <div style={s.secHead}>
            <div>
              <h2 style={s.secTitle}>{t.recommend}</h2>
              <p style={{ fontSize: 10, color: 'rgba(140,140,140,0.6)', margin: '2px 0 0' }}>{t.recommendSub}</p>
            </div>
            <button style={s.moreBtn}>{t.more} <ChevronRightIcon /></button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {RECOMMENDED_MOCK.map((shop, idx) => (
              <div
                key={idx}
                style={{ display: 'flex', gap: 10, padding: 10, background: '#fff', borderRadius: 12, border: '1px solid rgba(0,0,0,0.06)', cursor: 'pointer' }}
                onClick={() => navTo(`/menu?code=${encodeURIComponent(shop.code)}&from=e-life`)}
              >
                <div style={{ width: 72, height: 72, borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
                  <img src={shop.image} alt={shop.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0, padding: '2px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                    <h3 style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shop.name}</h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                      <StarIcon />
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#1a1a1a' }}>{shop.rating}</span>
                    </div>
                  </div>
                  <p style={{ fontSize: 11, color: 'rgba(140,140,140,0.7)', margin: '0 0 8px' }}>{shop.category} · {shop.distance}</p>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {shop.tags.map((tag, i) => (
                      <span key={i} style={{ fontSize: 9, color: `rgba(7,193,96,0.6)`, background: `rgba(7,193,96,0.05)`, padding: '2px 6px', borderRadius: 4, fontWeight: 500 }}>{tag}</span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* § Member Banner */}
        <section>
          <div style={s.memberBanner}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: `rgba(7,193,96,0.1)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CrownIcon />
              </div>
              <div>
                <h3 style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a', margin: 0 }}>{t.memberTitle}</h3>
                <p style={{ fontSize: 9, color: 'rgba(140,140,140,0.7)', margin: 0 }}>{t.memberSub}</p>
              </div>
            </div>
            <button style={s.memberBtn}>{t.memberBtn}</button>
          </div>
        </section>

      </main>

      {/* ── Bottom Nav ── */}
      <BottomNav onScan={() => setShowScanPanel(true)} t={t} />
    </div>
  )
}

// ─── Bottom Nav ───────────────────────────────────────────────────────────────

function BottomNav({ onScan, t }: { onScan: () => void; t: TLocale }) {
  const pathname = usePathname()

  const tabs = [
    { id: 'home',    label: t.navHome,    href: '/e-life',      Icon: HomeIcon,    onClick: undefined as (() => void) | undefined },
    { id: 'scan',    label: t.navScan,    href: null,           Icon: ScanLineIcon, onClick: onScan },
    { id: 'orders',  label: t.navOrders,  href: '/menu/orders', Icon: ClipboardIcon, onClick: undefined as (() => void) | undefined },
    { id: 'profile', label: t.navProfile, href: '/me',          Icon: UserSmIcon,  onClick: undefined as (() => void) | undefined },
  ]

  return (
    <nav style={s.nav}>
      <div style={s.navInner}>
        {tabs.map(tab => {
          const active = tab.href
            ? pathname === tab.href || pathname.startsWith(tab.href + '/')
            : false
          const color = active ? BRAND : 'rgba(140,140,140,0.6)'
          const inner = (
            <>
              <tab.Icon color={color} strokeWidth={active ? 2 : 1.5} />
              <span style={{ fontSize: 10, color, fontWeight: active ? 600 : 500 }}>{tab.label}</span>
            </>
          )
          if (tab.onClick) {
            return (
              <button key={tab.id} style={s.navTab} onClick={tab.onClick}>{inner}</button>
            )
          }
          return (
            <Link key={tab.id} href={tab.href!} style={s.navTab}>{inner}</Link>
          )
        })}
      </div>
      <div style={{ height: 'env(safe-area-inset-bottom)' }} />
    </nav>
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

function StarIcon({ size = 12 }: IP) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#fbbf24" stroke="#fbbf24" strokeWidth="1">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
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

function HomeIcon({ size = 18, color = '#8c8c8c', strokeWidth = 1.5 }: IP) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
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

function ClipboardIcon({ size = 18, color = '#8c8c8c', strokeWidth = 1.5 }: IP) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/>
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
      <line x1="12" y1="11" x2="16" y2="11"/><line x1="12" y1="16" x2="16" y2="16"/>
      <line x1="8" y1="11" x2="8.01" y2="11"/><line x1="8" y1="16" x2="8.01" y2="16"/>
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
  brandSubText: { color: 'rgba(26,26,26,0.8)' },
  slogan: { fontSize: 10, color: `rgba(7,193,96,0.4)`, margin: '2px 0 0', fontWeight: 500 },
  headerRight: { display: 'flex', alignItems: 'center' },
  textBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    fontSize: 11,
    color: '#8c8c8c',
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
  secTitle: { fontSize: 15, fontWeight: 600, color: '#1a1a1a', margin: 0 },
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
    padding: '4px 10px',
    background: 'linear-gradient(to right, rgba(251,191,36,0.85), rgba(245,158,11,0.85))',
    color: '#fff',
    border: 'none',
    borderRadius: 9999,
    fontSize: 10,
    fontWeight: 500,
    cursor: 'pointer',
    flexShrink: 0,
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

  // ── Nav
  nav: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    background: 'rgba(255,255,255,0.95)',
    backdropFilter: 'blur(16px)',
    borderTop: '1px solid rgba(0,0,0,0.06)',
    zIndex: 50,
  },
  navInner: {
    maxWidth: 448,
    margin: '0 auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-around',
    padding: '4px 16px',
  },
  navTab: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    padding: '6px 20px',
    background: 'transparent',
    border: 'none',
    borderRadius: 12,
    cursor: 'pointer',
    textDecoration: 'none',
    color: 'inherit',
  },
}
