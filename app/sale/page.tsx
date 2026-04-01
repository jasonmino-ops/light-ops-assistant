'use client'

import { useState, useEffect, useRef, KeyboardEvent } from 'react'
import { apiFetch } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

type Product = {
  id: string
  barcode: string
  name: string
  spec: string | null
  sellPrice: number
}

type CartItem = {
  key: string
  product: Product
  qty: number
}

type SaleResult = {
  count: number
  totalAmount: number
  recordNos: string[]
}

type Status = 'idle' | 'querying' | 'submitting'

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SalePage() {
  const [barcodeInput, setBarcodeInput] = useState('')
  const [qty, setQty] = useState(1)
  const [product, setProduct] = useState<Product | null>(null)
  const [queryError, setQueryError] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [cart, setCart] = useState<CartItem[]>([])
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
    const q = barcodeInput.trim()
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
        const aFirst = a.barcode.toLowerCase().startsWith(ql) ? 0 : 1
        const bFirst = b.barcode.toLowerCase().startsWith(ql) ? 0 : 1
        return aFirst - bFirst
      } else {
        const aFirst = a.name.toLowerCase().includes(ql) ? 0 : 1
        const bFirst = b.name.toLowerCase().includes(ql) ? 0 : 1
        return aFirst - bFirst
      }
    })
    const top = matches.slice(0, 5)
    setSuggestions(top)
    setShowSuggestions(top.length > 0)
  }, [barcodeInput, allProducts])

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

  function selectProduct(p: Product) {
    setProduct(p)
    setBarcodeInput(p.barcode)
    setQty(1)
    setShowSuggestions(false)
    setDropSearch('')
    setDropOpen(false)
    setQueryError(null)
    setResult(null)
    setSubmitError(null)
  }

  const cartTotal = cart.reduce((sum, i) => sum + i.product.sellPrice * i.qty, 0)
  const safeQty = Math.max(1, qty)

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
        const p = await res.json()
        setProduct(p)
        setQty(1)
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
    queryProductByBarcode(barcodeInput.trim())
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
        setBarcodeInput(barcode)
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

  // ── Cart operations ────────────────────────────────────────────────────────

  function addToCart() {
    if (!product) return
    setCart((prev) => [
      ...prev,
      { key: `${product.id}-${Date.now()}`, product, qty: safeQty },
    ])
    setProduct(null)
    setBarcodeInput('')
    setQty(1)
    setQueryError(null)
  }

  function removeFromCart(key: string) {
    setCart((prev) => prev.filter((i) => i.key !== key))
  }

  // ── Submit sale ────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (cart.length === 0) return
    setSubmitError(null)
    setStatus('submitting')

    const recordNos: string[] = []
    let totalAmount = 0

    for (const ci of cart) {
      try {
        const res = await apiFetch('/api/sales', {
          method: 'POST',
          body: JSON.stringify({
            saleType: 'SALE',
            barcode: ci.product.barcode,
            productId: ci.product.id,
            productNameSnapshot: ci.product.name,
            specSnapshot: ci.product.spec,
            unitPrice: ci.product.sellPrice,
            quantity: ci.qty,
          }),
        })
        const body = await res.json()
        if (!res.ok) {
          setSubmitError(
            `${ci.product.name}：${body.message ?? body.error ?? '提交失败'}`
          )
          setStatus('idle')
          return
        }
        recordNos.push(body.recordNo)
        totalAmount += ci.product.sellPrice * ci.qty
      } catch {
        setSubmitError(`${ci.product.name}：网络错误，请重试`)
        setStatus('idle')
        return
      }
    }

    setResult({ count: cart.length, totalAmount, recordNos })
    setCart([])
    setStatus('idle')
  }

  function handleClear() {
    setBarcodeInput('')
    setQty(1)
    setProduct(null)
    setQueryError(null)
    setResult(null)
    setSubmitError(null)
    setStatus('idle')
    setDropSearch('')
    setDropOpen(false)
    setShowSuggestions(false)
    setCart([])
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
              <InfoRow label="商品种数" value={`${result.count} 种`} />
              <InfoRow label="合计金额" value={`$${result.totalAmount.toFixed(2)}`} bold />
              {result.recordNos.map((no, i) => (
                <InfoRow key={no} label={`单号 ${i + 1}`} value={no} mono />
              ))}
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
                    value={barcodeInput}
                    onChange={(e) => {
                      setBarcodeInput(e.target.value)
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
                    disabled={status === 'querying' || !barcodeInput.trim()}
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
                        onMouseDown={(e) => { e.preventDefault(); selectProduct(p) }}
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
                              onMouseDown={(e) => { e.preventDefault(); selectProduct(p) }}
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

            {/* ── Empty prompt (no product, no cart) ── */}
            {!product && cart.length === 0 && (
              <div style={s.emptyState}>
                <div style={s.emptyIcon}>⊡</div>
                <div style={s.emptyTitle}>请先查找商品</div>
                <div style={s.emptyDesc}>扫码 · 输入条码 · 从列表选择</div>
              </div>
            )}

            {/* ── Product found: info + qty + add-to-cart ── */}
            {product && (
              <div style={s.card}>
                <div style={s.productName}>{product.name}</div>
                {product.spec && <div style={s.productSpec}>{product.spec}</div>}
                <div style={s.priceRow}>
                  <span style={s.priceLabel}>单价</span>
                  <span style={s.priceValue}>${product.sellPrice.toFixed(2)}</span>
                </div>

                <div style={{ ...s.cardLabel, marginTop: 12 }}>数量</div>
                <div style={s.stepperRow}>
                  <button
                    type="button"
                    style={s.stepperBtn}
                    onClick={() => setQty(Math.max(1, safeQty - 1))}
                  >−</button>
                  <span style={s.stepperValue}>{safeQty}</span>
                  <button
                    type="button"
                    style={s.stepperBtn}
                    onClick={() => setQty(safeQty + 1)}
                  >+</button>
                </div>

                <div style={s.subtotalRow}>
                  <span style={s.subtotalLabel}>小计</span>
                  <span style={s.subtotalValue}>
                    ${(product.sellPrice * safeQty).toFixed(2)}
                  </span>
                </div>

                <button style={s.addBtn} onClick={addToCart}>
                  + 加入本单
                </button>
              </div>
            )}

            {/* ── Cart ── */}
            {cart.length > 0 && (
              <>
                <div style={s.cartHeader}>
                  <span style={s.cartHeaderText}>本单商品（{cart.length} 种）</span>
                  <button style={s.clearCartBtn} onClick={() => setCart([])}>清空本单</button>
                </div>

                {cart.map((ci) => (
                  <CartItemRow
                    key={ci.key}
                    item={ci}
                    onDelete={() => removeFromCart(ci.key)}
                  />
                ))}

                {/* Total */}
                <div style={s.totalCard}>
                  <span style={s.totalLabel}>合计</span>
                  <span style={s.totalAmount}>${cartTotal.toFixed(2)}</span>
                </div>

                {submitError && <div style={s.errorMsg}>{submitError}</div>}

                <button
                  style={{
                    ...s.submitBtn,
                    ...(status === 'submitting' ? s.submitBtnLoading : {}),
                  }}
                  disabled={status === 'submitting'}
                  onClick={handleSubmit}
                >
                  {status === 'submitting' ? '提交中…' : '确认销售'}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── CartItemRow ──────────────────────────────────────────────────────────────

function CartItemRow({
  item,
  onDelete,
}: {
  item: CartItem
  onDelete: () => void
}) {
  return (
    <div style={ci.card}>
      <div style={ci.top}>
        <div style={ci.nameWrap}>
          <span style={ci.name}>{item.product.name}</span>
          {item.product.spec && <span style={ci.spec}> · {item.product.spec}</span>}
        </div>
        <button style={ci.del} onClick={onDelete}>✕</button>
      </div>
      <div style={ci.bottom}>
        <span style={ci.meta}>
          {item.qty} 件 × ${item.product.sellPrice.toFixed(2)}
        </span>
        <span style={ci.subtotal}>
          ${(item.qty * item.product.sellPrice).toFixed(2)}
        </span>
      </div>
    </div>
  )
}

const ci: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--card)',
    borderRadius: 'var(--radius)',
    padding: '11px 14px',
    marginBottom: 8,
  },
  top: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 4,
  },
  nameWrap: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  name: {
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--text)',
  },
  spec: {
    fontSize: 13,
    color: 'var(--muted)',
  },
  del: {
    flexShrink: 0,
    background: 'none',
    border: 'none',
    color: '#bbb',
    fontSize: 16,
    padding: '0 0 0 8px',
    lineHeight: 1,
  },
  bottom: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  meta: {
    fontSize: 13,
    color: 'var(--muted)',
  },
  subtotal: {
    fontSize: 16,
    fontWeight: 700,
    color: 'var(--text)',
  },
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
    overflowX: 'hidden',
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
    padding: '12px 12px 20px',
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
  scanIcon: { fontSize: 22 },
  scanLabel: { fontSize: 15, fontWeight: 600 },

  // ── Divider ──
  orDivider: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  orLine: { flex: 1, height: 1, background: 'var(--border)' },
  orText: { fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' },

  // ── Row 2: Input + autocomplete ──
  suggestWrap: { position: 'relative', marginBottom: 0 },
  inputRow: { display: 'flex', gap: 8, marginBottom: 0 },
  textInput: {
    flex: 1,
    height: 44,
    minWidth: 0,
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
  suggestSpec: { fontSize: 12, color: 'var(--muted)', flexShrink: 0 },
  suggestPrice: {
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--blue)',
    flexShrink: 0,
    marginLeft: 'auto',
  },

  // ── Row 3: Dropdown fallback ──
  dropWrap: { position: 'relative' },
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
  dropArrow: { fontSize: 10, color: 'var(--muted)', flexShrink: 0 },
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
  dropList: { maxHeight: 200, overflowY: 'auto' },
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
  dropSpec: { fontSize: 12, color: 'var(--muted)', flexShrink: 0 },
  dropPrice: {
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--blue)',
    flexShrink: 0,
    marginLeft: 'auto',
  },
  dropEmpty: { padding: '14px 12px', fontSize: 13, color: 'var(--muted)', textAlign: 'center' },

  // ── Error ──
  errorMsg: { fontSize: 13, color: 'var(--red)', padding: '6px 2px 0' },

  // ── Empty state ──
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '36px 20px',
    gap: 8,
  },
  emptyIcon: { fontSize: 44, color: '#d0d0d0', lineHeight: 1, marginBottom: 4 },
  emptyTitle: { fontSize: 15, fontWeight: 600, color: '#bbb' },
  emptyDesc: { fontSize: 13, color: '#ccc' },

  // ── Product found card ──
  productName: { fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 4 },
  productSpec: { fontSize: 13, color: 'var(--muted)', marginBottom: 10 },
  priceRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 10,
    borderTop: '1px solid var(--border)',
  },
  priceLabel: { fontSize: 13, color: 'var(--muted)' },
  priceValue: { fontSize: 20, fontWeight: 700, color: 'var(--text)' },

  // ── Quantity stepper ──
  stepperRow: {
    display: 'flex',
    alignItems: 'center',
    background: '#f7f8fa',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
    overflow: 'hidden',
    width: '100%',
    marginBottom: 12,
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

  // Subtotal row (inside product card)
  subtotalRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 14,
    marginBottom: 12,
    borderBottom: '1px solid var(--border)',
  },
  subtotalLabel: { fontSize: 13, color: 'var(--muted)' },
  subtotalValue: { fontSize: 18, fontWeight: 700, color: 'var(--text)' },

  // Add to cart button
  addBtn: {
    display: 'block',
    width: '100%',
    height: 48,
    background: 'var(--blue)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    fontSize: 16,
    fontWeight: 700,
  },

  // ── Cart section ──
  cartHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    padding: '0 2px',
  },
  cartHeaderText: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  clearCartBtn: {
    background: 'none',
    border: 'none',
    color: '#bbb',
    fontSize: 12,
    padding: 0,
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
  totalLabel: { fontSize: 14, color: 'rgba(255,255,255,0.8)', fontWeight: 500 },
  totalAmount: {
    fontSize: 28,
    fontWeight: 800,
    color: '#fff',
    letterSpacing: '-0.02em',
  },

  // ── Submit ──
  submitBtn: {
    display: 'block',
    width: '100%',
    height: 50,
    background: 'var(--blue)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    fontSize: 16,
    fontWeight: 700,
    marginBottom: 8,
  },
  submitBtnLoading: { opacity: 0.7 },

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
  successTitle: { fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 14 },
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
