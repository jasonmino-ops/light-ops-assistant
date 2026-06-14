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
  price: number
  qty: number
  lineAmount: number
}

type SessionPayload = {
  status: 'DRAFT' | 'AWAITING_PAYMENT' | 'COMPLETED' | 'CANCELLED' | string
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
  serverNow: string
  session: SessionPayload | null
  recentOrders?: RecentOrder[]
}

type RecentOrder = {
  orderNo: string
  totalAmount: number
  paymentMethod: 'CASH' | 'KHQR' | string | null
  status: string
  createdAt: string
}

type DesktopLang = 'zh' | 'en' | 'km'
type DisplayCopy = typeof displayCopy.zh

const POLL_MS = 1500
const COMPLETED_LINGER_MS = 8000  // 完成态展示 8 秒后回到 idle

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
  const recentlyCompleted = session?.status === 'COMPLETED' && completedAtMs > 0 && (now - completedAtMs) < COMPLETED_LINGER_MS
  const recentlyCancelled = session?.status === 'CANCELLED' && completedAtMs > 0 && (now - completedAtMs) < COMPLETED_LINGER_MS
  const isLive = !!session && (session.status === 'DRAFT' || session.status === 'AWAITING_PAYMENT') && session.items.length > 0
  const isIdle = !isLive && !recentlyCompleted && !recentlyCancelled

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
      </div>

      {/* Body: 左 = 商品列表，右 = 金额与收款 */}
      <div style={s.body}>
        <div style={s.cartCol}>
          {isLive ? (
            <CartList items={session!.items} t={t} />
          ) : recentlyCompleted ? (
            <CompletedCard session={session!} t={t} />
          ) : recentlyCancelled ? (
            <CancelledCard t={t} />
          ) : (
            <IdleCard t={t} />
          )}
        </div>

        <div style={s.payCol}>
          <div style={s.totalCard}>
            <div style={s.totalLabel}>{t.amountDue}</div>
            <div style={s.totalAmt}>${(session?.totalAmount ?? 0).toFixed(2)}</div>
            <div style={s.totalMeta}>
              {isLive && t.itemMeta(session!.itemCount, session!.items.length)}
              {recentlyCompleted && t.completed}
              {recentlyCancelled && t.cancelled}
              {isIdle && t.waitingOrder}
            </div>
          </div>

          <PaymentCard session={session} recentlyCompleted={recentlyCompleted} t={t} />
          <RecentOrders orders={data?.recentOrders ?? []} t={t} />
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

function CartList({ items, t }: { items: PosItem[]; t: DisplayCopy }) {
  return (
    <div style={s.cartList}>
      <div style={s.cartTitle}>{t.cartTitle}</div>
      {items.map((it) => (
        <div key={it.productId + '-' + it.qty} style={s.cartRow}>
          <div style={s.cartName}>
            {it.name}
            {it.spec && <span style={s.cartSpec}> · {it.spec}</span>}
          </div>
          <div style={s.cartQty}>{it.qty} × ${it.price.toFixed(2)}</div>
          <div style={s.cartLine}>${it.lineAmount.toFixed(2)}</div>
        </div>
      ))}
    </div>
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

function IdleCard({ t }: { t: DisplayCopy }) {
  return (
    <div style={s.bigCard}>
      <div style={{ ...s.bigIcon, color: '#cbd5e1' }}>🛒</div>
      <div style={s.bigTitle}>{t.welcome}</div>
      <div style={s.bigSub}>{t.waitingCashier}</div>
    </div>
  )
}

function RecentOrders({ orders, t }: { orders: RecentOrder[]; t: DisplayCopy }) {
  return (
    <div style={s.recentCard}>
      <div style={s.recentTitle}>{t.recentOrders}</div>
      {orders.length === 0 ? (
        <div style={s.recentEmpty}>{t.noRecentOrders}</div>
      ) : orders.slice(0, 3).map((o) => (
        <div key={o.orderNo} style={s.recentRow}>
          <div style={s.recentNo}>{shortOrderNo(o.orderNo)}</div>
          <div style={s.recentMeta}>
            {paymentMethodLabel(o.paymentMethod, t)} · {o.status}
          </div>
          <div style={s.recentAmount}>${o.totalAmount.toFixed(2)}</div>
        </div>
      ))}
    </div>
  )
}

function PaymentCard({ session, recentlyCompleted, t }: { session: SessionPayload | null; recentlyCompleted: boolean; t: DisplayCopy }) {
  if (!session || (session.items.length === 0 && !recentlyCompleted)) {
    return (
      <div style={s.payCard}>
        <div style={s.payLabel}>{t.paymentMethod}</div>
        <div style={s.payIdle}>—</div>
      </div>
    )
  }

  const showKhqr = session.status === 'AWAITING_PAYMENT'
    && session.paymentMethod === 'KHQR'
    && (session.khqrImageUrl || session.khqrPayload)

  return (
    <div style={s.payCard}>
      <div style={s.payLabel}>
        {t.paymentMethod}
        {session.paymentMethod && (
          <span style={s.payTag}>
            {paymentMethodLabel(session.paymentMethod, t)}
          </span>
        )}
        {session.paymentStatus === 'PAID' && <span style={s.paidTag}>{t.paid}</span>}
      </div>
      {showKhqr ? (
        <div style={s.qrWrap}>
          {session.khqrImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={session.khqrImageUrl} alt="KHQR" style={s.qrImage} />
          ) : (
            <QRCode value={session.khqrPayload || ''} size={220} />
          )}
          <div style={s.qrHint}>{t.scanToPay}</div>
        </div>
      ) : (
        <div style={s.payIdle}>
          {session.status === 'AWAITING_PAYMENT' ? t.waitingPaymentMethod :
           session.status === 'DRAFT' ? t.draftNoPayment :
           session.status === 'COMPLETED' ? t.completed :
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
  if (!s || s.items.length === 0) return t.idle
  if (s.status === 'AWAITING_PAYMENT') return t.collecting
  return t.draft
}

function statusPillStyle(sess: SessionPayload | null, completed: boolean, cancelled: boolean): CSSProperties {
  if (completed) return { background: '#dcfce7', color: '#15803d' }
  if (cancelled) return { background: '#f3f4f6', color: '#6b7280' }
  if (!sess || sess.items.length === 0) return { background: '#e0f2fe', color: '#0369a1' }
  if (sess.status === 'AWAITING_PAYMENT') return { background: '#fef3c7', color: '#92400e' }
  return { background: '#dbeafe', color: '#1d4ed8' }
}

function fmtTime(iso: string, lang: DesktopLang): string {
  const locale = lang === 'km' ? 'km-KH' : lang === 'en' ? 'en-US' : 'zh-CN'
  return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function shortOrderNo(orderNo: string): string {
  const tail = orderNo.split('-').pop() ?? orderNo
  return `#${tail.slice(-6) || tail}`
}

function resolveDesktopLang(raw: string | null): DesktopLang {
  if (raw === 'en' || raw === 'km' || raw === 'zh') return raw
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem('lang')
    if (stored === 'km' || stored === 'zh') return stored
  }
  return 'zh'
}

function paymentMethodLabel(method: string | null, t: DisplayCopy) {
  if (method === 'CASH') return `💵 ${t.cash}`
  if (method === 'KHQR') return '📱 KHQR'
  return '—'
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
    waitingOrder: '等待新订单',
    waitingNext: '等待下一单',
    cartTitle: '当前订单',
    orderNo: '单号',
    thanks: '谢谢光临',
    welcome: '欢迎光临',
    waitingCashier: '等待收银 · 支持 CASH / KHQR',
    recentOrders: '最近订单',
    noRecentOrders: '暂无最近订单',
    paymentMethod: '收款方式',
    paid: '已收款',
    scanToPay: '请扫码付款',
    waitingPaymentMethod: '等待手机端选择收款方式',
    draftNoPayment: '草稿中 · 尚未发起收款',
    connected: (seconds: number) => `已连接 · 每 ${seconds}s 刷新`,
    updated: 'updated',
    itemMeta: (count: number, kinds: number) => `${count} 件 · ${kinds} 种`,
    completedShort: '已完成',
    cancelledShort: '已取消',
    idle: '空闲中',
    collecting: '收款中',
    draft: '草稿中',
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
    waitingOrder: 'Waiting for next order',
    waitingNext: 'Waiting for next order',
    cartTitle: 'Current Order',
    orderNo: 'Order',
    thanks: 'Thank you',
    welcome: 'Welcome',
    waitingCashier: 'Waiting for cashier · CASH / KHQR supported',
    recentOrders: 'Recent Orders',
    noRecentOrders: 'No recent orders',
    paymentMethod: 'Payment Method',
    paid: 'Paid',
    scanToPay: 'Please scan to pay',
    waitingPaymentMethod: 'Waiting for payment method on phone',
    draftNoPayment: 'Draft · Payment not started',
    connected: (seconds: number) => `Connected · refreshes every ${seconds}s`,
    updated: 'updated',
    itemMeta: (count: number, kinds: number) => `${count} items · ${kinds} kinds`,
    completedShort: 'Completed',
    cancelledShort: 'Cancelled',
    idle: 'Idle',
    collecting: 'Collecting',
    draft: 'Draft',
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
    waitingOrder: 'រង់ចាំការបញ្ជាទិញថ្មី',
    waitingNext: 'រង់ចាំការបញ្ជាទិញបន្ទាប់',
    cartTitle: 'ការបញ្ជាទិញបច្ចុប្បន្ន',
    orderNo: 'លេខវិក្កយបត្រ',
    thanks: 'អរគុណ',
    welcome: 'សូមស្វាគមន៍',
    waitingCashier: 'រង់ចាំបញ្ជរ · គាំទ្រ CASH / KHQR',
    recentOrders: 'ការបញ្ជាទិញថ្មីៗ',
    noRecentOrders: 'មិនទាន់មានការបញ្ជាទិញថ្មីៗ',
    paymentMethod: 'វិធីបង់ប្រាក់',
    paid: 'បានទទួលប្រាក់',
    scanToPay: 'សូមស្កេនដើម្បីបង់ប្រាក់',
    waitingPaymentMethod: 'រង់ចាំជ្រើសរើសវិធីបង់ប្រាក់ពីទូរស័ព្ទ',
    draftNoPayment: 'ព្រាង · មិនទាន់ចាប់ផ្តើមបង់ប្រាក់',
    connected: (seconds: number) => `បានភ្ជាប់ · ធ្វើបច្ចុប្បន្នភាពរៀងរាល់ ${seconds}s`,
    updated: 'បានធ្វើបច្ចុប្បន្នភាព',
    itemMeta: (count: number, kinds: number) => `${count} មុខ · ${kinds} ប្រភេទ`,
    completedShort: 'បានបញ្ចប់',
    cancelledShort: 'បានលុប',
    idle: 'ទំនេរ',
    collecting: 'កំពុងទទួលប្រាក់',
    draft: 'ព្រាង',
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

  body: { flex: 1, display: 'grid', gridTemplateColumns: '1fr 380px', gap: 12, padding: 12, minHeight: 0 },
  cartCol: { background: '#fff', borderRadius: 14, padding: 18, overflow: 'auto', boxShadow: '0 1px 3px rgba(0,0,0,.05)' },
  payCol: { display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 },

  cartList: { display: 'flex', flexDirection: 'column' },
  cartTitle: { fontSize: 13, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 12 },
  cartRow: { display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'baseline', gap: 16, padding: '14px 4px', borderBottom: '1px solid #f1f5f9' },
  cartName: { fontSize: 18, fontWeight: 600, color: '#111827' },
  cartSpec: { fontSize: 14, color: '#9ca3af', fontWeight: 400 },
  cartQty: { fontSize: 14, color: '#6b7280', whiteSpace: 'nowrap' },
  cartLine: { fontSize: 18, fontWeight: 700, color: '#111827', minWidth: 80, textAlign: 'right' },

  totalCard: { background: '#fff', borderRadius: 14, padding: 20, textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,.05)' },
  totalLabel: { fontSize: 12, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' },
  totalAmt: { fontSize: 48, fontWeight: 800, color: ACCENT, marginTop: 6, letterSpacing: '-1px' },
  totalMeta: { fontSize: 13, color: '#9ca3af', marginTop: 6 },

  payCard: { flex: 1, background: '#fff', borderRadius: 14, padding: 20, display: 'flex', flexDirection: 'column', boxShadow: '0 1px 3px rgba(0,0,0,.05)', minHeight: 0 },
  payLabel: { fontSize: 13, color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  payTag: { padding: '2px 10px', background: '#dbeafe', color: '#1d4ed8', borderRadius: 999, fontSize: 12, fontWeight: 700 },
  paidTag: { padding: '2px 10px', background: '#dcfce7', color: '#15803d', borderRadius: 999, fontSize: 12, fontWeight: 700 },
  payIdle: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#cbd5e1', fontSize: 14, marginTop: 10 },

  qrWrap: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 10 },
  qrImage: { maxWidth: 240, maxHeight: 240, width: '100%', objectFit: 'contain', borderRadius: 8, border: '1px solid #f0f0f0' },
  qrHint: { fontSize: 14, color: '#6b7280' },

  recentCard: { background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.05)' },
  recentTitle: { fontSize: 13, color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 },
  recentEmpty: { fontSize: 13, color: '#cbd5e1', padding: '10px 0' },
  recentRow: { display: 'grid', gridTemplateColumns: '70px 1fr auto', gap: 8, alignItems: 'center', padding: '8px 0', borderTop: '1px solid #f1f5f9' },
  recentNo: { fontSize: 13, fontWeight: 800, color: '#0f172a', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  recentMeta: { fontSize: 12, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  recentAmount: { fontSize: 13, fontWeight: 800, color: '#0f172a' },

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
