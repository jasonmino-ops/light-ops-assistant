'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useWorkMode } from '@/app/components/WorkModeProvider'
import { apiFetch, OWNER_CTX } from '@/lib/api'
import {
  inventoryProfitError,
  telegramPresenceHeaders,
  TELEGRAM_PRESENCE_REQUIRED,
} from '@/lib/inventory-profit/client'
import styles from '../inventory-profit.module.css'

const DEV_CTX = process.env.NODE_ENV !== 'production' ? OWNER_CTX : undefined

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

export default function InventoryPage() {
  const { effectiveRole } = useWorkMode()
  const [snapshot, setSnapshot] = useState<InventoryResponse | null>(null)
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [minimumStock, setMinimumStock] = useState('10')
  const [productId, setProductId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [date, setDate] = useState(localDate)
  const [requestKey, setRequestKey] = useState(newRequestKey)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await apiFetch('/api/inventory-profit/inventory?all=1', { cache: 'no-store' }, DEV_CTX)
      if (!response.ok) throw new Error(await inventoryProfitError(response))
      const body = await response.json() as InventoryResponse
      setSnapshot(body)
      setMinimumStock(String(body.items[0]?.minimumStock ?? 10))
      setProductId((current) => current || body.items[0]?.productId || '')
    } catch (failure) {
      setSnapshot(null)
      setError(failure instanceof Error ? failure.message : '数据暂时无法更新')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (effectiveRole === 'OWNER') void load()
  }, [effectiveRole, load])

  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return (snapshot?.items ?? []).filter((item) => {
      if (!showAll && item.alert === null) return false
      if (!normalized) return true
      return [item.name, item.barcode, item.sku ?? '']
        .some((value) => value.toLocaleLowerCase().includes(normalized))
    })
  }, [query, showAll, snapshot])

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
      const body = await response.json() as { data: { duplicate: boolean } }
      setMessage(body.data.duplicate ? '该进货请求已记录，未重复入账' : '进货已记录')
      setQuantity('')
      setUnitCost('')
      setRequestKey(newRequestKey())
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

  if (effectiveRole !== 'OWNER') {
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
                  {item.alert ? <span className={styles.badge}>{ALERT_LABELS[item.alert]}</span> : null}
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
                商品
                <select className={styles.select} required value={productId} onChange={(event) => setProductId(event.target.value)}>
                  <option value="">请选择</option>
                  {(snapshot?.items ?? []).map((item) => <option key={item.productId} value={item.productId}>{item.name} · {item.sku || item.barcode}</option>)}
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
            <button type="submit" className={styles.primary} disabled={saving || !snapshot?.items.length}>
              {saving ? '提交中…' : '确认入账'}
            </button>
          </form>
        </section>
      </div>
    </main>
  )
}
