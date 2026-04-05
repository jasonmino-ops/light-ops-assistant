'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useWorkMode } from './WorkModeProvider'

const STAFF_TABS = [
  { href: '/home',    label: '首页', icon: '🏠' },
  { href: '/sale',    label: '销售', icon: '💰' },
  { href: '/records', label: '记录', icon: '📋' },
]

const OWNER_TABS = [
  { href: '/home',      label: '首页', icon: '🏠' },
  { href: '/sale',      label: '销售', icon: '💰' },
  { href: '/products',  label: '商品', icon: '📦' },
  { href: '/invite',    label: '邀请', icon: '🔗' },
  { href: '/dashboard', label: '概览', icon: '📊' },
]

// 只在这些页面显示底部导航
const SHOW_PATHS = new Set(['/home', '/sale', '/records', '/products', '/invite', '/dashboard'])

export default function BottomNav() {
  const pathname = usePathname()
  const { effectiveRole } = useWorkMode()
  const [isStandalone, setIsStandalone] = useState(false)

  useEffect(() => {
    // 仅在 standalone 模式（从桌面图标启动）且不在 Telegram WebApp 内时显示
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inTelegram = !!(window as any).Telegram?.WebApp?.initData
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (navigator as any).standalone === true
    setIsStandalone(standalone && !inTelegram)
  }, [])

  if (!isStandalone) return null
  if (!SHOW_PATHS.has(pathname)) return null

  const tabs = effectiveRole === 'OWNER' ? OWNER_TABS : STAFF_TABS

  return (
    <nav style={s.nav}>
      {tabs.map((tab) => {
        const active = pathname === tab.href
        return (
          <Link key={tab.href} href={tab.href} style={s.link}>
            <span style={{ ...s.icon, opacity: active ? 1 : 0.45 }}>{tab.icon}</span>
            <span style={{ ...s.label, ...(active ? s.labelActive : {}) }}>
              {tab.label}
            </span>
            {active && <span style={s.activeLine} />}
          </Link>
        )
      })}
    </nav>
  )
}

const s: Record<string, React.CSSProperties> = {
  nav: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    height: 60,
    background: '#fff',
    borderTop: '1px solid #e8e8e8',
    display: 'flex',
    zIndex: 100,
    paddingBottom: 'env(safe-area-inset-bottom)',
  },
  link: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    textDecoration: 'none',
    position: 'relative',
  },
  icon: {
    fontSize: 22,
    lineHeight: 1,
  },
  label: {
    fontSize: 10,
    color: '#aaa',
    letterSpacing: '0.02em',
  },
  labelActive: {
    color: '#1677ff',
    fontWeight: 600,
  },
  activeLine: {
    position: 'absolute',
    top: 0,
    width: 24,
    height: 2,
    borderRadius: 2,
    background: '#1677ff',
  },
}
