'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import ELifeBottomNav from '../components/ELifeBottomNav'

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

function resolveCustomerServiceAccount() {
  const botUsername = cleanBotUsername(
    process.env.NEXT_PUBLIC_SUPPORT_BOT_USERNAME
      || process.env.NEXT_PUBLIC_CUSTOMER_SERVICE_BOT_USERNAME
      || process.env.NEXT_PUBLIC_CUSTOMER_BOT_USERNAME
  )
  if (botUsername) return `@${botUsername}`

  const match = CUSTOMER_SERVICE_URL.match(/^https:\/\/t\.me\/([a-zA-Z0-9_]+)/)
  return match ? `@${match[1]}` : '@Eshop_sale_bot'
}

const CUSTOMER_SERVICE_ACCOUNT = resolveCustomerServiceAccount()

function isTelegramServiceLink(url: string) {
  return url.startsWith('https://t.me/') || url.startsWith('tg://resolve')
}

type Lang = 'zh' | 'en' | 'km'

const T = {
  zh: {
    title:      '我的订单',
    sub:        '跨商户订单历史',
    loading:    '加载中…',
    empty:      '暂无订单',
    emptyHint:  '去首页逛逛',
    noTg:       '请在 Telegram 中打开以查看订单',
    noTgHint:   '普通浏览器暂时无法识别您的 Telegram 身份',
    orderNo:    '订单号',
    items:      '商品',
    status:     '订单状态',
    payment:    '支付状态',
    createdAt:  '下单时间',
    contactService: '联系客服',
    serviceDesc: '如需订单帮助、商户问题或平台咨询，请联系 E-Life 客服',
    serviceAccount: '客服账号',
    openService: '打开 Telegram 客服',
    copyService: '复制客服账号',
    copiedService: '已复制客服账号',
    serviceOpenFailed: '请复制客服账号后在 Telegram 搜索联系',
    close:      '关闭',
    navHome:    '首页',
    navCategory:'分类',
    navOrders:  '订单',
    navMe:      '我的',
    statusPending:   '待确认',
    statusConfirmed: '已确认',
    statusCompleted: '已完成',
    statusCancelled: '已取消',
    paid:   '已收款',
    unpaid: '未收款',
    more: (n: number) => `等${n + 1}件`,
  },
  en: {
    title:      'My Orders',
    sub:        'Cross-store order history',
    loading:    'Loading…',
    empty:      'No orders yet',
    emptyHint:  'Browse the home page',
    noTg:       'Open in Telegram to view orders',
    noTgHint:   'The browser cannot identify your Telegram account yet',
    orderNo:    'Order No.',
    items:      'Items',
    status:     'Status',
    payment:    'Payment',
    createdAt:  'Order time',
    contactService: 'Customer Service',
    serviceDesc: 'For order help, merchant issues, or platform questions, contact E-Life customer service.',
    serviceAccount: 'Service account',
    openService: 'Open Telegram service',
    copyService: 'Copy service account',
    copiedService: 'Service account copied',
    serviceOpenFailed: 'Please copy the account and search it in Telegram',
    close:      'Close',
    navHome:    'Home',
    navCategory:'Category',
    navOrders:  'Orders',
    navMe:      'Me',
    statusPending:   'Pending',
    statusConfirmed: 'Confirmed',
    statusCompleted: 'Completed',
    statusCancelled: 'Cancelled',
    paid:   'Paid',
    unpaid: 'Unpaid',
    more: (n: number) => `+${n} more`,
  },
  km: {
    title:      'ការបញ្ជាទិញ',
    sub:        'ប្រវត្តិបញ្ជាទិញ',
    loading:    'កំពុងផ្ទុក…',
    empty:      'គ្មានការបញ្ជាទិញ',
    emptyHint:  'ត្រឡប់ទំព័រដើម',
    noTg:       'សូមបើកក្នុង Telegram ដើម្បីមើលការបញ្ជាទិញ',
    noTgHint:   'កម្មវិធីរុករកមិនទាន់អាចស្គាល់គណនី Telegram របស់អ្នកបានទេ',
    orderNo:    'លេខបញ្ជាទិញ',
    items:      'ទំនិញ',
    status:     'ស្ថានភាព',
    payment:    'ការទូទាត់',
    createdAt:  'ពេលបញ្ជាទិញ',
    contactService: 'ជំនួយ',
    serviceDesc: 'សម្រាប់ជំនួយការបញ្ជាទិញ បញ្ហាហាង ឬសំណួរអំពីប្រព័ន្ធ សូមទាក់ទងជំនួយ E-Life',
    serviceAccount: 'គណនីជំនួយ',
    openService: 'បើកជំនួយ Telegram',
    copyService: 'ចម្លងគណនីជំនួយ',
    copiedService: 'បានចម្លងគណនីជំនួយ',
    serviceOpenFailed: 'សូមចម្លងគណនី ហើយស្វែងរកក្នុង Telegram',
    close:      'បិទ',
    navHome:    'ទំព័រដើម',
    navCategory:'ប្រភេទ',
    navOrders:  'ការបញ្ជាទិញ',
    navMe:      'ខ្ញុំ',
    statusPending:   'រង់ចាំ',
    statusConfirmed: 'បានបញ្ជាក់',
    statusCompleted: 'បានបញ្ចប់',
    statusCancelled: 'បានលុបចោល',
    paid:   'បានបង់',
    unpaid: 'មិនទាន់បង់',
    more: (n: number) => `+${n}`,
  },
}

const STATUS_COLOR: Record<string, string> = {
  PENDING:   '#fa8c16',
  CONFIRMED: '#1677ff',
  COMPLETED: BRAND,
  CANCELLED: '#bbb',
}

type Order = {
  id: string
  orderNo: string
  storeCode: string
  storeName: string
  itemCount: number
  firstItem: string
  extraCount: number
  totalAmount: number
  status: string
  paymentStatus: string
  createdAt: string
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) +
    ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

export default function ELifeOrdersPage() {
  const router = useRouter()
  const [lang,    setLang]    = useState<Lang>('zh')
  const [orders,  setOrders]  = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [noTg,    setNoTg]    = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [showServicePanel, setShowServicePanel] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    try {
      const saved = localStorage.getItem('eLife_lang') as Lang | null
      if (saved && (['zh', 'en', 'km'] as string[]).includes(saved)) setLang(saved)
    } catch { /* ignore */ }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tg = (window as any).Telegram?.WebApp
    tg?.expand?.()

    // 无 initData（浏览器直接访问）→ 不发请求，直接显示"请在 Telegram 中打开"
    if (!tg?.initData) {
      setNoTg(true)
      setLoading(false)
      return
    }

    // POST initData 给后端，由后端校验 HMAC，不在前端传 tgId
    fetch('/api/e-life/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: tg.initData }),
    })
      .then((r) => r.json())
      .then((body) => {
        if (body.error === 'INVALID_TELEGRAM_AUTH' || body.error === 'MISSING_INIT_DATA') {
          setNoTg(true)
        } else {
          setOrders(body.orders ?? [])
        }
      })
      .catch(() => { /* silent — show empty state */ })
      .finally(() => setLoading(false))
  }, [])

  const t = T[lang]

  function statusLabel(s: string) {
    if (s === 'PENDING')   return t.statusPending
    if (s === 'CONFIRMED') return t.statusConfirmed
    if (s === 'COMPLETED') return t.statusCompleted
    if (s === 'CANCELLED') return t.statusCancelled
    return s
  }

  function itemSummary(o: Order) {
    if (o.extraCount <= 0) return o.firstItem
    return o.firstItem + ' ' + t.more(o.extraCount)
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2200)
  }

  function openCustomerService() {
    const url = CUSTOMER_SERVICE_URL.trim()
    if (!url) return

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

  async function copyCustomerServiceAccount() {
    try {
      await navigator.clipboard.writeText(CUSTOMER_SERVICE_ACCOUNT)
      showToast(t.copiedService)
    } catch {
      showToast(CUSTOMER_SERVICE_ACCOUNT)
      window.alert?.(CUSTOMER_SERVICE_ACCOUNT)
    }
  }

  return (
    <div style={s.page}>

      {/* ── Header ── */}
      <header style={s.header}>
        <button style={s.backBtn} onClick={() => router.push('/e-life')}>
          <ChevronLeftIcon />
        </button>
        <div style={s.headerCenter}>
          <h1 style={s.headerTitle}>{t.title}</h1>
          <p style={s.headerSub}>{t.sub}</p>
        </div>
        <div style={{ width: 36 }} />
      </header>

      {/* ── Body ── */}
      <main style={s.main}>
        {loading ? (
          <div style={s.center}><span style={{ color: '#bbb', fontSize: 14 }}>{t.loading}</span></div>
        ) : noTg && orders.length === 0 ? (
          <div style={s.center}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>💬</div>
            <p style={s.emptyText}>{t.noTg}</p>
            <p style={s.emptyHintText}>{t.noTgHint}</p>
            <button style={s.homeBtn} onClick={() => router.push('/e-life')}>{t.emptyHint}</button>
            <button style={s.supportBtn} onClick={() => setShowServicePanel(true)}>{t.contactService}</button>
          </div>
        ) : orders.length === 0 ? (
          <div style={s.center}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📭</div>
            <p style={s.emptyText}>{t.empty}</p>
            <button style={s.homeBtn} onClick={() => router.push('/e-life')}>{t.emptyHint}</button>
            <button style={s.supportBtn} onClick={() => setShowServicePanel(true)}>{t.contactService}</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button style={s.topSupportBtn} onClick={() => setShowServicePanel(true)}>{t.contactService}</button>
            {orders.map((order) => {
              const color = STATUS_COLOR[order.status] ?? '#bbb'
              return (
                <div
                  key={order.id}
                  style={s.card}
                  onClick={() => setSelectedOrder(order)}
                >
                  {/* 店铺行 */}
                  <div style={s.cardTop}>
                    <div style={s.storeName}>{order.storeName}</div>
                    <div style={{ fontSize: 11, color: '#bbb' }}>{fmtDate(order.createdAt)}</div>
                  </div>
                  {/* 商品摘要行 */}
                  <div style={s.itemRow}>{itemSummary(order)}</div>
                  {/* 状态 + 金额行 */}
                  <div style={s.cardBottom}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ ...s.dot, background: color }} />
                      <span style={{ fontSize: 12, color, fontWeight: 600 }}>{statusLabel(order.status)}</span>
                      {order.status === 'COMPLETED' && (
                        <span style={{ fontSize: 11, color: '#bbb' }}>
                          · {order.paymentStatus === 'PAID' ? t.paid : t.unpaid}
                        </span>
                      )}
                    </div>
                    <div style={s.amount}>${order.totalAmount.toFixed(2)}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>

      {selectedOrder && (
        <>
          <div style={s.overlay} onClick={() => setSelectedOrder(null)} />
          <div style={s.detailSheet}>
            <h3 style={s.sheetTitle}>{selectedOrder.storeName}</h3>
            <div style={s.detailRows}>
              <DetailRow label={t.orderNo} value={selectedOrder.orderNo} />
              <DetailRow label={t.items} value={itemSummary(selectedOrder)} />
              <DetailRow label={t.status} value={statusLabel(selectedOrder.status)} />
              <DetailRow label={t.payment} value={selectedOrder.paymentStatus === 'PAID' ? t.paid : t.unpaid} />
              <DetailRow label={t.createdAt} value={fmtDate(selectedOrder.createdAt)} />
            </div>
            <div style={s.detailAmount}>${selectedOrder.totalAmount.toFixed(2)}</div>
            <button style={s.servicePrimaryBtn} onClick={() => setShowServicePanel(true)}>{t.contactService}</button>
            <button style={s.serviceSecondaryBtn} onClick={() => setSelectedOrder(null)}>{t.close}</button>
          </div>
        </>
      )}

      {showServicePanel && (
        <>
          <div style={s.overlay} onClick={() => setShowServicePanel(false)} />
          <div style={s.serviceSheet}>
            <div style={s.serviceIcon}>💬</div>
            <h3 style={s.sheetTitle}>{t.contactService}</h3>
            <p style={s.serviceDesc}>{t.serviceDesc}</p>
            <div style={s.serviceAccountBox}>
              <span style={s.serviceAccountLabel}>{t.serviceAccount}</span>
              <strong style={s.serviceAccountValue}>{CUSTOMER_SERVICE_ACCOUNT}</strong>
            </div>
            <button style={s.servicePrimaryBtn} onClick={openCustomerService}>{t.openService}</button>
            <button style={s.serviceSecondaryBtn} onClick={copyCustomerServiceAccount}>{t.copyService}</button>
          </div>
        </>
      )}

      {toast && <div style={s.toast}>{toast}</div>}

      <ELifeBottomNav lang={lang} />
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={s.detailRow}>
      <span style={s.detailLabel}>{label}</span>
      <span style={s.detailValue}>{value}</span>
    </div>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function ChevronLeftIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  )
}


// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100dvh',
    background: '#F7F8FA',
    maxWidth: 448,
    margin: '0 auto',
    paddingBottom: 80,
    position: 'relative',
  },

  header: {
    position: 'sticky',
    top: 0,
    zIndex: 50,
    background: 'linear-gradient(to bottom, #EEFBF3, #ffffff)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px 10px',
    borderBottom: '1px solid rgba(0,0,0,0.05)',
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    background: 'rgba(0,0,0,0.05)',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    color: '#333',
    flexShrink: 0,
  },
  headerCenter: { textAlign: 'center' as const, flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: 700, color: '#111827', margin: 0 },
  headerSub:   { fontSize: 11, color: `rgba(7,193,96,0.65)`, margin: '2px 0 0', fontWeight: 500 },

  main: { padding: '14px 16px 32px' },

  center: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '60vh',
    gap: 8,
  },
  emptyText: { fontSize: 15, color: '#bbb', margin: 0, textAlign: 'center' as const },
  emptyHintText: { fontSize: 12, color: '#9ca3af', margin: 0, textAlign: 'center' as const, maxWidth: 260, lineHeight: 1.5 },
  homeBtn: {
    marginTop: 8,
    padding: '10px 24px',
    background: BRAND,
    color: '#fff',
    border: 'none',
    borderRadius: 20,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  supportBtn: {
    padding: '9px 22px',
    background: '#fff',
    color: BRAND,
    border: `1px solid rgba(7,193,96,0.24)`,
    borderRadius: 20,
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
  },
  topSupportBtn: {
    alignSelf: 'flex-end',
    border: `1px solid rgba(7,193,96,0.22)`,
    borderRadius: 999,
    background: '#fff',
    color: BRAND,
    fontSize: 12,
    fontWeight: 800,
    padding: '7px 12px',
    cursor: 'pointer',
  },

  card: {
    background: '#fff',
    borderRadius: 14,
    padding: '14px 16px',
    border: '1px solid rgba(0,0,0,0.06)',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  cardTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  storeName: {
    fontSize: 15,
    fontWeight: 700,
    color: '#111827',
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
    maxWidth: '60%',
  },
  itemRow: {
    fontSize: 13,
    color: '#6b7280',
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  cardBottom: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    flexShrink: 0,
    display: 'inline-block',
  },
  amount: {
    fontSize: 17,
    fontWeight: 700,
    color: '#111827',
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.2)',
    zIndex: 100,
  },
  detailSheet: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    background: '#fff',
    borderRadius: '18px 18px 0 0',
    zIndex: 101,
    padding: '22px 20px',
    paddingBottom: 'max(22px, env(safe-area-inset-bottom))',
    boxShadow: '0 -12px 30px rgba(0,0,0,0.14)',
  },
  serviceSheet: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    background: '#fff',
    borderRadius: '18px 18px 0 0',
    zIndex: 102,
    padding: '22px 20px',
    paddingBottom: 'max(22px, env(safe-area-inset-bottom))',
    boxShadow: '0 -12px 30px rgba(0,0,0,0.14)',
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: 800,
    color: '#111827',
    margin: '0 0 12px',
  },
  detailRows: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: '12px 0',
  },
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 14,
    fontSize: 13,
  },
  detailLabel: {
    color: '#6b7280',
    flexShrink: 0,
  },
  detailValue: {
    color: '#111827',
    fontWeight: 700,
    textAlign: 'right',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  detailAmount: {
    fontSize: 24,
    fontWeight: 900,
    color: '#111827',
    textAlign: 'right',
    margin: '4px 0 14px',
  },
  serviceIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    background: 'rgba(7,193,96,0.1)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 22,
    marginBottom: 12,
  },
  serviceDesc: {
    fontSize: 13,
    lineHeight: 1.55,
    color: '#6b7280',
    margin: '8px 0 14px',
  },
  serviceAccountBox: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '12px 14px',
    borderRadius: 12,
    background: '#f9fafb',
    border: '1px solid rgba(0,0,0,0.06)',
    marginBottom: 14,
  },
  serviceAccountLabel: {
    fontSize: 12,
    color: '#6b7280',
    flexShrink: 0,
  },
  serviceAccountValue: {
    fontSize: 14,
    color: '#111827',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  servicePrimaryBtn: {
    width: '100%',
    border: 'none',
    borderRadius: 12,
    background: BRAND,
    color: '#fff',
    fontSize: 15,
    fontWeight: 800,
    padding: '13px 16px',
    cursor: 'pointer',
    marginBottom: 10,
  },
  serviceSecondaryBtn: {
    width: '100%',
    border: '1px solid rgba(7,193,96,0.25)',
    borderRadius: 12,
    background: '#fff',
    color: BRAND,
    fontSize: 15,
    fontWeight: 800,
    padding: '12px 16px',
    cursor: 'pointer',
  },
  toast: {
    position: 'fixed',
    bottom: 'calc(64px + env(safe-area-inset-bottom, 0px) + 12px)',
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(0,0,0,0.72)',
    color: '#fff',
    fontSize: 13,
    padding: '9px 18px',
    borderRadius: 20,
    whiteSpace: 'nowrap',
    zIndex: 200,
    pointerEvents: 'none',
  },
}
