'use client'

import { useState, useEffect, useCallback, useRef, CSSProperties } from 'react'

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
  sugar?: string
}

type SaleResult = { orderNo?: string; totalAmount: number; khqrFallback?: boolean }

type CashierOrderItem = {
  productId: string; name: string; spec: string | null
  price: number; quantity: number; lineAmount: number; sugar?: string | null
}

type CashierOrder = {
  id: string; orderNo: string; tableNo: string | null
  items: CashierOrderItem[]; totalAmount: number
  status: 'PENDING' | 'CONFIRMED'
  remark: string | null; createdAt: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const COLORS = ['#fde68a','#bbf7d0','#bfdbfe','#fecaca','#ddd6fe','#fed7aa','#a5f3fc','#fda4af']
const EMOJIS = ['☕','🧋','🍵','🥤','🍰','🥐','🍜','🍱','🥗','🧁']

const SUGAR_SPEC_RE = /no\s*sugar|无糖|微糖|半糖|少糖|正常糖|(?:25|50|75|100)%/i

const SUGAR_OPTIONS = [
  { value: 'no_sugar', label: '无糖' },
  { value: '25',       label: '微糖 25%' },
  { value: '50',       label: '半糖 50%' },
  { value: '75',       label: '少糖 75%' },
  { value: '100',      label: '正常糖 100%' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sugarZh(sugar: string): string {
  if (sugar === 'no_sugar') return '无糖'
  if (sugar === '25')       return '微糖 25%'
  if (sugar === '50')       return '半糖 50%'
  if (sugar === '75')       return '少糖 75%'
  if (sugar === '100')      return '正常糖 100%'
  return sugar
}

function cartLineKey(line: CartLine) { return line.barcode + (line.sugar ?? '') }
function cartTotal(cart: CartLine[]) { return cart.reduce((s, c) => s + c.price * c.qty, 0) }
function cartCount(cart: CartLine[]) { return cart.reduce((s, c) => s + c.qty, 0) }

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function shortNo(orderNo: string) {
  const seg = orderNo.split('-').pop() ?? orderNo
  return `#${seg.slice(-6) || seg}`
}

function playAlertSound() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctx = window.AudioContext || (window as any).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const play = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.frequency.setValueAtTime(freq, ctx.currentTime + start)
      gain.gain.setValueAtTime(0.25, ctx.currentTime + start)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur)
      osc.start(ctx.currentTime + start); osc.stop(ctx.currentTime + start + dur)
    }
    play(880, 0, 0.12); play(1100, 0.14, 0.15)
  } catch {}
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const SIDEBAR_BG  = '#0f172a'
const SIDEBAR_ACT = '#2563eb'
const ACCENT      = '#2563eb'

const s: Record<string, CSSProperties> = {
  // Root
  root:        { display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: 'system-ui,-apple-system,sans-serif', background: '#f1f5f9' },

  // ── Left sidebar ──────────────────────────────────────────────────────────
  sidebar:     { width: 200, flexShrink: 0, height: '100vh', display: 'flex', flexDirection: 'column', background: SIDEBAR_BG, overflowY: 'auto' },
  sideHead:    { padding: '16px 14px 12px', borderBottom: '1px solid rgba(255,255,255,.08)' },
  sideTitle:   { fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 2 },
  sideStore:   { fontSize: 11, color: '#94a3b8', marginTop: 2, lineHeight: 1.4 },
  sideCats:    { padding: '8px 6px', flex: 1 },
  sideCat:     { display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 8, border: 'none', background: 'transparent', color: '#cbd5e1', fontSize: 13, cursor: 'pointer', marginBottom: 2 },
  sideCatOn:   { background: SIDEBAR_ACT, color: '#fff', fontWeight: 600 },
  sideFooter:  { padding: '10px 12px', borderTop: '1px solid rgba(255,255,255,.08)', display: 'flex', flexDirection: 'column', gap: 6 },
  sideLinkPri: { fontSize: 12, color: '#60a5fa', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', padding: 0, fontWeight: 600 },
  sideLinkSec: { fontSize: 12, color: '#475569', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', padding: 0 },

  // ── Middle: product grid ──────────────────────────────────────────────────
  mid:         { flex: 1, display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', minWidth: 0 },
  topbar:      { padding: '10px 14px', background: '#fff', borderBottom: '1px solid #e5e7eb', display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 },
  search:      { flex: 1, height: 36, border: '1.5px solid #e5e7eb', borderRadius: 8, padding: '0 12px', fontSize: 14, outline: 'none', background: '#f9fafb' },
  grid:        { flex: 1, overflowY: 'auto', padding: '12px 10px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(148px,1fr))', gap: 10, alignContent: 'start' },
  pcard:       { background: '#fff', borderRadius: 10, overflow: 'hidden', cursor: 'pointer', border: '1.5px solid transparent', transition: 'all .12s', userSelect: 'none' as const },
  pcardImg:    { height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, overflow: 'hidden' },
  pcardBody:   { padding: '7px 10px 10px' },
  pcardName:   { fontSize: 13, fontWeight: 600, color: '#111827', lineHeight: 1.3, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  pcardSpec:   { fontSize: 11, color: '#9ca3af', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  pcardPrice:  { fontSize: 15, fontWeight: 700, color: ACCENT },

  // ── Right work area ───────────────────────────────────────────────────────
  right:       { width: 390, flexShrink: 0, height: '100vh', display: 'flex', flexDirection: 'column', background: '#fff', borderLeft: '1px solid #e5e7eb', overflow: 'hidden' },

  // Orders section (top of right panel)
  ordSec:      { flexShrink: 0, maxHeight: '42vh', display: 'flex', flexDirection: 'column', borderBottom: '2px solid #e5e7eb', overflow: 'hidden' },
  ordHead:     { padding: '10px 14px 8px', display: 'flex', alignItems: 'center', gap: 8, background: '#fff', flexShrink: 0, borderBottom: '1px solid #f1f5f9' },
  ordHeadTitle:{ fontSize: 13, fontWeight: 700, color: '#374151' },
  ordBadge:    { fontSize: 11, background: '#fef3c7', color: '#92400e', borderRadius: 10, padding: '1px 7px', fontWeight: 700 },
  ordList:     { flex: 1, overflowY: 'auto', padding: '4px 8px 6px' },
  ordEmpty:    { textAlign: 'center', color: '#9ca3af', fontSize: 12, padding: '14px 0' },

  // Compact order card
  ocard:       { border: '1px solid #e5e7eb', borderRadius: 10, marginBottom: 6, overflow: 'hidden', background: '#fafafa' },
  ocHead:      { padding: '7px 10px 5px', display: 'flex', alignItems: 'center', gap: 6, background: '#fff' },
  ocNo:        { fontSize: 13, fontWeight: 700, color: '#111827', flex: 1 },
  ocBadge:     { fontSize: 10, padding: '2px 7px', borderRadius: 8, fontWeight: 600, flexShrink: 0 },
  ocTime:      { fontSize: 11, color: '#9ca3af', flexShrink: 0 },
  ocMeta:      { padding: '3px 10px', fontSize: 11, color: '#6b7280', borderBottom: '1px solid #f1f5f9' },
  ocItems:     { padding: '4px 10px 2px', fontSize: 12, color: '#374151' },
  ocFoot:      { padding: '5px 8px 6px', display: 'flex', alignItems: 'center', gap: 6, background: '#fff' },
  ocTotal:     { flex: 1, fontSize: 14, fontWeight: 800, color: ACCENT },
  ocBtn:       { padding: '4px 10px', borderRadius: 7, border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer', flexShrink: 0 },

  // Cart section (middle of right panel)
  cartSec:     { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' },
  cartHead:    { padding: '8px 14px 6px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 },
  cartTitle:   { fontSize: 13, fontWeight: 700, color: '#374151' },
  cartClear:   { fontSize: 11, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', padding: 0 },
  cartList:    { flex: 1, overflowY: 'auto', padding: '4px 0', minHeight: 0 },
  cartEmpty:   { padding: '24px 0', textAlign: 'center', color: '#9ca3af', fontSize: 13 },
  cline:       { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderBottom: '1px solid #f9fafb' },
  clineInfo:   { flex: 1, minWidth: 0 },
  clineName:   { fontSize: 13, fontWeight: 500, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  clineSpec:   { fontSize: 11, color: '#9ca3af' },
  clineQty:    { display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 },
  qBtn:        { width: 22, height: 22, borderRadius: 5, border: '1px solid #e5e7eb', background: '#f9fafb', color: '#374151', fontSize: 14, cursor: 'pointer', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  qNum:        { fontSize: 13, fontWeight: 600, minWidth: 20, textAlign: 'center' as const, color: '#111827' },
  clineAmt:    { fontSize: 13, fontWeight: 600, color: '#111827', minWidth: 50, textAlign: 'right' as const, flexShrink: 0 },

  // Payment / checkout section (bottom of right panel, always visible)
  paySec:      { flexShrink: 0, borderTop: '2px solid #e5e7eb', padding: '10px 14px 14px', background: '#fff' },
  payLabel:    { fontSize: 11, color: '#9ca3af', fontWeight: 600, marginBottom: 7 },
  payRow:      { display: 'flex', gap: 6, marginBottom: 10 },
  payBtn:      { flex: 1, padding: '7px 0', borderRadius: 8, border: '1.5px solid #e5e7eb', background: '#f9fafb', color: '#374151', fontSize: 12, fontWeight: 500, cursor: 'pointer' },
  payBtnOn:    { border: `1.5px solid ${ACCENT}`, background: '#eff6ff', color: ACCENT, fontWeight: 700 },
  totalRow:    { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 },
  totalLbl:    { fontSize: 14, color: '#6b7280' },
  totalAmt:    { fontSize: 26, fontWeight: 800, color: '#111827' },
  submitBtn:   { width: '100%', padding: '12px 0', borderRadius: 10, border: 'none', background: ACCENT, color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer' },
  submitDis:   { opacity: 0.4, cursor: 'not-allowed' },
  printHint:   { fontSize: 10, color: '#9ca3af', textAlign: 'center' as const, marginTop: 7, lineHeight: 1.4 },

  // Sugar modal (centered)
  sugarMask:   { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  sugarBox:    { background: '#fff', borderRadius: 18, padding: '28px 28px 24px', width: 'min(500px,90vw)', boxShadow: '0 8px 40px rgba(0,0,0,0.22)' },
  sugarName:   { fontSize: 13, color: '#6b7280', textAlign: 'center' as const, marginBottom: 6 },
  sugarTitle:  { fontSize: 19, fontWeight: 800, color: '#111827', textAlign: 'center' as const, marginBottom: 22 },
  sugarGrid:   { display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10, marginBottom: 24 },
  sugarOpt:    { padding: '12px 4px', borderRadius: 10, border: '2px solid #e5e7eb', background: '#f9fafb', fontSize: 12, cursor: 'pointer', textAlign: 'center' as const, fontWeight: 500, color: '#374151', transition: 'all .1s' },
  sugarOptOn:  { border: '2px solid #2563eb', background: '#2563eb', color: '#fff', fontWeight: 700 },
  sugarConfirm:{ width: '100%', padding: '13px 0', borderRadius: 10, border: 'none', background: ACCENT, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', marginBottom: 8 },
  sugarCancel: { width: '100%', padding: '9px 0', borderRadius: 10, border: '1px solid #e5e7eb', background: '#fff', color: '#6b7280', fontSize: 13, cursor: 'pointer' },

  // Sale success overlay
  overlay:     { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal:       { background: '#fff', borderRadius: 16, padding: '28px 32px', minWidth: 300, maxWidth: 400, textAlign: 'center' },
  modalIcon:   { fontSize: 40, marginBottom: 10 },
  modalTitle:  { fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 6 },
  modalAmt:    { fontSize: 32, fontWeight: 800, color: ACCENT, marginBottom: 4 },
  modalSub:    { fontSize: 13, color: '#6b7280', marginBottom: 20 },
  modalBtn:    { padding: '11px 32px', borderRadius: 10, border: 'none', background: ACCENT, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' },

  // Toast + error screen
  toast:       { position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: 'rgba(17,24,39,.9)', color: '#fff', borderRadius: 10, padding: '9px 18px', fontSize: 13, zIndex: 200, whiteSpace: 'nowrap' as const, pointerEvents: 'none' },
  errScreen:   { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#f1f5f9', flexDirection: 'column', gap: 12, padding: 32 },
  errTitle:    { fontSize: 18, fontWeight: 700, color: '#111827' },
  errSub:      { fontSize: 13, color: '#6b7280', textAlign: 'center' as const, maxWidth: 380, lineHeight: 1.6 },
  errCode:     { fontSize: 12, color: '#9ca3af', fontFamily: 'monospace', background: '#fff', padding: '6px 14px', borderRadius: 6, border: '1px solid #e5e7eb' },
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function CashierPage() {
  const [storeCode,     setStoreCode]     = useState<string | null>(null)
  const [noCodeError,   setNoCodeError]   = useState(false)
  const [products,      setProducts]      = useState<Product[]>([])
  const [categories,    setCategories]    = useState<Category[]>([])
  const [activeCatId,   setActiveCatId]   = useState<string | null>(null)
  const [searchKw,      setSearchKw]      = useState('')
  const [cart,          setCart]          = useState<CartLine[]>([])
  const [payment,       setPayment]       = useState<'CASH'|'KHQR'|'OTHER'>('CASH')
  const [submitting,    setSubmitting]    = useState(false)
  const [submitError,   setSubmitError]   = useState('')
  const [saleResult,    setSaleResult]    = useState<SaleResult | null>(null)
  const [storeName,     setStoreName]     = useState('')
  const [loading,       setLoading]       = useState(true)
  const [toast,         setToast]         = useState('')
  const [sugarModal,    setSugarModal]    = useState<Product | null>(null)
  const [pendingSugar,  setPendingSugar]  = useState('50')
  const [pendingOrders, setPendingOrders] = useState<CashierOrder[]>([])
  const [updatingId,    setUpdatingId]    = useState<string | null>(null)
  const knownOrderIds   = useRef<Set<string>>(new Set())
  const initialPollDone = useRef(false)
  const searchRef       = useRef<HTMLInputElement>(null)
  const ordersRef       = useRef<HTMLDivElement>(null)

  // ── Load store data ────────────────────────────────────────────────────────
  useEffect(() => {
    const sc = new URLSearchParams(window.location.search).get('storeCode')?.trim() || null
    if (!sc) { setNoCodeError(true); setLoading(false); return }
    setStoreCode(sc)
    fetch(`/api/cashier/store?storeCode=${encodeURIComponent(sc)}`)
      .then(r => r.json())
      .then(d => {
        setProducts(Array.isArray(d.products) ? d.products : [])
        setCategories(Array.isArray(d.categories) ? d.categories : [])
        setStoreName(d.storeName ?? '')
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // ── Poll pending orders every 5s ───────────────────────────────────────────
  useEffect(() => {
    if (!storeCode) return
    function poll() {
      fetch(`/api/cashier/orders?storeCode=${encodeURIComponent(storeCode!)}`)
        .then(r => r.json())
        .then((data: CashierOrder[]) => {
          if (!Array.isArray(data)) return
          if (!initialPollDone.current) {
            initialPollDone.current = true
            data.forEach(o => knownOrderIds.current.add(o.id))
            setPendingOrders(data)
            return
          }
          const newOnes = data.filter(o => !knownOrderIds.current.has(o.id))
          data.forEach(o => knownOrderIds.current.add(o.id))
          setPendingOrders(data)
          if (newOnes.length > 0) playAlertSound()
        })
        .catch(() => {})
    }
    poll()
    const timer = setInterval(poll, 5000)
    return () => clearInterval(timer)
  }, [storeCode])

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault(); searchRef.current?.focus()
      }
      if (e.key === 'Escape') setSugarModal(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 3000) }

  // ── Category hierarchy ─────────────────────────────────────────────────────
  const l1Cats = categories.filter(c => !c.parentId)
  const l2ByParent = new Map<string, Category[]>()
  categories.filter(c => c.parentId).forEach(c => {
    const arr = l2ByParent.get(c.parentId!) ?? []; arr.push(c); l2ByParent.set(c.parentId!, arr)
  })

  // ── Sugar detection (mirrors H5 menu logic) ────────────────────────────────
  function needsSugar(p: Product): boolean {
    if (p.spec && SUGAR_SPEC_RE.test(p.spec)) return true
    if (!p.categoryId) return false
    const cat = categories.find(c => c.id === p.categoryId)
    if (!cat) return false
    const parentName = cat.parentId ? (categories.find(c => c.id === cat.parentId)?.name ?? '') : ''
    return /coffee|咖啡/i.test(cat.name) || /coffee|咖啡/i.test(parentName)
  }

  function handleAddClick(p: Product) {
    if (needsSugar(p)) { setPendingSugar('50'); setSugarModal(p) }
    else addToCart(p)
  }

  // ── Cart ops ───────────────────────────────────────────────────────────────
  const addToCart = useCallback((p: Product, sugar?: string) => {
    setCart(prev => {
      const found = prev.find(c => c.barcode === p.barcode && c.sugar === sugar)
      if (found) return prev.map(c => c.barcode === p.barcode && c.sugar === sugar ? { ...c, qty: c.qty + 1 } : c)
      return [...prev, { barcode: p.barcode, name: p.name, spec: p.spec, price: p.sellPrice, qty: 1, imageUrl: p.imageUrl, sugar }]
    })
  }, [])

  const updateQty = useCallback((barcode: string, sugar: string | undefined, delta: number) => {
    setCart(prev =>
      prev.map(c => c.barcode === barcode && c.sugar === sugar ? { ...c, qty: c.qty + delta } : c).filter(c => c.qty > 0)
    )
  }, [])

  // ── Submit sale ────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (cart.length === 0 || submitting || !storeCode) return
    setSubmitting(true); setSubmitError('')
    const apiPayment = payment === 'OTHER' ? 'CASH' : payment
    try {
      const res = await fetch('/api/cashier/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeCode,
          items: cart.map(c => ({ barcode: c.barcode, quantity: c.qty, ...(c.sugar ? { sugar: c.sugar } : {}) })),
          paymentMethod: apiPayment,
        }),
      })
      const body = await res.json()
      if (!res.ok) { setSubmitError(body.message ?? body.error ?? '提交失败，请重试'); return }
      setCart([])
      setSaleResult({ orderNo: body.orderNo, totalAmount: cartTotal(cart), khqrFallback: body.khqrFallback ?? false })
    } catch { setSubmitError('网络错误，请重试') }
    finally { setSubmitting(false) }
  }

  // ── Order actions ──────────────────────────────────────────────────────────
  async function handleOrderAction(id: string, newStatus: string) {
    if (!storeCode) return
    setUpdatingId(id)
    try {
      const res = await fetch(`/api/cashier/orders/${id}?storeCode=${encodeURIComponent(storeCode)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (res.ok) {
        if (newStatus === 'COMPLETED' || newStatus === 'CANCELLED') {
          knownOrderIds.current.delete(id)
          setPendingOrders(prev => prev.filter(o => o.id !== id))
        } else {
          setPendingOrders(prev => prev.map(o => o.id === id ? { ...o, status: newStatus as 'PENDING' | 'CONFIRMED' } : o))
        }
      }
    } catch {}
    setUpdatingId(null)
  }

  // ── Filtered products ──────────────────────────────────────────────────────
  const kw = searchKw.trim().toLowerCase()
  const displayProducts = products.filter(p => {
    if (kw && !p.name.toLowerCase().includes(kw) && !(p.spec ?? '').toLowerCase().includes(kw)) return false
    if (!activeCatId) return true
    const l2Ids = new Set((l2ByParent.get(activeCatId) ?? []).map(c => c.id))
    return p.categoryId === activeCatId || (p.categoryId !== null && l2Ids.has(p.categoryId))
  })

  const total = cartTotal(cart)
  const count = cartCount(cart)

  // ── No storeCode error ─────────────────────────────────────────────────────
  if (noCodeError) {
    return (
      <div style={s.errScreen}>
        <div style={{ fontSize: 36 }}>🖥️</div>
        <div style={s.errTitle}>缺少门店信息</div>
        <div style={s.errSub}>
          请在手机商户端打开「/home」页，找到「常用入口 → 电脑收银台」，
          复制完整链接后在电脑浏览器中打开。
        </div>
        <div style={s.errCode}>链接格式：/cashier?storeCode=你的门店编号</div>
      </div>
    )
  }

  return (
    <div>
      {/* ── Sugar modal — centered ─────────────────────────────────────────── */}
      {sugarModal && (
        <div style={s.sugarMask} onClick={() => setSugarModal(null)}>
          <div style={s.sugarBox} onClick={e => e.stopPropagation()}>
            <div style={s.sugarName}>{sugarModal.name}</div>
            <div style={s.sugarTitle}>糖度选择</div>
            <div style={s.sugarGrid}>
              {SUGAR_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  style={{ ...s.sugarOpt, ...(pendingSugar === opt.value ? s.sugarOptOn : {}) }}
                  onClick={() => setPendingSugar(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button style={s.sugarConfirm} onClick={() => { addToCart(sugarModal, pendingSugar); setSugarModal(null) }}>
              确认加入购物车
            </button>
            <button style={s.sugarCancel} onClick={() => setSugarModal(null)}>取消</button>
          </div>
        </div>
      )}

      {/* ── Toast ─────────────────────────────────────────────────────────── */}
      {toast && <div style={s.toast}>{toast}</div>}

      {/* ── Main 3-column layout ──────────────────────────────────────────── */}
      <div style={s.root}>

        {/* LEFT SIDEBAR */}
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
                <button key={cat.id} style={{ ...s.sideCat, ...(isOn ? s.sideCatOn : {}) }} onClick={() => setActiveCatId(cat.id)}>
                  {cat.name}
                  <span style={{ float: 'right', fontSize: 11, opacity: 0.7 }}>{cnt}</span>
                </button>
              )
            })}
          </div>
          <div style={s.sideFooter}>
            <button style={s.sideLinkPri} onClick={() => ordersRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
              📋 接单看板
              {pendingOrders.length > 0 && (
                <span style={{ marginLeft: 6, background: '#fcd34d', color: '#92400e', borderRadius: 8, padding: '0 5px', fontSize: 11 }}>
                  {pendingOrders.length}
                </span>
              )}
            </button>
            <button style={s.sideLinkSec} onClick={() => showToast('请在手机商户端管理商品')}>商品管理</button>
            <button style={s.sideLinkSec} onClick={() => showToast('请在手机商户端查看销售记录')}>销售记录</button>
          </div>
        </div>

        {/* MIDDLE: product grid */}
        <div style={s.mid}>
          <div style={s.topbar}>
            <input
              ref={searchRef}
              style={s.search}
              placeholder="搜索商品… （按 / 快速聚焦）"
              value={searchKw}
              onChange={e => setSearchKw(e.target.value)}
            />
          </div>
          <div style={s.grid}>
            {loading && (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', color: '#9ca3af', padding: 40, fontSize: 14 }}>加载商品中…</div>
            )}
            {!loading && displayProducts.length === 0 && (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', color: '#9ca3af', padding: 40, fontSize: 14 }}>
                {kw ? `未找到"${kw}"` : '该分类暂无商品'}
              </div>
            )}
            {displayProducts.map((p, idx) => {
              const inCart = cart.filter(c => c.barcode === p.barcode).reduce((s, c) => s + c.qty, 0)
              const color  = COLORS[idx % COLORS.length]
              const emoji  = EMOJIS[idx % EMOJIS.length]
              return (
                <div
                  key={p.id}
                  style={{ ...s.pcard, borderColor: inCart ? ACCENT : 'transparent', boxShadow: inCart ? `0 0 0 1px ${ACCENT}` : '0 1px 4px rgba(0,0,0,.07)' }}
                  onClick={() => handleAddClick(p)}
                >
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
                      {inCart > 0 && (
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', background: ACCENT, borderRadius: 10, padding: '1px 7px' }}>
                          ×{inCart}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* RIGHT WORK AREA */}
        <div style={s.right}>

          {/* ── TOP: Pending orders section ──────────────────────────────── */}
          <div style={s.ordSec} ref={ordersRef}>
            <div style={s.ordHead}>
              <span style={s.ordHeadTitle}>📋 待处理顾客订单</span>
              {pendingOrders.length > 0
                ? <span style={s.ordBadge}>{pendingOrders.length}</span>
                : <span style={{ fontSize: 11, color: '#9ca3af' }}>暂无</span>
              }
            </div>
            <div style={s.ordList}>
              {pendingOrders.length === 0 ? (
                <div style={s.ordEmpty}>暂无待处理顾客订单</div>
              ) : pendingOrders.map(order => {
                const isPending  = order.status === 'PENDING'
                const isUpdating = updatingId === order.id
                const itemsSummary = order.items
                  .slice(0, 3)
                  .map(i => {
                    const spec = [i.spec, i.sugar ? sugarZh(i.sugar) : null].filter(Boolean).join('/')
                    return `${i.name}${spec ? `(${spec})` : ''}×${i.quantity}`
                  })
                  .join('、') + (order.items.length > 3 ? `…等${order.items.length}件` : '')
                return (
                  <div key={order.id} style={s.ocard}>
                    <div style={s.ocHead}>
                      <span style={s.ocNo}>{shortNo(order.orderNo)}</span>
                      <span style={{
                        ...s.ocBadge,
                        background: isPending ? '#fef3c7' : '#dbeafe',
                        color:      isPending ? '#92400e' : '#1d4ed8',
                      }}>
                        {isPending ? '待确认' : '已确认'}
                      </span>
                      <span style={s.ocTime}>{fmtTime(order.createdAt)}</span>
                    </div>
                    <div style={s.ocMeta}>
                      {order.tableNo ? `🪑 桌号 ${order.tableNo}` : '🛍 自取/外卖'}
                    </div>
                    <div style={s.ocItems}>{itemsSummary}</div>
                    <div style={s.ocFoot}>
                      <span style={s.ocTotal}>${order.totalAmount.toFixed(2)}</span>
                      {isPending && (
                        <button
                          style={{ ...s.ocBtn, background: ACCENT, color: '#fff', opacity: isUpdating ? 0.5 : 1 }}
                          disabled={isUpdating}
                          onClick={() => handleOrderAction(order.id, 'CONFIRMED')}
                        >
                          ✓ 确认
                        </button>
                      )}
                      {!isPending && (
                        <button
                          style={{ ...s.ocBtn, background: '#10b981', color: '#fff', opacity: isUpdating ? 0.5 : 1 }}
                          disabled={isUpdating}
                          onClick={() => handleOrderAction(order.id, 'COMPLETED')}
                        >
                          ✓ 完成
                        </button>
                      )}
                      <button
                        style={{ ...s.ocBtn, background: '#f1f5f9', color: '#9ca3af', border: '1px solid #e5e7eb', opacity: isUpdating ? 0.5 : 1 }}
                        disabled={isUpdating}
                        onClick={() => handleOrderAction(order.id, 'CANCELLED')}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── MIDDLE: Cart ──────────────────────────────────────────────── */}
          <div style={s.cartSec}>
            <div style={s.cartHead}>
              <span style={s.cartTitle}>
                购物车
                {count > 0 && <span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 400, marginLeft: 6 }}>({count} 件)</span>}
              </span>
              {cart.length > 0 && <button style={s.cartClear} onClick={() => setCart([])}>清空</button>}
            </div>
            <div style={s.cartList}>
              {cart.length === 0 ? (
                <div style={s.cartEmpty}>点击商品卡片加入购物车</div>
              ) : cart.map(line => {
                const specDisplay = [line.spec, line.sugar ? sugarZh(line.sugar) : null].filter(Boolean).join(' / ')
                return (
                  <div key={cartLineKey(line)} style={s.cline}>
                    <div style={s.clineInfo}>
                      <div style={s.clineName}>{line.name}</div>
                      {specDisplay && <div style={s.clineSpec}>{specDisplay}</div>}
                    </div>
                    <div style={s.clineQty}>
                      <button style={s.qBtn} onClick={() => updateQty(line.barcode, line.sugar, -1)}>−</button>
                      <span style={s.qNum}>{line.qty}</span>
                      <button style={s.qBtn} onClick={() => updateQty(line.barcode, line.sugar, +1)}>+</button>
                    </div>
                    <span style={s.clineAmt}>${(line.price * line.qty).toFixed(2)}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── BOTTOM: Payment & checkout (always visible) ───────────────── */}
          <div style={s.paySec}>
            <div style={s.payLabel}>收款方式</div>
            <div style={s.payRow}>
              {(['CASH','KHQR','OTHER'] as const).map(m => (
                <button key={m} style={{ ...s.payBtn, ...(payment === m ? s.payBtnOn : {}) }} onClick={() => setPayment(m)}>
                  {m === 'CASH' ? '💵 现金' : m === 'KHQR' ? '📱 KHQR' : '🔧 其他'}
                </button>
              ))}
            </div>
            {payment === 'OTHER' && (
              <div style={{ fontSize: 11, color: '#f59e0b', background: '#fffbeb', borderRadius: 6, padding: '4px 8px', marginBottom: 8 }}>
                「其他」将以现金方式记录。
              </div>
            )}
            <div style={s.totalRow}>
              <span style={s.totalLbl}>合计</span>
              <span style={s.totalAmt}>${total.toFixed(2)}</span>
            </div>
            {submitError && (
              <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 8, padding: '5px 8px', background: '#fef2f2', borderRadius: 6 }}>
                {submitError}
              </div>
            )}
            <button
              style={{ ...s.submitBtn, ...(cart.length === 0 || submitting ? s.submitDis : {}) }}
              disabled={cart.length === 0 || submitting}
              onClick={handleSubmit}
            >
              {submitting ? '处理中…' : '✓ 完成销售'}
            </button>
            <div style={s.printHint}>🖨️ 打印暂未连接 · 如需打印小票请在 mPOS 手机端操作</div>
          </div>
        </div>
      </div>

      {/* ── Sale success overlay ───────────────────────────────────────────── */}
      {saleResult && (
        <div style={s.overlay} onClick={() => setSaleResult(null)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <div style={s.modalIcon}>✅</div>
            <div style={s.modalTitle}>销售完成</div>
            <div style={s.modalAmt}>${saleResult.totalAmount.toFixed(2)}</div>
            {saleResult.orderNo && <div style={s.modalSub}>单号：{saleResult.orderNo}</div>}
            {saleResult.khqrFallback && (
              <div style={{ margin: '10px 0 4px', padding: '8px 12px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, fontSize: 12, color: '#92400e', lineHeight: 1.5, textAlign: 'left' as const }}>
                ⚠️ 未配置自动 KHQR，本次已记录为 KHQR 收款，请确认顾客已实际付款。
              </div>
            )}
            <div style={{ margin: '6px 0 14px', fontSize: 11, color: '#9ca3af', lineHeight: 1.5 }}>
              🖨️ 未自动打印小票 · 如需收据请在 mPOS 手机端打印
            </div>
            <button style={s.modalBtn} onClick={() => { setSaleResult(null); searchRef.current?.focus() }}>继续收银</button>
          </div>
        </div>
      )}
    </div>
  )
}
