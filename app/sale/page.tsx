'use client'

import { useState, useEffect, useRef, FormEvent, KeyboardEvent } from 'react'
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

const EMPTY = { barcode: '', quantity: 1, remark: '' }

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SalePage() {
  const [form, setForm] = useState(EMPTY)
  const [product, setProduct] = useState<Product | null>(null)
  const [queryError, setQueryError] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [result, setResult] = useState<SaleResult | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // ── Product list for dropdown ──────────────────────────────────────────────
  const [allProducts, setAllProducts] = useState<Product[]>([])
  const [dropSearch, setDropSearch] = useState('')
  const [dropOpen, setDropOpen] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    apiFetch('/api/products')
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Product[]) => setAllProducts(list))
      .catch(() => {})
  }, [])

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setDropOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const filteredProducts = dropSearch.trim()
    ? allProducts.filter((p) => {
        const q = dropSearch.toLowerCase()
        return (
          p.barcode.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q) ||
          (p.spec ?? '').toLowerCase().includes(q)
        )
      })
    : allProducts

  function selectFromDropdown(p: Product) {
    setProduct(p)
    setForm({ ...EMPTY, barcode: p.barcode })
    setDropSearch('')
    setDropOpen(false)
    setQueryError(null)
    setResult(null)
    setSubmitError(null)
  }

  const qty = Math.max(1, form.quantity)
  const subtotal = product ? (product.sellPrice * qty).toFixed(2) : '0.00'

  // ── Query product by barcode (unchanged logic) ─────────────────────────────

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

  // ── Submit sale (unchanged logic) ──────────────────────────────────────────

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

  function handleClear() {
    setForm(EMPTY)
    setProduct(null)
    setQueryError(null)
    setResult(null)
    setSubmitError(null)
    setStatus('idle')
    setDropSearch('')
    setDropOpen(false)
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={s.page}>
      {/* ── Blue header bar ── */}
      <div style={s.headerBar}>
        <span style={s.headerTitle}>销售</span>
      </div>

      <div style={s.body}>
        {/* ── Success card ── */}
        {result && (
          <div style={s.successCard}>
            <div style={s.successIcon}>✓</div>
            <div style={s.successTitle}>销售成功</div>
            <div style={s.successGrid}>
              <InfoRow label="单号" value={result.recordNo} mono />
              <InfoRow label="金额" value={`$${result.lineAmount.toFixed(2)}`} bold />
              <InfoRow label="时间" value={new Date(result.createdAt).toLocaleTimeString('zh-CN')} />
            </div>
            <button style={s.newSaleBtn} onClick={handleClear}>继续销售</button>
          </div>
        )}

        {!result && (
          <>
            {/* ── Search card ── */}
            <div style={s.card}>
              {/* Dropdown picker (shown when product list is available) */}
              {allProducts.length > 0 && (
                <div ref={dropRef} style={s.dropWrap}>
                  <div style={s.cardLabel}>选择商品</div>
                  <div
                    style={s.dropTrigger}
                    onClick={() => setDropOpen((v) => !v)}
                  >
                    <span style={s.dropTriggerText}>
                      {product
                        ? `${product.barcode}  ${product.name}${product.spec ? ' · ' + product.spec : ''}`
                        : '点击选择商品…'}
                    </span>
                    <span style={s.dropArrow}>{dropOpen ? '▲' : '▼'}</span>
                  </div>
                  {dropOpen && (
                    <div style={s.dropPanel}>
                      <input
                        style={s.dropSearch}
                        type="text"
                        placeholder="搜索商品名 / 编码…"
                        value={dropSearch}
                        onChange={(e) => setDropSearch(e.target.value)}
                        autoFocus
                      />
                      <div style={s.dropList}>
                        {filteredProducts.length === 0 && (
                          <div style={s.dropEmpty}>无匹配商品</div>
                        )}
                        {filteredProducts.map((p) => (
                          <div
                            key={p.id}
                            style={s.dropItem}
                            onClick={() => selectFromDropdown(p)}
                          >
                            <span style={s.dropItemCode}>{p.barcode}</span>
                            <span style={s.dropItemName}>{p.name}</span>
                            {p.spec && <span style={s.dropItemSpec}>{p.spec}</span>}
                            <span style={s.dropItemPrice}>${p.sellPrice.toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Barcode manual input */}
              <div style={s.cardLabel}>
                {allProducts.length > 0 ? '或手动输入商品码' : '商品码 / 条码'}
              </div>
              <div style={s.searchRow}>
                <span style={s.scanIcon}>⊡</span>
                <input
                  style={s.searchInput}
                  type="text"
                  placeholder="例如：8888001"
                  value={form.barcode}
                  onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                  onKeyDown={handleBarcodeKeyDown}
                  autoFocus={allProducts.length === 0}
                />
                <button
                  style={s.searchBtn}
                  type="button"
                  onClick={queryProduct}
                  disabled={status === 'querying' || !form.barcode.trim()}
                >
                  {status === 'querying' ? '…' : '查询'}
                </button>
              </div>
              {queryError && <div style={s.errorMsg}>{queryError}</div>}
            </div>

            {/* ── Empty state ── */}
            {!product && (
              <div style={s.emptyState}>
                <div style={s.emptyIcon}>⊡</div>
                <div style={s.emptyTitle}>请先查找商品</div>
                <div style={s.emptyDesc}>扫码或输入商品码后显示商品信息</div>
              </div>
            )}

            {/* ── Product found ── */}
            {product && (
              <form onSubmit={handleSubmit}>
                {/* Product info card */}
                <div style={s.card}>
                  <div style={s.productName}>{product.name}</div>
                  {product.spec && <div style={s.productSpec}>{product.spec}</div>}
                  <div style={s.productPriceRow}>
                    <span style={s.productPriceLabel}>单价</span>
                    <span style={s.productPrice}>${product.sellPrice.toFixed(2)}</span>
                  </div>
                </div>

                {/* Quantity stepper */}
                <div style={s.card}>
                  <div style={s.cardLabel}>数量</div>
                  <div style={s.stepperRow}>
                    <button
                      type="button"
                      style={s.stepperBtn}
                      onClick={() => setForm({ ...form, quantity: Math.max(1, qty - 1) })}
                    >−</button>
                    <span style={s.stepperValue}>{qty}</span>
                    <button
                      type="button"
                      style={s.stepperBtn}
                      onClick={() => setForm({ ...form, quantity: qty + 1 })}
                    >+</button>
                  </div>
                </div>

                {/* Total */}
                <div style={s.totalCard}>
                  <span style={s.totalLabel}>总额</span>
                  <span style={s.totalAmount}>${subtotal}</span>
                </div>

                {/* Remark */}
                <div style={s.card}>
                  <div style={s.cardLabel}>备注（可选）</div>
                  <input
                    style={s.remarkInput}
                    type="text"
                    placeholder="输入备注…"
                    value={form.remark}
                    onChange={(e) => setForm({ ...form, remark: e.target.value })}
                  />
                </div>

                {submitError && <div style={s.errorMsg}>{submitError}</div>}

                {/* Actions */}
                <div style={s.actions}>
                  <button type="button" style={s.clearBtn} onClick={handleClear}>清空</button>
                  <button
                    type="submit"
                    style={s.submitBtn}
                    disabled={status === 'submitting'}
                  >
                    {status === 'submitting' ? '提交中…' : '确认销售'}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Sub-component ────────────────────────────────────────────────────────────

function InfoRow({ label, value, mono, bold }: {
  label: string; value: string; mono?: boolean; bold?: boolean
}) {
  return (
    <div style={ir.row}>
      <span style={ir.label}>{label}</span>
      <span style={{ ...ir.value, ...(mono ? ir.mono : {}), ...(bold ? ir.bold : {}) }}>
        {value}
      </span>
    </div>
  )
}

const ir: Record<string, React.CSSProperties> = {
  row: { display: 'flex', justifyContent: 'space-between', padding: '5px 0' },
  label: { fontSize: 13, color: 'rgba(255,255,255,0.75)' },
  value: { fontSize: 13, color: '#fff' },
  mono: { fontFamily: 'monospace', fontSize: 12 },
  bold: { fontWeight: 700, fontSize: 16 },
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'var(--bg)',
    display: 'flex',
    flexDirection: 'column',
  },
  headerBar: {
    background: 'var(--blue)',
    padding: '16px 16px 18px',
    display: 'flex',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 700,
    letterSpacing: '0.02em',
  },
  body: {
    flex: 1,
    padding: '12px 12px 0',
    maxWidth: 480,
    margin: '0 auto',
    width: '100%',
  },
  // Cards
  card: {
    background: 'var(--card)',
    borderRadius: 'var(--radius)',
    padding: '14px 16px',
    marginBottom: 10,
  },
  cardLabel: {
    fontSize: 12,
    color: 'var(--muted)',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    marginBottom: 8,
  },
  // Search row
  searchRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  scanIcon: {
    fontSize: 22,
    color: 'var(--muted)',
    flexShrink: 0,
  },
  searchInput: {
    flex: 1,
    height: 42,
    border: '1.5px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '0 12px',
    fontSize: 16,
    outline: 'none',
    background: '#f7f8fa',
  },
  searchBtn: {
    height: 42,
    padding: '0 16px',
    background: 'var(--blue)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    fontSize: 14,
    fontWeight: 600,
    flexShrink: 0,
  },
  // Empty state
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '40px 20px',
    gap: 8,
  },
  emptyIcon: {
    fontSize: 48,
    color: '#d0d0d0',
    lineHeight: 1,
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: '#aaa',
  },
  emptyDesc: {
    fontSize: 13,
    color: '#c0c0c0',
  },
  // Product info
  productName: {
    fontSize: 18,
    fontWeight: 700,
    color: 'var(--text)',
    marginBottom: 4,
  },
  productSpec: {
    fontSize: 13,
    color: 'var(--muted)',
    marginBottom: 10,
  },
  productPriceRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 10,
    borderTop: '1px solid var(--border)',
  },
  productPriceLabel: {
    fontSize: 13,
    color: 'var(--muted)',
  },
  productPrice: {
    fontSize: 20,
    fontWeight: 700,
    color: 'var(--text)',
  },
  // Quantity stepper
  stepperRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 0,
    background: '#f7f8fa',
    borderRadius: 'var(--radius-sm)',
    overflow: 'hidden',
    border: '1px solid var(--border)',
    alignSelf: 'flex-start',
  },
  stepperBtn: {
    width: 48,
    height: 44,
    background: 'none',
    border: 'none',
    fontSize: 22,
    color: 'var(--blue)',
    fontWeight: 400,
  },
  stepperValue: {
    flex: 1,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: 700,
    color: 'var(--text)',
    minWidth: 60,
  },
  // Total
  totalCard: {
    background: 'var(--blue)',
    borderRadius: 'var(--radius)',
    padding: '14px 18px',
    marginBottom: 10,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    fontWeight: 500,
  },
  totalAmount: {
    fontSize: 26,
    fontWeight: 800,
    color: '#fff',
    letterSpacing: '-0.02em',
  },
  // Remark
  remarkInput: {
    width: '100%',
    height: 40,
    border: '1.5px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '0 12px',
    fontSize: 15,
    outline: 'none',
    background: '#f7f8fa',
  },
  // Actions
  actions: {
    display: 'flex',
    gap: 10,
    marginTop: 4,
    marginBottom: 12,
  },
  clearBtn: {
    height: 48,
    padding: '0 18px',
    background: '#fff',
    color: '#555',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 15,
  },
  submitBtn: {
    flex: 1,
    height: 48,
    background: 'var(--blue)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    fontSize: 16,
    fontWeight: 700,
  },
  // Error
  errorMsg: {
    fontSize: 13,
    color: 'var(--red)',
    padding: '4px 0 0 2px',
    marginBottom: 6,
  },
  // Success card
  successCard: {
    background: 'var(--blue)',
    borderRadius: 'var(--radius)',
    padding: '24px 20px 20px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    marginBottom: 12,
  },
  successIcon: {
    width: 48,
    height: 48,
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 24,
    color: '#fff',
    marginBottom: 4,
  },
  successTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: '#fff',
    marginBottom: 12,
  },
  successGrid: {
    width: '100%',
    borderTop: '1px solid rgba(255,255,255,0.2)',
    paddingTop: 12,
    marginBottom: 16,
  },
  newSaleBtn: {
    height: 44,
    padding: '0 28px',
    background: 'rgba(255,255,255,0.2)',
    color: '#fff',
    border: '1px solid rgba(255,255,255,0.35)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 15,
    fontWeight: 600,
  },
  // Dropdown picker
  dropWrap: {
    position: 'relative',
    marginBottom: 12,
  },
  dropTrigger: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 42,
    border: '1.5px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '0 12px',
    background: '#f7f8fa',
    cursor: 'pointer',
    gap: 8,
  },
  dropTriggerText: {
    flex: 1,
    fontSize: 14,
    color: 'var(--text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  dropArrow: {
    fontSize: 10,
    color: 'var(--muted)',
    flexShrink: 0,
  },
  dropPanel: {
    position: 'absolute',
    top: 'calc(100% + 4px)',
    left: 0,
    right: 0,
    background: '#fff',
    border: '1.5px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
    zIndex: 200,
    overflow: 'hidden',
  },
  dropSearch: {
    width: '100%',
    height: 40,
    border: 'none',
    borderBottom: '1px solid var(--border)',
    padding: '0 12px',
    fontSize: 14,
    outline: 'none',
    background: '#fafafa',
    boxSizing: 'border-box',
  },
  dropList: {
    maxHeight: 220,
    overflowY: 'auto',
  },
  dropItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 12px',
    borderBottom: '1px solid #f5f5f5',
    cursor: 'pointer',
  },
  dropItemCode: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: 'var(--muted)',
    flexShrink: 0,
    minWidth: 56,
  },
  dropItemName: {
    flex: 1,
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  dropItemSpec: {
    fontSize: 12,
    color: 'var(--muted)',
    flexShrink: 0,
  },
  dropItemPrice: {
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--blue)',
    flexShrink: 0,
  },
  dropEmpty: {
    padding: '16px 12px',
    fontSize: 13,
    color: 'var(--muted)',
    textAlign: 'center',
  },
}
