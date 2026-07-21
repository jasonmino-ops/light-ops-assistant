'use client'

/**
 * /desktop/display?storeCode=XXX — 浏览器顾客屏（只读）
 *
 * 复用既有轮询与 BroadcastChannel 数据层。页面始终维持三栏，付款状态仅改变
 * 栅格比例与右侧强调程度；门店静态 KHQR 不随订单支付方式切换而重新请求或生成。
 */

import { CSSProperties, memo, useEffect, useRef, useState } from 'react'
import QRCode from 'react-qr-code'
import {
  buildCustomerDisplayRealtimeGuard,
  createCustomerDisplayRealtimeChannel,
  isCustomerDisplayRealtimeMessage,
  shouldApplyCustomerDisplayRealtimeMessage,
  shouldIgnoreServerSessionAfterRealtime,
  type CustomerDisplayRealtimeGuard,
  type CustomerDisplayRealtimeMessage,
} from '@/lib/customer-display-realtime-channel'
import {
  customerDisplayEntryPath,
  customerDisplayPanelLingerUntil,
  deriveCustomerDisplayOrderPanelView,
  deriveCustomerDisplayPanelState,
  type CustomerDisplayPanelSession,
  type CustomerDisplayPanelState,
} from '@/lib/customer-display-panel-state'

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

type SessionPayload = Omit<CustomerDisplayPanelSession, 'items'> & {
  paymentStatus: 'PENDING' | 'PAID' | null
  items: PosItem[]
  khqrPayload: string | null
  khqrImageUrl: string | null
  orderNo: string | null
  message: string | null
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

const POLL_MS = 800
const KHQR_FOCUS_MESSAGE = 'KHQR_FOCUS'

export default function DesktopCustomerDisplayPage() {
  const [storeCode, setStoreCode] = useState<string | null>(null)
  const [lang, setLang] = useState<DesktopLang>('zh')
  const [noCode, setNoCode] = useState(false)
  const [data, setData] = useState<ApiResp | null>(null)
  const [storeKhqrImageUrl, setStoreKhqrImageUrl] = useState<string | null>(null)
  const [pageOrigin, setPageOrigin] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [lingerNow, setLingerNow] = useState(() => Date.now())
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [usdKhrRate, setUsdKhrRate] = useState(4100)
  const pollInFlightRef = useRef(false)
  const realtimeGuardRef = useRef<CustomerDisplayRealtimeGuard | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const nextLang = resolveDesktopLang(params.get('lang'))
    const nextStoreCode = params.get('storeCode')?.trim() || null
    setLang(nextLang)
    setPageOrigin(window.location.origin)
    document.documentElement.lang = nextLang === 'km' ? 'km' : nextLang === 'en' ? 'en' : 'zh-CN'
    if (!nextStoreCode) {
      setNoCode(true)
      return
    }
    setStoreCode(nextStoreCode)
  }, [])

  useEffect(() => {
    setStoreKhqrImageUrl(null)
    realtimeGuardRef.current = null
  }, [storeCode])

  useEffect(() => {
    if (!storeCode) return
    let aborted = false
    async function poll() {
      if (pollInFlightRef.current) return
      pollInFlightRef.current = true
      try {
        const res = await fetch(`/api/pos/session/current?storeCode=${encodeURIComponent(storeCode!)}`, { cache: 'no-store' })
        if (!res.ok) {
          if (!aborted) setLoadError(res.status === 404 ? displayCopy[lang].storeNotFound : `HTTP ${res.status}`)
          return
        }
        const body = await res.json() as ApiResp
        if (aborted) return
        // 静态码是门店级显示资料；即使 session 因 realtime guard 暂不覆盖，也要立即更新。
        setStoreKhqrImageUrl(body.storeKhqrImageUrl ?? null)
        setData((current) => (
          shouldIgnoreStaleDisplayResponse(current?.session ?? null, body.session, realtimeGuardRef.current)
            ? current
            : body
        ))
        setLoadError(null)
      } catch {
        if (!aborted) setLoadError(displayCopy[lang].networkRetry)
      } finally {
        pollInFlightRef.current = false
      }
    }
    poll()
    const timer = window.setInterval(poll, POLL_MS)
    return () => {
      aborted = true
      window.clearInterval(timer)
    }
  }, [storeCode, lang])

  useEffect(() => {
    if (!storeCode) return
    const channel = createCustomerDisplayRealtimeChannel()
    if (!channel) return
    channel.onmessage = (event) => {
      const message = event.data
      if (!isCustomerDisplayRealtimeMessage(message)) return
      if (!shouldApplyCustomerDisplayRealtimeMessage(realtimeGuardRef.current, message, storeCode)) return
      realtimeGuardRef.current = buildCustomerDisplayRealtimeGuard(message)
      setData((current) => applyRealtimeMessageToDisplayData(current, message))
      setLoadError(null)
    }
    return () => {
      channel.onmessage = null
      channel.close()
    }
  }, [storeCode])

  useEffect(() => {
    const updateFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement))
    updateFullscreen()
    document.addEventListener('fullscreenchange', updateFullscreen)
    return () => document.removeEventListener('fullscreenchange', updateFullscreen)
  }, [])

  useEffect(() => {
    try {
      const savedRate = Number(window.localStorage.getItem('cashier:usdKhrRate'))
      if (Number.isFinite(savedRate) && savedRate >= 1000 && savedRate <= 10000) setUsdKhrRate(Math.round(savedRate))
    } catch {
      setUsdKhrRate(4100)
    }
  }, [])

  const session = data?.session ?? null
  const panelState = deriveCustomerDisplayPanelState(session, lingerNow)
  const lingerUntil = customerDisplayPanelLingerUntil(session)
  useEffect(() => {
    if (!lingerUntil) return
    const remaining = lingerUntil - Date.now()
    if (remaining <= 0) {
      setLingerNow(Date.now())
      return
    }
    const timer = window.setTimeout(() => setLingerNow(Date.now()), remaining + 25)
    return () => window.clearTimeout(timer)
  }, [lingerUntil])

  if (noCode) {
    return (
      <div style={s.errScreen}>
        <div style={s.errIcon}>🖥️</div>
        <div style={s.errTitle}>{displayCopy[lang].missingStoreTitle}</div>
        <div style={s.errSub}>{displayCopy[lang].missingStoreSub}</div>
      </div>
    )
  }

  const t = displayCopy[lang]
  const displayStoreCode = data?.storeCode ?? storeCode ?? ''
  const customerEntryPath = customerDisplayEntryPath(displayStoreCode)
  // 服务端和浏览器首屏都先输出相同的相对路径；挂载后再补齐当前 origin，避免二维码 SVG hydration mismatch。
  const customerEntryUrl = pageOrigin && displayStoreCode ? `${pageOrigin}${customerEntryPath}` : customerEntryPath
  const showOrder = panelState === 'ORDER' || panelState === 'CASH' || panelState === 'KHQR'
  const visibleOrder = showOrder ? session : null
  const khqrFocused = panelState === 'KHQR' && session?.message === KHQR_FOCUS_MESSAGE

  function changeLang(nextLang: DesktopLang) {
    setLang(nextLang)
    document.documentElement.lang = nextLang === 'km' ? 'km' : nextLang === 'en' ? 'en' : 'zh-CN'
    const params = new URLSearchParams(window.location.search)
    if (storeCode) params.set('storeCode', storeCode)
    params.set('lang', nextLang)
    window.history.replaceState(null, '', `/desktop/display?${params.toString()}`)
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch (error) {
      console.warn('[desktop-display] fullscreen toggle failed', error)
    }
  }

  return (
    <main style={s.root}>
      <header style={s.header}>
        <div style={s.brandBlock}>
          <span style={s.brandIcon}>🖥️</span>
          <div style={s.brandText}>
            <div style={s.storeName}>{data?.storeName ?? t.loading}</div>
            <div style={s.storeMeta}>{t.storeCode} {displayStoreCode || '—'} · {t.displayName}</div>
          </div>
        </div>
        <div style={s.headerActions}>
          <span style={{ ...s.statusPill, ...statusStyle(panelState) }}>{statusLabel(panelState, t)}</span>
          <button type="button" style={s.headerButton} onClick={toggleFullscreen}>{isFullscreen ? t.exitFullscreen : t.enterFullscreen}</button>
          <LangSwitch lang={lang} onChange={changeLang} />
        </div>
      </header>

      <section style={{ ...s.panelGrid, ...(panelState === 'KHQR' ? s.panelGridKhqr : {}) }}>
        <CustomerEntryPanel
          storeName={data?.storeName ?? displayStoreCode}
          bannerUrl={data?.storeBannerUrl ?? null}
          products={data?.displayProducts ?? []}
          entryPath={customerEntryPath}
          entryUrl={customerEntryUrl}
          promoted={panelState === 'COMPLETED'}
          t={t}
        />

        <section style={s.orderPanel} aria-label={t.orderPanel}>
          <OrderPanel session={session} state={panelState} usdKhrRate={usdKhrRate} t={t} />
        </section>

        <section style={{ ...s.paymentPanel, ...(panelState === 'KHQR' ? s.paymentPanelKhqr : {}) }} aria-label={t.paymentPanel}>
          <StaticKhqrPaymentPanel
            storeName={data?.storeName ?? displayStoreCode}
            storeKhqrImageUrl={storeKhqrImageUrl}
            session={visibleOrder}
            state={panelState}
            khqrFocused={khqrFocused}
            t={t}
          />
        </section>
      </section>

      <footer style={s.footer}>
        {loadError ? <span style={s.footerError}>⚠ {loadError}</span> : <span style={s.footerOk}>● {t.connected(POLL_MS / 1000)}</span>}
        {data?.session && <span style={s.footerMeta}>{t.updated} {formatTime(data.session.updatedAt, lang)}</span>}
      </footer>
    </main>
  )
}

const CustomerEntryPanel = memo(function CustomerEntryPanel({
  storeName,
  bannerUrl,
  products,
  entryPath,
  entryUrl,
  promoted,
  t,
}: {
  storeName: string
  bannerUrl: string | null
  products: DisplayProduct[]
  entryPath: string
  entryUrl: string
  promoted: boolean
  t: DisplayCopy
}) {
  const featured = products[0] ?? null
  const bannerSrc = displayImageSrc(bannerUrl)
  return (
    <aside style={{ ...s.entryPanel, ...(promoted ? s.entryPanelPromoted : {}) }} aria-label={t.customerEntryPanel}>
      <div style={s.entryHeading}>{promoted ? t.completedInviteTitle : t.customerEntryTitle}</div>
      <div style={s.entryStore}>{storeName || t.welcome}</div>
      <div style={s.promoCard}>
        {bannerSrc ? <img src={bannerSrc} alt="" style={s.promoImage} /> : <div style={s.promoFallback}>✨</div>}
        <div style={s.promoBody}>
          <div style={s.promoLabel}>{t.promotion}</div>
          <div style={s.promoTitle}>{featured?.name ?? t.promoFallbackTitle}</div>
          <div style={s.promoSub}>{featured?.spec ?? (featured ? money(featured.sellPrice) : t.promoFallbackSub)}</div>
        </div>
      </div>
      <a href={entryPath} style={s.customerQrCard} aria-label={t.customerEntryTitle}>
        <QRCode value={entryUrl} size={168} style={s.customerQr} />
      </a>
      <div style={s.customerEntryActions}>
        <span>{t.joinMember}</span>
        <span>{t.viewCatalog}</span>
        <span>{t.mobileOrder}</span>
      </div>
      <div style={s.customerEntryHint}>{t.scanCustomerEntry}</div>
    </aside>
  )
})

const OrderPanel = memo(function OrderPanel({ session, state, usdKhrRate, t }: {
  session: SessionPayload | null
  state: CustomerDisplayPanelState
  usdKhrRate: number
  t: DisplayCopy
}) {
  const view = deriveCustomerDisplayOrderPanelView(state, session)
  if (view === 'COMPLETED' && session) {
    return (
      <div style={s.terminalPanel}>
        <div style={{ ...s.terminalIcon, color: '#15803d' }}>✓</div>
        <div style={s.terminalTitle}>{t.completed}</div>
        <div style={s.terminalAmount}>{money(session.totalAmount)}</div>
        <div style={s.terminalCurrency}>{formatKhr(session.totalAmount, usdKhrRate)}</div>
        <div style={s.terminalSub}>{t.thanks}</div>
      </div>
    )
  }
  if (view === 'CANCELLED') return <TerminalNotice icon="—" title={t.cancelled} sub={t.waitingNext} color="#64748b" />
  if (view === 'EXPIRED') return <TerminalNotice icon="⌛" title={session?.displayStatus === 'EXPIRED_CHECKOUT' ? t.paymentExpired : t.expired} sub={t.waitingNext} color="#b45309" />
  if (view === 'CART' && session) return <CartList session={session} usdKhrRate={usdKhrRate} t={t} />
  return (
    <div style={s.emptyOrder}>
      <div style={s.emptyOrderIcon}>🛒</div>
      <div style={s.emptyOrderTitle}>{t.waitingOrder}</div>
      <div style={s.emptyOrderSub}>{t.waitingOrderSub}</div>
    </div>
  )
})

function TerminalNotice({ icon, title, sub, color }: { icon: string; title: string; sub: string; color: string }) {
  return (
    <div style={s.terminalPanel}>
      <div style={{ ...s.terminalIcon, color }}>{icon}</div>
      <div style={s.terminalTitle}>{title}</div>
      <div style={s.terminalSub}>{sub}</div>
    </div>
  )
}

const CartList = memo(function CartList({ session, usdKhrRate, t }: { session: SessionPayload; usdKhrRate: number; t: DisplayCopy }) {
  const subtotal = session.items.reduce((sum, item) => sum + item.lineAmount, 0)
  return (
    <div style={s.cartLayout}>
      <div style={s.cartHeading}>
        <div>
          <div style={s.cartTitle}>{t.cartTitle}</div>
          <div style={s.cartMeta}>{t.itemMeta(session.itemCount, session.items.length)}</div>
        </div>
        <span style={s.methodBadge}>{paymentMethodLabel(session.paymentMethod, t)}</span>
      </div>
      <div style={s.cartColumns}>
        <span>{t.product}</span><span>{t.quantity}</span><span>{t.unitPrice}</span><span>{t.lineTotal}</span>
      </div>
      <div style={s.cartRows}>
        {session.items.map((item, index) => (
          <div key={`${item.productId}-${index}`} style={s.cartRow}>
            <div style={s.productCell}>
              <ProductThumbnail src={item.imageUrl} name={item.name} />
              <div style={s.productText}>
                <div style={s.productName}>{item.name}</div>
                {item.spec && <div style={s.productSpec}>{item.spec}</div>}
              </div>
            </div>
            <span style={s.numericCell}>{item.qty}</span>
            <span style={s.numericCell}>{money(item.price)}</span>
            <strong style={s.lineAmount}>{money(item.lineAmount)}</strong>
          </div>
        ))}
      </div>
      <div style={s.orderSummary}>
        <div style={s.summaryLine}><span>{t.subtotal}</span><span>{money(subtotal)}</span></div>
        <div style={s.summaryLine}><span>{t.productCount}</span><span>{session.itemCount}</span></div>
        <div style={s.dueLine}><span>{t.amountDue}</span><strong>{money(session.totalAmount)}</strong></div>
        <div style={s.dueCurrency}>{formatKhr(session.totalAmount, usdKhrRate)}</div>
      </div>
    </div>
  )
})

function ProductThumbnail({ src, name }: { src: string | null | undefined; name: string }) {
  const imageSrc = displayImageSrc(src)
  if (!imageSrc) return <span style={s.productPlaceholder}>📦</span>
  return <img src={imageSrc} alt={name} style={s.productImage} />
}

const StaticKhqrPaymentPanel = memo(function StaticKhqrPaymentPanel({
  storeName,
  storeKhqrImageUrl,
  session,
  state,
  khqrFocused,
  t,
}: {
  storeName: string
  storeKhqrImageUrl: string | null
  session: SessionPayload | null
  state: CustomerDisplayPanelState
  khqrFocused: boolean
  t: DisplayCopy
}) {
  const staticKhqrImageSrc = displayImageSrc(storeKhqrImageUrl)
  const dueAmount = session ? money(session.totalAmount) : null
  const paymentHint = state === 'KHQR'
    ? (khqrFocused ? t.khqrFocusHint : t.khqrHint)
    : state === 'CASH'
      ? t.cashHint
      : t.staticKhqrHint

  return (
    <div style={s.paymentLayout}>
      <div style={s.paymentKicker}>{t.khqrPayment}</div>
      <div style={s.merchantName}>{storeName || t.merchantFallback}</div>
      <div style={{ ...s.paymentAmount, ...(state === 'KHQR' ? s.paymentAmountKhqr : {}) }}>
        {dueAmount ?? t.staticKhqrAmount}
      </div>
      {dueAmount && <div style={s.paymentDueLabel}>{t.amountDue}</div>}
      <div style={{ ...s.staticKhqrFrame, ...(state === 'KHQR' ? s.staticKhqrFrameKhqr : {}) }}>
        {staticKhqrImageSrc ? (
          <img src={staticKhqrImageSrc} alt="KHQR" style={s.staticKhqrImage} />
        ) : (
          <div style={s.noKhqr}>{t.noStoreKhqr}</div>
        )}
      </div>
      <div style={s.paymentHint}>{paymentHint}</div>
      {state === 'KHQR' && <div style={s.paymentInstruction}>{t.khqrInstruction}</div>}
    </div>
  )
})

function LangSwitch({ lang, onChange }: { lang: DesktopLang; onChange: (lang: DesktopLang) => void }) {
  return (
    <div style={s.langSwitch} aria-label="language">
      {(['zh', 'en', 'km'] as const).map((option) => (
        <button key={option} type="button" onClick={() => onChange(option)} style={{ ...s.langButton, ...(lang === option ? s.langButtonActive : {}) }}>
          {option === 'zh' ? '中' : option === 'en' ? 'EN' : 'ខ្មែរ'}
        </button>
      ))}
    </div>
  )
}

function applyRealtimeMessageToDisplayData(current: ApiResp | null, message: CustomerDisplayRealtimeMessage): ApiResp {
  const base: ApiResp = current ?? {
    storeCode: message.storeCode,
    storeName: message.storeCode,
    storeBannerUrl: null,
    storeKhqrImageUrl: null,
    displayProducts: [],
    serverNow: message.sentAt,
    session: null,
  }
  if (message.type === 'CLEAR') {
    return {
      ...base,
      storeCode: base.storeCode || message.storeCode,
      serverNow: message.sentAt,
      session: null,
    }
  }
  return {
    ...base,
    storeCode: base.storeCode || message.storeCode,
    serverNow: message.sentAt,
    session: {
      status: message.status,
      displayStatus: message.status,
      paymentMethod: message.paymentMethod,
      paymentStatus: message.paymentStatus,
      items: message.items,
      totalAmount: message.totalAmount,
      itemCount: message.itemCount,
      khqrPayload: null,
      khqrImageUrl: null,
      orderNo: null,
      message: null,
      completedAt: null,
      updatedAt: message.sentAt,
    },
  }
}

function shouldIgnoreStaleDisplayResponse(
  current: SessionPayload | null,
  next: SessionPayload | null,
  realtimeGuard: CustomerDisplayRealtimeGuard | null = null,
): boolean {
  if (shouldIgnoreServerSessionAfterRealtime(current, next, realtimeGuard)) return true
  if (!current) return false
  const currentUpdatedAt = new Date(current.updatedAt).getTime()
  const nextUpdatedAt = next?.updatedAt ? new Date(next.updatedAt).getTime() : 0
  if (!Number.isFinite(currentUpdatedAt) || !Number.isFinite(nextUpdatedAt)) return false
  const currentIsEmpty = current.items.length === 0 && current.itemCount === 0 && current.totalAmount === 0
  const nextIsEmpty = !next || next.items.length === 0 || next.status === 'CANCELLED'
  if (currentIsEmpty && nextIsEmpty) return nextUpdatedAt <= currentUpdatedAt
  if (!currentIsEmpty && nextIsEmpty) return nextUpdatedAt < currentUpdatedAt
  return false
}

function resolveDesktopLang(value: string | null): DesktopLang {
  return value === 'en' || value === 'km' ? value : 'zh'
}

function displayImageSrc(raw: string | null | undefined) {
  if (!raw) return null
  const value = raw.trim()
  if (!value) return null
  return value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/') || (value.startsWith('data:image/') && value.includes(','))
    ? value
    : null
}

function money(amount: number) {
  return `$${Number.isFinite(amount) ? amount.toFixed(2) : '0.00'}`
}

function formatKhr(amount: number, rate: number) {
  return `៛${Math.round(Math.max(0, amount) * rate).toLocaleString('en-US')}`
}

function formatTime(iso: string, lang: DesktopLang) {
  const locale = lang === 'km' ? 'km-KH' : lang === 'en' ? 'en-US' : 'zh-CN'
  return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function paymentMethodLabel(method: SessionPayload['paymentMethod'], t: DisplayCopy) {
  if (method === 'KHQR') return 'KHQR'
  if (method === 'CASH') return t.cash
  return t.pendingPayment
}

function statusLabel(state: CustomerDisplayPanelState, t: DisplayCopy) {
  if (state === 'KHQR') return t.khqrStatus
  if (state === 'CASH') return t.cashStatus
  if (state === 'ORDER') return t.orderStatus
  if (state === 'COMPLETED') return t.completedStatus
  if (state === 'CANCELLED') return t.cancelledStatus
  if (state === 'EXPIRED') return t.expiredStatus
  return t.idleStatus
}

function statusStyle(state: CustomerDisplayPanelState): CSSProperties {
  if (state === 'KHQR') return { background: '#fef3c7', color: '#92400e' }
  if (state === 'CASH') return { background: '#dbeafe', color: '#1d4ed8' }
  if (state === 'COMPLETED') return { background: '#dcfce7', color: '#15803d' }
  if (state === 'CANCELLED') return { background: '#f3f4f6', color: '#475569' }
  if (state === 'EXPIRED') return { background: '#fffbeb', color: '#b45309' }
  if (state === 'ORDER') return { background: '#e0f2fe', color: '#0369a1' }
  return { background: '#eff6ff', color: '#1d4ed8' }
}

const displayCopy = {
  zh: {
    displayName: '顾客屏', storeCode: '门店', loading: '正在连接门店', missingStoreTitle: '缺少门店参数', missingStoreSub: '请从收银台打开带有 storeCode 的顾客屏链接。',
    enterFullscreen: '全屏', exitFullscreen: '退出全屏', connected: (seconds: number) => `已连接 · ${seconds.toFixed(1)} 秒同步`, updated: '更新于', storeNotFound: '门店不存在或未启用', networkRetry: '网络连接中，正在重试',
    customerEntryPanel: '顾客入口', customerEntryTitle: '顾客服务入口', completedInviteTitle: '谢谢惠顾 · 欢迎再次光临', promotion: '门店推荐', promoFallbackTitle: '精选商品', promoFallbackSub: '欢迎浏览门店商品', welcome: '欢迎光临',
    joinMember: '加入会员', viewCatalog: '查看商品', mobileOrder: '手机下单', scanCustomerEntry: '扫码进入顾客服务',
    orderPanel: '订单商品清单', paymentPanel: 'KHQR 付款区', cartTitle: '本单商品', itemMeta: (count: number, kinds: number) => `${count} 件 · ${kinds} 种商品`, product: '商品', quantity: '数量', unitPrice: '单价', lineTotal: '小计', subtotal: '商品小计', productCount: '商品件数', amountDue: '应付金额',
    waitingOrder: '等待店员录入商品', waitingOrderSub: '商品会实时显示在这里', completed: '交易完成', thanks: '谢谢惠顾，欢迎再次光临', cancelled: '本单已取消', expired: '订单已超时', paymentExpired: '付款已超时', waitingNext: '等待下一笔订单',
    khqrPayment: 'KHQR 收款', merchantFallback: '门店收款', staticKhqrAmount: 'KHQR', noStoreKhqr: '门店暂未配置 KHQR 收款码', staticKhqrHint: '请使用银行应用扫码付款', khqrHint: '请在银行应用中输入并核对以上金额', khqrFocusHint: '请在银行应用中输入并核对以上金额', khqrInstruction: '付款完成后请告知店员', cashHint: '本单使用现金付款',
    cash: '现金', pendingPayment: '待选择', idleStatus: '等待订单', orderStatus: '订单处理中', cashStatus: '现金付款', khqrStatus: 'KHQR 付款', completedStatus: '已完成', cancelledStatus: '已取消', expiredStatus: '已超时',
  },
  en: {
    displayName: 'Customer Display', storeCode: 'Store', loading: 'Connecting store', missingStoreTitle: 'Store code is required', missingStoreSub: 'Open the customer display link with a storeCode from the cashier.',
    enterFullscreen: 'Fullscreen', exitFullscreen: 'Exit fullscreen', connected: (seconds: number) => `Connected · sync ${seconds.toFixed(1)}s`, updated: 'Updated', storeNotFound: 'Store not found or inactive', networkRetry: 'Reconnecting, please wait',
    customerEntryPanel: 'Customer entry', customerEntryTitle: 'Customer services', completedInviteTitle: 'Thank you · See you again', promotion: 'Store pick', promoFallbackTitle: 'Featured products', promoFallbackSub: 'Browse products from this store', welcome: 'Welcome',
    joinMember: 'Join membership', viewCatalog: 'Browse products', mobileOrder: 'Order by phone', scanCustomerEntry: 'Scan for customer services',
    orderPanel: 'Order items', paymentPanel: 'KHQR payment', cartTitle: 'Your items', itemMeta: (count: number, kinds: number) => `${count} item${count === 1 ? '' : 's'} · ${kinds} product type${kinds === 1 ? '' : 's'}`, product: 'Item', quantity: 'Qty', unitPrice: 'Unit price', lineTotal: 'Subtotal', subtotal: 'Items subtotal', productCount: 'Items', amountDue: 'Amount due',
    waitingOrder: 'Waiting for items', waitingOrderSub: 'Selected products will appear here', completed: 'Payment complete', thanks: 'Thank you. Please visit again.', cancelled: 'Order cancelled', expired: 'Order timed out', paymentExpired: 'Payment timed out', waitingNext: 'Waiting for the next order',
    khqrPayment: 'KHQR payment', merchantFallback: 'Store payment', staticKhqrAmount: 'KHQR', noStoreKhqr: 'This store has not configured a KHQR code', staticKhqrHint: 'Use your bank app to scan and pay', khqrHint: 'Enter and verify the amount above in your bank app', khqrFocusHint: 'Enter and verify the amount above in your bank app', khqrInstruction: 'Please tell the cashier after payment', cashHint: 'This order will be paid in cash',
    cash: 'Cash', pendingPayment: 'Select payment', idleStatus: 'Waiting', orderStatus: 'Order in progress', cashStatus: 'Cash payment', khqrStatus: 'KHQR payment', completedStatus: 'Completed', cancelledStatus: 'Cancelled', expiredStatus: 'Timed out',
  },
  km: {
    displayName: 'អេក្រង់អតិថិជន', storeCode: 'ហាង', loading: 'កំពុងភ្ជាប់ហាង', missingStoreTitle: 'ត្រូវការលេខកូដហាង', missingStoreSub: 'សូមបើកតំណអេក្រង់អតិថិជនដែលមាន storeCode ពីកន្លែងគិតលុយ។',
    enterFullscreen: 'ពេញអេក្រង់', exitFullscreen: 'ចាកចេញពេញអេក្រង់', connected: (seconds: number) => `បានភ្ជាប់ · ធ្វើសមកាលកម្ម ${seconds.toFixed(1)} វិ.`, updated: 'បានធ្វើបច្ចុប្បន្នភាព', storeNotFound: 'រកមិនឃើញហាង ឬហាងមិនដំណើរការ', networkRetry: 'កំពុងភ្ជាប់ឡើងវិញ សូមរង់ចាំ',
    customerEntryPanel: 'ច្រកចូលអតិថិជន', customerEntryTitle: 'សេវាកម្មអតិថិជន', completedInviteTitle: 'សូមអរគុណ · សូមមកម្តងទៀត', promotion: 'ការណែនាំពីហាង', promoFallbackTitle: 'ទំនិញពិសេស', promoFallbackSub: 'មើលទំនិញរបស់ហាងនេះ', welcome: 'សូមស្វាគមន៍',
    joinMember: 'ចូលជាសមាជិក', viewCatalog: 'មើលទំនិញ', mobileOrder: 'បញ្ជាទិញតាមទូរស័ព្ទ', scanCustomerEntry: 'ស្កេនសម្រាប់សេវាកម្មអតិថិជន',
    orderPanel: 'បញ្ជីទំនិញ', paymentPanel: 'ការទូទាត់ KHQR', cartTitle: 'ទំនិញក្នុងបង្កាន់ដៃ', itemMeta: (count: number, kinds: number) => `${count} មុខ · ${kinds} ប្រភេទ`, product: 'ទំនិញ', quantity: 'ចំនួន', unitPrice: 'តម្លៃឯកតា', lineTotal: 'សរុបរង', subtotal: 'សរុបទំនិញ', productCount: 'ចំនួនទំនិញ', amountDue: 'ចំនួនត្រូវបង់',
    waitingOrder: 'កំពុងរង់ចាំបញ្ចូលទំនិញ', waitingOrderSub: 'ទំនិញដែលបានជ្រើសនឹងបង្ហាញនៅទីនេះ', completed: 'ការទូទាត់បានសម្រេច', thanks: 'សូមអរគុណ សូមមកម្តងទៀត', cancelled: 'បានបោះបង់បង្កាន់ដៃ', expired: 'បង្កាន់ដៃផុតពេល', paymentExpired: 'ការទូទាត់ផុតពេល', waitingNext: 'កំពុងរង់ចាំបង្កាន់ដៃបន្ទាប់',
    khqrPayment: 'ការទូទាត់ KHQR', merchantFallback: 'ការទូទាត់ហាង', staticKhqrAmount: 'KHQR', noStoreKhqr: 'ហាងនេះមិនទាន់កំណត់លេខកូដ KHQR', staticKhqrHint: 'ប្រើកម្មវិធីធនាគារដើម្បីស្កេន និងបង់ប្រាក់', khqrHint: 'សូមបញ្ចូល និងផ្ទៀងផ្ទាត់ចំនួនខាងលើក្នុងកម្មវិធីធនាគារ', khqrFocusHint: 'សូមបញ្ចូល និងផ្ទៀងផ្ទាត់ចំនួនខាងលើក្នុងកម្មវិធីធនាគារ', khqrInstruction: 'បន្ទាប់ពីបង់ប្រាក់ សូមជូនដំណឹងដល់បុគ្គលិក', cashHint: 'បង្កាន់ដៃនេះបង់ជាសាច់ប្រាក់',
    cash: 'សាច់ប្រាក់', pendingPayment: 'រង់ចាំជ្រើសការទូទាត់', idleStatus: 'កំពុងរង់ចាំ', orderStatus: 'កំពុងដំណើរការ', cashStatus: 'បង់ជាសាច់ប្រាក់', khqrStatus: 'បង់តាម KHQR', completedStatus: 'បានបញ្ចប់', cancelledStatus: 'បានបោះបង់', expiredStatus: 'ផុតពេល',
  },
}

const s: Record<string, CSSProperties> = {
  root: { height: '100vh', minHeight: '560px', overflow: 'hidden', display: 'flex', flexDirection: 'column', color: '#0f172a', background: '#eef4fb', fontFamily: 'Inter, "Noto Sans Khmer", system-ui, sans-serif' },
  header: { minHeight: 68, padding: '10px clamp(12px, 2vw, 28px)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, background: '#fff', borderBottom: '1px solid #dbe7f3', flexShrink: 0 },
  brandBlock: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }, brandIcon: { fontSize: 27 }, brandText: { minWidth: 0 }, storeName: { fontSize: 'clamp(17px, 2vw, 24px)', lineHeight: 1.15, fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, storeMeta: { marginTop: 3, fontSize: 12, color: '#64748b' },
  headerActions: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }, statusPill: { borderRadius: 999, padding: '6px 10px', fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap' }, headerButton: { border: '1px solid #cbd5e1', borderRadius: 8, padding: '6px 9px', background: '#fff', color: '#334155', fontSize: 12, fontWeight: 800, cursor: 'pointer' },
  langSwitch: { display: 'flex', padding: 2, borderRadius: 8, background: '#e2e8f0' }, langButton: { border: 0, borderRadius: 6, padding: '5px 7px', background: 'transparent', color: '#475569', fontSize: 11, fontWeight: 800, cursor: 'pointer' }, langButtonActive: { background: '#fff', color: '#1d4ed8', boxShadow: '0 1px 3px rgba(15,23,42,.14)' },
  panelGrid: { flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '22fr minmax(0, 52fr) 26fr', gap: 'clamp(7px, 1vw, 14px)', padding: 'clamp(7px, 1vw, 14px)', overflow: 'hidden', transition: 'grid-template-columns 180ms ease' }, panelGridKhqr: { gridTemplateColumns: '18fr minmax(0, 42fr) 40fr' },
  entryPanel: { minWidth: 0, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 'clamp(6px, .8vw, 10px)', padding: 'clamp(9px, 1.15vw, 16px)', borderRadius: 16, background: 'linear-gradient(160deg, #123a70, #0b5ba6)', color: '#fff', boxShadow: '0 10px 24px rgba(30,64,175,.16)' }, entryPanelPromoted: { background: 'linear-gradient(160deg, #0f766e, #0e7490)', boxShadow: '0 12px 28px rgba(13,148,136,.28)' }, entryHeading: { fontSize: 'clamp(14px, 1.45vw, 20px)', fontWeight: 950, lineHeight: 1.2 }, entryStore: { fontSize: 'clamp(11px, 1.15vw, 14px)', opacity: .82, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  promoCard: { minHeight: 0, display: 'flex', gap: 8, alignItems: 'center', padding: 8, borderRadius: 12, background: 'rgba(255,255,255,.14)', overflow: 'hidden' }, promoImage: { width: 'clamp(44px, 5vw, 70px)', aspectRatio: '1', objectFit: 'cover', borderRadius: 9, flexShrink: 0, background: '#dbeafe' }, promoFallback: { width: 'clamp(44px, 5vw, 70px)', aspectRatio: '1', display: 'grid', placeItems: 'center', borderRadius: 9, background: 'rgba(255,255,255,.18)', fontSize: 24, flexShrink: 0 }, promoBody: { minWidth: 0 }, promoLabel: { fontSize: 10, fontWeight: 800, opacity: .76 }, promoTitle: { marginTop: 2, fontSize: 'clamp(12px, 1.25vw, 16px)', fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, promoSub: { marginTop: 2, fontSize: 11, opacity: .82, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  customerQrCard: { display: 'flex', width: 'min(100%, 178px)', alignSelf: 'center', padding: 6, borderRadius: 12, background: '#fff', boxShadow: '0 8px 20px rgba(15,23,42,.22)' }, customerQr: { width: '100%', height: 'auto', display: 'block' }, customerEntryActions: { display: 'grid', gap: 4, textAlign: 'center', fontSize: 'clamp(10px, 1.05vw, 13px)', fontWeight: 900, lineHeight: 1.25 }, customerEntryHint: { marginTop: 'auto', paddingTop: 3, textAlign: 'center', fontSize: 'clamp(9px, .9vw, 12px)', opacity: .86 },
  orderPanel: { minWidth: 0, minHeight: 0, overflow: 'hidden', borderRadius: 16, background: '#fff', boxShadow: '0 10px 24px rgba(15,23,42,.08)' }, cartLayout: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', padding: 'clamp(10px, 1.2vw, 18px)' }, cartHeading: { display: 'flex', justifyContent: 'space-between', gap: 10, paddingBottom: 10, borderBottom: '1px solid #e2e8f0', flexShrink: 0 }, cartTitle: { fontSize: 'clamp(18px, 2vw, 28px)', fontWeight: 950 }, cartMeta: { marginTop: 3, fontSize: 12, color: '#64748b' }, methodBadge: { alignSelf: 'start', borderRadius: 999, padding: '5px 8px', background: '#eff6ff', color: '#1d4ed8', fontSize: 11, fontWeight: 900, whiteSpace: 'nowrap' },
  cartColumns: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 48px 76px 84px', gap: 8, padding: '9px 0 6px', color: '#64748b', fontSize: 'clamp(10px, 1vw, 12px)', fontWeight: 900, borderBottom: '1px solid #eef2f7', flexShrink: 0 }, cartRows: { minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }, cartRow: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 48px 76px 84px', gap: 8, alignItems: 'center', minHeight: 58, padding: '7px 0', borderBottom: '1px solid #f1f5f9', fontSize: 'clamp(11px, 1.05vw, 14px)' }, productCell: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }, productImage: { width: 38, height: 38, flexShrink: 0, borderRadius: 8, objectFit: 'cover', background: '#f1f5f9' }, productPlaceholder: { width: 38, height: 38, flexShrink: 0, display: 'grid', placeItems: 'center', borderRadius: 8, background: '#f1f5f9', fontSize: 18 }, productText: { minWidth: 0 }, productName: { fontWeight: 850, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, productSpec: { marginTop: 2, color: '#64748b', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, numericCell: { textAlign: 'right', whiteSpace: 'nowrap' }, lineAmount: { textAlign: 'right', whiteSpace: 'nowrap', color: '#0f172a' },
  orderSummary: { marginTop: 'auto', paddingTop: 9, borderTop: '1px solid #cbd5e1', flexShrink: 0 }, summaryLine: { display: 'flex', justifyContent: 'space-between', gap: 10, color: '#475569', fontSize: 12, lineHeight: 1.6 }, dueLine: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', marginTop: 4, color: '#0f172a', fontSize: 'clamp(17px, 2.1vw, 28px)', fontWeight: 900 }, dueCurrency: { textAlign: 'right', color: '#0369a1', fontSize: 'clamp(13px, 1.5vw, 18px)', fontWeight: 850 },
  emptyOrder: { height: '100%', display: 'grid', placeContent: 'center', gap: 8, padding: 24, textAlign: 'center', color: '#64748b' }, emptyOrderIcon: { fontSize: 52 }, emptyOrderTitle: { color: '#334155', fontSize: 'clamp(20px, 2.5vw, 32px)', fontWeight: 900 }, emptyOrderSub: { fontSize: 14 }, terminalPanel: { height: '100%', display: 'grid', placeContent: 'center', gap: 10, padding: 24, textAlign: 'center' }, terminalIcon: { fontSize: 68, lineHeight: 1, fontWeight: 900 }, terminalTitle: { fontSize: 'clamp(24px, 3vw, 40px)', fontWeight: 950 }, terminalAmount: { color: '#0f766e', fontSize: 'clamp(34px, 4.8vw, 64px)', lineHeight: 1, fontWeight: 950 }, terminalCurrency: { color: '#0369a1', fontSize: 'clamp(17px, 2vw, 27px)', fontWeight: 900 }, terminalSub: { color: '#64748b', fontSize: 'clamp(14px, 1.5vw, 20px)', fontWeight: 700 },
  paymentPanel: { minWidth: 0, minHeight: 0, overflow: 'hidden', borderRadius: 16, background: 'linear-gradient(160deg, #eff6ff, #fff)', border: '1px solid #bfdbfe', boxShadow: '0 10px 24px rgba(30,64,175,.12)', transition: 'all 180ms ease' }, paymentPanelKhqr: { border: '2px solid #2563eb', boxShadow: '0 16px 32px rgba(37,99,235,.25)' }, paymentLayout: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 'clamp(10px, 1.35vw, 20px)', textAlign: 'center' }, paymentKicker: { color: '#1d4ed8', fontSize: 'clamp(13px, 1.3vw, 18px)', fontWeight: 950, letterSpacing: '.03em' }, merchantName: { maxWidth: '100%', marginTop: 4, fontSize: 'clamp(12px, 1.25vw, 17px)', color: '#475569', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, paymentAmount: { marginTop: 9, color: '#0f172a', fontSize: 'clamp(24px, 3vw, 42px)', fontWeight: 950, lineHeight: 1.05, whiteSpace: 'nowrap' }, paymentAmountKhqr: { color: '#b45309', fontSize: 'clamp(38px, 5.2vw, 76px)' }, paymentDueLabel: { marginTop: 3, color: '#64748b', fontSize: 12, fontWeight: 800 },
  staticKhqrFrame: { flex: 1, minHeight: 0, width: '100%', display: 'grid', placeItems: 'center', margin: 'clamp(8px, 1vw, 14px) 0', padding: 7, borderRadius: 14, background: '#fff', border: '1px solid #dbeafe' }, staticKhqrFrameKhqr: { border: '2px solid #60a5fa', boxShadow: '0 10px 22px rgba(37,99,235,.15)' }, staticKhqrImage: { display: 'block', width: '100%', maxWidth: 340, maxHeight: '100%', objectFit: 'contain', borderRadius: 8 }, noKhqr: { maxWidth: 180, color: '#64748b', fontSize: 'clamp(12px, 1.1vw, 15px)', fontWeight: 700, lineHeight: 1.5 }, paymentHint: { color: '#334155', fontSize: 'clamp(11px, 1.15vw, 15px)', fontWeight: 850, lineHeight: 1.4 }, paymentInstruction: { marginTop: 7, color: '#1d4ed8', fontSize: 'clamp(11px, 1.15vw, 15px)', fontWeight: 950, lineHeight: 1.4 },
  footer: { minHeight: 32, padding: '7px clamp(12px, 2vw, 28px)', display: 'flex', justifyContent: 'space-between', gap: 12, background: '#fff', borderTop: '1px solid #dbe7f3', color: '#64748b', fontSize: 11, flexShrink: 0 }, footerOk: { color: '#15803d' }, footerError: { color: '#dc2626' }, footerMeta: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  errScreen: { minHeight: '100vh', display: 'grid', placeContent: 'center', gap: 12, padding: 28, textAlign: 'center', background: '#eef4fb' }, errIcon: { fontSize: 52 }, errTitle: { fontSize: 24, fontWeight: 900 }, errSub: { maxWidth: 480, color: '#64748b', lineHeight: 1.6 },
}
