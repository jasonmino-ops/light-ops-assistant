'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import ELifeBottomNav from '../components/ELifeBottomNav'
import { useDocumentLang } from '@/app/components/useDocumentLang'

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
    navHome: '首页', navCategory: '分类', navOrders: '我的订单', navProfile: '我的',
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
    navHome: 'Home', navCategory: 'Category', navOrders: 'My Orders', navProfile: 'Me',
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
    navHome: 'ទំព័រដើម', navCategory: 'ប្រភេទ', navOrders: 'ការបញ្ជាទិញ', navProfile: 'ខ្ញុំ',
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
  useDocumentLang(lang)

  useEffect(() => {
    try {
      const saved = localStorage.getItem('eLife_lang') as Lang | null
      if (saved && (['zh', 'en', 'km'] as string[]).includes(saved)) setLang(saved)
    } catch { /* ignore */ }
  }, [])

  const t = T[lang]

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

      {/* ── Bottom Nav ── */}
      <ELifeBottomNav lang={lang} />
    </div>
  )
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
