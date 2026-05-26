'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'

const BRAND = '#07c160'
const GOLD  = '#f59e0b'

type Lang = 'zh' | 'en' | 'km'

// ─── Translations ─────────────────────────────────────────────────────────────

const T = {
  zh: {
    back: '首页', title: 'E-Life 会员专享', sub: '优惠券 · 积分 · 商户福利',
    comingTitle: '会员功能即将开放',
    comingSub: '当前可先关注商户优惠与平台活动',
    btnHome: '返回首页', btnOrders: '查看我的订单',
    navHome: '首页', navScan: '扫一扫', navOrders: '我的订单', navProfile: '我的',
    toastScan: '请回首页使用扫一扫',
    perks: [
      { title: '专属优惠券', desc: '商户专属折扣，限会员领取' },
      { title: '积分奖励',   desc: '每次消费积累积分，兑换礼品' },
      { title: '商户会员福利', desc: '入驻商户专属会员待遇' },
      { title: '活动优先体验', desc: '平台新活动会员优先参与' },
    ],
  },
  en: {
    back: 'Home', title: 'E-Life Membership', sub: 'Coupons · Points · Rewards',
    comingTitle: 'Membership Coming Soon',
    comingSub: 'Stay tuned for exclusive merchant deals and platform events',
    btnHome: 'Go Home', btnOrders: 'My Orders',
    navHome: 'Home', navScan: 'Scan', navOrders: 'My Orders', navProfile: 'Me',
    toastScan: 'Please use Scan from Home',
    perks: [
      { title: 'Exclusive Coupons', desc: 'Member-only discounts from merchants' },
      { title: 'Points Rewards',    desc: 'Earn points on every purchase' },
      { title: 'Merchant Benefits', desc: 'Special treatment at partner stores' },
      { title: 'Early Access',      desc: 'Be first to join platform events' },
    ],
  },
  km: {
    back: 'ទំព័រដើម', title: 'សមាជិក E-Life', sub: 'គូប៉ុង · ពិន្ទុ · រង្វាន់',
    comingTitle: 'មុខងារសមាជិកនឹងបើកឆាប់ៗ',
    comingSub: 'តាមដានការផ្តល់ជូនពិសេសពីហាង',
    btnHome: 'ត្រឡប់ទៅដើម', btnOrders: 'ការបញ្ជាទិញ',
    navHome: 'ទំព័រដើម', navScan: 'ស្កេន', navOrders: 'ការបញ្ជាទិញ', navProfile: 'ខ្ញុំ',
    toastScan: 'សូមប្រើស្កេននៅទំព័រដើម',
    perks: [
      { title: 'គូប៉ុងផ្តាច់មុខ',    desc: 'ការបញ្ចុះតម្លៃពិសេសសម្រាប់សមាជិក' },
      { title: 'រង្វាន់ពិន្ទុ',       desc: 'ប្រមូលពិន្ទុរៀងរាល់ការទិញ' },
      { title: 'អត្ថប្រយោជន៍ហាង',    desc: 'ការព្យាបាលពិសេសសម្រាប់សមាជិក' },
      { title: 'ចូលដំណើរការមុន',     desc: 'ចូលរួមសកម្មភាពថ្មីៗមុនគេ' },
    ],
  },
}

const PERK_ICONS = ['🎟️', '⭐', '🏪', '🎉']
const PERK_COLORS = [
  { bg: 'rgba(249,115,22,0.08)',  icon: 'rgba(249,115,22,0.9)' },
  { bg: 'rgba(245,158,11,0.08)', icon: 'rgba(245,158,11,0.9)' },
  { bg: 'rgba(7,193,96,0.08)',   icon: BRAND },
  { bg: 'rgba(99,102,241,0.08)', icon: 'rgba(99,102,241,0.9)' },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MembershipPage() {
  const router  = useRouter()
  const [lang, setLang]   = useState<Lang>('zh')
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    try {
      const saved = localStorage.getItem('eLife_lang') as Lang | null
      if (saved && (['zh', 'en', 'km'] as string[]).includes(saved)) setLang(saved)
    } catch { /* ignore */ }
  }, [])

  const t = T[lang]

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2200)
  }

  return (
    <div style={{ minHeight: '100dvh', background: '#F7F8FA', maxWidth: 448, margin: '0 auto', paddingBottom: 80 }}>

      {/* ── Header ── */}
      <header style={{ position: 'sticky', top: 0, zIndex: 50, background: 'linear-gradient(to bottom, #fffbf0, #fff)', borderBottom: '1px solid rgba(245,158,11,0.1)' }}>
        <div style={{ padding: '10px 16px 14px' }}>
          <button
            onClick={() => router.push('/e-life')}
            style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', marginBottom: 8 }}
          >
            <ChevronLeftIcon />
            <span style={{ fontSize: 13, color: '#6b7280' }}>{t.back}</span>
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(245,158,11,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <CrownIcon />
            </div>
            <div>
              <h1 style={{ fontSize: 18, fontWeight: 700, color: '#111827', margin: 0 }}>{t.title}</h1>
              <p style={{ fontSize: 12, color: '#9ca3af', margin: 0 }}>{t.sub}</p>
            </div>
          </div>
        </div>
      </header>

      <main style={{ padding: '16px 16px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* ── Perk cards ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {t.perks.map((perk, idx) => (
            <div
              key={idx}
              style={{ background: '#fff', borderRadius: 14, border: '1px solid rgba(0,0,0,0.06)', padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}
            >
              <div style={{ width: 36, height: 36, borderRadius: 10, background: PERK_COLORS[idx].bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
                {PERK_ICONS[idx]}
              </div>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#111827', margin: 0 }}>{perk.title}</h3>
              <p style={{ fontSize: 12, color: '#6b7280', margin: 0, lineHeight: 1.5 }}>{perk.desc}</p>
            </div>
          ))}
        </div>

        {/* ── Coming soon notice ── */}
        <div style={{ background: 'linear-gradient(135deg, #fffbf0, #fefce8)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 14, padding: '16px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textAlign: 'center' }}>
          <div style={{ fontSize: 28 }}>🌟</div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#92400e', margin: 0 }}>{t.comingTitle}</h3>
          <p style={{ fontSize: 13, color: '#b45309', margin: 0, lineHeight: 1.6 }}>{t.comingSub}</p>
        </div>

        {/* ── CTA buttons ── */}
        <button
          onClick={() => router.push('/e-life')}
          style={{ width: '100%', padding: '13px 0', background: BRAND, color: '#fff', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
        >
          {t.btnHome}
        </button>
        <button
          onClick={() => router.push('/e-life/orders')}
          style={{ width: '100%', padding: '13px 0', background: '#fff', color: '#374151', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
        >
          {t.btnOrders}
        </button>

      </main>

      {/* ── Toast ── */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 'calc(64px + env(safe-area-inset-bottom, 0px) + 12px)', left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.72)', color: '#fff', fontSize: 13, padding: '9px 18px', borderRadius: 20, whiteSpace: 'nowrap', zIndex: 200, pointerEvents: 'none' }}>
          {toast}
        </div>
      )}

      {/* ── Bottom Nav ── */}
      <MembershipBottomNav t={t} onScan={() => showToast(t.toastScan)} />
    </div>
  )
}

// ─── Bottom Nav ───────────────────────────────────────────────────────────────

function MembershipBottomNav({ t, onScan }: { t: typeof T[Lang]; onScan: () => void }) {
  const pathname = usePathname()

  const tabs = [
    { id: 'home',    label: t.navHome,    href: '/e-life' as string | null,   onClick: undefined as (() => void) | undefined },
    { id: 'scan',    label: t.navScan,    href: null,                          onClick: onScan },
    { id: 'orders',  label: t.navOrders,  href: '/e-life/orders' as string | null, onClick: undefined },
    { id: 'profile', label: t.navProfile, href: '/e-life/me' as string | null,     onClick: undefined },
  ]

  return (
    <nav style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(16px)', borderTop: '1px solid rgba(0,0,0,0.06)', zIndex: 50 }}>
      <div style={{ maxWidth: 448, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-around', padding: '4px 16px' }}>
        {tabs.map(tab => {
          const active = tab.href ? (pathname === tab.href || pathname.startsWith(tab.href + '/')) : false
          const color  = active ? BRAND : '#6b7280'
          const inner  = (
            <>
              <NavIcon id={tab.id} color={color} active={active} />
              <span style={{ fontSize: 11, color, fontWeight: active ? 700 : 500 }}>{tab.label}</span>
            </>
          )
          if (tab.onClick) {
            return <button key={tab.id} style={navTabStyle} onClick={tab.onClick}>{inner}</button>
          }
          return <Link key={tab.id} href={tab.href!} style={navTabStyle}>{inner}</Link>
        })}
      </div>
      <div style={{ height: 'env(safe-area-inset-bottom)' }} />
    </nav>
  )
}

const navTabStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
  padding: '6px 20px', background: 'transparent', border: 'none', borderRadius: 12,
  cursor: 'pointer', textDecoration: 'none', color: 'inherit',
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function ChevronLeftIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6"/>
    </svg>
  )
}

function CrownIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m2 4 3 12h14l3-12-6 4-4-7-4 7-6-4z"/><line x1="5" y1="20" x2="19" y2="20"/>
    </svg>
  )
}

function NavIcon({ id, color, active }: { id: string; color: string; active: boolean }) {
  const sw = active ? 2 : 1.5
  const p  = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none' as const, stroke: color, strokeWidth: sw, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (id === 'home')    return <svg {...p}><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
  if (id === 'scan')    return <svg {...p}><path d="M3 7V5a2 2 0 012-2h2"/><path d="M17 3h2a2 2 0 012 2v2"/><path d="M21 17v2a2 2 0 01-2 2h-2"/><path d="M7 21H5a2 2 0 01-2-2v-2"/><line x1="3" y1="12" x2="21" y2="12"/></svg>
  if (id === 'orders')  return <svg {...p}><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><line x1="12" y1="11" x2="16" y2="11"/><line x1="12" y1="16" x2="16" y2="16"/><line x1="8" y1="11" x2="8.01" y2="11"/><line x1="8" y1="16" x2="8.01" y2="16"/></svg>
  return <svg {...p}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
}
