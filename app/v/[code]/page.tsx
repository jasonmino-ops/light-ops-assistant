'use client'

import { useEffect, useState, Suspense, CSSProperties } from 'react'
import { useParams, useSearchParams } from 'next/navigation'

const BOT    = (process.env.NEXT_PUBLIC_CUSTOMER_BOT_USERNAME ?? '').replace(/^@/, '').trim()
const LS_KEY = 'eLife_lang'

type Lang = 'zh' | 'en' | 'km'

const I18N: Record<Lang, {
  orderNow:     string
  viewMenu:     string
  telegram:     string
  recommendedBy:string   // contains {name}
  videoTitle:   string   // contains {title}
  poweredBy:    string
  notFound:     string
  notFoundHint: string
  loading:      string
}> = {
  zh: {
    orderNow:     '立即下单',
    viewMenu:     '查看菜单',
    telegram:     '💬 打开 Telegram 客服',
    recommendedBy:'来自 @{name} 的视频推荐',
    videoTitle:   '「{title}」',
    poweredBy:    '由店小二 · E-Life 驱动',
    notFound:     '链接不存在或已失效',
    notFoundHint: '请联系商家获取最新下单入口',
    loading:      '加载中…',
  },
  en: {
    orderNow:     'Order Now',
    viewMenu:     'View Menu',
    telegram:     '💬 Telegram Support',
    recommendedBy:'Recommended by @{name}',
    videoTitle:   '"{title}"',
    poweredBy:    'Powered by 店小二 · E-Life',
    notFound:     'Link not found or expired',
    notFoundHint: 'Please contact the shop for the latest link',
    loading:      'Loading…',
  },
  km: {
    orderNow:     'ចូលបញ្ជាទិញ',
    viewMenu:     'មើលម៉ឺនុយ',
    telegram:     '💬 Telegram',
    recommendedBy:'ណែនាំដោយ @{name}',
    videoTitle:   '「{title}」',
    poweredBy:    'ដំណើរការដោយ 店小二 · E-Life',
    notFound:     'តំណភ្ជាប់មិនមាន ឬ​ផុតកំណត់',
    notFoundHint: 'សូមទំនាក់ទំនងហាងដើម្បីទទួលបានតំណភ្ជាប់ថ្មី',
    loading:      'កំពុងផ្ទុក…',
  },
}

const LANG_LABELS: Record<Lang, string> = { zh: '中', en: 'EN', km: 'ខ្មែរ' }
const LANGS: Lang[] = ['zh', 'en', 'km']

function detectLang(urlLang: string | null): Lang {
  if (urlLang && LANGS.includes(urlLang as Lang)) return urlLang as Lang
  try {
    const saved = localStorage.getItem(LS_KEY)
    if (saved && LANGS.includes(saved as Lang)) return saved as Lang
  } catch { /* ssr */ }
  const nav = navigator.language?.slice(0, 2).toLowerCase()
  if (nav === 'km' || nav === 'kh') return 'km'
  if (nav === 'en') return 'en'
  return 'zh'
}

type LinkData = {
  storeCode:    string
  storeName:    string
  bannerUrl:    string | null
  announcement: string | null
  creatorName:  string | null
  videoTitle:   string | null
}

// ── Inner (uses useSearchParams — must be inside <Suspense>) ─────────────────

function LandingInner() {
  const { code }        = useParams<{ code: string }>()
  const searchParams    = useSearchParams()
  const [data, setData] = useState<LinkData | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [lang, setLang] = useState<Lang>('zh')

  // language init (client-only)
  useEffect(() => {
    setLang(detectLang(searchParams.get('lang')))
  }, [searchParams])

  useEffect(() => {
    fetch(`/api/v/${code}`)
      .then((r) => {
        if (r.status === 404) { setNotFound(true); return null }
        return r.json()
      })
      .then((d) => { if (d) setData(d) })
      .catch(() => setNotFound(true))
  }, [code])

  function switchLang(l: Lang) {
    setLang(l)
    try { localStorage.setItem(LS_KEY, l) } catch { /* ssr */ }
  }

  function t(key: keyof typeof I18N['zh']): string {
    return I18N[lang][key]
  }

  function handleIntent(intent: 'order' | 'menu') {
    fetch(`/api/v/${code}/click`, { method: 'POST' }).catch(() => {})
    window.location.href = `/m/${data?.storeCode ?? ''}?ref=${encodeURIComponent(code)}&intent=${intent}`
  }

  function handleTelegram() {
    const url = BOT
      ? `https://t.me/${BOT}?start=${data?.storeCode ?? ''}`
      : 'https://t.me/'
    window.open(url, '_blank')
  }

  function langBtn(active: boolean): CSSProperties {
    return {
      padding: '3px 8px',
      fontSize: 11,
      fontWeight: 600,
      borderRadius: 12,
      border: '1px solid',
      cursor: 'pointer',
      background:   active ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.55)',
      color:        active ? '#07c160' : 'rgba(255,255,255,0.85)',
      borderColor:  active ? '#07c160' : 'rgba(255,255,255,0.4)',
      backdropFilter: 'blur(4px)',
    }
  }

  function langBtnOnDark(active: boolean): CSSProperties {
    return {
      padding: '3px 8px',
      fontSize: 11,
      fontWeight: 600,
      borderRadius: 12,
      border: '1px solid',
      cursor: 'pointer',
      background:  active ? '#07c160' : '#f3f4f6',
      color:       active ? '#fff'    : '#6b7280',
      borderColor: active ? '#07c160' : '#e5e7eb',
    }
  }

  const s: Record<string, CSSProperties> = {
    wrap: {
      minHeight: '100dvh',
      background: '#f9fafb',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '24px 20px 48px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans Khmer", sans-serif',
    },
    card: {
      background: '#fff',
      borderRadius: 16,
      width: '100%',
      maxWidth: 420,
      boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
      overflow: 'hidden',
      position: 'relative' as const,
    },
    langBar: {
      position: 'absolute' as const,
      top: 10,
      right: 10,
      display: 'flex',
      gap: 4,
      zIndex: 10,
    },
    banner: { width: '100%', height: 160, objectFit: 'cover' as const },
    bannerPlaceholder: {
      width: '100%', height: 160,
      background: 'linear-gradient(135deg,#07c160,#00b4d8)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40,
    },
    body: { padding: '20px 20px 24px' },
    storeName: { fontSize: 22, fontWeight: 700, color: '#111827', margin: '0 0 8px' },
    subline: { fontSize: 13, color: '#6b7280', margin: '0 0 4px' },
    announcement: {
      fontSize: 13, color: '#374151', background: '#f3f4f6',
      borderRadius: 8, padding: '8px 12px', margin: '12px 0 0',
    },
    divider: { height: 1, background: '#f0f0f0', margin: '18px 0' },
    btnPrimary: {
      display: 'block', width: '100%', padding: '14px',
      background: '#07c160', color: '#fff', border: 'none',
      borderRadius: 10, fontSize: 16, fontWeight: 600, cursor: 'pointer', marginBottom: 10,
    },
    btnSecondary: {
      display: 'block', width: '100%', padding: '13px',
      background: '#fff', color: '#07c160', border: '1.5px solid #07c160',
      borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: 'pointer', marginBottom: 10,
    },
    btnTelegram: {
      display: 'block', width: '100%', padding: '10px',
      background: '#fff', color: '#6b9dc8', border: '1px solid #c8d8e8',
      borderRadius: 10, fontSize: 13, fontWeight: 500, cursor: 'pointer',
    },
    errorWrap: { marginTop: 80, textAlign: 'center' as const, color: '#9ca3af' },
    loader:    { marginTop: 80, textAlign: 'center' as const, color: '#9ca3af', fontSize: 14 },
    poweredBy: { marginTop: 28, fontSize: 11, color: '#d1d5db', textAlign: 'center' as const },
  }

  // ── error / loading ──────────────────────────────────────────────────────

  if (notFound) {
    return (
      <div style={s.wrap}>
        <div style={s.errorWrap}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔗</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#374151', marginBottom: 8 }}>
            {t('notFound')}
          </div>
          <div style={{ fontSize: 13 }}>{t('notFoundHint')}</div>
          {/* minimal lang switcher on error page */}
          <div style={{ marginTop: 24, display: 'flex', gap: 6, justifyContent: 'center' }}>
            {LANGS.map((l) => (
              <button key={l} style={langBtnOnDark(l === lang)} onClick={() => switchLang(l)}>
                {LANG_LABELS[l]}
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div style={s.wrap}>
        <div style={s.loader}>{I18N[lang].loading}</div>
      </div>
    )
  }

  // ── has banner: lang buttons overlay on banner; no banner: show below card top ──
  const hasBanner = !!data.bannerUrl

  return (
    <div style={s.wrap}>
      <div style={s.card}>
        {/* lang switcher */}
        {hasBanner ? (
          <div style={s.langBar}>
            {LANGS.map((l) => (
              <button key={l} style={langBtn(l === lang)} onClick={() => switchLang(l)}>
                {LANG_LABELS[l]}
              </button>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 12px 0' }}>
            {LANGS.map((l) => (
              <button key={l} style={{ ...langBtnOnDark(l === lang), marginLeft: 4 }} onClick={() => switchLang(l)}>
                {LANG_LABELS[l]}
              </button>
            ))}
          </div>
        )}

        {data.bannerUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.bannerUrl} alt={data.storeName} style={s.banner} />
        ) : (
          <div style={s.bannerPlaceholder}>🛍️</div>
        )}

        <div style={s.body}>
          <h1 style={s.storeName}>{data.storeName}</h1>

          {data.creatorName && (
            <p style={s.subline}>
              {t('recommendedBy').replace('{name}', data.creatorName)}
            </p>
          )}
          {data.videoTitle && (
            <p style={s.subline}>
              {t('videoTitle').replace('{title}', data.videoTitle)}
            </p>
          )}
          {data.announcement && (
            <div style={s.announcement}>{data.announcement}</div>
          )}

          <div style={s.divider} />

          {/* Primary CTA */}
          <button style={s.btnPrimary} onClick={() => handleIntent('order')}>
            {t('orderNow')}
          </button>

          {/* Secondary CTA */}
          <button style={s.btnSecondary} onClick={() => handleIntent('menu')}>
            {t('viewMenu')}
          </button>

          {/* Auxiliary — only when BOT configured */}
          {BOT && (
            <button style={s.btnTelegram} onClick={handleTelegram}>
              {t('telegram')}
            </button>
          )}
        </div>
      </div>

      <div style={s.poweredBy}>{t('poweredBy')}</div>
    </div>
  )
}

// ── Outer with Suspense (required for useSearchParams in Next.js 15) ─────────

export default function CampaignLandingPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 14 }}>
        加载中…
      </div>
    }>
      <LandingInner />
    </Suspense>
  )
}
