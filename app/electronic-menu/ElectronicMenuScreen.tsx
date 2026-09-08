'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import QRCode from 'react-qr-code'
import { publicCustomerEntryUrl } from '@/lib/public-url'
import { useBrowserFullscreen } from '@/lib/use-browser-fullscreen'
import { layoutMenuBoard, type BoardRow } from './menu-board-layout'
import {
  groupElectronicMenu,
  MENU_REFRESH_MS,
  menuProductName,
  type ElectronicMenuData,
  type MenuLang,
} from '@/lib/electronic-menu'
import { formatMoney } from '@/lib/currency'
import { shouldShowRecommendationBadge } from '@/lib/product-recommendation'
import styles from './electronic-menu.module.css'

const PAGE_MS = 15_000
const REQUEST_TIMEOUT_MS = 10_000
const LANGUAGES: { lang: MenuLang; label: string }[] = [
  { lang: 'zh', label: '中文' }, { lang: 'en', label: 'EN' }, { lang: 'km', label: 'ខ្មែរ' },
]
const COPY = {
  zh: {
    menu: '电子菜单', today: '今日菜单', loading: '正在准备菜单', loadingHint: '正在读取门店商品。',
    invalid: '菜单链接无效', invalidHint: '请使用商家提供的完整菜单链接。',
    unavailable: '菜单暂不可用', unavailableHint: '门店暂未开放，请稍后再看。',
    failed: '暂时无法加载菜单', failedHint: '正在自动重试，请检查网络连接。',
    empty: '暂无可展示商品', emptyHint: '商品更新后将在此显示。',
    offline: '网络已断开', stale: '更新暂不可用 · 当前显示上次菜单',
    retry: '重新加载', live: '菜单已更新', refreshing: '正在更新菜单',
    scan: '扫码下单', recommended: '推荐', page: '页', language: '菜单语言', noImage: '暂无图片',
    enterFullscreen: '全屏', exitFullscreen: '退出全屏', fullscreenHint: '请使用浏览器菜单中的全屏功能。',
  },
  en: {
    menu: 'DIGITAL MENU', today: 'On the menu', loading: 'Preparing the menu', loadingHint: 'Loading this store’s products.',
    invalid: 'Invalid menu link', invalidHint: 'Please use the complete menu link from the store.',
    unavailable: 'Menu unavailable', unavailableHint: 'This store is currently unavailable. Please check back later.',
    failed: 'Unable to load the menu', failedHint: 'Retrying automatically. Please check the connection.',
    empty: 'No items to display', emptyHint: 'Items will appear here when the catalog is updated.',
    offline: 'Connection lost', stale: 'Update unavailable · Showing the last menu',
    retry: 'Try again', live: 'Menu up to date', refreshing: 'Updating menu',
    scan: 'Scan to order', recommended: 'Recommended', page: 'Page', language: 'Menu language', noImage: 'Image unavailable',
    enterFullscreen: 'Fullscreen', exitFullscreen: 'Exit fullscreen', fullscreenHint: 'Use the fullscreen option in your browser menu.',
  },
  km: {
    menu: 'ម៉ឺនុយឌីជីថល', today: 'ម៉ឺនុយថ្ងៃនេះ', loading: 'កំពុងរៀបចំម៉ឺនុយ', loadingHint: 'កំពុងផ្ទុកផលិតផលរបស់ហាង។',
    invalid: 'តំណម៉ឺនុយមិនត្រឹមត្រូវ', invalidHint: 'សូមប្រើតំណម៉ឺនុយពេញលេញពីហាង។',
    unavailable: 'ម៉ឺនុយមិនទាន់មាន', unavailableHint: 'ហាងមិនទាន់បើកទេ។ សូមពិនិត្យម្តងទៀតនៅពេលក្រោយ។',
    failed: 'មិនអាចផ្ទុកម៉ឺនុយបាន', failedHint: 'កំពុងព្យាយាមម្តងទៀត។ សូមពិនិត្យការតភ្ជាប់អ៊ីនធឺណិត។',
    empty: 'មិនមានផលិតផលសម្រាប់បង្ហាញ', emptyHint: 'ផលិតផលនឹងបង្ហាញនៅពេលបញ្ជីត្រូវបានធ្វើបច្ចុប្បន្នភាព។',
    offline: 'បាត់ការតភ្ជាប់', stale: 'មិនអាចធ្វើបច្ចុប្បន្នភាព · កំពុងបង្ហាញម៉ឺនុយចុងក្រោយ',
    retry: 'សាកល្បងម្តងទៀត', live: 'ម៉ឺនុយបានធ្វើបច្ចុប្បន្នភាព', refreshing: 'កំពុងធ្វើបច្ចុប្បន្នភាព',
    scan: 'ស្កេនដើម្បីបញ្ជាទិញ', recommended: 'ណែនាំ', page: 'ទំព័រ', language: 'ភាសាម៉ឺនុយ', noImage: 'មិនមានរូបភាព',
    enterFullscreen: 'ពេញអេក្រង់', exitFullscreen: 'ចាកចេញពេញអេក្រង់', fullscreenHint: 'សូមប្រើមុខងារពេញអេក្រង់នៅក្នុងម៉ឺនុយកម្មវិធីរុករក។',
  },
}

type LoadError = 'invalid' | 'unavailable' | 'refresh' | 'offline' | null

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

function ProductRow({ row, lang, currency, columnWidth, fontSize }: { row: BoardRow; lang: MenuLang; currency: string; columnWidth: number; fontSize: number }) {
  const { product } = row
  const name = menuProductName(product, lang)
  const price = formatMoney(product.price, currency)
  const originalPrice = formatMoney(product.originalPrice, currency)
  // Keep long supported currency amounts on one line, including on a narrow
  // screen. Only typography adapts; formatted values remain unchanged.
  const priceWidth = Math.min(columnWidth * .45, Math.max(64, price.length * fontSize * .65, originalPrice.length * 13 * .65))
  const priceFont = Math.min(fontSize, priceWidth / (price.length * .65))
  const originalPriceFont = Math.min(13, priceWidth / (originalPrice.length * .65))
  const source = product.imageUrls[0] || product.imageUrl || null
  const [failedSource, setFailedSource] = useState<string | null>(null)
  useEffect(() => { setFailedSource(null) }, [product])

  return (
    <article className={styles.productRow} data-product-id={product.id} data-testid="menu-product-row"
      style={{ height: row.height, '--name-lines': row.lines } as CSSProperties}>
      <div className={styles.thumbnail}>
        {source && source !== failedSource ? (
          // Preserve existing image/GIF URLs without a new media service.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={source} alt={name} referrerPolicy="no-referrer" onError={() => setFailedSource(source)} />
        ) : <span className={styles.thumbnailFallback} aria-label={COPY[lang].noImage}><MenuMark decorative /></span>}
      </div>
      <div className={styles.productInfo}>
        <h3 className={styles.productName} title={name} data-testid="menu-product-name">{name}</h3>
        <div className={styles.productDetails}>
          {product.spec && <span className={styles.productSpec} title={product.spec}>{product.spec}</span>}
          {shouldShowRecommendationBadge(product) && <span className={styles.recommendation}>{COPY[lang].recommended}</span>}
        </div>
      </div>
      <div className={styles.priceRow} style={{ width: priceWidth }}>
        <strong className={styles.price} style={{ fontSize: priceFont }} data-testid="menu-product-price">{price}</strong>
        {product.discountEnabled && product.price < product.originalPrice && (
          <del className={styles.originalPrice} style={{ fontSize: originalPriceFont }}>{originalPrice}</del>
        )}
      </div>
    </article>
  )
}

function BrandMedia({ data }: { data: ElectronicMenuData }) {
  const [failed, setFailed] = useState<string[]>([])
  useEffect(() => { setFailed([]) }, [data])
  const sources = [data.store.bannerUrl, ...data.products.map(product => product.imageUrls[0] || product.imageUrl).filter(Boolean).slice(0, 3)]
  const source = sources.find((value): value is string => !!value && !failed.includes(value))
  return (
    <div className={styles.brandMedia} data-testid="menu-brand-media">
      {source ? (
        // Banner and product image/GIF URLs already belong to the public catalog.
        // No video type is available in this DTO; video remains deferred.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={source} alt={data.store.name} referrerPolicy="no-referrer" onError={() => setFailed(current => [...current, source])} />
      ) : (
        <div className={styles.brandStatement} data-testid="menu-brand-fallback">
          <span className={styles.brandMonogram} aria-hidden="true">{Array.from(data.store.name.trim())[0]}</span>
          <p>{data.store.promoText || data.store.name}</p>
        </div>
      )}
    </div>
  )
}

export default function ElectronicMenuScreen({ code, initialLang }: { code: string | null; initialLang: MenuLang }) {
  const [lang, setLang] = useState<MenuLang>(initialLang)
  const [data, setData] = useState<ElectronicMenuData | null>(null)
  const [error, setError] = useState<LoadError>(code ? null : 'invalid')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [retry, setRetry] = useState(0)
  const boardRef = useRef<HTMLDivElement>(null)
  const [boardSize, setBoardSize] = useState({ width: 1200, height: 800 })
  const [pageIndex, setPageIndex] = useState(0)
  const { isFullscreen, supported: fullscreenSupported, toggleFullscreen } = useBrowserFullscreen()
  const [fullscreenPending, setFullscreenPending] = useState(false)
  const [fullscreenFailed, setFullscreenFailed] = useState(false)
  const copy = COPY[lang]

  async function handleFullscreen() {
    if (fullscreenPending) return
    setFullscreenPending(true)
    setFullscreenFailed(false)
    try {
      await toggleFullscreen()
    } catch {
      setFullscreenFailed(true)
    } finally {
      setFullscreenPending(false)
    }
  }

  useEffect(() => {
    const previous = document.documentElement.lang
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang
    return () => { document.documentElement.lang = previous }
  }, [lang])

  useEffect(() => {
    const board = boardRef.current
    if (!board) return
    const resize = () => {
      const { width, height } = board.getBoundingClientRect()
      setBoardSize(current => current.width === width && current.height === height ? current : { width, height })
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(board)
    return () => observer.disconnect()
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

  const layout = useMemo(() => layoutMenuBoard(
    data ? groupElectronicMenu(data, lang) : [], boardSize.width, boardSize.height, lang,
  ), [data, lang, boardSize])
  const { pages } = layout
  const currentIndex = pages.length ? pageIndex % pages.length : 0

  useEffect(() => {
    setPageIndex(0)
    if (pages.length < 2) return
    const timer = setInterval(() => {
      if (!document.hidden) setPageIndex((current) => (current + 1) % pages.length)
    }, PAGE_MS)
    return () => clearInterval(timer)
  }, [pages.length, boardSize, lang])

  const state = error === 'invalid' ? 'invalid' : error === 'unavailable' ? 'unavailable'
    : !data && error ? 'failed' : !data ? 'loading' : 'empty'
  const stateTitle = copy[state]
  const stateHint = copy[`${state}Hint`]
  const statusText = error ? (data ? copy.stale : error === 'offline' ? copy.offline : stateTitle)
    : refreshing ? copy.refreshing : data ? copy.live : copy.loading

  return (
    <main className={styles.screen} data-electronic-menu="true" data-testid="electronic-menu-screen" lang={lang === 'zh' ? 'zh-CN' : lang}>
      <aside className={styles.brandPanel} data-testid="menu-brand-panel">
        <div className={styles.storeBrand}>
          <p className={styles.eyebrow}>{copy.menu}</p>
          <h1 className={styles.storeName}>{data?.store.name || copy.today}</h1>
          {data?.store.announcement && <p className={styles.announcement}>{data.store.announcement}</p>}
        </div>
        {data && <BrandMedia data={data} />}
        {data && (
          <div className={styles.orderEntry} data-testid="menu-order-entry">
            <div className={styles.qrCode} data-testid="menu-order-qr">
              <QRCode value={publicCustomerEntryUrl(data.store.code)} size={160} level="M" title={copy.scan} />
            </div>
            <div><p>{copy.scan}</p><span>{data.store.name}</span></div>
          </div>
        )}
      </aside>
      <div className={styles.menuPanel}>
        <header className={styles.header}>
          <h2 className={styles.menuTitle}>{copy.today}</h2>
          <div className={styles.controls}>
            <div className={styles.languages} role="group" aria-label={copy.language} data-testid="menu-language">
              {LANGUAGES.map((option) => (
                <button key={option.lang} type="button" lang={option.lang} aria-pressed={lang === option.lang} onClick={() => setLang(option.lang)}>{option.label}</button>
              ))}
            </div>
            <button type="button" className={styles.fullscreenButton} data-testid="menu-fullscreen"
              onClick={handleFullscreen} disabled={!fullscreenSupported || fullscreenPending}
              aria-pressed={isFullscreen} aria-label={isFullscreen ? copy.exitFullscreen : copy.enterFullscreen}
              title={fullscreenSupported ? (isFullscreen ? copy.exitFullscreen : copy.enterFullscreen) : copy.fullscreenHint}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d={isFullscreen ? 'M9 3v6H3m18 0h-6V3M3 15h6v6m6 0v-6h6' : 'M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6'}
                  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {fullscreenFailed && <span className={styles.fullscreenHint} role="status" data-testid="menu-fullscreen-hint">{copy.fullscreenHint}</span>}
          </div>
        </header>
        <div className={styles.catalog} ref={boardRef}>
          {data && data.products.length > 0 ? (
            <section className={styles.priceList} aria-label={copy.today} data-menu-page={currentIndex + 1}
              style={{ '--board-columns': layout.columns, '--row-font': layout.fontSize + 'px', '--heading-height': layout.headingHeight + 'px', gap: layout.gap } as CSSProperties}>
              {(pages[currentIndex] ?? []).map((sections, column) => (
                <div className={styles.menuColumn} key={column} data-testid="menu-column">
                  {sections.map(section => (
                    <section className={styles.menuGroup} key={section.id}>
                      <h2 className={styles.categoryHeading} title={section.title}>{section.title}</h2>
                      {section.rows.map(row => <ProductRow key={row.product.id} row={row} lang={lang} currency={data.store.currencyCode} columnWidth={layout.columnWidth} fontSize={layout.fontSize} />)}
                    </section>
                  ))}
                </div>
              ))}
            </section>
          ) : (
            <section className={styles.emptyState} aria-live="polite" aria-busy={state === 'loading'}>
              <p className={styles.eyebrow}>{copy.menu}</p>
              <h2>{stateTitle}</h2>
              <p>{stateHint}</p>
              {state === 'failed' && <button type="button" className={styles.retryButton} disabled={refreshing} onClick={() => setRetry((value) => value + 1)}>{copy.retry}</button>}
            </section>
          )}
        </div>

      <footer className={styles.footer}>
        <div className={`${styles.refreshStatus} ${error ? styles.refreshError : ''}`} role="status" data-testid="menu-refresh-status" title={updatedAt ? updatedAt.toLocaleTimeString() : undefined}>
          <span className={styles.statusDot} /><span>{statusText}</span>
        </div>

        {pages.length > 0 && <div className={styles.pagination} data-testid="menu-page-indicator" aria-label={`${copy.page} ${currentIndex + 1} / ${pages.length}`}><strong>{String(currentIndex + 1).padStart(2, '0')}</strong><span>/ {String(pages.length).padStart(2, '0')}</span></div>}
      </footer>
      </div>
    </main>
  )
}
