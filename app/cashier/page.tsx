'use client'

import { useState, useEffect, useCallback, useRef, CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import {
  CASHIER_CACHE_VERSION,
  cacheCashierProducts,
  countPendingOfflineOrders,
  getCachedCashierProducts,
  getCashierDeviceId,
  getCashierProductCacheMeta,
  getPendingOfflineOrders,
  markOfflineOrdersSyncFailed,
  markOfflineOrdersSyncing,
  saveOfflineCashierOrder,
  updateOfflineOrderSyncResult,
  type CashierProductCacheMeta,
} from '@/lib/cashier-offline-db'

// ─── Types ────────────────────────────────────────────────────────────────────

type Product = {
  id: string; barcode: string; name: string
  spec: string | null; sellPrice: number
  categoryId: string | null; imageUrl: string | null
  status?: string; updatedAt?: string | null
}

type Category = { id: string; name: string; parentId: string | null }

type CartLine = {
  productId: string | null; barcode: string; name: string; spec: string | null
  price: number; qty: number; imageUrl: string | null
  sugar?: string
}

type SaleResult = { orderNo?: string; totalAmount: number; khqrFallback?: boolean; paymentMethod?: string }
type CashierDisplayStatus = 'DRAFT' | 'AWAITING_PAYMENT' | 'COMPLETED' | 'CANCELLED'
type CashierDisplayPayment = 'CASH' | 'KHQR' | null
type CashierPaymentMethod = 'CASH' | 'KHQR' | 'OTHER' | 'MEMBER_BALANCE'
type DesktopCheckoutStep = 'SELECT_ITEMS' | 'CONFIRM_ORDER' | 'SELECT_PAYMENT'
type DesktopPaymentMethod = 'CASH' | 'KHQR' | null

type CashierMember = {
  id: string
  memberCode: string
  name: string
  phone: string | null
  normalizedPhone: string | null
  balance: string
  status: 'ACTIVE' | 'INACTIVE'
}

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

type BeforeInstallPromptEventLike = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
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
const CASHIER_DISPLAY_SYNC_DEBOUNCE_MS = 300
function cashierDisplayItems(cart: CartLine[]) {
  return cart
    .filter((line) => line.productId)
    .map((line) => ({
      productId: line.productId as string,
      name: line.name,
      spec: [line.spec, line.sugar ? sugarZh(line.sugar) : null].filter(Boolean).join(' / ') || null,
      imageUrl: line.imageUrl,
      price: line.price,
      qty: line.qty,
      lineAmount: +(line.price * line.qty).toFixed(2),
    }))
}
function postCashierDisplaySession(input: {
  storeCode: string
  status: CashierDisplayStatus
  paymentMethod?: CashierDisplayPayment
  paymentStatus?: 'PENDING' | 'PAID' | null
  items?: ReturnType<typeof cashierDisplayItems>
  orderNo?: string | null
  message?: string | null
}) {
  return fetch('/api/cashier/display-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      storeCode: input.storeCode,
      status: input.status,
      paymentMethod: input.paymentMethod ?? null,
      paymentStatus: input.paymentStatus ?? null,
      items: input.items ?? [],
      orderNo: input.orderNo ?? null,
      message: input.message ?? null,
    }),
  }).then((res) => {
    if (!res.ok) {
      console.warn('[cashier:display-session] sync failed', res.status)
    }
  }).catch((e) => {
    console.warn('[cashier:display-session] sync failed', e)
  })
}
function isValidStoreCode(sc: string | null): sc is string {
  return !!sc && /^[A-Za-z0-9_-]{2,80}$/.test(sc)
}
function cashierUrlForStore(sc: string) {
  return `/cashier?storeCode=${encodeURIComponent(sc)}`
}
function desktopRecordsUrlForStore(sc: string) {
  const params = new URLSearchParams()
  params.set('storeCode', sc)
  params.set('from', 'desktop')
  const current = new URLSearchParams(window.location.search)
  const lang = current.get('lang')?.trim()
  if (lang) params.set('lang', lang)
  const returnParams = new URLSearchParams()
  returnParams.set('storeCode', sc)
  if (lang) returnParams.set('lang', lang)
  params.set('returnTo', `/desktop/pos?${returnParams.toString()}`)
  return `/records?${params.toString()}`
}
function rememberCashierStore(sc: string) {
  if (!isValidStoreCode(sc)) return
  try {
    localStorage.setItem('cashier:lastStoreCode', sc)
    localStorage.setItem('cashier:lastUrl', cashierUrlForStore(sc))
  } catch {}
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function fmtCacheTime(iso: string) {
  const t = new Date(iso).getTime()
  const diffMs = Date.now() - t
  if (Number.isFinite(diffMs) && diffMs >= 0) {
    const min = Math.floor(diffMs / 60000)
    if (min < 1) return '刚刚'
    if (min < 60) return `${min}分钟前`
  }
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
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
  kioskActions: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 10 },
  kioskBtn: {
    minHeight: 34,
    borderRadius: 9,
    border: '1px solid rgba(255,255,255,.12)',
    background: 'rgba(255,255,255,.08)',
    color: '#e5e7eb',
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
  },
  kioskHint: { marginTop: 6, fontSize: 10, lineHeight: 1.4, color: '#94a3b8' },
  offlineStatusCard: {
    marginTop: 8,
    borderRadius: 10,
    padding: '8px 9px',
    background: 'rgba(255,255,255,.06)',
    border: '1px solid rgba(255,255,255,.1)',
    color: '#cbd5e1',
    fontSize: 10,
    lineHeight: 1.45,
  },
  offlineStatusLine: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 },
  statusPill: { borderRadius: 999, padding: '2px 7px', fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap' as const },
  offlineWarn: { marginTop: 6, color: '#fde68a', fontSize: 10, lineHeight: 1.45 },
  offlineSyncBtn: {
    width: '100%',
    marginTop: 8,
    minHeight: 30,
    borderRadius: 8,
    border: '1px solid rgba(96,165,250,.28)',
    background: 'rgba(37,99,235,.22)',
    color: '#dbeafe',
    fontSize: 11,
    fontWeight: 800,
    cursor: 'pointer',
  },
  offlineSyncBtnDis: { opacity: 0.45, cursor: 'not-allowed' },
  offlineSyncSummary: { marginTop: 6, color: '#bfdbfe', fontSize: 10, lineHeight: 1.45 },
  sideCats:    { padding: '8px 6px', flex: 1 },
  sideCat:     { display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 8, border: 'none', background: 'transparent', color: '#cbd5e1', fontSize: 13, cursor: 'pointer', marginBottom: 2 },
  sideCatOn:   { background: SIDEBAR_ACT, color: '#fff', fontWeight: 600 },
  sideFooter:  { padding: '10px 12px', borderTop: '1px solid rgba(255,255,255,.08)', display: 'flex', flexDirection: 'column', gap: 6 },
  sideLinkPri: { fontSize: 12, color: '#60a5fa', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', padding: 0, fontWeight: 600 },
  sideLinkSec: { fontSize: 12, color: '#475569', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', padding: 0 },
  sideLinkDesktopPri: {
    minHeight: 44,
    padding: '0 12px',
    borderRadius: 12,
    background: 'rgba(37,99,235,.18)',
    border: '1px solid rgba(96,165,250,.28)',
    color: '#dbeafe',
    fontSize: 15,
    fontWeight: 850,
  },
  sideLinkDesktopSec: {
    minHeight: 42,
    padding: '0 12px',
    borderRadius: 12,
    background: 'rgba(255,255,255,.08)',
    border: '1px solid rgba(255,255,255,.12)',
    color: '#e2e8f0',
    fontSize: 15,
    fontWeight: 780,
  },

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
  confirmPanel:{ display: 'flex', flexDirection: 'column', gap: 10 },
  confirmTitle:{ fontSize: 14, fontWeight: 800, color: '#111827' },
  confirmSub:  { fontSize: 11, color: '#64748b', lineHeight: 1.5 },
  confirmList: { maxHeight: 156, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 10, background: '#f8fafc' },
  confirmLine: { display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, padding: '8px 10px', borderBottom: '1px solid #e5e7eb', fontSize: 12, color: '#374151' },
  confirmLineLast: { borderBottom: 'none' },
  confirmName: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  confirmAmt:  { fontWeight: 800, color: '#111827' },
  confirmActions: { display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 8 },
  secondaryBtn:{ padding: '11px 10px', borderRadius: 10, border: '1px solid #cbd5e1', background: '#fff', color: '#334155', fontSize: 12, fontWeight: 800, cursor: 'pointer' },
  nextStepBox:{ padding: 12, borderRadius: 10, border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1e3a8a', fontSize: 12, lineHeight: 1.55 },
  desktopPayGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  desktopPayOption: { border: '1px solid #cbd5e1', borderRadius: 12, background: '#fff', padding: '13px 12px', textAlign: 'left' as const, cursor: 'pointer', minHeight: 78 },
  desktopPayOptionOn: { borderColor: ACCENT, background: '#eff6ff', boxShadow: '0 0 0 2px rgba(59,130,246,.12)' },
  desktopPayMain: { display: 'block', fontSize: 14, fontWeight: 900, color: '#111827', marginBottom: 5 },
  desktopPaySub: { display: 'block', fontSize: 11, color: '#64748b', lineHeight: 1.45 },

  // Toast + error screen
  toast:       { position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: 'rgba(17,24,39,.9)', color: '#fff', borderRadius: 10, padding: '9px 18px', fontSize: 13, zIndex: 200, whiteSpace: 'nowrap' as const, pointerEvents: 'none' },
  errScreen:   { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#f1f5f9', flexDirection: 'column', gap: 12, padding: 32 },
  errTitle:    { fontSize: 18, fontWeight: 700, color: '#111827' },
  errSub:      { fontSize: 13, color: '#6b7280', textAlign: 'center' as const, maxWidth: 380, lineHeight: 1.6 },
  errCode:     { fontSize: 12, color: '#9ca3af', fontFamily: 'monospace', background: '#fff', padding: '6px 14px', borderRadius: 6, border: '1px solid #e5e7eb' },
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function CashierPage() {
  const router = useRouter()
  const [storeCode,     setStoreCode]     = useState<string | null>(null)
  const [noCodeError,   setNoCodeError]   = useState(false)
  const [products,      setProducts]      = useState<Product[]>([])
  const [categories,    setCategories]    = useState<Category[]>([])
  const [activeCatId,   setActiveCatId]   = useState<string | null>(null)
  const [searchKw,      setSearchKw]      = useState('')
  const [cart,          setCart]          = useState<CartLine[]>([])
  const [payment,       setPayment]       = useState<CashierPaymentMethod>('CASH')
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
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEventLike | null>(null)
  const [isStandalone,  setIsStandalone]  = useState(false)
  const [isFullscreen,  setIsFullscreen]  = useState(false)
  const [isRestoringCashierStore, setIsRestoringCashierStore] = useState(true)
  const [isOnline,      setIsOnline]      = useState(true)
  const [cacheMeta,     setCacheMeta]     = useState<CashierProductCacheMeta | null>(null)
  const [cacheStatus,   setCacheStatus]   = useState<'idle' | 'saving' | 'ready' | 'failed' | 'empty'>('idle')
  const [cacheError,    setCacheError]    = useState('')
  const [productsSource,setProductsSource]= useState<'online' | 'cache' | 'none'>('none')
  const [offlinePendingCount, setOfflinePendingCount] = useState(0)
  const [offlineSyncing, setOfflineSyncing] = useState(false)
  const [offlineSyncSummary, setOfflineSyncSummary] = useState('')
  const [memberPayOpen, setMemberPayOpen] = useState(false)
  const [memberPhone, setMemberPhone] = useState('')
  const [memberLookupLoading, setMemberLookupLoading] = useState(false)
  const [memberPayLoading, setMemberPayLoading] = useState(false)
  const [memberPayError, setMemberPayError] = useState('')
  const [memberPayMember, setMemberPayMember] = useState<CashierMember | null>(null)
  const [isDesktopPos, setIsDesktopPos] = useState(false)
  const [checkoutStep, setCheckoutStep] = useState<DesktopCheckoutStep>('SELECT_ITEMS')
  const [desktopSelectedPaymentMethod, setDesktopSelectedPaymentMethod] = useState<DesktopPaymentMethod>(null)
  const knownOrderIds   = useRef<Set<string>>(new Set())
  const initialPollDone = useRef(false)
  const wasOnlineRef    = useRef(true)
  const searchRef       = useRef<HTMLInputElement>(null)
  const ordersRef       = useRef<HTMLDivElement>(null)
  const cashierDisplayActiveRef = useRef(false)
  const lastCashierDisplaySyncKey = useRef('')
  const previousCashierDisplayCartCountRef = useRef(0)

  useEffect(() => {
    setIsDesktopPos(window.location.pathname === '/desktop/pos')
  }, [])

  useEffect(() => {
    if (cart.length === 0) {
      setCheckoutStep('SELECT_ITEMS')
      setDesktopSelectedPaymentMethod(null)
    }
  }, [cart.length])

  // ── Load store data ────────────────────────────────────────────────────────
  useEffect(() => {
    const sc = new URLSearchParams(window.location.search).get('storeCode')?.trim() || null
    let cachedStoreCode: string | null = null
    try {
      cachedStoreCode = localStorage.getItem('cashier:lastStoreCode')?.trim() || null
    } catch {}

    console.info('[cashier:pwa]', {
      storeCode: sc,
      savedStoreCode: cachedStoreCode,
      restoring: !sc && isValidStoreCode(cachedStoreCode),
    })

    if (!sc) {
      if (isValidStoreCode(cachedStoreCode)) {
        const restoredUrl = cashierUrlForStore(cachedStoreCode)
        router.replace(restoredUrl)
        window.setTimeout(() => {
          const currentStoreCode = new URLSearchParams(window.location.search).get('storeCode')?.trim() || null
          if (!currentStoreCode) window.location.replace(restoredUrl)
        }, 120)
        return
      }

      setIsRestoringCashierStore(false)
      setNoCodeError(true); setLoading(false); return
    }

    rememberCashierStore(sc)

    setStoreCode(sc)
    setIsRestoringCashierStore(false)
    getCashierProductCacheMeta(sc)
      .then((meta) => {
        if (meta) {
          setCacheMeta(meta)
          setCacheStatus(meta.productCount > 0 ? 'ready' : 'empty')
        }
      })
      .catch((e) => console.warn('[cashier:offline-cache] read meta failed', e))
    countPendingOfflineOrders(sc)
      .then(setOfflinePendingCount)
      .catch((e) => console.warn('[cashier:offline-order] count failed', e))

    fetch(`/api/cashier/store?storeCode=${encodeURIComponent(sc)}`)
      .then(r => r.json())
      .then(d => {
        const nextProducts = Array.isArray(d.products) ? d.products : []
        const nextCategories = Array.isArray(d.categories) ? d.categories : []
        setProducts(nextProducts)
        setCategories(nextCategories)
        setProductsSource('online')
        setStoreName(d.storeName ?? '')
        if (d.storeId && d.tenantId) {
          setCacheStatus('saving')
          const catNameById = new Map(nextCategories.map((c: Category) => [c.id, c.name]))
          cacheCashierProducts({
            tenantId: d.tenantId,
            storeId: d.storeId,
            storeCode: sc,
            products: nextProducts.map((p: Product) => ({
              ...p,
              categoryName: p.categoryId ? catNameById.get(p.categoryId) ?? null : null,
            })),
          })
            .then((meta) => {
              setCacheMeta(meta)
              setCacheStatus(meta.productCount > 0 ? 'ready' : 'empty')
              setCacheError('')
            })
            .catch((e) => {
              console.warn('[cashier:offline-cache] product cache failed', e)
              setCacheStatus('failed')
              setCacheError('商品缓存失败，断网模式暂不可用')
            })
        } else {
          setCacheStatus('failed')
          setCacheError('商品缓存失败，缺少门店缓存信息')
        }
      })
      .catch(async (e) => {
        console.warn('[cashier:store] load failed', e)
        try {
          const cached = await getCachedCashierProducts(sc)
          if (cached.length > 0) {
            setProducts(cached.map((p) => ({
              id: p.productId,
              barcode: p.barcode,
              name: p.name,
              spec: p.spec,
              sellPrice: p.price,
              categoryId: p.categoryId,
              imageUrl: p.imageUrl,
              status: p.status,
              updatedAt: p.updatedAt,
            })))
            setCategories([])
            setProductsSource('cache')
          }
        } catch (cacheReadError) {
          console.warn('[cashier:offline-cache] read products failed', cacheReadError)
        }
      })
      .finally(() => setLoading(false))
  }, [router])

  // ── Browser online/offline signal for Offline status only ─────────────────
  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  useEffect(() => {
    if (!storeCode) return
    countPendingOfflineOrders(storeCode)
      .then((count) => {
        setOfflinePendingCount(count)
        if (isOnline && !wasOnlineRef.current && count > 0) {
          showToast(`有 ${count} 笔离线订单待同步，请点击同步离线订单`)
        }
        wasOnlineRef.current = isOnline
      })
      .catch((e) => console.warn('[cashier:offline-order] count failed', e))
  }, [isOnline, storeCode])

  // ── Cashier desktop PWA manifest + install/fullscreen state ───────────────
  useEffect(() => {
    let manifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"][data-cashier-manifest="1"]')
    if (!manifestLink) {
      manifestLink = document.createElement('link')
      manifestLink.rel = 'manifest'
      manifestLink.href = '/manifest.webmanifest'
      manifestLink.setAttribute('data-cashier-manifest', '1')
      document.head.appendChild(manifestLink)
    }

    const standalone = window.matchMedia('(display-mode: standalone)').matches ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Boolean((window.navigator as any).standalone)
    setIsStandalone(standalone)
    setIsFullscreen(Boolean(document.fullscreenElement))

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEventLike)
    }
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement))
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      document.removeEventListener('fullscreenchange', onFullscreenChange)
    }
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

  async function handleInstallClick() {
    if (!storeCode) {
      showToast('请先从门店收银链接进入后再安装')
      return
    }
    rememberCashierStore(storeCode)
    if (isStandalone) {
      showToast('已是桌面应用模式')
      return
    }
    if (!installPrompt) {
      showToast('请使用 Chrome 或 Edge 打开，并在浏览器菜单中选择安装应用')
      return
    }
    try {
      await installPrompt.prompt()
      const choice = await installPrompt.userChoice
      setInstallPrompt(null)
      showToast(choice.outcome === 'accepted' ? '已安装，可从桌面打开' : '已取消安装，收银台仍可继续使用')
    } catch {
      showToast('安装暂不可用，请使用浏览器菜单安装应用')
    }
  }

  async function handleFullscreenClick() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await document.documentElement.requestFullscreen()
      }
    } catch {
      showToast('无法切换全屏，请使用浏览器全屏功能')
    }
  }

  async function refreshOfflinePendingCount(sc = storeCode) {
    if (!sc) return 0
    const count = await countPendingOfflineOrders(sc)
    setOfflinePendingCount(count)
    return count
  }

  async function handleSyncOfflineOrders() {
    if (!storeCode || offlineSyncing) return
    if (!isOnline) {
      showToast('恢复网络后可同步')
      return
    }
    if (offlinePendingCount <= 0) return
    setOfflineSyncing(true)
    setOfflineSyncSummary('')
    let syncingIds: string[] = []
    try {
      const orders = await getPendingOfflineOrders(storeCode, 20)
      if (orders.length === 0) {
        await refreshOfflinePendingCount()
        showToast('无待同步订单')
        return
      }
      const first = orders[0]
      syncingIds = orders.map((order) => order.offlineOrderId)
      await markOfflineOrdersSyncing(syncingIds)
      const res = await fetch('/api/cashier/offline-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: first.storeId,
          storeCode,
          deviceId: first.deviceId,
          orders,
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body || !Array.isArray(body.results)) {
        const msg = body?.message ?? body?.error ?? 'SYNC_REQUEST_FAILED'
        await markOfflineOrdersSyncFailed(syncingIds, msg)
        setOfflineSyncSummary(`同步失败：${msg}`)
        showToast('同步失败，请稍后重试')
        return
      }

      let synced = 0
      let duplicate = 0
      let failed = 0
      for (const result of body.results as Array<{
        offlineOrderId?: string
        status?: 'SYNCED' | 'DUPLICATE' | 'FAILED'
        serverSaleRecordId?: string | null
        errorCode?: string | null
        errorMessage?: string | null
      }>) {
        if (!result.offlineOrderId) continue
        if (result.status === 'SYNCED' || result.status === 'DUPLICATE') {
          await updateOfflineOrderSyncResult({
            offlineOrderId: result.offlineOrderId,
            syncStatus: 'SYNCED',
            serverSaleRecordId: result.serverSaleRecordId ?? null,
            syncedAt: new Date().toISOString(),
          })
          if (result.status === 'DUPLICATE') duplicate += 1
          else synced += 1
        } else {
          failed += 1
          const err = [result.errorCode, result.errorMessage].filter(Boolean).join(': ') || 'SYNC_FAILED'
          await updateOfflineOrderSyncResult({
            offlineOrderId: result.offlineOrderId,
            syncStatus: 'FAILED',
            error: err,
          })
        }
      }
      const missing = syncingIds.filter((id) => !body.results.some((r: { offlineOrderId?: string }) => r.offlineOrderId === id))
      if (missing.length > 0) {
        failed += missing.length
        await markOfflineOrdersSyncFailed(missing, 'SYNC_RESULT_MISSING')
      }
      await refreshOfflinePendingCount()
      const summary = `同步完成：成功 ${synced} 笔，重复 ${duplicate} 笔，失败 ${failed} 笔`
      setOfflineSyncSummary(summary)
      showToast(failed > 0 ? '有订单同步失败，可稍后重试' : summary)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'NETWORK_ERROR'
      if (syncingIds.length > 0) {
        await markOfflineOrdersSyncFailed(syncingIds, msg).catch(() => {})
      }
      await refreshOfflinePendingCount().catch(() => {})
      setOfflineSyncSummary(`同步失败：${msg}`)
      showToast('同步失败，请稍后重试')
    } finally {
      setOfflineSyncing(false)
    }
  }

  async function lookupCashierMember() {
    if (!storeCode || !memberPhone.trim()) return
    setMemberLookupLoading(true)
    setMemberPayError('')
    setMemberPayMember(null)
    try {
      const res = await fetch(`/api/cashier/member-lookup?storeCode=${encodeURIComponent(storeCode)}&phone=${encodeURIComponent(memberPhone.trim())}`)
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.member) {
        throw new Error(body?.message || body?.error || '会员不存在')
      }
      setMemberPayMember(body.member)
    } catch (err) {
      setMemberPayError(err instanceof Error ? err.message : '会员查询失败')
    } finally {
      setMemberLookupLoading(false)
    }
  }

  async function handleMemberBalancePay() {
    if (!storeCode || !memberPayMember || cart.length === 0 || memberPayLoading) return
    if (!isOnline) {
      showToast('离线模式下不支持会员余额支付')
      return
    }
    if (Number(memberPayMember.balance) < total) {
      setMemberPayError('会员余额不足')
      return
    }
    setMemberPayLoading(true)
    setMemberPayError('')
    try {
      const res = await fetch('/api/cashier/member-balance-pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeCode,
          memberId: memberPayMember.id,
          items: cart.map(c => ({ barcode: c.barcode, quantity: c.qty, ...(c.sugar ? { sugar: c.sugar } : {}) })),
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body) {
        const message =
          body?.error === 'INSUFFICIENT_BALANCE' ? '会员余额不足' :
          body?.error === 'MEMBER_NOT_FOUND' ? '会员不存在或已停用' :
          body?.message ?? body?.error ?? '会员余额支付失败'
        throw new Error(message)
      }
      const completedItems = cashierDisplayItems(cart)
      cashierDisplayActiveRef.current = false
      lastCashierDisplaySyncKey.current = ''
      void postCashierDisplaySession({
        storeCode,
        status: 'COMPLETED',
        paymentMethod: null,
        paymentStatus: 'PAID',
        items: completedItems,
        orderNo: body.orderNo ?? null,
      })
      setCart([])
      setPayment('CASH')
      setMemberPayOpen(false)
      setMemberPhone('')
      setMemberPayMember(null)
      setSaleResult({
        orderNo: body.orderNo,
        totalAmount: Number(body.totalAmount ?? total),
        paymentMethod: 'MEMBER_BALANCE',
      })
    } catch (err) {
      setMemberPayError(err instanceof Error ? err.message : '会员余额支付失败')
    } finally {
      setMemberPayLoading(false)
    }
  }

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
    if (!isOnline && productsSource !== 'cache') {
      showToast('当前无商品缓存，无法离线收银')
      return
    }
    if (needsSugar(p)) { setPendingSugar('50'); setSugarModal(p) }
    else addToCart(p)
  }

  // ── Cart ops ───────────────────────────────────────────────────────────────
  const addToCart = useCallback((p: Product, sugar?: string) => {
    setCart(prev => {
      const found = prev.find(c => c.barcode === p.barcode && c.sugar === sugar)
      if (found) return prev.map(c => c.barcode === p.barcode && c.sugar === sugar ? { ...c, qty: c.qty + 1 } : c)
      return [...prev, { productId: p.id, barcode: p.barcode, name: p.name, spec: p.spec, price: p.sellPrice, qty: 1, imageUrl: p.imageUrl, sugar }]
    })
  }, [])

  const updateQty = useCallback((barcode: string, sugar: string | undefined, delta: number) => {
    setCart(prev =>
      prev.map(c => c.barcode === barcode && c.sugar === sugar ? { ...c, qty: c.qty + delta } : c).filter(c => c.qty > 0)
    )
  }, [])

  useEffect(() => {
    if (!storeCode || noCodeError || isRestoringCashierStore) return

    if (cart.length === 0) {
      previousCashierDisplayCartCountRef.current = 0
      if (!cashierDisplayActiveRef.current) return
      cashierDisplayActiveRef.current = false
      lastCashierDisplaySyncKey.current = ''
      lastCashierDisplaySyncKey.current = '__terminal__'
      void postCashierDisplaySession({
        storeCode,
        status: 'CANCELLED',
        paymentMethod: null,
        paymentStatus: null,
        items: [],
      })
      return
    }

    const shouldSyncImmediately = previousCashierDisplayCartCountRef.current === 0
    previousCashierDisplayCartCountRef.current = cart.length
    cashierDisplayActiveRef.current = true
    const displayPayment: CashierDisplayPayment =
      payment === 'KHQR' && isOnline ? 'KHQR' :
      payment === 'CASH' ? 'CASH' :
      null
    const status: CashierDisplayStatus = displayPayment === 'KHQR' ? 'AWAITING_PAYMENT' : 'DRAFT'
    const paymentStatus = displayPayment === 'KHQR' ? 'PENDING' : null
    const items = cashierDisplayItems(cart)
    const syncKey = JSON.stringify({
      storeCode,
      status,
      paymentMethod: displayPayment,
      paymentStatus,
      items,
    })
    if (syncKey === lastCashierDisplaySyncKey.current) return
    if (shouldSyncImmediately) {
      lastCashierDisplaySyncKey.current = syncKey
      void postCashierDisplaySession({
        storeCode,
        status,
        paymentMethod: displayPayment,
        paymentStatus,
        items,
        message: displayPayment === 'KHQR' ? '请扫码支付' : null,
      })
      return
    }
    const timer = setTimeout(() => {
      lastCashierDisplaySyncKey.current = syncKey
      void postCashierDisplaySession({
        storeCode,
        status,
        paymentMethod: displayPayment,
        paymentStatus,
        items,
        message: displayPayment === 'KHQR' ? '请扫码支付' : null,
      })
    }, CASHIER_DISPLAY_SYNC_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [cart, payment, storeCode, isOnline, noCodeError, isRestoringCashierStore])

  // ── Submit sale ────────────────────────────────────────────────────────────
  async function handleSubmit(paymentOverride?: CashierPaymentMethod) {
    if (cart.length === 0 || submitting || !storeCode) return
    const submitPayment = paymentOverride ?? payment
    if (submitPayment === 'MEMBER_BALANCE') {
      if (!isOnline) {
        showToast('离线模式下不支持会员余额支付')
        return
      }
      setMemberPayOpen(true)
      return
    }
    if (!isOnline) {
      if (submitPayment !== 'CASH') {
        showToast('离线模式暂不支持 KHQR，请使用 CASH 收款')
        return
      }
      if (!cacheMeta || productsSource !== 'cache') {
        showToast('当前无商品缓存，无法离线收银')
        return
      }
      setSubmitting(true); setSubmitError('')
      try {
        const deviceId = getCashierDeviceId()
        const now = new Date()
        await saveOfflineCashierOrder({
          tenantId: cacheMeta.tenantId,
          storeId: cacheMeta.storeId,
          storeCode,
          operatorUserId: null,
          operatorName: 'Cashier PWA',
          deviceId,
          createdAtLocal: now.toISOString(),
          createdAtClientTimestamp: now.getTime(),
          items: cart.map((c) => ({
            productId: c.productId,
            productName: c.name,
            barcode: c.barcode,
            unitPrice: c.price,
            quantity: c.qty,
            lineTotal: c.price * c.qty,
            snapshotPrice: c.price,
            snapshotName: c.name,
            spec: c.spec,
            sugar: c.sugar ?? null,
          })),
          subtotal: cartTotal(cart),
          discountAmount: 0,
          totalAmount: cartTotal(cart),
          paymentMethod: 'CASH',
          paymentStatus: 'PAID_OFFLINE',
          syncStatus: 'PENDING',
          syncAttemptCount: 0,
          lastSyncError: null,
          serverSaleRecordId: null,
          syncedAt: null,
          appVersion: 'web',
          cacheVersion: CASHIER_CACHE_VERSION,
        })
        const nextCount = await countPendingOfflineOrders(storeCode)
        setOfflinePendingCount(nextCount)
        cashierDisplayActiveRef.current = false
        lastCashierDisplaySyncKey.current = ''
        setCart([])
        setPayment('CASH')
        showToast('离线订单已保存，网络恢复后请同步')
      } catch (e) {
        console.warn('[cashier:offline-order] save failed', e)
        setSubmitError('离线订单保存失败，请保留购物车并稍后重试')
      } finally {
        setSubmitting(false)
      }
      return
    }
    setSubmitting(true); setSubmitError('')
    const apiPayment = submitPayment === 'OTHER' ? 'CASH' : submitPayment
    const submittedItems = cashierDisplayItems(cart)
    const submittedTotal = cartTotal(cart)
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
      cashierDisplayActiveRef.current = false
      lastCashierDisplaySyncKey.current = ''
      void postCashierDisplaySession({
        storeCode,
        status: 'COMPLETED',
        paymentMethod: apiPayment === 'KHQR' ? 'KHQR' : 'CASH',
        paymentStatus: 'PAID',
        items: submittedItems,
        orderNo: body.orderNo ?? null,
      })
      setCart([])
      setPayment('CASH')
      setSaleResult({ orderNo: body.orderNo, totalAmount: submittedTotal, khqrFallback: body.khqrFallback ?? false })
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
  const cacheText =
    cacheStatus === 'saving' ? '商品缓存：正在更新...' :
    cacheStatus === 'ready' && cacheMeta ? `商品缓存：已缓存 ${cacheMeta.productCount} 个 · ${fmtCacheTime(cacheMeta.lastProductCacheAt)}` :
    cacheStatus === 'empty' ? '商品缓存：暂无商品缓存' :
    cacheStatus === 'failed' ? (cacheError || '商品缓存失败，断网模式暂不可用') :
    '商品缓存：未缓存'
  const canOfflineCashier = !isOnline && productsSource === 'cache' && products.length > 0 && !!cacheMeta
  const offlineHint = !isOnline
    ? canOfflineCashier
      ? '离线收银模式：仅支持 CASH，本地保存，恢复网络后再同步。'
      : '当前无商品缓存，无法离线收银。'
    : ''

  // ── Restore PWA storeCode before rendering no-code branches ───────────────
  if (isRestoringCashierStore) {
    return (
      <div style={s.errScreen}>
        <div style={{ fontSize: 36 }}>🖥️</div>
        <div style={s.errTitle}>正在恢复门店收银台...</div>
        <div style={s.errSub}>正在读取本机已记住的门店编号，请稍候。</div>
      </div>
    )
  }

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
            <div style={s.kioskActions}>
              <button type="button" style={s.kioskBtn} onClick={handleInstallClick}>
                {isStandalone ? '桌面模式' : '安装到电脑'}
              </button>
              <button type="button" style={s.kioskBtn} onClick={handleFullscreenClick}>
                {isFullscreen ? '退出全屏' : '进入全屏'}
              </button>
            </div>
            <div style={s.kioskHint}>
              {storeCode ? '已记住当前门店，桌面打开会进入本店收银台' : '请先从门店收银链接进入后再安装'}
            </div>
            <div style={s.offlineStatusCard}>
              <div style={s.offlineStatusLine}>
                <span>网络状态</span>
                <span
                  style={{
                    ...s.statusPill,
                    background: isOnline ? 'rgba(22,163,74,.18)' : 'rgba(245,158,11,.2)',
                    color: isOnline ? '#86efac' : '#fde68a',
                  }}
                >
                  {isOnline ? '在线' : '离线'}
                </span>
              </div>
              <div>{cacheText}</div>
              <div>待同步离线订单：{offlinePendingCount} 笔</div>
              {offlinePendingCount > 0 && (
                <button
                  type="button"
                  style={{
                    ...s.offlineSyncBtn,
                    ...((!isOnline || offlineSyncing) ? s.offlineSyncBtnDis : {}),
                  }}
                  disabled={!isOnline || offlineSyncing}
                  onClick={handleSyncOfflineOrders}
                >
                  {offlineSyncing ? '同步中…' : isOnline ? '同步离线订单' : '恢复网络后可同步'}
                </button>
              )}
              {offlineSyncSummary && (
                <div style={s.offlineSyncSummary}>{offlineSyncSummary}</div>
              )}
              {!isOnline && (
                <div style={s.offlineWarn}>
                  {offlineHint}
                </div>
              )}
            </div>
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
            <button
              style={{ ...s.sideLinkPri, ...(isDesktopPos ? s.sideLinkDesktopPri : {}) }}
              onClick={() => ordersRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              📋 接单看板
              {pendingOrders.length > 0 && (
                <span style={{ marginLeft: 6, background: '#fcd34d', color: '#92400e', borderRadius: 8, padding: '0 5px', fontSize: 11 }}>
                  {pendingOrders.length}
                </span>
              )}
            </button>
            <button
              style={{ ...s.sideLinkSec, ...(isDesktopPos ? s.sideLinkDesktopSec : {}) }}
              onClick={() => showToast('请在手机商户端管理商品')}
            >
              商品管理
            </button>
            <button
              style={{ ...s.sideLinkSec, ...(isDesktopPos ? s.sideLinkDesktopSec : {}) }}
              onClick={() => {
                if (!storeCode) {
                  showToast('请先使用带门店编号的收银链接打开')
                  return
                }
                window.location.href = desktopRecordsUrlForStore(storeCode)
              }}
            >
              销售记录
            </button>
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
            {isDesktopPos ? (
              checkoutStep === 'CONFIRM_ORDER' ? (
                <div style={s.confirmPanel}>
                  <div>
                    <div style={s.confirmTitle}>确认本单</div>
                    <div style={s.confirmSub}>请核对商品、数量和应付金额。本步骤不会创建销售记录。</div>
                  </div>
                  <div style={s.confirmList}>
                    {cart.map((line, index) => {
                      const specDisplay = [line.spec, line.sugar ? sugarZh(line.sugar) : null].filter(Boolean).join(' / ')
                      return (
                        <div key={cartLineKey(line)} style={{ ...s.confirmLine, ...(index === cart.length - 1 ? s.confirmLineLast : {}) }}>
                          <span style={s.confirmName}>{line.name}{specDisplay ? ` · ${specDisplay}` : ''} × {line.qty}</span>
                          <span style={s.confirmAmt}>${(line.price * line.qty).toFixed(2)}</span>
                        </div>
                      )
                    })}
                  </div>
                  <div style={s.totalRow}>
                    <span style={s.totalLbl}>共 {count} 件 · 应付</span>
                    <span style={s.totalAmt}>${total.toFixed(2)}</span>
                  </div>
                  <div style={s.confirmActions}>
                    <button type="button" style={s.secondaryBtn} onClick={() => setCheckoutStep('SELECT_ITEMS')}>
                      返回修改商品
                    </button>
                    <button type="button" style={s.submitBtn} onClick={() => setCheckoutStep('SELECT_PAYMENT')}>
                      确认本单，选择收款方式
                    </button>
                  </div>
                  <div style={s.printHint}>本轮仅进入结账占位，不创建 SaleRecord。</div>
                </div>
              ) : checkoutStep === 'SELECT_PAYMENT' ? (
                <div style={s.confirmPanel}>
                  <div>
                    <div style={s.confirmTitle}>选择收款方式</div>
                    <div style={s.confirmSub}>请选择本单收款方式。本轮只记录界面选中状态，不完成销售。</div>
                  </div>
                  <div style={s.totalRow}>
                    <span style={s.totalLbl}>共 {count} 件 · 应付</span>
                    <span style={s.totalAmt}>${total.toFixed(2)}</span>
                  </div>
                  <div style={s.desktopPayGrid}>
                    <button
                      type="button"
                      style={{ ...s.desktopPayOption, ...(desktopSelectedPaymentMethod === 'CASH' ? s.desktopPayOptionOn : {}) }}
                      onClick={() => setDesktopSelectedPaymentMethod('CASH')}
                    >
                      <span style={s.desktopPayMain}>💵 现金收款 CASH</span>
                      <span style={s.desktopPaySub}>仅选择现金收款方式，不创建销售记录。</span>
                    </button>
                    <button
                      type="button"
                      style={{ ...s.desktopPayOption, ...(desktopSelectedPaymentMethod === 'KHQR' ? s.desktopPayOptionOn : {}) }}
                      onClick={() => setDesktopSelectedPaymentMethod('KHQR')}
                    >
                      <span style={s.desktopPayMain}>📱 扫码收款 KHQR</span>
                      <span style={s.desktopPaySub}>仅选择 KHQR，不生成新支付单。</span>
                    </button>
                  </div>
                  {desktopSelectedPaymentMethod && (
                    <div style={s.nextStepBox}>
                      当前已选择：{desktopSelectedPaymentMethod === 'CASH' ? '现金收款 CASH' : '扫码收款 KHQR'}。请确认已收款后完成销售。
                    </div>
                  )}
                  {submitError && (
                    <div style={{ fontSize: 12, color: '#ef4444', padding: '5px 8px', background: '#fef2f2', borderRadius: 6 }}>
                      {submitError}
                    </div>
                  )}
                  <button
                    type="button"
                    style={{ ...s.submitBtn, ...(!desktopSelectedPaymentMethod || submitting ? s.submitDis : {}) }}
                    disabled={!desktopSelectedPaymentMethod || submitting}
                    onClick={() => {
                      if (!desktopSelectedPaymentMethod) return
                      setPayment(desktopSelectedPaymentMethod)
                      void handleSubmit(desktopSelectedPaymentMethod)
                    }}
                  >
                    {submitting
                      ? '处理中…'
                      : desktopSelectedPaymentMethod === 'KHQR'
                        ? '确认 KHQR 已收款，完成销售'
                        : desktopSelectedPaymentMethod === 'CASH'
                          ? '确认现金已收款，完成销售'
                          : '确认收款，完成销售'}
                  </button>
                  <div style={s.totalRow}>
                    <span style={s.totalLbl}>商品种类</span>
                    <span style={s.confirmAmt}>{cart.length} 类</span>
                  </div>
                  <div style={s.confirmActions}>
                    <button type="button" style={s.secondaryBtn} onClick={() => setCheckoutStep('CONFIRM_ORDER')}>
                      返回本单确认
                    </button>
                    <button type="button" style={s.secondaryBtn} onClick={() => setCheckoutStep('SELECT_ITEMS')}>
                      返回修改商品
                    </button>
                  </div>
                  <div style={s.printHint}>复用原 /cashier 完成销售逻辑 · 不新增提交接口</div>
                </div>
              ) : (
                <>
                  <div style={s.payLabel}>本单</div>
                  <div style={s.totalRow}>
                    <span style={s.totalLbl}>合计 {count} 件</span>
                    <span style={s.totalAmt}>${total.toFixed(2)}</span>
                  </div>
                  <button
                    style={{ ...s.submitBtn, ...(cart.length === 0 ? s.submitDis : {}) }}
                    disabled={cart.length === 0}
                    onClick={() => {
                      if (cart.length === 0) return
                      setCheckoutStep('CONFIRM_ORDER')
                    }}
                  >
                    ✓ 确认本单
                  </button>
                  <div style={s.printHint}>确认后再选择收款方式 · 当前不会直接完成销售</div>
                </>
              )
            ) : (
              <>
                <div style={s.payLabel}>收款方式</div>
                <div style={s.payRow}>
                  {(['CASH','KHQR','MEMBER_BALANCE','OTHER'] as const).map(m => {
                    const disabledOfflinePayment = !isOnline && m !== 'CASH'
                    return (
                    <button
                      key={m}
                      style={{
                        ...s.payBtn,
                        ...(payment === m ? s.payBtnOn : {}),
                        ...(disabledOfflinePayment ? { opacity: 0.45, cursor: 'not-allowed' } : {}),
                      }}
                      onClick={() => {
                        if (disabledOfflinePayment) {
                          showToast(m === 'MEMBER_BALANCE' ? '离线模式下不支持会员余额支付' : '离线模式暂不支持 KHQR，请使用 CASH 收款')
                          return
                        }
                        setPayment(m)
                        if (m === 'MEMBER_BALANCE') setMemberPayOpen(true)
                      }}
                    >
                      {m === 'CASH' ? '💵 现金' : m === 'KHQR' ? '📱 KHQR' : m === 'MEMBER_BALANCE' ? '👤 会员余额' : '🔧 其他'}
                    </button>
                  )})}
                </div>
                {!isOnline && (
                  <div style={{ fontSize: 11, color: '#92400e', background: '#fffbeb', borderRadius: 6, padding: '5px 8px', marginBottom: 8, lineHeight: 1.45 }}>
                    离线模式仅支持 CASH，本单会保存到本机，暂不会出现在 /records。
                  </div>
                )}
                {payment === 'OTHER' && (
                  <div style={{ fontSize: 11, color: '#f59e0b', background: '#fffbeb', borderRadius: 6, padding: '4px 8px', marginBottom: 8 }}>
                    「其他」将以现金方式记录。
                  </div>
                )}
                {payment === 'MEMBER_BALANCE' && (
                  <div style={{ fontSize: 11, color: '#1d4ed8', background: '#eff6ff', borderRadius: 6, padding: '4px 8px', marginBottom: 8 }}>
                    会员余额支付需联网查询会员，并实时扣减余额。
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
                  onClick={() => { void handleSubmit() }}
                >
                  {submitting ? '处理中…' : payment === 'MEMBER_BALANCE' ? '👤 会员余额支付' : '✓ 完成销售'}
                </button>
                <div style={s.printHint}>🖨️ 打印暂未连接 · 如需打印小票请在 mPOS 手机端操作</div>
              </>
            )}
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

      {memberPayOpen && (
        <div style={s.overlay} onClick={() => setMemberPayOpen(false)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <div style={s.modalTitle}>会员余额支付</div>
            <div style={{ marginBottom: 12, fontSize: 13, color: '#6b7280', lineHeight: 1.5 }}>
              输入会员手机号，确认余额足够后完成本单。
            </div>
            {!isOnline && (
              <div style={{ marginBottom: 10, padding: '8px 10px', background: '#fffbeb', color: '#92400e', borderRadius: 8, fontSize: 12 }}>
                离线模式下不支持会员余额支付
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <input
                value={memberPhone}
                onChange={e => {
                  setMemberPhone(e.target.value)
                  setMemberPayMember(null)
                  setMemberPayError('')
                }}
                placeholder="输入会员手机号"
                style={{ flex: 1, height: 40, border: '1px solid #e5e7eb', borderRadius: 9, padding: '0 10px', outline: 'none' }}
                disabled={!isOnline || memberLookupLoading || memberPayLoading}
              />
              <button
                type="button"
                style={{ ...s.modalBtn, padding: '0 14px', fontSize: 13, minWidth: 84 }}
                onClick={lookupCashierMember}
                disabled={!isOnline || !memberPhone.trim() || memberLookupLoading || memberPayLoading}
              >
                {memberLookupLoading ? '查询中…' : '查询'}
              </button>
            </div>

            {memberPayMember && (
              <div style={{ textAlign: 'left', background: '#f8fafc', borderRadius: 12, padding: 12, marginBottom: 10 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#111827' }}>{memberPayMember.name}</div>
                <div style={{ marginTop: 4, fontSize: 12, color: '#64748b' }}>
                  {memberPayMember.phone || '-'} · {memberPayMember.memberCode}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginTop: 12 }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>当前余额</div>
                    <div style={{ fontSize: 15, fontWeight: 900 }}>${Number(memberPayMember.balance).toFixed(2)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>本单金额</div>
                    <div style={{ fontSize: 15, fontWeight: 900 }}>${total.toFixed(2)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>支付后</div>
                    <div style={{ fontSize: 15, fontWeight: 900, color: Number(memberPayMember.balance) >= total ? '#047857' : '#dc2626' }}>
                      ${(Number(memberPayMember.balance) - total).toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {memberPayError && (
              <div style={{ marginBottom: 10, padding: '8px 10px', background: '#fef2f2', color: '#b91c1c', borderRadius: 8, fontSize: 12 }}>
                {memberPayError}
              </div>
            )}

            <button
              style={{
                ...s.submitBtn,
                ...(!isOnline || !memberPayMember || Number(memberPayMember.balance) < total || memberPayLoading ? s.submitDis : {}),
              }}
              disabled={!isOnline || !memberPayMember || Number(memberPayMember.balance) < total || memberPayLoading}
              onClick={handleMemberBalancePay}
            >
              {memberPayLoading ? '支付中…' : Number(memberPayMember?.balance ?? 0) < total ? '余额不足' : '确认余额支付'}
            </button>
            <button
              style={{ ...s.sugarCancel, marginTop: 8 }}
              onClick={() => setMemberPayOpen(false)}
              disabled={memberPayLoading}
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
