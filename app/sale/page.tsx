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

  // ── Product list (for autocomplete + dropdown) ─────────────────────────────
  const [allProducts, setAllProducts] = useState<Product[]>([])
  const [suggestions, setSuggestions] = useState<Product[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [dropOpen, setDropOpen] = useState(false)
  const [dropSearch, setDropSearch] = useState('')
  const suggestWrapRef = useRef<HTMLDivElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    apiFetch('/api/products')
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Product[]) => setAllProducts(list))
      .catch(() => {})
  }, [])

  // Compute inline autocomplete suggestions when input changes
  useEffect(() => {
    const q = form.barcode.trim()
    if (!q || allProducts.length === 0) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }
    const ql = q.toLowerCase()
    const isNumeric = /^\d+$/.test(q)
    const matches = allProducts.filter((p) =>
      p.barcode.toLowerCase().includes(ql) ||
      p.name.toLowerCase().includes(ql) ||
      (p.spec ?? '').toLowerCase().includes(ql)
    )
    matches.sort((a, b) => {
      if (isNumeric) {
        // numeric: barcode prefix match first
        const aFirst = a.barcode.toLowerCase().startsWith(ql) ? 0 : 1
        const bFirst = b.barcode.toLowerCase().startsWith(ql) ? 0 : 1
        return aFirst - bFirst
      } else {
        // text: name match first
        const aFirst = a.name.toLowerCase().includes(ql) ? 0 : 1
        const bFirst = b.name.toLowerCase().includes(ql) ? 0 : 1
        return aFirst - bFirst
      }
    })
    const top = matches.slice(0, 5)
    setSuggestions(top)
    setShowSuggestions(top.length > 0)
  }, [form.barcode, allProducts])

  // Close suggestions when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (suggestWrapRef.current && !suggestWrapRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setDropOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const filteredDrop = dropSearch.trim()
    ? allProducts.filter((p) => {
        const q = dropSearch.toLowerCase()
        return (
          p.barcode.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q) ||
          (p.spec ?? '').toLowerCase().includes(q)
        )
      })
    : allProducts

  // Select from autocomplete suggestion (no extra API call)
  function selectSuggestion(p: Product) {
    setProduct(p)
    setForm((prev) => ({ ...prev, barcode: p.barcode }))
    setShowSuggestions(false)
    setQueryError(null)
    setResult(null)
    setSubmitError(null)
  }

  // Select from dropdown list
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

  // ── Query by barcode ───────────────────────────────────────────────────────

  async function queryProductByBarcode(barcode: string) {
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

  function queryProduct() {
    setShowSuggestions(false)
    queryProductByBarcode(form.barcode.trim())
  }

  function handleBarcodeKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') queryProduct()
    if (e.key === 'Escape') setShowSuggestions(false)
  }

  // ── Telegram native scan ───────────────────────────────────────────────────

  function scanBarcode() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tg = (window as any).Telegram?.WebApp
    if (!tg?.showScanQrPopup) {
      setQueryError('请在 Telegram 内使用扫码功能')
      return
    }
    tg.showScanQrPopup({ text: '对准商品条码扫描' }, (scanned: string) => {
      tg.closeScanQrPopup()
      const barcode = scanned.trim()
      if (barcode) {
        setForm((prev) => ({ ...prev, barcode }))
        queryProductByBarcode(barcode)
      }
      return true
    })
  }

  const [isTma, setIsTma] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setIsTma(!!(window as any).Telegram?.WebApp)
  }, [])

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

  function handleClear() {
    setForm(EMPTY)
    setProduct(null)
    setQueryError(null)
    setResult(null)
    setSubmitError(null)
    setStatus('idle')
    setDropSearch('')
    setDropOpen(false)
    setShowSuggestions(false)
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={s.page}>
      {/* ── Header ── */}
      <div style={s.headerBar}>
        <span style={s.headerTitle}>销售</span>
      </div>

      <div style={s.body}>

        {/* ══ SUCCESS STATE ══ */}
        {result && (
          <div style={s.successCard}>
            <div style={s.successIconWrap}>✓</div>
            <div style={s.successTitle}>销售成功</div>
            <div style={s.successGrid}>
              <InfoRow label="单号" value={result.recordNo} mono />
              <InfoRow label="金额" value={`$${result.lineAmount.toFixed(2)}`} bold />
              <InfoRow label="时间" value={new Date(result.createdAt).toLocaleTimeString('zh-CN')} />
            </div>
            <button style={s.nextBtn} onClick={handleClear}>继续下一单</button>
          </div>
        )}

        {/* ══ MAIN FLOW ══ */}
        {!result && (
          <>
            {/* ── Query card: 3 rows ── */}
            <div style={s.card}>

              {/* Row 1 — Scan button */}
              <button
                type="button"
                style={isTma ? s.scanRow : { ...s.scanRow, ...s.scanRowOff }}
                onClick={scanBarcode}
              >
                <span style={s.scanIcon}>⊡</span>
                <span style={s.scanLabel}>
                  {isTma ? '扫码查询' : '扫码查询（请在 Telegram 内使用）'}
                </span>
              </button>

              <div style={s.orDivider}>
                <div style={s.orLine} />
                <span style={s.orText}>或</span>
                <div style={s.orLine} />
              </div>

              {/* Row 2 — Input + query + inline suggestions */}
              <div ref={suggestWrapRef} style={s.suggestWrap}>
                <div style={s.inputRow}>
                  <input
                    style={s.textInput}
                    type="text"
                    placeholder="商品条码 / 名称"
                    value={form.barcode}
                    onChange={(e) => {
                      setForm({ ...form, barcode: e.target.value })
                      if (product) setProduct(null)
                    }}
                    onKeyDown={handleBarcodeKeyDown}
                    onFocus={() => {
                      if (suggestions.length > 0) setShowSuggestions(true)
                    }}
                  />
                  <button
                    style={s.queryBtn}
                    type="button"
                    onClick={queryProduct}
                    disabled={status === 'querying' || !form.barcode.trim()}
                  >
                    {status === 'querying' ? '…' : '查询'}
                  </button>
                </div>

                {/* Inline autocomplete */}
                {showSuggestions && (
                  <div style={s.suggestPanel}>
                    {suggestions.map((p) => (
                      <div
                        key={p.id}
                        style={s.suggestItem}
                        onMouseDown={(e) => { e.preventDefault(); selectSuggestion(p) }}
                      >
                        <span style={s.suggestCode}>{p.barcode}</span>
                        <span style={s.suggestName}>{p.name}</span>
                        {p.spec && <span style={s.suggestSpec}> · {p.spec}</span>}
                        <span style={s.suggestPrice}>${p.sellPrice.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {queryError && <div style={s.errorMsg}>{queryError}</div>}

              {/* Row 3 — Dropdown fallback (only when list available) */}
              {allProducts.length > 0 && (
                <>
                  <div style={s.orDivider}>
                    <div style={s.orLine} />
                    <span style={s.orText}>或从列表选</span>
                    <div style={s.orLine} />
                  </div>
                  <div ref={dropRef} style={s.dropWrap}>
                    <div
                      style={s.dropTrigger}
                      onClick={() => setDropOpen((v) => !v)}
                    >
                      <span style={s.dropTriggerText}>
                        {product
                          ? `${product.name}${product.spec ? ' · ' + product.spec : ''}`
                          : '全部商品…'}
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
                          {filteredDrop.length === 0 && (
                            <div style={s.dropEmpty}>无匹配商品</div>
                          )}
                          {filteredDrop.map((p) => (
                            <div
                              key={p.id}
                              style={s.dropItem}
                              onMouseDown={(e) => { e.preventDefault(); selectFromDropdown(p) }}
                            >
                              <span style={s.dropCode}>{p.barcode}</span>
                              <span style={s.dropName}>{p.name}</span>
                              {p.spec && <span style={s.dropSpec}>{p.spec}</span>}
                              <span style={s.dropPrice}>${p.sellPrice.toFixed(2)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* ── Empty prompt ── */}
            {!product && (
              <div style={s.emptyState}>
                <div style={s.emptyIcon}>⊡</div>
                <div style={s.emptyTitle}>请先查找商品</div>
                <div style={s.emptyDesc}>扫码 · 输入条码 · 从列表选择</div>
              </div>
            )}

            {/* ── Product found: info + form ── */}
            {product && (
              <form onSubmit={handleSubmit}>
                {/* 1. Product info */}
                <div style={s.card}>
                  <div style={s.productName}>{product.name}</div>
                  {product.spec && <div style={s.productSpec}>{product.spec}</div>}
                  <div style={s.priceRow}>
                    <span style={s.priceLabel}>单价</span>
                    <span style={s.priceValue}>${product.sellPrice.toFixed(2)}</span>
                  </div>
                </div>

                {/* 2. Quantity */}
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

                {/* 3. Total */}
                <div style={s.totalCard}>
                  <span style={s.totalLabel}>总额</span>
                  <span style={s.totalAmount}>${subtotal}</span>
                </div>

                {/* 4. Remark */}
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

                {/* 5. Actions */}
                <div style={s.actions}>
                  <button type="button" style={s.clearBtn} onClick={handleClear}>
                    清空
                  </button>
                  <button
                    type="submit"
                    style={{
                      ...s.submitBtn,
                      ...(status === 'submitting' ? s.submitBtnLoading : {}),
                    }}
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

// ─── InfoRow ──────────────────────────────────────────────────────────────────

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
  mono: { fontFamily: 'monospace', fontSize: 11 },
  bold: { fontWeight: 700, fontSize: 17 },
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  // ── Layout ──
  page: {
    minHeight: '100vh',
    background: 'var(--bg)',
    display: 'flex',
    flexDirection: 'column',
    overflowX: 'hidden',         // prevent horizontal overflow
  },
  headerBar: {
    background: 'var(--blue)',
    padding: '16px 16px 18px',
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 700,
    letterSpacing: '0.02em',
  },
  body: {
    flex: 1,
    width: '100%',
    maxWidth: 480,
    margin: '0 auto',
    padding: '12px 12px 20px',   // bottom pad so content clears the fixed nav
  },

  // ── Cards ──
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

  // ── Row 1: Scan button ──
  scanRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    width: '100%',
    height: 48,
    background: 'var(--blue)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    fontSize: 16,
    fontWeight: 600,
    marginBottom: 12,
  },
  scanRowOff: {
    background: '#d0d0d0',
    color: '#888',
  },
  scanIcon: {
    fontSize: 22,
  },
  scanLabel: {
    fontSize: 15,
    fontWeight: 600,
  },

  // ── Divider ──
  orDivider: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  orLine: {
    flex: 1,
    height: 1,
    background: 'var(--border)',
  },
  orText: {
    fontSize: 12,
    color: 'var(--muted)',
    whiteSpace: 'nowrap',
  },

  // ── Row 2: Input + autocomplete ──
  suggestWrap: {
    position: 'relative',
    marginBottom: 0,
  },
  inputRow: {
    display: 'flex',
    gap: 8,
    marginBottom: 0,
  },
  textInput: {
    flex: 1,
    height: 44,
    minWidth: 0,           // allow flex shrink
    border: '1.5px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '0 12px',
    fontSize: 16,
    outline: 'none',
    background: '#f7f8fa',
  },
  queryBtn: {
    flexShrink: 0,
    height: 44,
    padding: '0 18px',
    background: 'var(--blue)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    fontSize: 15,
    fontWeight: 600,
  },

  // Autocomplete suggestions
  suggestPanel: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    background: '#fff',
    border: '1.5px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
    zIndex: 300,
    overflow: 'hidden',
    marginTop: 2,
  },
  suggestItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '10px 12px',
    borderBottom: '1px solid #f5f5f5',
    cursor: 'pointer',
  },
  suggestCode: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: 'var(--muted)',
    flexShrink: 0,
    minWidth: 52,
  },
  suggestName: {
    flex: 1,
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  suggestSpec: {
    fontSize: 12,
    color: 'var(--muted)',
    flexShrink: 0,
  },
  suggestPrice: {
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--blue)',
    flexShrink: 0,
    marginLeft: 'auto',
  },

  // ── Row 3: Dropdown fallback ──
  dropWrap: {
    position: 'relative',
  },
  dropTrigger: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 44,
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
    boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
    zIndex: 200,
    overflow: 'hidden',
  },
  dropSearch: {
    display: 'block',
    width: '100%',
    height: 40,
    border: 'none',
    borderBottom: '1px solid var(--border)',
    padding: '0 12px',
    fontSize: 14,
    outline: 'none',
    background: '#fafafa',
  },
  dropList: {
    maxHeight: 200,
    overflowY: 'auto',
  },
  dropItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '10px 12px',
    borderBottom: '1px solid #f5f5f5',
    cursor: 'pointer',
  },
  dropCode: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: 'var(--muted)',
    flexShrink: 0,
    minWidth: 52,
  },
  dropName: {
    flex: 1,
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  dropSpec: {
    fontSize: 12,
    color: 'var(--muted)',
    flexShrink: 0,
  },
  dropPrice: {
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--blue)',
    flexShrink: 0,
    marginLeft: 'auto',
  },
  dropEmpty: {
    padding: '14px 12px',
    fontSize: 13,
    color: 'var(--muted)',
    textAlign: 'center',
  },

  // ── Error ──
  errorMsg: {
    fontSize: 13,
    color: 'var(--red)',
    padding: '6px 2px 0',
  },

  // ── Empty state ──
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '36px 20px',
    gap: 8,
  },
  emptyIcon: {
    fontSize: 44,
    color: '#d0d0d0',
    lineHeight: 1,
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: '#bbb',
  },
  emptyDesc: {
    fontSize: 13,
    color: '#ccc',
  },

  // ── Product info card ──
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
  priceRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 10,
    borderTop: '1px solid var(--border)',
  },
  priceLabel: {
    fontSize: 13,
    color: 'var(--muted)',
  },
  priceValue: {
    fontSize: 20,
    fontWeight: 700,
    color: 'var(--text)',
  },

  // ── Quantity stepper ──
  stepperRow: {
    display: 'flex',
    alignItems: 'center',
    background: '#f7f8fa',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
    overflow: 'hidden',
    alignSelf: 'flex-start',
    width: '100%',               // fill card width on mobile
  },
  stepperBtn: {
    width: 52,
    height: 46,
    flexShrink: 0,
    background: 'none',
    border: 'none',
    fontSize: 24,
    color: 'var(--blue)',
    fontWeight: 300,
    lineHeight: 1,
  },
  stepperValue: {
    flex: 1,
    textAlign: 'center',
    fontSize: 22,
    fontWeight: 700,
    color: 'var(--text)',
  },

  // ── Total card ──
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
    fontSize: 28,
    fontWeight: 800,
    color: '#fff',
    letterSpacing: '-0.02em',
  },

  // ── Remark ──
  remarkInput: {
    display: 'block',
    width: '100%',
    height: 42,
    border: '1.5px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '0 12px',
    fontSize: 15,
    outline: 'none',
    background: '#f7f8fa',
  },

  // ── Actions ──
  actions: {
    display: 'flex',
    gap: 10,
    marginTop: 4,
    marginBottom: 8,
  },
  clearBtn: {
    flexShrink: 0,
    width: 80,
    height: 50,
    background: '#fff',
    color: '#666',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 15,
    fontWeight: 500,
  },
  submitBtn: {
    flex: 1,
    height: 50,
    background: 'var(--blue)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    fontSize: 16,
    fontWeight: 700,
    transition: 'opacity 0.15s',
  },
  submitBtnLoading: {
    opacity: 0.7,
  },

  // ── Success card ──
  successCard: {
    background: 'var(--blue)',
    borderRadius: 'var(--radius)',
    padding: '28px 20px 22px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    marginBottom: 12,
  },
  successIconWrap: {
    width: 52,
    height: 52,
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 26,
    color: '#fff',
    marginBottom: 6,
  },
  successTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: '#fff',
    marginBottom: 14,
  },
  successGrid: {
    width: '100%',
    borderTop: '1px solid rgba(255,255,255,0.2)',
    paddingTop: 12,
    marginBottom: 18,
  },
  nextBtn: {
    height: 44,
    padding: '0 32px',
    background: 'rgba(255,255,255,0.2)',
    color: '#fff',
    border: '1px solid rgba(255,255,255,0.35)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 15,
    fontWeight: 600,
  },
}
