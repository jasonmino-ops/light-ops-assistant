'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import BarcodeScanner from '@/app/components/BarcodeScanner'
import { useWorkMode } from '@/app/components/WorkModeProvider'
import { apiFetch, OWNER_CTX } from '@/lib/api'
import {
  inventoryProfitError,
  telegramPresenceHeaders,
  TELEGRAM_PRESENCE_REQUIRED,
} from '@/lib/inventory-profit/client'
import styles from '../inventory-profit.module.css'

const DEV_CTX = process.env.NODE_ENV !== 'production' ? OWNER_CTX : undefined
// The Pilot provider truncates inventory search results at this limit.
const INVENTORY_SEARCH_LIMIT = 5000

type InventoryAlert = 'NEGATIVE' | 'OUT_OF_STOCK' | 'LOW_STOCK' | null
type InventoryItem = {
  productId: string
  sku: string | null
  barcode: string
  name: string
  currentStock: number
  minimumStock: number
  alert: InventoryAlert
  updatedAt: string
}

type InventoryResponse = {
  asOf: string
  items: InventoryItem[]
}

const ALERT_LABELS: Record<Exclude<InventoryAlert, null>, string> = {
  NEGATIVE: '负库存',
  OUT_OF_STOCK: '缺货',
  LOW_STOCK: '低库存',
}

function localDate() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function newRequestKey() {
  return `receiving:${crypto.randomUUID()}`
}

function exactReceivingMatches(items: InventoryItem[], code: string) {
  const sku = code.toLowerCase()
  return Array.from(new Map(items
    .filter((item) => item.barcode === code || item.sku?.toLowerCase() === sku)
    .map((item) => [item.productId, item])).values())
}

export default function InventoryPage() {
  const { realRole } = useWorkMode()
  const [snapshot, setSnapshot] = useState<InventoryResponse | null>(null)
  const [defaultAlertProductIds, setDefaultAlertProductIds] = useState<Set<string>>(() => new Set())
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [minimumStock, setMinimumStock] = useState('10')
  const [productId, setProductId] = useState<string | null>(null)
  const scanVersion = useRef(0)
  const [scannerSession, setScannerSession] = useState<number | null>(null)
  const [lookingUpBarcode, setLookingUpBarcode] = useState(false)
  const [scannedItem, setScannedItem] = useState<InventoryItem | null>(null)
  const [scanError, setScanError] = useState('')
  const [canContinueScanning, setCanContinueScanning] = useState(false)
  const [manualCode, setManualCode] = useState('')
  const [manualMatches, setManualMatches] = useState<InventoryItem[]>([])
  const [manualLookupError, setManualLookupError] = useState('')
  const selectedByManualLookup = useRef(false)
  const manualCodeInput = useRef<HTMLInputElement>(null)
  const focusManualCodeAfterReceiving = useRef(false)
  const [quantity, setQuantity] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [date, setDate] = useState(localDate)
  const [requestKey, setRequestKey] = useState(newRequestKey)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    scanVersion.current += 1
    setScannerSession(null)
    setLookingUpBarcode(false)
    setScannedItem(null)
    setManualMatches([])
    setManualLookupError('')
    setLoading(true)
    setError('')
    try {
      const allResponse = await apiFetch('/api/inventory-profit/inventory?all=1', { cache: 'no-store' }, DEV_CTX)
      if (!allResponse.ok) throw new Error(await inventoryProfitError(allResponse))
      const alertResponse = await apiFetch('/api/inventory-profit/inventory', { cache: 'no-store' }, DEV_CTX)
      if (!alertResponse.ok) throw new Error(await inventoryProfitError(alertResponse))
      const body = await allResponse.json() as InventoryResponse
      const alertBody = await alertResponse.json() as InventoryResponse
      setSnapshot(body)
      setDefaultAlertProductIds(new Set(alertBody.items.map((item) => item.productId)))
      setMinimumStock(String(body.items[0]?.minimumStock ?? 10))
      setProductId((current) => current ?? body.items[0]?.productId ?? null)
    } catch (failure) {
      setSnapshot(null)
      setDefaultAlertProductIds(new Set())
      setError(failure instanceof Error ? failure.message : '数据暂时无法更新')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (realRole === 'OWNER') void load()
  }, [realRole, load])

  useEffect(() => () => { scanVersion.current += 1 }, [])

  useEffect(() => {
    const input = manualCodeInput.current
    if (!saving && !loading && focusManualCodeAfterReceiving.current && input && !input.disabled) {
      focusManualCodeAfterReceiving.current = false
      input.focus()
    }
  }, [saving, loading])

  const selectedItem = scannedItem?.productId === productId
    ? scannedItem
    : snapshot?.items.find((item) => item.productId === productId)
  const extraScanOption = scannedItem && !snapshot?.items.some((item) => item.productId === scannedItem.productId)
    ? scannedItem
    : null

  function openScanner() {
    setManualMatches([])
    setManualLookupError('')
    setScanError('')
    setCanContinueScanning(false)
    setScannerSession(++scanVersion.current)
  }

  const closeScanner = useCallback(() => {
    scanVersion.current += 1
    setScannerSession(null)
  }, [])

  function clearLookupFeedback() {
    closeScanner()
    setLookingUpBarcode(false)
    setScanError('')
    setManualMatches([])
    setManualLookupError('')
  }

  async function lookupReceivingProduct() {
    if (!snapshot || loading || saving) return
    clearLookupFeedback()
    const version = scanVersion.current
    const code = manualCode.trim()
    if (!code) {
      setManualLookupError('请输入条码或 SKU')
      return
    }
    setProductId('')
    setScannedItem(null)
    selectedByManualLookup.current = false
    setCanContinueScanning(false)
    let matches = exactReceivingMatches(snapshot.items, code)
    let resultsMayBeTruncated = snapshot.items.length >= INVENTORY_SEARCH_LIMIT
    if (matches.length === 0 && resultsMayBeTruncated) {
      setLookingUpBarcode(true)
      try {
        const response = await apiFetch(`/api/inventory-profit/inventory?all=1&q=${encodeURIComponent(code)}`, { cache: 'no-store' }, DEV_CTX)
        if (!response.ok) throw new Error(await inventoryProfitError(response))
        const { items } = await response.json() as InventoryResponse
        if (version !== scanVersion.current) return
        if (items.length >= INVENTORY_SEARCH_LIMIT) {
          setManualLookupError('查询结果过多，无法确认匹配，请从商品列表选择')
          return
        }
        matches = exactReceivingMatches(items, code)
        resultsMayBeTruncated = false
      } catch (failure) {
        if (version === scanVersion.current) {
          setManualLookupError(failure instanceof Error ? failure.message : '查询商品失败，请重试或从商品列表选择')
        }
        return
      } finally {
        if (version === scanVersion.current) setLookingUpBarcode(false)
      }
    }
    if (matches.length === 1 && !resultsMayBeTruncated) {
      selectedByManualLookup.current = true
      setScannedItem(matches[0])
      setProductId(matches[0].productId)
    } else if (matches.length > 0) {
      // A full snapshot may omit other exact matches, so don't auto-select a visible hit.
      setManualMatches(matches)
    } else {
      setManualLookupError('未找到完全匹配的条码或 SKU')
    }
  }

  const handleCameraError = useCallback((reason: string) => {
    closeScanner()
    setScanError(reason)
  }, [closeScanner])

  const handleScanned = useCallback(async (barcode: string) => {
    if (scannerSession !== scanVersion.current) return
    const version = ++scanVersion.current
    setScannerSession(null)
    selectedByManualLookup.current = false
    setProductId('')
    setScannedItem(null)
    const code = barcode.trim()
    if (!code) {
      setScanError('未识别到有效条码，请重新扫码或手动选择')
      return
    }
    setLookingUpBarcode(true)
    try {
      const response = await apiFetch(`/api/inventory-profit/inventory?all=1&q=${encodeURIComponent(code)}`, { cache: 'no-store' }, DEV_CTX)
      if (!response.ok) throw new Error(await inventoryProfitError(response))
      const { items } = await response.json() as InventoryResponse
      if (version !== scanVersion.current) return
      if (items.length >= INVENTORY_SEARCH_LIMIT) {
        setScanError('该条码的查询结果过多，无法确认唯一商品，请手动选择')
        return
      }
      const matches = items.filter((item) => item.barcode === code)
      if (matches.length === 1) {
        setScannedItem(matches[0])
        setProductId(matches[0].productId)
      } else {
        setScanError(matches.length > 1 ? '该条码匹配多个商品，请手动选择' : '未找到该条码对应的商品，请手动选择或重新扫码')
      }
    } catch (failure) {
      if (version === scanVersion.current) {
        setScanError(failure instanceof Error ? failure.message : '查询条码失败，请手动选择或重新扫码')
      }
    } finally {
      if (version === scanVersion.current) setLookingUpBarcode(false)
    }
  }, [scannerSession])

  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return (snapshot?.items ?? []).filter((item) => {
      if (!normalized && !showAll && !defaultAlertProductIds.has(item.productId)) return false
      if (!normalized) return true
      return [item.name, item.barcode, item.sku ?? '']
        .some((value) => value.toLocaleLowerCase().includes(normalized))
    })
  }, [defaultAlertProductIds, query, showAll, snapshot])

  async function saveMinimumStock() {
    const value = Number(minimumStock)
    if (!Number.isInteger(value) || value < 0) {
      setError('请输入有效的最低库存')
      return
    }
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const response = await apiFetch('/api/inventory-profit/inventory', {
        method: 'PATCH',
        body: JSON.stringify({ minimumStock: value }),
      }, DEV_CTX)
      if (!response.ok) throw new Error(await inventoryProfitError(response))
      setMessage('门店统一最低库存已更新')
      await load()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '数据暂时无法更新')
    } finally {
      setSaving(false)
    }
  }

  async function submitReceiving(event: React.FormEvent) {
    event.preventDefault()
    if (!snapshot || !productId || !selectedItem || scannerSession !== null || lookingUpBarcode || saving) return
    const presence = telegramPresenceHeaders()
    if (!presence) {
      setError(TELEGRAM_PRESENCE_REQUIRED)
      return
    }
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const response = await apiFetch('/api/inventory-profit/receivings', {
        method: 'POST',
        headers: presence,
        body: JSON.stringify({
          requestKey,
          productId,
          quantity: Number(quantity),
          unitCost: Number(unitCost),
          date,
        }),
      }, DEV_CTX)
      if (!response.ok) throw new Error(await inventoryProfitError(response))
      const body = await response.json() as { ok?: boolean; data?: { duplicate?: boolean } }
      if (body?.ok !== true || typeof body.data?.duplicate !== 'boolean') {
        throw new Error('暂时无法确认入账结果，请保留表单并重试同一请求')
      }
      setMessage(body.data.duplicate ? '该进货请求已记录，未重复入账' : '进货已记录')
      setQuantity('')
      setUnitCost('')
      setRequestKey(newRequestKey())
      selectedByManualLookup.current = false
      setProductId('')
      setManualCode('')
      setManualMatches([])
      setManualLookupError('')
      setScannedItem(null)
      setCanContinueScanning(true)
      focusManualCodeAfterReceiving.current = true
      await load()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '数据暂时无法更新')
    } finally {
      setSaving(false)
    }
  }

  async function exportCsv() {
    const presence = telegramPresenceHeaders()
    if (!presence) {
      setError(TELEGRAM_PRESENCE_REQUIRED)
      return
    }
    setSaving(true)
    setError('')
    try {
      const response = await apiFetch('/api/inventory-profit/inventory/export', {
        cache: 'no-store',
        headers: presence,
      }, DEV_CTX)
      if (!response.ok) throw new Error(await inventoryProfitError(response))
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = 'inventory.csv'
      link.click()
      URL.revokeObjectURL(url)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '数据暂时无法更新')
    } finally {
      setSaving(false)
    }
  }

  if (realRole !== 'OWNER') {
    return <main className={styles.page}><div className={styles.shell}><p className={styles.error}>仅老板可使用</p></div></main>
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <Link href="/products" className={styles.back}>‹ 返回商品</Link>
            <h1 className={styles.title}>商品库存</h1>
            <p className={styles.subtitle}>默认显示负库存、缺货和低库存商品</p>
          </div>
        </header>

        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        {message ? <p role="status" className={styles.notice}>{message}</p> : null}

        <section className={styles.panel}>
          <div className={styles.toolbar}>
            <label className={styles.field}>
              搜索商品名、条码或 SKU
              <input className={styles.input} type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <label className={styles.checkbox}>
              <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />
              显示全部库存
            </label>
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.secondary} disabled={loading || saving} onClick={() => void load()}>
              {loading ? '更新中…' : '重新加载'}
            </button>
            <button type="button" className={styles.secondary} disabled={saving} onClick={() => void exportCsv()}>
              导出全部库存 CSV
            </button>
          </div>
          <div className={styles.inventoryList} aria-live="polite">
            {visibleItems.map((item) => (
              <article key={item.productId} className={styles.inventoryItem}>
                <div>
                  <div className={styles.itemName}>{item.name}</div>
                  <div className={styles.itemMeta}>SKU：{item.sku || '—'} · 条码：{item.barcode}</div>
                  <div className={styles.itemMeta}>最低库存：{item.minimumStock}</div>
                </div>
                <div className={styles.stock}>
                  <div className={styles.stockValue}>{item.currentStock}</div>
                  {item.alert && defaultAlertProductIds.has(item.productId)
                    ? <span className={styles.badge}>{ALERT_LABELS[item.alert]}</span>
                    : null}
                </div>
              </article>
            ))}
            {!loading && snapshot && visibleItems.length === 0 ? <p className={styles.muted}>没有符合条件的商品</p> : null}
          </div>
          {snapshot ? <p className={styles.asOf}>数据截至：{new Date(snapshot.asOf).toLocaleString()}</p> : null}
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>门店统一最低库存</h2>
          <div className={styles.formRow}>
            <label className={styles.field}>
              最低库存
              <input className={styles.input} type="number" min="0" step="1" value={minimumStock} onChange={(event) => setMinimumStock(event.target.value)} />
            </label>
            <button type="button" className={styles.primary} disabled={saving} onClick={() => void saveMinimumStock()}>保存</button>
          </div>
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>录入进货</h2>
          <p className={styles.muted}>需要 Telegram 在场校验；重试同一请求不会重复入账。</p>
          <form onSubmit={submitReceiving}>
            <div className={styles.formRow}>
              <label className={styles.field}>
                条码 / SKU
                <input
                  ref={manualCodeInput}
                  className={styles.input}
                  type="text"
                  autoComplete="off"
                  value={manualCode}
                  disabled={!snapshot || loading || saving}
                  onChange={(event) => {
                    clearLookupFeedback()
                    if (selectedByManualLookup.current) {
                      selectedByManualLookup.current = false
                      setProductId('')
                      setScannedItem(null)
                    }
                    setManualCode(event.target.value)
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    if (!event.nativeEvent.isComposing && !event.repeat) void lookupReceivingProduct()
                  }}
                />
              </label>
              <button type="button" className={styles.secondary} disabled={!snapshot || loading || saving} onClick={() => void lookupReceivingProduct()}>查找</button>
            </div>
            {manualLookupError ? <p className={styles.error} role="alert">{manualLookupError}</p> : null}
            {manualMatches.length > 0 ? (
              <label className={styles.field}>
                {manualMatches.length > 1 ? '找到多个匹配商品，请选择' : '商品列表已达上限，请确认匹配商品'}
                <select className={styles.select} value="" disabled={saving} onChange={(event) => {
                  const item = manualMatches.find((match) => match.productId === event.target.value)
                  if (!item) return
                  clearLookupFeedback()
                  selectedByManualLookup.current = true
                  setScannedItem(item)
                  setProductId(item.productId)
                }}>
                  <option value="">请选择匹配商品</option>
                  {manualMatches.map((item) => <option key={item.productId} value={item.productId}>{item.name} · SKU：{item.sku || '—'} · 条码：{item.barcode || '—'}</option>)}
                </select>
              </label>
            ) : null}
            <div className={styles.formRow}>
              <label className={styles.field}>
                商品
                <select className={styles.select} required value={selectedItem ? selectedItem.productId : ''} onChange={(event) => {
                  clearLookupFeedback()
                  selectedByManualLookup.current = false
                  setProductId(event.target.value)
                }}>
                  <option value="">请选择</option>
                  {(snapshot?.items ?? []).map((item) => <option key={item.productId} value={item.productId}>{item.name} · {item.sku || item.barcode}</option>)}
                  {extraScanOption ? <option value={extraScanOption.productId}>{extraScanOption.name} · {extraScanOption.barcode}</option> : null}
                </select>
              </label>
              <label className={styles.field}>
                数量
                <input className={styles.input} type="number" min="0.0001" step="any" required value={quantity} onChange={(event) => setQuantity(event.target.value)} />
              </label>
              <label className={styles.field}>
                进货单价
                <input className={styles.input} type="number" min="0" step="0.01" required value={unitCost} onChange={(event) => setUnitCost(event.target.value)} />
              </label>
              <label className={styles.field}>
                日期
                <input className={styles.input} type="date" required value={date} onChange={(event) => setDate(event.target.value)} />
              </label>
            </div>
            {selectedItem ? (
              <p className={styles.itemMeta} aria-live="polite">
                {selectedItem.name} · 条码：{selectedItem.barcode} · 当前库存：{selectedItem.currentStock}
              </p>
            ) : null}
            {scanError ? <p className={styles.error} role="alert">{scanError}</p> : null}
            <div className={styles.actions}>
              <button type="button" className={styles.secondary} disabled={!snapshot || loading || saving || lookingUpBarcode || scannerSession !== null} onClick={openScanner}>
                {lookingUpBarcode ? '正在查询条码…' : canContinueScanning ? '继续扫码' : '扫码商品'}
              </button>
              <button type="submit" className={styles.primary} disabled={saving || !snapshot || !selectedItem || scannerSession !== null || lookingUpBarcode}>
                {saving ? '提交中…' : '确认入账'}
              </button>
            </div>
          </form>
          {scannerSession !== null ? (
            <BarcodeScanner onScanned={handleScanned} onClose={closeScanner} onCameraError={handleCameraError} />
          ) : null}
        </section>
      </div>
    </main>
  )
}
