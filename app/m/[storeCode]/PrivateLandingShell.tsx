'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useDocumentLang } from '@/app/components/useDocumentLang'

type Lang = 'zh' | 'en' | 'km'
type ErrorKind = 'missing' | 'inactive' | null

type Store = {
  code: string
  name: string
  bannerUrl: string | null
  announcement: string | null
  promoText: string | null
  businessType: string | null
  status: string
}

type Props = {
  storeCode: string
  store: Store | null
  initialLang: Lang
  errorKind: ErrorKind
  initialSource: string | null
  initialCampaign: string | null
}

const LANGS: Lang[] = ['zh', 'en', 'km']
const LS_KEY = 'menu_lang'
const VISITOR_ID_KEY = 'customer_landing_visitor_id'
const EVENT_PREFIX = 'customer_landing_event:'
const CUSTOMER_BOT = (process.env.NEXT_PUBLIC_CUSTOMER_BOT_USERNAME ?? '').replace(/^@/, '').trim()
const ENTRY_TITLE_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'

const copy: Record<Lang, {
  brand: string
  title: string
  landing: Record<'GENERAL' | 'FOOD' | 'RETAIL' | 'SERVICE', {
    subtitle: string
    orderNow: string
  }>
  myOrders: string
  coupons: string
  contact: string
  memberEntry: { title: string; subtitle: string; action: string }
  productEntry: { title: string; subtitle: string }
  open: string
  closed: string
  statusLabel: string
  typeLabel: string
  announcement: string
  promo: string
  businessType: Record<'GENERAL' | 'FOOD' | 'RETAIL' | 'SERVICE', string>
  errorTitle: string
  errorHint: string
  errorAction: string
}> = {
  zh: {
    brand: '店小二 · 商户私域',
    title: '欢迎来到',
    landing: {
      GENERAL: { subtitle: '在这里浏览商品并快速下单。', orderNow: '立即下单' },
      FOOD: { subtitle: '查看菜单，快速点餐。', orderNow: '查看菜单' },
      RETAIL: { subtitle: '浏览在售商品，快速选购。', orderNow: '浏览商品' },
      SERVICE: { subtitle: '了解服务内容，选择需要的项目。', orderNow: '查看服务' },
    },
    myOrders: '我的订单',
    coupons: '优惠券',
    contact: '联系商家',
    memberEntry: {
      title: '绑定 e-Life 会员',
      subtitle: '绑定后可享会员权益、积分与专属优惠',
      action: '立即绑定',
    },
    productEntry: {
      title: '进入商品列表',
      subtitle: '浏览全部商品，快速下单选购',
    },
    open: '营业中',
    closed: '暂停营业',
    statusLabel: '营业状态',
    typeLabel: '店铺类型',
    announcement: '公告',
    promo: '活动',
    businessType: {
      GENERAL: '通用商户',
      FOOD: '餐饮',
      RETAIL: '零售',
      SERVICE: '服务',
    },
    errorTitle: '链接不存在或已失效',
    errorHint: '请重新扫描商家提供的入口，或联系商家获取最新链接。',
    errorAction: '返回上一页',
  },
  en: {
    brand: '店小二 · Merchant Hub',
    title: 'Welcome to',
    landing: {
      GENERAL: { subtitle: 'Browse products and start ordering.', orderNow: 'Order Now' },
      FOOD: { subtitle: 'View the menu and order quickly.', orderNow: 'View Menu' },
      RETAIL: { subtitle: 'Browse available products and shop quickly.', orderNow: 'Browse Products' },
      SERVICE: { subtitle: 'Explore services and choose what you need.', orderNow: 'View Services' },
    },
    myOrders: 'My Orders',
    coupons: 'Coupons',
    contact: 'Contact Merchant',
    memberEntry: {
      title: 'Bind e-Life Membership',
      subtitle: 'Unlock member benefits, points, and exclusive offers',
      action: 'Bind Now',
    },
    productEntry: {
      title: 'Browse Products',
      subtitle: 'Browse all products and order quickly',
    },
    open: 'Open',
    closed: 'Closed',
    statusLabel: 'Status',
    typeLabel: 'Store Type',
    announcement: 'Announcement',
    promo: 'Promo',
    businessType: {
      GENERAL: 'General',
      FOOD: 'Food',
      RETAIL: 'Retail',
      SERVICE: 'Service',
    },
    errorTitle: 'Link not found or expired',
    errorHint: 'Please rescan the merchant entry or contact the merchant for the latest link.',
    errorAction: 'Go Back',
  },
  km: {
    brand: '店小二 · មជ្ឈមណ្ឌលហាង',
    title: 'ស្វាគមន៍មកកាន់',
    landing: {
      GENERAL: { subtitle: 'មើលទំនិញ និងចាប់ផ្តើមបញ្ជាទិញ។', orderNow: 'ចូលបញ្ជាទិញ' },
      FOOD: { subtitle: 'មើលម៉ឺនុយ ហើយបញ្ជាទិញបានរហ័ស។', orderNow: 'មើលម៉ឺនុយ' },
      RETAIL: { subtitle: 'រកមើលទំនិញដែលមាន និងទិញបានរហ័ស។', orderNow: 'រកមើលទំនិញ' },
      SERVICE: { subtitle: 'មើលសេវាកម្ម ហើយជ្រើសរើសអ្វីដែលអ្នកត្រូវការ។', orderNow: 'មើលសេវាកម្ម' },
    },
    myOrders: 'បញ្ជាទិញរបស់ខ្ញុំ',
    coupons: 'គូប៉ុង',
    contact: 'ទំនាក់ទំនងហាង',
    memberEntry: {
      title: 'ភ្ជាប់សមាជិក e-Life',
      subtitle: 'ទទួលបានអត្ថប្រយោជន៍ ពិន្ទុ និងការផ្តល់ជូនពិសេស',
      action: 'ភ្ជាប់ឥឡូវ',
    },
    productEntry: {
      title: 'ចូលមើលបញ្ជីទំនិញ',
      subtitle: 'មើលទំនិញទាំងអស់ និងបញ្ជាទិញបានលឿន',
    },
    open: 'កំពុងបើក',
    closed: 'បិទបណ្តោះអាសន្ន',
    statusLabel: 'ស្ថានភាព',
    typeLabel: 'ប្រភេទហាង',
    announcement: 'សេចក្តីប្រកាស',
    promo: 'ប្រូម៉ូសិន',
    businessType: {
      GENERAL: 'ទូទៅ',
      FOOD: 'អាហារ',
      RETAIL: 'លក់រាយ',
      SERVICE: 'សេវាកម្ម',
    },
    errorTitle: 'តំណភ្ជាប់មិនមាន ឬ​ផុតកំណត់',
    errorHint: 'សូមស្កេនតំណថ្មីពីហាង ឬទាក់ទងហាងដើម្បីទទួលបានតំណថ្មី។',
    errorAction: 'ត្រឡប់ក្រោយ',
  },
}

function normalizeLang(raw: string | null | undefined): Lang | null {
  const v = (raw ?? '').trim().toLowerCase()
  if (!v) return null
  if (v === 'zh' || v.startsWith('zh-') || v.startsWith('zh_')) return 'zh'
  if (v === 'en' || v.startsWith('en-') || v.startsWith('en_')) return 'en'
  if (v === 'km' || v.startsWith('km-') || v.startsWith('kh')) return 'km'
  return null
}

function detectBrowserLang(): Lang {
  if (typeof navigator === 'undefined') return 'zh'
  for (const lang of navigator.languages ?? []) {
    const normalized = normalizeLang(lang)
    if (normalized) return normalized
  }
  return normalizeLang(navigator.language) ?? 'zh'
}

function resolveType(type: string | null | undefined): keyof typeof copy.zh.businessType {
  const upper = (type ?? '').trim().toUpperCase()
  if (upper === 'FOOD' || upper === 'RETAIL' || upper === 'SERVICE' || upper === 'GENERAL') return upper
  return 'GENERAL'
}

function readOrCreateVisitorId(): string | null {
  try {
    const existing = localStorage.getItem(VISITOR_ID_KEY)
    if (existing && /^[a-zA-Z0-9_-]{8,80}$/.test(existing)) return existing
    const generated = `v_${crypto.randomUUID().replace(/-/g, '')}`
    localStorage.setItem(VISITOR_ID_KEY, generated)
    return generated
  } catch {
    return null
  }
}

function buildEventKey(eventType: string, storeCode: string, visitorId: string | null) {
  const today = new Date().toISOString().slice(0, 10)
  return `${eventType}:${storeCode}:${visitorId ?? 'anon'}:${today}`
}

export default function PrivateLandingShell({
  storeCode,
  store,
  initialLang,
  errorKind,
  initialSource,
  initialCampaign,
}: Props) {
  const [lang, setLang] = useState<Lang>(initialLang)
  const [visitorId, setVisitorId] = useState<string | null>(null)
  const [visitorReady, setVisitorReady] = useState(false)
  useDocumentLang(lang)

  const t = copy[lang]
  const businessType = useMemo(() => resolveType(store?.businessType), [store?.businessType])
  const landing = t.landing[businessType]
  const storeInitial = (store?.name?.trim()?.[0] ?? 'M').toUpperCase()
  const bannerStyle = store?.bannerUrl
    ? { backgroundImage: `url(${store.bannerUrl})` }
    : {}
  const statusText = store?.status === 'ACTIVE' ? t.open : t.closed
  const menuParams = new URLSearchParams()
  menuParams.set('code', storeCode)
  menuParams.set('from', 'landing')
  if (initialSource) menuParams.set('source', initialSource)
  if (initialCampaign) menuParams.set('campaign', initialCampaign)
  if (visitorId) menuParams.set('visitorId', visitorId)
  const menuHref = `/menu?${menuParams.toString()}`

  function recordEvent(eventType: 'landing_view' | 'landing_cta_click', keyOverride?: string) {
    if (!store) return
    const eventKey = keyOverride ?? buildEventKey(eventType, store.code, visitorId)
    try {
      const storageKey = `${EVENT_PREFIX}${eventKey}`
      if (sessionStorage.getItem(storageKey)) return
      sessionStorage.setItem(storageKey, '1')
    } catch {
      // sessionStorage is only a duplicate guard; event reporting may still proceed.
    }
    const body = JSON.stringify({
      eventType,
      storeCode: store.code,
      visitorId,
      source: initialSource,
      campaign: initialCampaign,
      referrer: document.referrer || null,
      language: lang,
      eventKey,
    })
    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'application/json' })
        if (navigator.sendBeacon('/api/public/landing-events', blob)) return
      }
      fetch('/api/public/landing-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {})
    } catch {
      // Non-blocking by design.
    }
  }

  function selectLang(next: Lang) {
    setLang(next)
    try {
      localStorage.setItem(LS_KEY, next)
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const fromUrl = normalizeLang(params.get('lang'))
      const fromSaved = normalizeLang(localStorage.getItem(LS_KEY))
      const next = fromUrl ?? fromSaved ?? detectBrowserLang()
      setLang(next)
      localStorage.setItem(LS_KEY, next)
    } catch {
      setLang(initialLang)
    }
  }, [initialLang])

  useEffect(() => {
    setVisitorId(readOrCreateVisitorId())
    setVisitorReady(true)
  }, [])

  useEffect(() => {
    if (!store || !visitorReady) return
    recordEvent('landing_view')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store?.code, visitorReady])

  if (errorKind || !store) {
    return (
      <main style={s.page}>
        <section style={s.errorCard}>
          <div style={s.errorBadge}>⚠️</div>
          <div style={s.errorTitle}>{t.errorTitle}</div>
          <div style={s.errorHint}>{t.errorHint}</div>
          <button type="button" style={s.errorBtn} onClick={() => window.history.back()}>
            {t.errorAction}
          </button>
        </section>
      </main>
    )
  }

  return (
    <main style={s.page}>
      <section style={s.shell}>
        <div style={s.topBar}>
          <div style={s.topMain}>
            <div style={s.brand}>{t.brand}</div>
            <h1 style={s.title}>{t.title} {store.name}</h1>
            <p style={s.subtitle}>{landing.subtitle}</p>
          </div>

          <div style={s.topSide}>
            <div style={s.langSwitcher} aria-label="language switcher">
              {(['zh', 'en', 'km'] as Lang[]).map((l) => (
                <button
                  key={l}
                  type="button"
                  style={{ ...s.langBtn, ...(lang === l ? s.langBtnOn : {}) }}
                  onClick={() => selectLang(l)}
                >
                  {l === 'zh' ? '中' : l === 'en' ? 'EN' : 'ខ្មែរ'}
                </button>
              ))}
            </div>

            <div style={s.metaRow}>
              <div style={{ ...s.metaPill, ...s.metaPillStatus }}>{statusText}</div>
              <div style={s.metaPill}>{t.businessType[businessType]}</div>
            </div>
          </div>
        </div>

        <section style={{ ...s.banner, ...bannerStyle }}>
          {!store.bannerUrl && <div style={s.bannerFallback}>{storeInitial}</div>}
          <div style={s.bannerMask} />
          <div style={s.bannerContent}>
            <div style={s.bannerLabel}>{store.name}</div>
            <div style={s.bannerName}>{store.name}</div>
            <div style={s.bannerMeta}>
              <span style={s.bannerBadge}>{statusText}</span>
              <span style={s.bannerBadge}>{t.businessType[businessType]}</span>
            </div>
          </div>
        </section>

        <div style={s.actions}>
          {CUSTOMER_BOT && (
            <Link
              href={`/me?code=${encodeURIComponent(storeCode)}`}
              style={s.memberEntryCard}
            >
              <span style={{ ...s.entryIcon, ...s.memberEntryIcon }} aria-hidden="true">
                <TelegramIcon />
              </span>
              <span style={s.entryBody}>
                <span style={s.entryTitle}>{t.memberEntry.title}</span>
                <span style={s.entrySubtitle}>{t.memberEntry.subtitle}</span>
              </span>
              <span style={s.memberEntryAction}>
                {t.memberEntry.action}
                <span style={s.memberEntryChevron}>›</span>
              </span>
            </Link>
          )}

          <Link
            href={menuHref}
            style={s.productEntryCard}
            onClick={() => recordEvent('landing_cta_click', `${buildEventKey('landing_cta_click', store.code, visitorId)}:${Date.now()}`)}
          >
            <span style={{ ...s.entryIcon, ...s.productEntryIcon }} aria-hidden="true">
              <ShoppingBagIcon />
            </span>
            <span style={s.entryBody}>
              <span style={s.entryTitle}>{t.productEntry.title}</span>
              <span style={s.entrySubtitle}>{t.productEntry.subtitle}</span>
            </span>
            <span style={s.productEntryArrow} aria-hidden="true">
              <ChevronRightIcon />
            </span>
          </Link>
        </div>

        <div style={s.quickGrid}>
          <Link href={`/menu/orders?code=${encodeURIComponent(storeCode)}`} style={s.quickCard}>
            <div style={s.quickIcon}>📦</div>
            <div style={s.quickLabel}>{t.myOrders}</div>
          </Link>
          <Link href={`/me/coupons?code=${encodeURIComponent(storeCode)}`} style={s.quickCard}>
            <div style={s.quickIcon}>🎟️</div>
            <div style={s.quickLabel}>{t.coupons}</div>
          </Link>
          <Link href={`/me?code=${encodeURIComponent(storeCode)}`} style={s.quickCard}>
            <div style={s.quickIcon}>💬</div>
            <div style={s.quickLabel}>{t.contact}</div>
          </Link>
        </div>

        {(store.announcement || store.promoText) && (
          <div style={s.infoGrid}>
            {store.announcement && (
              <section style={s.infoCard}>
                <div style={s.infoTitle}>{t.announcement}</div>
                <div style={s.infoText}>{store.announcement}</div>
              </section>
            )}
            {store.promoText && (
              <section style={s.infoCard}>
                <div style={s.infoTitle}>{t.promo}</div>
                <div style={s.infoText}>{store.promoText}</div>
              </section>
            )}
          </div>
        )}
      </section>
    </main>
  )
}

function TelegramIcon() {
  return (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21.45 3.35 18.3 19.12c-.24 1.11-.88 1.38-1.78.86l-4.8-3.54-2.32 2.23c-.25.26-.47.47-.96.47l.34-4.89 8.9-8.04c.39-.34-.08-.53-.6-.19L6.08 12.95 1.34 11.47c-1.03-.32-1.05-1.03.21-1.52L20.1 2.8c.86-.32 1.61.2 1.35.55Z"
        fill="currentColor"
      />
    </svg>
  )
}

function ShoppingBagIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5.4 8.4h13.2l.75 11.1H4.65L5.4 8.4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M8.5 9V6.9a3.5 3.5 0 0 1 7 0V9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m9 18 6-6-6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100dvh',
    background: 'radial-gradient(circle at top, #f8fbff 0%, #eef4ff 38%, #e9eef7 100%)',
    color: '#0f172a',
    width: '100%',
    maxWidth: 448,
    margin: '0 auto',
    overflowX: 'hidden',
    padding: '12px 12px 24px',
    boxSizing: 'border-box',
  },
  shell: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    boxSizing: 'border-box',
  },
  topBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    flexWrap: 'wrap',
  },
  topMain: {
    flex: '1 1 240px',
    minWidth: 0,
  },
  topSide: {
    flex: '0 0 auto',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 8,
    maxWidth: '100%',
  },
  brand: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: '#2563eb',
    marginBottom: 6,
  },
  title: {
    margin: 0,
    fontSize: 30,
    lineHeight: 1.15,
    fontWeight: 900,
    letterSpacing: 0,
  },
  subtitle: {
    margin: '8px 0 0',
    fontSize: 14,
    lineHeight: 1.6,
    color: '#475569',
    maxWidth: 620,
  },
  langSwitcher: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: 4,
    borderRadius: 999,
    background: 'rgba(255,255,255,0.68)',
    border: '1px solid rgba(148,163,184,0.18)',
    boxShadow: '0 4px 12px rgba(15,23,42,0.04)',
    backdropFilter: 'blur(10px)',
    flexWrap: 'wrap',
    maxWidth: '100%',
  },
  langBtn: {
    minHeight: 28,
    padding: '0 10px',
    borderRadius: 999,
    border: '1px solid transparent',
    background: 'transparent',
    color: '#475569',
    fontSize: 12,
    fontWeight: 800,
    cursor: 'pointer',
    lineHeight: 1,
    whiteSpace: 'nowrap',
  },
  langBtnOn: {
    background: 'linear-gradient(135deg, rgba(37,99,235,0.14), rgba(14,165,233,0.12))',
    color: '#1d4ed8',
    borderColor: 'rgba(37,99,235,0.18)',
  },
  metaRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'flex-end',
    maxWidth: '100%',
  },
  metaPill: {
    minHeight: 30,
    padding: '0 10px',
    borderRadius: 999,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1,
    color: '#334155',
    background: 'rgba(15, 23, 42, 0.04)',
    border: '1px solid rgba(15, 23, 42, 0.07)',
    maxWidth: '100%',
    whiteSpace: 'nowrap',
  },
  metaPillStatus: {
    background: 'rgba(37, 99, 235, 0.08)',
    border: '1px solid rgba(37, 99, 235, 0.14)',
    color: '#1d4ed8',
  },
  statusPill: {
    padding: '8px 12px',
    borderRadius: 999,
    background: 'rgba(37, 99, 235, 0.08)',
    border: '1px solid rgba(37, 99, 235, 0.16)',
    fontSize: 12,
    fontWeight: 700,
    color: '#1d4ed8',
  },
  typePill: {
    padding: '8px 12px',
    borderRadius: 999,
    background: 'rgba(15, 23, 42, 0.05)',
    border: '1px solid rgba(15, 23, 42, 0.08)',
    fontSize: 12,
    fontWeight: 700,
    color: '#334155',
  },
  banner: {
    position: 'relative',
    minHeight: 240,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#0f172a',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    boxShadow: '0 20px 50px rgba(15, 23, 42, 0.16)',
  },
  bannerFallback: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 120,
    fontWeight: 900,
    color: 'rgba(255,255,255,0.22)',
    letterSpacing: 6,
    background: 'linear-gradient(135deg, #0f172a 0%, #1d4ed8 52%, #0f766e 100%)',
  },
  bannerMask: {
    position: 'absolute',
    inset: 0,
    background: 'linear-gradient(180deg, rgba(15,23,42,0.10), rgba(15,23,42,0.72))',
  },
  bannerContent: {
    position: 'relative',
    zIndex: 1,
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-end',
    padding: 24,
    gap: 8,
    color: '#fff',
  },
  bannerLabel: {
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: 0.4,
    color: 'rgba(255,255,255,0.8)',
  },
  bannerName: {
    fontSize: 28,
    lineHeight: 1.2,
    fontWeight: 900,
    letterSpacing: 0,
    textShadow: '0 2px 10px rgba(0,0,0,0.25)',
  },
  bannerMeta: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  bannerBadge: {
    padding: '5px 9px',
    borderRadius: 999,
    background: 'rgba(255,255,255,0.16)',
    border: '1px solid rgba(255,255,255,0.22)',
    fontSize: 11,
    fontWeight: 700,
    color: '#fff',
  },
  actions: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  memberEntryCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    minHeight: 80,
    padding: '14px 14px',
    borderRadius: 20,
    background: 'linear-gradient(135deg, #d7ebff 0%, #c8e2fb 100%)',
    border: '1px solid rgba(0, 136, 204, 0.18)',
    boxShadow: '0 10px 24px rgba(37, 99, 235, 0.10)',
    textDecoration: 'none',
    color: '#0f2742',
    boxSizing: 'border-box',
  },
  productEntryCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    minHeight: 80,
    padding: '14px 14px',
    borderRadius: 20,
    background: 'linear-gradient(135deg, #edf6ff 0%, #e1efff 100%)',
    border: '1px solid rgba(37, 99, 235, 0.13)',
    boxShadow: '0 8px 20px rgba(37, 99, 235, 0.08)',
    textDecoration: 'none',
    color: '#0f2742',
    boxSizing: 'border-box',
  },
  entryIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    display: 'grid',
    placeItems: 'center',
    flexShrink: 0,
    background: 'rgba(255, 255, 255, 0.72)',
    boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.78)',
  },
  memberEntryIcon: {
    color: '#1684d6',
  },
  productEntryIcon: {
    color: '#2563eb',
  },
  entryBody: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  entryTitle: {
    fontFamily: ENTRY_TITLE_FONT,
    fontSize: 16,
    fontWeight: 700,
    lineHeight: 1.25,
    letterSpacing: '-0.2px',
    color: '#102a43',
  },
  entrySubtitle: {
    fontSize: 12,
    fontWeight: 400,
    lineHeight: 1.45,
    color: '#526b82',
  },
  memberEntryAction: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
    flexShrink: 0,
    color: '#0878c9',
    fontSize: 12,
    fontWeight: 700,
    whiteSpace: 'nowrap',
  },
  memberEntryChevron: {
    fontSize: 20,
    lineHeight: 1,
  },
  productEntryArrow: {
    width: 34,
    height: 34,
    borderRadius: '50%',
    display: 'grid',
    placeItems: 'center',
    flexShrink: 0,
    color: '#fff',
    background: '#3b82f6',
    boxShadow: '0 5px 12px rgba(37, 99, 235, 0.22)',
  },
  quickGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 12,
  },
  quickCard: {
    minHeight: 88,
    borderRadius: 18,
    background: '#fff',
    border: '1px solid rgba(148,163,184,0.24)',
    boxShadow: '0 10px 24px rgba(15,23,42,0.06)',
    textDecoration: 'none',
    color: '#0f172a',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '12px 10px',
  },
  quickIcon: {
    fontSize: 24,
    lineHeight: 1,
  },
  quickLabel: {
    fontSize: 13,
    fontWeight: 800,
    textAlign: 'center',
  },
  infoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: 12,
  },
  infoCard: {
    borderRadius: 18,
    background: '#fff',
    border: '1px solid rgba(148,163,184,0.22)',
    boxShadow: '0 8px 20px rgba(15,23,42,0.05)',
    padding: 16,
  },
  infoTitle: {
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 0.4,
    color: '#2563eb',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  infoText: {
    fontSize: 14,
    lineHeight: 1.7,
    color: '#334155',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  errorCard: {
    minHeight: 'calc(100dvh - 56px)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    textAlign: 'center',
    width: 'min(100%, 520px)',
    margin: '0 auto',
    background: '#fff',
    borderRadius: 24,
    border: '1px solid rgba(148,163,184,0.22)',
    boxShadow: '0 18px 44px rgba(15,23,42,0.08)',
    padding: 28,
    boxSizing: 'border-box',
  },
  errorBadge: {
    width: 64,
    height: 64,
    borderRadius: '50%',
    display: 'grid',
    placeItems: 'center',
    fontSize: 28,
    background: 'rgba(239, 68, 68, 0.08)',
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: 900,
    lineHeight: 1.2,
    color: '#111827',
  },
  errorHint: {
    fontSize: 14,
    lineHeight: 1.7,
    color: '#64748b',
    maxWidth: 360,
  },
  errorBtn: {
    minHeight: 46,
    padding: '0 18px',
    borderRadius: 14,
    border: '1px solid rgba(37,99,235,0.18)',
    background: '#2563eb',
    color: '#fff',
    fontSize: 14,
    fontWeight: 800,
    cursor: 'pointer',
  },
}
