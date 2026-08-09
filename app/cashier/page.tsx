'use client'

import { Fragment, useState, useEffect, useCallback, useRef, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import QRCode from 'react-qr-code'
import { useLocale } from '@/app/components/LangProvider'
import { useWorkMode } from '@/app/components/WorkModeProvider'
import { apiFetch, OWNER_CTX } from '@/lib/api'
import {
  DesktopReceiptPreview,
  printDesktopReceipt,
  renderDesktopReceiptHtml,
  type DesktopReceiptData,
} from '@/app/components/DesktopReceipt'
import {
  listQzPrinters,
  printHelloWorldViaQz,
  printCustomerReceiptViaQz,
  printKitchenTicketViaQz,
  QZ_PRINT_QUEUES,
  QzPrintError,
  shouldUseQzPrint,
  submitDesktopReceiptPrint,
  type QzPrintKind,
  type QzStatus,
} from '@/lib/qzPrinterAdapter'
import {
  clearLegacyGlobalQzConfig,
  readQzPrintEnabled,
  readQzSelectedPrinter,
  writeQzPrintEnabled,
  writeQzSelectedPrinter,
} from '@/lib/cashier-qz-config'
import { invalidateQzRequests, startQzRequest } from '@/lib/qzRequestGuard'
import {
  getKitchenTicketHtmlForTest,
  printKitchenTicket,
  type KitchenTicketData,
} from '@/app/components/KitchenTicket'
import {
  DayCloseReport,
  printDayCloseReport,
  type DayCloseReportData,
} from '@/app/components/DayCloseReport'
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
import { clearShiftOperator, clearShiftStart, getOrCreateShiftOperator, getOrCreateShiftStart } from '@/lib/cashier-shift'
import {
  clearPosDeviceToken,
  getPosDeviceId,
  getPosDeviceToken,
  takeComputerLaunchStoreCode,
  isPosUnauthorized,
  posDeviceHeaders,
  savePosDeviceToken,
} from '@/lib/desktop-pos-client'
import { formatMoney, isKhqrSupportedCurrency } from '@/lib/currency'
import { browserPosCustomerDisplayPath } from '@/lib/browser-pos-customer-display'
import { dispatchCashierCartTotalChanged } from '@/lib/customer-display-cart-event'
import {
  createCustomerDisplayRealtimeChannel,
  publishCustomerDisplayRealtimeMessage,
  type CustomerDisplayRealtimePaymentMethod,
  type CustomerDisplayRealtimePaymentStatus,
  type CustomerDisplayRealtimeStatus,
} from '@/lib/customer-display-realtime-channel'

// ─── Types ────────────────────────────────────────────────────────────────────

type Product = {
  id: string; barcode: string; sku?: string | null; code?: string | null; name: string
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
  kitchenTicket?: KitchenTicketData
}
type QzControlledPrintState = {
  status: 'idle' | 'printing' | 'success' | 'error'
  message: string
}

const QZ_PREVIEW_LABEL = process.env.NEXT_PUBLIC_QZ_PRINT_PREVIEW_LABEL
const QZ_PREVIEW_COMMIT = process.env.NEXT_PUBLIC_QZ_PRINT_PREVIEW_COMMIT
const QZ_BUSINESS_RAW_PREVIEW_ACTIVE =
  QZ_PREVIEW_LABEL === 'QZ-PRINT-02D' &&
  /^[0-9a-f]{40}$/.test(QZ_PREVIEW_COMMIT ?? '')
type CashierDisplayStatus = 'DRAFT' | 'AWAITING_PAYMENT' | 'COMPLETED' | 'CANCELLED'
type CashierDisplayPayment = 'CASH' | 'KHQR' | null
type CashierPaymentMethod = 'CASH' | 'KHQR' | 'OTHER' | 'MEMBER_BALANCE'
type DesktopCheckoutStep = 'SELECT_ITEMS' | 'CONFIRM_ORDER' | 'SELECT_PAYMENT'

type EmployeeFullscreenBridge = {
  enterEmployeeFullscreen: () => Promise<boolean>
  exitEmployeeFullscreen: () => Promise<boolean>
  getEmployeeFullscreenState: () => Promise<boolean>
}

declare global {
  interface Window {
    eshopDesktopRuntime?: {
      isDesktop?: boolean
      runtime?: string
      windowRole?: string
      version?: string
      desktopEpoch?: string
    }
    eshopDesktopEmployeeFullscreen?: EmployeeFullscreenBridge
  }
}

function getElectronEmployeeFullscreenBridge(): EmployeeFullscreenBridge | null {
  if (typeof window === 'undefined') return null
  if (!window.eshopDesktopRuntime?.isDesktop || window.eshopDesktopRuntime.windowRole !== 'employee') return null
  return window.eshopDesktopEmployeeFullscreen ?? null
}
type DesktopPaymentMethod = 'CASH' | 'KHQR' | 'MEMBER_BALANCE' | null
type CustomerDisplaySyncOptions = { focusKhqr?: boolean }
type ShiftRecordItem = {
  recordNo: string
  orderNo: string | null
  createdAt: string
  lineAmount: number
  saleType: 'SALE' | 'REFUND'
  status?: string
  paymentMethod: string | null
  productNameSnapshot?: string
  specSnapshot?: string | null
  quantity?: number
  unitPrice?: number
  source?: string
}
type ShiftRecordsResponse = {
  total: number
  page: number
  pageSize: number
  items: ShiftRecordItem[]
}
type DayCloseSummaryResponse = {
  dateFrom: string
  dateTo: string
  storeName: string | null
  totalSaleAmount: number
  totalRefundAmount: number
  netAmount: number
  saleOrderCount: number
  topProducts: Array<{ name: string; spec: string | null; totalQty: number }>
  cashSaleAmount?: number
  khqrSaleAmount?: number
}
type DayCloseRecordsResponse = ShiftRecordsResponse & {
  desktopStore?: { storeCode: string; storeName: string } | null
  summary?: {
    saleCount: number
    refundCount: number
    netAmount: number
    cashSaleAmount: number
    khqrSaleAmount: number
  }
}
type DesktopRecordsState = {
  loading: boolean
  error: string
  items: ShiftRecordItem[]
}
type PosAuthChallenge = {
  requestId: string
  authorizeUrl: string
  expiresAt: string
  storeName: string
  deviceName: string
}
type PosAccountAccessState = 'checking' | 'authorized' | 'login_required' | 'forbidden'

type ScannerDebugState = {
  mounted: boolean
  isActive: boolean
  activeElement: string
  rawValue: string
  barcode: string
  matchCount: number | null
  addToCartCalled: boolean
  lastError: string
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

// 门店级"待收款挂单"（SaleRecord.status=PENDING_PAYMENT，按 orderNo 聚合）。
// 来源可能是手机商户端挂单或浏览器挂单，浏览器凭此实现门店级同步。
type ServerPendingOrderItem = {
  productId: string | null; barcode: string; name: string; spec: string | null
  unitPrice: number; quantity: number; lineAmount: number
}
type ServerPendingOrder = {
  orderNo: string; createdAt: string; totalAmount: number
  itemCount: number; items: ServerPendingOrderItem[]
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
const DEV_OWNER_CTX = process.env.NODE_ENV !== 'production' ? OWNER_CTX : undefined

const SUGAR_SPEC_RE = /no\s*sugar|无糖|微糖|半糖|少糖|正常糖|(?:25|50|75|100)%/i
const SCANNER_MIN_CODE_LENGTH = 5
const DEBUG_SCANNER = false
const DESKTOP_PAYMENT_METHODS: Exclude<DesktopPaymentMethod, null>[] = ['CASH', 'KHQR', 'MEMBER_BALANCE']
const DEFAULT_DESKTOP_PAYMENT_METHOD: Exclude<DesktopPaymentMethod, null> = 'KHQR'

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
function cleanSearchText(value: string) {
  return value
    .replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, '')
    .trim()
}
function normalizeSearchText(value: string | null | undefined) {
  return cleanSearchText(String(value ?? '')).toLowerCase()
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
      return false
    }
    return true
  }).catch((e) => {
    console.warn('[cashier:display-session] sync failed', e)
    return false
  })
}
function isValidStoreCode(sc: string | null): sc is string {
  return !!sc && /^[A-Za-z0-9_-]{2,80}$/.test(sc)
}
function cashierUrlForStore(sc: string) {
  return `/cashier?from=desktop&storeCode=${encodeURIComponent(sc)}`
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
  returnParams.set('mode', 'pos')
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

type DeskLang = 'zh' | 'en' | 'km'

type DesktopCopy = {
  sideTitle: string
  storeLoading: string
  installDesktop: string
  desktopMode: string
  openCustomerDisplay: string
  enterFullscreen: string
  exitFullscreen: string
  rememberedStore: string
  promptStore: string
  networkStatus: string
  online: string
  offline: string
  cacheReady: (count: number, time: string) => string
  cacheEmpty: string
  cacheFailed: string
  cacheSaving: string
  pendingOffline: (count: number) => string
  syncOffline: string
  syncingOffline: string
  syncAfterOnline: string
  offlineHintOnline: string
  offlineHintOffline: string
  holdTitle: string
  holdButton: string
  holdEmpty: string
  holdEmptyPrefix: string
  serverPendingTitle: string
  serverPendingEmpty: string
  serverPendingView: string
  serverPendingHint: string
  recordPendingPayment: string
  shiftStart: (time: string) => string
  shiftReportBtn: string
  dayCloseBtn: string
  cartTitle: string
  cartClear: string
  cartEmpty: string
  allProducts: string
  otherGroup: string
  loadProducts: string
  noProductsForFilter: (kw: string) => string
  compactModeBig: string
  compactModeCompact: string
  autoPrintTitle: string
  autoPrintOn: string
  autoPrintOff: string
  confirmTitle: string
  confirmSub: string
  returnModify: string
  confirmToPay: string
  selectPayTitle: string
  selectPaySub: string
  cashTenderedLabel: string
  cashTenderedPlaceholder: string
  changeLabel: string
  insufficientCash: (diff: string) => string
  insufficientCashInput: string
  cashPayTitle: string
  cashPaySub: string
  khqrPayTitle: string
  khqrPaySub: string
  currentFinalPayment: (method: string) => string
  confirmKhqrReceived: string
  confirmCashReceived: string
  confirmPaymentReceived: string
  goodsCount: (count: number) => string
  backToConfirm: string
  backToModifyGoods: string
  paymentHint: string
  reportShiftTitle: string
  reportDayTitle: string
  printShift: string
  printDay: string
  close: string
  endShift: string
  closeShiftConfirm: string
  closeShiftCancel: string
  saleCompleted: string
  receiptReady: string
  receiptNotAuto: string
  previewReceipt: string
  printReceipt: string
  continueSale: string
  memberPayTitle: string
  memberPayHint: string
  pendingOrdersTitle: string
  pendingOrdersEmpty: string
  pendingOrdersNone: string
  tableNo: string
  pickup: string
  orderStatusPending: string
  orderStatusConfirmed: string
  confirmAction: string
  completeAction: string
  cancelAction: string
  desktopOrdersBtn: string
  desktopProductsBtn: string
  desktopRecordsBtn: string
  searchPlaceholder: string
  sectionCashier: string
  sectionOps: string
  sectionStore: string
  sectionSettings: string
  futureDevices: string
}

function desktopCopy(lang: DeskLang): DesktopCopy {
  if (lang === 'en') {
    return {
      sideTitle: 'Cashier',
      storeLoading: 'Loading…',
      installDesktop: 'Install to PC',
      desktopMode: 'Desktop mode',
      openCustomerDisplay: 'Open Customer Display',
      enterFullscreen: 'Enter full screen',
      exitFullscreen: 'Exit full screen',
      rememberedStore: 'This store is remembered. Desktop open will enter this cashier.',
      promptStore: 'Open with a store link first, then install.',
      networkStatus: 'Network',
      online: 'Online',
      offline: 'Offline',
      cacheReady: (count, time) => `Cache: ${count} items · ${time}`,
      cacheEmpty: 'Cache: no product cache',
      cacheFailed: 'Cache: failed',
      cacheSaving: 'Cache: saving…',
      pendingOffline: (count) => `Pending offline orders: ${count}`,
      syncOffline: 'Sync offline orders',
      syncingOffline: 'Syncing…',
      syncAfterOnline: 'Back online to sync',
      offlineHintOnline: 'Offline cashier only supports CASH. Stored locally and synced later.',
      offlineHintOffline: 'No product cache. Offline cashier unavailable.',
      holdTitle: 'Local holds',
      holdButton: 'Hold current order',
      holdEmpty: 'No local holds',
      holdEmptyPrefix: 'No local holds',
      serverPendingTitle: 'Pending payment holds',
      serverPendingEmpty: 'No pending payment holds',
      serverPendingView: 'View details',
      serverPendingHint: 'Synced across phone & desktop',
      recordPendingPayment: 'Awaiting payment',
      shiftStart: (time) => `Shift ${time} started`,
      shiftReportBtn: 'Shift report',
      dayCloseBtn: 'Day close',
      cartTitle: 'Cart',
      cartClear: 'Clear',
      cartEmpty: 'Tap product cards to add items',
      allProducts: 'All items',
      otherGroup: 'Other',
      loadProducts: 'Loading products…',
      noProductsForFilter: (kw) => (kw ? `No results for "${kw}"` : 'No products in this category'),
      compactModeBig: 'Large',
      compactModeCompact: 'Compact',
      autoPrintTitle: 'Auto print receipt',
      autoPrintOn: 'Open browser print after sale',
      autoPrintOff: 'Off by default, manual print available',
      confirmTitle: 'Confirm order',
      confirmSub: 'Check items, quantity and payable amount. No sale record is created here.',
      returnModify: 'Back to edit items',
      confirmToPay: 'Confirm order, choose payment',
      selectPayTitle: 'Choose payment method',
      selectPaySub: 'Customer screen already shows KHQR. Choose the final payment method for bookkeeping.',
      cashTenderedLabel: 'Customer paid',
      cashTenderedPlaceholder: 'Enter cash received',
      changeLabel: 'Change',
      insufficientCash: (diff) => `Not enough cash, ${diff} more needed`,
      insufficientCashInput: 'Enter cash received before confirming',
      cashPayTitle: 'Cash payment',
      cashPaySub: 'Choose when customer pays cash. Final record will be CASH.',
      khqrPayTitle: 'KHQR payment',
      khqrPaySub: 'Choose when customer pays by scan. Final record will be KHQR.',
      currentFinalPayment: (method) => `Final payment method: ${method}`,
      confirmKhqrReceived: 'Confirm KHQR received and complete sale',
      confirmCashReceived: 'Confirm cash received and complete sale',
      confirmPaymentReceived: 'Confirm payment received and complete sale',
      goodsCount: (count) => `Items ${count}`,
      backToConfirm: 'Back to confirm order',
      backToModifyGoods: 'Back to edit items',
      paymentHint: 'Reuse existing /cashier sale flow · no new submit API',
      reportShiftTitle: 'Shift report',
      reportDayTitle: 'Day close report',
      printShift: 'Print shift report',
      printDay: 'Print day close',
      close: 'Close',
      endShift: 'End shift',
      closeShiftConfirm: 'Confirm end shift?',
      closeShiftCancel: 'Cancel',
      saleCompleted: 'Sale completed',
      receiptReady: '80mm receipt ready. Preview or print in browser.',
      receiptNotAuto: 'Receipt not auto-printed. Use the mPOS phone app if needed.',
      previewReceipt: 'Preview receipt',
      printReceipt: 'Print receipt',
      continueSale: 'Continue',
      memberPayTitle: 'Member balance payment',
      memberPayHint: 'Member balance needs online lookup and real-time deduction.',
      pendingOrdersTitle: 'Pending customer orders',
      pendingOrdersEmpty: 'No pending orders',
      pendingOrdersNone: 'No pending customer orders',
      tableNo: 'Table',
      pickup: 'Pickup / delivery',
      orderStatusPending: 'Pending',
      orderStatusConfirmed: 'Confirmed',
      confirmAction: 'Confirm',
      completeAction: 'Done',
      cancelAction: 'Cancel',
      desktopOrdersBtn: 'Order board',
      desktopProductsBtn: 'Product management',
      desktopRecordsBtn: 'Sales records',
      searchPlaceholder: 'Search products… (press / to focus)',
      sectionCashier: 'Cashier',
      sectionOps: 'Operations',
      sectionStore: 'Store tools',
      sectionSettings: 'Settings',
      futureDevices: 'Printer / cash drawer reserved',
    }
  }
  if (lang === 'km') {
    return {
      sideTitle: 'គិតលុយ',
      storeLoading: 'កំពុងផ្ទុក…',
      installDesktop: 'ដំឡើងលើកុំព្យូទ័រ',
      desktopMode: 'របៀប Desktop',
      openCustomerDisplay: 'បើកអេក្រង់អតិថិជន',
      enterFullscreen: 'ចូលពេញអេក្រង់',
      exitFullscreen: 'ចេញពីពេញអេក្រង់',
      rememberedStore: 'ហាងនេះត្រូវបានចងចាំ។ បើកលើ Desktop នឹងចូលទៅកាន់ប្រអប់គិតលុយនេះ។',
      promptStore: 'សូមបើកតាមតំណហាងជាមុន ហើយសឹមដំឡើង។',
      networkStatus: 'បណ្តាញ',
      online: 'អនឡាញ',
      offline: 'អុហ្វឡាញ',
      cacheReady: (count, time) => `Cache: ${count} មុខ · ${time}`,
      cacheEmpty: 'Cache: មិនទាន់មានទិន្នន័យទំនិញ',
      cacheFailed: 'Cache: បរាជ័យ',
      cacheSaving: 'Cache: កំពុងរក្សាទុក…',
      pendingOffline: (count) => `ការបញ្ជាទិញរង់ចាំ sync: ${count}`,
      syncOffline: 'Sync ការបញ្ជាទិញ offline',
      syncingOffline: 'កំពុង sync…',
      syncAfterOnline: 'ត្រូវភ្ជាប់អ៊ីនធឺណិតសិន',
      offlineHintOnline: 'របៀប offline គាំទ្រ CASH ប៉ុណ្ណោះ។ រក្សាទុកក្នុងเครื่อง ហើយ sync ពេលក្រោយ។',
      offlineHintOffline: 'មិនមាន cache ទំនិញ។ មិនអាចគិតលុយ offline បាន។',
      holdTitle: 'មាត់ស្នើក្នុងเครื่อง',
      holdButton: 'ផ្អាកបញ្ជាទិញបច្ចុប្បន្ន',
      holdEmpty: 'មិនមានមាត់ស្នើ',
      holdEmptyPrefix: 'មិនមានមាត់ស្នើ',
      serverPendingTitle: 'ការផ្អាករង់ចាំទូទាត់',
      serverPendingEmpty: 'មិនមានការផ្អាករង់ចាំទូទាត់',
      serverPendingView: 'មើលព័ត៌មាន',
      serverPendingHint: 'ធ្វើសមកាលកម្មទូរស័ព្ទ & កុំព្យូទ័រ',
      recordPendingPayment: 'រង់ចាំទូទាត់',
      shiftStart: (time) => `ប្តូរវេន ${time} ចាប់ផ្តើម`,
      shiftReportBtn: 'របាយការណ៍ប្តូរវេន',
      dayCloseBtn: 'បិទថ្ងៃ',
      cartTitle: 'រទេះទំនិញ',
      cartClear: 'សម្អាត',
      cartEmpty: 'ចុចលើកាតទំនិញដើម្បីបន្ថែម',
      allProducts: 'ទំនិញទាំងអស់',
      otherGroup: 'ផ្សេងៗ',
      loadProducts: 'កំពុងផ្ទុកទំនិញ…',
      noProductsForFilter: (kw) => (kw ? `មិនមានលទ្ធផលសម្រាប់ "${kw}"` : 'មិនមានទំនិញក្នុងប្រភេទនេះ'),
      compactModeBig: 'ធំ',
      compactModeCompact: 'តូច',
      autoPrintTitle: 'បោះពុម្ពបង្កាន់ដៃស្វ័យប្រវត្តិ',
      autoPrintOn: 'បើក print browser បន្ទាប់ពីលក់',
      autoPrintOff: 'បិទតាមលំនាំដើម · អាចបោះពុម្ពដោយដៃ',
      confirmTitle: 'បញ្ជាក់បញ្ជាទិញ',
      confirmSub: 'ពិនិត្យទំនិញ បរិមាណ និងចំនួនត្រូវបង់។ នៅទីនេះមិនបង្កើត SaleRecord ទេ។',
      returnModify: 'ត្រឡប់ទៅកែទំនិញ',
      confirmToPay: 'បញ្ជាក់បញ្ជាទិញ បន្តជ្រើសការទូទាត់',
      selectPayTitle: 'ជ្រើសរបៀបទូទាត់',
      selectPaySub: 'អេក្រង់អតិថិជនកំពុងបង្ហាញ KHQR រួចហើយ។ សូមជ្រើសរបៀបចុងក្រោយសម្រាប់កំណត់ត្រា។',
      cashTenderedLabel: 'អតិថិជនបង់',
      cashTenderedPlaceholder: 'បញ្ចូលប្រាក់ដែលទទួលបាន',
      changeLabel: 'ប្រាក់អាប់',
      insufficientCash: (diff) => `ប្រាក់មិនគ្រប់ ត្រូវការបន្ថែម ${diff}`,
      insufficientCashInput: 'សូមបញ្ចូលប្រាក់ដែលទទួលបានមុនបញ្ជាក់',
      cashPayTitle: 'បង់ជាសាច់ប្រាក់',
      cashPaySub: 'ជ្រើសពេលអតិថិជនបង់សាច់ប្រាក់។ កំណត់ត្រាចុងក្រោយនឹងជា CASH។',
      khqrPayTitle: 'បង់ KHQR',
      khqrPaySub: 'ជ្រើសពេលអតិថិជនស្កេនបង់។ កំណត់ត្រាចុងក្រោយនឹងជា KHQR។',
      currentFinalPayment: (method) => `របៀបកត់ត្រាចុងក្រោយ៖ ${method}`,
      confirmKhqrReceived: 'បញ្ជាក់បានទទួល KHQR ហើយបញ្ចប់លក់',
      confirmCashReceived: 'បញ្ជាក់បានទទួលសាច់ប្រាក់ ហើយបញ្ចប់លក់',
      confirmPaymentReceived: 'បញ្ជាក់បានទទួលប្រាក់ ហើយបញ្ចប់លក់',
      goodsCount: (count) => `មុខទំនិញ ${count}`,
      backToConfirm: 'ត្រឡប់ទៅបញ្ជាក់បញ្ជាទិញ',
      backToModifyGoods: 'ត្រឡប់ទៅកែទំនិញ',
      paymentHint: 'ប្រើលំហូរ /cashier ដើម · មិនបន្ថែម API ថ្មី',
      reportShiftTitle: 'របាយការណ៍ប្តូរវេន',
      reportDayTitle: 'របាយការណ៍បិទថ្ងៃ',
      printShift: 'បោះពុម្ពរបាយការណ៍ប្តូរវេន',
      printDay: 'បោះពុម្ពរបាយការណ៍បិទថ្ងៃ',
      close: 'បិទ',
      endShift: 'បញ្ចប់វេន',
      closeShiftConfirm: 'បញ្ជាក់បញ្ចប់វេន?',
      closeShiftCancel: 'បោះបង់',
      saleCompleted: 'លក់រួចរាល់',
      receiptReady: 'បង្កាន់ដៃ 80mm រួចហើយ។ អាចមើលមុន ឬបោះពុម្ពតាម browser។',
      receiptNotAuto: 'មិនបានបោះពុម្ពស្វ័យប្រវត្តិទេ។ សូមប្រើ mPOS ពេលចាំបាច់។',
      previewReceipt: 'មើលបង្កាន់ដៃ',
      printReceipt: 'បោះពុម្ពបង្កាន់ដៃ',
      continueSale: 'បន្តគិតលុយ',
      memberPayTitle: 'បង់ដោយសមតុល្យសមាជិក',
      memberPayHint: 'ការបង់ដោយសមតុល្យសមាជិកត្រូវការតាមដានអនឡាញ និងកាត់បញ្ចុះភ្លាមៗ។',
      pendingOrdersTitle: 'បញ្ជាទិញអតិថិជនកំពុងរង់ចាំ',
      pendingOrdersEmpty: 'មិនមានបញ្ជាទិញកំពុងរង់ចាំ',
      pendingOrdersNone: 'មិនមានបញ្ជាទិញអតិថិជនកំពុងរង់ចាំ',
      tableNo: 'តុ',
      pickup: 'យកទៅផ្ទះ / ដឹកជញ្ជូន',
      orderStatusPending: 'រង់ចាំបញ្ជាក់',
      orderStatusConfirmed: 'បានបញ្ជាក់',
      confirmAction: 'បញ្ជាក់',
      completeAction: 'រួចរាល់',
      cancelAction: 'បោះបង់',
      desktopOrdersBtn: 'ក្តារបញ្ជាទិញ',
      desktopProductsBtn: 'គ្រប់គ្រងទំនិញ',
      desktopRecordsBtn: 'កំណត់ត្រាលក់',
      searchPlaceholder: 'ស្វែងរកទំនិញ… (ចុច / ដើម្បីផ្តោត)',
      sectionCashier: 'គិតលុយ',
      sectionOps: 'ប្រតិបត្តិការ',
      sectionStore: 'ឧបករណ៍ហាង',
      sectionSettings: 'ការកំណត់',
      futureDevices: 'ម៉ាស៊ីនបោះពុម្ព / ថតលុយ កំពុងបម្រុងទុក',
    }
  }
  return {
    sideTitle: '收银台',
    storeLoading: '加载中…',
    installDesktop: '安装到电脑',
    desktopMode: '桌面模式',
    openCustomerDisplay: '打开顾客屏',
    enterFullscreen: '进入全屏',
    exitFullscreen: '退出全屏',
    rememberedStore: '已记住当前门店，桌面打开会进入本店收银台',
    promptStore: '请先从门店收银链接进入后再安装',
    networkStatus: '网络状态',
    online: '在线',
    offline: '离线',
    cacheReady: (count, time) => `商品缓存：已缓存 ${count} 个 · ${time}`,
    cacheEmpty: '商品缓存：暂无商品缓存',
    cacheFailed: '商品缓存：失败',
    cacheSaving: '商品缓存：正在更新...',
    pendingOffline: (count) => `待同步离线订单：${count} 笔`,
    syncOffline: '同步离线订单',
    syncingOffline: '同步中…',
    syncAfterOnline: '恢复网络后可同步',
    offlineHintOnline: '离线收银模式：仅支持 CASH，本地保存，恢复网络后再同步。',
    offlineHintOffline: '当前无商品缓存，无法离线收银。',
    holdTitle: '本地挂单',
    holdButton: '挂起当前单',
    holdEmpty: '暂无本地挂单',
    holdEmptyPrefix: '暂无本地挂单',
    serverPendingTitle: '门店待收款挂单',
    serverPendingEmpty: '暂无门店待收款挂单',
    serverPendingView: '查看明细',
    serverPendingHint: '手机 / 电脑收银台同步',
    recordPendingPayment: '待收款',
    shiftStart: (time) => `🕐 本班 ${time} 起`,
    shiftReportBtn: '查看交班报表',
    dayCloseBtn: '日结报表',
    cartTitle: '购物车',
    cartClear: '清空',
    cartEmpty: '点击商品卡片加入购物车',
    allProducts: '全部商品',
    otherGroup: 'Other',
    loadProducts: '加载商品中…',
    noProductsForFilter: (kw) => (kw ? `未找到"${kw}"` : '该分类暂无商品'),
    compactModeBig: '大图',
    compactModeCompact: '紧凑',
    autoPrintTitle: '自动打印小票',
    autoPrintOn: '销售完成后自动打开浏览器打印',
    autoPrintOff: '默认关闭，可手动打印',
    confirmTitle: '确认本单',
    confirmSub: '请核对商品、数量和应付金额。本步骤不会创建销售记录。',
    returnModify: '返回修改商品',
    confirmToPay: '确认本单，选择收款方式',
    selectPayTitle: '选择收款方式',
    selectPaySub: '顾客屏已显示 KHQR 收款码。请选择最终收款方式用于记账。',
    cashTenderedLabel: '顾客实付金额',
    cashTenderedPlaceholder: '输入实收现金',
    changeLabel: '找零金额',
    insufficientCash: (diff) => `实付不足，还差 ${diff}`,
    insufficientCashInput: '请输入顾客实付金额后再确认现金收款',
    cashPayTitle: '💵 现金收款 CASH',
    cashPaySub: '顾客付现金时选择，最终记录为 CASH。',
    khqrPayTitle: '📱 扫码收款 KHQR',
    khqrPaySub: '顾客扫码付款时选择，最终记录为 KHQR。',
    currentFinalPayment: (method) => `当前最终记账方式：${method}`,
    confirmKhqrReceived: '确认 KHQR 已收款，完成销售',
    confirmCashReceived: '确认现金已收款，完成销售',
    confirmPaymentReceived: '确认收款，完成销售',
    goodsCount: (count) => `商品种类 ${count}`,
    backToConfirm: '返回本单确认',
    backToModifyGoods: '返回修改商品',
    paymentHint: '复用原 /cashier 完成销售逻辑 · 不新增提交接口',
    reportShiftTitle: '本班交班报表',
    reportDayTitle: '日结报表',
    printShift: '打印交班单',
    printDay: '打印日结单',
    close: '关闭',
    endShift: '结束本班',
    closeShiftConfirm: '确认结束本班？',
    closeShiftCancel: '取消',
    saleCompleted: '销售完成',
    receiptReady: '🖨️ 已生成 80mm 小票，可预览或使用浏览器打印',
    receiptNotAuto: '🖨️ 未自动打印小票 · 如需收据请在 mPOS 手机端打印',
    previewReceipt: '预览小票',
    printReceipt: '打印小票',
    continueSale: '继续收银',
    memberPayTitle: '👤 会员余额支付',
    memberPayHint: '会员余额支付需联网查询会员，并实时扣减余额。',
    pendingOrdersTitle: '📋 待处理顾客订单',
    pendingOrdersEmpty: '暂无待处理顾客订单',
    pendingOrdersNone: '暂无',
    tableNo: '桌号',
    pickup: '自取/外卖',
    orderStatusPending: '待确认',
    orderStatusConfirmed: '已确认',
    confirmAction: '确认',
    completeAction: '完成',
    cancelAction: '取消',
    desktopOrdersBtn: '接单看板',
    desktopProductsBtn: '商品管理',
    desktopRecordsBtn: '销售记录',
    searchPlaceholder: '搜索商品… （按 / 快速聚焦）',
    sectionCashier: '收银操作',
    sectionOps: '运营结算',
    sectionStore: '门店工具',
    sectionSettings: '设置设备',
    futureDevices: '打印机 / 钱柜 预留',
  }
}

function holdOrderLabel(lang: DeskLang, createdAt: string, note: string | undefined, total: number) {
  if (lang === 'en') {
    return { time: fmtTime(createdAt), note, total: `$${total.toFixed(2)}` }
  }
  if (lang === 'km') {
    return { time: fmtTime(createdAt), note, total: `$${total.toFixed(2)}` }
  }
  return { time: fmtTime(createdAt), note, total: `$${total.toFixed(2)}` }
}

function roundMoney(value: number) {
  return Number(value.toFixed(2))
}

function otherSourceLabel(paymentMethod: string | null) {
  if (paymentMethod === 'MEMBER_BALANCE') return '会员余额'
  if (!paymentMethod) return '历史支付方式未识别'
  return '其他支付方式'
}

function otherDetailsFromRecords(items: ShiftRecordItem[]) {
  const grouped = new Map<string, { orderNo: string; amount: number; source: string }>()
  items
    .filter((item) => item.saleType === 'SALE' && item.paymentMethod !== 'CASH' && item.paymentMethod !== 'KHQR')
    .forEach((item) => {
      const orderKey = item.orderNo || item.recordNo
      const current = grouped.get(orderKey)
      const amount = Number(item.lineAmount) || 0
      if (current) {
        current.amount = roundMoney(current.amount + amount)
      } else {
        grouped.set(orderKey, {
          orderNo: shortNo(orderKey),
          amount: roundMoney(amount),
          source: otherSourceLabel(item.paymentMethod),
        })
      }
    })

  return Array.from(grouped.values())
    .filter((detail) => Math.abs(detail.amount) >= 0.01)
    .sort((a, b) => b.amount - a.amount)
}

function reconcileOtherDetails<T extends { orderNo: string; amount: number; source?: string }>(details: T[], targetAmount: number): T[] {
  const target = roundMoney(Math.max(0, targetAmount))
  const sum = roundMoney(details.reduce((total, detail) => total + detail.amount, 0))
  const diff = roundMoney(target - sum)
  if (target <= 0 || Math.abs(diff) < 0.01) return details
  if (diff > 0) {
    return [
      ...details,
      { orderNo: '未匹配明细', amount: diff, source: '历史支付方式未识别' } as T,
    ]
  }
  return details
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
  sideHead:    { padding: '12px 12px 8px', borderBottom: '1px solid rgba(255,255,255,.08)' },
  sideTitle:   { fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 1, lineHeight: 1.2 },
  sideStore:   { fontSize: 10, color: '#94a3b8', marginTop: 1, lineHeight: 1.3 },
  langSwitch: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 4, marginTop: 8, minHeight: 28 },
  langBtn: {
    height: 28,
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,.14)',
    background: 'rgba(255,255,255,.06)',
    color: '#cbd5e1',
    fontSize: 9,
    fontWeight: 800,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  langBtnOn: { background: '#fff', color: SIDEBAR_BG, borderColor: '#fff' },
  kioskActions: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 },
  kioskBtn: {
    minHeight: 30,
    borderRadius: 9,
    border: '1px solid rgba(255,255,255,.12)',
    background: 'rgba(255,255,255,.08)',
    color: '#e5e7eb',
    fontSize: 10,
    fontWeight: 700,
    cursor: 'pointer',
  },
  kioskHint: { marginTop: 4, fontSize: 9, lineHeight: 1.35, color: '#94a3b8' },
  offlineStatusCard: {
    marginTop: 6,
    borderRadius: 10,
    padding: '6px 8px',
    background: 'rgba(255,255,255,.06)',
    border: '1px solid rgba(255,255,255,.1)',
    color: '#cbd5e1',
    fontSize: 9,
    lineHeight: 1.35,
  },
  offlineStatusLine: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 2 },
  statusPill: { borderRadius: 999, padding: '1px 6px', fontSize: 9, fontWeight: 800, whiteSpace: 'nowrap' as const },
  offlineWarn: { marginTop: 4, color: '#fde68a', fontSize: 9, lineHeight: 1.35 },
  offlineSyncBtn: {
    width: '100%',
    marginTop: 6,
    minHeight: 28,
    borderRadius: 8,
    border: '1px solid rgba(96,165,250,.28)',
    background: 'rgba(37,99,235,.22)',
    color: '#dbeafe',
    fontSize: 10,
    fontWeight: 800,
    cursor: 'pointer',
  },
  offlineSyncBtnDis: { opacity: 0.45, cursor: 'not-allowed' },
  offlineSyncSummary: { marginTop: 4, color: '#bfdbfe', fontSize: 9, lineHeight: 1.35 },
  posAuthCard: {
    marginTop: 6,
    borderRadius: 10,
    padding: '7px 8px',
    background: 'rgba(30,41,59,.72)',
    border: '1px solid rgba(148,163,184,.20)',
    color: '#dbeafe',
    fontSize: 10,
    lineHeight: 1.4,
  },
  posAuthCardOk: { borderColor: 'rgba(52,211,153,.35)', background: 'rgba(6,78,59,.35)', color: '#d1fae5' },
  posAuthCardWarn: { borderColor: 'rgba(251,191,36,.36)', background: 'rgba(120,53,15,.30)', color: '#fef3c7' },
  posAuthTitle: { fontSize: 11, fontWeight: 900, color: '#fff', marginBottom: 3 },
  posAuthBtn: { width: '100%', marginTop: 6, minHeight: 28, borderRadius: 8, border: '1px solid rgba(96,165,250,.28)', background: 'rgba(37,99,235,.72)', color: '#fff', fontSize: 10, fontWeight: 900, cursor: 'pointer' },
  posAuthBtnDis: { opacity: 0.55, cursor: 'not-allowed' },
  sideDivider: { height: 1, background: 'rgba(255,255,255,.08)', margin: '6px 0' },
  sideCats:    { padding: '6px 6px', flex: 1 },
  sideCat:     { display: 'block', width: '100%', textAlign: 'left', padding: '7px 9px', borderRadius: 8, border: 'none', background: 'transparent', color: '#cbd5e1', fontSize: 12, cursor: 'pointer', marginBottom: 2 },
  sideCatOn:   { background: SIDEBAR_ACT, color: '#fff', fontWeight: 600 },
  sideFooter:  { padding: '7px 9px 9px', borderTop: '1px solid rgba(255,255,255,.08)', display: 'flex', flexDirection: 'column', gap: 5 },
  sideSection: { display: 'flex', flexDirection: 'column', gap: 5, padding: 7, borderRadius: 13, border: '1px solid rgba(255,255,255,.08)', background: 'rgba(255,255,255,.03)' },
  sideGroupCashier: { background: 'rgba(59,130,246,.10)', borderColor: 'rgba(96,165,250,.22)' },
  sideGroupOps: { background: 'rgba(16,185,129,.09)', borderColor: 'rgba(52,211,153,.20)' },
  sideGroupStore: { background: 'rgba(245,158,11,.10)', borderColor: 'rgba(251,191,36,.20)' },
  sideGroupSettings: { background: 'rgba(148,163,184,.08)', borderColor: 'rgba(148,163,184,.18)' },
  sideSectionTitle: { fontSize: 13, fontWeight: 800, color: '#dbe7f7', letterSpacing: 0.2, lineHeight: 1.1 },
  sideSectionBody: { display: 'flex', flexDirection: 'column', gap: 4 },
  sidePrimaryBtn: { minHeight: 42, padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(96,165,250,.24)', background: 'rgba(37,99,235,.18)', color: '#eaf2ff', fontSize: 14, fontWeight: 800, cursor: 'pointer', textAlign: 'left' as const },
  sideSecondaryBtn: { minHeight: 30, padding: '7px 10px', borderRadius: 10, border: '1px solid rgba(255,255,255,.08)', background: 'rgba(255,255,255,.05)', color: '#dbe2ea', fontSize: 11, fontWeight: 600, cursor: 'pointer', textAlign: 'left' as const },
  sideMutedBtn: { minHeight: 26, padding: '6px 10px', borderRadius: 10, border: '1px dashed rgba(255,255,255,.08)', background: 'rgba(255,255,255,.02)', color: '#94a3b8', fontSize: 10, fontWeight: 600, cursor: 'pointer', textAlign: 'left' as const },
  holdCard: { padding: 8, borderRadius: 12, background: 'rgba(239,246,255,.14)', border: '1px solid rgba(96,165,250,.20)', color: '#e2e8f0' },
  holdHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 },
  holdTitle: { fontSize: 12, fontWeight: 800, color: '#f8fafc' },
  holdCount: { fontSize: 10, color: '#93c5fd', fontWeight: 700 },
  holdBtn: { width: '100%', minHeight: 42, borderRadius: 12, border: '1px solid rgba(96,165,250,.24)', background: 'rgba(37,99,235,.18)', color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer', marginBottom: 6 },
  holdEmpty: { fontSize: 9, color: '#94a3b8', lineHeight: 1.35 },
  holdList: { display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 112, overflowY: 'auto' },
  holdItem: { padding: 7, borderRadius: 9, background: 'rgba(15,23,42,.30)', border: '1px solid rgba(255,255,255,.06)' },
  holdMeta: { display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 10, fontWeight: 800, color: '#f8fafc', marginBottom: 5 },
  holdSub: { fontSize: 9, color: '#94a3b8', marginBottom: 6 },
  holdActions: { display: 'grid', gridTemplateColumns: '1fr auto', gap: 6 },
  holdRestoreBtn: { minHeight: 26, borderRadius: 8, border: 'none', background: '#dbeafe', color: '#1d4ed8', fontSize: 10, fontWeight: 900, cursor: 'pointer' },
  holdDeleteBtn: { minHeight: 26, borderRadius: 8, border: '1px solid rgba(248,113,113,.28)', background: 'rgba(127,29,29,.26)', color: '#fecaca', fontSize: 10, fontWeight: 900, cursor: 'pointer', padding: '0 8px' },
  shiftCard: { padding: 8, borderRadius: 12, background: 'rgba(236,253,245,.14)', border: '1px solid rgba(52,211,153,.20)', color: '#e2e8f0' },
  shiftStart: { marginBottom: 7, fontSize: 11, fontWeight: 800, color: '#f8fafc' },
  shiftBtn: { width: '100%', minHeight: 42, borderRadius: 12, border: '1px solid rgba(96,165,250,.18)', background: 'rgba(37,99,235,.18)', color: '#eaf2ff', fontSize: 14, fontWeight: 900, cursor: 'pointer' },
  shiftModal: { background: '#fff', borderRadius: 16, padding: 22, width: 'min(420px,92vw)', maxHeight: '86vh', overflowY: 'auto', boxShadow: '0 12px 42px rgba(15,23,42,.22)' },
  shiftActions: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 14 },
  recordsOverlay: { position: 'fixed', inset: 0, zIndex: 110, background: 'rgba(15,23,42,.58)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 },
  recordsModal: { width: 'min(960px, calc(100vw - 36px))', height: 'min(760px, calc(100dvh - 36px))', background: '#fff', borderRadius: 16, boxShadow: '0 20px 60px rgba(15,23,42,.28)', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  recordsHead: { padding: '16px 18px 12px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexShrink: 0 },
  recordsTitleBox: { minWidth: 0 },
  recordsTitle: { fontSize: 18, fontWeight: 900, color: '#111827', marginBottom: 3 },
  recordsSub: { fontSize: 12, color: '#64748b' },
  recordsCloseBtn: { width: 38, height: 38, borderRadius: 10, border: '1px solid #cbd5e1', background: '#fff', color: '#334155', fontSize: 22, lineHeight: 1, fontWeight: 800, cursor: 'pointer', flexShrink: 0 },
  recordsBody: { flex: 1, minHeight: 0, overflowY: 'auto', padding: 14, background: '#f8fafc' },
  recordsEmpty: { padding: '44px 16px', textAlign: 'center', color: '#64748b', fontSize: 13 },
  recordsList: { display: 'flex', flexDirection: 'column', gap: 8 },
  recordsItem: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) 120px 92px 96px', gap: 12, alignItems: 'center', padding: '12px 14px', borderRadius: 12, background: '#fff', border: '1px solid #e2e8f0' },
  recordsItemExpanded: { borderColor: '#93c5fd', boxShadow: '0 0 0 2px rgba(59,130,246,.10)' },
  recordsNo: { fontSize: 14, fontWeight: 900, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  recordsMeta: { marginTop: 3, fontSize: 11, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  recordsAmt: { fontSize: 16, fontWeight: 900, color: '#111827', textAlign: 'right' as const },
  recordsPay: { justifySelf: 'start', borderRadius: 999, padding: '4px 9px', background: '#eff6ff', color: '#1d4ed8', fontSize: 11, fontWeight: 900 },
  recordsTime: { fontSize: 12, color: '#64748b', textAlign: 'right' as const },
  recordsDetail: { gridColumn: '1/-1', borderTop: '1px solid #e5e7eb', paddingTop: 10, display: 'grid', gap: 8 },
  recordsDetailItem: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 54px 82px 82px', gap: 10, alignItems: 'start', fontSize: 12 },
  recordsDetailName: { fontWeight: 900, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  recordsDetailSpec: { marginTop: 2, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  recordsDetailQty: { color: '#334155', fontWeight: 800, textAlign: 'right' as const },
  recordsDetailMoney: { color: '#111827', fontWeight: 800, textAlign: 'right' as const },
  recordsDetailTotal: { borderTop: '1px dashed #cbd5e1', paddingTop: 8, display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, fontWeight: 900, color: '#111827' },
  scannerDebugPanel: {
    position: 'fixed',
    left: 10,
    bottom: 10,
    zIndex: 220,
    width: 260,
    padding: 10,
    borderRadius: 10,
    border: '1px solid rgba(148,163,184,.45)',
    background: 'rgba(15,23,42,.92)',
    color: '#e5e7eb',
    fontSize: 10,
    lineHeight: 1.35,
    boxShadow: '0 12px 30px rgba(15,23,42,.28)',
  },
  scannerDebugTitle: { fontSize: 11, fontWeight: 900, color: '#bfdbfe', marginBottom: 6 },
  scannerDebugRow: { display: 'grid', gridTemplateColumns: '92px minmax(0,1fr)', gap: 6, marginTop: 3 },
  scannerDebugLabel: { color: '#94a3b8' },
  scannerDebugValue: { color: '#f8fafc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  scannerDebugBtn: { width: '100%', marginTop: 8, height: 28, borderRadius: 8, border: '1px solid rgba(96,165,250,.45)', background: 'rgba(37,99,235,.42)', color: '#dbeafe', fontSize: 11, fontWeight: 900, cursor: 'pointer' },

  // ── Middle: product grid ──────────────────────────────────────────────────
  mid:         { flex: 1, display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', minWidth: 0 },
  topbar:      { padding: '10px 14px', background: '#fff', borderBottom: '1px solid #e5e7eb', display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 },
  scannerInput: { position: 'fixed', left: 0, bottom: 0, width: 1, height: 1, opacity: 0.01, border: 0, padding: 0, pointerEvents: 'none', background: 'transparent', color: 'transparent', caretColor: 'transparent' },
  searchWrap:  { flex: 1, position: 'relative', minWidth: 0 },
  search:      { width: '100%', height: 36, border: '1.5px solid #e5e7eb', borderRadius: 8, padding: '0 42px 0 12px', fontSize: 14, outline: 'none', background: '#f9fafb' },
  searchClear: { position: 'absolute', top: 5, right: 6, width: 26, height: 26, borderRadius: 7, border: '1px solid #d1d5db', background: '#fff', color: '#64748b', fontSize: 16, lineHeight: 1, fontWeight: 800, cursor: 'pointer' },
  grid:        { flex: 1, overflowY: 'auto', padding: '12px 10px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(148px,1fr))', gap: 10, alignContent: 'start' },
  desktopGrid: { gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 12, padding: 14 },
  desktopGridCompact: { gridTemplateColumns: 'repeat(auto-fill,minmax(122px,1fr))', gap: 8, padding: 10 },
  productGroupTitle: { gridColumn: '1/-1', padding: '12px 2px 2px', fontSize: 14, fontWeight: 900, color: '#334155', borderBottom: '1px solid #e2e8f0' },
  pcard:       { background: '#fff', borderRadius: 10, overflow: 'hidden', cursor: 'pointer', border: '1.5px solid transparent', transition: 'all .12s', userSelect: 'none' as const },
  pcardDesktop:{ minHeight: 204, display: 'flex', flexDirection: 'column' },
  pcardDesktopCompact:{ minHeight: 112, display: 'flex', flexDirection: 'column' },
  pcardImg:    { height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, overflow: 'hidden' },
  pcardImgDesktop: { height: 112, flexShrink: 0 },
  pcardImgDesktopCompact: { height: 56, flexShrink: 0, fontSize: 20 },
  pcardBody:   { padding: '7px 10px 10px', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' },
  pcardBodyCompact: { padding: '6px 8px 8px' },
  pcardName:   { fontSize: 13, fontWeight: 600, color: '#111827', lineHeight: 1.25, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, flexShrink: 0 },
  pcardNameCompact: { fontSize: 11, fontWeight: 700, lineHeight: 1.2, marginBottom: 1 },
  pcardSpec:   { fontSize: 11, color: '#9ca3af', lineHeight: 1.25, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, flexShrink: 0 },
  pcardSpecCompact: { fontSize: 10, marginBottom: 2 },
  pcardPriceRow: { marginTop: 'auto', minHeight: 26, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, flexShrink: 0, overflow: 'visible' },
  pcardPriceRowCompact: { minHeight: 18 },
  pcardPrice:  { fontSize: 15, lineHeight: '22px', fontWeight: 700, color: ACCENT, flexShrink: 0 },
  pcardPriceCompact: { fontSize: 13, lineHeight: '17px', fontWeight: 800, color: ACCENT },
  topbarActionBtn: { height: 34, padding: '0 10px', borderRadius: 9, border: '1px solid #cbd5e1', background: '#fff', color: '#334155', fontSize: 12, fontWeight: 800, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' as const },

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
  desktopPaySec: { maxHeight: '54vh', overflowX: 'hidden', overflowY: 'auto' },
  desktopSelectPaySec: { height: 'min(68vh,620px)', maxHeight: 'calc(100dvh - 120px)', overflowX: 'hidden', overflowY: 'hidden', display: 'flex', flexDirection: 'column' },
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
  holdNoteMask: { position: 'fixed', inset: 0, zIndex: 95, background: 'rgba(15,23,42,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 },
  holdNoteModal: { width: 'min(420px, 100%)', background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 18px 50px rgba(15,23,42,.24)' },
  holdNoteTitle: { fontSize: 18, fontWeight: 900, color: '#111827', marginBottom: 6, textAlign: 'center' as const },
  holdNoteSub: { fontSize: 12, color: '#64748b', textAlign: 'center' as const, lineHeight: 1.5, marginBottom: 14 },
  holdNoteLabel: { fontSize: 12, fontWeight: 800, color: '#334155', marginBottom: 8 },
  holdNoteInput: { width: '100%', height: 40, borderRadius: 10, border: '1.5px solid #cbd5e1', padding: '0 12px', fontSize: 16, fontWeight: 700, color: '#111827', outline: 'none' },
  holdNoteCount: { marginTop: 6, fontSize: 11, color: '#94a3b8', textAlign: 'right' as const },
  holdNoteActions: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 16 },

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
  desktopPayOption: { borderWidth: 1, borderStyle: 'solid', borderColor: '#cbd5e1', borderRadius: 12, background: '#fff', padding: '13px 12px', textAlign: 'left' as const, cursor: 'pointer', minHeight: 78 },
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
  fxCard: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '6px 8px', borderRadius: 12, background: 'rgba(254,243,199,.10)', border: '1px solid rgba(251,191,36,.18)', color: '#e2e8f0', minWidth: 0 },
  fxLabel: { fontSize: 11, fontWeight: 700, color: '#f8fafc', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' },
  fxBtn: { border: 'none', background: 'transparent', color: '#60a5fa', fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: 0, whiteSpace: 'nowrap' as const },
  autoPrintToggle: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center', gap: 8, minHeight: 42, padding: '6px 8px', borderRadius: 12, background: 'rgba(148,163,184,.05)', border: '1px solid rgba(148,163,184,.12)', color: '#e2e8f0' },
  autoPrintText: { display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 0, minWidth: 0, minHeight: 26 },
  autoPrintTitle: { fontSize: 11, fontWeight: 800, color: '#f8fafc', lineHeight: 1.1 },
  autoPrintSub: { fontSize: 9, color: '#94a3b8', lineHeight: 1.15, minHeight: 11 },
  autoPrintSwitch: { position: 'relative', width: 42, height: 24, borderRadius: 999, border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0, transition: 'background .12s' },
  autoPrintKnob: { position: 'absolute', top: 3, width: 18, height: 18, borderRadius: 999, background: '#fff', transition: 'left .12s' },
  qzPanel: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 },
  qzSelect: { minHeight: 30, borderRadius: 10, border: '1px solid rgba(148,163,184,.18)', background: 'rgba(15,23,42,.35)', color: '#e2e8f0', fontSize: 11, padding: '4px 8px' },
  qzButtonRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 },

  // Toast + error screen
  toast:       { position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: 'rgba(17,24,39,.9)', color: '#fff', borderRadius: 10, padding: '9px 18px', fontSize: 13, zIndex: 200, whiteSpace: 'nowrap' as const, pointerEvents: 'none' },
  errScreen:   { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#f1f5f9', flexDirection: 'column', gap: 12, padding: 32 },
  errTitle:    { fontSize: 18, fontWeight: 700, color: '#111827' },
  errSub:      { fontSize: 13, color: '#6b7280', textAlign: 'center' as const, maxWidth: 380, lineHeight: 1.6 },
  errCode:     { fontSize: 12, color: '#9ca3af', fontFamily: 'monospace', background: '#fff', padding: '6px 14px', borderRadius: 6, border: '1px solid #e5e7eb' },
  authPage: { minHeight: '100dvh', background: '#f1f5f9', display: 'grid', gridTemplateColumns: 'minmax(420px, .9fr) minmax(420px, 1.1fr)', gap: 28, alignItems: 'center', padding: 36, fontFamily: 'system-ui,-apple-system,sans-serif' },
  authIntro: { maxWidth: 560 },
  authBadge: { display: 'inline-flex', alignItems: 'center', minHeight: 30, borderRadius: 999, padding: '0 12px', background: '#dbeafe', color: '#1d4ed8', fontSize: 13, fontWeight: 900, marginBottom: 16 },
  authTitle: { fontSize: 42, lineHeight: 1.08, fontWeight: 950, color: '#0f172a', marginBottom: 14 },
  authSub: { fontSize: 17, lineHeight: 1.65, color: '#475569', marginBottom: 18 },
  authWarn: { borderRadius: 14, background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', padding: '12px 14px', fontSize: 14, lineHeight: 1.55 },
  authCard: { justifySelf: 'center', width: 'min(460px, 100%)', background: '#fff', borderRadius: 18, padding: 24, boxShadow: '0 20px 60px rgba(15,23,42,.16)', border: '1px solid #e2e8f0', textAlign: 'center' as const },
  authQrBox: { width: 260, height: 260, margin: '0 auto 18px', padding: 16, borderRadius: 18, background: '#fff', border: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  authCardTitle: { fontSize: 20, fontWeight: 950, color: '#111827', marginBottom: 7 },
  authCardSub: { fontSize: 14, color: '#64748b', lineHeight: 1.55, marginBottom: 14 },
  authLink: { display: 'block', borderRadius: 10, padding: '9px 10px', background: '#f8fafc', border: '1px solid #e2e8f0', color: '#334155', fontSize: 12, lineHeight: 1.45, wordBreak: 'break-all' as const, textAlign: 'left' as const, marginBottom: 12 },
  authActions: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 },
  authBtn: { minHeight: 42, borderRadius: 11, border: 'none', background: '#2563eb', color: '#fff', fontSize: 14, fontWeight: 900, cursor: 'pointer' },
  authBtnSecondary: { background: '#fff', color: '#334155', border: '1px solid #cbd5e1' },
  authError: { marginTop: 12, borderRadius: 10, padding: '10px 12px', background: '#fef2f2', color: '#b91c1c', fontSize: 13, lineHeight: 1.45 },
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function CashierPage() {
  const router = useRouter()
  const { lang, setLang } = useLocale()
  const workMode = useWorkMode()
  const [storeCode,     setStoreCode]     = useState<string | null>(null)
  const [currencyCode,  setCurrencyCode]  = useState('USD')
  const [storeId,       setStoreId]       = useState('')
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
  const [isReceiptPrintChainActive, setIsReceiptPrintChainActive] = useState(false)
  const [storeName,     setStoreName]     = useState('')
  const [isKitchenTicketEnabled, setIsKitchenTicketEnabled] = useState(false)
  const [loading,       setLoading]       = useState(true)
  const [toast,         setToast]         = useState('')
  const [sugarModal,    setSugarModal]    = useState<Product | null>(null)
  const [pendingSugar,  setPendingSugar]  = useState('50')
  const [pendingOrders, setPendingOrders] = useState<CashierOrder[]>([])
  const [serverPendingOrders, setServerPendingOrders] = useState<ServerPendingOrder[]>([])
  const [viewPendingOrder, setViewPendingOrder] = useState<ServerPendingOrder | null>(null)
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
  const [isUsbCustomerDisplayEventSource, setIsUsbCustomerDisplayEventSource] = useState(false)
  const [posDeviceToken, setPosDeviceToken] = useState('')
  const [posAuthLoading, setPosAuthLoading] = useState(false)
  const [posAuthError, setPosAuthError] = useState('')
  const [posAuthChallenge, setPosAuthChallenge] = useState<PosAuthChallenge | null>(null)
  const [posAuthChecking, setPosAuthChecking] = useState(false)
  const [posAccountAccess, setPosAccountAccess] = useState<PosAccountAccessState>('checking')
  const [posAccountAccessMessage, setPosAccountAccessMessage] = useState('')
  const [checkoutStep, setCheckoutStep] = useState<DesktopCheckoutStep>('SELECT_ITEMS')
  const [desktopSelectedPaymentMethod, setDesktopSelectedPaymentMethod] = useState<DesktopPaymentMethod>(null)
  const [cashTendered, setCashTendered] = useState('')
  const [autoPrint, setAutoPrint] = useState(false)
  const [qzRawCanaryAuthorized, setQzRawCanaryAuthorized] = useState(false)
  const [qzReceiptTest, setQzReceiptTest] = useState<QzControlledPrintState>({ status: 'idle', message: '' })
  const [qzKitchenTest, setQzKitchenTest] = useState<QzControlledPrintState>({ status: 'idle', message: '' })
  const [qzPrintEnabled, setQzPrintEnabled] = useState(false)
  const [qzStatus, setQzStatus] = useState<QzStatus>('idle')
  const [qzPrinters, setQzPrinters] = useState<string[]>([])
  const [qzSelectedPrinter, setQzSelectedPrinter] = useState<string | null>(null)
  const [qzChecking, setQzChecking] = useState(false)
  const qzRequestVersionRef = useRef(0)
  const qzActiveStoreCodeRef = useRef<string | null>(null)
  const readQzSigningStoreCode = useCallback(() => qzActiveStoreCodeRef.current, [])
  const [compactMode, setCompactMode] = useState(false)
  const [usdKhrRate, setUsdKhrRate] = useState(DEFAULT_KHR_RATE)
  const [holdOrders, setHoldOrders] = useState<HoldOrder<CartLine, DesktopCheckoutStep>[]>([])
  const [holdNoteOpen, setHoldNoteOpen] = useState(false)
  const [holdNoteDraft, setHoldNoteDraft] = useState('')
  const [holdNoteCart, setHoldNoteCart] = useState<CartLine[] | null>(null)
  const [holdNoteStep, setHoldNoteStep] = useState<DesktopCheckoutStep>('SELECT_ITEMS')
  const [shiftStartIso, setShiftStartIso] = useState<string | null>(null)
  const [shiftOperator, setShiftOperator] = useState('')
  const [shiftReportOpen, setShiftReportOpen] = useState(false)
  const [shiftReport, setShiftReport] = useState<ShiftReportData | null>(null)
  const [shiftReportLoading, setShiftReportLoading] = useState(false)
  const [shiftReportError, setShiftReportError] = useState('')
  const [shiftCloseConfirmOpen, setShiftCloseConfirmOpen] = useState(false)
  const [dayCloseOpen, setDayCloseOpen] = useState(false)
  const [dayCloseReport, setDayCloseReport] = useState<DayCloseReportData | null>(null)
  const [dayCloseLoading, setDayCloseLoading] = useState(false)
  const [dayCloseError, setDayCloseError] = useState('')
  const [desktopRecordsOpen, setDesktopRecordsOpen] = useState(false)
  const [desktopRecords, setDesktopRecords] = useState<DesktopRecordsState>({ loading: false, error: '', items: [] })
  const [expandedDesktopRecordKey, setExpandedDesktopRecordKey] = useState<string | null>(null)
  const [scannerDebug, setScannerDebug] = useState<ScannerDebugState>({
    mounted: false,
    isActive: false,
    activeElement: '-',
    rawValue: '',
    barcode: '',
    matchCount: null,
    addToCartCalled: false,
    lastError: '尚未扫码',
  })
  const knownOrderIds   = useRef<Set<string>>(new Set())
  const initialPollDone = useRef(false)
  const wasOnlineRef    = useRef(true)
  const searchRef       = useRef<HTMLInputElement>(null)
  const scannerInputRef = useRef<HTMLInputElement>(null)
  const scannerInputDebounceRef = useRef<number | null>(null)
  const ordersRef       = useRef<HTMLDivElement>(null)
  const cashierDisplayActiveRef = useRef(false)
  const lastCashierDisplaySyncKey = useRef('')
  const inFlightCashierDisplaySyncKey = useRef('')
  const previousCashierDisplayCartCountRef = useRef(0)
  const customerDisplayRealtimeChannelRef = useRef<BroadcastChannel | null>(null)
  const customerDisplayRealtimeSequenceRef = useRef(0)
  const autoPrintedReceiptKeyRef = useRef('')
  const receiptPrintButtonRef = useRef<HTMLButtonElement>(null)
  const receiptPrintLockedRef = useRef(false)
  const qzPrintInFlightRef = useRef<Set<QzPrintKind>>(new Set())
  const qzRawBusinessActive = QZ_BUSINESS_RAW_PREVIEW_ACTIVE || qzRawCanaryAuthorized
  const qzClientMode = qzRawBusinessActive ? 'raw' : 'signed'

  const focusSearchInput = useCallback(() => {
    window.setTimeout(() => searchRef.current?.focus(), 0)
  }, [])

  const isUserInputElement = useCallback((element: Element | null) => {
    if (!(element instanceof HTMLElement)) return false
    if (element === scannerInputRef.current) return false
    return element.matches('input, textarea, select, [contenteditable="true"], [contenteditable=""]')
  }, [])

  const getActiveElementName = useCallback(() => {
    const active = document.activeElement
    if (!active) return 'NONE'
    if (active === scannerInputRef.current) return 'ScannerInput'
    if (active === searchRef.current) return 'SearchInput'
    return active.tagName || 'UNKNOWN'
  }, [])

  const updateScannerDebugFocusState = useCallback(() => {
    setScannerDebug(prev => ({
      ...prev,
      mounted: !!scannerInputRef.current,
      isActive: document.activeElement === scannerInputRef.current,
      activeElement: getActiveElementName(),
    }))
  }, [getActiveElementName])

  const focusScannerInput = useCallback(() => {
    window.setTimeout(() => {
      if (isUserInputElement(document.activeElement)) {
        updateScannerDebugFocusState()
        return
      }
      scannerInputRef.current?.focus()
      updateScannerDebugFocusState()
    }, 0)
  }, [isUserInputElement, updateScannerDebugFocusState])

  const isEditableShortcutTarget = useCallback((element: Element | null) => {
    if (!(element instanceof HTMLElement)) return false
    if (element === scannerInputRef.current) {
      return (scannerInputRef.current.value ?? '').length > 0 || scannerInputDebounceRef.current !== null
    }
    return isUserInputElement(element)
  }, [isUserInputElement])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setIsDesktopPos(window.location.pathname === '/desktop/pos' || window.location.pathname === '/cashier')
    setIsUsbCustomerDisplayEventSource(window.location.pathname === '/desktop/pos' && params.get('mode') === 'pos')
  }, [])

  useEffect(() => {
    if (!isUsbCustomerDisplayEventSource) return
    const channel = createCustomerDisplayRealtimeChannel()
    customerDisplayRealtimeChannelRef.current = channel
    return () => {
      customerDisplayRealtimeChannelRef.current = null
      channel?.close()
    }
  }, [isUsbCustomerDisplayEventSource])

  useEffect(() => {
    if (!isDesktopPos || loading || noCodeError || isRestoringCashierStore) return
    focusScannerInput()
  }, [isDesktopPos, loading, noCodeError, isRestoringCashierStore, focusScannerInput])

  useEffect(() => {
    if (!isDesktopPos) return
    const maintainScannerFocus = () => {
      const active = document.activeElement
      if (scannerInputRef.current && active !== scannerInputRef.current && !isUserInputElement(active)) {
        scannerInputRef.current.focus()
      }
      updateScannerDebugFocusState()
    }
    maintainScannerFocus()
    const timer = window.setInterval(maintainScannerFocus, 300)
    return () => window.clearInterval(timer)
  }, [isDesktopPos, isUserInputElement, updateScannerDebugFocusState])

  useEffect(() => {
    return () => {
      if (scannerInputDebounceRef.current !== null) {
        window.clearTimeout(scannerInputDebounceRef.current)
      }
    }
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
      setCompactMode(localStorage.getItem('cashier:compactMode') === '1')
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
      setShiftOperator('')
      return
    }
    try {
      setShiftStartIso(getOrCreateShiftStart(storeCode))
      setShiftOperator(getOrCreateShiftOperator(storeCode, `Desktop POS · ${workMode.effectiveRole || workMode.realRole || 'STAFF'}`))
    } catch (err) {
      console.warn('[cashier:shift] init failed', err)
      setShiftStartIso(null)
      setShiftOperator('')
    }
  }, [isDesktopPos, storeCode, workMode.effectiveRole, workMode.realRole])

  useEffect(() => {
    // One-time cleanup of the pre-scoping global QZ keys from the first
    // POC cut. Their values are never applied to any store.
    try {
      clearLegacyGlobalQzConfig()
    } catch {}
  }, [])

  useEffect(() => {
    // Invalidate any in-flight QZ refresh request (started for the
    // previous store, or for no store yet) before anything else, so its
    // eventual result can never write state or storage for this store.
    invalidateQzRequests(qzRequestVersionRef, qzActiveStoreCodeRef, storeCode)

    // Reset in-memory QZ state before (re)loading a store's own config, so
    // a previous store's enabled flag / selected printer / online status
    // can never be read by handlePrintReceipt while the active store is
    // changing or not yet known.
    setQzPrintEnabled(false)
    setQzStatus('idle')
    setQzPrinters([])
    setQzSelectedPrinter(null)
    setQzChecking(false)

    if (!storeCode) return
    try {
      setQzPrintEnabled(readQzPrintEnabled(storeCode))
      setQzSelectedPrinter(readQzSelectedPrinter(storeCode))
    } catch (err) {
      console.warn('[cashier:qz] config load failed', err)
    }
  }, [storeCode])

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
    const queryStoreCode =
      new URLSearchParams(window.location.search).get('storeCode')?.trim() || null
    const launchStoreCode = takeComputerLaunchStoreCode()
    let sc = queryStoreCode || launchStoreCode || null
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
        // 已有 POS device session 时直接恢复门店，保持最终地址为纯 /cashier。
        // 没有 device session 的旧 Browser 入口仍沿用原来的带 storeCode 恢复逻辑。
        if (getPosDeviceToken(cachedStoreCode)) {
          sc = cachedStoreCode
        } else {
          const restoredUrl = cashierUrlForStore(cachedStoreCode)
          router.replace(restoredUrl)
          window.setTimeout(() => {
            const currentStoreCode = new URLSearchParams(window.location.search).get('storeCode')?.trim() || null
            if (!currentStoreCode) window.location.replace(restoredUrl)
          }, 120)
          return
        }
      }

      if (!sc) {
        setIsRestoringCashierStore(false)
        setStoreId('')
        setNoCodeError(true); setLoading(false); return
      }
    }

    rememberCashierStore(sc)
    const desktopPublicEntry =
      window.location.pathname === '/desktop/pos' ||
      new URLSearchParams(window.location.search).get('from') === 'desktop'

    const existingDeviceToken = getPosDeviceToken(sc)
    setStoreCode(sc)
    setIsKitchenTicketEnabled(false)
    setPosDeviceToken(existingDeviceToken)
    setQzRawCanaryAuthorized(false)
    setPosAuthError('')
    setPosAccountAccess(desktopPublicEntry || existingDeviceToken ? 'authorized' : 'checking')
    setPosAccountAccessMessage('')
    setIsRestoringCashierStore(false)
    if (!desktopPublicEntry) {
      apiFetch(`/api/cashier/access?storeCode=${encodeURIComponent(sc)}`, {
        cache: 'no-store',
        headers: posDeviceHeaders(sc),
      })
        .then(async (r) => {
          const body = await r.json().catch(() => null)
          if (r.ok && body?.ok) {
            setQzRawCanaryAuthorized(body.qzRawCanary === true)
            setPosAccountAccess('authorized')
            setPosAccountAccessMessage('')
            return
          }
          setQzRawCanaryAuthorized(false)
          if (existingDeviceToken) return
          setPosAccountAccess(r.status === 401 ? 'login_required' : 'forbidden')
          setPosAccountAccessMessage(body?.message || body?.error || '请确认你已使用本店老板或员工账号登录。')
        })
        .catch(() => {
          setQzRawCanaryAuthorized(false)
          if (existingDeviceToken) return
          setPosAccountAccess('login_required')
          setPosAccountAccessMessage('请确认你已使用本店老板或员工账号登录。')
        })
    }
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
        setStoreId(typeof d.storeId === 'string' ? d.storeId : '')
        setCurrencyCode(typeof d.currencyCode === 'string' ? d.currencyCode : 'USD')
        setIsKitchenTicketEnabled(d.printKitchenTicket === true)
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
              sku: p.sku,
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
    const electronFullscreen = getElectronEmployeeFullscreenBridge()
    if (electronFullscreen) {
      electronFullscreen.getEmployeeFullscreenState()
        .then((fullscreen) => setIsFullscreen(Boolean(fullscreen)))
        .catch(() => setIsFullscreen(false))
    } else {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }

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
    if (!posDeviceToken && posAccountAccess !== 'authorized') return
    function poll() {
      fetch(`/api/cashier/orders?storeCode=${encodeURIComponent(storeCode!)}`, {
        headers: posDeviceHeaders(storeCode),
      })
        .then(async (r) => {
          const data = await r.json().catch(() => null)
          if (!r.ok && isPosUnauthorized(data, r.status)) {
            setPosAuthError(posAuthCopy().needAuth)
            return null
          }
          return data as CashierOrder[] | null
        })
        .then((data) => {
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
  }, [storeCode, posDeviceToken, posAccountAccess, lang])

  // ── Poll store-level pending-payment holds every 5s ─────────────────────────
  // 门店级待收款挂单（手机端 / 浏览器端挂单统一来源），实现跨端同步。
  useEffect(() => {
    if (!storeCode) return
    if (!posDeviceToken && posAccountAccess !== 'authorized') return
    let cancelled = false
    function poll() {
      fetch(`/api/cashier/pending-orders?storeCode=${encodeURIComponent(storeCode!)}`, {
        headers: posDeviceHeaders(storeCode),
      })
        .then(async (r) => {
          const data = await r.json().catch(() => null)
          if (!r.ok) return null
          return data as ServerPendingOrder[] | null
        })
        .then((data) => {
          if (cancelled || !Array.isArray(data)) return
          setServerPendingOrders(data)
        })
        .catch(() => {})
    }
    poll()
    const timer = setInterval(poll, 5000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [storeCode, posDeviceToken, posAccountAccess])

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault(); focusSearchInput()
      }
      if (e.key === 'Escape') setSugarModal(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusSearchInput])

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 3000) }

  function posAuthCopy() {
    if (lang === 'en') {
      return {
        okTitle: 'POS device authorized',
        okBody: 'This computer can create sales and sync records for this store.',
        warnTitle: 'POS device not authorized',
        warnBody: 'Local CASH can be saved offline, but real sales, member balance, order status and records need device authorization.',
        button: 'Authorize this computer',
        loading: 'Authorizing...',
        success: 'This POS computer is authorized',
        failed: 'Authorization failed. Please ask the owner or active staff to sign in and try again.',
        needAuth: 'This POS computer is not authorized yet. Please bind this device first.',
      }
    }
    if (lang === 'km') {
      return {
        okTitle: 'បានអនុញ្ញាតឧបករណ៍ POS',
        okBody: 'កុំព្យូទ័រនេះអាចលក់ និង sync កំណត់ត្រាសម្រាប់ហាងនេះ។',
        warnTitle: 'ឧបករណ៍ POS មិនទាន់អនុញ្ញាត',
        warnBody: 'CASH offline អាចរក្សាទុកក្នុងម៉ាស៊ីន ប៉ុន្តែការលក់ពិត កាត់សមតុល្យ កែស្ថានភាព និងមើលកំណត់ត្រា ត្រូវការអនុញ្ញាត។',
        button: 'អនុញ្ញាតកុំព្យូទ័រនេះ',
        loading: 'កំពុងអនុញ្ញាត...',
        success: 'កុំព្យូទ័រ POS នេះបានអនុញ្ញាត',
        failed: 'អនុញ្ញាតមិនបាន។ សូមឱ្យម្ចាស់ ឬបុគ្គលិកដែលសកម្ម login ហើយសាកល្បងម្តងទៀត។',
        needAuth: 'កុំព្យូទ័រ POS នេះមិនទាន់អនុញ្ញាត។ សូមភ្ជាប់ឧបករណ៍ជាមុន។',
      }
    }
    return {
      okTitle: 'POS 设备已授权',
      okBody: '本电脑可为当前门店创建销售并同步记录。',
      warnTitle: 'POS 设备未授权',
      warnBody: '可离线保存本地 CASH 单，但真实销售、会员扣款、订单状态和销售记录需要先授权本机。',
      button: '授权本机',
      loading: '授权中...',
      success: '本 POS 电脑已授权',
      failed: '授权失败，请让老板或在职员工先登录后再试。',
      needAuth: '本 POS 电脑尚未授权，请先绑定本机。',
    }
  }

  function handlePosUnauthorized(message?: string) {
    const copy = posAuthCopy()
    if (storeCode) clearPosDeviceToken(storeCode)
    setPosDeviceToken('')
    setPosAuthChallenge(null)
    setPosAuthError(message || copy.needAuth)
    showToast(message || copy.needAuth)
  }

  async function handleAuthorizePosDevice() {
    await startPosAuthorization()
  }

  async function startPosAuthorization() {
    if (!storeCode || posAuthLoading) return
    setPosAuthLoading(true)
    setPosAuthError('')
    try {
      const deviceId = getPosDeviceId()
      const res = await fetch('/api/cashier/device-authorization/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeCode, deviceId, deviceName: '前台收银机' }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.requestId || !body?.authorizeUrl) throw new Error(body?.message || body?.error || 'AUTH_START_FAILED')
      setPosAuthChallenge(body)
    } catch {
      const msg = posAuthCopy().failed
      setPosAuthError(msg)
      showToast(msg)
    } finally {
      setPosAuthLoading(false)
    }
  }

  const checkPosAuthorization = useCallback(async (options?: { toast?: boolean }) => {
    if (!storeCode || !posAuthChallenge || posAuthChecking) return
    setPosAuthChecking(true)
    setPosAuthError('')
    try {
      const deviceId = getPosDeviceId()
      const params = new URLSearchParams({
        requestId: posAuthChallenge.requestId,
        deviceId,
      })
      const res = await fetch(`/api/cashier/device-authorization/status?${params.toString()}`, { cache: 'no-store' })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body) throw new Error(body?.message || body?.error || 'AUTH_CHECK_FAILED')
      if (body.status === 'APPROVED' && body.token) {
        savePosDeviceToken(storeCode, body.token)
        setPosDeviceToken(body.token)
        setPosAuthChallenge(null)
        setPosAuthError('')
        showToast(posAuthCopy().success)
        return
      }
      if (body.status === 'EXPIRED') {
        setPosAuthError('授权二维码已过期，请刷新二维码后让老板重新扫码。')
        return
      }
      if (options?.toast) showToast('还没有收到老板确认，请确认手机上已点“确认授权”。')
    } catch {
      setPosAuthError('暂时无法检查授权结果，请稍后重试。')
    } finally {
      setPosAuthChecking(false)
    }
  }, [storeCode, posAuthChallenge, posAuthChecking, lang])

  function requireOnlinePosAuthorization() {
    if (posAccountAccess === 'authorized') return true
    if (posDeviceToken) return true
    handlePosUnauthorized()
    return false
  }

  useEffect(() => {
    if (!storeCode || posAccountAccess === 'authorized' || posDeviceToken || posAuthChallenge || posAuthLoading) return
    if (new URLSearchParams(window.location.search).get('deviceAuth') !== '1') return
    void startPosAuthorization()
  }, [storeCode, posAccountAccess, posDeviceToken, posAuthChallenge, posAuthLoading])

  useEffect(() => {
    if (!storeCode || posAccountAccess === 'authorized' || posDeviceToken || !posAuthChallenge) return
    const timer = window.setInterval(() => {
      void checkPosAuthorization()
    }, 3000)
    return () => window.clearInterval(timer)
  }, [storeCode, posAccountAccess, posDeviceToken, posAuthChallenge, checkPosAuthorization])

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
      currencyCode,
      items: input.items.map((item) => ({
        name: item.name,
        spec: item.spec,
        qty: item.qty,
        price: item.price,
        lineAmount: item.lineAmount,
      })),
    }
  }

  const finishReceiptPrintFlow = useCallback(() => {
    setReceiptPreviewOpen(false)
    setSaleResult(null)
    setIsReceiptPrintChainActive(false)
    receiptPrintLockedRef.current = false
    focusScannerInput()
  }, [focusScannerInput])

  const qzRawMessage = useCallback((kind: QzPrintKind, error?: unknown) => {
    const queueName = QZ_PRINT_QUEUES[kind]
    if (!error) {
      if (lang === 'en') return `Submitted to “${queueName}”`
      if (lang === 'km') return `បានបញ្ជូនទៅ “${queueName}”`
      return `已提交到“${queueName}”`
    }
    const code = error instanceof QzPrintError ? error.code : 'QZ_PRINT_FAILED'
    if (code === 'QZ_UNAVAILABLE') {
      if (lang === 'en') return 'QZ Tray is unavailable. Confirm QZ Tray 2.2.6 is running.'
      if (lang === 'km') return 'QZ Tray មិនអាចប្រើបាន។ សូមបញ្ជាក់ថា QZ Tray 2.2.6 កំពុងដំណើរការ។'
      return 'QZ Tray 不可用，请确认 QZ Tray 2.2.6 正在运行'
    }
    if (code === 'QZ_QUEUE_NOT_FOUND') {
      if (lang === 'en') return `Windows print queue “${queueName}” was not found.`
      if (lang === 'km') return `រកមិនឃើញជួរបោះពុម្ព Windows “${queueName}” ទេ។`
      return `未找到 Windows 打印队列“${queueName}”`
    }
    if (lang === 'en') return `Submission to “${queueName}” failed. Check that queue and retry.`
    if (lang === 'km') return `ការបញ្ជូនទៅ “${queueName}” បរាជ័យ។ សូមពិនិត្យជួរនោះ ហើយសាកល្បងម្ដងទៀត។`
    return `提交到“${queueName}”失败，请检查该队列后重试`
  }, [lang])

  const submitRawTicket = useCallback(async (
    kind: QzPrintKind,
    receipt: DesktopReceiptData,
    kitchenTicket?: KitchenTicketData,
  ) => {
    if (kind === 'receipt') {
      await printCustomerReceiptViaQz(renderDesktopReceiptHtml(receipt, lang), undefined, undefined, readQzSigningStoreCode)
      return
    }
    const ticket = kitchenTicket ?? {
      storeName: receipt.storeName,
      orderNo: receipt.orderNo,
      createdAt: receipt.createdAt,
      items: receipt.items.map(({ name, spec, qty }) => ({ name, spec, qty })),
    }
    await printKitchenTicketViaQz(getKitchenTicketHtmlForTest(ticket, lang), undefined, undefined, readQzSigningStoreCode)
  }, [lang, readQzSigningStoreCode])

  const handleControlledQzPrint = useCallback(async (
    kind: QzPrintKind,
    receipt: DesktopReceiptData,
    kitchenTicket?: KitchenTicketData,
  ) => {
    if (qzPrintInFlightRef.current.has(kind)) return
    const setState = kind === 'receipt' ? setQzReceiptTest : setQzKitchenTest
    qzPrintInFlightRef.current.add(kind)
    setState({ status: 'printing', message: '' })
    try {
      await submitRawTicket(kind, receipt, kitchenTicket)
      setState({ status: 'success', message: qzRawMessage(kind) })
    } catch (error) {
      console.warn(`[qz-printer] business ${kind} RAW print failed`, error)
      const message = qzRawMessage(kind, error)
      setState({ status: 'error', message })
      showToast(message)
    } finally {
      qzPrintInFlightRef.current.delete(kind)
    }
  }, [qzRawMessage, submitRawTicket])

  const handlePrintReceipt = useCallback((receipt: DesktopReceiptData, kitchenTicket?: KitchenTicketData) => {
    if (qzRawBusinessActive) {
      void handleControlledQzPrint('receipt', receipt, kitchenTicket)
      return
    }
    if (receiptPrintLockedRef.current) return
    receiptPrintLockedRef.current = true
    setIsReceiptPrintChainActive(true)
    const printKitchenTicketAfterReceipt = (printWindow: Window) => {
      if (!kitchenTicket) {
        finishReceiptPrintFlow()
        return
      }
      try {
        printKitchenTicket(kitchenTicket, lang, {
          printWindow,
          onAfterPrint: finishReceiptPrintFlow,
        })
      } catch (err) {
        console.warn('[kitchen-ticket] print window failed', err)
        showToast('厨房单打印窗口未打开，交易已完成')
        finishReceiptPrintFlow()
      }
    }
    const handleFirstPrintTimeout = () => {
      showToast(kitchenTicket
        ? '顾客票打印状态无法确认，厨房票未自动打印，请检查打印机。'
        : '顾客票打印状态无法确认，请检查打印机。')
    }
    const runLegacyPrint = () => {
      try {
        printDesktopReceipt(receipt, lang, kitchenTicket
          ? {
              onAfterPrint: finishReceiptPrintFlow,
              onAfterPrintWithWindow: printKitchenTicketAfterReceipt,
              onFirstPrintTimeout: handleFirstPrintTimeout,
            }
          : {
              onAfterPrint: finishReceiptPrintFlow,
              onFirstPrintTimeout: handleFirstPrintTimeout,
            },
        )
      } catch (err) {
        console.warn('[desktop-receipt] print window failed', err)
        showToast('无法打开打印预览，请检查浏览器弹窗权限')
        finishReceiptPrintFlow()
      }
    }

    // QZ Tray POC: only ever taken for a plain customer receipt (no kitchen
    // ticket) with QZ online and a printer selected. Once this submission
    // starts, it never falls back to runLegacyPrint — success or failure,
    // the operator uses the existing "打印小票" button to retry manually.
    const useQz = shouldUseQzPrint({
      qzPrintEnabled,
      hasKitchenTicket: !!kitchenTicket,
      qzStatus,
      selectedPrinter: qzSelectedPrinter,
    })
    void submitDesktopReceiptPrint({
      useQz,
      printerName: qzSelectedPrinter,
      html: useQz ? renderDesktopReceiptHtml(receipt, lang) : '',
      legacyPrint: runLegacyPrint,
    }).then((result) => {
      if (result.route !== 'qz') return
      if (result.qzError) {
        console.warn('[qz-printer] receipt print failed', result.qzError)
        showToast('QZ 打印失败，本单未自动切换到浏览器打印，请检查 QZ Tray 后手动打印')
      } else {
        showToast('已通过 QZ Tray 提交打印')
      }
      finishReceiptPrintFlow()
    })
  }, [finishReceiptPrintFlow, handleControlledQzPrint, lang, qzPrintEnabled, qzRawBusinessActive, qzStatus, qzSelectedPrinter])

  function closeSaleResultOverlay() {
    if (isReceiptPrintChainActive || receiptPrintLockedRef.current) return
    setReceiptPreviewOpen(false)
    setSaleResult(null)
  }

  function handleContinueSale() {
    if (isReceiptPrintChainActive || receiptPrintLockedRef.current) return
    setReceiptPreviewOpen(false)
    setSaleResult(null)
    focusScannerInput()
  }

  function handleAutoPrintToggle() {
    const next = !autoPrint
    setAutoPrint(next)
    try {
      localStorage.setItem('cashier:autoPrint', next ? '1' : '0')
    } catch {}
    showToast(next ? '已开启自动打印小票' : '已关闭自动打印小票')
  }

  const handleRefreshQzStatus = useCallback(async () => {
    if (qzChecking) return
    const requestStoreCode = storeCode
    const request = startQzRequest(qzRequestVersionRef, qzActiveStoreCodeRef, requestStoreCode)
    // A request only ever starts for the store that's active right now, so
    // this is only false when storeCode is null (nothing to refresh yet).
    if (!requestStoreCode || !request.isCurrent()) return

    setQzChecking(true)
    setQzStatus('checking')
    try {
      const printers = await listQzPrinters(undefined, qzClientMode, readQzSigningStoreCode)
      if (!request.isCurrent()) return
      setQzPrinters(printers)
      setQzStatus('online')
      if (qzSelectedPrinter && !printers.includes(qzSelectedPrinter)) {
        setQzSelectedPrinter(null)
        try { writeQzSelectedPrinter(requestStoreCode, null) } catch {}
      }
    } catch (err) {
      if (!request.isCurrent()) return
      console.warn('[qz-printer] status check failed', err)
      setQzStatus('offline')
      setQzPrinters([])
    } finally {
      if (request.isCurrent()) setQzChecking(false)
    }
  }, [qzChecking, qzClientMode, qzSelectedPrinter, readQzSigningStoreCode, storeCode])

  function handleQzPrintToggle() {
    const next = !qzPrintEnabled
    setQzPrintEnabled(next)
    if (storeCode) {
      try { writeQzPrintEnabled(storeCode, next) } catch {}
    }
    if (next) {
      void handleRefreshQzStatus()
    } else {
      setQzStatus('idle')
    }
  }

  function handleSelectQzPrinter(printerName: string) {
    const next = printerName || null
    setQzSelectedPrinter(next)
    if (storeCode) {
      try { writeQzSelectedPrinter(storeCode, next) } catch {}
    }
  }

  async function handleQzHelloWorldTest() {
    if (!qzSelectedPrinter) {
      showToast('请先选择 QZ 打印机')
      return
    }
    try {
      await printHelloWorldViaQz(qzSelectedPrinter)
      showToast('Hello World 测试已提交到 QZ Tray')
    } catch (err) {
      console.warn('[qz-printer] hello world failed', err)
      showToast('QZ 测试打印失败，请检查 QZ Tray 是否运行')
    }
  }

  function handleCompactModeToggle() {
    const next = !compactMode
    setCompactMode(next)
    try {
      if (next) localStorage.setItem('cashier:compactMode', '1')
      else localStorage.removeItem('cashier:compactMode')
    } catch {}
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
    setHoldNoteCart(cart.map((line) => ({ ...line })))
    setHoldNoteStep(checkoutStep)
    setHoldNoteDraft('')
    setHoldNoteOpen(true)
  }

  function handleConfirmHoldCurrentOrder() {
    if (!isDesktopPos || !storeCode || !holdNoteCart || holdNoteCart.length === 0) return
    try {
      const trimmedNote = holdNoteDraft.trim()
      const note = trimmedNote.slice(0, 8)
      if (trimmedNote.length > 8) showToast('备注已自动截断为 8 个字符')
      const nextOrders = saveHoldOrder<CartLine, DesktopCheckoutStep>({
        storeCode,
        cart: holdNoteCart,
        checkoutStep: holdNoteStep,
        note,
      })
      setHoldOrders(nextOrders)
      setCart([])
      setCheckoutStep('SELECT_ITEMS')
      resetDesktopTransientCheckoutState()
      setHoldNoteOpen(false)
      setHoldNoteCart(null)
      setHoldNoteStep('SELECT_ITEMS')
      setHoldNoteDraft('')
      showToast('已挂起当前单')
    } catch (err) {
      console.warn('[cashier:hold-order] save failed', err)
      showToast('挂单保存失败，请检查浏览器存储权限')
    }
  }

  function handleCancelHoldCurrentOrder() {
    setHoldNoteOpen(false)
    setHoldNoteCart(null)
    setHoldNoteStep('SELECT_ITEMS')
    setHoldNoteDraft('')
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

  async function handleOpenDesktopRecords() {
    if (!storeCode) {
      showToast('请先使用带门店编号的收银链接打开')
      return
    }
    if (!isDesktopPos) {
      window.location.href = desktopRecordsUrlForStore(storeCode)
      return
    }
    setDesktopRecordsOpen(true)
    setExpandedDesktopRecordKey(null)
    setDesktopRecords((prev) => ({ ...prev, loading: true, error: '' }))
    try {
      const dateTo = new Date()
      const dateFrom = new Date(dateTo)
      dateFrom.setDate(dateFrom.getDate() - 30)
      const params = new URLSearchParams({
        storeCode,
        from: 'desktop',
        saleType: 'SALE',
        dateFrom: dateParamFromIso(dateFrom.toISOString()),
        dateTo: dateParamFromIso(dateTo.toISOString()),
        pageSize: '30',
        page: '1',
      })
      const res = await fetch(`/api/records?${params.toString()}`, { cache: 'no-store', headers: posDeviceHeaders(storeCode) })
      const maybeBody = await res.clone().json().catch(() => null)
      if (!res.ok) {
        if (isPosUnauthorized(maybeBody, res.status)) {
          handlePosUnauthorized()
          return
        }
        throw new Error('DESKTOP_RECORDS_LOAD_FAILED')
      }
      const data: ShiftRecordsResponse = await res.json()
      setDesktopRecords({ loading: false, error: '', items: data.items })
    } catch (err) {
      console.warn('[cashier:desktop-records] load failed', err)
      setDesktopRecords({ loading: false, error: '销售记录加载失败，请稍后重试', items: [] })
    }
  }

  async function loadShiftReport() {
    if (!isDesktopPos || !storeCode) return null
    setShiftReportLoading(true)
    setShiftReportError('')
    try {
      const startIso = shiftStartIso ?? getOrCreateShiftStart(storeCode)
      if (!shiftStartIso) setShiftStartIso(startIso)
      const operator = shiftOperator || getOrCreateShiftOperator(storeCode, `Desktop POS · ${workMode.effectiveRole || workMode.realRole || 'STAFF'}`)
      if (!shiftOperator) setShiftOperator(operator)
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
        const res = await fetch(`/api/records?${params.toString()}`, { cache: 'no-store', headers: posDeviceHeaders(storeCode) })
        const maybeBody = await res.clone().json().catch(() => null)
        if (!res.ok) {
          if (isPosUnauthorized(maybeBody, res.status)) {
            handlePosUnauthorized()
            throw new Error('POS_DEVICE_UNAUTHORIZED')
          }
          throw new Error('SHIFT_RECORDS_LOAD_FAILED')
        }
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
      const cashOrderKeys = new Set<string>()
      const khqrOrderKeys = new Set<string>()
      const otherOrderKeys = new Set<string>()
      const otherDetails = otherDetailsFromRecords(shiftItems)
      let salesAmount = 0
      let cashAmount = 0
      let khqrAmount = 0
      let otherAmount = 0

      shiftItems.forEach((item) => {
        const amount = Number(item.lineAmount) || 0
        const orderKey = item.orderNo || item.recordNo
        salesAmount += amount
        orderKeys.add(orderKey)
        if (item.paymentMethod === 'CASH') {
          cashAmount += amount
          cashOrderKeys.add(orderKey)
        } else if (item.paymentMethod === 'KHQR') {
          khqrAmount += amount
          khqrOrderKeys.add(orderKey)
        } else {
          otherAmount += amount
          otherOrderKeys.add(orderKey)
        }
      })

      const report: ShiftReportData = {
        storeName: storeName || storeCode,
        operator,
        shiftStart: startIso,
        generatedAt,
        salesAmount,
        orderCount: orderKeys.size,
        cashAmount,
        cashCount: cashOrderKeys.size,
        khqrAmount,
        khqrCount: khqrOrderKeys.size,
        otherAmount,
        otherCount: otherOrderKeys.size,
        offlinePendingCount,
        holdOrderCount: holdOrders.length,
        otherDetails: reconcileOtherDetails(otherDetails, otherAmount),
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
      printShiftReport(report, lang as 'zh' | 'en' | 'km')
    } catch (err) {
      console.warn('[cashier:shift] print failed', err)
      showToast('无法打开交班单打印窗口，请检查浏览器弹窗权限')
    }
  }

  async function fetchDesktopRecordsForDay(date: string, saleType?: 'SALE' | 'REFUND') {
    if (!storeCode) return { items: [] as ShiftRecordItem[], summary: null as DayCloseRecordsResponse['summary'] | null, storeName: '' }
    const allItems: ShiftRecordItem[] = []
    let page = 1
    let total = 0
    let summary: DayCloseRecordsResponse['summary'] | null = null
    let resolvedStoreName = ''
    do {
      const params = new URLSearchParams({
        dateFrom: date,
        dateTo: date,
        storeCode,
        from: 'desktop',
        pageSize: '50',
        page: String(page),
      })
      if (saleType) params.set('saleType', saleType)
      const url = `/api/records?${params.toString()}`
      const res = await fetch(url, { cache: 'no-store', headers: posDeviceHeaders(storeCode) })
      const data: DayCloseRecordsResponse = await res.json()
      if (!res.ok) {
        if (isPosUnauthorized(data, res.status)) handlePosUnauthorized()
        throw new Error(`DAY_CLOSE_RECORDS_LOAD_FAILED_${res.status}`)
      }
      allItems.push(...data.items)
      total = data.total
      summary = summary ?? data.summary ?? null
      resolvedStoreName = resolvedStoreName || data.desktopStore?.storeName || ''
      page += 1
    } while (allItems.length < total)
    return { items: allItems, summary, storeName: resolvedStoreName }
  }

  function topProductsFromRecords(items: ShiftRecordItem[]) {
    const productMap = new Map<string, { name: string; spec: string | null; totalQty: number }>()
    items
      .filter((item) => item.saleType === 'SALE')
      .forEach((item) => {
        const name = item.productNameSnapshot?.trim() || '商品'
        const spec = item.specSnapshot ?? null
        const key = `${name}||${spec ?? ''}`
        const current = productMap.get(key)
        const qty = Number(item.quantity) || 0
        if (current) {
          current.totalQty += qty
        } else {
          productMap.set(key, { name, spec, totalQty: qty })
        }
      })
    return Array.from(productMap.values())
      .sort((a, b) => b.totalQty - a.totalQty)
      .slice(0, 3)
  }

  async function loadDayCloseReportFromRecords(date: string) {
    const [{ summary, storeName: recordsStoreName }, { items: saleItems }, { items: refundItems }] = await Promise.all([
      fetchDesktopRecordsForDay(date),
      fetchDesktopRecordsForDay(date, 'SALE'),
      fetchDesktopRecordsForDay(date, 'REFUND'),
    ])
    const cashAmount = Number(summary?.cashSaleAmount) || 0
    const khqrAmount = Number(summary?.khqrSaleAmount) || 0
    const totalSaleAmount = saleItems.reduce((sum, item) => sum + (Number(item.lineAmount) || 0), 0)
    const refundAmount = refundItems.reduce((sum, item) => sum + (Number(item.lineAmount) || 0), 0)
    const otherAmount = Math.max(0, roundMoney(totalSaleAmount - cashAmount - khqrAmount))
    const otherDetails = otherDetailsFromRecords(saleItems)
    const report: DayCloseReportData = {
      date,
      storeName: recordsStoreName || storeName || storeCode || 'Store',
      netAmount: Number(summary?.netAmount) || 0,
      saleOrderCount: Number(summary?.saleCount) || 0,
      cashAmount,
      khqrAmount,
      otherAmount,
      topProducts: topProductsFromRecords(saleItems),
      holdOrderCount: holdOrders.length,
      offlinePendingCount,
      refundAmount,
      otherDetails: reconcileOtherDetails(otherDetails, otherAmount),
    }
    return report
  }

  async function loadDayCloseReport() {
    if (!isDesktopPos || !storeCode) return null
    setDayCloseLoading(true)
    setDayCloseError('')
    try {
      const today = new Date().toISOString().slice(0, 10)
      const params = new URLSearchParams({
        dateFrom: today,
        dateTo: today,
        storeCode,
        from: 'desktop',
      })
      if (storeId) params.set('storeId', storeId)
      const summaryUrl = `/api/summary?${params.toString()}`
      const res = await apiFetch(summaryUrl, undefined, DEV_OWNER_CTX)
      const data = await res.json()
      if (!res.ok) {
        console.warn('[cashier:day-close] summary load failed', {
          url: summaryUrl,
          status: res.status,
          body: data,
        })
        const fallbackReport = await loadDayCloseReportFromRecords(today)
        setDayCloseReport(fallbackReport)
        return fallbackReport
      }

      const summaryData = data as DayCloseSummaryResponse

      const cashAmount = Number(summaryData.cashSaleAmount) || 0
      const khqrAmount = Number(summaryData.khqrSaleAmount) || 0
      const totalSaleAmount = Number(summaryData.totalSaleAmount) || 0
      const otherAmount = Math.max(0, Number((totalSaleAmount - cashAmount - khqrAmount).toFixed(2)))
      let otherDetails: ReturnType<typeof otherDetailsFromRecords> = []
      try {
        const { items: saleItems } = await fetchDesktopRecordsForDay(today, 'SALE')
        otherDetails = otherDetailsFromRecords(saleItems)
      } catch (recordsErr) {
        console.warn('[cashier:day-close] other details load failed', recordsErr)
      }
      const report: DayCloseReportData = {
        date: summaryData.dateFrom || today,
        storeName: summaryData.storeName || storeName || storeCode,
        netAmount: Number(summaryData.netAmount) || 0,
        saleOrderCount: Number(summaryData.saleOrderCount) || 0,
        cashAmount,
        khqrAmount,
        otherAmount,
        topProducts: Array.isArray(summaryData.topProducts) ? summaryData.topProducts.slice(0, 3) : [],
        holdOrderCount: holdOrders.length,
        offlinePendingCount,
        refundAmount: Number(summaryData.totalRefundAmount) || 0,
        otherDetails: reconcileOtherDetails(otherDetails, otherAmount),
      }
      setDayCloseReport(report)
      return report
    } catch (err) {
      console.warn('[cashier:day-close] report load failed', err)
      setDayCloseError('日结报表加载失败，请稍后重试')
      return null
    } finally {
      setDayCloseLoading(false)
    }
  }

  async function handleOpenDayCloseReport() {
    setDayCloseOpen(true)
    await loadDayCloseReport()
  }

  async function handlePrintDayCloseReport() {
    const report = dayCloseReport ?? await loadDayCloseReport()
    if (!report) return
    try {
      printDayCloseReport(report)
    } catch (err) {
      console.warn('[cashier:day-close] print failed', err)
      showToast('无法打开日结报表打印窗口，请检查浏览器弹窗权限')
    }
  }

  function handleDesktopLangChange(nextLang: 'zh' | 'en' | 'km') {
    if (lang === nextLang) return
    setLang(nextLang)
    showToast(nextLang === 'zh' ? '已切换为中文' : nextLang === 'en' ? 'Switched to English' : 'បានប្ដូរទៅភាសាខ្មែរ')
  }

  async function handleRequestShiftClose() {
    const report = shiftReport ?? await loadShiftReport()
    if (!report) {
      showToast('交班报表尚未生成，请稍后重试')
      return
    }
    setShiftCloseConfirmOpen(true)
  }

  function handleConfirmShiftClose() {
    if (!storeCode) return
    try {
      clearShiftStart(storeCode)
      clearShiftOperator(storeCode)
      setShiftStartIso(null)
      setShiftOperator('')
      setShiftReport(null)
      setShiftCloseConfirmOpen(false)
      setShiftReportOpen(false)
      showToast('已结束本班，下次进入将自动开新班')
    } catch (err) {
      console.warn('[cashier:shift] close failed', err)
      showToast('结束本班失败，请重试')
    }
  }

  useEffect(() => {
    qzPrintInFlightRef.current.clear()
    setQzReceiptTest({ status: 'idle', message: '' })
    setQzKitchenTest({ status: 'idle', message: '' })
  }, [saleResult?.receipt])

  useEffect(() => {
    const receiptSnapshot = saleResult?.receipt
    if (!isDesktopPos || !autoPrint || !receiptSnapshot) return
    const kitchenTicket = saleResult?.kitchenTicket

    const receiptKey = `${receiptSnapshot.orderNo ?? 'no-order'}:${receiptSnapshot.createdAt}:${receiptSnapshot.totalAmount}`
    if (autoPrintedReceiptKeyRef.current === receiptKey) return
    autoPrintedReceiptKeyRef.current = receiptKey

    const timer = window.setTimeout(() => {
      if (qzRawBusinessActive) {
        void (async () => {
          await handleControlledQzPrint('receipt', receiptSnapshot, kitchenTicket)
          if (kitchenTicket) {
            await handleControlledQzPrint('kitchen', receiptSnapshot, kitchenTicket)
          }
        })()
        return
      }
      handlePrintReceipt(receiptSnapshot, kitchenTicket)
    }, 350)

    return () => window.clearTimeout(timer)
  }, [saleResult?.receipt, saleResult?.kitchenTicket, isDesktopPos, autoPrint, qzRawBusinessActive, handleControlledQzPrint, handlePrintReceipt])

  useEffect(() => {
    if (!isDesktopPos || autoPrint || !saleResult?.receipt || receiptPreviewOpen) return
    const timer = window.setTimeout(() => receiptPrintButtonRef.current?.focus(), 80)
    return () => window.clearTimeout(timer)
  }, [isDesktopPos, autoPrint, saleResult?.receipt, receiptPreviewOpen])

  useEffect(() => {
    const receiptSnapshot = saleResult?.receipt
    if (!isDesktopPos || autoPrint || !receiptSnapshot || receiptPreviewOpen) return
    const printableReceipt = receiptSnapshot
    const kitchenTicket = saleResult?.kitchenTicket
    function onReceiptKey(e: KeyboardEvent) {
      if (e.key !== 'Enter' || e.repeat) return
      if (isEditableShortcutTarget(document.activeElement)) return
      if (receiptPrintLockedRef.current) return
      e.preventDefault()
      handlePrintReceipt(printableReceipt, kitchenTicket)
    }
    window.addEventListener('keydown', onReceiptKey)
    return () => window.removeEventListener('keydown', onReceiptKey)
  }, [isDesktopPos, autoPrint, saleResult?.receipt, saleResult?.kitchenTicket, receiptPreviewOpen, isEditableShortcutTarget, handlePrintReceipt])

  function handleOpenCustomerDisplay() {
    const target = browserPosCustomerDisplayPath(storeCode, lang as DeskLang)
    if (!target) return
    window.open(target, '_blank', 'noopener,noreferrer')
  }

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
      const electronFullscreen = getElectronEmployeeFullscreenBridge()
      if (electronFullscreen) {
        const current = await electronFullscreen.getEmployeeFullscreenState()
        const next = current
          ? await electronFullscreen.exitEmployeeFullscreen()
          : await electronFullscreen.enterEmployeeFullscreen()
        setIsFullscreen(Boolean(next))
      } else if (document.fullscreenElement) {
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
    if (!requireOnlinePosAuthorization()) return
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
        headers: { 'Content-Type': 'application/json', ...posDeviceHeaders(storeCode) },
        body: JSON.stringify({
          storeId: first.storeId,
          storeCode,
          deviceId: first.deviceId,
          orders,
        }),
      })
      const body = await res.json().catch(() => null)
      if (isPosUnauthorized(body, res.status)) {
        await markOfflineOrdersSyncFailed(syncingIds, body?.message ?? 'POS_DEVICE_UNAUTHORIZED')
        handlePosUnauthorized()
        return
      }
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
    if (!requireOnlinePosAuthorization()) return
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
        headers: { 'Content-Type': 'application/json', ...posDeviceHeaders(storeCode) },
        body: JSON.stringify({
          storeCode,
          memberId: memberPayMember.id,
          items: cart.map(c => ({ barcode: c.barcode, quantity: c.qty, ...(c.sugar ? { sugar: c.sugar } : {}) })),
        }),
      })
      const body = await res.json().catch(() => null)
      if (isPosUnauthorized(body, res.status)) {
        handlePosUnauthorized()
        return
      }
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
      inFlightCashierDisplaySyncKey.current = ''
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
  const addToCart = useCallback((p: Product, sugar?: string, options?: { focusSearch?: boolean }) => {
    setCart(prev => {
      const found = prev.find(c => c.barcode === p.barcode && c.sugar === sugar)
      if (found) return prev.map(c => c.barcode === p.barcode && c.sugar === sugar ? { ...c, qty: c.qty + 1 } : c)
      return [...prev, { productId: p.id, barcode: p.barcode, name: p.name, spec: p.spec, price: p.sellPrice, qty: 1, imageUrl: p.imageUrl, sugar }]
    })
    if (isDesktopPos && options?.focusSearch !== false) focusScannerInput()
  }, [focusScannerInput, isDesktopPos])

  const updateQty = useCallback((barcode: string, sugar: string | undefined, delta: number) => {
    setCart(prev =>
      prev.map(c => c.barcode === barcode && c.sugar === sugar ? { ...c, qty: c.qty + delta } : c).filter(c => c.qty > 0)
    )
  }, [])

  const publishCustomerDisplayRealtimeSnapshot = useCallback((input: {
    reason: 'cart' | 'clear' | 'final'
    cartSnapshot: CartLine[]
    paymentMethod: CustomerDisplayRealtimePaymentMethod
    paymentStatus: CustomerDisplayRealtimePaymentStatus
    status: CustomerDisplayRealtimeStatus
  }) => {
    if (!isUsbCustomerDisplayEventSource || !storeCode || noCodeError || isRestoringCashierStore) return
    const items = cashierDisplayItems(input.cartSnapshot)
    const totalAmount = input.cartSnapshot.length > 0 ? cartTotal(input.cartSnapshot) : 0
    customerDisplayRealtimeSequenceRef.current += 1
    publishCustomerDisplayRealtimeMessage(customerDisplayRealtimeChannelRef.current, {
      type: input.reason === 'clear' ? 'CLEAR' : 'CART_SNAPSHOT',
      storeCode,
      sentAt: new Date().toISOString(),
      sequence: customerDisplayRealtimeSequenceRef.current,
      items,
      totalAmount,
      itemCount: cartCount(input.cartSnapshot),
      currencyCode,
      status: input.status,
      paymentMethod: input.paymentMethod,
      paymentStatus: input.paymentStatus,
    })
  }, [currencyCode, isRestoringCashierStore, isUsbCustomerDisplayEventSource, noCodeError, storeCode])

  useEffect(() => {
    if (!isUsbCustomerDisplayEventSource || !storeCode || noCodeError || isRestoringCashierStore || saleResult) return
    const totalAmount = cart.length > 0 ? cartTotal(cart) : 0
    if (cart.length === 0 && checkoutStep !== 'SELECT_ITEMS') return
    dispatchCashierCartTotalChanged({
      storeCode,
      totalAmount,
      itemCount: cartCount(cart),
      updatedAt: new Date().toISOString(),
      reason: cart.length > 0 ? 'cart' : 'clear',
    })
    const paymentMethod: CustomerDisplayRealtimePaymentMethod =
      checkoutStep === 'SELECT_PAYMENT' && desktopSelectedPaymentMethod === 'KHQR' ? 'KHQR' :
      checkoutStep === 'SELECT_PAYMENT' && desktopSelectedPaymentMethod === 'CASH' ? 'CASH' :
      null
    publishCustomerDisplayRealtimeSnapshot({
      reason: cart.length > 0 ? 'cart' : 'clear',
      cartSnapshot: cart,
      paymentMethod,
      paymentStatus: paymentMethod === 'KHQR' ? 'PENDING' : null,
      status: cart.length > 0 && paymentMethod === 'KHQR' ? 'AWAITING_PAYMENT' : 'DRAFT',
    })
  }, [
    cart,
    checkoutStep,
    desktopSelectedPaymentMethod,
    isUsbCustomerDisplayEventSource,
    storeCode,
    noCodeError,
    isRestoringCashierStore,
    saleResult,
    publishCustomerDisplayRealtimeSnapshot,
  ])

  const postCashierDisplaySessionOnce = useCallback((
    syncKey: string,
    input: Parameters<typeof postCashierDisplaySession>[0],
  ) => {
    if (syncKey === lastCashierDisplaySyncKey.current) return
    if (syncKey === inFlightCashierDisplaySyncKey.current) return
    inFlightCashierDisplaySyncKey.current = syncKey
    void postCashierDisplaySession(input).then((ok) => {
      if (inFlightCashierDisplaySyncKey.current !== syncKey) return
      inFlightCashierDisplaySyncKey.current = ''
      if (ok) lastCashierDisplaySyncKey.current = syncKey
    }).catch(() => {
      if (inFlightCashierDisplaySyncKey.current === syncKey) {
        inFlightCashierDisplaySyncKey.current = ''
      }
    })
  }, [])

  const syncCurrentCartToCustomerDisplay = useCallback((nextPayment: CashierPaymentMethod, options?: CustomerDisplaySyncOptions) => {
    if (!storeCode || noCodeError || isRestoringCashierStore || cart.length === 0) return
    const displayPayment: CashierDisplayPayment =
      nextPayment === 'KHQR' && isOnline && isKhqrSupportedCurrency(currencyCode) ? 'KHQR' :
      nextPayment === 'CASH' ? 'CASH' :
      null
    const status: CashierDisplayStatus = displayPayment === 'KHQR' ? 'AWAITING_PAYMENT' : 'DRAFT'
    const paymentStatus = displayPayment === 'KHQR' ? 'PENDING' : null
    const items = cashierDisplayItems(cart)
    const message = displayPayment === 'KHQR'
      ? (options?.focusKhqr ? CUSTOMER_DISPLAY_KHQR_FOCUS_MESSAGE : '请扫码支付')
      : null
    const syncKey = JSON.stringify({
      storeCode,
      status,
      paymentMethod: displayPayment,
      paymentStatus,
      items,
      message,
    })
    cashierDisplayActiveRef.current = true
    previousCashierDisplayCartCountRef.current = cart.length
    postCashierDisplaySessionOnce(syncKey, {
      storeCode,
      status,
      paymentMethod: displayPayment,
      paymentStatus,
      items,
      message,
    })
  }, [cart, storeCode, isOnline, noCodeError, isRestoringCashierStore, currencyCode, postCashierDisplaySessionOnce])

  useEffect(() => {
    if (!storeCode || noCodeError || isRestoringCashierStore) return
    if (isDesktopPos && checkoutStep === 'SELECT_PAYMENT') return

    if (cart.length === 0) {
      previousCashierDisplayCartCountRef.current = 0
      if (!cashierDisplayActiveRef.current) return
      cashierDisplayActiveRef.current = false
      lastCashierDisplaySyncKey.current = ''
      inFlightCashierDisplaySyncKey.current = ''
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
      payment === 'KHQR' && isOnline && isKhqrSupportedCurrency(currencyCode) ? 'KHQR' :
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
      postCashierDisplaySessionOnce(syncKey, {
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
      postCashierDisplaySessionOnce(syncKey, {
        storeCode,
        status,
        paymentMethod: displayPayment,
        paymentStatus,
        items,
        message: displayPayment === 'KHQR' ? '请扫码支付' : null,
      })
    }, CASHIER_DISPLAY_SYNC_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [cart, payment, storeCode, isOnline, noCodeError, isRestoringCashierStore, isDesktopPos, checkoutStep, currencyCode, postCashierDisplaySessionOnce])

  // ── Submit sale ────────────────────────────────────────────────────────────
  async function handleSubmit(paymentOverride?: CashierPaymentMethod) {
    if (cart.length === 0 || submitting || !storeCode) return
    const submitPayment = paymentOverride ?? payment
    if (submitPayment === 'KHQR' && !khqrSupported) {
      showToast('当前门店货币不支持 KHQR，请使用 CASH 收款')
      return
    }
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
        inFlightCashierDisplaySyncKey.current = ''
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
      if (!requireOnlinePosAuthorization()) {
        setSubmitting(false)
        return
      }
      const res = await fetch('/api/cashier/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...posDeviceHeaders(storeCode) },
        body: JSON.stringify({
          storeCode,
          items: cart.map(c => ({ barcode: c.barcode, quantity: c.qty, ...(c.sugar ? { sugar: c.sugar } : {}) })),
          paymentMethod: apiPayment,
          manualPaymentConfirmed: apiPayment === 'KHQR',
        }),
      })
      const body = await res.json()
      if (isPosUnauthorized(body, res.status)) {
        handlePosUnauthorized()
        return
      }
      if (!res.ok) { setSubmitError(body.message ?? body.error ?? '提交失败，请重试'); return }
      cashierDisplayActiveRef.current = false
      lastCashierDisplaySyncKey.current = ''
      inFlightCashierDisplaySyncKey.current = ''
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
      const receipt = isDesktopPos
        ? buildReceiptSnapshot({
            items: submittedItems,
            totalAmount: submittedTotal,
            paymentMethod: apiPayment,
            orderNo: body.orderNo,
            createdAt: body.createdAt,
          })
        : undefined
      setSaleResult({
        orderNo: body.orderNo,
        totalAmount: submittedTotal,
        khqrFallback: body.khqrFallback ?? false,
        paymentMethod: apiPayment,
        receipt,
        kitchenTicket: receipt && isKitchenTicketEnabled
          ? {
              storeName: receipt.storeName,
              orderNo: receipt.orderNo,
              createdAt: receipt.createdAt,
              items: receipt.items.map(({ name, spec, qty }) => ({ name, spec, qty })),
            }
          : undefined,
      })
    } catch { setSubmitError('网络错误，请重试') }
    finally { setSubmitting(false) }
  }

  // ── Order actions ──────────────────────────────────────────────────────────
  async function handleOrderAction(id: string, newStatus: string) {
    if (!storeCode) return
    if (!requireOnlinePosAuthorization()) return
    setUpdatingId(id)
    try {
      const res = await fetch(`/api/cashier/orders/${id}?storeCode=${encodeURIComponent(storeCode)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...posDeviceHeaders(storeCode) },
        body: JSON.stringify({ status: newStatus }),
      })
      const body = await res.clone().json().catch(() => null)
      if (isPosUnauthorized(body, res.status)) {
        handlePosUnauthorized()
        return
      }
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
  const kw = normalizeSearchText(searchKw)
  function productMatchesKeyword(p: Product, keyword: string) {
    if (!keyword) return true
    return [
      p.name,
      p.barcode,
      p.sku,
      p.spec,
    ].some(value => normalizeSearchText(value).includes(keyword))
  }
  function productMatchesExactCode(p: Product, keyword: string) {
    if (!keyword) return false
    return [p.barcode, p.sku, p.code].some(value => normalizeSearchText(value) === keyword)
  }
  const displayProducts = products.filter(p => {
    if (!productMatchesKeyword(p, kw)) return false
    if (!activeCatId) return true
    const l2Ids = new Set((l2ByParent.get(activeCatId) ?? []).map(c => c.id))
    return p.categoryId === activeCatId || (p.categoryId !== null && l2Ids.has(p.categoryId))
  })

  function clearScannerInput() {
    if (scannerInputRef.current) scannerInputRef.current.value = ''
    focusScannerInput()
  }

  function scheduleScannerInputCompletion(rawValue: string) {
    if (scannerInputDebounceRef.current !== null) {
      window.clearTimeout(scannerInputDebounceRef.current)
    }
    const previewCode = cleanSearchText(rawValue)
    setScannerDebug(prev => ({
      ...prev,
      mounted: !!scannerInputRef.current,
      isActive: document.activeElement === scannerInputRef.current,
      activeElement: getActiveElementName(),
      rawValue,
      barcode: previewCode,
      addToCartCalled: false,
      lastError: previewCode.length >= SCANNER_MIN_CODE_LENGTH ? '等待扫码完成' : '条码输入中',
    }))
    scannerInputDebounceRef.current = window.setTimeout(() => {
      scannerInputDebounceRef.current = null
      const currentValue = scannerInputRef.current?.value ?? rawValue
      if (cleanSearchText(currentValue).length >= SCANNER_MIN_CODE_LENGTH) {
        completeScannerInput(currentValue)
      }
    }, 220)
  }

  function completeScannerInput(rawValue: string) {
    if (scannerInputDebounceRef.current !== null) {
      window.clearTimeout(scannerInputDebounceRef.current)
      scannerInputDebounceRef.current = null
    }
    const rawCode = cleanSearchText(rawValue)
    const setDebugResult = (input: Partial<ScannerDebugState>) => {
      setScannerDebug(prev => ({
        ...prev,
        mounted: !!scannerInputRef.current,
        isActive: document.activeElement === scannerInputRef.current,
        rawValue,
        barcode: rawCode,
        ...input,
      }))
    }
    clearScannerInput()
    if (rawCode.length < SCANNER_MIN_CODE_LENGTH) {
      setDebugResult({ matchCount: 0, addToCartCalled: false, lastError: '条码过短' })
      return
    }

    const normalized = normalizeSearchText(rawCode)
    const matches = products.filter(p => productMatchesExactCode(p, normalized))
    if (matches.length === 0) {
      setDebugResult({ matchCount: 0, addToCartCalled: false, lastError: '未找到商品' })
      showToast(`未找到商品：${rawCode}`)
      return
    }
    if (matches.length > 1) {
      setDebugResult({ matchCount: matches.length, addToCartCalled: false, lastError: '条码重复' })
      showToast(`条码重复：${rawCode}`)
      return
    }
    if (!isOnline && productsSource !== 'cache') {
      setDebugResult({ matchCount: matches.length, addToCartCalled: false, lastError: '离线无商品缓存' })
      showToast('当前无商品缓存，无法离线收银')
      return
    }
    addToCart(matches[0], undefined, { focusSearch: false })
    setDebugResult({ matchCount: matches.length, addToCartCalled: true, lastError: '' })
    focusScannerInput()
  }
  const d = desktopCopy(lang as DeskLang)
  const categoryById = new Map(categories.map(c => [c.id, c]))
  const displayProductGroups = (() => {
    if (!isDesktopPos || activeCatId !== null) return []
    const groups = new Map<string, { title: string; items: Product[] }>()
    l1Cats.forEach(cat => groups.set(cat.id, { title: cat.name, items: [] }))
    for (const p of displayProducts) {
      const cat = p.categoryId ? categoryById.get(p.categoryId) : null
      const rootCat = cat?.parentId ? categoryById.get(cat.parentId) : cat
      const groupId = rootCat?.id ?? '__other__'
      if (!groups.has(groupId)) groups.set(groupId, { title: rootCat?.name ?? d.otherGroup, items: [] })
      groups.get(groupId)!.items.push(p)
    }
    return Array.from(groups.values()).filter(group => group.items.length > 0)
  })()
  const desktopRecordRows = (() => {
    const rows = new Map<string, {
      key: string
      orderNo: string
      createdAt: string
      paymentMethod: string | null
      pending: boolean
      amount: number
      itemCount: number
      items: ShiftRecordItem[]
    }>()
    desktopRecords.items.forEach((item) => {
      const key = item.orderNo || item.recordNo
      const current = rows.get(key)
      const amount = Number(item.lineAmount) || 0
      const isPending = item.status === 'PENDING_PAYMENT'
      if (current) {
        current.amount += amount
        current.itemCount += 1
        current.pending = current.pending || isPending
        current.items.push(item)
        return
      }
      rows.set(key, {
        key,
        orderNo: item.orderNo || item.recordNo,
        createdAt: item.createdAt,
        paymentMethod: item.paymentMethod,
        pending: isPending,
        amount,
        itemCount: 1,
        items: [item],
      })
    })
    return Array.from(rows.values())
  })()

  // 待收款挂单尚无收款方式，展示为"待收款"而非 UNKNOWN，与手机端一致。
  function desktopRecordPayLabel(row: { paymentMethod: string | null; pending?: boolean }): string {
    if (row.pending) return d.recordPendingPayment
    return row.paymentMethod || 'UNKNOWN'
  }

  function renderDesktopRecordDetails(row: { paymentMethod: string | null; pending?: boolean; amount: number; items: ShiftRecordItem[] }) {
    return (
      <div style={s.recordsDetail}>
        {row.items.map((item, index) => {
          const qty = Number(item.quantity) || 0
          const lineAmount = Number(item.lineAmount) || 0
          const unitPrice = Number(item.unitPrice) || (qty > 0 ? lineAmount / qty : lineAmount)
          return (
            <div key={`${item.recordNo}-${index}`} style={s.recordsDetailItem}>
              <div style={{ minWidth: 0 }}>
                <div style={s.recordsDetailName}>{item.productNameSnapshot || '商品'}</div>
                <div style={s.recordsDetailSpec}>{item.specSnapshot || '无规格'}</div>
              </div>
              <div style={s.recordsDetailQty}>x{qty || 1}</div>
              <div style={s.recordsDetailMoney}>{formatMoney(unitPrice, currencyCode)}</div>
              <div style={s.recordsDetailMoney}>{formatMoney(lineAmount, currencyCode)}</div>
            </div>
          )
        })}
        <div style={s.recordsDetailTotal}>
          <span>支付方式：{desktopRecordPayLabel(row)}</span>
          <span>订单金额：{formatMoney(row.amount, currencyCode)}</span>
        </div>
      </div>
    )
  }

  function renderProductCard(p: Product, idx: number) {
    const inCart = cart.filter(c => c.barcode === p.barcode).reduce((sum, c) => sum + c.qty, 0)
    const color  = COLORS[idx % COLORS.length]
    const emoji  = EMOJIS[idx % EMOJIS.length]
    const isCompactCard = isDesktopPos && compactMode
    return (
      <div
        key={p.id}
        style={{
          ...s.pcard,
          ...(isDesktopPos ? (isCompactCard ? s.pcardDesktopCompact : s.pcardDesktop) : {}),
          borderColor: inCart ? ACCENT : 'transparent',
          boxShadow: inCart ? `0 0 0 1px ${ACCENT}` : '0 1px 4px rgba(0,0,0,.07)',
        }}
        onClick={() => handleAddClick(p)}
      >
        {p.imageUrl ? (
          <div style={{ ...s.pcardImg, ...(isDesktopPos ? (isCompactCard ? s.pcardImgDesktopCompact : s.pcardImgDesktop) : {}) }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.imageUrl} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        ) : (
          <div style={{ ...s.pcardImg, ...(isDesktopPos ? (isCompactCard ? s.pcardImgDesktopCompact : s.pcardImgDesktop) : {}), background: color }}>{emoji}</div>
        )}
        <div style={{ ...s.pcardBody, ...(isCompactCard ? s.pcardBodyCompact : {}) }}>
          <div style={{ ...s.pcardName, ...(isCompactCard ? s.pcardNameCompact : {}) }}>{p.name}</div>
          {p.spec && <div style={{ ...s.pcardSpec, ...(isCompactCard ? s.pcardSpecCompact : {}) }}>{p.spec}</div>}
          <div style={{ ...s.pcardPriceRow, ...(isCompactCard ? s.pcardPriceRowCompact : {}) }}>
            <span style={{ ...s.pcardPrice, ...(isCompactCard ? s.pcardPriceCompact : {}) }}>{formatMoney(p.sellPrice, currencyCode)}</span>
            {inCart > 0 && (
              <span style={{ fontSize: isCompactCard ? 11 : 12, fontWeight: 700, color: '#fff', background: ACCENT, borderRadius: 10, padding: isCompactCard ? '0 6px' : '1px 7px' }}>
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
  const money = (value: number) => formatMoney(value, currencyCode)
  const khqrSupported = isKhqrSupportedCurrency(currencyCode)
  const desktopPaymentMethods = DESKTOP_PAYMENT_METHODS.filter((method) => method !== 'KHQR' || khqrSupported)
  const initialDesktopPaymentMethod = desktopPaymentMethods.includes(DEFAULT_DESKTOP_PAYMENT_METHOD)
    ? DEFAULT_DESKTOP_PAYMENT_METHOD
    : desktopPaymentMethods[0] ?? 'CASH'
  const mobilePaymentMethods = (['CASH','KHQR','MEMBER_BALANCE','OTHER'] as const).filter((method) => method !== 'KHQR' || khqrSupported)
  const cashReceivedAmount = cashTendered.trim() === '' ? NaN : Number(cashTendered)
  const hasCashReceivedAmount = Number.isFinite(cashReceivedAmount)
  const cashChangeAmount = hasCashReceivedAmount ? Math.max(0, cashReceivedAmount - total) : 0
  const isCashPaymentSelected = isDesktopPos && checkoutStep === 'SELECT_PAYMENT' && desktopSelectedPaymentMethod === 'CASH'
  const isCashReceivedInsufficient = isCashPaymentSelected && (!hasCashReceivedAmount || cashReceivedAmount + 0.0001 < total)
  const desktopKhrAssist = (amount: number) => {
    if (!isDesktopPos || amount <= 0) return null
    return <div style={s.khrAssist}>≈ {toKhr(amount, usdKhrRate)}</div>
  }

  function selectDesktopPaymentMethod(method: Exclude<DesktopPaymentMethod, null>) {
    setDesktopSelectedPaymentMethod(method)
    if (method === 'KHQR') {
      syncCurrentCartToCustomerDisplay('KHQR', { focusKhqr: true })
      return
    }
    syncCurrentCartToCustomerDisplay(method)
  }

  function openDesktopPaymentSelection() {
    if (!isDesktopPos || cart.length === 0 || total <= 0) return
    setSubmitError('')
    if (isUsbCustomerDisplayEventSource && storeCode) {
      dispatchCashierCartTotalChanged({
        storeCode,
        totalAmount: cartTotal(cart),
        itemCount: cartCount(cart),
        updatedAt: new Date().toISOString(),
        reason: 'final',
      })
      publishCustomerDisplayRealtimeSnapshot({
        reason: 'final',
        cartSnapshot: cart,
        paymentMethod: initialDesktopPaymentMethod === 'KHQR' ? 'KHQR' : initialDesktopPaymentMethod === 'CASH' ? 'CASH' : null,
        paymentStatus: initialDesktopPaymentMethod === 'KHQR' ? 'PENDING' : null,
        status: initialDesktopPaymentMethod === 'KHQR' ? 'AWAITING_PAYMENT' : 'DRAFT',
      })
    }
    selectDesktopPaymentMethod(initialDesktopPaymentMethod)
    setCheckoutStep('SELECT_PAYMENT')
  }

  function closeDesktopPaymentSelection() {
    setDesktopSelectedPaymentMethod(null)
    setSubmitError('')
    syncCurrentCartToCustomerDisplay('CASH')
    setCheckoutStep('SELECT_ITEMS')
    focusScannerInput()
  }

  function moveDesktopPaymentSelection(delta: -1 | 1) {
    const currentIndex = desktopPaymentMethods.indexOf(desktopSelectedPaymentMethod ?? initialDesktopPaymentMethod)
    const safeIndex = currentIndex >= 0 ? currentIndex : 0
    const nextIndex = (safeIndex + delta + desktopPaymentMethods.length) % desktopPaymentMethods.length
    const nextMethod = desktopPaymentMethods[nextIndex]
    if (!nextMethod) return
    selectDesktopPaymentMethod(nextMethod)
  }

  function confirmDesktopPaymentSelection() {
    if (!desktopSelectedPaymentMethod || submitting) return
    if (desktopSelectedPaymentMethod === 'CASH' && isCashReceivedInsufficient) {
      showToast(d.insufficientCashInput)
      return
    }
    void handleSubmit(desktopSelectedPaymentMethod)
  }

  function desktopPaymentDisplayLabel(method: Exclude<DesktopPaymentMethod, null>) {
    if (method === 'CASH') return lang === 'en' ? 'Cash' : lang === 'km' ? 'សាច់ប្រាក់' : '现金收款 CASH'
    if (method === 'KHQR') return 'KHQR'
    return lang === 'en' ? 'Member balance' : lang === 'km' ? 'សមតុល្យសមាជិក' : '会员余额'
  }

  useEffect(() => {
    if (!isDesktopPos) return
    function onDesktopPaymentKey(e: KeyboardEvent) {
      if (isEditableShortcutTarget(document.activeElement)) return
      if (saleResult || receiptPreviewOpen || sugarModal || holdNoteOpen || memberPayOpen || shiftReportOpen || shiftCloseConfirmOpen || dayCloseOpen || desktopRecordsOpen) return

      if (checkoutStep === 'SELECT_PAYMENT') {
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          moveDesktopPaymentSelection(-1)
          return
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault()
          moveDesktopPaymentSelection(1)
          return
        }
        if (e.key === 'Enter') {
          if (e.repeat) return
          e.preventDefault()
          confirmDesktopPaymentSelection()
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          closeDesktopPaymentSelection()
        }
        return
      }

      if (e.key === 'Enter' && cart.length > 0 && total > 0) {
        if (e.repeat) return
        e.preventDefault()
        openDesktopPaymentSelection()
      }
    }
    window.addEventListener('keydown', onDesktopPaymentKey)
    return () => window.removeEventListener('keydown', onDesktopPaymentKey)
  }, [
    isDesktopPos,
    isEditableShortcutTarget,
    saleResult,
    receiptPreviewOpen,
    sugarModal,
    holdNoteOpen,
    memberPayOpen,
    shiftReportOpen,
    shiftCloseConfirmOpen,
    dayCloseOpen,
    desktopRecordsOpen,
    checkoutStep,
    cart,
    total,
    desktopSelectedPaymentMethod,
    submitting,
    isCashReceivedInsufficient,
    d,
  ])

  const cacheText =
    cacheStatus === 'saving' ? d.cacheSaving :
    cacheStatus === 'ready' && cacheMeta ? d.cacheReady(cacheMeta.productCount, fmtCacheTime(cacheMeta.lastProductCacheAt)) :
    cacheStatus === 'empty' ? d.cacheEmpty :
    cacheStatus === 'failed' ? (cacheError || d.cacheFailed) :
    (lang === 'en' ? 'Cache: not cached yet' : lang === 'km' ? 'Cache: មិនទាន់មានទេ' : '商品缓存：未缓存')
  const canOfflineCashier = !isOnline && productsSource === 'cache' && products.length > 0 && !!cacheMeta
  const offlineHint = !isOnline
    ? canOfflineCashier
      ? d.offlineHintOnline
      : d.offlineHintOffline
    : ''
  function handleSearchChange(value: string) {
    setSearchKw(value.replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, ''))
  }

  function handleClearSearch() {
    setSearchKw('')
    focusSearchInput()
  }

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

  if (storeCode && !posDeviceToken && posAccountAccess !== 'authorized') {
    const currentReturnUrl = typeof window !== 'undefined'
      ? `${window.location.pathname}${window.location.search}`
      : `/cashier?storeCode=${encodeURIComponent(storeCode)}`
    const loginUrl = `/relogin?returnUrl=${encodeURIComponent(currentReturnUrl)}`
    const legacyDeviceAuth = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('deviceAuth') === '1'

    if (!legacyDeviceAuth) {
      const isCheckingAccess = posAccountAccess === 'checking'
      const title =
        isCheckingAccess ? '正在检查收银权限' :
        posAccountAccess === 'login_required' ? '请先登录本店账号' :
        '当前账号无权进入本店收银台'
      const sub =
        isCheckingAccess ? '正在确认你是否已使用本店老板或员工账号登录，请稍候。' :
        posAccountAccess === 'login_required'
          ? '请使用该门店老板或员工账号登录后，再打开这条电脑收银台链接。'
          : '请确认当前登录账号属于这家门店，或让老板重新分享正确的收银台链接。'
      return (
        <main style={s.authPage}>
          <section style={s.authIntro}>
            <div style={s.authBadge}>电脑收银台</div>
            <h1 style={s.authTitle}>{title}</h1>
            <div style={s.authSub}>{sub}</div>
            <div style={s.authWarn}>
              只有本店 OWNER 或 STAFF 可以进入收银台。无法进入时，请确认你已使用该门店老板或员工账号登录。
            </div>
          </section>

          <section style={s.authCard}>
            <div style={s.authCardTitle}>{storeName || storeCode}</div>
            <div style={s.authCardSub}>{posAccountAccessMessage || '请先完成登录或切换到本店账号。'}</div>
            <div style={s.authActions}>
              <a href={loginUrl} style={{ ...s.authBtn, textDecoration: 'none', textAlign: 'center' }}>
                打开登录
              </a>
              <button
                type="button"
                style={{ ...s.authBtn, ...s.authBtnSecondary }}
                onClick={() => window.location.reload()}
                disabled={isCheckingAccess}
              >
                重新检查
              </button>
            </div>
            <div style={{ ...s.authCardSub, marginTop: 12 }}>
              如果登录后没有自动回到收银台，请重新打开老板分享的电脑收银台链接。
            </div>
          </section>
          {toast && <div style={s.toast}>{toast}</div>}
        </main>
      )
    }

    const authUrl = posAuthChallenge?.authorizeUrl ?? ''
    return (
      <main style={s.authPage}>
        <section style={s.authIntro}>
          <div style={s.authBadge}>电脑收银机授权</div>
          <h1 style={s.authTitle}>本机尚未授权为收银机</h1>
          <div style={s.authSub}>
            请老板用手机扫码确认一次。授权成功后，这台电脑以后打开就能进入收银台。
          </div>
          <div style={s.authWarn}>
            未授权前可以查看此授权页；未授权订单不会同步到账本。清除浏览器缓存或换电脑后，需要重新扫码授权。
          </div>
        </section>

        <section style={s.authCard}>
          <div style={s.authCardTitle}>{storeName || posAuthChallenge?.storeName || storeCode}</div>
          <div style={s.authCardSub}>老板扫码后，在手机上点击“确认授权”。</div>
          <div style={s.authQrBox}>
            {authUrl ? (
              <QRCode value={authUrl} size={220} />
            ) : (
              <div style={s.authCardSub}>正在生成授权二维码...</div>
            )}
          </div>
          {authUrl && <a href={authUrl} target="_blank" rel="noreferrer" style={s.authLink}>{authUrl}</a>}
          <div style={s.authActions}>
            <button
              type="button"
              style={{ ...s.authBtn, ...s.authBtnSecondary }}
              onClick={() => void startPosAuthorization()}
              disabled={posAuthLoading}
            >
              {posAuthLoading ? '刷新中...' : '刷新二维码'}
            </button>
            <button
              type="button"
              style={s.authBtn}
              onClick={() => void checkPosAuthorization({ toast: true })}
              disabled={!posAuthChallenge || posAuthChecking}
            >
              {posAuthChecking ? '检查中...' : '我已授权，重新检查'}
            </button>
          </div>
          {authUrl && (
            <button
              type="button"
              style={{ ...s.authBtn, ...s.authBtnSecondary, width: '100%', marginTop: 10 }}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(authUrl)
                  showToast('授权链接已复制')
                } catch {
                  showToast('复制失败，请手动复制页面中的授权链接')
                }
              }}
            >
              复制授权链接
            </button>
          )}
          {posAuthError && <div style={s.authError}>{posAuthError}</div>}
        </section>
        {toast && <div style={s.toast}>{toast}</div>}
      </main>
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

      {holdNoteOpen && holdNoteCart && (
        <div style={s.holdNoteMask} onClick={handleCancelHoldCurrentOrder}>
          <div style={s.holdNoteModal} onClick={e => e.stopPropagation()}>
            <div style={s.holdNoteTitle}>{lang === 'en' ? 'Hold order note' : lang === 'km' ? 'កំណត់សម្គាល់ការផ្អាក' : '挂单备注'}</div>
            <div style={s.holdNoteSub}>{lang === 'en' ? 'Optional, up to 8 characters. Confirm to save this hold order.' : lang === 'km' ? 'ស្រេចចិត្ត អក្សរបានត្រឹម 8 តួអក្សរ។ បញ្ជាក់ដើម្បីរក្សាទុកការផ្អាកនេះ។' : '可选，最多 8 个字符。确认后才会挂单。'}</div>
            <div style={s.holdNoteLabel}>{lang === 'en' ? 'Customer note' : lang === 'km' ? 'កំណត់សម្គាល់អតិថិជន' : '顾客备注'}</div>
            <input
              autoFocus
              value={holdNoteDraft}
              maxLength={8}
              onChange={(e) => setHoldNoteDraft(e.target.value.slice(0, 8))}
              placeholder={lang === 'en' ? 'Optional note' : lang === 'km' ? 'កំណត់សម្គាល់ស្រេចចិត្ត' : '可选备注'}
              style={s.holdNoteInput}
            />
            <div style={s.holdNoteCount}>{holdNoteDraft.trim().length}/8</div>
            <div style={s.holdNoteActions}>
              <button type="button" style={s.secondaryBtn} onClick={handleCancelHoldCurrentOrder}>
                {lang === 'en' ? 'Cancel' : lang === 'km' ? 'បោះបង់' : '取消'}
              </button>
              <button type="button" style={s.modalBtn} onClick={handleConfirmHoldCurrentOrder}>
                {lang === 'en' ? 'Save hold' : lang === 'km' ? 'រក្សាទុក' : '确认挂单'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ─────────────────────────────────────────────────────────── */}
      {toast && <div style={s.toast}>{toast}</div>}
      {isDesktopPos && DEBUG_SCANNER && (
        <div style={s.scannerDebugPanel}>
          <div style={s.scannerDebugTitle}>Scanner Debug</div>
          {[
            ['Mounted', scannerDebug.mounted ? 'YES' : 'NO'],
            ['Active', scannerDebug.isActive ? 'YES' : 'NO'],
            ['CurrentActiveElement', scannerDebug.activeElement || '-'],
            ['Raw', scannerDebug.rawValue || '-'],
            ['Barcode', scannerDebug.barcode || '-'],
            ['MatchCount', scannerDebug.matchCount === null ? '-' : String(scannerDebug.matchCount)],
            ['addToCart', scannerDebug.addToCartCalled ? 'YES' : 'NO'],
            ['Error', scannerDebug.lastError || '-'],
          ].map(([label, value]) => (
            <div key={label} style={s.scannerDebugRow}>
              <span style={s.scannerDebugLabel}>{label}</span>
              <span style={s.scannerDebugValue} title={value}>{value}</span>
            </div>
          ))}
          <button
            type="button"
            style={s.scannerDebugBtn}
            onClick={focusScannerInput}
          >
            重新聚焦扫码器
          </button>
        </div>
      )}

      {/* ── Main 3-column layout ──────────────────────────────────────────── */}
      <div style={{ ...s.root, ...(isDesktopPos ? s.desktopRoot : {}) }}>
        {isDesktopPos && (
          <input
            ref={scannerInputRef}
            type="text"
            aria-label="Scanner input"
            autoComplete="off"
            autoCapitalize="off"
            inputMode="text"
            spellCheck={false}
            tabIndex={0}
            style={s.scannerInput}
            onFocus={() => setScannerDebug(prev => ({ ...prev, mounted: true, isActive: true, activeElement: 'ScannerInput' }))}
            onBlur={() => updateScannerDebugFocusState()}
            onInput={(e) => scheduleScannerInputCompletion(e.currentTarget.value)}
          />
        )}

        {/* LEFT SIDEBAR */}
        <div style={s.sidebar}>
          <div style={s.sideHead}>
            <div style={s.sideTitle}>🏪 {d.sideTitle}</div>
            <div style={s.sideStore}>{storeName || d.storeLoading}</div>
            <div style={s.langSwitch} aria-label="Desktop POS language switch">
              {([
                ['zh', '中'],
                ['en', 'EN'],
                ['km', 'ខ្មែរ'],
              ] as const).map(([code, label]) => (
                <button
                  key={code}
                  type="button"
                  style={{ ...s.langBtn, ...(lang === code ? s.langBtnOn : {}) }}
                  onClick={() => handleDesktopLangChange(code)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div style={s.kioskActions}>
              <button
                type="button"
                style={{ ...s.kioskBtn, gridColumn: '1 / -1', ...(!storeCode ? { opacity: 0.45, cursor: 'not-allowed' } : {}) }}
                disabled={!storeCode}
                onClick={handleOpenCustomerDisplay}
              >
                {d.openCustomerDisplay}
              </button>
              <button type="button" style={s.kioskBtn} onClick={handleInstallClick}>
                {isStandalone ? d.desktopMode : d.installDesktop}
              </button>
              <button type="button" style={s.kioskBtn} onClick={handleFullscreenClick}>
                {isFullscreen ? d.exitFullscreen : d.enterFullscreen}
              </button>
            </div>
            <div style={s.kioskHint}>
              {storeCode ? d.rememberedStore : d.promptStore}
            </div>
            <div style={s.offlineStatusCard}>
              <div style={s.offlineStatusLine}>
                <span>{d.networkStatus}</span>
                <span
                  style={{
                    ...s.statusPill,
                    background: isOnline ? 'rgba(22,163,74,.18)' : 'rgba(245,158,11,.2)',
                    color: isOnline ? '#86efac' : '#fde68a',
                  }}
                >
                  {isOnline ? d.online : d.offline}
                </span>
              </div>
              <div>{cacheText}</div>
              <div>{d.pendingOffline(offlinePendingCount)}</div>
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
                  {offlineSyncing ? d.syncingOffline : isOnline ? d.syncOffline : d.syncAfterOnline}
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
              {d.allProducts}
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
                <div style={{ ...s.sideSection, ...s.sideGroupCashier }}>
                  <div style={{ ...s.sideSectionTitle, color: '#93c5fd' }}>{d.sectionCashier}</div>
                  <div style={s.sideSectionBody}>
                    <div style={s.holdCard}>
                      <div style={s.holdHead}>
                        <span style={s.holdTitle}>{d.serverPendingTitle}</span>
                        <span style={s.holdCount}>{serverPendingOrders.length} 单</span>
                      </div>
                      <div style={{ ...s.holdSub, marginBottom: 6 }}>{d.serverPendingHint}</div>
                      {serverPendingOrders.length > 0 ? (
                        <div style={s.holdList}>
                          {serverPendingOrders.map(order => {
                            const heldLabel = holdOrderLabel(lang as DeskLang, order.createdAt, undefined, order.totalAmount)
                            return (
                              <div key={order.orderNo} style={s.holdItem}>
                                <div style={s.holdMeta}>
                                  <span>{shortNo(order.orderNo)}</span>
                                  <span>{heldLabel.time}</span>
                                  <span>{heldLabel.total}</span>
                                </div>
                                <div style={s.holdSub}>
                                  {order.itemCount} 件 · {d.recordPendingPayment}
                                </div>
                                <div style={s.holdActions}>
                                  <button type="button" style={s.holdRestoreBtn} onClick={() => setViewPendingOrder(order)}>
                                    {d.serverPendingView}
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <div style={s.holdEmpty}>{d.serverPendingEmpty}</div>
                      )}
                    </div>
                    <div style={s.holdCard}>
                      <div style={s.holdHead}>
                        <span style={s.holdTitle}>{d.holdTitle}</span>
                        <span style={s.holdCount}>{holdOrders.length} 单</span>
                      </div>
                      {cart.length > 0 && (
                        <button type="button" style={s.holdBtn} onClick={handleHoldCurrentOrder}>
                          {d.holdButton}
                        </button>
                      )}
                      {holdOrders.length > 0 ? (
                        <div style={s.holdList}>
                          {holdOrders.map(order => {
                            const heldCount = cartCount(order.cart)
                            const heldTotal = cartTotal(order.cart)
                            const heldLabel = holdOrderLabel(lang as DeskLang, order.createdAt, order.note, heldTotal)
                            return (
                              <div key={order.id} style={s.holdItem}>
                                <div style={s.holdMeta}>
                                  <span>{heldLabel.time}</span>
                                  {heldLabel.note && <span>{heldLabel.note}</span>}
                                  <span>{heldLabel.total}</span>
                                </div>
                                <div style={s.holdSub}>
                                  {heldCount} 件 · {order.checkoutStep === 'SELECT_PAYMENT' ? (lang === 'en' ? 'Waiting payment' : lang === 'km' ? 'រង់ចាំទូទាត់' : '待收款') : order.checkoutStep === 'CONFIRM_ORDER' ? (lang === 'en' ? 'Waiting confirm' : lang === 'km' ? 'រង់ចាំបញ្ជាក់' : '待确认') : (lang === 'en' ? 'Selecting items' : lang === 'km' ? 'កំពុងជ្រើសទំនិញ' : '选品中')}
                                </div>
                                <div style={s.holdActions}>
                                  <button type="button" style={s.holdRestoreBtn} onClick={() => handleRestoreHoldOrder(order)}>
                                    {lang === 'en' ? 'Restore' : lang === 'km' ? 'យកត្រឡប់' : '恢复'}
                                  </button>
                                  <button type="button" style={s.holdDeleteBtn} onClick={() => handleDeleteHoldOrder(order.id)}>
                                    {lang === 'en' ? 'Delete' : lang === 'km' ? 'លុប' : '删除'}
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <div style={s.holdEmpty}>{d.holdEmpty}</div>
                      )}
                    </div>
                    <button
                      style={{ ...s.sidePrimaryBtn, marginTop: 2 }}
                      onClick={handleOpenDesktopRecords}
                    >
                      {d.desktopRecordsBtn}
                    </button>
                  </div>
                </div>
                <div style={s.sideDivider} />
                <div style={{ ...s.sideSection, ...s.sideGroupOps }}>
                  <div style={{ ...s.sideSectionTitle, color: '#86efac' }}>{d.sectionOps}</div>
                  <div style={s.sideSectionBody}>
                    <div style={s.shiftCard}>
                      <div style={s.shiftStart}>{d.shiftStart(shiftStartIso ? fmtTime(shiftStartIso) : '--:--')}</div>
                      <button type="button" style={s.sidePrimaryBtn} onClick={handleOpenShiftReport}>
                        {d.shiftReportBtn}
                      </button>
                      <button type="button" style={s.sideMutedBtn} onClick={handleOpenDayCloseReport}>
                        {d.dayCloseBtn}
                      </button>
                    </div>
                  </div>
                </div>
                {khqrSupported && (
                  <>
                    <div style={s.sideDivider} />
                    <div style={{ ...s.sideSection, ...s.sideGroupStore }}>
                      <div style={{ ...s.sideSectionTitle, color: '#fcd34d' }}>{d.sectionStore}</div>
                      <div style={s.sideSectionBody}>
                        <div style={s.fxCard}>
                          <span style={s.fxLabel}>$1 = {usdKhrRate.toLocaleString('en-US')}{KHR_SYMBOL}</span>
                          <button type="button" style={s.fxBtn} onClick={handleUsdKhrRateApply}>
                            {lang === 'en' ? 'Edit' : lang === 'km' ? 'កែប្រែ' : '修改'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </>
                )}
                <div style={s.sideDivider} />
                <div style={{ ...s.sideSection, ...s.sideGroupSettings }}>
                  <div style={{ ...s.sideSectionTitle, color: '#cbd5e1' }}>{d.sectionSettings}</div>
                  <div style={s.sideSectionBody}>
                    <div style={s.autoPrintToggle}>
                      <div style={s.autoPrintText}>
                        <span style={s.autoPrintTitle}>{d.autoPrintTitle}</span>
                        <span style={s.autoPrintSub}>{autoPrint ? d.autoPrintOn : d.autoPrintOff}</span>
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
                    <div style={{ ...s.autoPrintToggle, marginTop: 8 }}>
                      <div style={s.autoPrintText}>
                        <span style={s.autoPrintTitle}>
                          {lang === 'en' ? 'QZ Tray print (POC)' : lang === 'km' ? 'បោះពុម្ព QZ Tray (សាកល្បង)' : 'QZ Tray 打印（POC）'}
                        </span>
                        <span style={s.autoPrintSub}>
                          {qzStatus === 'online'
                            ? (lang === 'en' ? 'Online' : lang === 'km' ? 'អនឡាញ' : '在线')
                            : qzStatus === 'checking'
                              ? (lang === 'en' ? 'Checking…' : lang === 'km' ? 'កំពុងពិនិត្យ…' : '检测中…')
                              : (lang === 'en' ? 'Offline / not checked' : lang === 'km' ? 'គ្មានអនឡាញ' : '离线/未检测')}
                        </span>
                      </div>
                      <button
                        type="button"
                        aria-pressed={qzPrintEnabled}
                        aria-label="QZ Tray 打印"
                        style={{ ...s.autoPrintSwitch, background: qzPrintEnabled ? '#2563eb' : 'rgba(148,163,184,.45)' }}
                        onClick={handleQzPrintToggle}
                      >
                        <span style={{ ...s.autoPrintKnob, left: qzPrintEnabled ? 21 : 3 }} />
                      </button>
                    </div>
                    {qzPrintEnabled && (
                      <div style={s.qzPanel}>
                        <select
                          value={qzSelectedPrinter ?? ''}
                          onChange={(event) => handleSelectQzPrinter(event.target.value)}
                          style={s.qzSelect}
                        >
                          <option value="">
                            {lang === 'en' ? 'Select a printer' : lang === 'km' ? 'ជ្រើសរើសម៉ាស៊ីនបោះពុម្ព' : '选择打印机'}
                          </option>
                          {qzPrinters.map((printerName) => (
                            <option key={printerName} value={printerName}>{printerName}</option>
                          ))}
                        </select>
                        <div style={s.qzButtonRow}>
                          <button type="button" style={s.sideMutedBtn} onClick={() => void handleRefreshQzStatus()} disabled={qzChecking}>
                            {lang === 'en' ? 'Refresh' : lang === 'km' ? 'ធ្វើឱ្យស្រស់' : '刷新状态'}
                          </button>
                          <button type="button" style={s.sideMutedBtn} onClick={() => void handleQzHelloWorldTest()} disabled={!qzSelectedPrinter}>
                            {lang === 'en' ? 'Hello World test' : lang === 'km' ? 'សាកល្បង Hello World' : 'Hello World 测试'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* MIDDLE: product grid */}
        <div style={s.mid}>
          <div style={s.topbar}>
            <div style={s.searchWrap}>
              <input
                ref={searchRef}
                style={s.search}
                placeholder={d.searchPlaceholder}
                value={searchKw}
                onChange={e => handleSearchChange(e.target.value)}
                onBlur={() => setSearchKw(cleanSearchText(searchKw))}
              />
              {searchKw.length > 0 && (
                <button
                  type="button"
                  aria-label="清空搜索"
                  title="清空搜索"
                  style={s.searchClear}
                  onClick={handleClearSearch}
                >
                  ×
                </button>
              )}
            </div>
            {isDesktopPos && (
              <button type="button" style={s.topbarActionBtn} onClick={handleCompactModeToggle}>
                {compactMode ? d.compactModeBig : d.compactModeCompact}
              </button>
            )}
          </div>
          <div style={{ ...s.grid, ...(isDesktopPos ? (compactMode ? s.desktopGridCompact : s.desktopGrid) : {}) }}>
            {loading && (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', color: '#9ca3af', padding: 40, fontSize: 14 }}>{d.loadProducts}</div>
            )}
            {!loading && displayProducts.length === 0 && (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', color: '#9ca3af', padding: 40, fontSize: 14 }}>
                {d.noProductsForFilter(kw)}
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
              <span style={s.ordHeadTitle}>{d.pendingOrdersTitle}</span>
              {pendingOrders.length > 0
                ? <span style={s.ordBadge}>{pendingOrders.length}</span>
                : <span style={{ fontSize: 11, color: '#9ca3af' }}>{d.pendingOrdersNone}</span>
              }
            </div>
            <div style={s.ordList}>
              {pendingOrders.length === 0 ? (
                <div style={s.ordEmpty}>{d.pendingOrdersEmpty}</div>
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
                        {isPending ? (lang === 'en' ? 'Pending' : lang === 'km' ? 'រង់ចាំបញ្ជាក់' : '待确认') : (lang === 'en' ? 'Confirmed' : lang === 'km' ? 'បានបញ្ជាក់' : '已确认')}
                      </span>
                      <span style={s.ocTime}>{fmtTime(order.createdAt)}</span>
                    </div>
                    <div style={s.ocMeta}>
                      {order.tableNo ? `🪑 ${d.tableNo} ${order.tableNo}` : `🛍 ${d.pickup}`}
                    </div>
                    <div style={s.ocItems}>{itemsSummary}</div>
                    <div style={s.ocFoot}>
                      <span style={s.ocTotal}>{money(order.totalAmount)}</span>
                      {isPending && (
                        <button
                          style={{ ...s.ocBtn, background: ACCENT, color: '#fff', opacity: isUpdating ? 0.5 : 1 }}
                          disabled={isUpdating}
                          onClick={() => handleOrderAction(order.id, 'CONFIRMED')}
                        >
                          {lang === 'en' ? '✓ Confirm' : lang === 'km' ? '✓ បញ្ជាក់' : '✓ 确认'}
                        </button>
                      )}
                      {!isPending && (
                        <button
                          style={{ ...s.ocBtn, background: '#10b981', color: '#fff', opacity: isUpdating ? 0.5 : 1 }}
                          disabled={isUpdating}
                          onClick={() => handleOrderAction(order.id, 'COMPLETED')}
                        >
                          {lang === 'en' ? '✓ Done' : lang === 'km' ? '✓ រួចរាល់' : '✓ 完成'}
                        </button>
                      )}
                      <button
                        style={{ ...s.ocBtn, background: '#f1f5f9', color: '#9ca3af', border: '1px solid #e5e7eb', opacity: isUpdating ? 0.5 : 1 }}
                        disabled={isUpdating}
                        onClick={() => handleOrderAction(order.id, 'CANCELLED')}
                      >
                        {lang === 'en' ? 'Cancel' : lang === 'km' ? 'បោះបង់' : '取消'}
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
                {d.cartTitle}
                {count > 0 && <span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 400, marginLeft: 6 }}>{`(${count} ${lang === 'en' ? 'items' : lang === 'km' ? 'មុខ' : '件'})`}</span>}
              </span>
              {cart.length > 0 && <button style={s.cartClear} onClick={() => { setCart([]); focusScannerInput() }}>{d.cartClear}</button>}
            </div>
            <div style={s.cartList}>
              {cart.length === 0 ? (
                <div style={s.cartEmpty}>{d.cartEmpty}</div>
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
                    <span style={s.clineAmt}>{money(line.price * line.qty)}</span>
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
                    <div style={s.confirmTitle}>{d.confirmTitle}</div>
                    <div style={s.confirmSub}>{d.confirmSub}</div>
                  </div>
                  <div style={s.confirmList}>
                    {cart.map((line, index) => {
                      const specDisplay = [line.spec, line.sugar ? sugarZh(line.sugar) : null].filter(Boolean).join(' / ')
                      return (
                        <div key={cartLineKey(line)} style={{ ...s.confirmLine, ...(index === cart.length - 1 ? s.confirmLineLast : {}) }}>
                          <span style={s.confirmName}>{line.name}{specDisplay ? ` · ${specDisplay}` : ''} × {line.qty}</span>
                          <span style={s.confirmAmt}>{money(line.price * line.qty)}</span>
                        </div>
                      )
                    })}
                  </div>
                  <div style={s.totalRow}>
                    <span style={s.totalLbl}>{lang === 'en' ? `Items ${count} · Payable` : lang === 'km' ? `មុខ ${count} · ត្រូវបង់` : `共 ${count} 件 · 应付`}</span>
                    <span style={s.totalAmt}>{money(total)}</span>
                  </div>
                  {khqrSupported && desktopKhrAssist(total)}
                  <div style={s.confirmActions}>
                    <button type="button" style={s.secondaryBtn} onClick={() => setCheckoutStep('SELECT_ITEMS')}>
                      {d.returnModify}
                    </button>
                    <button
                      type="button"
                      style={s.submitBtn}
                      onClick={openDesktopPaymentSelection}
                    >
                      {d.confirmToPay}
                    </button>
                  </div>
                  <div style={s.printHint}>{lang === 'en' ? 'This step only enters checkout. No SaleRecord is created.' : lang === 'km' ? 'ជំហាននេះគ្រាន់តែចូល checkout ប៉ុណ្ណោះ។ មិនបង្កើត SaleRecord ទេ។' : '本轮仅进入结账占位，不创建 SaleRecord。'}</div>
                </div>
              ) : checkoutStep === 'SELECT_PAYMENT' ? (
                <div style={{ ...s.confirmPanel, ...s.desktopSelectPanel }}>
                  <div style={s.desktopSelectScroll}>
                    <div>
                      <div style={s.confirmTitle}>{d.selectPayTitle}</div>
                      <div style={s.confirmSub}>{d.selectPaySub}</div>
                    </div>
                    <div style={s.totalRow}>
                      <span style={s.totalLbl}>{lang === 'en' ? `Items ${count} · Payable` : lang === 'km' ? `មុខ ${count} · ត្រូវបង់` : `共 ${count} 件 · 应付`}</span>
                      <span style={s.totalAmt}>{money(total)}</span>
                    </div>
                    {khqrSupported && desktopKhrAssist(total)}
                    {desktopSelectedPaymentMethod === 'CASH' && (
                      <div style={s.cashReceivedBox}>
                        <label style={s.cashReceivedLabel} htmlFor="desktop-cash-tendered">
                          {d.cashTenderedLabel}
                        </label>
                        <input
                          id="desktop-cash-tendered"
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          value={cashTendered}
                          onChange={e => setCashTendered(e.target.value)}
                          placeholder={d.cashTenderedPlaceholder}
                          style={{
                            ...s.cashReceivedInput,
                            borderColor: isCashReceivedInsufficient ? '#fca5a5' : '#cbd5e1',
                          }}
                        />
                        <div style={s.cashChangeRow}>
                          <span>{d.changeLabel}</span>
                          <div style={s.cashChangeAmtBox}>
                            <div style={s.cashChangeAmt}>{money(cashChangeAmount)}</div>
                            {khqrSupported && !isCashReceivedInsufficient && cashChangeAmount > 0 && (
                              <div style={s.cashChangeKhr}>≈ {toKhr(cashChangeAmount, usdKhrRate)}</div>
                            )}
                          </div>
                        </div>
                        {isCashReceivedInsufficient && (
                          <div style={s.cashWarn}>
                            {hasCashReceivedAmount
                              ? d.insufficientCash(money(total - cashReceivedAmount))
                              : d.insufficientCashInput}
                          </div>
                        )}
                      </div>
                    )}
                    <div style={s.desktopPayGrid}>
                      {desktopPaymentMethods.map((method) => {
                        const selected = desktopSelectedPaymentMethod === method
                        const title =
                          method === 'CASH' ? d.cashPayTitle :
                          method === 'KHQR' ? d.khqrPayTitle :
                          d.memberPayTitle
                        const sub =
                          method === 'CASH' ? d.cashPaySub :
                          method === 'KHQR' ? d.khqrPaySub :
                          d.memberPayHint
                        return (
                          <button
                            key={method}
                            type="button"
                            aria-pressed={selected}
                            style={{ ...s.desktopPayOption, ...(selected ? s.desktopPayOptionOn : {}) }}
                            onClick={() => selectDesktopPaymentMethod(method)}
                          >
                            <span style={s.desktopPayMain}>{title}</span>
                            <span style={s.desktopPaySub}>{sub}</span>
                          </button>
                        )
                      })}
                    </div>
                    <div style={{ ...s.printHint, marginTop: 0 }}>
                      ← → 选择付款方式 · Enter 确认 · Esc 返回
                    </div>
                  </div>
                  <div style={s.desktopPayStickyActions}>
                    {desktopSelectedPaymentMethod && (
                      <div style={s.nextStepBox}>
                        {d.currentFinalPayment(desktopPaymentDisplayLabel(desktopSelectedPaymentMethod))}
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
                      onClick={confirmDesktopPaymentSelection}
                    >
                      {submitting
                        ? (lang === 'en' ? 'Processing…' : lang === 'km' ? 'កំពុងដំណើរការ…' : '处理中…')
                        : desktopSelectedPaymentMethod === 'KHQR'
                          ? d.confirmKhqrReceived
                          : desktopSelectedPaymentMethod === 'CASH'
                            ? d.confirmCashReceived
                            : d.memberPayTitle}
                    </button>
                    <div style={{ ...s.totalRow, marginBottom: 0 }}>
                      <span style={s.totalLbl}>{lang === 'en' ? 'Item types' : lang === 'km' ? 'ប្រភេទទំនិញ' : '商品种类'}</span>
                      <span style={s.confirmAmt}>{d.goodsCount(cart.length)}</span>
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
                        {d.backToConfirm}
                      </button>
                      <button
                        type="button"
                        style={s.secondaryBtn}
                        onClick={closeDesktopPaymentSelection}
                      >
                        {d.backToModifyGoods}
                      </button>
                    </div>
                    <div style={{ ...s.printHint, marginTop: 0 }}>{d.paymentHint}</div>
                  </div>
                </div>
              ) : (
                <>
                  <div style={s.payLabel}>{lang === 'en' ? 'Current order' : lang === 'km' ? 'បញ្ជាទិញបច្ចុប្បន្ន' : '本单'}</div>
                  <div style={s.totalRow}>
                    <span style={s.totalLbl}>{lang === 'en' ? `Total ${count} items` : lang === 'km' ? `សរុប ${count} មុខ` : `合计 ${count} 件`}</span>
                    <span style={s.totalAmt}>{money(total)}</span>
                  </div>
                  {khqrSupported && desktopKhrAssist(total)}
                  <button
                    style={{ ...s.submitBtn, ...(cart.length === 0 ? s.submitDis : {}) }}
                    disabled={cart.length === 0}
                    onClick={() => {
                      if (cart.length === 0) return
                      setCheckoutStep('CONFIRM_ORDER')
                    }}
                  >
                    {lang === 'en' ? '✓ Confirm order' : lang === 'km' ? '✓ បញ្ជាក់បញ្ជាទិញ' : '✓ 确认本单'}
                  </button>
                  <div style={s.printHint}>{lang === 'en' ? 'Choose payment method after confirming the order. No sale will be completed yet.' : lang === 'km' ? 'បន្ទាប់ពីបញ្ជាក់បញ្ជាទិញសូមជ្រើសរបៀបទូទាត់។ មិនទាន់បញ្ចប់លក់នៅឡើយ។' : '确认后再选择收款方式 · 当前不会直接完成销售'}</div>
                </>
              )
            ) : (
              <>
                <div style={s.payLabel}>{lang === 'en' ? 'Payment method' : lang === 'km' ? 'របៀបទូទាត់' : '收款方式'}</div>
                <div style={s.payRow}>
                  {mobilePaymentMethods.map(m => {
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
                      {m === 'CASH'
                        ? (lang === 'en' ? 'Cash' : lang === 'km' ? 'សាច់ប្រាក់' : '💵 现金')
                        : m === 'KHQR'
                          ? (lang === 'en' ? 'KHQR' : lang === 'km' ? 'KHQR' : '📱 KHQR')
                          : m === 'MEMBER_BALANCE'
                            ? (lang === 'en' ? 'Member balance' : lang === 'km' ? 'សមតុល្យសមាជិក' : '👤 会员余额')
                            : (lang === 'en' ? 'Other' : lang === 'km' ? 'ផ្សេងៗ' : '🔧 其他')}
                    </button>
                  )})}
                </div>
                {!isOnline && (
                  <div style={{ fontSize: 11, color: '#92400e', background: '#fffbeb', borderRadius: 6, padding: '5px 8px', marginBottom: 8, lineHeight: 1.45 }}>
                    {lang === 'en'
                      ? 'Offline mode supports CASH only. This order stays on this device and will not appear in /records yet.'
                      : lang === 'km'
                        ? 'របៀប offline គាំទ្រ CASH ប៉ុណ្ណោះ។ បញ្ជាទិញនេះនឹងរក្សាទុកលើឧបករណ៍ ហើយមិនបង្ហាញក្នុង /records ទេ។'
                        : '离线模式仅支持 CASH，本单会保存到本机，暂不会出现在 /records。'}
                  </div>
                )}
                {payment === 'OTHER' && (
                  <div style={{ fontSize: 11, color: '#f59e0b', background: '#fffbeb', borderRadius: 6, padding: '4px 8px', marginBottom: 8 }}>
                    {lang === 'en' ? '"Other" will be recorded as cash.' : lang === 'km' ? '“ផ្សេងៗ” នឹងត្រូវកត់ត្រាជាសាច់ប្រាក់។' : '「其他」将以现金方式记录。'}
                  </div>
                )}
                {payment === 'MEMBER_BALANCE' && (
                  <div style={{ fontSize: 11, color: '#1d4ed8', background: '#eff6ff', borderRadius: 6, padding: '4px 8px', marginBottom: 8 }}>
                    {d.memberPayHint}
                  </div>
                )}
                <div style={s.totalRow}>
                  <span style={s.totalLbl}>{lang === 'en' ? 'Total' : lang === 'km' ? 'សរុប' : '合计'}</span>
                  <span style={s.totalAmt}>{money(total)}</span>
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
                  {submitting
                    ? (lang === 'en' ? 'Processing…' : lang === 'km' ? 'កំពុងដំណើរការ…' : '处理中…')
                    : payment === 'MEMBER_BALANCE'
                      ? d.memberPayTitle
                      : (lang === 'en' ? '✓ Complete sale' : lang === 'km' ? '✓ បញ្ចប់ការលក់' : '✓ 完成销售')}
                </button>
                <div style={s.printHint}>{lang === 'en' ? 'Printing is not connected yet. Use the mPOS phone app for receipts.' : lang === 'km' ? 'ការបោះពុម្ពមិនទាន់ភ្ជាប់នៅឡើយ។ សូមប្រើ mPOS លើទូរស័ព្ទសម្រាប់បង្កាន់ដៃ។' : '🖨️ 打印暂未连接 · 如需打印小票请在 mPOS 手机端操作'}</div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Shift report overlay ───────────────────────────────────────────── */}
      {shiftReportOpen && (
        <div style={s.overlay} onClick={() => setShiftReportOpen(false)}>
          <div style={s.shiftModal} onClick={e => e.stopPropagation()}>
            <div style={s.modalTitle}>{d.reportShiftTitle}</div>
            <div style={{ ...s.modalSub, marginBottom: 14 }}>
              {shiftStartIso ? (lang === 'en' ? `Shift start: ${fmtDateTimeShort(shiftStartIso)}` : lang === 'km' ? `ពេលចាប់ផ្តើមវេន៖ ${fmtDateTimeShort(shiftStartIso)}` : `班次开始：${fmtDateTimeShort(shiftStartIso)}`) : (lang === 'en' ? 'Reading shift start time…' : lang === 'km' ? 'កំពុងអានពេលចាប់ផ្តើមវេន…' : '班次开始时间读取中')}
            </div>
            {shiftReportLoading && (
              <div style={{ padding: '24px 0', textAlign: 'center', color: '#64748b', fontSize: 13 }}>
                {lang === 'en' ? 'Generating report…' : lang === 'km' ? 'កំពុងបង្កើតរបាយការណ៍…' : '正在生成报表…'}
              </div>
            )}
            {!shiftReportLoading && shiftReportError && (
              <div style={{ padding: 12, borderRadius: 10, background: '#fef2f2', color: '#b91c1c', fontSize: 13, lineHeight: 1.5 }}>
                {shiftReportError}
              </div>
            )}
            {!shiftReportLoading && !shiftReportError && shiftReport && (
              <ShiftReportPrint report={shiftReport} lang={lang as 'zh' | 'en' | 'km'} />
            )}
            <div style={s.shiftActions}>
              <button
                type="button"
                style={s.secondaryBtn}
                onClick={handlePrintShiftReport}
                disabled={shiftReportLoading}
              >
                {d.printShift}
              </button>
              <button
                type="button"
                style={{ ...s.secondaryBtn, borderColor: '#fecaca', color: '#b91c1c' }}
                onClick={handleRequestShiftClose}
              >
                {d.endShift}
              </button>
              <button
                type="button"
                style={s.modalBtn}
                onClick={() => setShiftReportOpen(false)}
              >
                {d.close}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Shift close confirmation ───────────────────────────────────────── */}
      {shiftCloseConfirmOpen && shiftReport && (
        <div style={s.overlay} onClick={() => setShiftCloseConfirmOpen(false)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <div style={s.modalTitle}>{d.closeShiftConfirm}</div>
            <div style={{ display: 'grid', gap: 8, margin: '16px 0 18px', textAlign: 'left' }}>
              {[
                [lang === 'en' ? 'Shift sales:' : lang === 'km' ? 'ការលក់ក្នុងវេន៖' : '本班销售额：', money(shiftReport.salesAmount)],
                [lang === 'en' ? 'Orders:' : lang === 'km' ? 'បញ្ជាទិញ：' : '本班单数：', `${shiftReport.orderCount}`],
                [lang === 'en' ? 'CASH' : lang === 'km' ? 'CASH' : 'CASH：', money(shiftReport.cashAmount)],
                [lang === 'en' ? 'KHQR' : lang === 'km' ? 'KHQR' : 'KHQR：', money(shiftReport.khqrAmount)],
                [lang === 'en' ? 'Open holds:' : lang === 'km' ? 'មាត់ស្នើ៖' : '未完成挂单：', `${shiftReport.holdOrderCount}`],
                [lang === 'en' ? 'Offline pending:' : lang === 'km' ? 'រង់ចាំ sync៖' : '离线待同步：', `${shiftReport.offlinePendingCount}`],
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 13, color: '#334155' }}>
                  <span>{label}</span>
                  <span style={{ fontWeight: 900, color: '#111827' }}>{value}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button
                type="button"
                style={{ ...s.secondaryBtn, padding: '10px 8px', fontSize: 13 }}
                onClick={() => setShiftCloseConfirmOpen(false)}
              >
                {d.closeShiftCancel}
              </button>
              <button
                type="button"
                style={{ ...s.modalBtn, padding: '10px 8px', fontSize: 13, background: '#b91c1c' }}
                onClick={handleConfirmShiftClose}
              >
                {d.endShift}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Store pending-payment hold detail (view only) ──────────────────── */}
      {viewPendingOrder && (
        <div style={s.overlay} onClick={() => setViewPendingOrder(null)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <div style={s.modalTitle}>{d.serverPendingTitle}</div>
            <div style={{ ...s.modalSub, marginBottom: 6 }}>
              {shortNo(viewPendingOrder.orderNo)} · {fmtDateTimeShort(viewPendingOrder.createdAt)}
            </div>
            <div style={{
              display: 'inline-block', alignSelf: 'center', fontSize: 12, fontWeight: 800,
              color: '#92400e', background: '#fef3c7', borderRadius: 999, padding: '2px 12px', marginBottom: 8,
            }}>
              {d.recordPendingPayment}
            </div>
            <div style={{ display: 'grid', gap: 8, margin: '10px 0 14px', textAlign: 'left', maxHeight: 320, overflowY: 'auto' }}>
              {viewPendingOrder.items.map((it, i) => (
                <div key={`${it.barcode}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: '#111827' }}>{it.name}</div>
                    {it.spec && <div style={{ fontSize: 11, color: '#6b7280' }}>{it.spec}</div>}
                    <div style={{ fontSize: 11, color: '#6b7280' }}>{money(it.unitPrice)} × {it.quantity}</div>
                  </div>
                  <span style={{ fontWeight: 800, color: '#111827', whiteSpace: 'nowrap' }}>{money(it.lineAmount)}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, borderTop: '1px solid #e5e7eb', paddingTop: 10, fontSize: 14 }}>
              <span>{lang === 'en' ? 'Total' : lang === 'km' ? 'សរុប' : '合计'}</span>
              <span style={{ fontWeight: 900, color: '#111827' }}>{money(viewPendingOrder.totalAmount)}</span>
            </div>
            <button type="button" style={{ ...s.secondaryBtn, marginTop: 14 }} onClick={() => setViewPendingOrder(null)}>
              {d.close}
            </button>
          </div>
        </div>
      )}

      {/* ── Day close report overlay ───────────────────────────────────────── */}
      {dayCloseOpen && (
        <div style={s.overlay} onClick={() => setDayCloseOpen(false)}>
          <div style={s.shiftModal} onClick={e => e.stopPropagation()}>
            <div style={s.modalTitle}>{d.reportDayTitle}</div>
            <div style={{ ...s.modalSub, marginBottom: 14 }}>
              {(storeName || storeCode || (lang === 'en' ? 'Current store' : lang === 'km' ? 'ហាងបច្ចុប្បន្ន' : '当前门店'))} · {new Date().toISOString().slice(0, 10)}
            </div>
            {dayCloseLoading && (
              <div style={{ padding: '24px 0', textAlign: 'center', color: '#64748b', fontSize: 13 }}>
                {lang === 'en' ? 'Generating report…' : lang === 'km' ? 'កំពុងបង្កើតរបាយការណ៍…' : '正在生成报表…'}
              </div>
            )}
            {!dayCloseLoading && dayCloseError && (
              <div style={{ padding: 12, borderRadius: 10, background: '#fef2f2', color: '#b91c1c', fontSize: 13, lineHeight: 1.5 }}>
                {dayCloseError}
              </div>
            )}
            {!dayCloseLoading && !dayCloseError && dayCloseReport && (
              <DayCloseReport report={dayCloseReport} />
            )}
            <div style={s.shiftActions}>
              <button
                type="button"
                style={s.secondaryBtn}
                onClick={handlePrintDayCloseReport}
                disabled={dayCloseLoading}
              >
                {d.printDay}
              </button>
              <button
                type="button"
                style={s.modalBtn}
                onClick={() => setDayCloseOpen(false)}
              >
                {d.close}
              </button>
            </div>
          </div>
        </div>
      )}

      {isDesktopPos && desktopRecordsOpen && (
        <div style={s.recordsOverlay} onClick={() => setDesktopRecordsOpen(false)}>
          <div style={s.recordsModal} onClick={e => e.stopPropagation()}>
            <div style={s.recordsHead}>
              <div style={s.recordsTitleBox}>
                <div style={s.recordsTitle}>{lang === 'en' ? 'Sales records' : lang === 'km' ? 'កំណត់ត្រាលក់' : '销售记录'}</div>
                <div style={s.recordsSub}>{lang === 'en' ? 'Recent sales records' : lang === 'km' ? 'កំណត់ត្រាលក់ថ្មីៗ' : '最近销售记录'} · {storeName || storeCode || (lang === 'en' ? 'Current store' : lang === 'km' ? 'ហាងបច្ចុប្បន្ន' : '当前门店')}</div>
              </div>
              <button
                type="button"
                style={s.recordsCloseBtn}
                onClick={() => setDesktopRecordsOpen(false)}
                aria-label="关闭销售记录"
              >
                ×
              </button>
            </div>
            <div style={s.recordsBody}>
              {desktopRecords.loading ? (
                <div style={s.recordsEmpty}>{lang === 'en' ? 'Loading sales records…' : lang === 'km' ? 'កំពុងផ្ទុកកំណត់ត្រាលក់…' : '正在加载销售记录…'}</div>
              ) : desktopRecords.error ? (
                <div style={{ ...s.recordsEmpty, color: '#b91c1c' }}>{desktopRecords.error}</div>
              ) : desktopRecordRows.length === 0 ? (
                <div style={s.recordsEmpty}>{lang === 'en' ? 'No sales records yet' : lang === 'km' ? 'មិនទាន់មានកំណត់ត្រាលក់' : '暂无销售记录'}</div>
              ) : (
                <div style={s.recordsList}>
                  {desktopRecordRows.map((row) => {
                    const expanded = expandedDesktopRecordKey === row.key
                    return (
                      <button
                        key={row.key}
                        type="button"
                        style={{ ...s.recordsItem, ...(expanded ? s.recordsItemExpanded : {}), cursor: 'pointer', textAlign: 'left' }}
                        onClick={() => setExpandedDesktopRecordKey(expanded ? null : row.key)}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={s.recordsNo}>{shortNo(row.orderNo)}</div>
                          <div style={s.recordsMeta}>{row.orderNo} · {row.itemCount} 项</div>
                        </div>
                        <div style={s.recordsTime}>{fmtDateTimeShort(row.createdAt)}</div>
                        <div style={s.recordsPay}>{desktopRecordPayLabel(row)}</div>
                        <div style={s.recordsAmt}>{money(row.amount)}</div>
                        {expanded && renderDesktopRecordDetails(row)}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Sale success overlay ───────────────────────────────────────────── */}
      {saleResult && (
        <div style={s.overlay} onClick={closeSaleResultOverlay}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <div style={s.modalIcon}>✅</div>
            <div style={s.modalTitle}>{d.saleCompleted}</div>
            <div style={s.modalAmt}>{money(saleResult.totalAmount)}</div>
            {saleResult.orderNo && <div style={s.modalSub}>{lang === 'en' ? `Order: ${saleResult.orderNo}` : lang === 'km' ? `លេខបញ្ជាទិញ៖ ${saleResult.orderNo}` : `单号：${saleResult.orderNo}`}</div>}
            {saleResult.khqrFallback && (
              <div style={{ margin: '10px 0 4px', padding: '8px 12px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, fontSize: 12, color: '#92400e', lineHeight: 1.5, textAlign: 'left' as const }}>
                {lang === 'en'
                  ? '⚠️ Auto KHQR is not configured. This sale was recorded as KHQR. Please confirm the customer has actually paid.'
                  : lang === 'km'
                    ? '⚠️ មិនបានកំណត់ KHQR ស្វ័យប្រវត្តិ។ ការលក់នេះត្រូវបានកត់ត្រាជា KHQR។ សូមបញ្ជាក់ថាអតិថិជនបានបង់ពិតប្រាកដ។'
                    : '⚠️ 未配置自动 KHQR，本次已记录为 KHQR 收款，请确认顾客已实际付款。'}
              </div>
            )}
            <div style={{ margin: '6px 0 14px', fontSize: 11, color: '#9ca3af', lineHeight: 1.5 }}>
              {isDesktopPos && saleResult.receipt
                ? (qzRawBusinessActive
                    ? (lang === 'en'
                        ? '80mm tickets ready: customer → 前台; kitchen → 厨房 via QZ RAW.'
                        : lang === 'km'
                          ? 'សំបុត្រ 80mm រួចរាល់៖ អតិថិជន → 前台; ផ្ទះបាយ → 厨房 តាម QZ RAW។'
                          : '已生成 80mm 票据：顾客票 → 前台，厨房票 → 厨房（QZ RAW）')
                    : d.receiptReady)
                : d.receiptNotAuto}
            </div>
            {isDesktopPos && saleResult.receipt && qzRawBusinessActive && (
              <div data-qz-dual-queue-print="raw" style={{ marginBottom: 10 }}>
                <div style={{ display: 'grid', gridTemplateColumns: saleResult.kitchenTicket ? '1fr 1fr' : '1fr', gap: 8 }}>
                  <button
                    ref={receiptPrintButtonRef}
                    type="button"
                    data-qz-print-kind="receipt"
                    style={{ ...s.modalBtn, padding: '10px 8px', fontSize: 12, ...(qzReceiptTest.status === 'printing' ? s.submitDis : {}) }}
                    disabled={qzReceiptTest.status === 'printing'}
                    onClick={() => void handleControlledQzPrint('receipt', saleResult.receipt!, saleResult.kitchenTicket)}
                  >
                    {qzReceiptTest.status === 'printing'
                      ? (lang === 'en' ? 'Printing…' : lang === 'km' ? 'កំពុងបោះពុម្ព…' : '打印中…')
                      : (lang === 'en' ? 'Customer → 前台' : lang === 'km' ? 'អតិថិជន → 前台' : '顾客票 → 前台')}
                  </button>
                  {saleResult.kitchenTicket && (
                    <button
                      type="button"
                      data-qz-print-kind="kitchen"
                      style={{ ...s.secondaryBtn, padding: '10px 8px', fontSize: 12, ...(qzKitchenTest.status === 'printing' ? s.submitDis : {}) }}
                      disabled={qzKitchenTest.status === 'printing'}
                      onClick={() => void handleControlledQzPrint('kitchen', saleResult.receipt!, saleResult.kitchenTicket)}
                    >
                      {qzKitchenTest.status === 'printing'
                        ? (lang === 'en' ? 'Printing…' : lang === 'km' ? 'កំពុងបោះពុម្ព…' : '打印中…')
                        : (lang === 'en' ? 'Kitchen → 厨房' : lang === 'km' ? 'ផ្ទះបាយ → 厨房' : '厨房票 → 厨房')}
                    </button>
                  )}
                </div>
                {qzReceiptTest.message && (
                  <div data-qz-result="receipt" style={{ marginTop: 7, fontSize: 10, lineHeight: 1.4, color: qzReceiptTest.status === 'error' ? '#b91c1c' : '#166534' }}>
                    {qzReceiptTest.message}
                  </div>
                )}
                {qzKitchenTest.message && (
                  <div data-qz-result="kitchen" style={{ marginTop: 5, fontSize: 10, lineHeight: 1.4, color: qzKitchenTest.status === 'error' ? '#b91c1c' : '#166534' }}>
                    {qzKitchenTest.message}
                  </div>
                )}
              </div>
            )}
            {isDesktopPos && saleResult.receipt && !qzRawBusinessActive && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                <button
                  type="button"
                  style={{ ...s.secondaryBtn, padding: '10px 8px', fontSize: 12, ...(isReceiptPrintChainActive ? s.submitDis : {}) }}
                  disabled={isReceiptPrintChainActive}
                  onClick={() => {
                    if (isReceiptPrintChainActive || receiptPrintLockedRef.current) return
                    setReceiptPreviewOpen(true)
                  }}
                >
                  {d.previewReceipt}
                </button>
                <button
                  ref={receiptPrintButtonRef}
                  type="button"
                  style={{ ...s.modalBtn, padding: '10px 8px', fontSize: 12, ...(isReceiptPrintChainActive ? s.submitDis : {}) }}
                  disabled={isReceiptPrintChainActive}
                  onClick={() => saleResult.receipt && handlePrintReceipt(saleResult.receipt, saleResult.kitchenTicket)}
                >
                  {isReceiptPrintChainActive ? (lang === 'en' ? 'Printing…' : lang === 'km' ? 'កំពុងបោះពុម្ព…' : '打印中…') : d.printReceipt}
                </button>
              </div>
            )}
            <button
              style={{ ...s.modalBtn, ...(isReceiptPrintChainActive ? s.submitDis : {}) }}
              disabled={isReceiptPrintChainActive}
              onClick={handleContinueSale}
            >
              {isReceiptPrintChainActive
                ? (lang === 'en' ? 'Finishing print…' : lang === 'km' ? 'កំពុងបញ្ចប់ការបោះពុម្ព…' : '正在完成打印…')
                : d.continueSale}
            </button>
          </div>
        </div>
      )}

      {receiptPreviewOpen && saleResult?.receipt && (
        <DesktopReceiptPreview
          data={saleResult.receipt}
          lang={lang}
          onClose={() => setReceiptPreviewOpen(false)}
          onPrint={() => handlePrintReceipt(saleResult.receipt!, saleResult.kitchenTicket)}
        />
      )}

      {memberPayOpen && (
        <div style={s.overlay} onClick={() => setMemberPayOpen(false)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <div style={s.modalTitle}>{d.memberPayTitle}</div>
            <div style={{ marginBottom: 12, fontSize: 13, color: '#6b7280', lineHeight: 1.5 }}>
              {lang === 'en' ? 'Enter the member phone number and confirm enough balance before completing this order.' : lang === 'km' ? 'បញ្ចូលលេខទូរស័ព្ទសមាជិក ហើយបញ្ជាក់ថាសមតុល្យគ្រប់គ្រាន់ មុនបញ្ចប់បញ្ជាទិញនេះ។' : '输入会员手机号，确认余额足够后完成本单。'}
            </div>
            {!isOnline && (
              <div style={{ marginBottom: 10, padding: '8px 10px', background: '#fffbeb', color: '#92400e', borderRadius: 8, fontSize: 12 }}>
                {lang === 'en' ? 'Member balance payment is unavailable offline.' : lang === 'km' ? 'របៀប offline មិនគាំទ្រការបង់ដោយសមតុល្យសមាជិកទេ។' : '离线模式下不支持会员余额支付'}
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
                placeholder={lang === 'en' ? 'Member phone number' : lang === 'km' ? 'លេខទូរស័ព្ទសមាជិក' : '输入会员手机号'}
                style={{ flex: 1, height: 40, border: '1px solid #e5e7eb', borderRadius: 9, padding: '0 10px', outline: 'none' }}
                disabled={!isOnline || memberLookupLoading || memberPayLoading}
              />
              <button
                type="button"
                style={{ ...s.modalBtn, padding: '0 14px', fontSize: 13, minWidth: 84 }}
                onClick={lookupCashierMember}
                disabled={!isOnline || !memberPhone.trim() || memberLookupLoading || memberPayLoading}
              >
                {memberLookupLoading ? (lang === 'en' ? 'Searching…' : lang === 'km' ? 'កំពុងស្វែងរក…' : '查询中…') : (lang === 'en' ? 'Search' : lang === 'km' ? 'ស្វែងរក' : '查询')}
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
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{lang === 'en' ? 'Balance' : lang === 'km' ? 'សមតុល្យ' : '当前余额'}</div>
                    <div style={{ fontSize: 15, fontWeight: 900 }}>{money(Number(memberPayMember.balance))}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{lang === 'en' ? 'Order total' : lang === 'km' ? 'ចំនួនបញ្ជាទិញ' : '本单金额'}</div>
                    <div style={{ fontSize: 15, fontWeight: 900 }}>{money(total)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{lang === 'en' ? 'After pay' : lang === 'km' ? 'បន្ទាប់ពីបង់' : '支付后'}</div>
                    <div style={{ fontSize: 15, fontWeight: 900, color: Number(memberPayMember.balance) >= total ? '#047857' : '#dc2626' }}>
                      {money(Number(memberPayMember.balance) - total)}
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
              {memberPayLoading ? (lang === 'en' ? 'Paying…' : lang === 'km' ? 'កំពុងបង់…' : '支付中…') : Number(memberPayMember?.balance ?? 0) < total ? (lang === 'en' ? 'Insufficient balance' : lang === 'km' ? 'សមតុល្យមិនគ្រប់' : '余额不足') : (lang === 'en' ? 'Confirm balance pay' : lang === 'km' ? 'បញ្ជាក់បង់ដោយសមតុល្យ' : '确认余额支付')}
            </button>
            <button
              style={{ ...s.sugarCancel, marginTop: 8 }}
              onClick={() => setMemberPayOpen(false)}
              disabled={memberPayLoading}
            >
              {d.close}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
