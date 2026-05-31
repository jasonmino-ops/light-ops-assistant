'use client'

import { useState, useEffect, useCallback, useRef, CSSProperties } from 'react'
import { apiFetch } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

type Product = {
  id: string; barcode: string; name: string
  spec: string | null; sellPrice: number
  categoryId: string | null; imageUrl: string | null
}

type Category = { id: string; name: string; parentId: string | null }

type CartLine = {
  barcode: string; name: string; spec: string | null
  price: number; qty: number; imageUrl: string | null
}

type SaleResult = { recordNo?: string; orderNo?: string; totalAmount: number }

// ─── Constants ────────────────────────────────────────────────────────────────

const COLORS = ['#fde68a','#bbf7d0','#bfdbfe','#fecaca','#ddd6fe','#fed7aa','#a5f3fc','#fda4af']
const EMOJIS = ['☕','🧋','🍵','🥤','🍰','🥐','🍜','🍱','🥗','🧁']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cartTotal(cart: CartLine[]) {
  return cart.reduce((s, c) => s + c.price * c.qty, 0)
}

function cartCount(cart: CartLine[]) {
  return cart.reduce((s, c) => s + c.qty, 0)
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const SIDEBAR_BG = '#0f172a'
const SIDEBAR_ACTIVE = '#2563eb'
const ACCENT = '#2563eb'

const s: Record<string, CSSProperties> = {
  root:      { display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: 'system-ui, -apple-system, sans-serif', background: '#f1f5f9' },

  // Left
  sidebar:   { width: 210, flexShrink: 0, height: '100vh', display: 'flex', flexDirection: 'column', background: SIDEBAR_BG, overflowY: 'auto' },
  sideHead:  { padding: '18px 16px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)' },
  sideTitle: { fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 2 },
  sideStore: { fontSize: 12, color: '#94a3b8' },
  sideCats:  { padding: '8px 6px', flex: 1 },
  sideCat:   { display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', borderRadius: 8, border: 'none', background: 'transparent', color: '#cbd5e1', fontSize: 13, cursor: 'pointer', marginBottom: 2 },
  sideCatOn: { background: SIDEBAR_ACTIVE, color: '#fff', fontWeight: 600 },
  sideFooter:{ padding: '12px 14px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: 6 },
  sideLink:  { fontSize: 12, color: '#64748b', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', padding: 0 },

  // Middle
  mid:       { flex: 1, display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' },
  topbar:    { padding: '10px 16px', background: '#fff', borderBottom: '1px solid #e5e7eb', display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 },
  search:    { flex: 1, height: 36, border: '1.5px solid #e5e7eb', borderRadius: 8, padding: '0 12px', fontSize: 14, outline: 'none', background: '#f9fafb' },
  pendingBtn:{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: '1.5px solid #fcd34d', background: '#fffbeb', color: '#92400e', fontSize: 13, fontWeight: 600, cursor: 'pointer', flexShrink: 0 },
  grid:      { flex: 1, overflowY: 'auto', padding: '14px 12px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: 10, alignContent: 'start' },
  pcard:     { background: '#fff', borderRadius: 10, overflow: 'hidden', cursor: 'pointer', border: '1.5px solid transparent', transition: 'all .12s', userSelect: 'none' as const },
  pcardImg:  { height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34, overflow: 'hidden' },
  pcardBody: { padding: '8px 10px 10px' },
  pcardName: { fontSize: 13, fontWeight: 600, color: '#111827', lineHeight: 1.3, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  pcardSpec: { fontSize: 11, color: '#9ca3af', marginBottom: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  pcardPrice:{ fontSize: 15, fontWeight: 700, color: ACCENT },

  // Right
  cart:      { width: 330, flexShrink: 0, height: '100vh', display: 'flex', flexDirection: 'column', background: '#fff', borderLeft: '1px solid #e5e7eb' },
  cartHead:  { padding: '14px 16px 10px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  cartTitle: { fontSize: 15, fontWeight: 700, color: '#111827' },
  cartClear: { fontSize: 12, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', padding: 0 },
  cartItems: { flex: 1, overflowY: 'auto', padding: '6px 0' },
  cartEmpty: { padding: 32, textAlign: 'center', color: '#9ca3af', fontSize: 13 },
  cline:     { display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderBottom: '1px solid #f9fafb' },
  clineInfo: { flex: 1, minWidth: 0 },
  clineName: { fontSize: 13, fontWeight: 500, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  clineSpec: { fontSize: 11, color: '#9ca3af' },
  clineQty:  { display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 },
  qBtn:      { width: 24, height: 24, borderRadius: 6, border: '1px solid #e5e7eb', background: '#f9fafb', color: '#374151', fontSize: 14, cursor: 'pointer', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  qNum:      { fontSize: 13, fontWeight: 600, minWidth: 22, textAlign: 'center' as const, color: '#111827' },
  clineAmt:  { fontSize: 13, fontWeight: 600, color: '#111827', minWidth: 52, textAlign: 'right' as const, flexShrink: 0 },
  cartFoot:  { borderTop: '1px solid #e5e7eb', padding: '12px 14px 16px', flexShrink: 0 },

  payRow:    { display: 'flex', gap: 6, marginBottom: 12 },
  payBtn:    { flex: 1, padding: '8px 0', borderRadius: 8, border: '1.5px solid #e5e7eb', background: '#f9fafb', color: '#374151', fontSize: 12, fontWeight: 500, cursor: 'pointer' },
  payBtnOn:  { border: `1.5px solid ${ACCENT}`, background: '#eff6ff', color: ACCENT, fontWeight: 700 },

  totalRow:  { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 },
  totalLbl:  { fontSize: 14, color: '#6b7280' },
  totalAmt:  { fontSize: 24, fontWeight: 800, color: '#111827' },
  submitBtn: { width: '100%', padding: '13px 0', borderRadius: 10, border: 'none', background: ACCENT, color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer' },
  submitDis: { opacity: 0.4, cursor: 'not-allowed' },

  printHint: { fontSize: 11, color: '#9ca3af', textAlign: 'center' as const, marginTop: 8, lineHeight: 1.4 },

  // Overlay
  overlay:   { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal:     { background: '#fff', borderRadius: 16, padding: '28px 32px', minWidth: 300, maxWidth: 400, textAlign: 'center' },
  modalIcon: { fontSize: 40, marginBottom: 10 },
  modalTitle:{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 6 },
  modalAmt:  { fontSize: 32, fontWeight: 800, color: ACCENT, marginBottom: 4 },
  modalSub:  { fontSize: 13, color: '#6b7280', marginBottom: 20 },
  modalBtn:  { padding: '11px 32px', borderRadius: 10, border: 'none', background: ACCENT, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' },
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CashierPage() {
  const [products,     setProducts]     = useState<Product[]>([])
  const [categories,   setCategories]   = useState<Category[]>([])
  const [activeCatId,  setActiveCatId]  = useState<string | null>(null)
  const [searchKw,     setSearchKw]     = useState('')
  const [cart,         setCart]         = useState<CartLine[]>([])
  const [payment,      setPayment]      = useState<'CASH'|'KHQR'|'OTHER'>('CASH')
  const [submitting,   setSubmitting]   = useState(false)
  const [submitError,  setSubmitError]  = useState('')
  const [saleResult,   setSaleResult]   = useState<SaleResult | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [storeName,    setStoreName]    = useState('')
  const [loading,      setLoading]      = useState(true)
  const searchRef = useRef<HTMLInputElement>(null)

  // ── Load data ───────────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      apiFetch('/api/products').then(r => r.json()),
      apiFetch('/api/categories').then(r => r.json()),
      apiFetch('/api/me').then(r => r.json()),
      apiFetch('/api/customer-orders?status=PENDING,CONFIRMED').then(r => r.json()),
    ]).then(([prods, cats, me, orders]) => {
      setProducts(Array.isArray(prods) ? prods : [])
      setCategories(Array.isArray(cats) ? cats : [])
      setStoreName(me?.storeName ?? '')
      setPendingCount(Array.isArray(orders) ? orders.length : 0)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  // ── Keyboard shortcut: focus search on '/' ──────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── Category hierarchy ──────────────────────────────────────────────────────
  const l1Cats = categories.filter(c => !c.parentId)
  const l2ByParent = new Map<string, Category[]>()
  categories.filter(c => c.parentId).forEach(c => {
    const arr = l2ByParent.get(c.parentId!) ?? []; arr.push(c); l2ByParent.set(c.parentId!, arr)
  })

  // ── Filtered products ───────────────────────────────────────────────────────
  const kw = searchKw.trim().toLowerCase()
  const displayProducts = products.filter(p => {
    if (kw && !p.name.toLowerCase().includes(kw) && !(p.spec ?? '').toLowerCase().includes(kw)) return false
    if (!activeCatId) return true
    const l2Ids = new Set((l2ByParent.get(activeCatId) ?? []).map(c => c.id))
    return p.categoryId === activeCatId || (p.categoryId !== null && l2Ids.has(p.categoryId))
  })

  // ── Cart ops ─────────────────────────────────────────────────────────────────
  const addToCart = useCallback((p: Product) => {
    setCart(prev => {
      const found = prev.find(c => c.barcode === p.barcode)
      if (found) return prev.map(c => c.barcode === p.barcode ? { ...c, qty: c.qty + 1 } : c)
      return [...prev, { barcode: p.barcode, name: p.name, spec: p.spec, price: p.sellPrice, qty: 1, imageUrl: p.imageUrl }]
    })
  }, [])

  const updateQty = useCallback((barcode: string, delta: number) => {
    setCart(prev =>
      prev.map(c => c.barcode === barcode ? { ...c, qty: c.qty + delta } : c).filter(c => c.qty > 0)
    )
  }, [])

  // ── Submit sale ──────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (cart.length === 0 || submitting) return
    setSubmitting(true)
    setSubmitError('')
    const apiPayment = payment === 'OTHER' ? 'CASH' : payment
    try {
      const res = await apiFetch('/api/sales', {
        method: 'POST',
        body: JSON.stringify({
          saleType: 'SALE',
          items: cart.map(c => ({ barcode: c.barcode, quantity: c.qty })),
          paymentMethod: apiPayment,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setSubmitError(body.message ?? body.error ?? '提交失败，请重试')
        return
      }
      const total = cartTotal(cart)
      setCart([])
      setSaleResult({ recordNo: body.recordNo ?? body.orderNo, totalAmount: total })
    } catch {
      setSubmitError('网络错误，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  const total = cartTotal(cart)
  const count = cartCount(cart)

  return (
    <div style={s.root}>
      {/* ── LEFT SIDEBAR ─────────────────────────────────────────────────────── */}
      <div style={s.sidebar}>
        <div style={s.sideHead}>
          <div style={s.sideTitle}>🏪 收银台</div>
          <div style={s.sideStore}>{storeName || '加载中…'}</div>
        </div>

        <div style={s.sideCats}>
          <button
            style={{ ...s.sideCat, ...(activeCatId === null ? s.sideCatOn : {}) }}
            onClick={() => setActiveCatId(null)}
          >
            全部商品
            {activeCatId === null && <span style={{ float: 'right', fontSize: 11, opacity: 0.7 }}>{products.length}</span>}
          </button>

          {l1Cats.map(cat => {
            const l2Ids = new Set((l2ByParent.get(cat.id) ?? []).map(c => c.id))
            const cnt = products.filter(p => p.categoryId === cat.id || (p.categoryId !== null && l2Ids.has(p.categoryId))).length
            const isOn = activeCatId === cat.id
            return (
              <button
                key={cat.id}
                style={{ ...s.sideCat, ...(isOn ? s.sideCatOn : {}) }}
                onClick={() => setActiveCatId(cat.id)}
              >
                {cat.name}
                <span style={{ float: 'right', fontSize: 11, opacity: 0.7 }}>{cnt}</span>
              </button>
            )
          })}
        </div>

        <div style={s.sideFooter}>
          <button style={s.sideLink} onClick={() => window.location.href = '/home'}>← 接单看板</button>
          <button style={s.sideLink} onClick={() => window.location.href = '/products'}>商品管理</button>
          <button style={s.sideLink} onClick={() => window.location.href = '/records'}>销售记录</button>
        </div>
      </div>

      {/* ── MIDDLE ───────────────────────────────────────────────────────────── */}
      <div style={s.mid}>
        {/* Top bar */}
        <div style={s.topbar}>
          <input
            ref={searchRef}
            style={s.search}
            placeholder="搜索商品… （按 / 快速聚焦）"
            value={searchKw}
            onChange={e => setSearchKw(e.target.value)}
          />
          {pendingCount > 0 && (
            <button style={s.pendingBtn} onClick={() => window.location.href = '/home'}>
              📋 待处理扫码订单
              <span style={{ background: '#f59e0b', color: '#fff', borderRadius: 12, padding: '1px 7px', fontSize: 12, fontWeight: 700 }}>
                {pendingCount}
              </span>
            </button>
          )}
        </div>

        {/* Product grid */}
        <div style={s.grid}>
          {loading && (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', color: '#9ca3af', padding: 40, fontSize: 14 }}>
              加载商品中…
            </div>
          )}
          {!loading && displayProducts.length === 0 && (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', color: '#9ca3af', padding: 40, fontSize: 14 }}>
              {kw ? `未找到"${kw}"` : '该分类暂无商品'}
            </div>
          )}
          {displayProducts.map((p, idx) => {
            const inCart = cart.find(c => c.barcode === p.barcode)
            const color = COLORS[idx % COLORS.length]
            const emoji = EMOJIS[idx % EMOJIS.length]
            return (
              <div
                key={p.id}
                style={{
                  ...s.pcard,
                  borderColor: inCart ? ACCENT : 'transparent',
                  boxShadow: inCart ? `0 0 0 1px ${ACCENT}` : '0 1px 4px rgba(0,0,0,0.07)',
                }}
                onClick={() => addToCart(p)}
                title={`点击加入购物车`}
              >
                {/* Image or color block */}
                {p.imageUrl ? (
                  <div style={s.pcardImg}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.imageUrl} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                ) : (
                  <div style={{ ...s.pcardImg, background: color }}>{emoji}</div>
                )}
                <div style={s.pcardBody}>
                  <div style={s.pcardName}>{p.name}</div>
                  {p.spec && <div style={s.pcardSpec}>{p.spec}</div>}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={s.pcardPrice}>${p.sellPrice.toFixed(2)}</span>
                    {inCart && (
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', background: ACCENT, borderRadius: 10, padding: '1px 8px' }}>
                        ×{inCart.qty}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── RIGHT CART PANEL ─────────────────────────────────────────────────── */}
      <div style={s.cart}>
        {/* Header */}
        <div style={s.cartHead}>
          <span style={s.cartTitle}>购物车 {count > 0 && <span style={{ fontSize: 13, color: '#6b7280', fontWeight: 400 }}>({count} 件)</span>}</span>
          {cart.length > 0 && (
            <button style={s.cartClear} onClick={() => setCart([])}>清空</button>
          )}
        </div>

        {/* Items */}
        <div style={s.cartItems}>
          {cart.length === 0 ? (
            <div style={s.cartEmpty}>点击商品卡片加入购物车</div>
          ) : (
            cart.map(line => (
              <div key={line.barcode} style={s.cline}>
                <div style={s.clineInfo}>
                  <div style={s.clineName}>{line.name}</div>
                  {line.spec && <div style={s.clineSpec}>{line.spec}</div>}
                </div>
                <div style={s.clineQty}>
                  <button style={s.qBtn} onClick={() => updateQty(line.barcode, -1)}>−</button>
                  <span style={s.qNum}>{line.qty}</span>
                  <button style={s.qBtn} onClick={() => updateQty(line.barcode, +1)}>+</button>
                </div>
                <span style={s.clineAmt}>${(line.price * line.qty).toFixed(2)}</span>
              </div>
            ))
          )}
        </div>

        {/* Footer: payment + submit */}
        <div style={s.cartFoot}>
          {/* Payment method */}
          <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8, fontWeight: 600 }}>收款方式</div>
          <div style={s.payRow}>
            {(['CASH','KHQR','OTHER'] as const).map(m => (
              <button
                key={m}
                style={{ ...s.payBtn, ...(payment === m ? s.payBtnOn : {}) }}
                onClick={() => setPayment(m)}
              >
                {m === 'CASH' ? '💵 现金' : m === 'KHQR' ? '📱 KHQR' : '🔧 其他'}
              </button>
            ))}
          </div>

          {payment === 'OTHER' && (
            <div style={{ fontSize: 11, color: '#f59e0b', background: '#fffbeb', borderRadius: 6, padding: '5px 10px', marginBottom: 10 }}>
              「其他」将以现金方式记录，仅作展示区分。
            </div>
          )}

          {/* Total */}
          <div style={s.totalRow}>
            <span style={s.totalLbl}>合计</span>
            <span style={s.totalAmt}>${total.toFixed(2)}</span>
          </div>

          {/* Error */}
          {submitError && (
            <div style={{ fontSize: 13, color: '#ef4444', marginBottom: 10, padding: '6px 10px', background: '#fef2f2', borderRadius: 6 }}>
              {submitError}
            </div>
          )}

          {/* Submit */}
          <button
            style={{ ...s.submitBtn, ...(cart.length === 0 || submitting ? s.submitDis : {}) }}
            disabled={cart.length === 0 || submitting}
            onClick={handleSubmit}
          >
            {submitting ? '处理中…' : '✓ 完成销售'}
          </button>

          {/* Print hint */}
          <div style={s.printHint}>
            🖨️ 打印暂未连接<br />
            如需打印小票，请在 mPOS 手机端操作
          </div>
        </div>
      </div>

      {/* ── SUCCESS OVERLAY ───────────────────────────────────────────────────── */}
      {saleResult && (
        <div style={s.overlay} onClick={() => setSaleResult(null)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <div style={s.modalIcon}>✅</div>
            <div style={s.modalTitle}>销售完成</div>
            <div style={s.modalAmt}>${saleResult.totalAmount.toFixed(2)}</div>
            {saleResult.recordNo && (
              <div style={s.modalSub}>单号：{saleResult.recordNo}</div>
            )}
            <button style={s.modalBtn} onClick={() => { setSaleResult(null); searchRef.current?.focus() }}>
              继续收银
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
