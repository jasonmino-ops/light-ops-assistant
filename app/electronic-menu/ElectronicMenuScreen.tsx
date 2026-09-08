'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  groupElectronicMenu,
  MENU_REFRESH_MS,
  menuProductDescription,
  menuProductName,
  type ElectronicMenuData,
  type ElectronicMenuProduct,
  type MenuLang,
} from '@/lib/electronic-menu'
import { formatMoney } from '@/lib/currency'
import { shouldShowRecommendationBadge } from '@/lib/product-recommendation'
import styles from './electronic-menu.module.css'

const PAGE_MS = 12_000
const REQUEST_TIMEOUT_MS = 10_000
const LANGUAGES: { lang: MenuLang; label: string }[] = [
  { lang: 'zh', label: '中文' }, { lang: 'en', label: 'EN' }, { lang: 'km', label: 'ខ្មែរ' },
]
const COPY = {
  zh: {
    menu: '电子菜单', today: '今日菜单', loading: '正在准备菜单', loadingHint: '美味，即将呈现。',
    invalid: '菜单链接无效', invalidHint: '请使用商家提供的完整菜单链接。',
    unavailable: '菜单暂不可用', unavailableHint: '门店暂未开放，请稍后再看。',
    failed: '暂时无法加载菜单', failedHint: '正在自动重试，请检查网络连接。',
    empty: '菜单准备中', emptyHint: '新鲜美味，敬请期待。',
    offline: '网络已断开', stale: '更新暂不可用 · 当前显示上次菜单',
    retry: '重新加载', live: '菜单已更新', refreshing: '正在更新菜单',
    recommended: '推荐', page: '页', language: '菜单语言', noImage: '美味待呈现',
  },
  en: {
    menu: 'DIGITAL MENU', today: 'On the menu', loading: 'Preparing the menu', loadingHint: 'Something delicious is on its way.',
    invalid: 'Invalid menu link', invalidHint: 'Please use the complete menu link from the store.',
    unavailable: 'Menu unavailable', unavailableHint: 'This store is currently unavailable. Please check back later.',
    failed: 'Unable to load the menu', failedHint: 'Retrying automatically. Please check the connection.',
    empty: 'Coming to the menu', emptyHint: 'Fresh favourites are on their way.',
    offline: 'Connection lost', stale: 'Update unavailable · Showing the last menu',
    retry: 'Try again', live: 'Menu up to date', refreshing: 'Updating menu',
    recommended: 'Recommended', page: 'Page', language: 'Menu language', noImage: 'Made to enjoy',
  },
  km: {
    menu: 'ម៉ឺនុយឌីជីថល', today: 'ម៉ឺនុយថ្ងៃនេះ', loading: 'កំពុងរៀបចំម៉ឺនុយ', loadingHint: 'ម្ហូបឆ្ងាញ់ៗនឹងមកដល់ឆាប់ៗ។',
    invalid: 'តំណម៉ឺនុយមិនត្រឹមត្រូវ', invalidHint: 'សូមប្រើតំណម៉ឺនុយពេញលេញពីហាង។',
    unavailable: 'ម៉ឺនុយមិនទាន់មាន', unavailableHint: 'ហាងមិនទាន់បើកទេ។ សូមពិនិត្យម្តងទៀតនៅពេលក្រោយ។',
    failed: 'មិនអាចផ្ទុកម៉ឺនុយបាន', failedHint: 'កំពុងព្យាយាមម្តងទៀត។ សូមពិនិត្យការតភ្ជាប់អ៊ីនធឺណិត។',
    empty: 'កំពុងរៀបចំម៉ឺនុយ', emptyHint: 'ម្ហូបឆ្ងាញ់ៗនឹងមានឆាប់ៗនេះ។',
    offline: 'បាត់ការតភ្ជាប់', stale: 'មិនអាចធ្វើបច្ចុប្បន្នភាព · កំពុងបង្ហាញម៉ឺនុយចុងក្រោយ',
    retry: 'សាកល្បងម្តងទៀត', live: 'ម៉ឺនុយបានធ្វើបច្ចុប្បន្នភាព', refreshing: 'កំពុងធ្វើបច្ចុប្បន្នភាព',
    recommended: 'ណែនាំ', page: 'ទំព័រ', language: 'ភាសាម៉ឺនុយ', noImage: 'រសជាតិឆ្ងាញ់',
  },
}

type LoadError = 'invalid' | 'unavailable' | 'refresh' | 'offline' | null
type CatalogItem = { product: ElectronicMenuProduct; category: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nullableText(value: unknown) {
  return value === null || typeof value === 'string'
}

// A malformed response is a refresh failure, never an unchecked render error.
function isCatalog(value: unknown, code: string): value is ElectronicMenuData {
  if (!isRecord(value) || !isRecord(value.store)
    || !Array.isArray(value.products) || !Array.isArray(value.categories)) return false
  const { store, products, categories } = value
  if (store.code !== code || typeof store.name !== 'string' || typeof store.currencyCode !== 'string'
    || !['announcement', 'promoText', 'bannerUrl'].every((key) => nullableText(store[key]))) return false

  return products.every((product) => isRecord(product)
    && typeof product.id === 'string' && typeof product.name === 'string'
    && ['nameZh', 'nameEn', 'nameKm', 'descZh', 'descEn', 'descKm', 'spec', 'categoryId', 'imageUrl'].every((key) => nullableText(product[key]))
    && typeof product.price === 'number' && Number.isFinite(product.price)
    && typeof product.originalPrice === 'number' && Number.isFinite(product.originalPrice)
    && typeof product.discountEnabled === 'boolean' && typeof product.isRecommended === 'boolean'
    && Array.isArray(product.imageUrls) && product.imageUrls.every((url) => typeof url === 'string'))
    && categories.every((category) => isRecord(category)
      && typeof category.id === 'string' && typeof category.name === 'string'
      && nullableText(category.parentId) && typeof category.sortOrder === 'number')
}

function itemsPerPage(width: number, height: number) {
  const columns = width >= 1600 ? 4 : width >= 1100 ? 3 : width >= 680 ? 2 : 1
  // Small 16:9 browser windows still need room for two-line names and prices.
  const rows = width >= 680 && height < 650 ? 1 : 2
  return columns * rows
}

function isOffline() {
  return navigator.onLine === false
}

function MenuMark({ decorative = false }: { decorative?: boolean }) {
  return (
    <svg width="36" height="36" viewBox="0 0 40 40" fill="none" aria-hidden={decorative}>
      <path d="M8 28h24M11 25a9 9 0 0 1 18 0H11ZM20 12v3M17 12h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M12 32h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function ProductCard({ item, lang, currency }: { item: CatalogItem; lang: MenuLang; currency: string }) {
  const { product, category } = item
  const name = menuProductName(product, lang)
  const description = [product.spec, menuProductDescription(product, lang)].filter(Boolean).join(' · ')
  const source = product.imageUrls[0] || product.imageUrl || null
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const showImage = source && source !== failedSource

  // A fresh catalog response retries a transient image failure, even when the
  // stored URL is unchanged and this single-page card never unmounts.
  useEffect(() => { setFailedSource(null) }, [product])

  return (
    <article className={styles.productCard} data-product-id={product.id} data-testid="menu-product-card">
      <div className={styles.productVisual}>
        {showImage ? (
          // Preserve existing product image/GIF behavior without new media services.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={source} alt={name} className={styles.productImage} referrerPolicy="no-referrer" onError={() => setFailedSource(source)} />
        ) : (
          <div className={styles.imagePlaceholder} aria-label={COPY[lang].noImage}>
            <MenuMark decorative />
            <span>{COPY[lang].noImage}</span>
          </div>
        )}
        <span className={styles.categoryTag}>{category}</span>
        {shouldShowRecommendationBadge(product) && <span className={styles.recommendation}>{COPY[lang].recommended}</span>}
      </div>
      <div className={styles.productInfo}>
        <h3 className={styles.productName} title={name} data-testid="menu-product-name">{name}</h3>
        {description && <p className={styles.productDescription} title={description}>{description}</p>}
        <div className={styles.priceRow}>
          <strong className={styles.price} data-testid="menu-product-price">{formatMoney(product.price, currency)}</strong>
          {product.discountEnabled && product.price < product.originalPrice && (
            <del className={styles.originalPrice}>{formatMoney(product.originalPrice, currency)}</del>
          )}
        </div>
      </div>
    </article>
  )
}

export default function ElectronicMenuScreen({ code, initialLang }: { code: string | null; initialLang: MenuLang }) {
  const [lang, setLang] = useState<MenuLang>(initialLang)
  const [data, setData] = useState<ElectronicMenuData | null>(null)
  const [error, setError] = useState<LoadError>(code ? null : 'invalid')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [retry, setRetry] = useState(0)
  const [pageSize, setPageSize] = useState(8)
  const [pageIndex, setPageIndex] = useState(0)
  const copy = COPY[lang]

  useEffect(() => {
    const previous = document.documentElement.lang
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang
    return () => { document.documentElement.lang = previous }
  }, [lang])

  useEffect(() => {
    const resize = () => setPageSize(itemsPerPage(window.innerWidth, window.innerHeight))
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  useEffect(() => {
    if (!code) return
    const storeCode = code
    let active = true
    let busy = false
    let controller: AbortController | null = null
    let timeout: ReturnType<typeof setTimeout> | undefined

    async function refresh() {
      if (!active || busy || document.hidden) return
      if (isOffline()) { setError('offline'); return }
      busy = true
      setRefreshing(true)
      controller = new AbortController()
      timeout = setTimeout(() => controller?.abort(), REQUEST_TIMEOUT_MS)
      try {
        const response = await fetch(`/api/public/electronic-menu?code=${encodeURIComponent(storeCode)}`, {
          cache: 'no-store', credentials: 'omit', signal: controller.signal,
        })
        if (!active) return
        if (response.status === 400 || response.status === 404) {
          setData(null)
          setUpdatedAt(null)
          setError(response.status === 400 ? 'invalid' : 'unavailable')
          return
        }
        if (!response.ok) throw new Error('MENU_UNAVAILABLE')
        const body: unknown = await response.json()
        if (!active) return
        if (!isCatalog(body, storeCode)) throw new Error('INVALID_MENU_RESPONSE')
        setData(body)
        setUpdatedAt(new Date())
        setError(null)
      } catch {
        if (active) setError(isOffline() ? 'offline' : 'refresh')
      } finally {
        clearTimeout(timeout)
        controller = null
        busy = false
        if (active) setRefreshing(false)
      }
    }

    const resume = () => { if (!document.hidden) void refresh() }
    const offline = () => { if (active) setError('offline') }
    void refresh()
    const interval = setInterval(() => { void refresh() }, MENU_REFRESH_MS)
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('online', resume)
    window.addEventListener('offline', offline)
    return () => {
      active = false
      controller?.abort()
      clearTimeout(timeout)
      clearInterval(interval)
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('online', resume)
      window.removeEventListener('offline', offline)
    }
  }, [code, retry])

  const pages = useMemo(() => {
    const items = data ? groupElectronicMenu(data, lang).flatMap((group) => group.items.map((product) => ({ product, category: group.title }))) : []
    const result: CatalogItem[][] = []
    for (let offset = 0; offset < items.length; offset += pageSize) result.push(items.slice(offset, offset + pageSize))
    return result
  }, [data, lang, pageSize])
  const currentIndex = pages.length ? pageIndex % pages.length : 0
  const currentItems = pages[currentIndex] ?? []
  const categoryHeading = Array.from(new Set(currentItems.map((item) => item.category))).join(' · ')

  useEffect(() => {
    setPageIndex(0)
    if (pages.length < 2) return
    const timer = setInterval(() => {
      if (!document.hidden) setPageIndex((current) => (current + 1) % pages.length)
    }, PAGE_MS)
    return () => clearInterval(timer)
  }, [pages.length, pageSize, lang])

  const state = error === 'invalid' ? 'invalid' : error === 'unavailable' ? 'unavailable'
    : !data && error ? 'failed' : !data ? 'loading' : 'empty'
  const stateTitle = copy[state]
  const stateHint = copy[`${state}Hint`]
  const statusText = error ? (data ? copy.stale : error === 'offline' ? copy.offline : stateTitle)
    : refreshing ? copy.refreshing : data ? copy.live : copy.loading

  return (
    <main className={styles.screen} data-electronic-menu="true" data-testid="electronic-menu-screen" lang={lang === 'zh' ? 'zh-CN' : lang}>
      <header className={styles.header}>
        <div className={styles.storeBrand}>
          <span className={styles.brandMark}><MenuMark decorative /></span>
          <div className={styles.brandText}>
            <p className={styles.eyebrow}>{copy.menu}</p>
            <h1 className={styles.storeName}>{data?.store.name || copy.today}</h1>
          </div>
        </div>
        <div className={styles.languages} role="group" aria-label={copy.language} data-testid="menu-language">
          {LANGUAGES.map((option) => (
            <button key={option.lang} type="button" lang={option.lang} aria-pressed={lang === option.lang} onClick={() => setLang(option.lang)}>{option.label}</button>
          ))}
        </div>
      </header>

      {data && data.products.length > 0 ? (
        <section className={styles.catalog} aria-label={copy.today}>
          <div className={styles.sectionHeading}>
            <div className={styles.categoryHeading}><span className={styles.headingAccent} /><h2 title={categoryHeading}>{categoryHeading}</h2></div>
            {data.store.promoText && <p className={styles.promoText}>{data.store.promoText}</p>}
          </div>
          <div className={styles.productGrid} key={`${currentIndex}:${pageSize}:${lang}`} data-menu-page={currentIndex + 1}>
            {currentItems.map((item) => <ProductCard key={item.product.id} item={item} lang={lang} currency={data.store.currencyCode} />)}
          </div>
        </section>
      ) : (
        <section className={styles.emptyState} aria-live="polite" aria-busy={state === 'loading'}>
          <div className={styles.stateMark}><MenuMark decorative /></div>
          <p className={styles.eyebrow}>{copy.menu}</p>
          <h2>{stateTitle}</h2>
          <p>{stateHint}</p>
          {state === 'failed' && <button type="button" className={styles.retryButton} disabled={refreshing} onClick={() => setRetry((value) => value + 1)}>{copy.retry}</button>}
        </section>
      )}

      <footer className={styles.footer}>
        <div className={`${styles.refreshStatus} ${error ? styles.refreshError : ''}`} role="status" data-testid="menu-refresh-status" title={updatedAt ? updatedAt.toLocaleTimeString() : undefined}>
          <span className={styles.statusDot} /><span>{statusText}</span>
        </div>
        {data?.store.announcement && <p className={styles.announcement} title={data.store.announcement}>{data.store.announcement}</p>}
        {pages.length > 0 && <div className={styles.pagination} data-testid="menu-page-indicator" aria-label={`${copy.page} ${currentIndex + 1} / ${pages.length}`}><strong>{String(currentIndex + 1).padStart(2, '0')}</strong><span>/ {String(pages.length).padStart(2, '0')}</span></div>}
      </footer>
    </main>
  )
}
