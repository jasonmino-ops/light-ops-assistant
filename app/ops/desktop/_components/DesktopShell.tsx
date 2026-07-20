'use client'

import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/ops/desktop/activation', label: 'Activation' },
  { href: '/ops/desktop/devices', label: 'Devices' },
  { href: '/ops/desktop/runtime', label: 'Runtime' },
  { href: '/ops/desktop/audit', label: 'Audit' },
]

export default function DesktopShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [authState, setAuthState] = useState<'checking' | 'allowed' | 'denied'>('checking')
  const [opsRole, setOpsRole] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('/api/ops/check', { cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() : null)
      .then((body) => {
        if (cancelled) return
        const role = body?.opsRole ?? ''
        setOpsRole(role)
        setAuthState(role === 'OPS_ADMIN' || role === 'SUPER_ADMIN' ? 'allowed' : 'denied')
      })
      .catch(() => { if (!cancelled) setAuthState('denied') })
    return () => { cancelled = true }
  }, [])

  if (authState === 'checking') return <div style={s.center}>验证运营权限...</div>
  if (authState === 'denied') {
    return (
      <div style={s.center}>
        <div style={s.denied}>当前账号无权访问 Desktop 管理。</div>
        <Link href="/ops" style={s.returnLink}>返回运营后台</Link>
      </div>
    )
  }

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={s.headerInner}>
          <div style={s.brandRow}>
            <div>
              <Link href="/ops" style={s.backLink}>运营后台</Link>
              <div style={s.productName}>Desktop Management</div>
            </div>
            <span style={s.roleBadge}>{opsRole}</span>
          </div>
          <nav style={s.tabs} aria-label="Desktop management">
            {TABS.map((tab) => {
              const active = pathname === tab.href
              return (
                <Link className="desktop-management-tab" key={tab.href} href={tab.href} style={{ ...s.tab, ...(active ? s.tabActive : {}) }}>
                  {tab.label}
                </Link>
              )
            })}
          </nav>
        </div>
      </header>
      {children}
      <style>{`
        @media (max-width: 640px) {
          .desktop-management-tab { min-width: 0 !important; padding: 0 6px !important; flex: 1 1 25%; }
          .desktop-search-bar { grid-template-columns: 1fr !important; }
          .desktop-store-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
          .desktop-device-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
          .desktop-runtime-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
          .desktop-runtime-grid > :last-child { grid-column: 1 / -1; }
        }
      `}</style>
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#f7f8fa', color: '#111827' },
  header: { background: '#171923', color: '#fff', borderBottom: '1px solid #2d3340' },
  headerInner: { width: 'min(1180px, calc(100vw - 28px))', margin: '0 auto' },
  brandRow: {
    minHeight: 72,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  backLink: { color: '#93c5fd', textDecoration: 'none', fontSize: 12, fontWeight: 800 },
  productName: { marginTop: 4, fontSize: 20, lineHeight: 1.2, fontWeight: 900, letterSpacing: 0 },
  roleBadge: {
    padding: '5px 8px',
    border: '1px solid #475569',
    borderRadius: 6,
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: 900,
  },
  tabs: { display: 'flex', gap: 2, overflowX: 'auto' },
  tab: {
    minWidth: 94,
    height: 42,
    padding: '0 14px',
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottom: '3px solid transparent',
    color: '#94a3b8',
    textDecoration: 'none',
    fontSize: 13,
    fontWeight: 800,
  },
  tabActive: { color: '#fff', borderBottomColor: '#60a5fa', background: '#202631' },
  center: {
    minHeight: '100vh',
    display: 'grid',
    placeContent: 'center',
    gap: 10,
    padding: 20,
    background: '#f7f8fa',
    color: '#64748b',
    textAlign: 'center',
    fontSize: 14,
    fontWeight: 700,
  },
  denied: { color: '#991b1b' },
  returnLink: { color: '#2563eb', textDecoration: 'none', fontWeight: 800 },
}
