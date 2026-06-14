'use client'

/**
 * /desktop/display?storeCode=XXX — 顾客端收银显示屏（只读）
 *
 * 由手机 /sale 端实时驱动；本页每 1500ms 轮询 /api/pos/session/current。
 * 仅展示当前销售草稿 / 收款进度 / KHQR 二维码 / 完成提示；不做任何下单 / 收款操作。
 *
 * 与 /cashier 区别：/cashier 是独立桌面 POS（店员直接在电脑下单收款）；
 * 本页是"手机操作，电脑展示"的同屏联动小屏 / 大屏镜像。
 */

import { useEffect, useState, useRef, CSSProperties } from 'react'
import QRCode from 'react-qr-code'

type PosItem = {
  productId: string
  name: string
  spec: string | null
  imageUrl?: string | null
  price: number
  qty: number
  lineAmount: number
}

type DisplayProduct = {
  id: string
  name: string
  spec: string | null
  sellPrice: number
  imageUrl: string
  totalQty?: number
}

type SessionPayload = {
  status: 'DRAFT' | 'AWAITING_PAYMENT' | 'COMPLETED' | 'CANCELLED' | string
  displayStatus?: string | null
  paymentMethod: 'CASH' | 'KHQR' | null
  paymentStatus: 'PENDING' | 'PAID' | null
  items: PosItem[]
  totalAmount: number
  itemCount: number
  khqrPayload: string | null
  khqrImageUrl: string | null
  orderNo: string | null
  message: string | null
  completedAt: string | null
  updatedAt: string
}

type ApiResp = {
  storeCode: string
  storeName: string
  storeBannerUrl?: string | null
  storeKhqrImageUrl?: string | null
  displayProducts?: DisplayProduct[]
  serverNow: string
  session: SessionPayload | null
}

type DesktopLang = 'zh' | 'en' | 'km'
type DisplayCopy = typeof displayCopy.zh

const POLL_MS = 1500
const COMPLETED_LINGER_MS = 8000  // 完成态展示 8 秒后回到 idle
const DRAFT_TIMEOUT_MS = 5 * 60 * 1000
const CHECKOUT_TIMEOUT_MS = 10 * 60 * 1000

export default function DesktopMirrorPage() {
  const [storeCode, setStoreCode] = useState<string | null>(null)
  const [lang, setLang] = useState<DesktopLang>('zh')
  const [noCode, setNoCode] = useState(false)
  const [data, setData] = useState<ApiResp | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const nextLang = resolveDesktopLang(params.get('lang'))
    const sc = params.get('storeCode')?.trim() || null
    setLang(nextLang)
    document.documentElement.lang = nextLang === 'km' ? 'km' : nextLang === 'en' ? 'en' : 'zh-CN'
    if (!sc) { setNoCode(true); return }
    setStoreCode(sc)
  }, [])

  useEffect(() => {
    if (!storeCode) return
    let aborted = false
    async function poll() {
      try {
        const res = await fetch(`/api/pos/session/current?storeCode=${encodeURIComponent(storeCode!)}`, { cache: 'no-store' })
        if (!res.ok) {
          if (!aborted) setLoadError(res.status === 404 ? displayCopy[lang].storeNotFound : `HTTP ${res.status}`)
          return
        }
        const body = await res.json() as ApiResp
        if (aborted) return
        setData(body)
        setLoadError(null)
      } catch {
        if (!aborted) setLoadError(displayCopy[lang].networkRetry)
      }
    }
    poll()
    timerRef.current = setInterval(poll, POLL_MS)
    return () => {
      aborted = true
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [storeCode, lang])

  // 本地时钟用于"完成 N 秒后回到 idle"判断
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [])

  const t = displayCopy[lang]
  function changeLang(nextLang: DesktopLang) {
    setLang(nextLang)
    document.documentElement.lang = nextLang === 'km' ? 'km' : nextLang === 'en' ? 'en' : 'zh-CN'
    const params = new URLSearchParams(window.location.search)
    if (storeCode) params.set('storeCode', storeCode)
    params.set('lang', nextLang)
    window.history.replaceState(null, '', `/desktop/display?${params.toString()}`)
  }

  if (noCode) {
    return (
      <div style={s.errScreen}>
        <div style={{ fontSize: 48 }}>🖥️</div>
        <div style={s.errTitle}>{t.missingStoreTitle}</div>
        <div style={s.errSub}>{t.missingStoreSub}</div>
      </div>
    )
  }

  const session = data?.session ?? null
  const completedAtMs = session?.completedAt ? new Date(session.completedAt).getTime() : 0
  const updatedAtMs = session?.updatedAt ? new Date(session.updatedAt).getTime() : 0
  const recentlyCompleted = session?.status === 'COMPLETED' && completedAtMs > 0 && (now - completedAtMs) < COMPLETED_LINGER_MS
  const recentlyCancelled = session?.status === 'CANCELLED' && completedAtMs > 0 && (now - completedAtMs) < COMPLETED_LINGER_MS
  const expiredAtMs = session?.displayStatus === 'EXPIRED_DRAFT'
    ? updatedAtMs + DRAFT_TIMEOUT_MS
    : session?.displayStatus === 'EXPIRED_CHECKOUT'
      ? updatedAtMs + CHECKOUT_TIMEOUT_MS
      : 0
  const recentlyExpired = expiredAtMs > 0 && (now - expiredAtMs) < COMPLETED_LINGER_MS
  const isLive = !!session
    && (session.status === 'DRAFT' || session.status === 'AWAITING_PAYMENT')
    && session.displayStatus !== 'EXPIRED_DRAFT'
    && session.displayStatus !== 'EXPIRED_CHECKOUT'
    && session.items.length > 0
  const isIdle = !isLive && !recentlyCompleted && !recentlyCancelled && !recentlyExpired
  const displaySession = isIdle ? null : session
  const displayTotal = displaySession?.totalAmount ?? 0

  return (
    <div style={s.root}>
      {/* Header */}
      <div style={s.header}>
        <span style={s.brandIcon}>🖥️</span>
        <div style={s.headerCenter}>
          <div style={s.storeName}>{data?.storeName ?? t.loading}</div>
          <div style={s.storeCode}>{t.storeCode} {data?.storeCode ?? storeCode ?? '—'} · {t.displayName}</div>
        </div>
        <span style={{ ...s.statusPill, ...statusPillStyle(session, recentlyCompleted, recentlyCancelled) }}>
          {statusLabel(t, session, recentlyCompleted, recentlyCancelled)}
        </span>
        <LangSwitch lang={lang} onChange={changeLang} />
      </div>

      {/* Body: 左 = 商品列表，右 = 金额与收款 */}
      <div style={s.body}>
        <div style={s.cartCol}>
          {isLive ? (
            <CartList items={session!.items} itemCount={session!.itemCount} totalAmount={session!.totalAmount} t={t} />
          ) : recentlyCompleted ? (
            <CompletedCard session={session!} t={t} />
          ) : recentlyCancelled ? (
            <CancelledCard t={t} />
          ) : recentlyExpired ? (
            <ExpiredCard checkout={session?.displayStatus === 'EXPIRED_CHECKOUT'} t={t} />
          ) : (
            <IdleCard
              storeName={data?.storeName ?? storeCode ?? ''}
              bannerUrl={data?.storeBannerUrl ?? null}
              products={data?.displayProducts ?? []}
              t={t}
            />
          )}
        </div>

        <div style={s.payCol}>
          {isIdle ? (
            <div style={s.readyCard}>
              <div style={s.readyTitle}>{t.readyCheckout}</div>
              <div style={s.readySub}>{t.waitingCashier}</div>
            </div>
          ) : (
            <div style={s.totalCard}>
              <div style={s.totalLabel}>{t.amountDue}</div>
              <div style={s.totalAmt}>${displayTotal.toFixed(2)}</div>
              <div style={s.totalMeta}>
                {isLive && t.itemMeta(session!.itemCount, session!.items.length)}
                {recentlyCompleted && t.completed}
                {recentlyCancelled && t.cancelled}
                {recentlyExpired && (session?.displayStatus === 'EXPIRED_CHECKOUT' ? t.paymentExpired : t.expired)}
              </div>
            </div>
          )}

          <PaymentCard
            session={displaySession}
            recentlyCompleted={recentlyCompleted}
            storeKhqrImageUrl={data?.storeKhqrImageUrl ?? null}
            t={t}
          />
        </div>
      </div>

      {/* Footer */}
      <div style={s.footer}>
        {loadError ? <span style={s.footerErr}>⚠ {loadError}</span>
          : <span style={s.footerOk}>● {t.connected(POLL_MS / 1000)}</span>}
        {data?.session && (
          <span style={s.footerMeta}>{t.updated} {fmtTime(data.session.updatedAt, lang)}</span>
        )}
      </div>
    </div>
  )
}

// ─── 子组件 ──────────────────────────────────────────────────────────────────

function CartList({ items, itemCount, totalAmount, t }: { items: PosItem[]; itemCount: number; totalAmount: number; t: DisplayCopy }) {
  const subtotal = items.reduce((sum, item) => sum + item.lineAmount, 0)
  return (
    <div style={s.cartList}>
      <div style={s.cartTitle}>{t.cartTitle}</div>
      {items.map((it) => (
        <div key={it.productId + '-' + it.qty} style={s.cartRow}>
          <ProductThumb item={it} />
          <div style={s.cartName}>
            {it.name}
            {it.spec && <span style={s.cartSpec}> · {it.spec}</span>}
          </div>
          <div style={s.cartQty}>{it.qty} × ${it.price.toFixed(2)}</div>
          <div style={s.cartLine}>${it.lineAmount.toFixed(2)}</div>
        </div>
      ))}
      <div style={s.summaryCard}>
        <div style={s.summaryTitle}>{t.summaryTitle}</div>
        <div style={s.summaryRow}>
          <span style={s.summaryLabel}>{t.productKinds}</span>
          <span style={s.summaryValue}>{items.length}</span>
        </div>
        <div style={s.summaryRow}>
          <span style={s.summaryLabel}>{t.productCount}</span>
          <span style={s.summaryValue}>{itemCount}</span>
        </div>
        <div style={s.summaryRow}>
          <span style={s.summaryLabel}>{t.subtotal}</span>
          <span style={s.summaryValue}>${subtotal.toFixed(2)}</span>
        </div>
        <div style={s.summaryDueRow}>
          <span>{t.amountDue}</span>
          <span>${totalAmount.toFixed(2)}</span>
        </div>
      </div>
    </div>
  )
}

function ProductThumb({ item }: { item: PosItem }) {
  return <ProductImage src={item.imageUrl} name={item.name} />
}

function ProductImage({
  src,
  name,
  imageStyle,
  placeholderStyle,
}: {
  src: string | null | undefined
  name: string
  imageStyle?: CSSProperties
  placeholderStyle?: CSSProperties
}) {
  const [failed, setFailed] = useState(false)
  const imageSrc = displayImageSrc(src)
  if (!imageSrc || failed) {
    return <div style={{ ...s.productPlaceholder, ...placeholderStyle }}>📦</div>
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={imageSrc} alt={name} style={{ ...s.productImage, ...imageStyle }} onError={() => setFailed(true)} />
  )
}

function CompletedCard({ session, t }: { session: SessionPayload; t: DisplayCopy }) {
  return (
    <div style={s.bigCard}>
      <div style={{ ...s.bigIcon, color: '#16a34a' }}>✓</div>
      <div style={s.bigTitle}>{t.completed}</div>
      {session.orderNo && <div style={s.bigSub}>{t.orderNo} {session.orderNo}</div>}
      <div style={s.bigAmt}>${session.totalAmount.toFixed(2)}</div>
      <div style={s.bigMeta}>
        {paymentMethodLabel(session.paymentMethod, t)}
      </div>
      <div style={s.bigSub}>{t.thanks}</div>
    </div>
  )
}

function CancelledCard({ t }: { t: DisplayCopy }) {
  return (
    <div style={s.bigCard}>
      <div style={{ ...s.bigIcon, color: '#9ca3af' }}>—</div>
      <div style={s.bigTitle}>{t.cancelled}</div>
      <div style={s.bigSub}>{t.waitingNext}</div>
    </div>
  )
}

function ExpiredCard({ checkout, t }: { checkout: boolean; t: DisplayCopy }) {
  return (
    <div style={s.bigCard}>
      <div style={{ ...s.bigIcon, color: '#f59e0b' }}>⌛</div>
      <div style={s.bigTitle}>{checkout ? t.paymentExpired : t.expired}</div>
      <div style={s.bigSub}>{t.waitingNext}</div>
    </div>
  )
}

function IdleCard({ storeName, bannerUrl, products, t }: { storeName: string; bannerUrl: string | null; products: DisplayProduct[]; t: DisplayCopy }) {
  const heroImage = displayImageSrc(bannerUrl)
  return (
    <div style={s.idleShowcase}>
      <div
        style={{
          ...s.idleHero,
          ...(heroImage ? {
            backgroundImage: `linear-gradient(90deg, rgba(15,23,42,.84), rgba(15,23,42,.42)), url("${heroImage}")`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          } : {}),
        }}
      >
        <div style={s.idleHeroContent}>
          <div style={s.idleBadge}>{t.customerDisplay}</div>
          <div style={s.idleStore}>{storeName || t.welcome}</div>
          <div style={s.idleWelcome}>{t.welcome}</div>
          <div style={s.idleSub}>{t.waitingCashier}</div>
        </div>
      </div>

      <div style={s.pickSection}>
        <div style={s.pickHeader}>
          <span>{t.topSellers}</span>
          <span style={s.pickHint}>{t.pickHint}</span>
        </div>
        {products.length > 0 ? (
          <div style={s.pickGrid}>
            {products.slice(0, 3).map((product) => (
              <div key={product.id} style={s.pickCard}>
                <ProductImage
                  src={product.imageUrl}
                  name={product.name}
                  imageStyle={s.pickImage}
                  placeholderStyle={s.pickImage}
                />
                <div style={s.pickBody}>
                  <div style={s.pickName}>{product.name}</div>
                  {product.spec && <div style={s.pickSpec}>{product.spec}</div>}
                  <div style={s.pickFooter}>
                    <span style={s.pickPrice}>${product.sellPrice.toFixed(2)}</span>
                    {product.totalQty !== undefined && <span style={s.pickSold}>{t.soldThisWeek(product.totalQty)}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={s.brandFallback}>
            <div style={s.brandFallbackIcon}>✨</div>
            <div style={s.brandFallbackTitle}>{t.brandFallbackTitle}</div>
            <div style={s.brandFallbackSub}>{t.brandFallbackSub}</div>
          </div>
        )}
      </div>
    </div>
  )
}

function PaymentCard({
  session,
  recentlyCompleted,
  storeKhqrImageUrl,
  t,
}: {
  session: SessionPayload | null
  recentlyCompleted: boolean
  storeKhqrImageUrl: string | null
  t: DisplayCopy
}) {
  const sessionKhqrImageSrc = displayImageSrc(session?.khqrImageUrl)
  const storeKhqrImageSrc = displayImageSrc(storeKhqrImageUrl)
  const khqrImageSrc = sessionKhqrImageSrc ?? storeKhqrImageSrc
  const qrValue = session?.khqrPayload || (!khqrImageSrc ? session?.khqrImageUrl : null)
  const hasKhqr = Boolean(khqrImageSrc || qrValue)
  const hasOrder = Boolean(session && session.items.length > 0)

  return (
    <div style={s.payCard}>
      <div style={s.payLabel}>
        {t.paymentMethod}
        {(session?.paymentMethod || hasKhqr) && (
          <span style={s.payTag}>
            {session?.paymentMethod ? paymentMethodLabel(session.paymentMethod, t) : '📱 KHQR'}
          </span>
        )}
        {session?.paymentStatus === 'PAID' && <span style={s.paidTag}>{t.paid}</span>}
      </div>
      {hasKhqr ? (
        <div style={s.qrWrap}>
          {khqrImageSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={khqrImageSrc} alt="KHQR" style={s.qrImage} />
          ) : (
            <QRCode value={qrValue || ''} size={220} />
          )}
          <div style={s.qrHint}>
            {hasOrder && !recentlyCompleted ? t.scanToPay : t.scanSupported}
          </div>
        </div>
      ) : (
        <div style={s.payIdle}>
          {session?.status === 'AWAITING_PAYMENT' && session.paymentMethod === 'KHQR' ? t.payStaff :
           session?.status === 'AWAITING_PAYMENT' ? t.waitingPaymentMethod :
           session?.status === 'DRAFT' ? t.checkingOutShort :
           session?.status === 'COMPLETED' ? t.completed :
           !hasOrder ? t.selectItemsFirst :
           '—'}
        </div>
      )}
    </div>
  )
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function statusLabel(t: DisplayCopy, s: SessionPayload | null, completed: boolean, cancelled: boolean): string {
  if (completed) return t.completedShort
  if (cancelled) return t.cancelledShort
  if (s?.displayStatus === 'EXPIRED_DRAFT') return t.expiredShort
  if (s?.displayStatus === 'EXPIRED_CHECKOUT') return t.paymentExpiredShort
  if (!s || s.items.length === 0) return t.idle
  if (s.status === 'AWAITING_PAYMENT') return t.waitingPaymentShort
  return t.checkingOutShort
}

function statusPillStyle(sess: SessionPayload | null, completed: boolean, cancelled: boolean): CSSProperties {
  if (completed) return { background: '#dcfce7', color: '#15803d' }
  if (cancelled) return { background: '#f3f4f6', color: '#6b7280' }
  if (sess?.displayStatus === 'EXPIRED_DRAFT' || sess?.displayStatus === 'EXPIRED_CHECKOUT') return { background: '#fffbeb', color: '#b45309' }
  if (!sess || sess.items.length === 0) return { background: '#e0f2fe', color: '#0369a1' }
  if (sess.status === 'AWAITING_PAYMENT') return { background: '#fef3c7', color: '#92400e' }
  return { background: '#dbeafe', color: '#1d4ed8' }
}

function fmtTime(iso: string, lang: DesktopLang): string {
  const locale = lang === 'km' ? 'km-KH' : lang === 'en' ? 'en-US' : 'zh-CN'
  return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function resolveDesktopLang(raw: string | null): DesktopLang {
  if (raw === 'en' || raw === 'km' || raw === 'zh') return raw
  return 'en'
}

function paymentMethodLabel(method: string | null, t: DisplayCopy) {
  if (method === 'CASH') return `💵 ${t.cash}`
  if (method === 'KHQR') return '📱 KHQR'
  return '—'
}

function displayImageSrc(raw: string | null | undefined): string | null {
  if (!raw) return null
  const value = raw.trim()
  if (value.startsWith('http://') || value.startsWith('https://')) return value
  if (value.startsWith('/')) return value
  if (value.startsWith('data:image/') && value.includes(',')) return value
  return null
}

function LangSwitch({ lang, onChange }: { lang: DesktopLang; onChange: (lang: DesktopLang) => void }) {
  return (
    <div style={s.langSwitch} aria-label="Language">
      {(['zh', 'en', 'km'] as DesktopLang[]).map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onChange(item)}
          style={item === lang ? s.langBtnOn : s.langBtn}
        >
          {item}
        </button>
      ))}
    </div>
  )
}

const displayCopy = {
  zh: {
    missingStoreTitle: '缺少门店信息',
    missingStoreSub: '请使用 /desktop/display?storeCode=<门店编号> 打开本页。',
    storeNotFound: '门店不存在或已停用',
    networkRetry: '网络错误，自动重试中…',
    loading: '加载中…',
    storeCode: '门店编号',
    displayName: '顾客端收银显示屏',
    amountDue: '应付金额',
    completed: '本单已完成',
    cancelled: '本单已取消',
    expired: '本单已超时',
    paymentExpired: '收款超时',
    waitingOrder: '等待新订单',
    readyCheckout: '准备结账',
    waitingNext: '等待下一单',
    cartTitle: '当前订单',
    orderNo: '单号',
    thanks: '谢谢光临',
    welcome: '欢迎光临',
    waitingCashier: '等待收银 · 支持 CASH / KHQR',
    customerDisplay: '顾客收银显示屏',
    topSellers: '本周热销',
    pickHint: '店员添加商品后，请核对应付金额',
    soldThisWeek: (qty: number) => `本周 ${qty} 件`,
    brandFallbackTitle: '请等待店员添加商品',
    brandFallbackSub: '本屏将实时显示商品、金额和付款方式。',
    summaryTitle: '订单汇总',
    productKinds: '商品种类',
    productCount: '商品件数',
    subtotal: '小计',
    paymentMethod: '收款方式',
    paid: '已收款',
    scanToPay: '请扫码付款',
    scanSupported: '支持扫码付款 · 请先选择商品',
    selectItemsFirst: '请先选择商品',
    payStaff: '请向店员付款',
    waitingPaymentMethod: '等待手机端选择收款方式',
    draftNoPayment: '正在结账',
    connected: (seconds: number) => `已连接 · 每 ${seconds}s 刷新`,
    updated: 'updated',
    itemMeta: (count: number, kinds: number) => `${count} 件 · ${kinds} 种`,
    completedShort: '付款完成',
    cancelledShort: '已取消',
    expiredShort: '本单已超时',
    paymentExpiredShort: '收款超时',
    idle: '空闲中',
    waitingPaymentShort: '等待收款',
    checkingOutShort: '正在结账',
    cash: '现金',
  },
  en: {
    missingStoreTitle: 'Missing Store',
    missingStoreSub: 'Open this page with /desktop/display?storeCode=STORE_CODE.',
    storeNotFound: 'Store not found or inactive',
    networkRetry: 'Network error. Retrying automatically...',
    loading: 'Loading...',
    storeCode: 'Store code',
    displayName: 'Customer Display',
    amountDue: 'Amount Due',
    completed: 'Order completed',
    cancelled: 'Order cancelled',
    expired: 'Order expired',
    paymentExpired: 'Payment timed out',
    waitingOrder: 'Waiting for next order',
    readyCheckout: 'Ready for checkout',
    waitingNext: 'Waiting for next order',
    cartTitle: 'Current Order',
    orderNo: 'Order',
    thanks: 'Thank you',
    welcome: 'Welcome',
    waitingCashier: 'Waiting for cashier · CASH / KHQR supported',
    customerDisplay: 'Customer checkout display',
    topSellers: 'Top sellers this week',
    pickHint: 'Check the amount after the cashier adds items',
    soldThisWeek: (qty: number) => `${qty} sold`,
    brandFallbackTitle: 'Please wait for the cashier',
    brandFallbackSub: 'This screen will show items, total, and payment method.',
    summaryTitle: 'Order Summary',
    productKinds: 'Product kinds',
    productCount: 'Items',
    subtotal: 'Subtotal',
    paymentMethod: 'Payment Method',
    paid: 'Paid',
    scanToPay: 'Please scan to pay',
    scanSupported: 'Scan payment supported · Select items first',
    selectItemsFirst: 'Select items first',
    payStaff: 'Please pay the cashier',
    waitingPaymentMethod: 'Waiting for payment method on phone',
    draftNoPayment: 'Checking out',
    connected: (seconds: number) => `Connected · refreshes every ${seconds}s`,
    updated: 'updated',
    itemMeta: (count: number, kinds: number) => `${count} items · ${kinds} kinds`,
    completedShort: 'Payment completed',
    cancelledShort: 'Cancelled',
    expiredShort: 'Order timed out',
    paymentExpiredShort: 'Payment timed out',
    idle: 'Idle',
    waitingPaymentShort: 'Waiting for payment',
    checkingOutShort: 'Checking out',
    cash: 'Cash',
  },
  km: {
    missingStoreTitle: 'ខ្វះព័ត៌មានហាង',
    missingStoreSub: 'សូមបើក /desktop/display?storeCode=STORE_CODE។',
    storeNotFound: 'រកមិនឃើញហាង ឬហាងត្រូវបានបិទ',
    networkRetry: 'បញ្ហាបណ្តាញ កំពុងព្យាយាមម្តងទៀត…',
    loading: 'កំពុងផ្ទុក…',
    storeCode: 'លេខកូដហាង',
    displayName: 'អេក្រង់អតិថិជន',
    amountDue: 'ចំនួនត្រូវបង់',
    completed: 'ការបញ្ជាទិញបានបញ្ចប់',
    cancelled: 'ការបញ្ជាទិញបានលុបចោល',
    expired: 'ការបញ្ជាទិញអស់ពេល',
    paymentExpired: 'ការទូទាត់អស់ពេល',
    waitingOrder: 'រង់ចាំការបញ្ជាទិញថ្មី',
    readyCheckout: 'រួចរាល់សម្រាប់គិតលុយ',
    waitingNext: 'រង់ចាំការបញ្ជាទិញបន្ទាប់',
    cartTitle: 'ការបញ្ជាទិញបច្ចុប្បន្ន',
    orderNo: 'លេខវិក្កយបត្រ',
    thanks: 'អរគុណ',
    welcome: 'សូមស្វាគមន៍',
    waitingCashier: 'រង់ចាំបញ្ជរ · គាំទ្រ CASH / KHQR',
    customerDisplay: 'អេក្រង់គិតលុយអតិថិជន',
    topSellers: 'ទំនិញលក់ដាច់សប្តាហ៍នេះ',
    pickHint: 'សូមពិនិត្យចំនួនទឹកប្រាក់បន្ទាប់ពីបុគ្គលិកបន្ថែមទំនិញ',
    soldThisWeek: (qty: number) => `សប្តាហ៍នេះ ${qty}`,
    brandFallbackTitle: 'សូមរង់ចាំបុគ្គលិកបន្ថែមទំនិញ',
    brandFallbackSub: 'អេក្រង់នេះនឹងបង្ហាញទំនិញ ចំនួនសរុប និងវិធីបង់ប្រាក់។',
    summaryTitle: 'សរុបការបញ្ជាទិញ',
    productKinds: 'ប្រភេទទំនិញ',
    productCount: 'ចំនួនទំនិញ',
    subtotal: 'សរុបរង',
    paymentMethod: 'វិធីបង់ប្រាក់',
    paid: 'បានទទួលប្រាក់',
    scanToPay: 'សូមស្កេនដើម្បីបង់ប្រាក់',
    scanSupported: 'គាំទ្រការស្កេនបង់ប្រាក់ · សូមជ្រើសទំនិញជាមុន',
    selectItemsFirst: 'សូមជ្រើសទំនិញជាមុន',
    payStaff: 'សូមបង់ប្រាក់ជាមួយបុគ្គលិក',
    waitingPaymentMethod: 'រង់ចាំជ្រើសរើសវិធីបង់ប្រាក់ពីទូរស័ព្ទ',
    draftNoPayment: 'កំពុងគិតលុយ',
    connected: (seconds: number) => `បានភ្ជាប់ · ធ្វើបច្ចុប្បន្នភាពរៀងរាល់ ${seconds}s`,
    updated: 'បានធ្វើបច្ចុប្បន្នភាព',
    itemMeta: (count: number, kinds: number) => `${count} មុខ · ${kinds} ប្រភេទ`,
    completedShort: 'បានបញ្ចប់',
    cancelledShort: 'បានលុប',
    expiredShort: 'អស់ពេល',
    paymentExpiredShort: 'ការទូទាត់អស់ពេល',
    idle: 'ទំនេរ',
    waitingPaymentShort: 'រង់ចាំបង់ប្រាក់',
    checkingOutShort: 'កំពុងគិតលុយ',
    cash: 'សាច់ប្រាក់',
  },
}

// ─── styles ──────────────────────────────────────────────────────────────────

const ACCENT = '#2563eb'

const s: Record<string, CSSProperties> = {
  root: { minHeight: '100vh', background: 'var(--bg, #f1f5f9)', display: 'flex', flexDirection: 'column', fontFamily: 'var(--font-sans, system-ui, -apple-system, sans-serif)' },
  header: { background: '#0f172a', color: '#fff', padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 },
  brandIcon: { fontSize: 30 },
  headerCenter: { flex: 1, minWidth: 0 },
  storeName: { fontSize: 22, fontWeight: 800, letterSpacing: '-0.3px' },
  storeCode: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  statusPill: { fontSize: 14, fontWeight: 700, padding: '6px 16px', borderRadius: 999, flexShrink: 0 },
  langSwitch: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: 3, borderRadius: 999, background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.16)', flexShrink: 0 },
  langBtn: { border: 'none', borderRadius: 999, background: 'transparent', color: '#cbd5e1', fontSize: 12, fontWeight: 800, padding: '5px 8px', cursor: 'pointer' },
  langBtnOn: { border: 'none', borderRadius: 999, background: '#fff', color: '#0f172a', fontSize: 12, fontWeight: 800, padding: '5px 8px', cursor: 'pointer' },

  body: { flex: 1, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 410px', gap: 14, padding: 14, minHeight: 0 },
  cartCol: { background: '#fff', borderRadius: 14, padding: 18, overflow: 'auto', boxShadow: '0 1px 3px rgba(0,0,0,.05)' },
  payCol: { display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 },

  cartList: { display: 'flex', flexDirection: 'column' },
  cartTitle: { fontSize: 13, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 12 },
  cartRow: { display: 'grid', gridTemplateColumns: '58px 1fr auto auto', alignItems: 'center', gap: 14, padding: '12px 4px', borderBottom: '1px solid #f1f5f9' },
  productImage: { width: 52, height: 52, objectFit: 'cover', borderRadius: 10, border: '1px solid #e5e7eb', background: '#f8fafc' },
  productPlaceholder: { width: 52, height: 52, borderRadius: 10, border: '1px solid #e5e7eb', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 },
  cartName: { fontSize: 18, fontWeight: 600, color: '#111827' },
  cartSpec: { fontSize: 14, color: '#9ca3af', fontWeight: 400 },
  cartQty: { fontSize: 14, color: '#6b7280', whiteSpace: 'nowrap' },
  cartLine: { fontSize: 18, fontWeight: 700, color: '#111827', minWidth: 80, textAlign: 'right' },
  summaryCard: { marginTop: 18, marginLeft: 'auto', width: 'min(100%, 360px)', borderRadius: 12, border: '1px solid #e5e7eb', background: '#f8fafc', padding: 16 },
  summaryTitle: { fontSize: 13, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10 },
  summaryRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 14, color: '#64748b', padding: '6px 0' },
  summaryLabel: { color: '#64748b' },
  summaryValue: { color: '#0f172a', fontWeight: 800 },
  summaryDueRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 10, paddingTop: 12, borderTop: '1px solid #e2e8f0', fontSize: 20, fontWeight: 900, color: '#0f172a' },

  totalCard: { background: '#fff', borderRadius: 14, padding: 20, textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,.05)' },
  totalLabel: { fontSize: 12, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' },
  totalAmt: { fontSize: 48, fontWeight: 800, color: ACCENT, marginTop: 6, letterSpacing: '-1px' },
  totalMeta: { fontSize: 13, color: '#9ca3af', marginTop: 6 },
  readyCard: { background: '#fff', borderRadius: 14, padding: 24, textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,.05)' },
  readyTitle: { fontSize: 30, lineHeight: 1.15, fontWeight: 900, color: '#0f172a', letterSpacing: '-.4px' },
  readySub: { marginTop: 8, fontSize: 14, color: '#64748b', lineHeight: 1.5 },

  payCard: { flex: 1, background: '#fff', borderRadius: 14, padding: 20, display: 'flex', flexDirection: 'column', boxShadow: '0 1px 3px rgba(0,0,0,.05)', minHeight: 0 },
  payLabel: { fontSize: 13, color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  payTag: { padding: '2px 10px', background: '#dbeafe', color: '#1d4ed8', borderRadius: 999, fontSize: 12, fontWeight: 700 },
  paidTag: { padding: '2px 10px', background: '#dcfce7', color: '#15803d', borderRadius: 999, fontSize: 12, fontWeight: 700 },
  payIdle: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#cbd5e1', fontSize: 14, marginTop: 10 },

  idleShowcase: { minHeight: '100%', display: 'flex', flexDirection: 'column', gap: 18 },
  idleHero: { borderRadius: 18, padding: 28, minHeight: 250, background: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 56%, #2563eb 100%)', color: '#fff', display: 'flex', flexDirection: 'column', justifyContent: 'center', boxShadow: '0 18px 38px rgba(15,23,42,.18)', overflow: 'hidden' },
  idleHeroContent: { maxWidth: 660 },
  idleBadge: { alignSelf: 'flex-start', padding: '5px 12px', borderRadius: 999, background: 'rgba(255,255,255,.14)', color: '#dbeafe', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em' },
  idleStore: { marginTop: 20, fontSize: 46, lineHeight: 1.05, fontWeight: 900, letterSpacing: '-1px' },
  idleWelcome: { marginTop: 10, fontSize: 24, fontWeight: 800, color: '#bfdbfe' },
  idleSub: { marginTop: 8, fontSize: 16, color: '#dbeafe' },
  pickSection: { background: '#fff', borderRadius: 18, padding: 20, border: '1px solid #e5e7eb', boxShadow: '0 1px 3px rgba(0,0,0,.05)', flex: 1 },
  pickHeader: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, fontSize: 18, fontWeight: 900, color: '#0f172a', marginBottom: 14 },
  pickHint: { fontSize: 12, fontWeight: 600, color: '#94a3b8' },
  pickGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16 },
  pickCard: { minWidth: 0, minHeight: 230, borderRadius: 16, border: '1px solid #e5e7eb', background: '#f8fafc', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 },
  pickImage: { width: '100%', height: 132, borderRadius: 14, fontSize: 38 },
  pickBody: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5, flex: 1 },
  pickName: { minWidth: 0, fontSize: 15, lineHeight: 1.25, fontWeight: 900, color: '#111827', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
  pickSpec: { fontSize: 12, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  pickFooter: { marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  pickPrice: { fontSize: 18, fontWeight: 900, color: ACCENT },
  pickSold: { fontSize: 11, color: '#64748b', fontWeight: 800, background: '#e2e8f0', borderRadius: 999, padding: '3px 8px', whiteSpace: 'nowrap' },
  brandFallback: { minHeight: 150, borderRadius: 14, border: '1px dashed #cbd5e1', background: '#f8fafc', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 20 },
  brandFallbackIcon: { fontSize: 34 },
  brandFallbackTitle: { marginTop: 8, fontSize: 18, fontWeight: 900, color: '#0f172a' },
  brandFallbackSub: { marginTop: 6, fontSize: 13, color: '#64748b' },

  qrWrap: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 10 },
  qrImage: { maxWidth: 280, maxHeight: 280, width: '100%', objectFit: 'contain', borderRadius: 10, border: '1px solid #f0f0f0' },
  qrHint: { fontSize: 14, color: '#6b7280' },

  bigCard: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, textAlign: 'center', padding: 30 },
  bigIcon: { fontSize: 80, lineHeight: 1 },
  bigTitle: { fontSize: 32, fontWeight: 800, color: '#111827' },
  bigSub: { fontSize: 15, color: '#6b7280', maxWidth: 480 },
  bigAmt: { fontSize: 36, fontWeight: 800, color: ACCENT },
  bigMeta: { fontSize: 14, color: '#6b7280' },

  footer: { padding: '10px 18px', display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6b7280', borderTop: '1px solid #e5e7eb', background: '#fff', flexShrink: 0 },
  footerOk: { color: '#16a34a' },
  footerErr: { color: '#dc2626' },
  footerMeta: { color: '#9ca3af' },

  errScreen: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#f1f5f9', flexDirection: 'column', gap: 12, padding: 32 },
  errTitle: { fontSize: 22, fontWeight: 700, color: '#111827' },
  errSub: { fontSize: 14, color: '#6b7280', textAlign: 'center', maxWidth: 480, lineHeight: 1.6 },
}
