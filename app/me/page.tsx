'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import CustomerBottomNav from '@/app/components/CustomerBottomNav'
import { useDocumentLang } from '@/app/components/useDocumentLang'

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const PRIMARY = '#ff6b00'
const CUSTOMER_BOT = (process.env.NEXT_PUBLIC_CUSTOMER_BOT_USERNAME ?? '').replace(/^@/, '').trim()

type Lang = 'zh' | 'en' | 'km'

const LANG_LABELS: Record<Lang, string> = { zh: '中', en: 'EN', km: 'ខ្មែរ' }

function normalizeLang(value: string | null | undefined): Lang | null {
  const s = (value ?? '').toLowerCase()
  if (!s) return null
  if (s === 'zh' || s.startsWith('zh-') || s.startsWith('zh_')) return 'zh'
  if (s === 'en' || s.startsWith('en-') || s.startsWith('en_')) return 'en'
  if (s === 'km' || s.startsWith('km-') || s.startsWith('kh') || s === 'km_kh') return 'km'
  return null
}

function pickInitialLang(params: URLSearchParams, tgLang?: string | null): Lang {
  const fromUrl = normalizeLang(params.get('lang'))
  if (fromUrl) return fromUrl
  try {
    const saved = normalizeLang(localStorage.getItem('menu_lang'))
    if (saved) return saved
  } catch { /* ignore */ }
  const fromTg = normalizeLang(tgLang)
  if (fromTg) return fromTg
  for (const l of navigator.languages ?? []) {
    const normalized = normalizeLang(l)
    if (normalized) return normalized
  }
  return normalizeLang(navigator.language) ?? 'km'
}

// ─── i18n ────────────────────────────────────────────────────────────────────

const T: Record<Lang, {
  title: string
  guestUser: string
  normalMember: string
  vipMember: string
  balance: string
  coupon: string
  voucher: string
  points: string
  myOrders: string
  myAddress: string
  myFavorites: string
  contactService: string
  langSwitch: string
  bindTgTitle: string
  bindTgSub: string
  alreadyBoundTitle: string
  alreadyBoundSub: string
  couponCenter: string
  couponAvailable: string
  couponUsed: string
  couponExpired: string
  emptyCoupons: string
  comingSoon: string
  assetSection: string
  memberLevel: string
  goLogin: string
  backToMenu: string
  back: string
}> = {
  zh: {
    title:             '我的',
    guestUser:         '顾客',
    normalMember:      '普通顾客',
    vipMember:         '会员',
    balance:           '余额',
    coupon:            '优惠券',
    voucher:           '抵扣券',
    points:            '积分',
    myOrders:          '我的订单',
    myAddress:         '我的地址',
    myFavorites:       '收藏店铺',
    contactService:    '联系商家',
    langSwitch:        '语言',
    bindTgTitle:       '关注本店，接收订单通知',
    bindTgSub:         '绑定 Telegram 获取订单进度和优惠提醒',
    alreadyBoundTitle: '已绑定 Telegram',
    alreadyBoundSub:   '可在 Telegram 接收订单和优惠通知',
    couponCenter:      '优惠券中心',
    couponAvailable:   '可用',
    couponUsed:        '已使用',
    couponExpired:     '已过期',
    emptyCoupons:      '暂无优惠券',
    comingSoon:        '该功能即将开放',
    assetSection:      '我的资产',
    memberLevel:       '会员等级',
    goLogin:           '前往点单页',
    backToMenu:        '返回点单',
    back:              '返回',
  },
  en: {
    title:             'Me',
    guestUser:         'Customer',
    normalMember:      'Regular',
    vipMember:         'VIP',
    balance:           'Balance',
    coupon:            'Coupons',
    voucher:           'Vouchers',
    points:            'Points',
    myOrders:          'My Orders',
    myAddress:         'My Address',
    myFavorites:       'Favorite Stores',
    contactService:    'Contact Merchant',
    langSwitch:        'Language',
    bindTgTitle:       'Follow this store on Telegram',
    bindTgSub:         'Bind Telegram for order updates and promos',
    alreadyBoundTitle: 'Telegram Bound',
    alreadyBoundSub:   'You will receive order and promo updates',
    couponCenter:      'Coupons',
    couponAvailable:   'Available',
    couponUsed:        'Used',
    couponExpired:     'Expired',
    emptyCoupons:      'No coupons yet',
    comingSoon:        'Coming soon',
    assetSection:      'My Assets',
    memberLevel:       'Member Level',
    goLogin:           'Go to Menu',
    backToMenu:        'Back to Menu',
    back:              'Back',
  },
  km: {
    title:             'ខ្ញុំ',
    guestUser:         'អតិថិជន',
    normalMember:      'ធម្មតា',
    vipMember:         'សមាជិក',
    balance:           'សមតុល្យ',
    coupon:            'គូប៉ុង',
    voucher:           'ប័ណ្ណបញ្ចុះ',
    points:            'ពិន្ទុ',
    myOrders:          'បញ្ជាទិញរបស់ខ្ញុំ',
    myAddress:         'អាសយដ្ឋាន',
    myFavorites:       'ហាងចំណូលចិត្ត',
    contactService:    'ទំនាក់ទំនងហាង',
    langSwitch:        'ភាសា',
    bindTgTitle:       'តាមដានហាងនេះតាម Telegram',
    bindTgSub:         'ភ្ជាប់ Telegram ដើម្បីទទួលដំណឹង',
    alreadyBoundTitle: 'បានភ្ជាប់ Telegram',
    alreadyBoundSub:   'អ្នកនឹងទទួលដំណឹង',
    couponCenter:      'គូប៉ុង',
    couponAvailable:   'ប្រើបាន',
    couponUsed:        'បានប្រើ',
    couponExpired:     'អស់សុពលភាព',
    emptyCoupons:      'គ្មានគូប៉ុង',
    comingSoon:        'កំពុងអភិវឌ្ឍ',
    assetSection:      'ទ្រព្យសម្បត្តិរបស់ខ្ញុំ',
    memberLevel:       'ថ្នាក់សមាជិក',
    goLogin:           'ទៅកាន់ម៉ឺនុយ',
    backToMenu:        'ត្រឡប់ទៅម៉ឺនុយ',
    back:              'ត្រឡប់',
  },
}

// ─── 页面 ────────────────────────────────────────────────────────────────────

export default function MePage() {
  const [lang,         setLang]          = useState<Lang>('km')
  useDocumentLang(lang)
  const [storeCode,    setStoreCode]     = useState('')
  const [storeName,    setStoreName]     = useState('店小二')
  const [customerName, setCustomerName]  = useState('')
  const [customerBound, setCustomerBound] = useState(false)
  const [hasTgId,      setHasTgId]       = useState(false)
  const [tgId,         setTgId]          = useState('')
  const [availableCouponCount, setAvailableCouponCount] = useState(0)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code') ?? ''
    setStoreCode(code)

    // 检测 Telegram WebApp + 提取 tgId / displayName
    let tgIdLocal: string | null = null
    let tgLang: string | null = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tg = (window as any).Telegram?.WebApp
    if (tg?.initData) {
      try {
        const userStr = new URLSearchParams(tg.initData).get('user')
        if (userStr) {
          const u = JSON.parse(userStr)
          tgLang = typeof u.language_code === 'string' ? u.language_code : null
          if (u?.id != null) {
            tgIdLocal = String(u.id)
            setHasTgId(true)
            setTgId(tgIdLocal)
            const nm = String(u.first_name || u.username || '').trim()
            if (nm) setCustomerName(nm)
          }
        }
      } catch { /* ignore */ }
    }

    setLang(pickInitialLang(params, tgLang))

    if (!code) return

    // 拉门店名 + 绑定状态
    const url = `/api/public/menu?code=${encodeURIComponent(code)}` +
      (tgIdLocal ? `&tgId=${encodeURIComponent(tgIdLocal)}` : '')
    fetch(url)
      .then((r) => r.json())
      .then((body) => {
        if (!body?.error) {
          const nm = body.store?.name?.trim?.() || ''
          if (nm) setStoreName(nm)
          setCustomerBound(!!body.customerBound)
        }
      })
      .catch(() => { /* silent */ })

    // 优惠券可用数量（仅在有 tgId 时拉取）
    if (tgIdLocal) {
      fetch(`/api/customer/coupons?code=${encodeURIComponent(code)}&tgId=${encodeURIComponent(tgIdLocal)}`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((b) => { if (!b?.error) setAvailableCouponCount(b?.counts?.available ?? 0) })
        .catch(() => { /* silent */ })
    }
  }, [])

  useEffect(() => {
    try { localStorage.setItem('menu_lang', lang) } catch { /* ignore */ }
  }, [lang])

  useEffect(() => {
    document.title = storeName + ' · ' + T[lang].title
  }, [storeName, lang])

  const ui = T[lang]
  const qs = storeCode ? `?code=${encodeURIComponent(storeCode)}` : ''

  return (
    <main style={s.page}>
      {/* Header */}
      <div style={s.header}>
        <Link href={`/menu${qs}`} style={s.headerBack}>‹ {ui.backToMenu}</Link>
        <span style={s.headerTitle}>{ui.title}</span>
        <div style={s.langSwitch}>
          {(['zh', 'en', 'km'] as Lang[]).map((l) => (
            <button
              key={l}
              type="button"
              style={{ ...s.langBtn, ...(lang === l ? s.langBtnOn : {}) }}
              onClick={() => setLang(l)}
            >
              {LANG_LABELS[l]}
            </button>
          ))}
        </div>
      </div>

      <div style={s.body}>
        <>
            {/* 身份卡 */}
            <div style={s.userCard}>
              <div style={s.avatar}>{customerName ? customerName.slice(0, 1).toUpperCase() : '👤'}</div>
              <div style={s.userInfo}>
                <div style={s.userName}>{customerName || ui.guestUser}</div>
                <div style={s.userStore}>{storeName}</div>
              </div>
              <div style={s.memberBadge}>{customerBound ? ui.normalMember : ui.guestUser}</div>
            </div>

            {/* 资产 */}
            <div style={s.sectionLabel}>{ui.assetSection}</div>
            <div style={s.assetGrid}>
              <div style={s.assetCell} onClick={() => alert(ui.comingSoon)}>
                <div style={s.assetValue}>$0.00</div>
                <div style={s.assetLabel}>{ui.balance}</div>
              </div>
              <Link href={`/me/coupons${qs}`} style={{ ...s.assetCell, textDecoration: 'none', color: 'inherit' }}>
                <div style={s.assetValue}>{availableCouponCount}</div>
                <div style={s.assetLabel}>{ui.coupon}</div>
              </Link>
              <Link href={`/me/coupons${qs}`} style={{ ...s.assetCell, textDecoration: 'none', color: 'inherit' }}>
                <div style={s.assetValue}>{availableCouponCount}</div>
                <div style={s.assetLabel}>{ui.voucher}</div>
              </Link>
              <div style={s.assetCell} onClick={() => alert(ui.comingSoon)}>
                <div style={s.assetValue}>0</div>
                <div style={s.assetLabel}>{ui.points}</div>
              </div>
            </div>

            {/* Telegram 绑定卡 */}
            {customerBound ? (
              <div style={s.bindCard}>
                <div style={{ ...s.bindIcon, background: '#52c41a' }}>✓</div>
                <div style={s.bindBody}>
                  <div style={s.bindTitle}>{ui.alreadyBoundTitle}</div>
                  <div style={s.bindSub}>{ui.alreadyBoundSub}</div>
                </div>
              </div>
            ) : CUSTOMER_BOT && storeCode ? (
              <a
                href={`https://t.me/${CUSTOMER_BOT}?start=bind_${encodeURIComponent(storeCode)}`}
                target="_blank"
                rel="noreferrer"
                style={s.bindCardLink}
              >
                <div style={s.bindIcon}>📲</div>
                <div style={s.bindBody}>
                  <div style={s.bindTitle}>{ui.bindTgTitle}</div>
                  <div style={s.bindSub}>{ui.bindTgSub}</div>
                </div>
                <div style={s.bindArrow}>›</div>
              </a>
            ) : null}

            {/* 列表入口 */}
            <div style={s.list}>
              <Link
                href={storeCode ? `/menu/orders?code=${storeCode}` : '/menu'}
                style={s.listItem}
              >
                <span style={s.listIcon}>📦</span>
                <span style={s.listLabel}>{ui.myOrders}</span>
                <span style={s.listArrow}>›</span>
              </Link>
              <Link href={`/me/coupons${qs}`} style={s.listItem}>
                <span style={s.listIcon}>🎟️</span>
                <span style={s.listLabel}>{ui.couponCenter}</span>
                <span style={s.listArrow}>›</span>
              </Link>
              <button type="button" style={s.listItem} onClick={() => alert(ui.comingSoon)}>
                <span style={s.listIcon}>📍</span>
                <span style={s.listLabel}>{ui.myAddress}</span>
                <span style={s.listArrow}>›</span>
              </button>
              <button type="button" style={s.listItem} onClick={() => alert(ui.comingSoon)}>
                <span style={s.listIcon}>⭐</span>
                <span style={s.listLabel}>{ui.myFavorites}</span>
                <span style={s.listArrow}>›</span>
              </button>
              <button type="button" style={s.listItem} onClick={() => alert(ui.comingSoon)}>
                <span style={s.listIcon}>💬</span>
                <span style={s.listLabel}>{ui.contactService}</span>
                <span style={s.listArrow}>›</span>
              </button>
              <button type="button" style={s.listItem} onClick={() => alert(ui.comingSoon)}>
                <span style={s.listIcon}>🏅</span>
                <span style={s.listLabel}>{ui.memberLevel}</span>
                <span style={s.listArrow}>›</span>
              </button>
            </div>

            {!storeCode && (
              <div style={s.hintCard}>
                <Link href="/menu" style={s.hintLink}>{ui.goLogin} ›</Link>
              </div>
            )}
        </>
      </div>

      <CustomerBottomNav code={storeCode} lang={lang} />
    </main>
  )
}

// ─── 样式 ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100dvh',
    background: '#f0f0f0',
    maxWidth: 480,
    margin: '0 auto',
    paddingBottom: 80,
    position: 'relative' as const,
  },
  header: {
    background: '#fff',
    padding: '12px 12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottom: '1px solid #ebebeb',
    position: 'sticky' as const,
    top: 0,
    zIndex: 20,
  },
  headerBack: {
    fontSize: 13,
    color: '#666',
    textDecoration: 'none',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    minWidth: 70,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: 700,
    color: '#1a1a1a',
  },
  langSwitch: {
    display: 'flex',
    background: '#f5f5f5',
    borderRadius: 12,
    padding: 2,
    gap: 1,
    minWidth: 70,
  },
  langBtn: {
    border: 'none',
    background: 'transparent',
    color: '#888',
    fontSize: 11,
    fontWeight: 600,
    padding: '3px 8px',
    borderRadius: 10,
    cursor: 'pointer',
    lineHeight: 1.4,
  },
  langBtnOn: {
    background: '#fff',
    color: PRIMARY,
    boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
  },
  body: { padding: '12px 12px 12px' },

  userCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    background: `linear-gradient(135deg, #ff8c00 0%, ${PRIMARY} 100%)`,
    borderRadius: 16,
    padding: '16px 16px',
    color: '#fff',
    marginBottom: 14,
    boxShadow: `0 4px 16px ${PRIMARY}30`,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.25)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 22,
    fontWeight: 700,
    color: '#fff',
    flexShrink: 0,
  },
  userInfo: { flex: 1, minWidth: 0 },
  userName: {
    fontSize: 16,
    fontWeight: 700,
    color: '#fff',
    marginBottom: 3,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  userStore: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.85)',
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  memberBadge: {
    fontSize: 11,
    fontWeight: 700,
    padding: '4px 10px',
    borderRadius: 12,
    background: 'rgba(255,255,255,0.25)',
    color: '#fff',
    flexShrink: 0,
  },

  sectionLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: '#888',
    letterSpacing: '0.04em',
    padding: '0 4px 6px',
    textTransform: 'uppercase' as const,
  },

  assetGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr 1fr',
    gap: 4,
    background: '#fff',
    borderRadius: 12,
    padding: '14px 8px',
    marginBottom: 14,
  },
  assetCell: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 4,
    padding: '4px 0',
    cursor: 'pointer',
  },
  assetValue: {
    fontSize: 18,
    fontWeight: 800,
    color: '#1a1a1a',
    letterSpacing: '-0.4px',
  },
  assetLabel: { fontSize: 11, color: '#888' },

  bindCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    background: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    border: '1.5px solid #d9f7be',
  },
  bindCardLink: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    background: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    border: '1.5px solid #ffd591',
    textDecoration: 'none',
    color: 'inherit',
  },
  bindIcon: {
    width: 38,
    height: 38,
    borderRadius: '50%',
    background: '#0088cc',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 18,
    color: '#fff',
    flexShrink: 0,
  },
  bindBody: { flex: 1, minWidth: 0 },
  bindTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: '#1a1a1a',
    marginBottom: 2,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  bindSub: {
    fontSize: 12,
    color: '#888',
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  bindArrow: {
    fontSize: 24,
    color: '#c0c0c0',
    flexShrink: 0,
    lineHeight: 1,
  },

  list: { background: '#fff', borderRadius: 12, overflow: 'hidden' },
  listItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '13px 14px',
    borderBottom: '1px solid #f5f5f5',
    textDecoration: 'none',
    color: '#1a1a1a',
    background: 'transparent',
    border: 'none',
    borderTop: 'none',
    width: '100%',
    cursor: 'pointer',
    textAlign: 'left' as const,
    fontSize: 14,
  },
  listIcon: { fontSize: 18, width: 22, textAlign: 'center' as const, flexShrink: 0 },
  listLabel: { flex: 1, fontSize: 14, fontWeight: 500, color: '#1a1a1a' },
  listArrow: { fontSize: 18, color: '#c0c0c0', flexShrink: 0, lineHeight: 1 },

  hintCard: {
    marginTop: 14,
    background: '#fff',
    borderRadius: 12,
    padding: 14,
    textAlign: 'center' as const,
  },
  hintLink: {
    color: PRIMARY,
    fontSize: 14,
    fontWeight: 600,
    textDecoration: 'none',
  },
}

const cp: Record<string, React.CSSProperties> = {
  tabs: {
    display: 'flex',
    background: '#fff',
    borderRadius: 12,
    padding: 4,
    marginBottom: 12,
  },
  tab: {
    flex: 1,
    padding: '8px 0',
    background: 'none',
    border: 'none',
    fontSize: 13,
    fontWeight: 600,
    color: '#888',
    cursor: 'pointer',
    borderRadius: 8,
  },
  tabActive: {
    color: '#fff',
    background: PRIMARY,
  },
  empty: {
    padding: '60px 20px',
    textAlign: 'center' as const,
    color: '#bbb',
    fontSize: 14,
    background: '#fff',
    borderRadius: 12,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
    opacity: 0.4,
  },
}
