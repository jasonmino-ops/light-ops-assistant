'use client'

import { useState, FormEvent, KeyboardEvent } from 'react'
import { apiFetch } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

type Product = {
  id: string
  barcode: string
  name: string
  spec: string | null
  sellPrice: number
}

type SaleResult = {
  id: string
  recordNo: string
  saleType: string
  lineAmount: number
  createdAt: string
}

type Status = 'idle' | 'querying' | 'submitting'

// ─── Initial state ────────────────────────────────────────────────────────────

const EMPTY = {
  barcode: '',
  quantity: '1',
  remark: '',
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SalePage() {
  const [form, setForm] = useState(EMPTY)
  const [product, setProduct] = useState<Product | null>(null)
  const [queryError, setQueryError] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [result, setResult] = useState<SaleResult | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const qty = Math.max(0, Number(form.quantity) || 0)
  const subtotal = product ? (product.sellPrice * qty).toFixed(2) : '—'

  // ── Query product ──────────────────────────────────────────────────────────

  async function queryProduct() {
    const barcode = form.barcode.trim()
    if (!barcode) return
    setQueryError(null)
    setProduct(null)
    setResult(null)
    setSubmitError(null)
    setStatus('querying')

    try {
      const res = await apiFetch(`/api/products?barcode=${encodeURIComponent(barcode)}`)
      if (res.ok) {
        setProduct(await res.json())
      } else {
        const body = await res.json().catch(() => ({}))
        setQueryError(body.error === 'PRODUCT_NOT_FOUND' ? '未找到该商品' : '查询失败，请重试')
      }
    } catch {
      setQueryError('网络错误，请重试')
    } finally {
      setStatus('idle')
    }
  }

  function handleBarcodeKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') queryProduct()
  }

  // ── Submit sale ────────────────────────────────────────────────────────────

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!product) return
    if (qty <= 0) { setSubmitError('数量必须大于 0'); return }

    setSubmitError(null)
    setResult(null)
    setStatus('submitting')

    try {
      const res = await apiFetch('/api/sales', {
        method: 'POST',
        body: JSON.stringify({
          saleType: 'SALE',
          barcode: product.barcode,
          productId: product.id,
          productNameSnapshot: product.name,
          specSnapshot: product.spec,
          unitPrice: product.sellPrice,
          quantity: qty,
          remark: form.remark.trim() || null,
        }),
      })
      const body = await res.json()
      if (res.ok) {
        setResult(body)
        setForm(EMPTY)
        setProduct(null)
      } else {
        setSubmitError(body.message ?? body.error ?? '提交失败')
      }
    } catch {
      setSubmitError('网络错误，请重试')
    } finally {
      setStatus('idle')
    }
  }

  // ── Clear ──────────────────────────────────────────────────────────────────

  function handleClear() {
    setForm(EMPTY)
    setProduct(null)
    setQueryError(null)
    setResult(null)
    setSubmitError(null)
    setStatus('idle')
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <main style={styles.page}>
      <h1 style={styles.title}>销售录入</h1>

      {/* ── Success result card ── */}
      {result && (
        <div style={styles.resultCard}>
          <div style={styles.resultTitle}>✓ 销售成功</div>
          <div style={styles.resultRow}>
            <span style={styles.resultLabel}>单号</span>
            <span style={styles.resultValue}>{result.recordNo}</span>
          </div>
          <div style={styles.resultRow}>
            <span style={styles.resultLabel}>金额</span>
            <span style={styles.resultValue}>¥ {result.lineAmount.toFixed(2)}</span>
          </div>
          <div style={styles.resultRow}>
            <span style={styles.resultLabel}>时间</span>
            <span style={styles.resultValue}>
              {new Date(result.createdAt).toLocaleTimeString('zh-CN')}
            </span>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} style={styles.form}>

        {/* ── Barcode ── */}
        <div style={styles.group}>
          <label style={styles.label}>条码</label>
          <div style={styles.row}>
            <input
              style={{ ...styles.input, flex: 1 }}
              type="text"
              placeholder="输入或扫码"
              value={form.barcode}
              onChange={(e) => setForm({ ...form, barcode: e.target.value })}
              onKeyDown={handleBarcodeKeyDown}
              autoFocus
            />
            <button
              type="button"
              style={styles.btnSecondary}
              onClick={queryProduct}
              disabled={status === 'querying' || !form.barcode.trim()}
            >
              {status === 'querying' ? '查询中…' : '查询'}
            </button>
          </div>
          {queryError && <p style={styles.error}>{queryError}</p>}
        </div>

        {/* ── Product info (read-only) ── */}
        <div style={styles.group}>
          <label style={styles.label}>商品名称</label>
          <input style={styles.inputReadonly} readOnly value={product?.name ?? ''} placeholder="—" />
        </div>

        <div style={styles.row}>
          <div style={{ ...styles.group, flex: 1 }}>
            <label style={styles.label}>规格</label>
            <input style={styles.inputReadonly} readOnly value={product?.spec ?? ''} placeholder="—" />
          </div>
          <div style={{ ...styles.group, flex: 1 }}>
            <label style={styles.label}>售价</label>
            <input
              style={styles.inputReadonly}
              readOnly
              value={product ? `¥ ${product.sellPrice.toFixed(2)}` : ''}
              placeholder="—"
            />
          </div>
        </div>

        {/* ── Quantity ── */}
        <div style={styles.group}>
          <label style={styles.label}>数量</label>
          <input
            style={styles.input}
            type="number"
            min="1"
            step="1"
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })}
          />
        </div>

        {/* ── Subtotal ── */}
        <div style={styles.group}>
          <label style={styles.label}>小计</label>
          <div style={styles.subtotal}>¥ {subtotal}</div>
        </div>

        {/* ── Remark ── */}
        <div style={styles.group}>
          <label style={styles.label}>备注</label>
          <input
            style={styles.input}
            type="text"
            placeholder="可选"
            value={form.remark}
            onChange={(e) => setForm({ ...form, remark: e.target.value })}
          />
        </div>

        {submitError && <p style={styles.error}>{submitError}</p>}

        {/* ── Actions ── */}
        <div style={styles.actions}>
          <button
            type="button"
            style={styles.btnSecondary}
            onClick={handleClear}
          >
            清空
          </button>
          <button
            type="submit"
            style={styles.btnPrimary}
            disabled={!product || status === 'submitting' || qty <= 0}
          >
            {status === 'submitting' ? '提交中…' : '提交销售'}
          </button>
        </div>

      </form>
    </main>
  )
}

// ─── Inline styles (mobile-first, no deps) ───────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: 480,
    margin: '0 auto',
    padding: '16px 16px 40px',
  },
  title: {
    fontSize: 20,
    fontWeight: 600,
    marginBottom: 20,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  group: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  label: {
    fontSize: 13,
    color: '#666',
    fontWeight: 500,
  },
  row: {
    display: 'flex',
    gap: 8,
    alignItems: 'stretch',
  },
  input: {
    height: 44,
    padding: '0 12px',
    border: '1px solid #d0d0d0',
    borderRadius: 8,
    fontSize: 16,
    background: '#fff',
    outline: 'none',
    width: '100%',
  },
  inputReadonly: {
    height: 44,
    padding: '0 12px',
    border: '1px solid #e8e8e8',
    borderRadius: 8,
    fontSize: 16,
    background: '#fafafa',
    color: '#444',
    width: '100%',
  },
  subtotal: {
    height: 44,
    padding: '0 12px',
    border: '1px solid #e8e8e8',
    borderRadius: 8,
    fontSize: 18,
    fontWeight: 600,
    background: '#fafafa',
    display: 'flex',
    alignItems: 'center',
    color: '#d4380d',
  },
  actions: {
    display: 'flex',
    gap: 12,
    marginTop: 8,
  },
  btnPrimary: {
    flex: 1,
    height: 48,
    background: '#1677ff',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
  },
  btnSecondary: {
    height: 44,
    padding: '0 16px',
    background: '#fff',
    color: '#333',
    border: '1px solid #d0d0d0',
    borderRadius: 8,
    fontSize: 15,
    cursor: 'pointer',
  },
  error: {
    fontSize: 13,
    color: '#cf1322',
    marginTop: 2,
  },
  resultCard: {
    background: '#f6ffed',
    border: '1px solid #b7eb8f',
    borderRadius: 8,
    padding: '12px 16px',
    marginBottom: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  resultTitle: {
    fontWeight: 600,
    color: '#389e0d',
    marginBottom: 4,
  },
  resultRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 14,
  },
  resultLabel: {
    color: '#666',
  },
  resultValue: {
    fontWeight: 500,
  },
}
