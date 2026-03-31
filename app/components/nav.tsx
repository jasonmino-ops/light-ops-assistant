'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/sale',      label: '销售',  icon: '🛒' },
  { href: '/refund',    label: '退款',  icon: '↩️' },
  { href: '/records',   label: '记录',  icon: '📋' },
  { href: '/dashboard', label: '概览',  icon: '📊' },
]

export default function BottomNav() {
  const pathname = usePathname()

  return (
    <nav style={s.nav}>
      {TABS.map((tab) => {
        const active = pathname === tab.href
        return (
          <Link key={tab.href} href={tab.href} style={s.link}>
            <span style={s.icon}>{tab.icon}</span>
            <span style={{ ...s.label, ...(active ? s.labelActive : {}) }}>
              {tab.label}
            </span>
            {active && <span style={s.dot} />}
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
    height: 56,
    background: '#fff',
    borderTop: '1px solid #e8e8e8',
    display: 'flex',
    zIndex: 100,
  },
  link: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    textDecoration: 'none',
    position: 'relative',
  },
  icon: {
    fontSize: 20,
    lineHeight: 1,
  },
  label: {
    fontSize: 11,
    color: '#aaa',
  },
  labelActive: {
    color: '#1677ff',
    fontWeight: 600,
  },
  dot: {
    position: 'absolute',
    bottom: 4,
    width: 4,
    height: 4,
    borderRadius: '50%',
    background: '#1677ff',
  },
}
