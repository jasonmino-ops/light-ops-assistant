'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type Lang = 'zh' | 'en' | 'km'

const PRIMARY = '#ff6b00'

const LABELS: Record<string, Record<Lang, string>> = {
  home:     { zh: '首页', en: 'Home',   km: 'ដើម' },
  order:    { zh: '点单', en: 'Menu',   km: 'ម៉ឺនុយ' },
  orders:   { zh: '订单', en: 'Orders', km: 'បញ្ជា' },
  messages: { zh: '消息', en: 'Msg',    km: 'សារ' },
  me:       { zh: '我的', en: 'Me',     km: 'ខ្ញុំ' },
}

const COMING_SOON: Record<Lang, string> = {
  zh: '消息中心即将开放',
  en: 'Messages coming soon',
  km: 'សារកំពុងអភិវឌ្ឍ',
}

export default function CustomerBottomNav({
  code,
  lang,
}: {
  code: string
  lang: Lang
}) {
  const pathname = usePathname()
  const qs = code ? `?code=${encodeURIComponent(code)}` : ''

  const tabs = [
    { key: 'home',     icon: '🏠', href: `/menu${qs}`,        active: pathname === '/menu' },
    { key: 'order',    icon: '🍽️', href: `/menu${qs}`,        active: false },
    { key: 'orders',   icon: '📦', href: `/menu/orders${qs}`, active: pathname.startsWith('/menu/orders') },
    { key: 'messages', icon: '💬', href: null as string | null, active: false, placeholder: true },
    { key: 'me',       icon: '👤', href: `/me${qs}`,          active: pathname === '/me' },
  ]

  return (
    <nav style={s.nav} aria-label="customer bottom nav">
      {tabs.map((t) => {
        const inner = (
          <>
            <span
              style={{
                ...s.icon,
                opacity: t.active ? 1 : 0.55,
                color: t.active ? PRIMARY : undefined,
              }}
            >
              {t.icon}
            </span>
            <span style={{ ...s.label, color: t.active ? PRIMARY : '#8a8a8a' }}>
              {LABELS[t.key][lang]}
            </span>
          </>
        )
        if (t.placeholder || !t.href) {
          return (
            <button
              key={t.key}
              type="button"
              style={s.tab}
              onClick={() => alert(COMING_SOON[lang])}
            >
              {inner}
            </button>
          )
        }
        return (
          <Link key={t.key} href={t.href} style={s.tab}>
            {inner}
          </Link>
        )
      })}
    </nav>
  )
}

const s: Record<string, React.CSSProperties> = {
  nav: {
    position: 'fixed' as const,
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
  tab: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    background: 'transparent',
    border: 'none',
    textDecoration: 'none',
    cursor: 'pointer',
    padding: 0,
  },
  icon: {
    fontSize: 20,
    lineHeight: 1,
  },
  label: {
    fontSize: 10,
    fontWeight: 600,
  },
}
