'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

// ─── 品牌色 ───────────────────────────────────────────────────────────────────

const BRAND = '#07c160'

// ─── 类型 ─────────────────────────────────────────────────────────────────────

type MockStore = { code: string; name: string; sub: string; emoji: string; tags?: string[] }
type RecentStore = { code: string; name: string; lastVisitedAt: string }

const FREQUENT: MockStore[] = [
  { code: 'ST8194AE60', name: 'E-Life 超市',   sub: '超市便利', emoji: '🛒' },
  { code: 'ELIFE-CAFE',  name: '轻咖时光',      sub: '咖啡饮品', emoji: '☕' },
  { code: 'ELIFE-FRESH', name: '每日生鲜',      sub: '生鲜蔬果', emoji: '🥬' },
]

const CATEGORIES = [
  { id: '1', name: '美食',  emoji: '🍜' },
  { id: '2', name: '咖啡',  emoji: '☕' },
  { id: '3', name: '超市',  emoji: '🛒' },
  { id: '4', name: '生鲜',  emoji: '🥩' },
  { id: '5', name: '甜品',  emoji: '🍰' },
  { id: '6', name: '更多',  emoji: '···' },
]

const RECOMMENDED: MockStore[] = [
  { code: 'ST8194AE60',  name: 'E-Life 超市旗舰店', sub: '超市 · 便利',  emoji: '🛒', tags: ['自营', '新加坡'] },
  { code: 'ELIFE-FRESH', name: '每日生鲜直供',       sub: '生鲜 · 蔬果',  emoji: '🥬', tags: ['当日达']        },
  { code: 'ELIFE-CAFE',  name: '轻咖时光',           sub: '咖啡 · 饮品',  emoji: '☕', tags: ['热门']          },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ELifePage() {
  const [toast, setToast] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [recentStores, setRecentStores] = useState<RecentStore[]>([])

  // 读取最近访问记录（由 /menu 页在成功加载后写入）
  useEffect(() => {
    try {
      const saved = localStorage.getItem('eLife_recentStores')
      if (saved) {
        const parsed = JSON.parse(saved) as RecentStore[]
        if (Array.isArray(parsed) && parsed.length > 0) setRecentStores(parsed)
      }
    } catch { /* ignore */ }
  }, [])

  // 常去店铺：优先真实访问记录，否则用 mock 兜底
  const frequentDisplay: MockStore[] = recentStores.length > 0
    ? recentStores.map((s) => ({ code: s.code, name: s.name, sub: '', emoji: '🏪' }))
    : FREQUENT

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  return (
    <div style={s.page}>

      {/* ── 1. 顶部头部 ── */}
      <header style={s.header}>
        <div style={s.headerTop}>
          <div style={s.brand}>
            <span style={s.brandLeaf}>🌿</span>
            <div>
              <div style={s.brandName}>E-Life 超生活</div>
              <div style={s.cityRow}>
                <span style={s.cityPin}>📍</span>
                <span style={s.cityText}>新加坡</span>
                <span style={s.cityChevron}>›</span>
              </div>
            </div>
          </div>
          <div style={s.headerActions}>
            <button style={s.iconBtn} aria-label="通知" onClick={() => showToast('暂无新通知')}>
              <BellIcon />
            </button>
            <Link href="/me" style={s.iconBtn} aria-label="会员中心">
              <UserIcon />
            </Link>
          </div>
        </div>

        {/* 搜索栏 */}
        <div style={s.searchWrap}>
          <div style={s.searchBar}>
            <SearchIcon />
            <input
              type="text"
              placeholder="搜索店铺、商品…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={s.searchInput}
            />
          </div>
        </div>
      </header>

      {/* ── 主内容 ── */}
      <div style={s.content}>

        {/* ── 2. 我的常去 ── */}
        <section style={s.section}>
          <div style={s.sectionHead}>
            <span style={s.sectionTitle}>我的常去</span>
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

        {/* ── 3. 精选分类 ── */}
        <section style={s.section}>
          <div style={s.sectionHead}>
            <span style={s.sectionTitle}>精选分类</span>
          </div>
          <div style={s.categoryGrid}>
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                style={s.categoryItem}
                onClick={() => showToast('即将开放，敬请期待')}
              >
                <div style={s.categoryEmoji}>{cat.emoji}</div>
                <div style={s.categoryName}>{cat.name}</div>
              </button>
            ))}
          </div>
        </section>

        {/* ── 4. 为你推荐 ── */}
        <section style={s.section}>
          <div style={s.sectionHead}>
            <span style={s.sectionTitle}>为你推荐</span>
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

      </div>

      {/* ── Toast ── */}
      {toast && <div style={s.toast}>{toast}</div>}

      {/* ── 底部导航 ── */}
      <BottomNav onScan={() => showToast('请使用 Telegram 扫码或扫商户二维码进入店铺')} />
    </div>
  )
}

// ─── 底部导航 ─────────────────────────────────────────────────────────────────

function BottomNav({ onScan }: { onScan: () => void }) {
  const pathname = usePathname()

  const tabs: {
    key: string
    label: string
    icon: React.ComponentType<{ active: boolean }>
    href: string | null
    onClick?: () => void
  }[] = [
    { key: 'home',   label: '首页',    icon: HomeIcon,   href: '/e-life' },
    { key: 'scan',   label: '扫一扫',  icon: ScanIcon,   href: null,           onClick: onScan },
    { key: 'orders', label: '我的订单', icon: OrdersIcon, href: '/menu/orders' },
    { key: 'me',     label: '我的',    icon: MeIcon,     href: '/me' },
  ]

  return (
    <nav style={s.nav}>
      {tabs.map((t) => {
        const active = t.href
          ? pathname === t.href || pathname.startsWith(t.href + '/')
          : false
        const Icon = t.icon
        const inner = (
          <>
            <Icon active={active} />
            <span style={{ ...s.navLabel, color: active ? BRAND : '#8a8a8a' }}>{t.label}</span>
          </>
        )
        if (t.onClick) {
          return (
            <button key={t.key} style={s.navTab} onClick={t.onClick}>
              {inner}
            </button>
          )
        }
        return (
          <Link key={t.key} href={t.href!} style={s.navTab}>
            {inner}
          </Link>
        )
      })}
    </nav>
  )
}

// ─── SVG 图标 ─────────────────────────────────────────────────────────────────

function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 01-3.46 0"/>
    </svg>
  )
}

function UserIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#aaa" strokeWidth="2" strokeLinecap="round">
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
  },

  // ── Header ──
  header: {
    background: `linear-gradient(135deg, ${BRAND} 0%, #05a050 100%)`,
    paddingTop: 'max(16px, env(safe-area-inset-top))',
    paddingLeft: 16,
    paddingRight: 16,
  },
  headerTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    color: '#fff',
  },
  brandLeaf: { fontSize: 28, lineHeight: 1 },
  brandName: { fontSize: 18, fontWeight: 700, color: '#fff', lineHeight: 1.2 },
  cityRow: { display: 'flex', alignItems: 'center', gap: 2, marginTop: 2 },
  cityPin: { fontSize: 11 },
  cityText: { fontSize: 12, color: 'rgba(255,255,255,0.9)' },
  cityChevron: { fontSize: 14, color: 'rgba(255,255,255,0.65)' },
  headerActions: { display: 'flex', gap: 8 },
  iconBtn: {
    background: 'rgba(255,255,255,0.2)',
    border: 'none',
    borderRadius: '50%',
    width: 36,
    height: 36,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    textDecoration: 'none',
    flexShrink: 0,
    cursor: 'pointer',
  },

  // ── 搜索 ──
  searchWrap: { padding: '0 0 14px' },
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

  // ── 内容区 ──
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

  // ── 常去 ──
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
    minWidth: 74,
    textDecoration: 'none',
    padding: '10px 6px',
    borderRadius: 12,
    background: '#f8fafb',
    border: '1px solid #efefef',
    flexShrink: 0,
  },
  frequentEmoji: { fontSize: 28, lineHeight: 1 },
  frequentName: { fontSize: 12, fontWeight: 600, color: '#1a1a1a', textAlign: 'center', lineHeight: 1.3 },
  frequentSub: { fontSize: 10, color: '#8c8c8c', textAlign: 'center' },

  // ── 分类 ──
  categoryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(6, 1fr)',
    gap: 4,
    paddingBottom: 12,
  },
  categoryItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    background: 'transparent',
    border: 'none',
    padding: '6px 0',
    borderRadius: 8,
    cursor: 'pointer',
  },
  categoryEmoji: { fontSize: 24, lineHeight: 1 },
  categoryName: { fontSize: 11, color: '#555', fontWeight: 500, lineHeight: 1 },

  // ── 推荐 ──
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
    width: 52,
    height: 52,
    borderRadius: 12,
    background: '#f0fdf4',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 26,
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

  // ── Toast ──
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

  // ── 底部导航 ──
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
  navLabel: {
    fontSize: 10,
    fontWeight: 600,
  },
}
