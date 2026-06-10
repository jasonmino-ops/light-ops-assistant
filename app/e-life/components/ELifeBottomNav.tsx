'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { CSSProperties, ReactElement } from 'react'

const BRAND = '#07c160'

type Lang = 'zh' | 'en' | 'km'
type TabId = 'home' | 'category' | 'orders' | 'me'

const LABELS: Record<Lang, Record<TabId, string>> = {
  zh: { home: '首页', category: '分类', orders: '订单', me: '我的' },
  en: { home: 'Home', category: 'Category', orders: 'Orders', me: 'Me' },
  km: { home: 'ទំព័រដើម', category: 'ប្រភេទ', orders: 'ការបញ្ជាទិញ', me: 'ខ្ញុំ' },
}

const TABS: Array<{ id: TabId; href: string; Icon: (props: IconProps) => ReactElement }> = [
  { id: 'home', href: '/e-life', Icon: HomeIcon },
  { id: 'category', href: '/e-life/category', Icon: CategoryIcon },
  { id: 'orders', href: '/e-life/orders', Icon: ClipboardIcon },
  { id: 'me', href: '/e-life/me', Icon: UserIcon },
]

type IconProps = { color: string; strokeWidth: number }

export default function ELifeBottomNav({ lang }: { lang: Lang }) {
  const pathname = usePathname()
  const labels = LABELS[lang] ?? LABELS.zh

  return (
    <nav style={s.nav} aria-label="E-Life customer bottom navigation">
      <div style={s.navInner}>
        {TABS.map((tab) => {
          const active = tab.href === '/e-life'
            ? pathname === '/e-life'
            : pathname === tab.href || pathname.startsWith(tab.href + '/')
          const color = active ? BRAND : '#6b7280'
          return (
            <Link key={tab.id} href={tab.href} style={s.navTab}>
              <tab.Icon color={color} strokeWidth={active ? 2 : 1.5} />
              <span style={{ fontSize: 11, color, fontWeight: active ? 700 : 500 }}>{labels[tab.id]}</span>
            </Link>
          )
        })}
      </div>
      <div style={{ height: 'env(safe-area-inset-bottom)' }} />
    </nav>
  )
}

function HomeIcon({ color, strokeWidth }: IconProps) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  )
}

function CategoryIcon({ color, strokeWidth }: IconProps) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  )
}

function ClipboardIcon({ color, strokeWidth }: IconProps) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
      <line x1="12" y1="11" x2="16" y2="11" />
      <line x1="12" y1="16" x2="16" y2="16" />
      <line x1="8" y1="11" x2="8.01" y2="11" />
      <line x1="8" y1="16" x2="8.01" y2="16" />
    </svg>
  )
}

function UserIcon({ color, strokeWidth }: IconProps) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

const s: Record<string, CSSProperties> = {
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
