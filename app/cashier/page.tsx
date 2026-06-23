'use client'

import { Fragment, useState, useEffect, useCallback, useRef, CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/app/components/LangProvider'
import {
  DesktopReceiptPreview,
  printDesktopReceipt,
  type DesktopReceiptData,
} from '@/app/components/DesktopReceipt'
import {
  ShiftReportPrint,
  printShiftReport,
  type ShiftReportData,
} from '@/app/components/ShiftReportPrint'
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
import {
  listHoldOrders,
  removeHoldOrder,
  saveHoldOrder,
  type HoldOrder,
} from '@/lib/cashier-hold-orders'
import { clearShiftStart, getOrCreateShiftStart } from '@/lib/cashier-shift'

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

type SaleResult = {
  orderNo?: string
  totalAmount: number
  khqrFallback?: boolean
  paymentMethod?: string
  receipt?: DesktopReceiptData
}
type CashierDisplayStatus = 'DRAFT' | 'AWAITING_PAYMENT' | 'COMPLETED' | 'CANCELLED'
type CashierDisplayPayment = 'CASH' | 'KHQR' | null
type CashierPaymentMethod = 'CASH' | 'KHQR' | 'OTHER' | 'MEMBER_BALANCE'
type DesktopCheckoutStep = 'SELECT_ITEMS' | 'CONFIRM_ORDER' | 'SELECT_PAYMENT'
type DesktopPaymentMethod = 'CASH' | 'KHQR' | null
type CustomerDisplaySyncOptions = { focusKhqr?: boolean }
type ShiftRecordItem = {
  recordNo: string
  orderNo: string | null
  createdAt: string
  lineAmount: number
  saleType: 'SALE' | 'REFUND'
  paymentMethod: string | null
  source?: string
}
type ShiftRecordsResponse = {
  total: number
  page: number
  pageSize: number
  items: ShiftRecordItem[]
}

const CUSTOMER_DISPLAY_KHQR_FOCUS_MESSAGE = 'KHQR_FOCUS'

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
const DEFAULT_KHR_RATE = 4100
const KHR_SYMBOL = '៛'

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
function toKhr(usd: number, rate: number) {
  const amount = Math.round(usd * rate)
  return `${amount.toLocaleString('en-US')}${KHR_SYMBOL}`
}
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

function fmtDateTimeShort(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function dateParamFromIso(iso: string) {
  return iso.slice(0, 10)
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
  desktopRoot: { height: '100dvh', maxHeight: '100dvh' },

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
  holdCard: { padding: 10, borderRadius: 12, background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.12)', color: '#e2e8f0' },
  holdHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 },
  holdTitle: { fontSize: 12, fontWeight: 900, color: '#f8fafc' },
  holdCount: { fontSize: 10, color: '#93c5fd', fontWeight: 800 },
  holdBtn: { width: '100%', minHeight: 34, borderRadius: 9, border: 'none', background: '#2563eb', color: '#fff', fontSize: 12, fontWeight: 900, cursor: 'pointer', marginBottom: 8 },
  holdEmpty: { fontSize: 10, color: '#94a3b8', lineHeight: 1.45 },
  holdList: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 154, overflowY: 'auto' },
  holdItem: { padding: 8, borderRadius: 9, background: 'rgba(15,23,42,.38)', border: '1px solid rgba(255,255,255,.08)' },
  holdMeta: { display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11, fontWeight: 800, color: '#f8fafc', marginBottom: 6 },
  holdSub: { fontSize: 10, color: '#94a3b8', marginBottom: 7 },
  holdActions: { display: 'grid', gridTemplateColumns: '1fr auto', gap: 6 },
  holdRestoreBtn: { minHeight: 28, borderRadius: 8, border: 'none', background: '#dbeafe', color: '#1d4ed8', fontSize: 11, fontWeight: 900, cursor: 'pointer' },
  holdDeleteBtn: { minHeight: 28, borderRadius: 8, border: '1px solid rgba(248,113,113,.32)', background: 'rgba(127,29,29,.32)', color: '#fecaca', fontSize: 11, fontWeight: 900, cursor: 'pointer', padding: '0 9px' },
  shiftCard: { padding: 10, borderRadius: 12, background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.12)', color: '#e2e8f0' },
  shiftStart: { marginBottom: 8, fontSize: 12, fontWeight: 900, color: '#f8fafc' },
  shiftBtn: { width: '100%', minHeight: 32, borderRadius: 9, border: '1px solid rgba(96,165,250,.28)', background: 'rgba(37,99,235,.22)', color: '#dbeafe', fontSize: 12, fontWeight: 900, cursor: 'pointer' },
  shiftModal: { background: '#fff', borderRadius: 16, padding: 22, width: 'min(420px,92vw)', maxHeight: '86vh', overflowY: 'auto', boxShadow: '0 12px 42px rgba(15,23,42,.22)' },
  shiftActions: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 14 },

  // ── Middle: product grid ──────────────────────────────────────────────────
  mid:         { flex: 1, display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', minWidth: 0 },
  topbar:      { padding: '10px 14px', background: '#fff', borderBottom: '1px solid #e5e7eb', display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 },
  search:      { flex: 1, height: 36, border: '1.5px solid #e5e7eb', borderRadius: 8, padding: '0 12px', fontSize: 14, outline: 'none', background: '#f9fafb' },
  grid:        { flex: 1, overflowY: 'auto', padding: '12px 10px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(148px,1fr))', gap: 10, alignContent: 'start' },
  desktopGrid: { gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 12, padding: 14 },
  productGroupTitle: { gridColumn: '1/-1', padding: '12px 2px 2px', fontSize: 14, fontWeight: 900, color: '#334155', borderBottom: '1px solid #e2e8f0' },
  pcard:       { background: '#fff', borderRadius: 10, overflow: 'hidden', cursor: 'pointer', border: '1.5px solid transparent', transition: 'all .12s', userSelect: 'none' as const },
  pcardDesktop:{ minHeight: 184, display: 'flex', flexDirection: 'column' },
  pcardImg:    { height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, overflow: 'hidden' },
  pcardImgDesktop: { height: 122, flexShrink: 0 },
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
  desktopPaySec: { maxHeight: '54vh', overflowY: 'auto' },
  desktopSelectPaySec: { height: 'min(68vh,620px)', maxHeight: 'calc(100dvh - 120px)', overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  payLabel:    { fontSize: 11, color: '#9ca3af', fontWeight: 600, marginBottom: 7 },
  payRow:      { display: 'flex', gap: 6, marginBottom: 10 },
  payBtn:      { flex: 1, padding: '7px 0', borderRadius: 8, border: '1.5px solid #e5e7eb', background: '#f9fafb', color: '#374151', fontSize: 12, fontWeight: 500, cursor: 'pointer' },
  payBtnOn:    { border: `1.5px solid ${ACCENT}`, background: '#eff6ff', color: ACCENT, fontWeight: 700 },
  totalRow:    { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 },
  totalLbl:    { fontSize: 14, color: '#6b7280' },
  totalAmt:    { fontSize: 26, fontWeight: 800, color: '#111827' },
  khrAssist:   { marginTop: -7, marginBottom: 9, textAlign: 'right' as const, fontSize: 13, fontWeight: 800, color: '#64748b' },
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
  desktopSelectPanel: { flex: 1, minHeight: 0 },
  desktopSelectScroll: { flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 10 },
  confirmTitle:{ fontSize: 14, fontWeight: 800, color: '#111827' },
  confirmSub:  { fontSize: 11, color: '#64748b', lineHeight: 1.5 },
  confirmList: { maxHeight: 156, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 10, background: '#f8fafc' },
  confirmLine: { display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, padding: '8px 10px', borderBottom: '1px solid #e5e7eb', fontSize: 12, color: '#374151' },
  confirmLineLast: { borderBottom: 'none' },
  confirmName: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  confirmAmt:  { fontWeight: 800, color: '#111827' },
  confirmActions: { display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 8 },
  desktopPayStickyActions: { flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8, margin: '0 -14px -14px', padding: '9px 14px 12px', background: '#fff', borderTop: '1px solid #e5e7eb', boxShadow: '0 -8px 18px rgba(15,23,42,.06)' },
  secondaryBtn:{ padding: '11px 10px', borderRadius: 10, border: '1px solid #cbd5e1', background: '#fff', color: '#334155', fontSize: 12, fontWeight: 800, cursor: 'pointer' },
  nextStepBox:{ padding: 12, borderRadius: 10, border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1e3a8a', fontSize: 12, lineHeight: 1.55 },
  desktopPayGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  desktopPayOption: { border: '1px solid #cbd5e1', borderRadius: 12, background: '#fff', padding: '13px 12px', textAlign: 'left' as const, cursor: 'pointer', minHeight: 78 },
  desktopPayOptionOn: { borderColor: ACCENT, background: '#eff6ff', boxShadow: '0 0 0 2px rgba(59,130,246,.12)' },
  desktopPayMain: { display: 'block', fontSize: 14, fontWeight: 900, color: '#111827', marginBottom: 5 },
  desktopPaySub: { display: 'block', fontSize: 11, color: '#64748b', lineHeight: 1.45 },
  cashReceivedBox: { display: 'grid', gap: 7, padding: 10, borderRadius: 10, border: '1px solid #e5e7eb', background: '#f8fafc' },
  cashReceivedLabel: { fontSize: 12, fontWeight: 800, color: '#334155' },
  cashReceivedInput: { width: '100%', height: 40, borderRadius: 9, border: '1.5px solid #cbd5e1', padding: '0 11px', fontSize: 18, fontWeight: 800, outline: 'none', color: '#111827', background: '#fff' },
  cashChangeRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, fontSize: 12, color: '#64748b' },
  cashChangeAmt: { fontSize: 20, fontWeight: 900, color: '#047857' },
  cashChangeAmtBox: { textAlign: 'right' as const },
  cashChangeKhr: { marginTop: 2, fontSize: 12, fontWeight: 800, color: '#64748b' },
  cashWarn: { fontSize: 12, color: '#b91c1c', background: '#fef2f2', borderRadius: 8, padding: '7px 9px', lineHeight: 1.45 },
  fxCard: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '9px 10px', borderRadius: 12, background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.12)', color: '#e2e8f0', minWidth: 0 },
  fxLabel: { fontSize: 12, fontWeight: 800, color: '#f8fafc', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' },
  fxBtn: { border: 'none', background: 'transparent', color: '#60a5fa', fontSize: 12, fontWeight: 900, cursor: 'pointer', padding: 0, whiteSpace: 'nowrap' as const },
  autoPrintToggle: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 10px', borderRadius: 12, background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.12)', color: '#e2e8f0' },
  autoPrintText: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
  autoPrintTitle: { fontSize: 12, fontWeight: 800, color: '#f8fafc' },
  autoPrintSub: { fontSize: 10, color: '#94a3b8', lineHeight: 1.35 },
  autoPrintSwitch: { position: 'relative', width: 42, height: 24, borderRadius: 999, border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0, transition: 'background .12s' },
  autoPrintKnob: { position: 'absolute', top: 3, width: 18, height: 18, borderRadius: 999, background: '#fff', transition: 'left .12s' },

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
  const { lang } = useLocale()
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
  const [receiptPreviewOpen, setReceiptPreviewOpen] = useState(false)
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
  const [cashTendered, setCashTendered] = useState('')
  const [autoPrint, setAutoPrint] = useState(false)
  const [usdKhrRate, setUsdKhrRate] = useState(DEFAULT_KHR_RATE)
  const [holdOrders, setHoldOrders] = useState<HoldOrder<CartLine, DesktopCheckoutStep>[]>([])
  const [shiftStartIso, setShiftStartIso] = useState<string | null>(null)
  const [shiftReportOpen, setShiftReportOpen] = useState(false)
  const [shiftReport, setShiftReport] = useState<ShiftReportData | null>(null)
  const [shiftReportLoading, setShiftReportLoading] = useState(false)
  const [shiftReportError, setShiftReportError] = useState('')
  const knownOrderIds   = useRef<Set<string>>(new Set())
  const initialPollDone = useRef(false)
  const wasOnlineRef    = useRef(true)
  const searchRef       = useRef<HTMLInputElement>(null)
  const ordersRef       = useRef<HTMLDivElement>(null)
  const cashierDisplayActiveRef = useRef(false)
  const lastCashierDisplaySyncKey = useRef('')
  const previousCashierDisplayCartCountRef = useRef(0)
  const autoPrintedReceiptKeyRef = useRef('')

  useEffect(() => {
    setIsDesktopPos(window.location.pathname === '/desktop/pos')
  }, [])

  useEffect(() => {
    if (!isDesktopPos) return
    const previousHtmlOverflow = document.documentElement.style.overflow
    const previousHtmlHeight = document.documentElement.style.height
    const previousBodyOverflow = document.body.style.overflow
    const previousBodyHeight = document.body.style.height
    document.documentElement.style.overflow = 'hidden'
    document.documentElement.style.height = '100%'
    document.body.style.overflow = 'hidden'
    document.body.style.height = '100%'
    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow
      document.documentElement.style.height = previousHtmlHeight
      document.body.style.overflow = previousBodyOverflow
      document.body.style.height = previousBodyHeight
    }
  }, [isDesktopPos])

  useEffect(() => {
    try {
      setAutoPrint(localStorage.getItem('cashier:autoPrint') === '1')
      const savedRate = Number(localStorage.getItem('cashier:usdKhrRate'))
      if (Number.isFinite(savedRate) && savedRate >= 1000 && savedRate <= 10000) {
        const nextRate = Math.round(savedRate)
        setUsdKhrRate(nextRate)
      }
    } catch {}
  }, [])

  useEffect(() => {
    if (!isDesktopPos || !storeCode) {
      setHoldOrders([])
      return
    }
    setHoldOrders(listHoldOrders<CartLine, DesktopCheckoutStep>(storeCode))
  }, [isDesktopPos, storeCode])

  useEffect(() => {
    if (!isDesktopPos || !storeCode) {
      setShiftStartIso(null)
      return
    }
    try {
      setShiftStartIso(getOrCreateShiftStart(storeCode))
    } catch (err) {
      console.warn('[cashier:shift] init failed', err)
      setShiftStartIso(null)
    }
  }, [isDesktopPos, storeCode])

  useEffect(() => {
    if (cart.length === 0) {
      setCheckoutStep('SELECT_ITEMS')
      setDesktopSelectedPaymentMethod(null)
      setCashTendered('')
    }
  }, [cart.length])

  useEffect(() => {
    if (desktopSelectedPaymentMethod !== 'CASH') setCashTendered('')
  }, [desktopSelectedPaymentMethod])

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

  function buildReceiptSnapshot(input: {
    items: ReturnType<typeof cashierDisplayItems>
    totalAmount: number
    paymentMethod: string
    orderNo?: string | null
    createdAt?: string | null
  }): DesktopReceiptData {
    return {
      storeName: storeName || 'Store',
      orderNo: input.orderNo ?? null,
      createdAt: input.createdAt ?? new Date().toISOString(),
      cashierName: 'Desktop POS',
      paymentMethod: input.paymentMethod,
      totalAmount: input.totalAmount,
      items: input.items.map((item) => ({
        name: item.name,
        spec: item.spec,
        qty: item.qty,
        price: item.price,
        lineAmount: item.lineAmount,
      })),
    }
  }

  function handlePrintReceipt(receipt: DesktopReceiptData) {
    try {
      printDesktopReceipt(receipt, lang)
    } catch (err) {
      console.warn('[desktop-receipt] print window failed', err)
      showToast('无法打开打印预览，请检查浏览器弹窗权限')
    }
  }

  function handleAutoPrintToggle() {
    const next = !autoPrint
    setAutoPrint(next)
    try {
      localStorage.setItem('cashier:autoPrint', next ? '1' : '0')
    } catch {}
    showToast(next ? '已开启自动打印小票' : '已关闭自动打印小票')
  }

  function handleUsdKhrRateApply() {
    const input = window.prompt('输入 USD/KHR 汇率（1000 - 10000）', String(usdKhrRate))
    if (input === null) return
    const nextRate = Number(input.trim())
    if (!Number.isFinite(nextRate) || nextRate < 1000 || nextRate > 10000) {
      showToast('汇率范围需在 1000 到 10000 之间')
      return
    }
    const roundedRate = Math.round(nextRate)
    setUsdKhrRate(roundedRate)
    try {
      localStorage.setItem('cashier:usdKhrRate', String(roundedRate))
    } catch {}
    showToast(`汇率已更新：$1 = ${roundedRate.toLocaleString('en-US')}${KHR_SYMBOL}`)
  }

  function resetDesktopTransientCheckoutState() {
    setDesktopSelectedPaymentMethod(null)
    setCashTendered('')
    setSubmitError('')
    setSaleResult(null)
    setReceiptPreviewOpen(false)
  }

  function handleHoldCurrentOrder() {
    if (!isDesktopPos || !storeCode || cart.length === 0) return
    try {
      const nextOrders = saveHoldOrder<CartLine, DesktopCheckoutStep>({
        storeCode,
        cart,
        checkoutStep,
      })
      setHoldOrders(nextOrders)
      setCart([])
      setCheckoutStep('SELECT_ITEMS')
      resetDesktopTransientCheckoutState()
      showToast('已挂起当前单')
    } catch (err) {
      console.warn('[cashier:hold-order] save failed', err)
      showToast('挂单保存失败，请检查浏览器存储权限')
    }
  }

  function handleRestoreHoldOrder(order: HoldOrder<CartLine, DesktopCheckoutStep>) {
    if (!isDesktopPos || !storeCode) return
    try {
      setCart(order.cart)
      setCheckoutStep(order.checkoutStep)
      resetDesktopTransientCheckoutState()
      const nextOrders = removeHoldOrder<CartLine, DesktopCheckoutStep>(storeCode, order.id)
      setHoldOrders(nextOrders)
      showToast('已恢复挂单')
    } catch (err) {
      console.warn('[cashier:hold-order] restore failed', err)
      showToast('恢复挂单失败')
    }
  }

  function handleDeleteHoldOrder(id: string) {
    if (!isDesktopPos || !storeCode) return
    try {
      const nextOrders = removeHoldOrder<CartLine, DesktopCheckoutStep>(storeCode, id)
      setHoldOrders(nextOrders)
      showToast('已删除挂单')
    } catch (err) {
      console.warn('[cashier:hold-order] delete failed', err)
      showToast('删除挂单失败')
    }
  }

  async function loadShiftReport() {
    if (!isDesktopPos || !storeCode) return null
    setShiftReportLoading(true)
    setShiftReportError('')
    try {
      const startIso = shiftStartIso ?? getOrCreateShiftStart(storeCode)
      if (!shiftStartIso) setShiftStartIso(startIso)
      const generatedAt = new Date().toISOString()
      const paramsBase = new URLSearchParams({
        dateFrom: dateParamFromIso(startIso),
        dateTo: dateParamFromIso(generatedAt),
        saleType: 'SALE',
        pageSize: '50',
        storeCode,
        from: 'desktop',
      })

      const allItems: ShiftRecordItem[] = []
      let page = 1
      let total = 0
      do {
        const params = new URLSearchParams(paramsBase)
        params.set('page', String(page))
        const res = await fetch(`/api/records?${params.toString()}`, { cache: 'no-store' })
        if (!res.ok) throw new Error('SHIFT_RECORDS_LOAD_FAILED')
        const data: ShiftRecordsResponse = await res.json()
        allItems.push(...data.items)
        total = data.total
        page += 1
      } while (allItems.length < total)

      const startMs = new Date(startIso).getTime()
      const endMs = new Date(generatedAt).getTime()
      const shiftItems = allItems.filter((item) => {
        const createdMs = new Date(item.createdAt).getTime()
        return (
          item.source === 'SALE_RECORD' &&
          item.saleType === 'SALE' &&
          Number.isFinite(createdMs) &&
          createdMs >= startMs &&
          createdMs <= endMs
        )
      })

      const orderKeys = new Set<string>()
      let salesAmount = 0
      let cashAmount = 0
      let khqrAmount = 0
      let otherAmount = 0

      shiftItems.forEach((item) => {
        const amount = Number(item.lineAmount) || 0
        salesAmount += amount
        orderKeys.add(item.orderNo || item.recordNo)
        if (item.paymentMethod === 'CASH') {
          cashAmount += amount
        } else if (item.paymentMethod === 'KHQR') {
          khqrAmount += amount
        } else {
          otherAmount += amount
        }
      })

      const report: ShiftReportData = {
        storeName: storeName || storeCode,
        shiftStart: startIso,
        generatedAt,
        salesAmount,
        orderCount: orderKeys.size,
        cashAmount,
        khqrAmount,
        otherAmount,
        offlinePendingCount,
        holdOrderCount: holdOrders.length,
      }
      setShiftReport(report)
      return report
    } catch (err) {
      console.warn('[cashier:shift] report load failed', err)
      setShiftReportError('交班报表加载失败，请稍后重试')
      return null
    } finally {
      setShiftReportLoading(false)
    }
  }

  async function handleOpenShiftReport() {
    setShiftReportOpen(true)
    await loadShiftReport()
  }

  async function handlePrintShiftReport() {
    const report = shiftReport ?? await loadShiftReport()
    if (!report) return
    try {
      printShiftReport(report)
    } catch (err) {
      console.warn('[cashier:shift] print failed', err)
      showToast('无法打开交班单打印窗口，请检查浏览器弹窗权限')
    }
  }

  function handleConfirmShiftClose() {
    if (!storeCode) return
    try {
      clearShiftStart(storeCode)
      setShiftStartIso(null)
      setShiftReport(null)
      setShiftReportOpen(false)
      showToast('已确认交班，下次进入将自动开新班')
    } catch (err) {
      console.warn('[cashier:shift] close failed', err)
      showToast('确认交班失败，请重试')
    }
  }

  useEffect(() => {
    const receiptSnapshot = saleResult?.receipt
    if (!isDesktopPos || !autoPrint || !receiptSnapshot) return

    const receiptKey = `${receiptSnapshot.orderNo ?? 'no-order'}:${receiptSnapshot.createdAt}:${receiptSnapshot.totalAmount}`
    if (autoPrintedReceiptKeyRef.current === receiptKey) return
    autoPrintedReceiptKeyRef.current = receiptKey

    if (document.fullscreenElement) {
      showToast('全屏模式下已跳过自动打印，可手动打印小票')
      return
    }

    const timer = window.setTimeout(() => {
      try {
        printDesktopReceipt(receiptSnapshot, lang)
      } catch (err) {
        console.warn('[desktop-receipt] auto print failed', err)
        showToast('自动打印失败，可手动点击打印小票')
      }
    }, 350)

    return () => window.clearTimeout(timer)
  }, [saleResult?.receipt, isDesktopPos, autoPrint, lang])

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

  const syncCurrentCartToCustomerDisplay = useCallback((nextPayment: CashierPaymentMethod, options?: CustomerDisplaySyncOptions) => {
    if (!storeCode || noCodeError || isRestoringCashierStore || cart.length === 0) return
    const displayPayment: CashierDisplayPayment =
      nextPayment === 'KHQR' && isOnline ? 'KHQR' :
      nextPayment === 'CASH' ? 'CASH' :
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
    lastCashierDisplaySyncKey.current = syncKey
    cashierDisplayActiveRef.current = true
    previousCashierDisplayCartCountRef.current = cart.length
    void postCashierDisplaySession({
      storeCode,
      status,
      paymentMethod: displayPayment,
      paymentStatus,
      items,
      message: displayPayment === 'KHQR'
        ? (options?.focusKhqr ? CUSTOMER_DISPLAY_KHQR_FOCUS_MESSAGE : '请扫码支付')
        : null,
    })
  }, [cart, storeCode, isOnline, noCodeError, isRestoringCashierStore])

  useEffect(() => {
    if (!storeCode || noCodeError || isRestoringCashierStore) return
    if (isDesktopPos && checkoutStep === 'SELECT_PAYMENT') return

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
  }, [cart, payment, storeCode, isOnline, noCodeError, isRestoringCashierStore, isDesktopPos, checkoutStep])

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
      setReceiptPreviewOpen(false)
      setSaleResult({
        orderNo: body.orderNo,
        totalAmount: submittedTotal,
        khqrFallback: body.khqrFallback ?? false,
        paymentMethod: apiPayment,
        receipt: isDesktopPos
          ? buildReceiptSnapshot({
              items: submittedItems,
              totalAmount: submittedTotal,
              paymentMethod: apiPayment,
              orderNo: body.orderNo,
              createdAt: body.createdAt,
            })
          : undefined,
      })
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
  const categoryById = new Map(categories.map(c => [c.id, c]))
  const displayProductGroups = (() => {
    if (!isDesktopPos || activeCatId !== null) return []
    const groups = new Map<string, { title: string; items: Product[] }>()
    l1Cats.forEach(cat => groups.set(cat.id, { title: cat.name, items: [] }))
    for (const p of displayProducts) {
      const cat = p.categoryId ? categoryById.get(p.categoryId) : null
      const rootCat = cat?.parentId ? categoryById.get(cat.parentId) : cat
      const groupId = rootCat?.id ?? '__other__'
      if (!groups.has(groupId)) groups.set(groupId, { title: rootCat?.name ?? 'Other', items: [] })
      groups.get(groupId)!.items.push(p)
    }
    return Array.from(groups.values()).filter(group => group.items.length > 0)
  })()

  function renderProductCard(p: Product, idx: number) {
    const inCart = cart.filter(c => c.barcode === p.barcode).reduce((sum, c) => sum + c.qty, 0)
    const color  = COLORS[idx % COLORS.length]
    const emoji  = EMOJIS[idx % EMOJIS.length]
    return (
      <div
        key={p.id}
        style={{
          ...s.pcard,
          ...(isDesktopPos ? s.pcardDesktop : {}),
          borderColor: inCart ? ACCENT : 'transparent',
          boxShadow: inCart ? `0 0 0 1px ${ACCENT}` : '0 1px 4px rgba(0,0,0,.07)',
        }}
        onClick={() => handleAddClick(p)}
      >
        {p.imageUrl ? (
          <div style={{ ...s.pcardImg, ...(isDesktopPos ? s.pcardImgDesktop : {}) }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.imageUrl} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        ) : (
          <div style={{ ...s.pcardImg, ...(isDesktopPos ? s.pcardImgDesktop : {}), background: color }}>{emoji}</div>
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
  }

  const total = cartTotal(cart)
  const count = cartCount(cart)
  const cashReceivedAmount = cashTendered.trim() === '' ? NaN : Number(cashTendered)
  const hasCashReceivedAmount = Number.isFinite(cashReceivedAmount)
  const cashChangeAmount = hasCashReceivedAmount ? Math.max(0, cashReceivedAmount - total) : 0
  const isCashPaymentSelected = isDesktopPos && checkoutStep === 'SELECT_PAYMENT' && desktopSelectedPaymentMethod === 'CASH'
  const isCashReceivedInsufficient = isCashPaymentSelected && (!hasCashReceivedAmount || cashReceivedAmount + 0.0001 < total)
  const desktopKhrAssist = (amount: number) => {
    if (!isDesktopPos || amount <= 0) return null
    return <div style={s.khrAssist}>≈ {toKhr(amount, usdKhrRate)}</div>
  }
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
      <div style={{ ...s.root, ...(isDesktopPos ? s.desktopRoot : {}) }}>

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
            {isDesktopPos && (
              <>
                <div style={s.shiftCard}>
                  <div style={s.shiftStart}>
                    🕐 本班 {shiftStartIso ? fmtTime(shiftStartIso) : '--:--'} 起
                  </div>
                  <button type="button" style={s.shiftBtn} onClick={handleOpenShiftReport}>
                    查看交班报表
                  </button>
                </div>
                <div style={s.holdCard}>
                  <div style={s.holdHead}>
                    <span style={s.holdTitle}>本地挂单</span>
                    <span style={s.holdCount}>{holdOrders.length} 单</span>
                  </div>
                  {cart.length > 0 && (
                    <button type="button" style={s.holdBtn} onClick={handleHoldCurrentOrder}>
                      挂起当前单
                    </button>
                  )}
                  {holdOrders.length > 0 ? (
                    <div style={s.holdList}>
                      {holdOrders.map(order => {
                        const heldCount = cartCount(order.cart)
                        const heldTotal = cartTotal(order.cart)
                        return (
                          <div key={order.id} style={s.holdItem}>
                            <div style={s.holdMeta}>
                              <span>{fmtTime(order.createdAt)}</span>
                              <span>${heldTotal.toFixed(2)}</span>
                            </div>
                            <div style={s.holdSub}>
                              {heldCount} 件 · {order.checkoutStep === 'SELECT_PAYMENT' ? '待收款' : order.checkoutStep === 'CONFIRM_ORDER' ? '待确认' : '选品中'}
                            </div>
                            <div style={s.holdActions}>
                              <button type="button" style={s.holdRestoreBtn} onClick={() => handleRestoreHoldOrder(order)}>
                                恢复
                              </button>
                              <button type="button" style={s.holdDeleteBtn} onClick={() => handleDeleteHoldOrder(order.id)}>
                                删除
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div style={s.holdEmpty}>暂无本地挂单</div>
                  )}
                </div>
                <div style={s.fxCard}>
                  <span style={s.fxLabel}>$1 = {usdKhrRate.toLocaleString('en-US')}{KHR_SYMBOL}</span>
                  <button type="button" style={s.fxBtn} onClick={handleUsdKhrRateApply}>
                    修改
                  </button>
                </div>
                <div style={s.autoPrintToggle}>
                  <div style={s.autoPrintText}>
                    <span style={s.autoPrintTitle}>自动打印小票</span>
                    <span style={s.autoPrintSub}>{autoPrint ? '销售完成后自动打开浏览器打印' : '默认关闭，可手动打印'}</span>
                  </div>
                  <button
                    type="button"
                    aria-pressed={autoPrint}
                    aria-label="自动打印小票"
                    style={{ ...s.autoPrintSwitch, background: autoPrint ? '#2563eb' : 'rgba(148,163,184,.45)' }}
                    onClick={handleAutoPrintToggle}
                  >
                    <span style={{ ...s.autoPrintKnob, left: autoPrint ? 21 : 3 }} />
                  </button>
                </div>
              </>
            )}
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
          <div style={{ ...s.grid, ...(isDesktopPos ? s.desktopGrid : {}) }}>
            {loading && (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', color: '#9ca3af', padding: 40, fontSize: 14 }}>加载商品中…</div>
            )}
            {!loading && displayProducts.length === 0 && (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', color: '#9ca3af', padding: 40, fontSize: 14 }}>
                {kw ? `未找到"${kw}"` : '该分类暂无商品'}
              </div>
            )}
            {!loading && isDesktopPos && activeCatId === null && displayProductGroups.map((group, groupIndex) => (
              <Fragment key={group.title}>
                <div style={s.productGroupTitle}>{group.title}</div>
                {group.items.map((p, idx) => renderProductCard(p, groupIndex * 1000 + idx))}
              </Fragment>
            ))}
            {!loading && (!isDesktopPos || activeCatId !== null) && displayProducts.map((p, idx) => renderProductCard(p, idx))}
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
          <div style={{
            ...s.paySec,
            ...(isDesktopPos ? s.desktopPaySec : {}),
            ...(isDesktopPos && checkoutStep === 'SELECT_PAYMENT' ? s.desktopSelectPaySec : {}),
          }}>
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
                  {desktopKhrAssist(total)}
                  <div style={s.confirmActions}>
                    <button type="button" style={s.secondaryBtn} onClick={() => setCheckoutStep('SELECT_ITEMS')}>
                      返回修改商品
                    </button>
                    <button
                      type="button"
                      style={s.submitBtn}
                      onClick={() => {
                        setDesktopSelectedPaymentMethod(null)
                        syncCurrentCartToCustomerDisplay('KHQR')
                        setCheckoutStep('SELECT_PAYMENT')
                      }}
                    >
                      确认本单，选择收款方式
                    </button>
                  </div>
                  <div style={s.printHint}>本轮仅进入结账占位，不创建 SaleRecord。</div>
                </div>
              ) : checkoutStep === 'SELECT_PAYMENT' ? (
                <div style={{ ...s.confirmPanel, ...s.desktopSelectPanel }}>
                  <div style={s.desktopSelectScroll}>
                    <div>
                      <div style={s.confirmTitle}>选择收款方式</div>
                      <div style={s.confirmSub}>顾客屏已显示 KHQR 收款码。请选择最终收款方式用于记账。</div>
                    </div>
                    <div style={s.totalRow}>
                      <span style={s.totalLbl}>共 {count} 件 · 应付</span>
                      <span style={s.totalAmt}>${total.toFixed(2)}</span>
                    </div>
                    {desktopKhrAssist(total)}
                    {desktopSelectedPaymentMethod === 'CASH' && (
                      <div style={s.cashReceivedBox}>
                        <label style={s.cashReceivedLabel} htmlFor="desktop-cash-tendered">
                          顾客实付金额
                        </label>
                        <input
                          id="desktop-cash-tendered"
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          value={cashTendered}
                          onChange={e => setCashTendered(e.target.value)}
                          placeholder="输入实收现金"
                          style={{
                            ...s.cashReceivedInput,
                            borderColor: isCashReceivedInsufficient ? '#fca5a5' : '#cbd5e1',
                          }}
                        />
                        <div style={s.cashChangeRow}>
                          <span>找零金额</span>
                          <div style={s.cashChangeAmtBox}>
                            <div style={s.cashChangeAmt}>${cashChangeAmount.toFixed(2)}</div>
                            {!isCashReceivedInsufficient && cashChangeAmount > 0 && (
                              <div style={s.cashChangeKhr}>≈ {toKhr(cashChangeAmount, usdKhrRate)}</div>
                            )}
                          </div>
                        </div>
                        {isCashReceivedInsufficient && (
                          <div style={s.cashWarn}>
                            {hasCashReceivedAmount
                              ? `实付不足，还差 $${(total - cashReceivedAmount).toFixed(2)}`
                              : '请输入顾客实付金额后再确认现金收款'}
                          </div>
                        )}
                      </div>
                    )}
                    <div style={s.desktopPayGrid}>
                      <button
                        type="button"
                        style={{ ...s.desktopPayOption, ...(desktopSelectedPaymentMethod === 'CASH' ? s.desktopPayOptionOn : {}) }}
                        onClick={() => {
                          setDesktopSelectedPaymentMethod('CASH')
                          syncCurrentCartToCustomerDisplay('KHQR')
                        }}
                      >
                        <span style={s.desktopPayMain}>💵 现金收款 CASH</span>
                        <span style={s.desktopPaySub}>顾客付现金时选择，最终记录为 CASH。</span>
                      </button>
                      <button
                        type="button"
                        style={{ ...s.desktopPayOption, ...(desktopSelectedPaymentMethod === 'KHQR' ? s.desktopPayOptionOn : {}) }}
                        onClick={() => {
                          setDesktopSelectedPaymentMethod('KHQR')
                          syncCurrentCartToCustomerDisplay('KHQR', { focusKhqr: true })
                        }}
                      >
                        <span style={s.desktopPayMain}>📱 扫码收款 KHQR</span>
                        <span style={s.desktopPaySub}>顾客扫码付款时选择，最终记录为 KHQR。</span>
                      </button>
                    </div>
                  </div>
                  <div style={s.desktopPayStickyActions}>
                    {desktopSelectedPaymentMethod && (
                      <div style={s.nextStepBox}>
                        当前最终记账方式：{desktopSelectedPaymentMethod === 'CASH' ? '现金收款 CASH' : '扫码收款 KHQR'}
                      </div>
                    )}
                    {submitError && (
                      <div style={{ fontSize: 12, color: '#ef4444', padding: '5px 8px', background: '#fef2f2', borderRadius: 6 }}>
                        {submitError}
                      </div>
                    )}
                    <button
                      type="button"
                      style={{ ...s.submitBtn, ...(!desktopSelectedPaymentMethod || submitting || isCashReceivedInsufficient ? s.submitDis : {}) }}
                      disabled={!desktopSelectedPaymentMethod || submitting || isCashReceivedInsufficient}
                      onClick={() => {
                        if (!desktopSelectedPaymentMethod) return
                        if (isCashReceivedInsufficient) return
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
                    <div style={{ ...s.totalRow, marginBottom: 0 }}>
                      <span style={s.totalLbl}>商品种类</span>
                      <span style={s.confirmAmt}>{cart.length} 类</span>
                    </div>
                    <div style={s.confirmActions}>
                      <button
                        type="button"
                        style={s.secondaryBtn}
                        onClick={() => {
                          setDesktopSelectedPaymentMethod(null)
                          syncCurrentCartToCustomerDisplay('CASH')
                          setCheckoutStep('CONFIRM_ORDER')
                        }}
                      >
                        返回本单确认
                      </button>
                      <button
                        type="button"
                        style={s.secondaryBtn}
                        onClick={() => {
                          setDesktopSelectedPaymentMethod(null)
                          syncCurrentCartToCustomerDisplay('CASH')
                          setCheckoutStep('SELECT_ITEMS')
                        }}
                      >
                        返回修改商品
                      </button>
                    </div>
                    <div style={{ ...s.printHint, marginTop: 0 }}>复用原 /cashier 完成销售逻辑 · 不新增提交接口</div>
                  </div>
                </div>
              ) : (
                <>
                  <div style={s.payLabel}>本单</div>
                  <div style={s.totalRow}>
                    <span style={s.totalLbl}>合计 {count} 件</span>
                    <span style={s.totalAmt}>${total.toFixed(2)}</span>
                  </div>
                  {desktopKhrAssist(total)}
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

      {/* ── Shift report overlay ───────────────────────────────────────────── */}
      {shiftReportOpen && (
        <div style={s.overlay} onClick={() => setShiftReportOpen(false)}>
          <div style={s.shiftModal} onClick={e => e.stopPropagation()}>
            <div style={s.modalTitle}>本班交班报表</div>
            <div style={{ ...s.modalSub, marginBottom: 14 }}>
              {shiftStartIso ? `班次开始：${fmtDateTimeShort(shiftStartIso)}` : '班次开始时间读取中'}
            </div>
            {shiftReportLoading && (
              <div style={{ padding: '24px 0', textAlign: 'center', color: '#64748b', fontSize: 13 }}>
                正在生成报表…
              </div>
            )}
            {!shiftReportLoading && shiftReportError && (
              <div style={{ padding: 12, borderRadius: 10, background: '#fef2f2', color: '#b91c1c', fontSize: 13, lineHeight: 1.5 }}>
                {shiftReportError}
              </div>
            )}
            {!shiftReportLoading && !shiftReportError && shiftReport && (
              <ShiftReportPrint report={shiftReport} />
            )}
            <div style={s.shiftActions}>
              <button
                type="button"
                style={s.secondaryBtn}
                onClick={handlePrintShiftReport}
                disabled={shiftReportLoading}
              >
                打印交班单
              </button>
              <button
                type="button"
                style={{ ...s.secondaryBtn, borderColor: '#fecaca', color: '#b91c1c' }}
                onClick={handleConfirmShiftClose}
              >
                确认交班
              </button>
              <button
                type="button"
                style={s.modalBtn}
                onClick={() => setShiftReportOpen(false)}
              >
                继续收银
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sale success overlay ───────────────────────────────────────────── */}
      {saleResult && (
        <div style={s.overlay} onClick={() => { setReceiptPreviewOpen(false); setSaleResult(null) }}>
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
              {isDesktopPos && saleResult.receipt
                ? '🖨️ 已生成 80mm 小票，可预览或使用浏览器打印'
                : '🖨️ 未自动打印小票 · 如需收据请在 mPOS 手机端打印'}
            </div>
            {isDesktopPos && saleResult.receipt && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                <button
                  type="button"
                  style={{ ...s.secondaryBtn, padding: '10px 8px', fontSize: 12 }}
                  onClick={() => setReceiptPreviewOpen(true)}
                >
                  预览小票
                </button>
                <button
                  type="button"
                  style={{ ...s.modalBtn, padding: '10px 8px', fontSize: 12 }}
                  onClick={() => saleResult.receipt && handlePrintReceipt(saleResult.receipt)}
                >
                  打印小票
                </button>
              </div>
            )}
            <button style={s.modalBtn} onClick={() => { setReceiptPreviewOpen(false); setSaleResult(null); searchRef.current?.focus() }}>继续收银</button>
          </div>
        </div>
      )}

      {receiptPreviewOpen && saleResult?.receipt && (
        <DesktopReceiptPreview
          data={saleResult.receipt}
          lang={lang}
          onClose={() => setReceiptPreviewOpen(false)}
          onPrint={() => handlePrintReceipt(saleResult.receipt!)}
        />
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
