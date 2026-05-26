'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const BRAND = '#07c160'

type Lang = 'zh' | 'en' | 'km'
type MockStore = { code: string; name: string; sub: string; emoji: string; tags?: string[] }
type RecentStore = { code: string; name: string; lastVisitedAt: string }

const LANG_LABELS: Record<Lang, string> = { zh: '中文', en: 'English', km: 'ខ្មែរ' }

const FREQUENT: MockStore[] = [
  { code: 'ST8194AE60', name: 'E-Life 超市',  sub: '超市便利', emoji: '🛒' },
  { code: 'ELIFE-CAFE',  name: '轻咖时光',     sub: '咖啡饮品', emoji: '☕' },
  { code: 'ELIFE-FRESH', name: '每日生鲜',     sub: '生鲜蔬果', emoji: '🥬' },
]

const CATEGORIES = [
  { id: '1', name: '美食餐饮', emoji: '🍜' },
  { id: '2', name: '零售超市', emoji: '🛒' },
  { id: '3', name: '咖啡饮品', emoji: '☕' },
  { id: '4', name: '生活服务', emoji: '🛠️' },
  { id: '5', name: '休闲娱乐', emoji: '🎉' },
  { id: '6', name: '医疗健康', emoji: '🏥' },
  { id: '7', name: '汽车服务', emoji: '🚗' },
  { id: '8', name: '亲子教育', emoji: '📚' },
]

const RECOMMENDED: MockStore[] = [
  { code: 'ST8194AE60',  name: 'E-Life 超市旗舰店', sub: '超市 · 便利',  emoji: '🛒', tags: ['自营', '金边'] },
  { code: 'ELIFE-FRESH', name: '每日生鲜直供',       sub: '生鲜 · 蔬果',  emoji: '🥬', tags: ['当日达']      },
  { code: 'ELIFE-CAFE',  name: '轻咖时光',           sub: '咖啡 · 饮品',  emoji: '☕', tags: ['热门']         },
]

const T: Record<Lang, {
  search: string; frequent: string; manage: string; categories: string
  recommend: string; recommendSub: string; member: string; memberSub: string
  memberCta: string; scanHint: string; home: string; scan: string
  orders: string; me: string; langTitle: string; comingSoon: string; noNotif: string
}> = {
  zh: {
    search: '搜索商家、服务、商品...',
    frequent: '我的常去',
    manage: '管理',
    categories: '精选分类',
    recommend: '为你推荐',
    recommendSub: '发现附近好店',
    member: 'E-Life 会员专享',
    memberSub: '优惠券 · 积分 · 商户福利',
    memberCta: '了解 ›',
    scanHint: '扫描门店码、桌台码、优惠券码',
    home: '首页', scan: '扫一扫', orders: '我的订单', me: '我的',
    langTitle: '切换语言',
    comingSoon: '即将开放，敬请期待',
    noNotif: '暂无新通知',
  },
  en: {
    search: 'Search shops, services, products...',
    frequent: 'My Favourites',
    manage: 'Manage',
    categories: 'Categories',
    recommend: 'Recommended',
    recommendSub: 'Discover nearby stores',
    member: 'E-Life Membership',
    memberSub: 'Coupons · Points · Merchant Perks',
    memberCta: 'Learn ›',
    scanHint: 'Scan store code, table code, or coupon code',
    home: 'Home', scan: 'Scan', orders: 'Orders', me: 'Me',
    langTitle: 'Language',
    comingSoon: 'Coming soon',
    noNotif: 'No new notifications',
  },
  km: {
    search: 'ស្វែងរកហាង សេវា ផលិតផល...',
    frequent: 'ហាងចូលចិត្ត',
    manage: 'គ្រប់គ្រង',
    categories: 'ប្រភេទ',
    recommend: 'ណែនាំ',
    recommendSub: 'ស្វែងរកហាងនៅជិត',
    member: 'សមាជិក E-Life',
    memberSub: 'គូប៉ុង · ពិន្ទុ · អត្ថប្រយោជន៍',
    memberCta: 'មើល ›',
    scanHint: 'ស្កេនកូដហាង កូដតុ ឬកូដប័ណ្ណ',
    home: 'ទំព័រដើម', scan: 'ស្កេន', orders: 'កម្មង់', me: 'ខ្ញុំ',
    langTitle: 'ភាសា',
    comingSoon: 'នឹងមានឆាប់ៗ',
    noNotif: 'គ្មានការជូនដំណឹងថ្មី',
  },
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ELifePage() {
  const [toast, setToast]           = useState<string | null>(null)
  const [search, setSearch]         = useState('')
  const [recentStores, setRecentStores] = useState<RecentStore[]>([])
  const [lang, setLang]             = useState<Lang>('zh')
  const [showLang, setShowLang]     = useState(false)

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
    setShowLang(false)
    try { localStorage.setItem('eLife_lang', l) } catch { /* ignore */ }
  }

  const frequentDisplay: MockStore[] = recentStores.length > 0
    ? recentStores.slice(0, 3).map((s) => ({ code: s.code, name: s.name, sub: '', emoji: '🏪' }))
    : FREQUENT

  const t = T[lang]

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  return (
    <div style={s.page}>

      {/* ── Header ── */}
      <header style={s.header}>
        <div style={s.headerTop}>
          <div style={s.brand}>
            <span style={s.brandLeaf}>🌿</span>
            <div>
              <div style={s.brandName}>E-Life 超生活</div>
              <div style={s.brandSub}>你的生活，一触即达</div>
            </div>
          </div>
          <div style={s.headerActions}>
            <button style={s.langPill} onClick={() => setShowLang(true)} aria-label="语言">
              🌐 {LANG_LABELS[lang]}
            </button>
            <button style={s.iconCircle} onClick={() => showToast(t.noNotif)} aria-label="通知">
              <BellIcon />
            </button>
            <Link href="/me" style={s.iconCircle} aria-label="我的">
              <UserIcon />
            </Link>
          </div>
        </div>

        <div style={s.cityRow}>
          <span style={s.cityPin}>📍</span>
          <span style={s.cityText}>金边</span>
          <span style={s.cityChevron}>›</span>
        </div>

        <div style={s.searchWrap}>
          <div style={s.searchBar}>
            <SearchIcon />
            <input
              type="text"
              placeholder={t.search}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={s.searchInput}
            />
          </div>
        </div>
      </header>

      {/* ── 主内容 ── */}
      <div style={s.content}>

        {/* ── 我的常去 ── */}
        <section style={s.section}>
          <div style={s.sectionHead}>
            <span style={s.sectionTitle}>{t.frequent}</span>
            <button style={s.manageBtn} onClick={() => showToast(t.comingSoon)}>
              {t.manage}
            </button>
          </div>
          <div style={s.hScroll}>
            {frequentDisplay.map((st) => (
              <Link
                key={st.code}
                href={`/menu?code=${encodeURIComponent(st.code)}&from=e-life`}
                style={s.frequentCard}
              >
                <div style={s.frequentEmoji}>{st.emoji}</div>
                <div style={s.frequentName}>{st.name}</div>
                {st.sub && <div style={s.frequentSub}>{st.sub}</div>}
              </Link>
            ))}
          </div>
        </section>

        {/* ── 精选分类 ── */}
        <section style={s.section}>
          <div style={s.sectionHead}>
            <span style={s.sectionTitle}>{t.categories}</span>
          </div>
          <div style={s.categoryGrid}>
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                style={s.categoryItem}
                onClick={() => showToast(t.comingSoon)}
              >
                <div style={s.categoryCircle}>{cat.emoji}</div>
                <div style={s.categoryName}>{cat.name}</div>
              </button>
            ))}
          </div>
        </section>

        {/* ── 为你推荐 ── */}
        <section style={s.section}>
          <div style={s.sectionHead}>
            <div>
              <span style={s.sectionTitle}>{t.recommend}</span>
              <span style={s.sectionSub}>&ensp;{t.recommendSub}</span>
            </div>
          </div>
          <div style={s.recList}>
            {RECOMMENDED.map((st) => (
              <Link
                key={st.code}
                href={`/menu?code=${encodeURIComponent(st.code)}&from=e-life`}
                style={s.recCard}
              >
                <div style={s.recAvatar}>{st.emoji}</div>
                <div style={s.recBody}>
                  <div style={s.recName}>{st.name}</div>
                  <div style={s.recSub}>{st.sub}</div>
                  {st.tags && (
                    <div style={s.recTags}>
                      {st.tags.map((tag) => (
                        <span key={tag} style={s.recTag}>{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
                <span style={s.recChevron}>›</span>
              </Link>
            ))}
          </div>
        </section>

        {/* ── 会员横幅 ── */}
        <div style={s.memberBanner}>
          <div style={s.memberLeft}>
            <span style={s.memberIcon}>👑</span>
            <div>
              <div style={s.memberTitle}>{t.member}</div>
              <div style={s.memberSub2}>{t.memberSub}</div>
            </div>
          </div>
          <button style={s.memberBtn} onClick={() => showToast(t.comingSoon)}>
            {t.memberCta}
          </button>
        </div>

        <div style={{ height: 80 }} />
      </div>

      {/* ── 语言底部弹层 ── */}
      {showLang && (
        <div style={s.overlay} onClick={() => setShowLang(false)}>
          <div style={s.sheet} onClick={(e) => e.stopPropagation()}>
            <div style={s.sheetTitle}>{t.langTitle}</div>
            {(['zh', 'en', 'km'] as Lang[]).map((l) => (
              <button key={l} style={s.sheetRow} onClick={() => changeLang(l)}>
                <span style={s.sheetRowLabel}>{LANG_LABELS[l]}</span>
                {lang === l && <span style={{ color: BRAND, fontWeight: 700 }}>✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && <div style={s.toast}>{toast}</div>}

      {/* ── 底部导航 ── */}
      <BottomNav onScan={() => showToast(t.scanHint)} lang={lang} />
    </div>
  )
}

// ─── 底部导航 ─────────────────────────────────────────────────────────────────

function BottomNav({ onScan, lang }: { onScan: () => void; lang: Lang }) {
  const pathname = usePathname()
  const t = T[lang]

  const tabs: {
    key: string
    label: string
    icon: React.ComponentType<{ active: boolean }>
    href: string | null
    onClick?: () => void
  }[] = [
    { key: 'home',   label: t.home,   icon: HomeIcon,   href: '/e-life' },
    { key: 'scan',   label: t.scan,   icon: ScanIcon,   href: null, onClick: onScan },
    { key: 'orders', label: t.orders, icon: OrdersIcon, href: '/menu/orders' },
    { key: 'me',     label: t.me,     icon: MeIcon,     href: '/me' },
  ]

  return (
    <nav style={s.nav}>
      {tabs.map((tab) => {
        const active = tab.href
          ? pathname === tab.href || pathname.startsWith(tab.href + '/')
          : false
        const Icon = tab.icon
        const inner = (
          <>
            <Icon active={active} />
            <span style={{ ...s.navLabel, color: active ? BRAND : '#8a8a8a' }}>{tab.label}</span>
          </>
        )
        if (tab.onClick) {
          return <button key={tab.key} style={s.navTab} onClick={tab.onClick}>{inner}</button>
        }
        return <Link key={tab.key} href={tab.href!} style={s.navTab}>{inner}</Link>
      })}
    </nav>
  )
}

// ─── SVG Icons ────────────────────────────────────────────────────────────────

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 01-3.46 0"/>
    </svg>
  )
}

function UserIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#aaa" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="8"/>
      <path d="M21 21l-4.35-4.35"/>
    </svg>
  )
}

function HomeIcon({ active }: { active: boolean }) {
  const c = active ? BRAND : '#8a8a8a'
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  )
}

function ScanIcon({ active }: { active: boolean }) {
  const c = active ? BRAND : '#8a8a8a'
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1"/>
      <rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/>
      <path d="M14 14h3v3M17 17v4M17 21h4M21 14v4"/>
    </svg>
  )
}

function OrdersIcon({ active }: { active: boolean }) {
  const c = active ? BRAND : '#8a8a8a'
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4"/>
      <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
    </svg>
  )
}

function MeIcon({ active }: { active: boolean }) {
  const c = active ? BRAND : '#8a8a8a'
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100dvh',
    background: '#f6f7fb',
    display: 'flex',
    flexDirection: 'column',
    overflowX: 'hidden',
  },

  // ── Header
  header: {
    background: `linear-gradient(135deg, ${BRAND} 0%, #05a050 100%)`,
    paddingTop: 'max(16px, env(safe-area-inset-top))',
    paddingLeft: 16,
    paddingRight: 16,
  },
  headerTop: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  brand: { display: 'flex', alignItems: 'center', gap: 8, color: '#fff' },
  brandLeaf: { fontSize: 28, lineHeight: 1 },
  brandName: { fontSize: 18, fontWeight: 700, color: '#fff', lineHeight: 1.2 },
  brandSub: { fontSize: 11, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  headerActions: { display: 'flex', gap: 6, alignItems: 'center' },

  langPill: {
    background: 'rgba(255,255,255,0.2)',
    border: 'none',
    borderRadius: 16,
    height: 32,
    padding: '0 10px',
    color: '#fff',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 3,
    flexShrink: 0,
    whiteSpace: 'nowrap',
  },
  iconCircle: {
    background: 'rgba(255,255,255,0.2)',
    border: 'none',
    borderRadius: '50%',
    width: 32,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    textDecoration: 'none',
    flexShrink: 0,
    cursor: 'pointer',
  },

  cityRow: { display: 'flex', alignItems: 'center', gap: 2, marginBottom: 10 },
  cityPin: { fontSize: 12 },
  cityText: { fontSize: 12, color: 'rgba(255,255,255,0.9)', fontWeight: 500 },
  cityChevron: { fontSize: 14, color: 'rgba(255,255,255,0.6)' },

  // ── 搜索
  searchWrap: { paddingBottom: 14 },
  searchBar: {
    background: '#fff',
    borderRadius: 22,
    height: 40,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '0 14px',
  },
  searchInput: {
    flex: 1,
    border: 'none',
    outline: 'none',
    background: 'transparent',
    color: '#333',
    fontSize: 14,
  },

  // ── 内容
  content: { flex: 1 },

  section: {
    background: '#fff',
    marginBottom: 8,
    padding: '16px 16px 4px',
  },
  sectionHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 16, fontWeight: 700, color: '#1a1a1a' },
  sectionSub: { fontSize: 12, color: '#8c8c8c' },

  manageBtn: {
    background: 'transparent',
    border: 'none',
    color: '#8c8c8c',
    fontSize: 13,
    cursor: 'pointer',
    padding: '2px 0',
  },

  // ── 常去
  hScroll: {
    display: 'flex',
    gap: 10,
    overflowX: 'auto',
    paddingBottom: 12,
  },
  frequentCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    minWidth: 76,
    textDecoration: 'none',
    padding: '10px 8px',
    borderRadius: 12,
    background: '#f8fafb',
    border: '1px solid #efefef',
    flexShrink: 0,
  },
  frequentEmoji: { fontSize: 28, lineHeight: 1 },
  frequentName: { fontSize: 12, fontWeight: 600, color: '#1a1a1a', textAlign: 'center', lineHeight: 1.3 },
  frequentSub: { fontSize: 10, color: '#8c8c8c', textAlign: 'center' },

  // ── 精选分类（4×2）
  categoryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 8,
    paddingBottom: 12,
  },
  categoryItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    background: 'transparent',
    border: 'none',
    padding: '6px 0',
    borderRadius: 8,
    cursor: 'pointer',
  },
  categoryCircle: {
    width: 50,
    height: 50,
    borderRadius: '50%',
    background: '#f0fdf4',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 22,
  },
  categoryName: { fontSize: 11, color: '#444', fontWeight: 500, lineHeight: 1.2, textAlign: 'center' },

  // ── 推荐
  recList: { display: 'flex', flexDirection: 'column' },
  recCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '14px 0',
    borderBottom: '1px solid #f5f5f5',
    textDecoration: 'none',
    color: 'inherit',
  },
  recAvatar: {
    width: 56,
    height: 56,
    borderRadius: 12,
    background: '#f0fdf4',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 28,
    flexShrink: 0,
  },
  recBody: { flex: 1, minWidth: 0 },
  recName: { fontSize: 15, fontWeight: 600, color: '#1a1a1a', lineHeight: 1.3 },
  recSub: { fontSize: 12, color: '#8c8c8c', marginTop: 2 },
  recTags: { display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap' },
  recTag: {
    fontSize: 10,
    fontWeight: 600,
    color: BRAND,
    background: '#f0fdf4',
    border: `1px solid ${BRAND}55`,
    borderRadius: 4,
    padding: '1px 6px',
  },
  recChevron: { fontSize: 18, color: '#ccc', flexShrink: 0 },

  // ── 会员横幅
  memberBanner: {
    background: `linear-gradient(135deg, #07c160 0%, #05a050 100%)`,
    margin: '0 0 8px',
    padding: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  memberLeft: { display: 'flex', alignItems: 'center', gap: 10 },
  memberIcon: { fontSize: 28, lineHeight: 1 },
  memberTitle: { fontSize: 15, fontWeight: 700, color: '#fff' },
  memberSub2: { fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  memberBtn: {
    background: '#fff',
    border: 'none',
    borderRadius: 16,
    padding: '7px 14px',
    fontSize: 13,
    fontWeight: 600,
    color: BRAND,
    cursor: 'pointer',
    flexShrink: 0,
  },

  // ── 语言弹层
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.42)',
    zIndex: 300,
    display: 'flex',
    alignItems: 'flex-end',
  },
  sheet: {
    background: '#fff',
    borderRadius: '16px 16px 0 0',
    width: '100%',
    padding: '20px 16px',
    paddingBottom: 'max(20px, env(safe-area-inset-bottom))',
  },
  sheetTitle: { fontSize: 15, fontWeight: 700, color: '#1a1a1a', marginBottom: 12 },
  sheetRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    padding: '13px 0',
    background: 'transparent',
    border: 'none',
    borderBottom: '1px solid #f5f5f5',
    cursor: 'pointer',
  },
  sheetRowLabel: { fontSize: 15, color: '#1a1a1a' },

  // ── Toast
  toast: {
    position: 'fixed',
    bottom: 'calc(60px + env(safe-area-inset-bottom, 0px) + 16px)',
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(0,0,0,0.72)',
    color: '#fff',
    fontSize: 13,
    padding: '9px 18px',
    borderRadius: 20,
    whiteSpace: 'nowrap',
    zIndex: 200,
    pointerEvents: 'none',
  },

  // ── 底部导航
  nav: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    background: '#fff',
    borderTop: '1px solid #ebebeb',
    display: 'flex',
    paddingBottom: 'env(safe-area-inset-bottom)',
    zIndex: 50,
    height: 56,
  },
  navTab: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    background: 'transparent',
    border: 'none',
    textDecoration: 'none',
    cursor: 'pointer',
    padding: 0,
    color: 'inherit',
  },
  navLabel: { fontSize: 10, fontWeight: 600 },
}
