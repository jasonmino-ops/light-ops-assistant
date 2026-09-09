'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useLocale } from '@/app/components/LangProvider'
import LangToggleBtn from '@/app/components/LangToggleBtn'
import { apiFetch, OWNER_CTX } from '@/lib/api'
import { readEshopTray02CloudEnableState, type EshopTray02CloudEnableState } from '@/lib/eShopTrayCloudClient'
import { COPY, displayError } from '@/lib/product-sales/copy'
import { reportPrintHtml } from '@/lib/product-sales/print'
import { createProductReportPrintAction } from '@/lib/product-sales/print-action'
import { reportPeriodPresentation } from '@/lib/product-sales/presentation'
import { productKey, type GroupView, type Period, type ProductRef, type ProductSalesResult, type ReportStore, type Selection } from '@/lib/product-sales/contract'
import styles from './page.module.css'

const DEV_CTX = process.env.NODE_ENV !== 'production' ? OWNER_CTX : undefined
const BASE = '/api/owner/product-sales'
type ProductOption = ProductRef & { name: string; barcode: string; status: string }
type Options = { today: string; stores: ReportStore[]; products: ProductOption[]; nextCursor: string | null }
type HistoryItem = { id: string; groupId: string; reportDate: string; generatedAt: string; name: string }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(`${BASE}${path}`, { cache: 'no-store', ...init }, DEV_CTX)
  const body = await response.json().catch(() => null)
  if (!response.ok || body === null) throw new Error(body?.error ?? 'INTERNAL_ERROR')
  return body as T
}

export default function ProductSalesPage() {
  const { lang } = useLocale()
  const copy = COPY[lang]
  const [stores, setStores] = useState<ReportStore[]>([])
  const [products, setProducts] = useState<ProductOption[]>([])
  const labels = useRef(new Map<string, ProductOption>())
  const [selected, setSelected] = useState<ProductRef[]>([])
  const [storeId, setStoreId] = useState('')
  const [search, setSearch] = useState('')
  const [productCursor, setProductCursor] = useState<string | null>(null)
  const [today, setToday] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [period, setPeriod] = useState<Period>('TODAY')
  const [groups, setGroups] = useState<GroupView[]>([])
  const [active, setActive] = useState<GroupView | null>(null)
  const [name, setName] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [historyCursor, setHistoryCursor] = useState<string | null>(null)
  const [result, setResult] = useState<ProductSalesResult | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [printState, setPrintState] = useState<EshopTray02CloudEnableState>('pending')
  const printAction = useRef(createProductReportPrintAction())
  const [optionsBusy, setOptionsBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [optionsRevision, setOptionsRevision] = useState(0)
  const queryAttempt = useRef(0)
  const optionsAttempt = useRef(0)
  const requestId = useRef<string | null>(null)
  const mounted = useRef(true)
  function invalidate() { queryAttempt.current++; setResult(null); setMessage(''); setError('') }

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; queryAttempt.current++; optionsAttempt.current++ }
  }, [])
  useEffect(() => {
    let active = true
    void readEshopTray02CloudEnableState().then((state) => { if (active) setPrintState(state) })
    return () => { active = false }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    const attempt = ++optionsAttempt.current
    setOptionsBusy(true); setReady(false)
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q: search })
      if (storeId) params.set('storeId', storeId)
      request<Options>(`/options?${params}`, { signal: controller.signal }).then((data) => {
        if (attempt !== optionsAttempt.current || !mounted.current) return
        setStores(data.stores); setProducts(data.products); setProductCursor(data.nextCursor); setToday(data.today)
        setDateFrom((current) => current || data.today); setDateTo((current) => current || data.today)
        for (const product of data.products) labels.current.set(productKey(product), product)
        setReady(true)
      }).catch((failure) => { if (!controller.signal.aborted && attempt === optionsAttempt.current && mounted.current) { setError(failure.message); setReady(false); setProducts([]); setProductCursor(null); setResult(null) } })
        .finally(() => { if (attempt === optionsAttempt.current && mounted.current) setOptionsBusy(false) })
    }, search ? 250 : 0)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [search, storeId, optionsRevision])
  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      request<GroupView[]>('/groups', { signal: controller.signal }),
      request<{ reports: HistoryItem[]; nextCursor: string | null }>('/reports', { signal: controller.signal }),
    ]).then(([savedGroups, reports]) => {
      if (controller.signal.aborted) return
      setGroups(savedGroups); setHistory(reports.reports); setHistoryCursor(reports.nextCursor)
    }).catch((failure) => { if (!controller.signal.aborted) setError(failure.message) })
    return () => controller.abort()
  }, [])

  async function runQuery(selection: Selection = { products: selected, storeId: storeId || null }, groupName?: string) {
    const attempt = ++queryAttempt.current
    setBusy(true); setError(''); setMessage(''); setResult(null)
    try {
      const data = await request<ProductSalesResult>('/query', { method: 'POST', body: JSON.stringify({ ...selection, period, dateFrom, dateTo }) })
      if (attempt === queryAttempt.current && mounted.current) setResult(groupName ? { ...data, groupName } : data)
    } catch (failure) { if (attempt === queryAttempt.current && mounted.current) setError((failure as Error).message) }
    finally { if (mounted.current) setBusy(false) }
  }
  function applyGroup(group: GroupView) {
    invalidate(); setActive(group); setName(group.name); setEnabled(group.enabled)
    setSelected(group.selection.products); setStoreId(group.selection.storeId ?? ''); setSearch('')
    requestId.current = null
    void runQuery(group.selection, group.name)
  }
  function newGroup() {
    invalidate(); setActive(null); setName(''); setEnabled(true); requestId.current = null
  }
  async function saveGroup(disable = false) {
    setBusy(true); setError(''); setMessage('')
    try {
      if (!active && !requestId.current) requestId.current = crypto.randomUUID()
      const body = disable && active ? { enabled: false, updatedAt: active.updatedAt } : {
        id: active?.id ?? requestId.current, name, enabled, selection: { products: selected, storeId: storeId || null }, updatedAt: active?.updatedAt,
      }
      const saved = await request<GroupView>(active ? `/groups/${active.id}` : '/groups', { method: active ? 'PATCH' : 'POST', body: JSON.stringify(body) })
      if (!mounted.current) return
      setGroups((current) => [saved, ...current.filter((group) => group.id !== saved.id)])
      setActive(saved); setName(saved.name); setEnabled(saved.enabled); requestId.current = null
      setMessage(copy.saved)
    } catch (failure) {
      if (mounted.current) setError((failure as Error).message)
      if ((failure as Error).message === 'GROUP_CHANGED') {
        const refreshed = await request<GroupView[]>('/groups').catch(() => null)
        if (refreshed && mounted.current) { setGroups(refreshed); setActive(null) }
      }
    } finally { if (mounted.current) setBusy(false) }
  }
  async function moreProducts() {
    if (!productCursor) return
    const attempt = optionsAttempt.current
    setOptionsBusy(true)
    try {
      const params = new URLSearchParams({ q: search, cursor: productCursor })
      if (storeId) params.set('storeId', storeId)
      const data = await request<Options>(`/options?${params}`)
      if (attempt !== optionsAttempt.current || !mounted.current) return
      setProducts((current) => [...current, ...data.products]); setProductCursor(data.nextCursor)
      for (const product of data.products) labels.current.set(productKey(product), product)
    } catch (failure) { if (mounted.current) setError((failure as Error).message) }
    finally { if (attempt === optionsAttempt.current && mounted.current) setOptionsBusy(false) }
  }
  async function moreHistory() {
    if (!historyCursor) return
    setBusy(true)
    try {
      const data = await request<{ reports: HistoryItem[]; nextCursor: string | null }>(`/reports?cursor=${encodeURIComponent(historyCursor)}`)
      if (mounted.current) { setHistory((current) => [...current, ...data.reports]); setHistoryCursor(data.nextCursor) }
    } catch (failure) { if (mounted.current) setError((failure as Error).message) }
    finally { if (mounted.current) setBusy(false) }
  }
  async function openHistory(id: string) {
    const attempt = ++queryAttempt.current
    setBusy(true); setError(''); setMessage(''); setResult(null)
    try {
      const data = await request<{ result: ProductSalesResult }>(`/reports/${id}`)
      if (attempt === queryAttempt.current && mounted.current) setResult(data.result)
    } catch (failure) { if (attempt === queryAttempt.current && mounted.current) setError((failure as Error).message) }
    finally { if (mounted.current) setBusy(false) }
  }
  async function print() {
    if (!result || busy || printState === 'pending') return
    setError(''); setMessage(''); setBusy(true)
    try {
      const outcome = await printAction.current(reportPrintHtml(result, lang), printState, () => { if (mounted.current) setBusy(false) })
      if (outcome === 'submitted' && mounted.current) setMessage(copy.printSent)
    } catch (failure) {
      if (mounted.current) { setError((failure as Error).message === 'PRINT_TOO_LARGE' ? 'PRINT_TOO_LARGE' : 'PRINT_FAILED'); setBusy(false) }
    }
  }
  const selectedKeys = new Set(selected.map(productKey))
  const resultPeriod = result && reportPeriodPresentation(result, lang)

  return <main className={styles.page}>
    <header className={styles.header}><Link href="/dashboard">‹ {copy.back}</Link><LangToggleBtn /></header>
    <h1>{copy.title}</h1><p className={styles.muted}>{copy.intro}</p>
    <p className={styles.notice}>{copy.rule}</p>
    {error && <p role="alert" className={styles.error}>{error === 'PRINT_FAILED' ? copy.printFailed : error === 'PRINT_TOO_LARGE' ? copy.printTooLarge : displayError(error, lang)}</p>}
    {message && <p role="status" className={styles.notice}>{message}</p>}
    <fieldset disabled={busy} className={styles.fieldset}>
      <section className={styles.card}>
        <div className={styles.row}><h2>{copy.groups}</h2><button type="button" onClick={newGroup}>{copy.newGroup}</button></div>
        <div className={styles.chips}>{groups.map((group) => <button key={group.id} type="button" aria-pressed={active?.id === group.id} onClick={() => applyGroup(group)}>{group.name}{group.enabled ? '' : ` · ${copy.disabled}`}</button>)}</div>
        {!groups.length && <p className={styles.muted}>{copy.emptyGroups}</p>}
      </section>
      <section className={styles.card}>
        <label className={styles.label}>{copy.stores}<select value={storeId} onChange={(event) => {
          invalidate(); const next = event.target.value; setStoreId(next)
          const tenant = stores.find((store) => store.storeId === next)?.tenantId
          if (tenant) setSelected((current) => current.filter((product) => product.tenantId === tenant))
        }}><option value="">{copy.allStores}</option>{storeId && !stores.some((store) => store.storeId === storeId) && <option value={storeId} disabled>{copy.unavailableStore}</option>}{stores.map((store) => <option key={store.storeId} value={store.storeId}>{store.storeName} · {store.currencyCode}</option>)}</select></label>
        {!ready && !optionsBusy && <button type="button" onClick={() => { setError(''); setOptionsRevision((value) => value + 1) }}>{copy.retry}</button>}
        <div className={styles.periods}>{(['TODAY', 'YESTERDAY', 'WEEK', 'MONTH', 'CUSTOM'] as Period[]).map((value) => <button key={value} type="button" aria-pressed={period === value} onClick={() => { invalidate(); setPeriod(value) }}>{copy[value]}</button>)}</div>
        {period === 'CUSTOM' && <div className={styles.row}>
          <label className={styles.label}>{copy.from}<input type="date" value={dateFrom} max={dateTo || today} onChange={(event) => { invalidate(); setDateFrom(event.target.value) }} /></label>
          <label className={styles.label}>{copy.to}<input type="date" value={dateTo} min={dateFrom} max={today} onChange={(event) => { invalidate(); setDateTo(event.target.value) }} /></label>
        </div>}
        <h2>{copy.products}</h2><input type="search" aria-label={copy.search} placeholder={copy.search} value={search} maxLength={100} onChange={(event) => setSearch(event.target.value)} />
        <div className={styles.productList} aria-busy={optionsBusy}>{products.map((product) => <label key={productKey(product)} className={styles.product}>
          <input type="checkbox" checked={selectedKeys.has(productKey(product))} disabled={optionsBusy || (!selectedKeys.has(productKey(product)) && selected.length >= 100)} onChange={(event) => {
            invalidate(); setSelected((current) => event.target.checked ? [...current, { tenantId: product.tenantId, productId: product.productId }] : current.filter((item) => productKey(item) !== productKey(product)))
          }} /><span><strong>{product.name}</strong><small>{product.barcode} · {stores.filter((store) => store.tenantId === product.tenantId).map((store) => store.storeName).join(', ')}</small></span>
        </label>)}</div>
        {!products.length && !optionsBusy && <p className={styles.muted}>{copy.emptyProducts}</p>}
        {productCursor && <button type="button" disabled={optionsBusy} onClick={moreProducts}>{copy.more}</button>}
        <p>{copy.selected}: {selected.length}/100</p>
        <div className={styles.chips}>{selected.map((product) => <button type="button" key={productKey(product)} aria-label={`${copy.remove} ${labels.current.get(productKey(product))?.name ?? product.productId}`} onClick={() => { invalidate(); setSelected((current) => current.filter((item) => productKey(item) !== productKey(product))) }}>{labels.current.get(productKey(product))?.name ?? product.productId} ×</button>)}</div>
        <button type="button" className={styles.primary} disabled={!ready || !selected.length} onClick={() => runQuery()}>{copy.query}</button>
        <hr /><label className={styles.label}>{copy.name}<input value={name} maxLength={80} onChange={(event) => { setName(event.target.value); requestId.current = null }} /></label>
        <label className={styles.check}><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />{copy.enabled}</label>
        <div className={styles.row}><button type="button" disabled={!ready || !name.trim() || !selected.length} onClick={() => saveGroup()}>{active ? copy.update : copy.save}</button>{active?.enabled && <button type="button" onClick={() => saveGroup(true)}>{copy.disable}</button>}</div>
      </section>
    </fieldset>
    {busy && <p role="status">{copy.working}</p>}
    <section className={styles.card} aria-label={copy.title}>
      {result ? <>
        <div className={styles.row}><h2>{result.groupName ?? copy.title}</h2><button type="button" disabled={busy || printState === 'pending'} onClick={print}>{copy.print}</button></div>
        <p>{resultPeriod?.interval}</p><p className={styles.notice}>{resultPeriod?.status}</p>
        {resultPeriod?.legacy && <p className={styles.notice}>{resultPeriod.legacy}</p>}
        <p className={styles.muted}>{copy.generated}: {new Date(result.generatedAt).toLocaleString(lang, { timeZone: result.range.timezone })}</p>
        <p className={styles.muted}>{copy.printTarget}</p>
        <p className={styles.muted}>{copy.moneyNote}</p>
        {!!result.unidentifiedSales && <p role="alert" className={styles.error}>{copy.incomplete}</p>}
        {!!result.unidentifiedRefunds && <p role="alert" className={styles.error}>{copy.refundIncomplete}</p>}
        <div className={styles.tableScroll}><table><thead><tr><th>{copy.product}</th><th>{copy.store}</th><th>{copy.quantity}</th><th>{copy.amount}</th><th>{copy.refund}</th></tr></thead><tbody>{result.rows.map((row) => {
          const store = result.stores.find((item) => item.storeId === row.storeId)
          return <tr key={`${row.storeId}:${productKey(row)}`}><td>{row.name}<small>{row.barcode}</small></td><td>{store?.storeName}</td><td>{row.quantity}</td><td>{row.salesAmount} {store?.currencyCode}</td><td>{row.refundAmount} {store?.currencyCode}</td></tr>
        })}</tbody></table></div>
        <h3>{copy.totals}</h3>{result.totals.map((total) => <p key={total.currencyCode}>{total.currencyCode} · {copy.quantity} {total.quantity} · {copy.amount} <strong>{total.salesAmount}</strong> · {copy.refund} {total.refundAmount}</p>)}
      </> : <p className={styles.muted}>{copy.noResult}</p>}
    </section>
    <section className={styles.card}><h2>{copy.history}</h2><p className={styles.muted}>{copy.historyNote}</p>
      <div className={styles.history}>{history.map((report) => <button type="button" disabled={busy} key={report.id} onClick={() => openHistory(report.id)}>{report.reportDate} · {report.name} ›</button>)}</div>
      {!history.length && <p className={styles.muted}>{copy.emptyHistory}</p>}{historyCursor && <button type="button" disabled={busy} onClick={moreHistory}>{copy.more}</button>}
    </section>
  </main>
}
