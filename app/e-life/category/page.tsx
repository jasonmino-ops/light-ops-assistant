'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

const BRAND = '#07c160'

type Lang = 'zh' | 'en' | 'km'

type StoreItem = {
  storeCode: string
  storeName: string
  businessType: string
  bannerUrl: string | null
}

// ─── Translations ─────────────────────────────────────────────────────────────

const T = {
  zh: {
    back: '首页', sub: '发现相关好店', merchant: 'E-Life 商户',
    empty: '暂无相关商户，敬请期待', emptyBtn: '返回首页', loading: '加载中…',
  },
  en: {
    back: 'Home', sub: 'Discover related shops', merchant: 'E-Life Store',
    empty: 'No shops available yet', emptyBtn: 'Go Home', loading: 'Loading…',
  },
  km: {
    back: 'ទំព័រដើម', sub: 'រកឃើញហាងពាក់ព័ន្ធ', merchant: 'ហាង E-Life',
    empty: 'មិនទាន់មានហាងទេ', emptyBtn: 'ត្រឡប់ទៅដើម', loading: 'កំពុងផ្ទុក…',
  },
}

// ─── Category metadata ────────────────────────────────────────────────────────

const CATEGORY_META: Record<string, { names: Record<Lang, string>; color: string }> = {
  food:          { names: { zh: '美食餐饮', en: 'Food & Drink',  km: 'អាហារ'    }, color: 'rgba(249,115,22,0.8)' },
  retail:        { names: { zh: '零售超市', en: 'Grocery',       km: 'ហាងលក់'   }, color: 'rgba(16,185,129,0.8)' },
  cafe:          { names: { zh: '咖啡饮品', en: 'Coffee',        km: 'កាហ្វេ'   }, color: 'rgba(245,158,11,0.8)' },
  service:       { names: { zh: '生活服务', en: 'Services',      km: 'សេវាកម្ម' }, color: 'rgba(59,130,246,0.8)' },
  entertainment: { names: { zh: '休闲娱乐', en: 'Leisure',       km: 'កម្សាន្ត' }, color: 'rgba(236,72,153,0.8)' },
  health:        { names: { zh: '医疗健康', en: 'Health',        km: 'សុខភាព'   }, color: 'rgba(248,113,113,0.8)' },
  auto:          { names: { zh: '汽车服务', en: 'Auto',          km: 'រថយន្ត'   }, color: 'rgba(100,116,139,0.8)' },
  kids:          { names: { zh: '亲子教育', en: 'Education',     km: 'អប់រំ'    }, color: 'rgba(99,102,241,0.8)' },
}

const BIZ_LABEL: Record<string, Record<Lang, string>> = {
  FOOD:    { zh: '美食餐饮', en: 'Food & Drink', km: 'អាហារ'    },
  RETAIL:  { zh: '零售购物', en: 'Retail',       km: 'ហាងលក់'   },
  SERVICE: { zh: '生活服务', en: 'Services',      km: 'សេវាកម្ម' },
  GENERAL: { zh: '综合商户', en: 'General',       km: 'ទូទៅ'     },
}

const FALLBACK_IMAGES = [
  'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=200&h=200&fit=crop',
  'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=200&h=200&fit=crop',
  'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=200&h=200&fit=crop',
]

// ─── Inner (uses useSearchParams) ─────────────────────────────────────────────

function CategoryPageInner() {
  const router = useRouter()
  const params = useSearchParams()
  const type = params.get('type') ?? 'food'

  const [lang, setLang]     = useState<Lang>('zh')
  const [stores, setStores] = useState<StoreItem[] | null>(null)

  useEffect(() => {
    try {
      const saved = localStorage.getItem('eLife_lang') as Lang | null
      if (saved && (['zh', 'en', 'km'] as string[]).includes(saved)) setLang(saved)
    } catch { /* ignore */ }

    fetch(`/api/e-life/stores-by-category?type=${encodeURIComponent(type)}`)
      .then((r) => r.json())
      .then((body) => {
        if (Array.isArray(body.stores)) {
          setStores(body.stores as StoreItem[])
        } else {
          setStores([])
        }
      })
      .catch(() => setStores([]))
  }, [type])

  const t    = T[lang]
  const meta = CATEGORY_META[type] ?? CATEGORY_META['food']
  const catName = meta.names[lang]

  function goStore(code: string) {
    router.push(`/menu?code=${encodeURIComponent(code)}&from=e-life-category`)
  }

  return (
    <div style={{ minHeight: '100dvh', background: '#F7F8FA', maxWidth: 448, margin: '0 auto' }}>

      {/* ── Header ── */}
      <header style={{ position: 'sticky', top: 0, zIndex: 50, background: '#fff', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
        <div style={{ padding: '10px 16px 12px', maxWidth: 448, margin: '0 auto' }}>
          <button
            onClick={() => router.push('/e-life')}
            style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', marginBottom: 8 }}
          >
            <ChevronLeftIcon />
            <span style={{ fontSize: 13, color: '#6b7280' }}>{t.back}</span>
          </button>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: '0 0 2px' }}>{catName}</h1>
          <p style={{ fontSize: 12, color: '#9ca3af', margin: 0 }}>{t.sub}</p>
        </div>
      </header>

      {/* ── Content ── */}
      <main style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>

        {/* Loading */}
        {stores === null && (
          <div style={{ textAlign: 'center', padding: '48px 0', color: '#9ca3af', fontSize: 14 }}>
            {t.loading}
          </div>
        )}

        {/* Empty state */}
        {stores !== null && stores.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '64px 24px', gap: 16 }}>
            <div style={{ width: 64, height: 64, borderRadius: 16, background: `rgba(7,193,96,0.08)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <StoreIcon />
            </div>
            <p style={{ fontSize: 15, color: '#6b7280', margin: 0, textAlign: 'center' }}>{t.empty}</p>
            <button
              onClick={() => router.push('/e-life')}
              style={{ padding: '10px 24px', background: BRAND, color: '#fff', border: 'none', borderRadius: 9999, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
            >
              {t.emptyBtn}
            </button>
          </div>
        )}

        {/* Store list */}
        {stores !== null && stores.length > 0 && stores.map((shop, idx) => (
          <div
            key={shop.storeCode}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: '#fff', borderRadius: 14, border: '1px solid rgba(0,0,0,0.06)', cursor: 'pointer', minHeight: 88 }}
            onClick={() => goStore(shop.storeCode)}
          >
            {/* Cover image */}
            <div style={{ width: 80, height: 80, borderRadius: 10, overflow: 'hidden', flexShrink: 0 }}>
              <img
                src={shop.bannerUrl ?? FALLBACK_IMAGES[idx % FALLBACK_IMAGES.length]}
                alt={shop.storeName}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            </div>
            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: '#111827', margin: '0 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {shop.storeName}
              </h3>
              <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 6px' }}>
                {BIZ_LABEL[shop.businessType]?.[lang] ?? shop.businessType}
              </p>
              <span style={{ display: 'inline-block', fontSize: 11, color: BRAND, background: 'rgba(7,193,96,0.08)', padding: '2px 8px', borderRadius: 4, fontWeight: 500 }}>
                {t.merchant}
              </span>
            </div>
            {/* Arrow */}
            <ChevronRightIcon />
          </div>
        ))}

      </main>
    </div>
  )
}

// ─── Page (Suspense wrapper required for useSearchParams) ─────────────────────

export default function CategoryPage() {
  return (
    <Suspense fallback={null}>
      <CategoryPageInner />
    </Suspense>
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

function ChevronRightIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="rgba(0,0,0,0.2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  )
}

function StoreIcon() {
  return (
    <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l1-6h16l1 6"/><path d="M3 9h18v11a1 1 0 01-1 1H4a1 1 0 01-1-1z"/>
      <path d="M9 9v11M15 9v11"/>
    </svg>
  )
}
