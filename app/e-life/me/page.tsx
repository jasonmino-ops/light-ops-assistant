'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

const BRAND = '#07c160'
// TODO: Move production customer service entry to NEXT_PUBLIC_SUPPORT_URL
// or NEXT_PUBLIC_CUSTOMER_SERVICE_BOT_USERNAME once the final support bot is fixed.
const FALLBACK_CUSTOMER_SERVICE_URL = 'https://t.me/Eshop_sale_bot'

function cleanBotUsername(raw?: string) {
  return (raw ?? '').replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '')
}

function resolveCustomerServiceUrl() {
  const explicitUrl = process.env.NEXT_PUBLIC_SUPPORT_URL?.trim()
    || process.env.NEXT_PUBLIC_CUSTOMER_SERVICE_URL?.trim()
  if (explicitUrl) return explicitUrl

  const botUsername = cleanBotUsername(
    process.env.NEXT_PUBLIC_SUPPORT_BOT_USERNAME
      || process.env.NEXT_PUBLIC_CUSTOMER_SERVICE_BOT_USERNAME
      || process.env.NEXT_PUBLIC_CUSTOMER_BOT_USERNAME
  )
  if (botUsername) return `https://t.me/${botUsername}`

  return FALLBACK_CUSTOMER_SERVICE_URL
}

const CUSTOMER_SERVICE_URL = resolveCustomerServiceUrl()

function isTelegramServiceLink(url: string) {
  return url.startsWith('https://t.me/') || url.startsWith('tg://resolve')
}

type Lang = 'zh' | 'en' | 'km'
type RecentStore = { code: string; name: string; lastVisitedAt: string }

const LANG_OPTIONS: { code: Lang; label: string; sub: string }[] = [
  { code: 'zh', label: '中文', sub: 'Chinese' },
  { code: 'en', label: 'English', sub: 'English' },
  { code: 'km', label: 'ខ្មែរ', sub: 'Khmer' },
]

const T = {
  zh: {
    title:         'E-Life 我的',
    backHome:      '返回首页',
    noTg:          '请在 Telegram 中打开以查看个人信息',
    guestName:     '顾客',
    myOrders:      '我的订单',
    frequentShops: '我的常去',
    myCoupons:     '我的优惠券',
    langSetting:   '语言设置',
    service:       '联系客服',
    serviceNotConfigured: '客服入口暂未配置',
    serviceOpenFailed: '无法打开客服入口，请稍后重试',
    comingSoon:    '该功能即将开放',
    scanHint:      '请回首页使用扫一扫',
    emptyShops:    '暂无常去商户',
    navHome:       '首页',
    navScan:       '扫一扫',
    navOrders:     '我的订单',
    navMe:         '我的',
    langTitle:     '选择语言',
  },
  en: {
    title:         'E-Life Me',
    backHome:      'Home',
    noTg:          'Open in Telegram to view your profile',
    guestName:     'Customer',
    myOrders:      'My Orders',
    frequentShops: 'My Favorites',
    myCoupons:     'My Coupons',
    langSetting:   'Language',
    service:       'Customer Service',
    serviceNotConfigured: 'Customer service is not configured',
    serviceOpenFailed: 'Unable to open customer service. Please try again later',
    comingSoon:    'Coming soon',
    scanHint:      'Use Scan on the home page',
    emptyShops:    'No visited stores yet',
    navHome:       'Home',
    navScan:       'Scan',
    navOrders:     'Orders',
    navMe:         'Me',
    langTitle:     'Language',
  },
  km: {
    title:         'E-Life ខ្ញុំ',
    backHome:      'ទំព័រដើម',
    noTg:          'សូមបើកក្នុង Telegram ដើម្បីមើលព័ត៌មាន',
    guestName:     'អតិថិជន',
    myOrders:      'ការបញ្ជាទិញ',
    frequentShops: 'ហាងញឹកញាប់',
    myCoupons:     'គូប៉ុងរបស់ខ្ញុំ',
    langSetting:   'ភាសា',
    service:       'ជំនួយ',
    serviceNotConfigured: 'មិនទាន់បានកំណត់ច្រកជំនួយ',
    serviceOpenFailed: 'មិនអាចបើកច្រកជំនួយបាន សូមព្យាយាមម្តងទៀត',
    comingSoon:    'កំពុងអភិវឌ្ឍ',
    scanHint:      'ប្រើស្កេននៅទំព័រដើម',
    emptyShops:    'គ្មានហាង',
    navHome:       'ទំព័រដើម',
    navScan:       'ស្កេន',
    navOrders:     'ការបញ្ជាទិញ',
    navMe:         'ខ្ញុំ',
    langTitle:     'ភាសា',
  },
}

export default function ELifeMePage() {
  const router = useRouter()
  const [lang,         setLang]         = useState<Lang>('zh')
  const [showLangPanel, setShowLangPanel] = useState(false)
  const [noTg,         setNoTg]         = useState(false)
  const [tgName,       setTgName]       = useState('')
  const [tgUsername,   setTgUsername]   = useState('')
  const [tgId,         setTgId]         = useState('')
  const [recentStores, setRecentStores] = useState<RecentStore[]>([])
  const [toast,        setToast]        = useState<string | null>(null)

  useEffect(() => {
    try {
      const savedLang = localStorage.getItem('eLife_lang') as Lang | null
      if (savedLang && (['zh', 'en', 'km'] as string[]).includes(savedLang)) setLang(savedLang)

      const raw = localStorage.getItem('eLife_recentStores')
      if (raw) {
        const parsed = JSON.parse(raw) as RecentStore[]
        if (Array.isArray(parsed)) setRecentStores(parsed.slice(0, 6))
      }
    } catch { /* ignore */ }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tg = (window as any).Telegram?.WebApp
    tg?.expand?.()

    if (!tg?.initData) {
      setNoTg(true)
      return
    }

    try {
      const userStr = new URLSearchParams(tg.initData).get('user')
      if (userStr) {
        const u = JSON.parse(userStr)
        setTgId(String(u.id ?? ''))
        setTgName(String(u.first_name ?? u.username ?? '').trim())
        setTgUsername(u.username ? `@${u.username}` : '')
      }
    } catch { /* ignore */ }

    // 从后端读取真实最近访问（覆盖 localStorage）
    fetch('/api/e-life/recent-stores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: tg.initData }),
    })
      .then((r) => r.json())
      .then((body) => {
        if (body.ok && Array.isArray(body.stores) && body.stores.length > 0) {
          setRecentStores(
            body.stores.map((s: { storeCode: string; storeName: string; lastSeenAt: string }) => ({
              code: s.storeCode, name: s.storeName, lastVisitedAt: s.lastSeenAt,
            }))
          )
        }
      })
      .catch(() => { /* 静默失败，localStorage 结果保持 */ })
  }, [])

  function changeLang(l: Lang) {
    setLang(l)
    setShowLangPanel(false)
    try { localStorage.setItem('eLife_lang', l) } catch { /* ignore */ }
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2200)
  }

  function openCustomerService() {
    const url = CUSTOMER_SERVICE_URL.trim()
    if (!url) {
      showToast(t.serviceNotConfigured)
      return
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tg = (window as any).Telegram?.WebApp
      if (isTelegramServiceLink(url) && typeof tg?.openTelegramLink === 'function') {
        tg.openTelegramLink(url)
        return
      }
      if (typeof tg?.openLink === 'function') {
        tg.openLink(url)
        return
      }
      window.location.href = url
    } catch {
      showToast(t.serviceOpenFailed)
      window.alert?.(t.serviceOpenFailed)
    }
  }

  const t = T[lang]
  const displayName = tgName || t.guestName

  return (
    <div style={s.page}>

      {/* ── Header ── */}
      <header style={s.header}>
        <button style={s.backBtn} onClick={() => router.push('/e-life')}>
          <ChevronLeftIcon />
        </button>
        <h1 style={s.headerTitle}>{t.title}</h1>
        <div style={{ width: 36 }} />
      </header>

      {/* ── Language Panel ── */}
      {showLangPanel && (
        <>
          <div style={s.overlay} onClick={() => setShowLangPanel(false)} />
          <div style={s.sheet}>
            <h3 style={s.sheetTitle}>{t.langTitle}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {LANG_OPTIONS.map(item => (
                <button
                  key={item.code}
                  style={{ ...s.langOpt, ...(lang === item.code ? s.langOptActive : {}) }}
                  onClick={() => changeLang(item.code)}
                >
                  <div style={{ textAlign: 'left' }}>
                    <p style={{ ...s.langOptLabel, ...(lang === item.code ? { color: BRAND } : {}) }}>{item.label}</p>
                    <p style={s.langOptSub}>{item.sub}</p>
                  </div>
                  {lang === item.code && <CheckIcon />}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <main style={s.body}>

        {noTg ? (
          <div style={s.noTgCard}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>💬</div>
            <p style={{ fontSize: 15, color: '#bbb', margin: 0, textAlign: 'center' }}>{t.noTg}</p>
          </div>
        ) : (
          /* ── 用户信息卡 ── */
          <div style={s.userCard}>
            <div style={s.avatar}>{displayName.slice(0, 1).toUpperCase()}</div>
            <div style={s.userInfo}>
              <div style={s.userName}>{displayName}</div>
              {tgUsername && <div style={s.userSub}>{tgUsername}</div>}
              {tgId && <div style={s.userId}>ID: {tgId}</div>}
            </div>
          </div>
        )}

        {/* ── 功能入口列表 ── */}
        <div style={s.list}>
          {/* 我的订单 */}
          <button style={s.listItem} onClick={() => router.push('/e-life/orders')}>
            <span style={s.listIcon}>📦</span>
            <span style={s.listLabel}>{t.myOrders}</span>
            <ChevronRightSmIcon />
          </button>

          {/* 我的常去 */}
          <div style={{ ...s.listItem, flexDirection: 'column', alignItems: 'stretch', gap: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
              <span style={s.listIcon}>🏪</span>
              <span style={s.listLabel}>{t.frequentShops}</span>
            </div>
            {recentStores.length === 0 ? (
              <p style={{ fontSize: 12, color: '#bbb', margin: '4px 0 0 34px' }}>{t.emptyShops}</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginTop: 6, marginLeft: 34 }}>
                {recentStores.map((st) => (
                  <button
                    key={st.code}
                    style={s.shopRow}
                    onClick={() => router.push(`/menu?code=${encodeURIComponent(st.code)}&from=e-life-me`)}
                  >
                    <span style={s.shopName}>{st.name}</span>
                    <ChevronRightSmIcon />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 我的优惠券 */}
          <button style={s.listItem} onClick={() => showToast(t.comingSoon)}>
            <span style={s.listIcon}>🎟️</span>
            <span style={s.listLabel}>{t.myCoupons}</span>
            <ChevronRightSmIcon />
          </button>

          {/* 语言设置 */}
          <button style={s.listItem} onClick={() => setShowLangPanel(true)}>
            <span style={s.listIcon}>🌐</span>
            <span style={s.listLabel}>{t.langSetting}</span>
            <span style={{ fontSize: 12, color: '#bbb', marginRight: 4 }}>
              {LANG_OPTIONS.find(o => o.code === lang)?.label}
            </span>
            <ChevronRightSmIcon />
          </button>

          {/* 联系客服 */}
          <button style={{ ...s.listItem, borderBottom: 'none' }} onClick={openCustomerService}>
            <span style={s.listIcon}>💬</span>
            <span style={s.listLabel}>{t.service}</span>
            <ChevronRightSmIcon />
          </button>
        </div>
      </main>

      {/* ── Toast ── */}
      {toast && (
        <div style={s.toast}>{toast}</div>
      )}

      {/* ── Bottom Nav ── */}
      <ELifeBottomNav active="me" t={t} onScan={() => showToast(t.scanHint)} router={router} />
    </div>
  )
}

// ─── Bottom Nav ───────────────────────────────────────────────────────────────

function ELifeBottomNav({
  active, t, onScan, router,
}: {
  active: 'home' | 'scan' | 'orders' | 'me'
  t: typeof T['zh']
  onScan: () => void
  router: ReturnType<typeof useRouter>
}) {
  const tabs = [
    { id: 'home',   label: t.navHome,   onClick: () => router.push('/e-life') },
    { id: 'scan',   label: t.navScan,   onClick: onScan },
    { id: 'orders', label: t.navOrders, onClick: () => router.push('/e-life/orders') },
    { id: 'me',     label: t.navMe,     onClick: () => {} },
  ]
  const icons: Record<string, React.ReactElement> = {
    home:   <HomeIcon />,
    scan:   <ScanIcon />,
    orders: <ClipboardIcon />,
    me:     <UserIcon />,
  }
  return (
    <nav style={s.nav}>
      <div style={s.navInner}>
        {tabs.map(tab => {
          const isActive = tab.id === active
          const color = isActive ? BRAND : '#6b7280'
          return (
            <button key={tab.id} style={s.navTab} onClick={tab.onClick}>
              <span style={{ color }}>{icons[tab.id]}</span>
              <span style={{ fontSize: 11, color, fontWeight: isActive ? 700 : 500 }}>{tab.label}</span>
            </button>
          )
        })}
      </div>
      <div style={{ height: 'env(safe-area-inset-bottom)' }} />
    </nav>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function ChevronLeftIcon() {
  return <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
}
function ChevronRightSmIcon() {
  return <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="2" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
}
function CheckIcon() {
  return <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
}
function HomeIcon() {
  return <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
}
function ScanIcon() {
  return <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 7V5a2 2 0 012-2h2"/><path d="M17 3h2a2 2 0 012 2v2"/><path d="M21 17v2a2 2 0 01-2 2h-2"/><path d="M7 21H5a2 2 0 01-2-2v-2"/><line x1="3" y1="12" x2="21" y2="12"/></svg>
}
function ClipboardIcon() {
  return <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
}
function UserIcon() {
  return <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100dvh',
    background: '#F0F0F0',
    maxWidth: 448,
    margin: '0 auto',
    paddingBottom: 80,
    position: 'relative',
  },

  header: {
    background: 'linear-gradient(to bottom, #EEFBF3, #ffffff)',
    padding: '12px 16px 10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottom: '1px solid rgba(0,0,0,0.05)',
    position: 'sticky' as const,
    top: 0,
    zIndex: 50,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: '50%',
    background: 'rgba(0,0,0,0.05)', border: 'none',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', color: '#333', flexShrink: 0,
  },
  headerTitle: { fontSize: 17, fontWeight: 700, color: '#111827', margin: 0 },

  body: { padding: '14px 14px' },

  noTgCard: {
    background: '#fff', borderRadius: 16, padding: '36px 24px',
    display: 'flex', flexDirection: 'column' as const,
    alignItems: 'center', gap: 8, marginBottom: 14,
  },

  // 用户信息卡（参考 /me 渐变卡样式）
  userCard: {
    display: 'flex', alignItems: 'center', gap: 14,
    background: `linear-gradient(135deg, rgba(7,193,96,0.85) 0%, rgba(4,150,74,0.9) 100%)`,
    borderRadius: 16, padding: '18px 18px',
    marginBottom: 14,
    boxShadow: `0 4px 16px rgba(7,193,96,0.22)`,
  },
  avatar: {
    width: 52, height: 52, borderRadius: '50%',
    background: 'rgba(255,255,255,0.25)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 22, fontWeight: 700, color: '#fff', flexShrink: 0,
  },
  userInfo: { flex: 1, minWidth: 0 },
  userName: {
    fontSize: 17, fontWeight: 700, color: '#fff', marginBottom: 2,
    overflow: 'hidden' as const, textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const,
  },
  userSub: {
    fontSize: 13, color: 'rgba(255,255,255,0.8)',
    overflow: 'hidden' as const, textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const,
  },
  userId: { fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 2 },

  // 功能入口列表（参考 /me 白卡列表样式）
  list: {
    background: '#fff', borderRadius: 14,
    overflow: 'hidden', marginBottom: 14,
  },
  listItem: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '13px 16px',
    borderBottom: '1px solid #f5f5f5',
    background: 'transparent', border: 'none',
    borderTop: 'none',
    width: '100%', cursor: 'pointer', textAlign: 'left' as const,
    fontSize: 14,
  },
  listIcon: { fontSize: 18, width: 24, textAlign: 'center' as const, flexShrink: 0 },
  listLabel: { flex: 1, fontSize: 14, fontWeight: 500, color: '#1a1a1a' },

  shopRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '7px 0',
    background: 'transparent', border: 'none',
    cursor: 'pointer', width: '100%',
    borderBottom: '1px solid #f5f5f5',
  },
  shopName: {
    fontSize: 13, color: '#374151', fontWeight: 500,
    overflow: 'hidden' as const, textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const,
    flex: 1, textAlign: 'left' as const,
  },

  toast: {
    position: 'fixed', bottom: 'calc(64px + env(safe-area-inset-bottom, 0px) + 12px)',
    left: '50%', transform: 'translateX(-50%)',
    background: 'rgba(0,0,0,0.72)', color: '#fff',
    fontSize: 13, padding: '9px 18px', borderRadius: 20,
    whiteSpace: 'nowrap' as const, zIndex: 200, pointerEvents: 'none' as const,
  },

  // 语言面板
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.2)', zIndex: 100 },
  sheet: {
    position: 'fixed', bottom: 0, left: 0, right: 0,
    background: '#fff', borderRadius: '16px 16px 0 0',
    zIndex: 101, padding: 20,
    paddingBottom: 'max(20px, env(safe-area-inset-bottom))',
  },
  sheetTitle: { fontSize: 14, fontWeight: 600, color: '#1a1a1a', textAlign: 'center' as const, margin: '0 0 16px' },
  langOpt: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    width: '100%', padding: 12, borderRadius: 12,
    background: 'rgba(0,0,0,0.03)', border: '1px solid transparent', cursor: 'pointer',
  },
  langOptActive: { background: `rgba(7,193,96,0.05)`, border: `1px solid rgba(7,193,96,0.2)` },
  langOptLabel: { fontSize: 14, fontWeight: 500, color: '#1a1a1a', margin: 0 },
  langOptSub:   { fontSize: 11, color: '#8c8c8c', margin: '1px 0 0' },

  // 底部导航
  nav: {
    position: 'fixed', bottom: 0, left: 0, right: 0,
    background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(16px)',
    borderTop: '1px solid rgba(0,0,0,0.06)', zIndex: 50,
  },
  navInner: {
    maxWidth: 448, margin: '0 auto',
    display: 'flex', alignItems: 'center', justifyContent: 'space-around',
    padding: '4px 16px',
  },
  navTab: {
    display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 2,
    padding: '6px 20px', background: 'transparent', border: 'none',
    borderRadius: 12, cursor: 'pointer',
  },
}
