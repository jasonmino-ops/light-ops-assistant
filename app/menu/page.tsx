'use client'

import { useState, useEffect } from 'react'

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const PRIMARY = '#ff6b00'

// ─── 多语言类型 ───────────────────────────────────────────────────────────────

type Lang = 'zh' | 'en' | 'km'

type ML = { zh: string; en?: string; km?: string }

function gl(obj: ML, lang: Lang): string {
  return obj[lang] ?? obj.zh
}

// ─── UI 固定文案翻译表 ────────────────────────────────────────────────────────

const T: Record<Lang, {
  open: string
  closed: string
  sold: string
  notSelected: string
  itemCount: (n: number) => string
  checkout: string
  selectFirst: string
  loading: string
  empty: string
  errNoCode: string
  errNotFound: string
  errNetwork: string
  submitting: string
  orderSubmitted: string
  orderHint: string
  orderNo: string
  errSubmitProduct: string
  errSubmitFail: string
  retryCart: string
  statusPending: string
  orderHint2: string
  confirmTitle: string
  confirmSubmit: string
  backToEdit: string
}> = {
  zh: {
    open:             '营业中',
    closed:           '已打烊',
    sold:             '已售',
    notSelected:      '尚未选购',
    itemCount:        (n) => `共 ${n} 件商品`,
    checkout:         '去结算',
    selectFirst:      '请选商品',
    loading:          '加载中…',
    empty:            '暂无商品',
    errNoCode:        '请通过有效的商品页链接访问',
    errNotFound:      '门店不存在或已暂停营业',
    errNetwork:       '网络错误，请刷新重试',
    submitting:       '提交中…',
    orderSubmitted:   '订单已提交',
    orderHint:        '商家收到订单后将与您联系',
    orderNo:          '订单号',
    errSubmitProduct: '部分商品已下架，请刷新后重试',
    errSubmitFail:    '提交失败，请重试',
    retryCart:        '继续选购',
    statusPending:    '待商家确认',
    orderHint2:       '商家确认后将为您备货/处理',
    confirmTitle:     '确认订单',
    confirmSubmit:    '确认提交',
    backToEdit:       '返回修改',
  },
  en: {
    open:             'Open',
    closed:           'Closed',
    sold:             'Sold',
    notSelected:      'No items yet',
    itemCount:        (n) => `${n} item${n === 1 ? '' : 's'}`,
    checkout:         'Checkout',
    selectFirst:      'Select items',
    loading:          'Loading…',
    empty:            'No products',
    errNoCode:        'Please open via a valid menu link',
    errNotFound:      'Store not found or unavailable',
    errNetwork:       'Network error, please refresh',
    submitting:       'Submitting…',
    orderSubmitted:   'Order submitted',
    orderHint:        'The merchant will contact you shortly',
    orderNo:          'Order No.',
    errSubmitProduct: 'Some items are unavailable, please refresh',
    errSubmitFail:    'Submit failed, please try again',
    retryCart:        'Continue shopping',
    statusPending:    'Awaiting confirmation',
    orderHint2:       'Merchant will prepare your order upon confirmation',
    confirmTitle:     'Confirm Order',
    confirmSubmit:    'Submit Order',
    backToEdit:       'Back',
  },
  km: {
    open:             'កំពុងបើក',
    closed:           'បិទ',
    sold:             'បានលក់',
    notSelected:      'មិនទាន់ជ្រើស',
    itemCount:        (n) => `${n} មុខ`,
    checkout:         'ទូទាត់',
    selectFirst:      'ជ្រើសទំនិញ',
    loading:          'កំពុងផ្ទុក…',
    empty:            'គ្មានទំនិញ',
    errNoCode:        'សូមចូលតាមតំណភ្ជាប់ត្រឹមត្រូវ',
    errNotFound:      'រកមិនឃើញហាង',
    errNetwork:       'បញ្ហាបណ្តាញ សូមផ្ទុកឡើងវិញ',
    submitting:       'កំពុងដាក់ស្នើ…',
    orderSubmitted:   'បញ្ជាទិញបានដាក់ស្នើ',
    orderHint:        'ម្ចាស់ហាងនឹងទាក់ទងអ្នក',
    orderNo:          'លេខបញ្ជា',
    errSubmitProduct: 'ទំនិញខ្លះអស់ហើយ សូម refresh ហើយព្យាយាមម្តងទៀត',
    errSubmitFail:    'ដាក់ស្នើបរាជ័យ សូមព្យាយាមម្តងទៀត',
    retryCart:        'ជ្រើសទំនិញម្តងទៀត',
    statusPending:    'រង់ចាំការបញ្ជាក់',
    orderHint2:       'ម្ចាស់ហាងនឹងរៀបចំទំនិញបន្ទាប់ពីបញ្ជាក់',
    confirmTitle:     'បញ្ជាក់បញ្ជាទិញ',
    confirmSubmit:    'ដាក់ស្នើ',
    backToEdit:       'ត្រឡប់',
  },
}

const LANG_LABELS: Record<Lang, string> = { zh: '中', en: 'EN', km: 'ខ្មែរ' }

// ─── 分类标签翻译 ─────────────────────────────────────────────────────────────

const ALL_CAT: ML = { zh: '全部商品', en: 'All Items', km: 'ទំនិញទាំងអស់' }

// ─── 商品视觉预设（无图片时按 index 循环取色/图标） ──────────────────────────

const CARD_COLORS = [
  '#ffe8e8', '#fff4e0', '#e8f0ff', '#e8f4ff', '#fef4e8',
  '#fef8e0', '#f0e8de', '#ffe8de', '#eeeeee', '#fff0e0',
  '#fdf0e0', '#e8f5e8', '#e8f8f0', '#f5f0e8',
]
const CARD_EMOJIS = [
  '🛍️', '📦', '🏷️', '✨', '⭐', '💫', '🎯',
  '🎁', '🎀', '💎', '🌟', '🔖', '🍀', '🎪',
]

// ─── API 响应类型 ────────────────────────────────────────────────────────────

type ApiProduct = {
  id: string
  name: string
  spec: string | null
  price: number
}

type ApiStore = {
  name: string
  isOpen: boolean
}

// ─── 购物车 ──────────────────────────────────────────────────────────────────

type CartItem = { id: string; quantity: number }

// ─── 主页面 ───────────────────────────────────────────────────────────────────

export default function MenuPage() {
  const [lang,        setLang]        = useState<Lang>('zh')
  const [cart,        setCart]        = useState<CartItem[]>([])
  const [storeData,   setStoreData]   = useState<ApiStore | null>(null)
  const [apiProducts, setApiProducts] = useState<ApiProduct[]>([])
  const [loading,     setLoading]     = useState(true)
  const [fetchError,  setFetchError]  = useState('')
  const [submitting,   setSubmitting]  = useState(false)
  const [orderResult,  setOrderResult] = useState<{ orderNo: string; totalAmount: number } | null>(null)
  const [submitError,  setSubmitError] = useState('')
  const [showConfirm,  setShowConfirm] = useState(false)
  const [storeCode,    setStoreCode]   = useState('')
  const [hasTgId,      setHasTgId]     = useState(false)

  const ui         = T[lang]
  const cartTotal  = cart.reduce((s, c) => s + (apiProducts.find(p => p.id === c.id)?.price ?? 0) * c.quantity, 0)
  const cartCount  = cart.reduce((s, c) => s + c.quantity, 0)
  const canCheckout = cartCount > 0
  const confirmItems = cart.flatMap((c) => {
    const p = apiProducts.find((ap) => ap.id === c.id)
    if (!p) return []
    return [{ ...p, quantity: c.quantity, lineAmount: p.price * c.quantity }]
  })

  // ── Telegram Mini App 适配 ───────────────────────────────────────────────
  // TelegramInit.tsx 对 /menu 路径早返回，不会调用 expand()，需要自行初始化
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tg = (window as any).Telegram?.WebApp
    if (!tg) return
    tg.expand?.()           // 强制全屏，避免半屏弹出
    tg.ready?.()            // 通知 Telegram WebApp 加载完成，隐藏加载动画
    // 用 Telegram BackButton 替代顶部自定义返回按钮（如在 Telegram 内）
    if (tg.BackButton) {
      tg.BackButton.show()
      tg.BackButton.onClick(() => tg.close())
    }
    return () => {
      tg.BackButton?.hide()
      tg.BackButton?.offClick()
    }
  }, [])

  // ── 数据加载 ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('code')
    if (!code) {
      setLoading(false)
      setFetchError('no_code')
      return
    }
    setStoreCode(code)

    // 检测是否在 Telegram 中（决定是否显示"我的订单"入口）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tg = (window as any).Telegram?.WebApp
    if (tg?.initData) {
      try {
        const userStr = new URLSearchParams(tg.initData).get('user')
        if (userStr) { JSON.parse(userStr); setHasTgId(true) }
      } catch { /* 解析失败则不显示入口 */ }
    }

    fetch(`/api/public/menu?code=${encodeURIComponent(code)}`)
      .then((r) => r.json())
      .then((body) => {
        if (body.error) {
          setFetchError(body.error)
        } else {
          setStoreData(body.store)
          setApiProducts(body.products)
        }
      })
      .catch(() => setFetchError('NETWORK_ERROR'))
      .finally(() => setLoading(false))
  }, [])

  function addToCart(id: string) {
    setCart((prev) => {
      const found = prev.find((c) => c.id === id)
      if (found) return prev.map((c) => c.id === id ? { ...c, quantity: c.quantity + 1 } : c)
      return [...prev, { id, quantity: 1 }]
    })
  }

  function removeFromCart(id: string) {
    setCart((prev) =>
      prev.map((c) => c.id === id ? { ...c, quantity: c.quantity - 1 } : c).filter((c) => c.quantity > 0),
    )
  }

  async function handleCheckout() {
    if (!canCheckout || submitting) return
    const code = new URLSearchParams(window.location.search).get('code')
    if (!code) return

    // 尝试从 Telegram WebApp 获取顾客身份（普通浏览器会 null）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tg = (window as any).Telegram?.WebApp
    let customerTelegramId: string | null = null
    if (tg?.initData) {
      try {
        const userStr = new URLSearchParams(tg.initData).get('user')
        if (userStr) customerTelegramId = String(JSON.parse(userStr).id)
      } catch { /* 解析失败则保持 null */ }
    }

    setSubmitting(true)
    setSubmitError('')

    try {
      const res = await fetch('/api/public/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeCode: code,
          items: cart.map((c) => ({ productId: c.id, quantity: c.quantity })),
          ...(customerTelegramId ? { customerTelegramId } : {}),
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        const msg =
          body.error === 'PRODUCT_UNAVAILABLE' ? ui.errSubmitProduct :
          ui.errSubmitFail
        setSubmitError(msg)
        return
      }
      setOrderResult({ orderNo: body.orderNo, totalAmount: body.totalAmount })
      setCart([])
      setShowConfirm(false)
    } catch {
      setSubmitError(ui.errSubmitFail)
    } finally {
      setSubmitting(false)
    }
  }

  // ── 加载态 ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={s.centerPage}>
        <div style={{ color: '#ccc', fontSize: 14 }}>{T.zh.loading}</div>
      </div>
    )
  }

  // ── 错误态 ────────────────────────────────────────────────────────────────
  if (fetchError) {
    const msg =
      fetchError === 'no_code'      ? ui.errNoCode :
      fetchError === 'STORE_NOT_FOUND' ? ui.errNotFound :
      ui.errNetwork
    return (
      <div style={s.centerPage}>
        <div style={s.errCard}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🔍</div>
          <div style={{ fontSize: 15, color: '#333', fontWeight: 600, textAlign: 'center' }}>{msg}</div>
          <div style={s.langSwitcherErr}>
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
  const storeName = storeData?.name ?? '—'
  const isOpen    = storeData?.isOpen ?? false

  return (
    <>
      <main style={s.page}>

        {/* ── 1. 顶部门店头图 ── */}
        <div style={s.banner}>
          <div style={s.bannerMask} />
          <button style={s.circleBtn} onClick={() => history.back()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
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

        {/* ── 2. 门店信息卡片 ── */}
        <div style={s.storeCard}>
          <div style={s.storeLogo}>🏪</div>
          <div style={s.storeBody}>
            <div style={s.storeTopRow}>
              <span style={s.storeName}>{storeName}</span>
              <span style={isOpen ? s.openBadge : s.closedBadge}>
                {isOpen ? ui.open : ui.closed}
              </span>
            </div>
            {hasTgId && storeCode && (
              <a href={`/menu/orders?code=${storeCode}`} style={s.myOrdersLink}>
                📋 {lang === 'zh' ? '我的订单' : lang === 'en' ? 'My Orders' : 'បញ្ជាទិញ'}
              </a>
            )}
          </div>
        </div>

        {/* ── 3. 商品列表（无分类侧栏，全宽单列） ── */}
        <div style={s.productCol}>
          <div style={s.catHeading}>{gl(ALL_CAT, lang)}</div>

          {apiProducts.length === 0 ? (
            <div style={{ padding: '40px 16px', textAlign: 'center', color: '#ccc', fontSize: 14 }}>
              {ui.empty}
            </div>
          ) : (
            apiProducts.map((product, idx) => {
              const qty   = cart.find((c) => c.id === product.id)?.quantity ?? 0
              const color = CARD_COLORS[idx % CARD_COLORS.length]
              const emoji = CARD_EMOJIS[idx % CARD_EMOJIS.length]
              return (
                <div key={product.id} style={s.productCard}>
                  <div style={{ ...s.productImg, background: color }}>
                    <span style={s.productEmoji}>{emoji}</span>
                  </div>
                  <div style={s.productMeta}>
                    <div style={s.productName}>{product.name}</div>
                    {product.spec && <div style={s.productSpec}>{product.spec}</div>}
                    <div style={s.productFoot}>
                      <span style={s.productPrice}>
                        <span style={s.priceSign}>$</span>{product.price.toFixed(2)}
                      </span>
                      {qty === 0 ? (
                        <button style={s.addBtn} onClick={() => addToCart(product.id)}>
                          <span style={s.plus}>+</span>
                        </button>
                      ) : (
                        <div style={s.qtyRow}>
                          <button style={s.qtyMinus} onClick={() => removeFromCart(product.id)}>−</button>
                          <span style={s.qtyNum}>{qty}</span>
                          <button style={s.qtyPlus} onClick={() => addToCart(product.id)}>+</button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </main>

      {/* ── 下单确认弹层 ── */}
      {!orderResult && showConfirm && (
        <div style={s.successOverlay}>
          <div style={s.confirmModal}>
            <div style={s.confirmHeader}>
              <span style={s.confirmHeaderIcon}>📋</span>
              <span style={s.confirmHeaderTitle}>{ui.confirmTitle}</span>
            </div>
            <div style={s.confirmItemList}>
              {confirmItems.map((item) => (
                <div key={item.id} style={s.confirmItem}>
                  <div style={s.confirmItemName}>
                    {item.name}
                    {item.spec && <span style={s.confirmItemSpec}> · {item.spec}</span>}
                  </div>
                  <div style={s.confirmItemRight}>
                    <span style={s.confirmItemQty}>×{item.quantity}</span>
                    <span style={s.confirmItemAmt}>${item.lineAmount.toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
            <div style={s.confirmTotal}>
              <span style={s.confirmTotalLabel}>{ui.itemCount(cartCount)}</span>
              <span style={s.confirmTotalAmount}>${cartTotal.toFixed(2)}</span>
            </div>
            {submitError && <div style={s.confirmErr}>{submitError}</div>}
            <div style={s.confirmBtns}>
              <button
                style={s.confirmBackBtn}
                onClick={() => { setShowConfirm(false); setSubmitError('') }}
              >
                {ui.backToEdit}
              </button>
              <button
                style={{ ...s.confirmSubmitBtn, ...(submitting ? s.confirmSubmitBtnDisabled : {}) }}
                disabled={submitting}
                onClick={handleCheckout}
              >
                {submitting ? ui.submitting : ui.confirmSubmit}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 下单成功覆盖弹层 ── */}
      {orderResult && (
        <div style={s.successOverlay}>
          <div style={s.successModal}>
            <div style={s.successCheckCircle}>✓</div>
            <div style={s.successModalTitle}>{ui.orderSubmitted}</div>
            <div style={s.successModalOrderNo}>{orderResult.orderNo}</div>
            <div style={s.successStatusPill}>
              <span style={{ color: '#fa8c16', marginRight: 4 }}>●</span>
              {ui.statusPending}
            </div>
            <div style={s.successModalHint}>{ui.orderHint2}</div>
            <div style={s.successModalAmount}>${orderResult.totalAmount.toFixed(2)}</div>
            <button
              style={s.retryBtnFull}
              onClick={() => { setOrderResult(null); setSubmitError(''); setShowConfirm(false) }}
            >
              {ui.retryCart}
            </button>
            {hasTgId && storeCode && (
              <a href={`/menu/orders?code=${storeCode}`} style={s.myOrdersBtnLink}>
                {lang === 'zh' ? '查看订单进度 →' : lang === 'en' ? 'View Order Status →' : 'មើលស្ថានភាព →'}
              </a>
            )}
          </div>
        </div>
      )}

      {/* ── 底部购物车浮层 ── */}
      <div style={s.cartBar}>
        <div style={s.cartLeft}>
          <div style={s.cartIconBox}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" color="#fff">
              <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
            </svg>
            {cartCount > 0 && (
              <span style={s.cartBadge}>{cartCount > 99 ? '99+' : cartCount}</span>
            )}
          </div>
          <div>
            <div style={{ ...s.cartAmount, color: cartCount > 0 ? PRIMARY : '#bbb' }}>
              ${cartTotal.toFixed(2)}
            </div>
            <div style={{ ...s.cartHint, color: submitError ? '#ff4d4f' : '#c0c0c0' }}>
              {submitError || (cartCount === 0 ? ui.notSelected : ui.itemCount(cartCount))}
            </div>
          </div>
        </div>
        <button
          style={{ ...s.checkoutBtn, ...(canCheckout && !submitting ? s.checkoutBtnOn : {}) }}
          disabled={!canCheckout || submitting}
          onClick={() => setShowConfirm(true)}
        >
          {submitting ? ui.submitting : canCheckout ? ui.checkout : ui.selectFirst}
        </button>
      </div>
    </>
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
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f0f0f0',
    padding: 24,
  },
  errCard: {
    background: '#fff',
    borderRadius: 16,
    padding: '32px 24px',
    maxWidth: 320,
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
  },
  langSwitcherErr: {
    display: 'flex',
    gap: 4,
    marginTop: 4,
  },
  langBtnPlain: {
    border: '1px solid #e0e0e0',
    background: '#fff',
    color: '#888',
    fontSize: 11,
    fontWeight: 600,
    padding: '4px 10px',
    borderRadius: 12,
    cursor: 'pointer',
  },
  langBtnPlainOn: {
    borderColor: PRIMARY,
    color: PRIMARY,
    background: '#fff5ee',
  },

  page: {
    maxWidth: 480,
    margin: '0 auto',
    background: '#f0f0f0',
    minHeight: '100dvh',
    paddingBottom: 92,
  },

  banner: {
    height: 152,
    background: BANNER_BG,
    position: 'relative',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '48px 16px 16px',
  },
  bannerMask: {
    position: 'absolute',
    top: 0, right: 0, bottom: 0, left: 0,
    background: 'linear-gradient(to bottom, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0) 55%)',
    pointerEvents: 'none',
  },
  circleBtn: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    background: 'rgba(0,0,0,0.30)',
    border: 'none',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    position: 'relative',
    zIndex: 1,
    flexShrink: 0,
  },

  langSwitcher: {
    display: 'flex',
    background: 'rgba(0,0,0,0.28)',
    borderRadius: 20,
    padding: 2,
    gap: 1,
    position: 'relative',
    zIndex: 1,
  },
  langBtn: {
    border: 'none',
    background: 'transparent',
    color: 'rgba(255,255,255,0.70)',
    fontSize: 11,
    fontWeight: 600,
    padding: '4px 9px',
    borderRadius: 16,
    cursor: 'pointer',
    lineHeight: 1.4,
  },
  langBtnOn: {
    background: '#fff',
    color: PRIMARY,
  },

  storeCard: {
    background: '#fff',
    margin: '0',
    marginTop: -20,
    borderRadius: 0,
    padding: '20px 16px 16px',
    boxShadow: '0 1px 0 rgba(0,0,0,0.06)',
    display: 'flex',
    gap: 14,
    alignItems: 'flex-start',
    position: 'relative',
    zIndex: 2,
  },
  storeLogo: {
    width: 62,
    height: 62,
    borderRadius: 14,
    background: '#fff8f2',
    border: '1.5px solid #ffe0cc',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 30,
    flexShrink: 0,
  },
  storeBody: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
    justifyContent: 'center',
  },
  storeTopRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  storeName: {
    fontSize: 19,
    fontWeight: 800,
    color: '#1a1a1a',
    letterSpacing: '-0.2px',
  },
  openBadge: {
    fontSize: 10,
    fontWeight: 600,
    color: '#52c41a',
    background: '#f6ffed',
    border: '1px solid #b7eb8f',
    borderRadius: 4,
    padding: '2px 7px',
  },
  closedBadge: {
    fontSize: 10,
    fontWeight: 600,
    color: '#8c8c8c',
    background: '#f5f5f5',
    border: '1px solid #d9d9d9',
    borderRadius: 4,
    padding: '2px 7px',
  },

  productCol: {
    flex: 1,
    minWidth: 0,
    marginTop: 8,
  },
  catHeading: {
    fontSize: 11,
    fontWeight: 600,
    color: '#aaa',
    padding: '12px 16px 6px',
    background: '#f0f0f0',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },

  productCard: {
    background: '#fff',
    marginBottom: 1,
    padding: '15px 16px',
    display: 'flex',
    gap: 12,
    alignItems: 'flex-start',
  },
  productImg: {
    width: 86,
    height: 86,
    borderRadius: 12,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  productEmoji: {
    fontSize: 36,
  },
  productMeta: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    paddingTop: 2,
  },
  productName: {
    fontSize: 15,
    fontWeight: 600,
    color: '#111',
    lineHeight: 1.35,
  },
  productSpec: {
    fontSize: 12,
    color: '#aaa',
    lineHeight: 1.3,
  },
  productFoot: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  productPrice: {
    fontSize: 19,
    fontWeight: 800,
    color: '#e53e3e',
    lineHeight: 1,
  },
  priceSign: {
    fontSize: 12,
    fontWeight: 700,
  },
  addBtn: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    background: PRIMARY,
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0,
    boxShadow: `0 3px 10px ${PRIMARY}55`,
  },
  plus: {
    color: '#fff',
    fontSize: 22,
    lineHeight: 1,
    fontWeight: 300,
  },
  qtyRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  qtyMinus: {
    width: 26,
    height: 26,
    borderRadius: '50%',
    border: `1.5px solid ${PRIMARY}`,
    background: '#fff',
    color: PRIMARY,
    fontSize: 18,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    lineHeight: 1,
    fontWeight: 500,
  },
  qtyNum: {
    fontSize: 15,
    fontWeight: 700,
    color: '#1a1a1a',
    minWidth: 16,
    textAlign: 'center',
  },
  qtyPlus: {
    width: 26,
    height: 26,
    borderRadius: '50%',
    background: PRIMARY,
    border: 'none',
    color: '#fff',
    fontSize: 18,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    lineHeight: 1,
    fontWeight: 300,
    boxShadow: `0 3px 10px ${PRIMARY}55`,
  },

  cartBar: {
    position: 'fixed',
    bottom: 0,
    left: '50%',
    transform: 'translateX(-50%)',
    width: '100%',
    maxWidth: 480,
    background: '#fff',
    borderTop: '1px solid #ebebeb',
    padding: '14px 16px',
    paddingBottom: 'calc(14px + env(safe-area-inset-bottom))',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    boxShadow: '0 -4px 20px rgba(0,0,0,0.09)',
    zIndex: 100,
  },

  // 下单成功态 — 全屏覆盖弹层
  successOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.65)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 200,
    padding: 20,
  },
  successModal: {
    background: '#fff',
    borderRadius: 20,
    padding: '36px 28px 28px',
    width: '100%',
    maxWidth: 340,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
  },
  successCheckCircle: {
    width: 64,
    height: 64,
    borderRadius: '50%',
    background: '#52c41a',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 28,
    fontWeight: 700,
    marginBottom: 4,
  },
  successModalTitle: {
    fontSize: 20,
    fontWeight: 800,
    color: '#1a1a1a',
  },
  successModalOrderNo: {
    fontSize: 11,
    color: '#bbb',
    letterSpacing: '0.06em',
    fontVariantNumeric: 'tabular-nums',
  },
  successStatusPill: {
    display: 'flex',
    alignItems: 'center',
    background: '#fff7e6',
    border: '1px solid #ffe58f',
    borderRadius: 20,
    padding: '5px 14px',
    fontSize: 13,
    fontWeight: 600,
    color: '#fa8c16',
    marginTop: 2,
  },
  successModalHint: {
    fontSize: 13,
    color: '#8c8c8c',
    textAlign: 'center',
    lineHeight: 1.5,
    marginTop: 2,
  },
  successModalAmount: {
    fontSize: 26,
    fontWeight: 800,
    color: '#1677ff',
    letterSpacing: '-0.5px',
    marginTop: 2,
  },
  retryBtnFull: {
    marginTop: 8,
    width: '100%',
    background: PRIMARY,
    color: '#fff',
    border: 'none',
    borderRadius: 24,
    padding: '14px 0',
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
  },
  myOrdersLink: {
    display: 'inline-block',
    marginTop: 5,
    fontSize: 12,
    fontWeight: 600,
    color: PRIMARY,
    textDecoration: 'none',
  },
  myOrdersBtnLink: {
    display: 'block',
    textAlign: 'center' as const,
    marginTop: 4,
    fontSize: 13,
    fontWeight: 600,
    color: PRIMARY,
    textDecoration: 'none',
    padding: '6px 0',
  },
  confirmModal: {
    background: '#fff',
    borderRadius: 20,
    padding: '24px 20px 20px',
    width: '100%',
    maxWidth: 360,
    maxHeight: '80dvh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  confirmHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
    paddingBottom: 12,
    borderBottom: '1px solid #f0f0f0',
  },
  confirmHeaderIcon: { fontSize: 18 },
  confirmHeaderTitle: { fontSize: 17, fontWeight: 700, color: '#1a1a1a' },
  confirmItemList: {
    flex: 1,
    overflowY: 'auto' as const,
    display: 'flex',
    flexDirection: 'column',
    marginBottom: 12,
  },
  confirmItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 0',
    borderBottom: '1px solid #f5f5f5',
  },
  confirmItemName: { fontSize: 14, fontWeight: 500, color: '#1a1a1a', flex: 1, marginRight: 12 },
  confirmItemSpec: { fontSize: 12, color: '#aaa', fontWeight: 400 },
  confirmItemRight: { display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 },
  confirmItemQty: { fontSize: 13, color: '#8c8c8c' },
  confirmItemAmt: { fontSize: 14, fontWeight: 600, color: '#e53e3e', minWidth: 56, textAlign: 'right' as const },
  confirmTotal: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 0',
    borderTop: '1px solid #ebebeb',
    marginBottom: 12,
  },
  confirmTotalLabel: { fontSize: 13, color: '#8c8c8c' },
  confirmTotalAmount: { fontSize: 22, fontWeight: 800, color: '#1677ff', letterSpacing: '-0.4px' },
  confirmErr: { fontSize: 12, color: '#ff4d4f', textAlign: 'center' as const, marginBottom: 8 },
  confirmBtns: { display: 'flex', gap: 10 },
  confirmBackBtn: {
    flex: 1,
    background: '#f5f5f5',
    color: '#555',
    border: 'none',
    borderRadius: 24,
    padding: '13px 0',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  confirmSubmitBtn: {
    flex: 2,
    background: `linear-gradient(135deg, #ff8c00 0%, ${PRIMARY} 100%)`,
    color: '#fff',
    border: 'none',
    borderRadius: 24,
    padding: '13px 0',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    boxShadow: `0 4px 14px ${PRIMARY}55`,
  },
  confirmSubmitBtnDisabled: {
    background: '#e8e8e8',
    color: '#b0b0b0',
    cursor: 'not-allowed',
    boxShadow: 'none',
  },
  cartLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
  },
  cartIconBox: {
    width: 48,
    height: 48,
    borderRadius: '50%',
    background: '#1677ff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    flexShrink: 0,
  },
  cartBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    background: '#ff4d4f',
    color: '#fff',
    fontSize: 10,
    fontWeight: 700,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 3px',
  },
  cartAmount: {
    fontSize: 20,
    fontWeight: 800,
    lineHeight: 1.15,
    letterSpacing: '-0.4px',
  },
  cartHint: {
    fontSize: 11,
    color: '#c0c0c0',
    marginTop: 2,
  },
  checkoutBtn: {
    background: '#e8e8e8',
    color: '#b0b0b0',
    border: 'none',
    borderRadius: 24,
    padding: '14px 28px',
    fontSize: 15,
    fontWeight: 700,
    cursor: 'not-allowed',
    flexShrink: 0,
    minWidth: 100,
    textAlign: 'center',
  },
  checkoutBtnOn: {
    background: `linear-gradient(135deg, #ff8c00 0%, ${PRIMARY} 100%)`,
    color: '#fff',
    cursor: 'pointer',
    boxShadow: `0 4px 14px ${PRIMARY}55`,
  },
}
