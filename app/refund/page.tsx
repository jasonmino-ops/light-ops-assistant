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
}

type LookupState = 'idle' | 'loading' | 'found' | 'error'
type SubmitState = 'idle' | 'submitting'

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RefundPage() {
  const [recordNoInput, setRecordNoInput] = useState('')
  const [lookupState, setLookupState] = useState<LookupState>('idle')
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [lookup, setLookup] = useState<LookupResult | null>(null)

  // Refund form (only visible after lookup succeeds)
  const [refundQty, setRefundQty] = useState('1')
  const [refundReason, setRefundReason] = useState('')
  const [remark, setRemark] = useState('')

  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [result, setResult] = useState<RefundResult | null>(null)

  // Derived
  const item = lookup?.items[0] ?? null
  const rQty = Math.max(0, Number(refundQty) || 0)
  const refundPreview = item ? (item.unitPrice * rQty).toFixed(2) : '—'

  // ── Lookup ─────────────────────────────────────────────────────────────────

  async function handleLookup() {
    const no = recordNoInput.trim()
    if (!no) return

    setLookupState('loading')
    setLookupError(null)
    setLookup(null)
    setResult(null)
    setSubmitError(null)
    setRefundQty('1')
    setRefundReason('')
    setRemark('')

    try {
      const res = await apiFetch(`/api/sales/lookup?recordNo=${encodeURIComponent(no)}`)
      const body = await res.json()

      if (res.ok) {
        setLookup(body)
        setRefundQty(String(body.items[0]?.availableQty ?? 1))
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
        setResult(body)
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
    setRefundQty('1')
    setRefundReason('')
    setRemark('')
    setSubmitError(null)
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <main style={s.page}>
      <h1 style={s.title}>退款</h1>

      {/* ── Result card ── */}
      {result && (
        <div style={s.resultCard}>
          <div style={s.resultTitle}>✓ 退款成功</div>
          <Row label="退款单号" value={result.recordNo} />
          <Row label="退款金额" value={`-¥ ${Math.abs(result.lineAmount).toFixed(2)}`} />
          <Row
            label="时间"
            value={new Date(result.createdAt).toLocaleTimeString('zh-CN')}
          />
        </div>
      )}

      {/* ── Step 1: lookup ── */}
      <div style={s.section}>
        <div style={s.sectionTitle}>第一步：查找原销售单</div>
        <div style={s.row}>
          <input
            style={{ ...s.input, flex: 1 }}
            type="text"
            placeholder="输入原销售单号"
            value={recordNoInput}
            onChange={(e) => setRecordNoInput(e.target.value)}
            onKeyDown={handleRecordNoKeyDown}
            autoFocus
          />
          <button
            type="button"
            style={s.btnSecondary}
            onClick={handleLookup}
            disabled={lookupState === 'loading' || !recordNoInput.trim()}
          >
            {lookupState === 'loading' ? '查找中…' : '查找'}
          </button>
        </div>
        {lookupError && <p style={s.error}>{lookupError}</p>}
      </div>

      {/* ── Original sale info (read-only) ── */}
      {lookupState === 'found' && lookup && item && (
        <>
          <div style={s.section}>
            <div style={s.sectionTitle}>原单信息</div>
            <div style={s.infoGrid}>
              <InfoRow label="原单号" value={lookup.originalRecordNo} />
              <InfoRow
                label="销售时间"
                value={new Date(lookup.createdAt).toLocaleString('zh-CN')}
              />
              <InfoRow label="门店" value={lookup.storeName} />
              <InfoRow label="操作员" value={lookup.operatorDisplayName} />
            </div>
          </div>

          <div style={s.section}>
            <div style={s.sectionTitle}>商品信息</div>
            <div style={s.infoGrid}>
              <InfoRow label="商品名称" value={item.productNameSnapshot} />
              <InfoRow label="规格" value={item.specSnapshot ?? '—'} />
              <InfoRow label="原售价" value={`¥ ${item.unitPrice.toFixed(2)}`} />
              <InfoRow label="已售数量" value={String(item.originalQty)} />
              <InfoRow label="已退数量" value={String(item.refundedQty)} />
              <InfoRow
                label="可退数量"
                value={String(item.availableQty)}
                valueStyle={{ color: '#d4380d', fontWeight: 600 }}
              />
            </div>
          </div>

          {/* ── Step 2: refund form ── */}
          <form onSubmit={handleSubmit} style={s.section}>
            <div style={s.sectionTitle}>第二步：填写退款信息</div>

            <div style={s.group}>
              <label style={s.label}>本次退款数量（最多 {item.availableQty}）</label>
              <input
                style={s.input}
                type="number"
                min="1"
                max={item.availableQty}
                step="1"
                value={refundQty}
                onChange={(e) => setRefundQty(e.target.value)}
              />
            </div>

            <div style={s.group}>
              <label style={s.label}>退款金额预览</label>
              <div style={s.refundPreview}>-¥ {refundPreview}</div>
            </div>

            <div style={s.group}>
              <label style={s.label}>退款原因 *</label>
              <input
                style={s.input}
                type="text"
                placeholder="必填"
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
              />
            </div>

            <div style={s.group}>
              <label style={s.label}>备注</label>
              <input
                style={s.input}
                type="text"
                placeholder="可选"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
              />
            </div>

            {submitError && <p style={s.error}>{submitError}</p>}

            <div style={s.actions}>
              <button type="button" style={s.btnSecondary} onClick={handleClear}>
                清空
              </button>
              <button
                type="submit"
                style={s.btnDanger}
                disabled={submitState === 'submitting' || rQty <= 0}
              >
                {submitState === 'submitting' ? '提交中…' : '确认退款'}
              </button>
            </div>
          </form>
        </>
      )}

      {/* Clear button visible in idle/error state too */}
      {lookupState !== 'found' && (recordNoInput || lookupState === 'error') && (
        <div style={{ marginTop: 16 }}>
          <button type="button" style={s.btnSecondary} onClick={handleClear}>
            清空
          </button>
        </div>
      )}
    </main>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={s.resultRow}>
      <span style={s.resultLabel}>{label}</span>
      <span style={s.resultValue}>{value}</span>
    </div>
  )
}

function InfoRow({
  label,
  value,
  valueStyle,
}: {
  label: string
  value: string
  valueStyle?: React.CSSProperties
}) {
  return (
    <div style={s.infoRow}>
      <span style={s.infoLabel}>{label}</span>
      <span style={{ ...s.infoValue, ...valueStyle }}>{value}</span>
    </div>
  )
}

// ─── Error message map ────────────────────────────────────────────────────────

const LOOKUP_ERROR_MSG: Record<string, string> = {
  NOT_FOUND: '未找到该销售单',
  IS_REFUND_RECORD: '该单号是退款单，不能再次退款',
  FULLY_REFUNDED: '该商品已全部退款，无可退数量',
  NOT_COMPLETED: '该订单状态不允许退款',
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
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
  section: {
    background: '#fff',
    border: '1px solid #e8e8e8',
    borderRadius: 10,
    padding: '14px 16px',
    marginBottom: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
  },
  row: {
    display: 'flex',
    gap: 8,
    alignItems: 'stretch',
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
  infoGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 15,
  },
  infoLabel: {
    color: '#888',
    fontSize: 13,
  },
  infoValue: {
    fontWeight: 500,
    textAlign: 'right',
  },
  refundPreview: {
    height: 44,
    padding: '0 12px',
    border: '1px solid #ffd591',
    borderRadius: 8,
    fontSize: 18,
    fontWeight: 600,
    background: '#fff7e6',
    display: 'flex',
    alignItems: 'center',
    color: '#d4380d',
  },
  actions: {
    display: 'flex',
    gap: 12,
    marginTop: 4,
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
  btnDanger: {
    flex: 1,
    height: 48,
    background: '#ff4d4f',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
  },
  error: {
    fontSize: 13,
    color: '#cf1322',
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
