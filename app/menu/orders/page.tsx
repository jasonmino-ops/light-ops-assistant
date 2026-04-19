'use client'

import { useState, useEffect } from 'react'

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const PRIMARY = '#ff6b00'

type Lang = 'zh' | 'en' | 'km'

const LANG_LABELS: Record<Lang, string> = { zh: '中', en: 'EN', km: 'ខ្មែរ' }

const T: Record<Lang, {
  title: string
  loading: string
  empty: string
  errNoCode: string
  errNoTg: string
  errNetwork: string
  detail: string
  collapse: string
  total: string
  orderNo: string
  unpaid: string
  paid: string
  payMethodCash: string
  payMethodQr: string
}> = {
  zh: {
    title:        '我的订单',
    loading:      '加载中…',
    empty:        '暂无订单记录',
    errNoCode:    '请通过有效的商品页链接访问',
    errNoTg:      '请在 Telegram 中打开此页面以查看订单',
    errNetwork:   '网络错误，请刷新重试',
    detail:       '明细 ▾',
    collapse:     '收起 ▴',
    total:        '合计',
    orderNo:      '订单号',
    unpaid:       '未收款',
    paid:         '已收款',
    payMethodCash:'现金',
    payMethodQr:  '收款码',
  },
  en: {
    title:        'My Orders',
    loading:      'Loading…',
    empty:        'No orders yet',
    errNoCode:    'Please open via a valid menu link',
    errNoTg:      'Please open this page inside Telegram',
    errNetwork:   'Network error, please refresh',
    detail:       'Details ▾',
    collapse:     'Collapse ▴',
    total:        'Total',
    orderNo:      'Order No.',
    unpaid:       'Unpaid',
    paid:         'Paid',
    payMethodCash:'Cash',
    payMethodQr:  'QR Code',
  },
  km: {
    title:        'បញ្ជាទិញរបស់ខ្ញុំ',
    loading:      'កំពុងផ្ទុក…',
    empty:        'គ្មានបញ្ជាទិញ',
    errNoCode:    'សូមចូលតាមតំណភ្ជាប់ត្រឹមត្រូវ',
    errNoTg:      'សូមបើកទំព័រនេះក្នុង Telegram',
    errNetwork:   'បញ្ហាបណ្តាញ សូម refresh',
    detail:       'លម្អិត ▾',
    collapse:     'បិទ ▴',
    total:        'សរុប',
    orderNo:      'លេខបញ្ជា',
    unpaid:       'មិនទាន់បង់',
    paid:         'បានបង់',
    payMethodCash:'សាច់ប្រាក់',
    payMethodQr:  'QR Code',
  },
}

const STATUS_LABELS: Record<Lang, Record<string, string>> = {
  zh: {
    PENDING:   '待商家确认',
    CONFIRMED: '已确认',
    COMPLETED: '已完成',
    CANCELLED: '已取消',
  },
  en: {
    PENDING:   'Awaiting confirmation',
    CONFIRMED: 'Confirmed',
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled',
  },
  km: {
    PENDING:   'រង់ចាំការបញ្ជាក់',
    CONFIRMED: 'បានបញ្ជាក់',
    COMPLETED: 'បានបញ្ចប់',
    CANCELLED: 'បានលុបចោល',
  },
}

const STATUS_COLOR: Record<string, string> = {
  PENDING:   '#fa8c16',
  CONFIRMED: '#1677ff',
  COMPLETED: '#52c41a',
  CANCELLED: '#bbb',
}

// ─── 类型 ─────────────────────────────────────────────────────────────────────

type OrderItem = {
  productId: string
  name: string
  spec: string | null
  price: number
  quantity: number
  lineAmount: number
}

type MyOrder = {
  id: string
  orderNo: string
  items: OrderItem[]
  totalAmount: number
  status: string
  paymentStatus: string
  paymentMethod: string | null
  paidAt: string | null
  createdAt: string
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string, lang: Lang): string {
  const d = new Date(iso)
  if (lang === 'km') {
    return d.toLocaleDateString('km-KH', { month: '2-digit', day: '2-digit' }) +
      ' ' + d.toLocaleTimeString('km-KH', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) +
    ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function buildItemSummary(items: OrderItem[]): string {
  if (items.length === 0) return '—'
  const first = items[0].name + (items[0].spec ? ` · ${items[0].spec}` : '')
  return items.length === 1 ? first : `${first} 等${items.length}件`
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────

export default function MyOrdersPage() {
  const [lang,      setLang]      = useState<Lang>('zh')
  const [orders,    setOrders]    = useState<MyOrder[]>([])
  const [storeName, setStoreName] = useState('')
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('code')

    // TG 初始化
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tg = (window as any).Telegram?.WebApp
    tg?.expand?.()
    tg?.ready?.()
    if (tg?.BackButton) {
      tg.BackButton.show()
      tg.BackButton.onClick(() => history.back())
    }

    // 读取顾客 Telegram ID
    let tgId: string | null = null
    if (tg?.initData) {
      try {
        const userStr = new URLSearchParams(tg.initData).get('user')
        if (userStr) tgId = String(JSON.parse(userStr).id)
      } catch { /* 解析失败则保持 null */ }
    }

    if (!code) {
      setError('no_code')
      setLoading(false)
      return
    }
    if (!tgId) {
      setError('no_tg')
      setLoading(false)
      return
    }

    fetch(`/api/public/my-orders?tgId=${encodeURIComponent(tgId)}&code=${encodeURIComponent(code)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setError(data.error); return }
        setStoreName(data.storeName ?? '')
        setOrders(data.orders ?? [])
      })
      .catch(() => setError('NETWORK_ERROR'))
      .finally(() => setLoading(false))

    return () => {
      tg?.BackButton?.hide()
      tg?.BackButton?.offClick()
    }
  }, [])

  const ui = T[lang]

  // ── 加载态 ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={s.centerPage}>
        <div style={{ color: '#ccc', fontSize: 14 }}>{ui.loading}</div>
      </div>
    )
  }

  // ── 错误态 ────────────────────────────────────────────────────────────────
  if (error) {
    const msg =
      error === 'no_code'    ? ui.errNoCode :
      error === 'no_tg'      ? ui.errNoTg :
      ui.errNetwork
    return (
      <div style={s.centerPage}>
        <div style={s.errCard}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
          <div style={{ fontSize: 15, color: '#333', fontWeight: 600, textAlign: 'center' }}>{msg}</div>
          <div style={s.langRow}>
            {(['zh', 'en', 'km'] as Lang[]).map((l) => (
              <button key={l} style={{ ...s.langBtnPlain, ...(lang === l ? s.langBtnPlainOn : {}) }} onClick={() => setLang(l)}>
                {LANG_LABELS[l]}
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ── 正常态 ────────────────────────────────────────────────────────────────
  return (
    <main style={s.page}>

      {/* ── 顶部 banner ── */}
      <div style={s.banner}>
        <div style={s.bannerMask} />
        <button style={s.circleBtn} onClick={() => history.back()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div style={s.bannerCenter}>
          <div style={s.bannerTitle}>{ui.title}</div>
          {storeName && <div style={s.bannerSub}>{storeName}</div>}
        </div>
        <div style={s.langSwitcher}>
          {(['zh', 'en', 'km'] as Lang[]).map((l) => (
            <button
              key={l}
              style={{ ...s.langBtn, ...(lang === l ? s.langBtnOn : {}) }}
              onClick={() => setLang(l)}
            >
              {LANG_LABELS[l]}
            </button>
          ))}
        </div>
      </div>

      {/* ── 订单列表 ── */}
      <div style={s.listWrap}>
        {orders.length === 0 ? (
          <div style={s.emptyWrap}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
            <div style={{ fontSize: 14, color: '#bbb' }}>{ui.empty}</div>
          </div>
        ) : (
          orders.map((order) => {
            const expanded = expandedId === order.id
            const statusColor = STATUS_COLOR[order.status] ?? '#8c8c8c'
            const statusLabel = STATUS_LABELS[lang][order.status] ?? order.status

            return (
              <div key={order.id} style={{ ...s.orderCard, borderLeft: `3px solid ${statusColor}` }}>

                {/* 卡片主行 */}
                <div style={s.cardMain}>
                  <div style={s.cardLeft}>
                    <div style={s.statusPill}>
                      <span style={{ ...s.dot, background: statusColor }} />
                      <span style={{ ...s.statusText, color: statusColor }}>{statusLabel}</span>
                    </div>
                    <div style={s.itemSummary}>{buildItemSummary(order.items)}</div>
                    <div style={s.meta}>{ui.orderNo} {order.orderNo} · {fmtDate(order.createdAt, lang)}</div>
                  </div>
                  <div style={s.cardRight}>
                    <div style={s.amount}>${order.totalAmount.toFixed(2)}</div>
                    <button
                      style={s.toggleBtn}
                      onClick={() => setExpandedId(expanded ? null : order.id)}
                    >
                      {expanded ? ui.collapse : ui.detail}
                    </button>
                  </div>
                </div>

                {/* 展开明细 */}
                {expanded && (
                  <div style={s.detail}>
                    {order.items.map((item) => (
                      <div key={item.productId} style={s.detailItem}>
                        <div style={s.detailName}>
                          {item.name}
                          {item.spec && <span style={s.detailSpec}> · {item.spec}</span>}
                        </div>
                        <div style={s.detailRight}>
                          <span style={s.detailUnit}>${item.price.toFixed(2)} × {item.quantity}</span>
                          <span style={s.detailLine}>${item.lineAmount.toFixed(2)}</span>
                        </div>
                      </div>
                    ))}
                    <div style={s.detailFooter}>
                      <span style={s.detailTotalLabel}>{ui.total}</span>
                      <span style={s.detailTotalAmt}>${order.totalAmount.toFixed(2)}</span>
                    </div>
                    {order.status === 'COMPLETED' && (
                      <div style={s.payRow}>
                        {order.paymentStatus === 'PAID' ? (
                          <span style={s.paidBadge}>
                            ✓ {ui.paid}
                            {order.paymentMethod === 'CASH' && ` · ${ui.payMethodCash}`}
                            {order.paymentMethod === 'QR'   && ` · ${ui.payMethodQr}`}
                          </span>
                        ) : (
                          <span style={s.unpaidBadge}>{ui.unpaid}</span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </main>
  )
}

// ─── 样式 ─────────────────────────────────────────────────────────────────────

const BANNER_BG = [
  'repeating-linear-gradient(-45deg, rgba(255,255,255,0.045) 0px, rgba(255,255,255,0.045) 1px, transparent 1px, transparent 14px)',
  'radial-gradient(ellipse at 75% 80%, rgba(255,220,100,0.30) 0%, transparent 52%)',
  'radial-gradient(ellipse at 18% 22%, rgba(255,255,255,0.20) 0%, transparent 44%)',
  'linear-gradient(148deg, #ffb347 0%, #ff6b00 52%, #e84e00 100%)',
].join(', ')

const s: Record<string, React.CSSProperties> = {
  centerPage: {
    minHeight: '100dvh',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#f0f0f0', padding: 24,
  },
  errCard: {
    background: '#fff', borderRadius: 16, padding: '32px 24px',
    maxWidth: 320, width: '100%',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
  },
  langRow: { display: 'flex', gap: 4, marginTop: 4 },
  langBtnPlain: {
    border: '1px solid #e0e0e0', background: '#fff', color: '#888',
    fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 12, cursor: 'pointer',
  },
  langBtnPlainOn: { borderColor: PRIMARY, color: PRIMARY, background: '#fff5ee' },

  page: {
    maxWidth: 480, margin: '0 auto',
    background: '#f5f5f5', minHeight: '100dvh',
  },

  banner: {
    height: 112,
    background: BANNER_BG,
    position: 'relative',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    padding: '0 16px 14px',
  },
  bannerMask: {
    position: 'absolute', inset: 0,
    background: 'linear-gradient(to bottom, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0) 55%)',
    pointerEvents: 'none',
  },
  circleBtn: {
    width: 36, height: 36, borderRadius: '50%',
    background: 'rgba(0,0,0,0.30)', border: 'none', color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', position: 'relative', zIndex: 1, flexShrink: 0,
  },
  bannerCenter: {
    position: 'absolute', left: 0, right: 0, bottom: 14,
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    gap: 2, zIndex: 0, pointerEvents: 'none',
  },
  bannerTitle: {
    fontSize: 18, fontWeight: 800, color: '#fff',
    letterSpacing: '-0.2px',
  },
  bannerSub: {
    fontSize: 11, color: 'rgba(255,255,255,0.7)',
  },
  langSwitcher: {
    display: 'flex', background: 'rgba(0,0,0,0.28)',
    borderRadius: 20, padding: 2, gap: 1,
    position: 'relative', zIndex: 1,
  },
  langBtn: {
    border: 'none', background: 'transparent',
    color: 'rgba(255,255,255,0.70)',
    fontSize: 11, fontWeight: 600,
    padding: '4px 9px', borderRadius: 16, cursor: 'pointer', lineHeight: 1.4,
  },
  langBtnOn: { background: '#fff', color: PRIMARY },

  listWrap: { padding: '12px 12px 32px' },

  emptyWrap: {
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    padding: '64px 0',
  },

  orderCard: {
    background: '#fff', borderRadius: 12,
    marginBottom: 10, padding: '14px 14px 0',
    overflow: 'hidden',
  },
  cardMain: {
    display: 'flex', justifyContent: 'space-between',
    alignItems: 'flex-start', gap: 8, paddingBottom: 14,
  },
  cardLeft: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 },
  cardRight: { flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 },

  statusPill: { display: 'flex', alignItems: 'center', gap: 5 },
  dot: { width: 7, height: 7, borderRadius: '50%', flexShrink: 0 },
  statusText: { fontSize: 12, fontWeight: 700 },

  itemSummary: {
    fontSize: 14, fontWeight: 500, color: '#1a1a1a',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  },
  meta: { fontSize: 11, color: '#c0c0c0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  amount: { fontSize: 18, fontWeight: 700, color: '#1a1a1a' },
  toggleBtn: {
    fontSize: 11, fontWeight: 600, color: PRIMARY,
    background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 0',
  },

  detail: {
    borderTop: '1px solid #f0f0f0',
    padding: '10px 0 14px',
  },
  detailItem: {
    display: 'flex', justifyContent: 'space-between',
    alignItems: 'center', padding: '7px 0',
    borderBottom: '1px solid #f5f5f5',
  },
  detailName: { fontSize: 13, fontWeight: 500, color: '#1a1a1a', flex: 1, marginRight: 8 },
  detailSpec: { fontSize: 11, color: '#aaa', fontWeight: 400 },
  detailRight: { display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 },
  detailUnit: { fontSize: 11, color: '#aaa' },
  detailLine: { fontSize: 13, fontWeight: 600, color: '#1a1a1a', minWidth: 52, textAlign: 'right' as const },
  detailFooter: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '10px 0 0',
  },
  detailTotalLabel: { fontSize: 12, color: '#8c8c8c' },
  detailTotalAmt: { fontSize: 17, fontWeight: 700, color: '#1a1a1a' },
  payRow: { marginTop: 8 },
  paidBadge: {
    display: 'inline-block',
    fontSize: 11, fontWeight: 600, color: '#52c41a',
    background: '#f6ffed', border: '1px solid #b7eb8f',
    borderRadius: 4, padding: '2px 8px',
  },
  unpaidBadge: {
    display: 'inline-block',
    fontSize: 11, fontWeight: 600, color: '#fa8c16',
    background: '#fff7e6', border: '1px solid #ffe58f',
    borderRadius: 4, padding: '2px 8px',
  },
}
