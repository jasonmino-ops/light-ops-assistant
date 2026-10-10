'use client'

/**
 * /desktop/dine-in — ES-DINE-IN-01 M1.
 *
 * Three views inside the Desktop employee window: table overview, product
 * selection for one batch, and the whole-table bill. The server is the only
 * authority: this page never decides that something was ordered, paid or printed.
 *
 * Two rules shape the code below.
 *  1. One user intent = one request key. A retry after a lost response reuses the
 *     key; only a new intent gets a new one.
 *  2. One kitchen notice identity = one call to the print bridge. `submitNotice`
 *     is the only place that calls it for kitchen notices, and it can only run
 *     after the server handed this page the content (which it does once).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/app/components/LangProvider'
import { renderDesktopReceiptHtml, type DesktopReceiptData } from '@/app/components/DesktopReceipt'
import { formatMoney, isKhqrSupportedCurrency } from '@/lib/currency'
import { posDeviceHeaders } from '@/lib/desktop-pos-client'
import { renderTicketHtmlToEscPosRaw } from '@/lib/qzHtmlBitmapRenderer'
import type {
  BatchResult,
  ClaimNoticeResult,
  DiningBatchView,
  DiningLineView,
  DiningMealView,
  DiningRecoverableMeal,
  DiningRecoverablePage,
  DiningTableView,
  EndMealResult,
  OpenMealResult,
  SettleResult,
} from '@/lib/dine-in/commands'
import { diningErrorText, diningText, fill, type DiningLang } from '@/lib/dine-in/i18n'
import { bridgeResultToReportOutcome, type DiningNoticeReportOutcome } from '@/lib/dine-in/kitchen-notice'
import { bytesToBase64, renderDiningKitchenNoticeHtml } from '@/lib/dine-in/ticket-renderer'
import DiningMealBill from './components/DiningMealBill'
import DiningProductPicker, { type DiningCategory, type DiningProduct } from './components/DiningProductPicker'
import DiningTableOverview, { type TableDraft } from './components/DiningTableOverview'

type Gate = {
  eligible: boolean
  reasons: string[]
  recoveryAvailable: boolean
  hasActiveMeals: boolean
  role: 'OWNER' | 'STAFF'
  operatorSource: 'ACCOUNT' | 'DEVICE' | 'STORE_CODE'
  store: { code: string; name: string; currencyCode: string; printKitchenTicket: boolean }
}

type ApiResult<T> =
  | { kind: 'ok'; data: T }
  /** The server answered and said no. Nothing was written for this request. */
  | { kind: 'refused'; code: string; details?: unknown }
  /** No usable answer. The request may or may not have been applied. */
  | { kind: 'unknown' }

type View = { kind: 'tables' } | { kind: 'bill' | 'menu'; mealId: string }
type Phase = 'idle' | 'submitting' | 'unknown'
type Dialog =
  | { kind: 'open'; table: DiningTableView; guestCount: string; note: string; key: string; phase: Phase }
  | { kind: 'void'; line: DiningLineView; reason: string; needConfirm: boolean; kitchenConfirmed: boolean; key: string; phase: Phase }
  | { kind: 'renotify'; batch: DiningBatchView; reason: string; accepted: boolean; key: string; phase: Phase }
  | { kind: 'pay'; method: 'CASH' | 'KHQR'; amount: string; version: number; key: string; phase: Phase | 'unknownOffline' | 'resend' }
  | { kind: 'end'; action: 'clear' | 'voidMeal'; key: string; phase: Phase }
  | { kind: 'discard' }

type PrintBridge = {
  submit: (intent: { orderNo: string; printJobId: string; role: 'FRONT' | 'KITCHEN'; rendererVersion: 'network-1'; expiresAt: string; payloadBase64: string }) => Promise<unknown>
}

function printBridge(): PrintBridge | null {
  if (typeof window === 'undefined') return null
  const host = window as unknown as { eshopDesktopRuntime?: { isDesktop?: boolean }; eshopV3Printing?: PrintBridge }
  return host.eshopDesktopRuntime?.isDesktop && host.eshopV3Printing ? host.eshopV3Printing : null
}

function newKey(): string {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`
  return `di-${id}`
}

async function api<T>(storeCode: string, path: string, body?: unknown, query = ''): Promise<ApiResult<T>> {
  try {
    const response = await fetch(`/api/dine-in/${path}?storeCode=${encodeURIComponent(storeCode)}${query}`, {
      method: body === undefined ? 'GET' : 'POST',
      cache: 'no-store',
      headers: { ...posDeviceHeaders(storeCode), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const data = await response.json().catch(() => null) as { error?: string; details?: unknown } | null
    if (response.ok && data) return { kind: 'ok', data: data as T }
    if (response.status >= 500 || !data || typeof data.error !== 'string') return { kind: 'unknown' }
    return { kind: 'refused', code: data.error, details: data.details }
  } catch {
    return { kind: 'unknown' }
  }
}

const s: Record<string, CSSProperties> = {
  root: { minHeight: '100dvh', background: '#f1f5f9', color: '#0f172a', fontFamily: 'system-ui,-apple-system,"Noto Sans Khmer","Microsoft YaHei",sans-serif', display: 'flex', flexDirection: 'column' },
  top: { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', background: '#0f172a', color: '#fff', flexWrap: 'wrap' },
  topTitle: { fontSize: 18, fontWeight: 900 },
  topStore: { fontSize: 12, color: '#94a3b8' },
  spacer: { flex: 1 },
  topBtn: { minHeight: 36, padding: '0 14px', borderRadius: 9, border: '1px solid rgba(255,255,255,.18)', background: 'rgba(255,255,255,.08)', color: '#e5e7eb', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  main: { flex: 1, padding: 18, maxWidth: 1400, width: '100%', margin: '0 auto', boxSizing: 'border-box' },
  banner: { borderRadius: 12, padding: '10px 14px', marginBottom: 12, fontSize: 14, fontWeight: 700, lineHeight: 1.5, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
  info: { background: '#e0f2fe', color: '#075985' },
  warn: { background: '#fef3c7', color: '#92400e' },
  error: { background: '#fee2e2', color: '#991b1b' },
  bannerBtn: { minHeight: 34, padding: '0 12px', borderRadius: 8, border: '1px solid currentColor', background: 'transparent', color: 'inherit', fontSize: 13, fontWeight: 800, cursor: 'pointer' },
  center: { padding: 48, textAlign: 'center', color: '#475569', fontSize: 15 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 50 },
  dialog: { width: 'min(460px, 100%)', background: '#fff', borderRadius: 18, padding: 20, display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '92dvh', overflowY: 'auto' },
  dTitle: { fontSize: 19, fontWeight: 900 },
  dText: { fontSize: 14, color: '#334155', lineHeight: 1.55 },
  dWarn: { fontSize: 14, color: '#92400e', background: '#fef3c7', borderRadius: 10, padding: 10, lineHeight: 1.55, fontWeight: 700 },
  label: { fontSize: 13, fontWeight: 800, color: '#334155' },
  input: { minHeight: 44, borderRadius: 10, border: '1px solid #cbd5e1', padding: '0 12px', fontSize: 16, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' },
  check: { display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, fontWeight: 700, lineHeight: 1.45 },
  actions: { display: 'flex', gap: 10, marginTop: 4 },
  primary: { flex: 1, minHeight: 52, borderRadius: 12, border: 'none', background: '#2563eb', color: '#fff', fontSize: 16, fontWeight: 900, cursor: 'pointer' },
  green: { background: '#16a34a' },
  red: { background: '#dc2626' },
  ghost: { minHeight: 52, padding: '0 18px', borderRadius: 12, border: '1px solid #cbd5e1', background: '#fff', color: '#0f172a', fontSize: 15, fontWeight: 800, cursor: 'pointer' },
  seg: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  segBtn: { minHeight: 52, borderRadius: 12, border: '2px solid #cbd5e1', background: '#fff', color: '#0f172a', fontSize: 16, fontWeight: 900, cursor: 'pointer' },
  segOn: { borderColor: '#2563eb', background: '#eff6ff', color: '#1d4ed8' },
  bigAmount: { fontSize: 38, fontWeight: 900, textAlign: 'center', lineHeight: 1.1 },
  steps: { display: 'flex', alignItems: 'center', gap: 10 },
  step: { width: 52, height: 52, borderRadius: 12, border: '1px solid #cbd5e1', background: '#f8fafc', fontSize: 22, fontWeight: 900, cursor: 'pointer', color: '#0f172a' },
}

export default function DineInPage() {
  const router = useRouter()
  const { lang: localeLang } = useLocale()
  const lang = localeLang as DiningLang
  const t = diningText(lang)

  const [storeCode, setStoreCode] = useState<string | null>(null)
  const [online, setOnline] = useState(true)
  const [hasBridge, setHasBridge] = useState(true)
  const [gate, setGate] = useState<Gate | null>(null)
  const [gateProblem, setGateProblem] = useState<string | null>(null)
  const [tables, setTables] = useState<DiningTableView[] | null>(null)
  const [recoverable, setRecoverable] = useState<{ items: DiningRecoverableMeal[]; hasMore: boolean }>({ items: [], hasMore: false })
  const [view, setView] = useState<View>({ kind: 'tables' })
  const [meal, setMeal] = useState<DiningMealView | null>(null)
  const [catalog, setCatalog] = useState<{ products: DiningProduct[]; categories: DiningCategory[] } | null>(null)
  const [cart, setCart] = useState<Record<string, number>>({})
  const [orderPhase, setOrderPhase] = useState<Phase>('idle')
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [notice, setNotice] = useState<{ tone: 'info' | 'warn' | 'error'; text: string } | null>(null)
  const [tableBusy, setTableBusy] = useState(false)
  const [submittingNotices, setSubmittingNotices] = useState<ReadonlySet<string>>(new Set())
  const [receipt, setReceipt] = useState<{ mealId: string; text: string } | null>(null)
  const [receiptBusy, setReceiptBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  /** Request key of the batch being built; kept until that batch is known to be stored or is given up. */
  const cartKey = useRef<string | null>(null)
  const viewRef = useRef<View>(view)
  viewRef.current = view
  /** Bumped by every authoritative update so that slower, older reads are dropped. */
  const mealEpoch = useRef(0)
  const tablesEpoch = useRef(0)
  /** How many pages of the recovery list the person has asked to see. Every refresh reads that many, from the top. */
  const recoverPages = useRef(1)
  const shownRecoverable = useRef(0)
  /** One table refresh at a time; a request made meanwhile runs once the current one is done. */
  const tablesBusy = useRef<'idle' | 'busy' | 'again'>('idle')
  const noticeLocks = useRef(new Set<string>())

  const currencyCode = gate?.store.currencyCode ?? 'USD'
  const isOwner = gate?.role === 'OWNER'
  const canNew = Boolean(gate?.eligible) && online
  const say = useCallback((tone: 'info' | 'warn' | 'error', text: string) => setNotice({ tone, text }), [])
  const sayRefusal = useCallback((code: string) => setNotice({ tone: 'error', text: diningErrorText(lang, code) }), [lang])

  // ── Boot ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    setStoreCode(new URLSearchParams(window.location.search).get('storeCode')?.trim() ?? '')
    setHasBridge(printBridge() !== null)
    const update = () => setOnline(navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    const clock = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
      window.clearInterval(clock)
    }
  }, [])

  const loadGate = useCallback(async (code: string) => {
    const result = await api<Gate>(code, 'eligibility')
    if (result.kind === 'ok') { setGate(result.data); setGateProblem(null); return result.data }
    setGateProblem(result.kind === 'refused' ? result.code : 'NETWORK')
    return null
  }, [])

  const refreshTables = useCallback(async (code: string, morePages = 0) => {
    // A long list takes several requests; refreshes must not pile up or cancel one another.
    if (tablesBusy.current !== 'idle') { if (morePages === 0) tablesBusy.current = 'again'; return }
    tablesBusy.current = 'busy'
    try {
      const epoch = ++tablesEpoch.current
      const wanted = recoverPages.current + morePages
      const result = await api<{ tables: DiningTableView[]; recoverable: DiningRecoverablePage | null }>(code, 'tables')
      if (epoch !== tablesEpoch.current || result.kind !== 'ok') return
      setTables(result.data.tables)
      // A null recovery list means the server could not read it this time: keep what is shown.
      let page = result.data.recoverable
      if (!page) return
      const items = [...page.items]
      let read = 1
      let complete = true
      while (read < wanted && page.hasMore && page.nextCursor) {
        const next: ApiResult<{ recoverable: DiningRecoverablePage }> = await api(code, 'tables', undefined, `&recoverCursor=${encodeURIComponent(page.nextCursor)}`)
        if (epoch !== tablesEpoch.current) return
        if (next.kind !== 'ok') { complete = false; break }
        page = next.data.recoverable
        items.push(...page.items)
        read += 1
      }
      // A following page that could not be read: what is on screen stays rather than shrinking, and the rest is still offered.
      if (!complete && shownRecoverable.current > items.length) return
      // Only pages that were actually read count as asked for.
      recoverPages.current = Math.max(1, read)
      shownRecoverable.current = items.length
      setRecoverable({ items, hasMore: page.hasMore })
    } finally {
      const again = (tablesBusy.current as 'idle' | 'busy' | 'again') === 'again'
      tablesBusy.current = 'idle'
      if (again) void refreshTablesRef.current?.(code)
    }
  }, [])
  const refreshTablesRef = useRef<((code: string) => Promise<void>) | null>(null)
  refreshTablesRef.current = refreshTables

  const applyMeal = useCallback((next: DiningMealView) => {
    const current = viewRef.current
    if (current.kind === 'tables' || current.mealId !== next.mealId) return
    mealEpoch.current += 1
    setMeal((previous) => (!previous || previous.mealId !== next.mealId || next.version >= previous.version ? next : previous))
  }, [])

  const refreshMeal = useCallback(async (code: string, mealId: string): Promise<DiningMealView | null> => {
    const epoch = ++mealEpoch.current
    const result = await api<{ meal: DiningMealView }>(code, `sessions/${encodeURIComponent(mealId)}`)
    if (result.kind !== 'ok') return null
    const current = viewRef.current
    if (epoch === mealEpoch.current && current.kind !== 'tables' && current.mealId === mealId) {
      setMeal((previous) => (!previous || previous.mealId !== mealId || result.data.meal.version >= previous.version ? result.data.meal : previous))
    }
    return result.data.meal
  }, [])

  useEffect(() => {
    if (!storeCode) return
    void loadGate(storeCode).then((loaded) => { if (loaded?.recoveryAvailable) void refreshTables(storeCode) })
  }, [storeCode, loadGate, refreshTables])

  // Other devices change tables and bills too; re-read quietly while nothing is in flight.
  useEffect(() => {
    if (!storeCode || !gate?.recoveryAvailable || !online) return
    const timer = window.setInterval(() => {
      if (dialog && dialog.kind !== 'discard' && dialog.phase !== 'idle') return
      const current = viewRef.current
      if (current.kind === 'tables') void refreshTables(storeCode)
      else void refreshMeal(storeCode, current.mealId)
    }, 5_000)
    return () => window.clearInterval(timer)
  }, [storeCode, gate?.recoveryAvailable, online, dialog, refreshTables, refreshMeal])

  // ── Navigation between the three views ────────────────────────────────────
  const showTables = useCallback(() => {
    setView({ kind: 'tables' })
    setMeal(null)
    setReceipt(null)
    if (storeCode) void refreshTables(storeCode)
  }, [storeCode, refreshTables])

  const showMeal = useCallback((mealId: string, kind: 'bill' | 'menu' = 'bill') => {
    viewRef.current = { kind, mealId }
    setView({ kind, mealId })
    setMeal((previous) => (previous?.mealId === mealId ? previous : null))
    if (storeCode) void refreshMeal(storeCode, mealId)
  }, [storeCode, refreshMeal])

  const loadCatalog = useCallback(async () => {
    if (!storeCode || catalog) return
    try {
      const response = await fetch(`/api/cashier/store?storeCode=${encodeURIComponent(storeCode)}`, { cache: 'no-store' })
      if (!response.ok) throw new Error('catalog')
      const data = await response.json() as { products: DiningProduct[]; categories: DiningCategory[] }
      setCatalog({ products: data.products, categories: data.categories })
    } catch {
      // Not cached, so entering the menu again retries; the bill stays usable meanwhile.
      setNotice({ tone: 'error', text: diningText(lang).catalogFailed })
    }
  }, [storeCode, catalog, lang])

  const showMenu = useCallback((mealId: string) => {
    showMeal(mealId, 'menu')
    void loadCatalog()
  }, [showMeal, loadCatalog])

  const discardCart = useCallback(() => {
    setCart({})
    cartKey.current = null
    setOrderPhase('idle')
  }, [])

  const backToCashier = useCallback(() => {
    if (!storeCode) return
    const params = new URLSearchParams({ storeCode, mode: 'pos' })
    const current = new URLSearchParams(window.location.search).get('lang')
    if (current) params.set('lang', current)
    router.push(`/desktop/pos?${params.toString()}`)
  }, [router, storeCode])

  // ── Kitchen notice: claim → one bridge call → report ──────────────────────
  const submitNotice = useCallback(async (mealId: string, batchId: string) => {
    if (!storeCode || noticeLocks.current.has(batchId)) return
    // Without a print bridge the content is left with the server, still unclaimed,
    // so that a real Desktop window can make the first and only submit later.
    if (!printBridge()) { setNotice({ tone: 'warn', text: diningText(lang).notDesktop }); return }
    noticeLocks.current.add(batchId)
    setSubmittingNotices(new Set(noticeLocks.current))
    const base = `sessions/${encodeURIComponent(mealId)}/kitchen`
    try {
      const claim = await api<ClaimNoticeResult>(storeCode, `${base}/claim`, { batchId })
      if (claim.kind !== 'ok') {
        // If the claim was taken but its answer was lost, the content is gone for
        // good and the bill will show the notice as unknown. It is not requested again.
        if (claim.kind === 'refused') sayRefusal(claim.code)
        return
      }
      applyMeal(claim.data.meal)
      if (!claim.data.claimed) return

      const { notice: ticket } = claim.data
      let outcome: DiningNoticeReportOutcome
      const bridge = printBridge()
      if (!bridge) {
        outcome = 'BRIDGE_UNAVAILABLE'
      } else {
        let payloadBase64: string | null = null
        try {
          const html = renderDiningKitchenNoticeHtml(ticket.content, gate?.store.name ?? '', lang)
          payloadBase64 = bytesToBase64(await renderTicketHtmlToEscPosRaw(html))
        } catch { /* nothing was handed to the bridge */ }
        if (payloadBase64 === null) {
          outcome = 'RENDER_FAILED'
        } else {
          try {
            // The single submit for this identity. No retry, here or anywhere.
            outcome = bridgeResultToReportOutcome(await bridge.submit({
              orderNo: ticket.printOrderNo,
              printJobId: ticket.printJobId,
              role: 'KITCHEN',
              rendererVersion: 'network-1',
              expiresAt: ticket.expiresAt,
              payloadBase64,
            }))
          } catch {
            outcome = 'SUBMIT_THREW'
          }
        }
      }
      // Reporting is written once server-side, so repeating the same report is harmless.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const report = await api<{ recorded: boolean; meal: DiningMealView }>(storeCode, `${base}/report`, { batchId, outcome })
        if (report.kind === 'ok') { applyMeal(report.data.meal); break }
        if (report.kind === 'refused') break
        await new Promise((resolve) => window.setTimeout(resolve, 1_000))
      }
    } finally {
      noticeLocks.current.delete(batchId)
      setSubmittingNotices(new Set(noticeLocks.current))
      void refreshMeal(storeCode, mealId)
    }
  }, [storeCode, gate?.store.name, lang, applyMeal, refreshMeal, sayRefusal])

  const submitNoticeIfPending = useCallback((result: BatchResult) => {
    const batch = result.meal.batches.find((entry) => entry.id === result.batchId)
    if (batch?.notice.canClaim) void submitNotice(result.meal.mealId, batch.id)
  }, [submitNotice])

  // ── Payment receipt (identity = bill number, role FRONT) ──────────────────
  const printReceipt = useCallback(async (paid: DiningMealView) => {
    const payment = paid.payment
    if (!payment?.receiptPrint || receiptBusy) return
    const done = (text: string) => setReceipt({ mealId: paid.mealId, text })
    const bridge = printBridge()
    if (!bridge) { done(`${t.notDesktop} ${t.receiptFailed}`); return }
    setReceiptBusy(true)
    try {
      const lines = paid.batches.filter((batch) => batch.kind === 'ORDER').flatMap((batch) => batch.lines).filter((line) => line.status === 'COMPLETED')
      const data: DesktopReceiptData = {
        storeName: gate?.store.name ?? '',
        orderNo: payment.billNo,
        createdAt: payment.paidAt ?? new Date().toISOString(),
        paymentMethod: payment.paymentMethod,
        totalAmount: Number(payment.amount),
        currencyCode,
        extraLines: [
          { label: t.receiptTable, value: paid.table.name },
          { label: t.receiptGuests, value: String(paid.guestCount) },
        ],
        items: lines.map((line) => ({ name: line.name, spec: line.spec, qty: line.quantity, price: Number(line.unitPrice), lineAmount: Number(line.lineAmount) })),
      }
      const payloadBase64 = bytesToBase64(await renderTicketHtmlToEscPosRaw(renderDesktopReceiptHtml(data, lang)))
      const outcome = bridgeResultToReportOutcome(await bridge.submit({
        orderNo: payment.receiptPrint.printOrderNo,
        printJobId: payment.receiptPrint.printJobId,
        role: 'FRONT',
        rendererVersion: 'network-1',
        expiresAt: payment.receiptPrint.expiresAt,
        payloadBase64,
      }))
      done(outcome === 'CROSSED' ? t.receiptSent : outcome === 'HELD' ? t.receiptHeld : outcome === 'NOT_EXECUTED' ? t.receiptAlready : t.receiptFailed)
    } catch {
      done(t.receiptFailed)
    } finally {
      setReceiptBusy(false)
    }
  }, [receiptBusy, gate?.store.name, currencyCode, lang, t])

  // ── Commands ──────────────────────────────────────────────────────────────
  const afterRefusal = useCallback((code: string) => {
    sayRefusal(code)
    setDialog(null)
    if (!storeCode) return
    if (code === 'DINE_IN_NEW_BUSINESS_UNAVAILABLE' || code === 'STORE_NOT_ACTIVE' || code === 'POS_DEVICE_UNAUTHORIZED') void loadGate(storeCode)
    const current = viewRef.current
    if (current.kind === 'tables') void refreshTables(storeCode)
    else void refreshMeal(storeCode, current.mealId)
  }, [storeCode, sayRefusal, loadGate, refreshTables, refreshMeal])

  const submitOpen = useCallback(async (state: Extract<Dialog, { kind: 'open' }>) => {
    if (!storeCode) return
    setDialog({ ...state, phase: 'submitting' })
    const result = await api<OpenMealResult>(storeCode, 'sessions', {
      tableId: state.table.id, guestCount: Number.parseInt(state.guestCount, 10), note: state.note.trim() || undefined, requestKey: state.key,
    })
    if (result.kind === 'unknown') { setDialog({ ...state, phase: 'unknown' }); return }
    if (result.kind === 'refused') { afterRefusal(result.code); return }
    setDialog(null)
    setNotice(null)
    discardCart()
    showMenu(result.data.mealId)
  }, [storeCode, afterRefusal, discardCart, showMenu])

  const submitOrder = useCallback(async () => {
    if (!storeCode || view.kind !== 'menu') return
    const mealId = view.mealId
    const stillHere = () => viewRef.current.kind !== 'tables' && viewRef.current.mealId === mealId
    const items = Object.entries(cart).filter(([, quantity]) => quantity > 0).map(([barcode, quantity]) => ({ barcode, quantity }))
    if (items.length === 0) return
    cartKey.current ??= newKey()
    setOrderPhase('submitting')
    const result = await api<BatchResult>(storeCode, `sessions/${encodeURIComponent(mealId)}/batches`, { type: 'ORDER', requestKey: cartKey.current, items })
    // The user has moved to another table meanwhile: that table's cart and state are not ours to touch.
    if (result.kind !== 'ok' && !stillHere()) return
    if (result.kind === 'unknown') { setOrderPhase('unknown'); return }
    if (result.kind === 'refused') {
      // A refusal stored nothing, so the key stays with this cart: sending the same
      // cart again is the same intent. Editing the cart is what makes a new one.
      setOrderPhase('idle')
      sayRefusal(result.code)
      if (result.code === 'DINE_IN_NEW_BUSINESS_UNAVAILABLE') void loadGate(storeCode)
      if ((result.code === 'MEAL_NOT_OPEN' || result.code === 'EXTERNAL_PAYMENT_EXISTS') && stillHere()) { discardCart(); showMeal(mealId) }
      return
    }
    if (stillHere()) {
      discardCart()
      setNotice(null)
      showMeal(mealId)
      applyMeal(result.data.meal)
    }
    submitNoticeIfPending(result.data)
  }, [storeCode, view, cart, sayRefusal, loadGate, discardCart, showMeal, applyMeal, submitNoticeIfPending])

  const submitVoid = useCallback(async (state: Extract<Dialog, { kind: 'void' }>) => {
    if (!storeCode || view.kind === 'tables') return
    setDialog({ ...state, phase: 'submitting' })
    const result = await api<BatchResult>(storeCode, `sessions/${encodeURIComponent(view.mealId)}/batches`, {
      type: 'VOID', requestKey: state.key, reason: state.reason.trim(), kitchenConfirmed: state.kitchenConfirmed,
      lines: [{ saleRecordId: state.line.saleRecordId, quantity: state.line.quantity }],
    })
    if (result.kind === 'unknown') { setDialog({ ...state, phase: 'unknown' }); return }
    if (result.kind === 'refused') {
      if (result.code === 'KITCHEN_CONFIRMATION_REQUIRED') { setDialog({ ...state, needConfirm: true, kitchenConfirmed: false, phase: 'idle' }); return }
      afterRefusal(result.code)
      return
    }
    setDialog(null)
    applyMeal(result.data.meal)
    submitNoticeIfPending(result.data)
  }, [storeCode, view, afterRefusal, applyMeal, submitNoticeIfPending])

  const submitRenotify = useCallback(async (state: Extract<Dialog, { kind: 'renotify' }>) => {
    if (!storeCode || view.kind === 'tables') return
    setDialog({ ...state, phase: 'submitting' })
    const result = await api<BatchResult>(storeCode, `sessions/${encodeURIComponent(view.mealId)}/batches/${encodeURIComponent(state.batch.id)}/renotify`, {
      requestKey: state.key, reason: state.reason.trim(), duplicateRiskAccepted: state.accepted,
    })
    if (result.kind === 'unknown') { setDialog({ ...state, phase: 'unknown' }); return }
    if (result.kind === 'refused') { afterRefusal(result.code); return }
    setDialog(null)
    applyMeal(result.data.meal)
    submitNoticeIfPending(result.data)
  }, [storeCode, view, afterRefusal, applyMeal, submitNoticeIfPending])

  const submitPay = useCallback(async (state: Extract<Dialog, { kind: 'pay' }>, confirming = false): Promise<void> => {
    if (!storeCode || view.kind === 'tables') return
    const mealId = view.mealId
    setDialog({ ...state, phase: 'submitting' })
    const result = await api<SettleResult>(storeCode, `sessions/${encodeURIComponent(mealId)}/settle`, {
      requestKey: state.key, paymentMethod: state.method, expectedAmount: state.amount, expectedVersion: state.version,
      manualPaymentConfirmed: state.method === 'KHQR',
    })
    if (result.kind === 'ok') {
      setDialog(null)
      applyMeal(result.data.meal)
      // `alreadySettled`: another request paid this bill, and that side prints the receipt.
      if (result.data.alreadySettled) { say('warn', t.payAlreadySettled); return }
      // The payment is recorded whatever the kitchen knows. What it does not know is said here, after the fact.
      const { orderSeqs, voidSeqs } = result.data.kitchenWarnings
      const warnings = [
        ...(orderSeqs.length > 0 ? [fill(t.payKitchenNotNotified, { seqs: orderSeqs.join(', ') })] : []),
        ...(voidSeqs.length > 0 ? [fill(t.voidNoticePending, { seqs: voidSeqs.join(', ') })] : []),
      ]
      if (warnings.length > 0) say('warn', warnings.join(' '))
      else setNotice(null)
      void printReceipt(result.data.meal)
      return
    }
    if (result.kind === 'refused') { afterRefusal(result.code); return }
    // No answer. Never decide here, and never let a second, different collection start:
    // ask the server what it has.
    setDialog({ ...state, phase: 'unknown' })
    const fresh = await refreshMeal(storeCode, mealId)
    if (!fresh) { setDialog({ ...state, phase: 'unknownOffline' }); return }
    // Still open: the first attempt has not been applied (yet); only the same request may be sent again.
    // Paid: send the same request once more — it writes nothing and tells us whose payment it was.
    if (fresh.state === 'OPEN') { setDialog({ ...state, phase: 'resend' }); return }
    if (confirming) { setDialog({ ...state, phase: 'unknownOffline' }); return }
    await submitPayAgain.current?.(state)
  }, [storeCode, view, afterRefusal, applyMeal, refreshMeal, printReceipt, say, t.payAlreadySettled, t.payKitchenNotNotified, t.voidNoticePending])
  /** One automatic re-send of the same request once the server is known to hold a payment. */
  const submitPayAgain = useRef<((state: Extract<Dialog, { kind: 'pay' }>) => Promise<void>) | null>(null)
  submitPayAgain.current = (state) => submitPay(state, true)

  const recheckPay = useCallback(async (state: Extract<Dialog, { kind: 'pay' }>) => {
    if (!storeCode || view.kind === 'tables') return
    setDialog({ ...state, phase: 'unknown' })
    const fresh = await refreshMeal(storeCode, view.mealId)
    if (!fresh) { setDialog({ ...state, phase: 'unknownOffline' }); return }
    if (fresh.state === 'OPEN') { setDialog({ ...state, phase: 'resend' }); return }
    await submitPay(state, true)
  }, [storeCode, view, refreshMeal, submitPay])

  const submitEnd = useCallback(async (state: Extract<Dialog, { kind: 'end' }>) => {
    if (!storeCode || view.kind === 'tables') return
    setDialog({ ...state, phase: 'submitting' })
    const path = `sessions/${encodeURIComponent(view.mealId)}`
    const result = state.action === 'clear'
      ? await api<EndMealResult>(storeCode, `${path}/close`, { requestKey: state.key })
      : await api<EndMealResult>(storeCode, path, { action: 'VOID', requestKey: state.key })
    if (result.kind === 'unknown') { setDialog({ ...state, phase: 'unknown' }); return }
    if (result.kind === 'refused') { afterRefusal(result.code); return }
    setDialog(null)
    // The table is free again; a void notice that has not gone out stays reachable from the table page.
    const pending = result.data.noSendEvidenceVoidSeqs
    if (pending.length > 0) say('warn', fill(t.voidNoticePending, { seqs: pending.join(', ') }))
    else setNotice(null)
    showTables()
  }, [storeCode, view, afterRefusal, showTables, say, t.voidNoticePending])

  const saveTable = useCallback(async (draft: TableDraft): Promise<boolean> => {
    if (!storeCode) return false
    setTableBusy(true)
    const result = await api<{ table: DiningTableView }>(storeCode, 'tables', draft)
    setTableBusy(false)
    if (result.kind === 'ok') { setNotice(null); await refreshTables(storeCode); return true }
    if (result.kind === 'refused') sayRefusal(result.code)
    else say('error', t.errUnknownResult)
    return false
  }, [storeCode, refreshTables, sayRefusal, say, t.errUnknownResult])

  // ── Render ────────────────────────────────────────────────────────────────
  const banners = useMemo(() => {
    const list: { tone: 'info' | 'warn' | 'error'; text: string }[] = []
    if (!online) list.push({ tone: 'error', text: t.offline })
    if (gate && !gate.eligible) list.push({ tone: 'warn', text: t.recoveryOnly })
    if (gate && !hasBridge) list.push({ tone: 'warn', text: t.notDesktop })
    if (gate?.operatorSource === 'DEVICE') list.push({ tone: 'info', text: t.deviceOwnerNotice })
    return list
  }, [online, gate, hasBridge, t])

  let body: ReactNode
  if (storeCode === null) body = <div style={s.center}>{t.loading}</div>
  else if (storeCode === '') body = <div style={s.center}>{t.storeMissing}</div>
  else if (gateProblem) {
    body = (
      <div style={s.center}>
        <p>{gateProblem === 'NETWORK' ? t.errUnknownResult : gateProblem === 'POS_DEVICE_UNAUTHORIZED' ? t.unauthorized : diningErrorText(lang, gateProblem)}</p>
        <button type="button" style={{ ...s.ghost, marginTop: 12 }} onClick={() => { void loadGate(storeCode).then((loaded) => { if (loaded?.recoveryAvailable) void refreshTables(storeCode) }) }}>{t.refresh}</button>
      </div>
    )
  } else if (!gate) body = <div style={s.center}>{t.loading}</div>
  else if (!gate.recoveryAvailable) body = <div style={s.center}>{diningErrorText(lang, 'STORE_NOT_ACTIVE')}</div>
  else if (view.kind === 'tables') {
    body = tables === null ? <div style={s.center}>{t.loading}</div> : (
      <DiningTableOverview
        t={t}
        tables={tables}
        recoverable={recoverable.items}
        recoverableHasMore={recoverable.hasMore}
        onLoadMoreRecoverable={() => { if (storeCode) void refreshTables(storeCode, 1) }}
        currencyCode={currencyCode}
        now={now}
        canOpen={canNew}
        canEdit={canNew && isOwner}
        busy={tableBusy}
        onOpenRequest={(table) => setDialog({ kind: 'open', table, guestCount: '2', note: '', key: newKey(), phase: 'idle' })}
        onEnterMeal={(mealId) => { discardCart(); setReceipt(null); showMeal(mealId) }}
        onSaveTable={saveTable}
      />
    )
  } else if (!meal || meal.mealId !== view.mealId) body = <div style={s.center}>{t.loading}</div>
  else if (view.kind === 'menu' && meal.state === 'OPEN') {
    body = (
      <>
        {orderPhase === 'unknown' && (
          <div style={{ ...s.banner, ...s.error }}>
            <span>{t.errUnknownResult}</span>
            <button type="button" style={s.bannerBtn} onClick={() => { void submitOrder() }}>{t.retrySame}</button>
          </div>
        )}
        <DiningProductPicker
          t={t}
          meal={meal}
          products={catalog?.products ?? []}
          categories={catalog?.categories ?? []}
          currencyCode={currencyCode}
          cart={cart}
          frozen={orderPhase === 'unknown'}
          submitting={orderPhase === 'submitting'}
          canSubmit={canNew}
          onChange={(barcode, delta) => { cartKey.current = null; setCart((previous) => {
            const quantity = Math.max(0, Math.min(999, (previous[barcode] ?? 0) + delta))
            const next = { ...previous }
            if (quantity === 0) delete next[barcode]
            else next[barcode] = quantity
            return next
          }) }}
          onSubmit={() => { void submitOrder() }}
          onBack={() => {
            if (orderPhase !== 'idle') return
            if (Object.keys(cart).length > 0) setDialog({ kind: 'discard' })
            else showMeal(view.mealId)
          }}
        />
      </>
    )
  } else {
    body = (
      <DiningMealBill
        t={t}
        lang={lang}
        meal={meal}
        currencyCode={currencyCode}
        isOwner={isOwner}
        online={online}
        canAdd={canNew && meal.state === 'OPEN'}
        submittingNotices={submittingNotices}
        receiptMessage={receipt?.mealId === meal.mealId ? receipt.text : null}
        receiptBusy={receiptBusy}
        onBack={showTables}
        onAdd={() => showMenu(meal.mealId)}
        onVoidLine={(line) => {
          const origin = meal.batches.find((batch) => batch.kind === 'ORDER' && batch.lines.some((entry) => entry.saleRecordId === line.saleRecordId))
          setDialog({ kind: 'void', line, reason: '', needConfirm: Boolean(line.kitchen && origin?.notice.status === 'UNKNOWN'), kitchenConfirmed: false, key: newKey(), phase: 'idle' })
        }}
        onCheckout={() => setDialog({ kind: 'pay', method: 'CASH', amount: meal.unpaidAmount, version: meal.version, key: newKey(), phase: 'idle' })}
        onClear={() => setDialog({ kind: 'end', action: 'clear', key: newKey(), phase: 'idle' })}
        onVoidMeal={() => setDialog({ kind: 'end', action: 'voidMeal', key: newKey(), phase: 'idle' })}
        onSubmitNotice={(batch) => { void submitNotice(meal.mealId, batch.id) }}
        onRenotify={(batch) => setDialog({ kind: 'renotify', batch, reason: '', accepted: false, key: newKey(), phase: 'idle' })}
        onPrintReceipt={() => { void printReceipt(meal) }}
      />
    )
  }

  const busyDialog = dialog !== null && dialog.kind !== 'discard' && dialog.phase === 'submitting'
  // For these dialogs closing is safe: if the lost request did land, a later attempt
  // with a new key is refused by the server's own state. (Payment has its own flow.)
  const unknownLine = (retry: () => void) => (
    <div style={{ ...s.dWarn, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span>{t.errUnknownResult}</span>
      <button type="button" style={{ ...s.primary, flex: 'none' }} onClick={retry}>{t.retrySame}</button>
      <button
        type="button"
        style={{ ...s.ghost, minHeight: 44 }}
        onClick={() => {
          setDialog(null)
          if (!storeCode) return
          const current = viewRef.current
          if (current.kind === 'tables') void refreshTables(storeCode)
          else void refreshMeal(storeCode, current.mealId)
        }}
      >
        {t.close}
      </button>
    </div>
  )
  /** Information only. It never disables a button: a kitchen notice is not a condition of payment. */
  const kitchenInfo = (template: string, seqs: number[] | undefined) => (seqs && seqs.length > 0
    ? <div style={s.dWarn} data-kitchen-info>{fill(template, { seqs: seqs.join(', ') })}</div>
    : null)

  return (
    <div style={s.root} data-dine-in-root>
      <header style={s.top}>
        <span style={s.topTitle}>{t.title}</span>
        <span style={s.topStore}>{gate?.store.name ?? storeCode ?? ''}</span>
        <span style={s.spacer} />
        {storeCode && gate?.recoveryAvailable && (
          <button type="button" style={s.topBtn} onClick={() => { void loadGate(storeCode); if (view.kind === 'tables') void refreshTables(storeCode); else void refreshMeal(storeCode, view.mealId) }}>{t.refresh}</button>
        )}
        {storeCode && <button type="button" style={s.topBtn} onClick={backToCashier}>{t.backToCashier}</button>}
      </header>
      <main style={s.main}>
        {banners.map((entry) => <div key={entry.text} style={{ ...s.banner, ...s[entry.tone] }}>{entry.text}</div>)}
        {notice && (
          <div style={{ ...s.banner, ...s[notice.tone] }} role="alert">
            <span style={{ flex: 1 }}>{notice.text}</span>
            <button type="button" style={s.bannerBtn} onClick={() => setNotice(null)}>{t.close}</button>
          </div>
        )}
        {body}
      </main>

      {dialog?.kind === 'open' && (
        <div style={s.overlay} role="dialog" aria-modal="true" aria-label={t.openTable}>
          <div style={s.dialog}>
            <div style={s.dTitle}>{t.openTable} · {dialog.table.name}</div>
            <label style={s.label}>{t.guestCount}</label>
            <div style={s.steps}>
              <button type="button" style={s.step} disabled={dialog.phase !== 'idle'} onClick={() => setDialog({ ...dialog, guestCount: String(Math.max(1, (Number.parseInt(dialog.guestCount, 10) || 1) - 1)) })}>−</button>
              <input style={{ ...s.input, textAlign: 'center', fontSize: 22, fontWeight: 900 }} inputMode="numeric" value={dialog.guestCount} disabled={dialog.phase !== 'idle'} aria-label={t.guestCount} onChange={(event) => setDialog({ ...dialog, guestCount: event.target.value.replace(/\D/g, '').slice(0, 3) })} />
              <button type="button" style={s.step} disabled={dialog.phase !== 'idle'} onClick={() => setDialog({ ...dialog, guestCount: String(Math.min(999, (Number.parseInt(dialog.guestCount, 10) || 0) + 1)) })}>+</button>
            </div>
            <label style={s.label}>{t.noteOptional}</label>
            <input style={s.input} value={dialog.note} maxLength={200} disabled={dialog.phase !== 'idle'} aria-label={t.note} onChange={(event) => setDialog({ ...dialog, note: event.target.value })} />
            {dialog.phase === 'unknown' ? unknownLine(() => { void submitOpen(dialog) }) : (
              <div style={s.actions}>
                <button type="button" style={s.ghost} disabled={busyDialog} onClick={() => setDialog(null)}>{t.cancel}</button>
                <button type="button" style={{ ...s.primary, opacity: busyDialog || !(Number.parseInt(dialog.guestCount, 10) >= 1) ? 0.5 : 1 }} disabled={busyDialog || !(Number.parseInt(dialog.guestCount, 10) >= 1)} onClick={() => { void submitOpen(dialog) }}>
                  {busyDialog ? t.paySubmitting : t.confirmOpen}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {dialog?.kind === 'void' && (
        <div style={s.overlay} role="dialog" aria-modal="true" aria-label={t.voidDialogTitle}>
          <div style={s.dialog}>
            <div style={s.dTitle}>{t.voidDialogTitle}</div>
            <div style={s.dText}><strong>{dialog.line.name}</strong> ×{dialog.line.quantity} · {formatMoney(Number(dialog.line.lineAmount), currencyCode)}</div>
            <div style={s.dText}>{t.voidWholeLineOnly}</div>
            <label style={s.label}>{t.voidReason}</label>
            <input style={s.input} value={dialog.reason} maxLength={200} disabled={dialog.phase !== 'idle'} aria-label={t.voidReason} onChange={(event) => setDialog({ ...dialog, reason: event.target.value })} />
            {dialog.needConfirm && (
              <>
                <div style={s.dWarn}>{t.kitchenConfirmWhy}</div>
                <label style={s.check}>
                  <input type="checkbox" style={{ width: 22, height: 22 }} checked={dialog.kitchenConfirmed} disabled={dialog.phase !== 'idle'} onChange={(event) => setDialog({ ...dialog, kitchenConfirmed: event.target.checked })} />
                  <span>{t.kitchenConfirmLabel}</span>
                </label>
              </>
            )}
            {dialog.phase === 'unknown' ? unknownLine(() => { void submitVoid(dialog) }) : (() => {
              const ready = dialog.reason.trim().length > 0 && (!dialog.needConfirm || dialog.kitchenConfirmed) && !busyDialog
              return (
                <div style={s.actions}>
                  <button type="button" style={s.ghost} disabled={busyDialog} onClick={() => setDialog(null)}>{t.cancel}</button>
                  <button type="button" style={{ ...s.primary, ...s.red, opacity: ready ? 1 : 0.5 }} disabled={!ready} onClick={() => { void submitVoid(dialog) }}>{busyDialog ? t.paySubmitting : t.confirmVoid}</button>
                </div>
              )
            })()}
          </div>
        </div>
      )}

      {dialog?.kind === 'renotify' && (
        <div style={s.overlay} role="dialog" aria-modal="true" aria-label={t.renotifyTitle}>
          <div style={s.dialog}>
            <div style={s.dTitle}>{t.renotifyTitle} · {fill(t.batchNo, { n: dialog.batch.seq })}</div>
            {dialog.batch.notice.duplicateRisk ? (
              <>
                <div style={s.dWarn}>{t.renotifyDuplicateWarn}</div>
                <label style={s.check}>
                  <input type="checkbox" style={{ width: 22, height: 22 }} checked={dialog.accepted} disabled={dialog.phase !== 'idle'} onChange={(event) => setDialog({ ...dialog, accepted: event.target.checked })} />
                  <span>{t.renotifyAck}</span>
                </label>
              </>
            ) : <div style={s.dText}>{t.renotifySafe}</div>}
            <label style={s.label}>{t.renotifyReason}</label>
            <input style={s.input} value={dialog.reason} maxLength={200} disabled={dialog.phase !== 'idle'} aria-label={t.renotifyReason} onChange={(event) => setDialog({ ...dialog, reason: event.target.value })} />
            {dialog.phase === 'unknown' ? unknownLine(() => { void submitRenotify(dialog) }) : (() => {
              const ready = dialog.reason.trim().length > 0 && (!dialog.batch.notice.duplicateRisk || dialog.accepted) && !busyDialog
              return (
                <div style={s.actions}>
                  <button type="button" style={s.ghost} disabled={busyDialog} onClick={() => setDialog(null)}>{t.cancel}</button>
                  <button type="button" style={{ ...s.primary, opacity: ready ? 1 : 0.5 }} disabled={!ready} onClick={() => { void submitRenotify(dialog) }}>{busyDialog ? t.paySubmitting : t.confirmRenotify}</button>
                </div>
              )
            })()}
          </div>
        </div>
      )}

      {dialog?.kind === 'pay' && (
        <div style={s.overlay} role="dialog" aria-modal="true" aria-label={t.payTitle}>
          <div style={s.dialog}>
            <div style={s.dTitle}>{t.payTitle}{meal ? ` · ${meal.table.name}` : ''}</div>
            <div style={s.label}>{t.due}</div>
            <div style={s.bigAmount}>{formatMoney(Number(dialog.amount), currencyCode)}</div>
            {dialog.phase === 'idle' || dialog.phase === 'submitting' ? (
              <>
                <div style={s.seg}>
                  <button type="button" style={{ ...s.segBtn, ...(dialog.method === 'CASH' ? s.segOn : {}) }} disabled={dialog.phase !== 'idle'} onClick={() => setDialog({ ...dialog, method: 'CASH' })}>{t.payCash}</button>
                  <button type="button" style={{ ...s.segBtn, ...(dialog.method === 'KHQR' ? s.segOn : {}), ...(isKhqrSupportedCurrency(currencyCode) ? {} : { opacity: 0.45 }) }} disabled={dialog.phase !== 'idle' || !isKhqrSupportedCurrency(currencyCode)} title={isKhqrSupportedCurrency(currencyCode) ? undefined : t.payKhqrUnsupported} onClick={() => setDialog({ ...dialog, method: 'KHQR' })}>{t.payKhqr}</button>
                </div>
                <div style={s.dText}>{dialog.method === 'KHQR' ? t.payKhqrHint : t.payCashHint}</div>
                {kitchenInfo(t.pendingNoticesInfo, meal?.noSendEvidence.orderSeqs)}
                {kitchenInfo(t.voidNoticePending, meal?.noSendEvidence.voidSeqs)}
                <div style={s.actions}>
                  <button type="button" style={s.ghost} disabled={dialog.phase !== 'idle'} onClick={() => setDialog(null)}>{t.cancel}</button>
                  <button type="button" style={{ ...s.primary, ...s.green, opacity: dialog.phase === 'idle' ? 1 : 0.5 }} disabled={dialog.phase !== 'idle'} onClick={() => { void submitPay(dialog) }}>
                    {dialog.phase === 'submitting' ? t.paySubmitting : fill(t.confirmReceived, { amount: formatMoney(Number(dialog.amount), currencyCode) })}
                  </button>
                </div>
              </>
            ) : dialog.phase === 'unknown' ? (
              <div style={s.dWarn}>{t.payUnknown}</div>
            ) : dialog.phase === 'unknownOffline' ? (
              <>
                <div style={s.dWarn}>{t.payUnknownOffline}</div>
                <button type="button" style={{ ...s.primary, flex: 'none' }} onClick={() => { void recheckPay(dialog) }}>{t.payCheckAgain}</button>
              </>
            ) : (
              <>
                <div style={s.dWarn}>{t.payResend}</div>
                <div style={s.actions}>
                  <button type="button" style={s.ghost} onClick={() => setDialog(null)}>{t.cancel}</button>
                  <button type="button" style={{ ...s.primary, ...s.green }} onClick={() => { void submitPay(dialog) }}>{fill(t.confirmReceived, { amount: formatMoney(Number(dialog.amount), currencyCode) })}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {dialog?.kind === 'end' && (
        <div style={s.overlay} role="dialog" aria-modal="true" aria-label={dialog.action === 'clear' ? t.clearTable : t.voidMeal}>
          <div style={s.dialog}>
            <div style={s.dTitle}>{dialog.action === 'clear' ? t.clearTable : t.voidMeal}{meal ? ` · ${meal.table.name}` : ''}</div>
            <div style={s.dText}>{dialog.action === 'clear' ? t.clearConfirm : t.voidMealConfirm}</div>
            {dialog.phase !== 'unknown' && kitchenInfo(t.voidNoticePending, meal?.noSendEvidence.voidSeqs)}
            {dialog.phase === 'unknown' ? unknownLine(() => { void submitEnd(dialog) }) : (
              <div style={s.actions}>
                <button type="button" style={s.ghost} disabled={busyDialog} onClick={() => setDialog(null)}>{t.cancel}</button>
                <button type="button" style={{ ...s.primary, ...(dialog.action === 'clear' ? s.green : s.red), opacity: busyDialog ? 0.5 : 1 }} disabled={busyDialog} onClick={() => { void submitEnd(dialog) }}>
                  {busyDialog ? t.paySubmitting : dialog.action === 'clear' ? t.clearTable : t.voidMeal}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {dialog?.kind === 'discard' && view.kind !== 'tables' && (
        <div style={s.overlay} role="dialog" aria-modal="true" aria-label={t.thisBatch}>
          <div style={s.dialog}>
            <div style={s.dText}>{t.discardCartConfirm}</div>
            <div style={s.actions}>
              <button type="button" style={s.ghost} onClick={() => setDialog(null)}>{t.cancel}</button>
              <button type="button" style={{ ...s.primary, ...s.red }} onClick={() => { setDialog(null); discardCart(); showMeal(view.mealId) }}>{t.viewBill}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
