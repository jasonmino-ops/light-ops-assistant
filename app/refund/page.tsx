'use client'

import { useState, FormEvent, KeyboardEvent } from 'react'
import { apiFetch } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

type LookupItem = {
  saleRecordId: string
  barcode: string
  productNameSnapshot: string
  specSnapshot: string | null
  unitPrice: number
  originalQty: number
  refundedQty: number
  availableQty: number
  refundable: boolean
}

type LookupResult = {
  originalRecordNo: string
  createdAt: string
  storeName: string
  operatorDisplayName: string
  items: LookupItem[]
}

type RefundResult = {
  id: string
  recordNo: string
  saleType: string
  lineAmount: number
  createdAt: string
  productNameSnapshot?: string
  quantity?: number
}

type LookupState = 'idle' | 'loading' | 'found' | 'error'
type SubmitState = 'idle' | 'submitting'

const LOOKUP_ERROR_MSG: Record<string, string> = {
  NOT_FOUND: '未找到该销售单',
  IS_REFUND_RECORD: '该单号是退款单，不能再次退款',
  FULLY_REFUNDED: '该商品已全部退款，无可退数量',
  NOT_COMPLETED: '该订单状态不允许退款',
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RefundPage() {
  const [recordNoInput, setRecordNoInput] = useState('')
  const [lookupState, setLookupState] = useState<LookupState>('idle')
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [lookup, setLookup] = useState<LookupResult | null>(null)

  const [refundQty, setRefundQty] = useState(1)
  const [refundReason, setRefundReason] = useState('')
  const [remark, setRemark] = useState('')

  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [result, setResult] = useState<RefundResult | null>(null)

  const item = lookup?.items[0] ?? null
  const rQty = Math.max(1, refundQty)
  const refundPreview = item ? (item.unitPrice * rQty).toFixed(2) : '0.00'

  // ── Lookup ─────────────────────────────────────────────────────────────────

  async function handleLookup() {
    const no = recordNoInput.trim()
    if (!no) return

    setLookupState('loading')
    setLookupError(null)
    setLookup(null)
    setResult(null)
    setSubmitError(null)
    setRefundQty(1)
    setRefundReason('')
    setRemark('')

    try {
      const res = await apiFetch(`/api/sales/lookup?recordNo=${encodeURIComponent(no)}`)
      const body = await res.json()

      if (res.ok) {
        setLookup(body)
        setRefundQty(body.items[0]?.availableQty ?? 1)
        setLookupState('found')
      } else {
        const msg = LOOKUP_ERROR_MSG[body.reason ?? body.error] ?? '查找失败，请重试'
        setLookupError(msg)
        setLookupState('error')
      }
    } catch {
      setLookupError('网络错误，请重试')
      setLookupState('error')
    }
  }

  function handleRecordNoKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleLookup()
  }

  // ── Submit refund ──────────────────────────────────────────────────────────

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!item) return

    if (rQty <= 0) { setSubmitError('退款数量必须大于 0'); return }
    if (rQty > item.availableQty) {
      setSubmitError(`退款数量不能超过可退数量 ${item.availableQty}`)
      return
    }
    if (!refundReason.trim()) { setSubmitError('退款原因不能为空'); return }

    setSubmitError(null)
    setResult(null)
    setSubmitState('submitting')

    try {
      const res = await apiFetch('/api/sales', {
        method: 'POST',
        body: JSON.stringify({
          saleType: 'REFUND',
          originalSaleRecordId: item.saleRecordId,
          refundQty: rQty,
          refundReason: refundReason.trim(),
          remark: remark.trim() || null,
        }),
      })
      const body = await res.json()

      if (res.ok) {
        setResult({ ...body, productNameSnapshot: item.productNameSnapshot, quantity: rQty })
        handleClear()
      } else {
        const msg =
          body.error === 'REFUND_QTY_EXCEEDED'
            ? `超出可退数量，当前可退 ${body.availableQty}`
            : body.message ?? body.error ?? '提交失败'
        setSubmitError(msg)
      }
    } catch {
      setSubmitError('网络错误，请重试')
    } finally {
      setSubmitState('idle')
    }
  }

  // ── Clear ──────────────────────────────────────────────────────────────────

  function handleClear() {
    setRecordNoInput('')
    setLookupState('idle')
    setLookupError(null)
    setLookup(null)
    setRefundQty(1)
    setRefundReason('')
    setRemark('')
    setSubmitError(null)
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={s.page}>
      {/* ── Red header bar ── */}
      <div style={s.headerBar}>
        <span style={s.headerTitle}>退款</span>
      </div>

      <div style={s.body}>
        {/* ── Success card ── */}
        {result && (
          <div style={s.successCard}>
            <div style={s.successIcon}>✓</div>
            <div style={s.successTitle}>退款成功</div>
            <div style={s.successGrid}>
              <InfoRow label="退款单号" value={result.recordNo} mono />
              <InfoRow label="退款金额" value={`-$${Math.abs(result.lineAmount).toFixed(2)}`} red />
              <InfoRow label="时间" value={new Date(result.createdAt).toLocaleTimeString('zh-CN')} />
              {result.productNameSnapshot && (
                <InfoRow label="商品" value={result.productNameSnapshot} />
              )}
              {result.quantity != null && (
                <InfoRow label="数量" value={String(result.quantity)} />
              )}
            </div>
            <button style={s.newRefundBtn} onClick={() => setResult(null)}>继续退款</button>
          </div>
        )}

        {!result && (
          <>
            {/* ── Record number query card ── */}
            <div style={s.card}>
              <div style={s.cardLabel}>原销售单号</div>
              <div style={s.searchRow}>
                <input
                  style={s.searchInput}
                  type="text"
                  placeholder="例如：S-20240101-STORE-A-0001"
                  value={recordNoInput}
                  onChange={(e) => setRecordNoInput(e.target.value)}
                  onKeyDown={handleRecordNoKeyDown}
                  autoFocus
                />
                <button
                  style={s.searchBtn}
                  type="button"
                  onClick={handleLookup}
                  disabled={lookupState === 'loading' || !recordNoInput.trim()}
                >
                  {lookupState === 'loading' ? '…' : '查找'}
                </button>
              </div>
              {lookupError && <div style={s.errorMsg}>{lookupError}</div>}
            </div>

            {/* ── Empty state ── */}
            {lookupState !== 'found' && (
              <div style={s.emptyState}>
                <div style={s.emptyIcon}>↩</div>
                <div style={s.emptyTitle}>请先查询原销售单</div>
                <div style={s.emptyDesc}>输入销售单号后显示退款信息</div>
              </div>
            )}

            {/* ── Found: product info + refund form ── */}
            {lookupState === 'found' && lookup && item && (
              <form onSubmit={handleSubmit}>
                {/* Product info card — light red bg */}
                <div style={s.productCard}>
                  <div style={s.productName}>{item.productNameSnapshot}</div>
                  {item.specSnapshot && <div style={s.productSpec}>{item.specSnapshot}</div>}
                  <div style={s.productMeta}>
                    <span style={s.metaLabel}>原售价</span>
                    <span style={s.metaValue}>${item.unitPrice.toFixed(2)}</span>
                  </div>
                  {/* 3-cell qty row */}
                  <div style={s.qtyGrid}>
                    <QtyCell label="已售" value={item.originalQty} />
                    <div style={s.qtyDivider} />
                    <QtyCell label="已退" value={item.refundedQty} />
                    <div style={s.qtyDivider} />
                    <QtyCell label="可退" value={item.availableQty} highlight />
                  </div>
                  <div style={s.origNo}>原单号：{lookup.originalRecordNo}</div>
                </div>

                {/* Refund qty stepper */}
                <div style={s.card}>
                  <div style={s.cardLabel}>本次退款数量（最多 {item.availableQty}）</div>
                  <div style={s.stepperRow}>
                    <button
                      type="button"
                      style={s.stepperBtn}
                      onClick={() => setRefundQty(Math.max(1, rQty - 1))}
                    >−</button>
                    <span style={s.stepperValue}>{rQty}</span>
                    <button
                      type="button"
                      style={s.stepperBtn}
                      onClick={() => setRefundQty(Math.min(item.availableQty, rQty + 1))}
                    >+</button>
                  </div>
                </div>

                {/* Refund amount preview */}
                <div style={s.previewCard}>
                  <span style={s.previewLabel}>退款金额</span>
                  <span style={s.previewAmount}>-${refundPreview}</span>
                </div>

                {/* Refund reason */}
                <div style={s.card}>
                  <div style={s.cardLabel}>退款原因 *</div>
                  <input
                    style={s.remarkInput}
                    type="text"
                    placeholder="必填"
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                  />
                </div>

                {/* Remark */}
                <div style={s.card}>
                  <div style={s.cardLabel}>备注（可选）</div>
                  <input
                    style={s.remarkInput}
                    type="text"
                    placeholder="输入备注…"
                    value={remark}
                    onChange={(e) => setRemark(e.target.value)}
                  />
                </div>

                {submitError && <div style={s.errorMsg}>{submitError}</div>}

                {/* Actions */}
                <div style={s.actions}>
                  <button type="button" style={s.clearBtn} onClick={handleClear}>清空</button>
                  <button
                    type="submit"
                    style={s.submitBtn}
                    disabled={submitState === 'submitting' || rQty <= 0}
                  >
                    {submitState === 'submitting' ? '提交中…' : '确认退款'}
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

// ─── Sub-components ───────────────────────────────────────────────────────────

function InfoRow({ label, value, mono, red }: {
  label: string; value: string; mono?: boolean; red?: boolean
}) {
  return (
    <div style={ir.row}>
      <span style={ir.label}>{label}</span>
      <span style={{
        ...ir.value,
        ...(mono ? ir.mono : {}),
        ...(red ? ir.red : {}),
      }}>
        {value}
      </span>
    </div>
  )
}

function QtyCell({ label, value, highlight }: {
  label: string; value: number; highlight?: boolean
}) {
  return (
    <div style={qc.cell}>
      <div style={{ ...qc.value, ...(highlight ? qc.highlight : {}) }}>{value}</div>
      <div style={qc.label}>{label}</div>
    </div>
  )
}

const ir: Record<string, React.CSSProperties> = {
  row: { display: 'flex', justifyContent: 'space-between', padding: '5px 0' },
  label: { fontSize: 13, color: 'rgba(255,255,255,0.75)' },
  value: { fontSize: 13, color: '#fff' },
  mono: { fontFamily: 'monospace', fontSize: 12 },
  red: { color: '#ffccc7', fontWeight: 700, fontSize: 16 },
}

const qc: Record<string, React.CSSProperties> = {
  cell: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 },
  value: { fontSize: 20, fontWeight: 700, color: '#1a1a1a' },
  highlight: { color: '#ff4d4f' },
  label: { fontSize: 11, color: '#8c8c8c', textTransform: 'uppercase', letterSpacing: '0.03em' },
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
    background: 'var(--red)',
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
  searchInput: {
    flex: 1,
    height: 42,
    border: '1.5px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '0 12px',
    fontSize: 15,
    outline: 'none',
    background: '#f7f8fa',
  },
  searchBtn: {
    height: 42,
    padding: '0 16px',
    background: 'var(--red)',
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
  // Product info card (light red bg)
  productCard: {
    background: '#fff1f0',
    border: '1px solid #ffccc7',
    borderRadius: 'var(--radius)',
    padding: '14px 16px',
    marginBottom: 10,
  },
  productName: {
    fontSize: 17,
    fontWeight: 700,
    color: 'var(--text)',
    marginBottom: 2,
  },
  productSpec: {
    fontSize: 13,
    color: 'var(--muted)',
    marginBottom: 10,
  },
  productMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 12,
    marginBottom: 12,
    borderBottom: '1px solid #ffccc7',
  },
  metaLabel: {
    fontSize: 13,
    color: 'var(--muted)',
  },
  metaValue: {
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--text)',
  },
  qtyGrid: {
    display: 'flex',
    alignItems: 'center',
    background: '#fff',
    borderRadius: 'var(--radius-sm)',
    padding: '10px 0',
    marginBottom: 10,
    border: '1px solid #ffccc7',
  },
  qtyDivider: {
    width: 1,
    height: 28,
    background: '#ffccc7',
  },
  origNo: {
    fontSize: 11,
    color: '#aaa',
    fontFamily: 'monospace',
  },
  // Stepper
  stepperRow: {
    display: 'flex',
    alignItems: 'center',
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
    color: 'var(--red)',
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
  // Preview card
  previewCard: {
    background: 'var(--red)',
    borderRadius: 'var(--radius)',
    padding: '14px 18px',
    marginBottom: 10,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  previewLabel: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    fontWeight: 500,
  },
  previewAmount: {
    fontSize: 26,
    fontWeight: 800,
    color: '#fff',
    letterSpacing: '-0.02em',
  },
  // Inputs
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
    background: 'var(--red)',
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
  // Success card (green bg)
  successCard: {
    background: 'var(--green)',
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
    background: 'rgba(255,255,255,0.25)',
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
    borderTop: '1px solid rgba(255,255,255,0.25)',
    paddingTop: 12,
    marginBottom: 16,
  },
  newRefundBtn: {
    height: 44,
    padding: '0 28px',
    background: 'rgba(255,255,255,0.2)',
    color: '#fff',
    border: '1px solid rgba(255,255,255,0.35)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 15,
    fontWeight: 600,
  },
}
