'use client'

import { useState, useEffect, useRef, KeyboardEvent } from 'react'
import QRCode from 'react-qr-code'
import { apiFetch } from '@/lib/api'
import BarcodeScanner from '@/app/components/BarcodeScanner'
import { useLocale } from '@/app/components/LangProvider'
import { useWorkMode } from '@/app/components/WorkModeProvider'
import LangToggleBtn from '@/app/components/LangToggleBtn'

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

type SaleSuccess = {
  orderNo: string
  totalAmount: number
  itemCount: number
  createdAt: string
  paymentMethod: 'CASH' | 'KHQR'
  cartSnapshot: CartItem[]
}

type PendingPayment = {
  id: string
  orderNo: string
  amount: number
  khqrPayload: string
  createdAt: string
  cartSnapshot: CartItem[]
}

type Status = 'idle' | 'querying' | 'submitting' | 'confirming_payment' | 'cancelling_payment'
type PayStep = 'none' | 'selecting' | 'khqr_pending'

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SalePage() {
  const { t } = useLocale()
  const { tier } = useWorkMode()
  const [barcodeInput, setBarcodeInput] = useState('')
  const [qty, setQty] = useState(1)
  const [product, setProduct] = useState<Product | null>(null)
  const [queryError, setQueryError] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [cart, setCart] = useState<CartItem[]>([])
  const [success, setSuccess] = useState<SaleSuccess | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [payStep, setPayStep] = useState<PayStep>('none')
  const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const scanSucceededRef = useRef(false)
  const [cameraFailCount, setCameraFailCount] = useState(0)
  const [hidFailCount, setHidFailCount] = useState(0)
  const isHidTier = tier === 'STANDARD' || tier === 'MULTI_STORE'

  function focusInput() {
    // defer one tick so the input is visible/mounted before focusing
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  // ── 商品列表（自动补全 + 下拉）─────────────────────────────────────────────
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

  useEffect(() => {
    const q = barcodeInput.trim()
    if (!q || allProducts.length === 0) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }
    const ql = q.toLowerCase()
    const isNumeric = /^\d+$/.test(q)
    const matches = allProducts.filter(
      (p) =>
        p.barcode.toLowerCase().includes(ql) ||
        p.name.toLowerCase().includes(ql) ||
        (p.spec ?? '').toLowerCase().includes(ql),
    )
    matches.sort((a, b) => {
      if (isNumeric) {
        return (a.barcode.toLowerCase().startsWith(ql) ? 0 : 1) -
               (b.barcode.toLowerCase().startsWith(ql) ? 0 : 1)
      }
      return (a.name.toLowerCase().includes(ql) ? 0 : 1) -
             (b.name.toLowerCase().includes(ql) ? 0 : 1)
    })
    const top = matches.slice(0, 5)
    setSuggestions(top)
    setShowSuggestions(top.length > 0)
  }, [barcodeInput, allProducts])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (suggestWrapRef.current && !suggestWrapRef.current.contains(e.target as Node))
        setShowSuggestions(false)
      if (dropRef.current && !dropRef.current.contains(e.target as Node))
        setDropOpen(false)
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
  }

  const safeQty = Math.max(1, qty)
  const cartTotal = cart.reduce((sum, i) => sum + i.product.sellPrice * i.qty, 0)

  // ── 按条码查询 ─────────────────────────────────────────────────────────────

  async function queryProductByBarcode(barcode: string) {
    if (!barcode) return
    setQueryError(null)
    setProduct(null)
    setStatus('querying')
    try {
      const res = await apiFetch(`/api/products?barcode=${encodeURIComponent(barcode)}`)
      if (res.ok) {
        setProduct(await res.json())
        setQty(1)
        setHidFailCount(0) // reset on success
      } else {
        const body = await res.json().catch(() => ({}))
        setQueryError(body.error === 'PRODUCT_NOT_FOUND' ? t('sale.notFound') : t('sale.queryFailed'))
        if (body.error === 'PRODUCT_NOT_FOUND' && isHidTier) {
          setHidFailCount((c) => Math.min(c + 1, 5))
        }
      }
    } catch {
      setQueryError(t('common.networkError'))
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

  // ── 扫码 ──────────────────────────────────────────────────────────────────

  /** 打开摄像头扫码（仅一维商品条码，不扫二维码） */
  function scanBarcode() {
    scanSucceededRef.current = false
    setQueryError(null)
    setScannerOpen(true)
  }

  /** 摄像头扫码成功：回填条码、触发查询、重置失败计数 */
  function handleScanned(barcode: string) {
    scanSucceededRef.current = true
    setCameraFailCount(0)
    setHidFailCount(0)
    setScannerOpen(false)
    setBarcodeInput(barcode)
    queryProductByBarcode(barcode)
    focusInput()
  }

  /** 用户手动关闭扫码窗口（未扫到结果）：记录失败次数 */
  function handleScannerClose() {
    if (!scanSucceededRef.current) {
      setCameraFailCount((c) => Math.min(c + 1, 5))
    }
    scanSucceededRef.current = false
    setScannerOpen(false)
  }

  /** 摄像头启动失败：关闭弹窗、记录失败次数、展示错误 */
  function handleCameraError(msg: string) {
    setScannerOpen(false)
    setCameraFailCount((c) => Math.min(c + 1, 5))
    setQueryError(msg)
  }

  // ── 购物车操作 ─────────────────────────────────────────────────────────────

  function addToCart() {
    if (!product) return
    setCart((prev) => [...prev, { key: `${product.id}-${Date.now()}`, product, qty: safeQty }])
    setProduct(null)
    setBarcodeInput('')
    setQty(1)
    setQueryError(null)
    setHidFailCount(0)
    focusInput()
  }

  function removeFromCart(key: string) {
    setCart((prev) => prev.filter((i) => i.key !== key))
  }

  // ── 收款方式选择 + 提交 ────────────────────────────────────────────────────

  function openPayModal() {
    if (cart.length === 0) return
    setSubmitError(null)
    setPayStep('selecting')
  }

  async function handlePayWithMethod(method: 'CASH' | 'KHQR') {
    setPayStep('none')
    setSubmitError(null)
    setStatus('submitting')
    const cartSnapshot = [...cart]

    try {
      const res = await apiFetch('/api/sales', {
        method: 'POST',
        body: JSON.stringify({
          saleType: 'SALE',
          paymentMethod: method,
          items: cart.map((ci) => ({
            barcode: ci.product.barcode,
            quantity: ci.qty,
          })),
        }),
      })
      const body = await res.json()
      if (res.ok) {
        setCart([])
        if (method === 'CASH') {
          setSuccess({ ...body, paymentMethod: 'CASH', cartSnapshot })
        } else {
          setPendingPayment({
            id: body.paymentIntentId,
            orderNo: body.orderNo,
            amount: body.totalAmount,
            khqrPayload: body.khqrPayload,
            createdAt: body.createdAt,
            cartSnapshot,
          })
          setPayStep('khqr_pending')
        }
      } else {
        setSubmitError(body.message ?? body.error ?? t('sale.confirmSale'))
      }
    } catch {
      setSubmitError(t('common.networkError'))
    } finally {
      setStatus('idle')
    }
  }

  async function handleKhqrConfirm() {
    if (!pendingPayment) return
    setStatus('confirming_payment')
    try {
      const res = await apiFetch(`/api/payments/${pendingPayment.id}/confirm`, { method: 'POST' })
      if (res.ok) {
        setSuccess({
          orderNo: pendingPayment.orderNo,
          totalAmount: pendingPayment.amount,
          itemCount: pendingPayment.cartSnapshot.length,
          createdAt: pendingPayment.createdAt,
          paymentMethod: 'KHQR',
          cartSnapshot: pendingPayment.cartSnapshot,
        })
        setPendingPayment(null)
        setPayStep('none')
      } else {
        const b = await res.json().catch(() => ({}))
        setSubmitError(b.error ?? 'confirm failed')
      }
    } catch {
      setSubmitError(t('common.networkError'))
    } finally {
      setStatus('idle')
    }
  }

  async function handleKhqrCancel() {
    if (!pendingPayment) return
    setStatus('cancelling_payment')
    try {
      const res = await apiFetch(`/api/payments/${pendingPayment.id}/cancel`, { method: 'POST' })
      if (res.ok) {
        setPendingPayment(null)
        setPayStep('none')
      } else {
        const b = await res.json().catch(() => ({}))
        setSubmitError(b.error ?? 'cancel failed')
      }
    } catch {
      setSubmitError(t('common.networkError'))
    } finally {
      setStatus('idle')
    }
  }

  function handleClear() {
    setBarcodeInput('')
    setQty(1)
    setProduct(null)
    setQueryError(null)
    setSuccess(null)
    setSubmitError(null)
    setStatus('idle')
    setDropSearch('')
    setDropOpen(false)
    setShowSuggestions(false)
    setCart([])
    setPayStep('none')
    setPendingPayment(null)
    focusInput()
  }

  // ── 成功卡商品摘要 ─────────────────────────────────────────────────────────
  function buildCartSummary(items: CartItem[]) {
    const shown = items.slice(0, 2).map((i) => `${i.product.name}×${i.qty}`)
    if (items.length > 2) shown.push(t('sale.moreItems').replace('{n}', String(items.length - 2)))
    return shown.join('、')
  }

  // ─── 渲染 ──────────────────────────────────────────────────────────────────

  return (
    <div style={s.page}>
      {/* 摄像头扫码弹窗（仅一维商品条码） */}
      {scannerOpen && (
        <BarcodeScanner
          onScanned={handleScanned}
          onClose={handleScannerClose}
          onCameraError={handleCameraError}
        />
      )}

      {/* 收款方式选择 Modal */}
      {payStep === 'selecting' && (
        <div style={pm.overlay} onClick={() => setPayStep('none')}>
          <div style={pm.sheet} onClick={(e) => e.stopPropagation()}>
            <div style={pm.title}>{t('sale.paymentTitle')}</div>
            <button
              style={pm.option}
              onClick={() => handlePayWithMethod('CASH')}
              disabled={status === 'submitting'}
            >
              <span style={pm.optionIcon}>💵</span>
              <div style={pm.optionText}>
                <span style={pm.optionLabel}>{t('sale.paymentCash')}</span>
                <span style={pm.optionDesc}>{t('sale.paymentCashDesc')}</span>
              </div>
            </button>
            <button
              style={pm.option}
              onClick={() => handlePayWithMethod('KHQR')}
              disabled={status === 'submitting'}
            >
              <span style={pm.optionIcon}>📱</span>
              <div style={pm.optionText}>
                <span style={pm.optionLabel}>{t('sale.paymentKhqr')}</span>
                <span style={pm.optionDesc}>{t('sale.paymentKhqrDesc')}</span>
              </div>
            </button>
          </div>
        </div>
      )}

      <div style={{ ...s.headerBar, justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={s.headerTitle}>{t('sale.title')}</span>
        <LangToggleBtn />
      </div>

      <div style={s.body}>

        {/* ══ KHQR 待收款 ══ */}
        {payStep === 'khqr_pending' && pendingPayment && (
          <div style={s.khqrCard}>
            <div style={s.khqrTitle}>{t('sale.khqrTitle')}</div>
            <div style={s.khqrHint}>{t('sale.khqrScanHint')}</div>
            <div style={s.qrWrap}>
              <QRCode value={pendingPayment.khqrPayload} size={200} />
            </div>
            <div style={s.khqrInfoGrid}>
              <InfoRow label={t('sale.khqrOrderLabel')} value={pendingPayment.orderNo} mono />
              <InfoRow label={t('sale.khqrAmountLabel')} value={`$${pendingPayment.amount.toFixed(2)}`} bold />
            </div>
            {submitError && <div style={{ ...s.errorMsg, marginBottom: 8 }}>{submitError}</div>}
            <button
              style={s.khqrConfirmBtn}
              disabled={status === 'confirming_payment' || status === 'cancelling_payment'}
              onClick={handleKhqrConfirm}
            >
              {status === 'confirming_payment' ? t('sale.khqrConfirming') : t('sale.khqrConfirmBtn')}
            </button>
            <button
              style={s.khqrCancelBtn}
              disabled={status === 'confirming_payment' || status === 'cancelling_payment'}
              onClick={handleKhqrCancel}
            >
              {status === 'cancelling_payment' ? t('sale.khqrCancelling') : t('sale.khqrCancelBtn')}
            </button>
          </div>
        )}

        {/* ══ 成功状态 ══ */}
        {success && payStep !== 'khqr_pending' && (
          <div style={s.successCard}>
            <div style={s.successIconWrap}>✓</div>
            <div style={s.successTitle}>{t('sale.saleSuccess')}</div>
            <div style={s.successGrid}>
              <InfoRow label={t('sale.orderNo')} value={success.orderNo} mono />
              <InfoRow label={t('sale.totalAmount')} value={`$${success.totalAmount.toFixed(2)}`} bold />
              <InfoRow label={t('sale.product')} value={buildCartSummary(success.cartSnapshot)} />
              <InfoRow label={t('sale.time')} value={new Date(success.createdAt).toLocaleTimeString('zh-CN')} />
            </div>
            <button style={s.nextBtn} onClick={handleClear}>{t('sale.nextOrder')}</button>
          </div>
        )}

        {/* ══ 主流程 ══ */}
        {!success && payStep !== 'khqr_pending' && (
          <>
            {/* 查询卡：扫码 / 输入 / 下拉 */}
            <div style={s.card}>
              <button
                type="button"
                style={s.scanRow}
                onClick={scanBarcode}
                disabled={status === 'querying' || status === 'submitting'}
              >
                <span style={s.scanIcon}>⊡</span>
                <span style={s.scanLabel}>{t('sale.scanBtn')}</span>
              </button>

              {cameraFailCount >= 5 && (
                <div style={s.scanHintMsg}>{t('sale.scanFailHint')}</div>
              )}

              <div style={s.orDivider}>
                <div style={s.orLine} /><span style={s.orText}>{t('sale.orInput')}</span><div style={s.orLine} />
              </div>

              <div ref={suggestWrapRef} style={s.suggestWrap}>
                <div style={s.inputRow}>
                  <input
                    ref={inputRef}
                    style={s.textInput}
                    type="text"
                    placeholder={t('sale.inputPlaceholder')}
                    value={barcodeInput}
                    autoFocus
                    onChange={(e) => {
                      setBarcodeInput(e.target.value)
                      if (product) setProduct(null)
                    }}
                    onKeyDown={handleBarcodeKeyDown}
                    onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true) }}
                  />
                  <button
                    style={s.queryBtn}
                    type="button"
                    onClick={queryProduct}
                    disabled={status === 'querying' || !barcodeInput.trim()}
                  >
                    {status === 'querying' ? t('sale.querying') : t('sale.queryBtn')}
                  </button>
                </div>

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
              {isHidTier && hidFailCount >= 5 && (
                <div style={s.scanHintMsg}>{t('sale.hidFailHint')}</div>
              )}

              {allProducts.length > 0 && (
                <>
                  <div style={s.orDivider}>
                    <div style={s.orLine} /><span style={s.orText}>{t('sale.orFromList')}</span><div style={s.orLine} />
                  </div>
                  <div ref={dropRef} style={s.dropWrap}>
                    <div style={s.dropTrigger} onClick={() => setDropOpen((v) => !v)}>
                      <span style={s.dropTriggerText}>
                        {product
                          ? `${product.name}${product.spec ? ' · ' + product.spec : ''}`
                          : t('sale.allProducts')}
                      </span>
                      <span style={s.dropArrow}>{dropOpen ? '▲' : '▼'}</span>
                    </div>
                    {dropOpen && (
                      <div style={s.dropPanel}>
                        <input
                          style={s.dropSearch}
                          type="text"
                          placeholder={t('sale.dropSearch')}
                          value={dropSearch}
                          onChange={(e) => setDropSearch(e.target.value)}
                          autoFocus
                        />
                        <div style={s.dropList}>
                          {filteredDrop.length === 0 && <div style={s.dropEmpty}>{t('sale.noMatch')}</div>}
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

            {/* 空提示 */}
            {!product && cart.length === 0 && (
              <div style={s.emptyState}>
                <div style={s.emptyIcon}>⊡</div>
                <div style={s.emptyTitle}>{t('sale.emptyTitle')}</div>
                <div style={s.emptyDesc}>{t('sale.emptyDesc')}</div>
              </div>
            )}

            {/* 商品已选：步进器 + 加入本单 */}
            {product && (
              <div style={s.card}>
                <div style={s.productName}>{product.name}</div>
                {product.spec && <div style={s.productSpec}>{product.spec}</div>}
                <div style={s.priceRow}>
                  <span style={s.priceLabel}>{t('sale.unitPrice')}</span>
                  <span style={s.priceValue}>${product.sellPrice.toFixed(2)}</span>
                </div>

                <div style={{ ...s.cardLabel, marginTop: 12 }}>{t('sale.qty')}</div>
                <div style={s.stepperRow}>
                  <button type="button" style={s.stepperBtn} onClick={() => setQty(Math.max(1, safeQty - 1))}>−</button>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    style={s.stepperInput}
                    value={qty || ''}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^0-9]/g, '')
                      setQty(raw === '' ? 0 : Math.min(999, parseInt(raw, 10)))
                    }}
                    onBlur={() => { if (!qty || qty < 1) setQty(1) }}
                  />
                  <button type="button" style={s.stepperBtn} onClick={() => setQty(safeQty + 1)}>+</button>
                </div>

                <div style={s.subtotalRow}>
                  <span style={s.subtotalLabel}>{t('sale.subtotal')}</span>
                  <span style={s.subtotalValue}>${(product.sellPrice * safeQty).toFixed(2)}</span>
                </div>

                <button style={s.addBtn} onClick={addToCart}>{t('sale.addToCart')}</button>
              </div>
            )}

            {/* 购物车 */}
            {cart.length > 0 && (
              <>
                <div style={s.cartHeader}>
                  <span style={s.cartHeaderText}>{t('sale.cartHeader')}（{cart.length} 种）</span>
                  <button style={s.clearCartBtn} onClick={() => setCart([])}>{t('sale.clearCart')}</button>
                </div>

                {cart.map((ci) => (
                  <CartItemRow key={ci.key} item={ci} onDelete={() => removeFromCart(ci.key)} />
                ))}

                <div style={s.totalCard}>
                  <span style={s.totalLabel}>{t('sale.total')}</span>
                  <span style={s.totalAmount}>${cartTotal.toFixed(2)}</span>
                </div>

                {submitError && <div style={s.errorMsg}>{submitError}</div>}

                <button
                  style={{ ...s.submitBtn, ...(status === 'submitting' ? s.submitBtnLoading : {}) }}
                  disabled={status === 'submitting'}
                  onClick={openPayModal}
                >
                  {status === 'submitting' ? t('common.submitting') : t('sale.confirmSale')}
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

function CartItemRow({ item, onDelete }: { item: CartItem; onDelete: () => void }) {
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
        <span style={ci.meta}>{item.qty} 件 × ${item.product.sellPrice.toFixed(2)}</span>
        <span style={ci.subtotal}>${(item.qty * item.product.sellPrice).toFixed(2)}</span>
      </div>
    </div>
  )
}

const ci: Record<string, React.CSSProperties> = {
  card: { background: 'var(--card)', borderRadius: 'var(--radius)', padding: '11px 14px', marginBottom: 8 },
  top: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 4 },
  nameWrap: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  name: { fontSize: 15, fontWeight: 600, color: 'var(--text)' },
  spec: { fontSize: 13, color: 'var(--muted)' },
  del: { flexShrink: 0, background: 'none', border: 'none', color: '#bbb', fontSize: 16, padding: '0 0 0 8px', lineHeight: 1 },
  bottom: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  meta: { fontSize: 13, color: 'var(--muted)' },
  subtotal: { fontSize: 16, fontWeight: 700, color: 'var(--text)' },
}

// ─── InfoRow ──────────────────────────────────────────────────────────────────

function InfoRow({ label, value, mono, bold }: {
  label: string; value: string; mono?: boolean; bold?: boolean
}) {
  return (
    <div style={ir.row}>
      <span style={ir.label}>{label}</span>
      <span style={{ ...ir.value, ...(mono ? ir.mono : {}), ...(bold ? ir.bold : {}) }}>{value}</span>
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
  page: { minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column', overflowX: 'hidden' },
  headerBar: { background: 'var(--blue)', padding: '16px 16px 18px', display: 'flex', alignItems: 'center', flexShrink: 0 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: 700, letterSpacing: '0.02em' },
  body: { flex: 1, width: '100%', maxWidth: 480, margin: '0 auto', padding: '12px 12px 20px' },

  card: { background: 'var(--card)', borderRadius: 'var(--radius)', padding: '14px 16px', marginBottom: 10 },
  cardLabel: { fontSize: 12, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 },

  scanRow: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', height: 48, background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 16, fontWeight: 600, marginBottom: 12 },
  scanIcon: { fontSize: 22 },
  scanLabel: { fontSize: 15, fontWeight: 600 },

  orDivider: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 },
  orLine: { flex: 1, height: 1, background: 'var(--border)' },
  orText: { fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' },

  suggestWrap: { position: 'relative' },
  inputRow: { display: 'flex', gap: 8 },
  textInput: { flex: 1, height: 44, minWidth: 0, border: '1.5px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0 12px', fontSize: 16, outline: 'none', background: '#f7f8fa' },
  queryBtn: { flexShrink: 0, height: 44, padding: '0 18px', background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 15, fontWeight: 600 },

  suggestPanel: { position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1.5px solid var(--border)', borderRadius: 'var(--radius-sm)', boxShadow: '0 6px 20px rgba(0,0,0,0.12)', zIndex: 300, overflow: 'hidden', marginTop: 2 },
  suggestItem: { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px', borderBottom: '1px solid #f5f5f5', cursor: 'pointer' },
  suggestCode: { fontSize: 11, fontFamily: 'monospace', color: 'var(--muted)', flexShrink: 0, minWidth: 52 },
  suggestName: { flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  suggestSpec: { fontSize: 12, color: 'var(--muted)', flexShrink: 0 },
  suggestPrice: { fontSize: 13, fontWeight: 700, color: 'var(--blue)', flexShrink: 0, marginLeft: 'auto' },

  dropWrap: { position: 'relative' },
  dropTrigger: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 44, border: '1.5px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0 12px', background: '#f7f8fa', cursor: 'pointer', gap: 8 },
  dropTriggerText: { flex: 1, fontSize: 14, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  dropArrow: { fontSize: 10, color: 'var(--muted)', flexShrink: 0 },
  dropPanel: { position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: '#fff', border: '1.5px solid var(--border)', borderRadius: 'var(--radius-sm)', boxShadow: '0 6px 20px rgba(0,0,0,0.12)', zIndex: 200, overflow: 'hidden' },
  dropSearch: { display: 'block', width: '100%', height: 40, border: 'none', borderBottom: '1px solid var(--border)', padding: '0 12px', fontSize: 14, outline: 'none', background: '#fafafa' },
  dropList: { maxHeight: 200, overflowY: 'auto' },
  dropItem: { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px', borderBottom: '1px solid #f5f5f5', cursor: 'pointer' },
  dropCode: { fontSize: 11, fontFamily: 'monospace', color: 'var(--muted)', flexShrink: 0, minWidth: 52 },
  dropName: { flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  dropSpec: { fontSize: 12, color: 'var(--muted)', flexShrink: 0 },
  dropPrice: { fontSize: 13, fontWeight: 700, color: 'var(--blue)', flexShrink: 0, marginLeft: 'auto' },
  dropEmpty: { padding: '14px 12px', fontSize: 13, color: 'var(--muted)', textAlign: 'center' },

  errorMsg: { fontSize: 13, color: 'var(--red)', padding: '6px 2px 0' },
  scanHintMsg: { fontSize: 12, color: '#fa8c16', background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 6, padding: '6px 10px', marginBottom: 8 },

  emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '36px 20px', gap: 8 },
  emptyIcon: { fontSize: 44, color: '#d0d0d0', lineHeight: 1, marginBottom: 4 },
  emptyTitle: { fontSize: 15, fontWeight: 600, color: '#bbb' },
  emptyDesc: { fontSize: 13, color: '#ccc' },

  productName: { fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 4 },
  productSpec: { fontSize: 13, color: 'var(--muted)', marginBottom: 10 },
  priceRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, borderTop: '1px solid var(--border)' },
  priceLabel: { fontSize: 13, color: 'var(--muted)' },
  priceValue: { fontSize: 20, fontWeight: 700, color: 'var(--text)' },

  stepperRow: { display: 'flex', alignItems: 'center', background: '#f7f8fa', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', overflow: 'hidden', width: '100%', marginBottom: 12 },
  stepperBtn: { width: 52, height: 46, flexShrink: 0, background: 'none', border: 'none', fontSize: 24, color: 'var(--blue)', fontWeight: 300, lineHeight: 1 },
  stepperInput: { flex: 1, textAlign: 'center', fontSize: 22, fontWeight: 700, color: 'var(--text)', background: 'transparent', border: 'none', outline: 'none', width: '100%' },

  subtotalRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 14, marginBottom: 12, borderBottom: '1px solid var(--border)' },
  subtotalLabel: { fontSize: 13, color: 'var(--muted)' },
  subtotalValue: { fontSize: 18, fontWeight: 700, color: 'var(--text)' },

  addBtn: { display: 'block', width: '100%', height: 48, background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 16, fontWeight: 700 },

  cartHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, padding: '0 2px' },
  cartHeaderText: { fontSize: 13, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' },
  clearCartBtn: { background: 'none', border: 'none', color: '#bbb', fontSize: 12, padding: 0 },

  totalCard: { background: 'var(--blue)', borderRadius: 'var(--radius)', padding: '14px 18px', marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { fontSize: 14, color: 'rgba(255,255,255,0.8)', fontWeight: 500 },
  totalAmount: { fontSize: 28, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' },

  submitBtn: { display: 'block', width: '100%', height: 50, background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 16, fontWeight: 700, marginBottom: 8 },
  submitBtnLoading: { opacity: 0.7 },

  successCard: { background: 'var(--blue)', borderRadius: 'var(--radius)', padding: '28px 20px 22px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, marginBottom: 12 },
  successIconWrap: { width: 52, height: 52, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, color: '#fff', marginBottom: 6 },
  successTitle: { fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 14 },
  successGrid: { width: '100%', borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: 12, marginBottom: 18 },
  nextBtn: { height: 44, padding: '0 32px', background: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.35)', borderRadius: 'var(--radius-sm)', fontSize: 15, fontWeight: 600 },

  // KHQR screen
  khqrCard: { background: 'var(--card)', borderRadius: 'var(--radius)', padding: '24px 20px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginBottom: 12 },
  khqrTitle: { fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 2 },
  khqrHint: { fontSize: 13, color: 'var(--muted)', marginBottom: 8 },
  qrWrap: { background: '#fff', padding: 12, borderRadius: 8, marginBottom: 8 },
  khqrInfoGrid: { width: '100%', borderTop: '1px solid var(--border)', paddingTop: 12, marginBottom: 4 },
  khqrConfirmBtn: { display: 'block', width: '100%', height: 50, background: '#52c41a', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 16, fontWeight: 700, marginBottom: 8 },
  khqrCancelBtn: { display: 'block', width: '100%', height: 44, background: 'none', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: 14 },
}

// ─── Payment Modal Styles ──────────────────────────────────────────────────────

const pm: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 500, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' },
  sheet: { width: '100%', maxWidth: 480, background: '#fff', borderRadius: '16px 16px 0 0', padding: '20px 16px 32px', boxShadow: '0 -4px 24px rgba(0,0,0,0.15)' },
  title: { fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 16, textAlign: 'center' },
  option: { display: 'flex', alignItems: 'center', gap: 14, width: '100%', padding: '14px 16px', background: '#f7f8fa', border: '1.5px solid var(--border)', borderRadius: 'var(--radius-sm)', marginBottom: 10, textAlign: 'left' },
  optionIcon: { fontSize: 28, flexShrink: 0 },
  optionText: { display: 'flex', flexDirection: 'column', gap: 2 },
  optionLabel: { fontSize: 15, fontWeight: 600, color: 'var(--text)' },
  optionDesc: { fontSize: 12, color: 'var(--muted)' },
}
