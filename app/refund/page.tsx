'use client'

import { useState, useEffect, useCallback, FormEvent } from 'react'
import { apiFetch } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

type SaleListItem = {
  id: string
  recordNo: string
  createdAt: string
  storeName: string
  operatorDisplayName: string
  productNameSnapshot: string
  specSnapshot: string | null
  quantity: number
  unitPrice: number
  lineAmount: number
  saleType: 'SALE' | 'REFUND'
  refundReason: string | null
}

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

type Phase = 'list' | 'refund'
type QuickFilter = 'recent' | 'today' | 'mine'
type LookupState = 'idle' | 'loading' | 'found' | 'error'
type SubmitState = 'idle' | 'submitting'

const LOOKUP_ERROR_MSG: Record<string, string> = {
  NOT_FOUND: '未找到该销售单',
  IS_REFUND_RECORD: '该单号是退款单，不能再次退款',
  FULLY_REFUNDED: '该商品已全部退款，无可退数量',
  NOT_COMPLETED: '该订单状态不允许退款',
}

const FILTERS: Array<[QuickFilter, string]> = [
  ['recent', '最近 10 笔'],
  ['today', '今日订单'],
  ['mine', '我的操作'],
]

const REFUND_REASONS = ['商品拿错', '顾客不要了', '商品有问题', '重复录入', '其他']

// ─── Utils ────────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function pastDateStr(daysAgo: number) {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}

function fmtDateTime(iso: string) {
  const d = new Date(iso)
  const mm = d.getMonth() + 1
  const dd = d.getDate()
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${mm}/${dd} ${hh}:${min}`
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RefundPage() {
  // ── List phase state ───────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>('list')
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('recent')
  const [searchQuery, setSearchQuery] = useState('')
  const [listItems, setListItems] = useState<SaleListItem[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)

  // ── Refund phase state ─────────────────────────────────────────────────────
  const [lookupState, setLookupState] = useState<LookupState>('idle')
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [lookup, setLookup] = useState<LookupResult | null>(null)
  const [refundQty, setRefundQty] = useState(1)
  const [refundReason, setRefundReason] = useState('商品拿错')
  const [refundReasonOther, setRefundReasonOther] = useState('')
  const [remark, setRemark] = useState('')
  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [result, setResult] = useState<RefundResult | null>(null)

  const item = lookup?.items[0] ?? null
  const rQty = Math.max(1, refundQty)
  const refundPreview = item ? (item.unitPrice * rQty).toFixed(2) : '0.00'

  // ── Fetch sale list ────────────────────────────────────────────────────────
  // FIX: /api/records always requires dateFrom + dateTo.
  // 'recent' and 'mine' use last 90 days; 'today' uses today only.

  const fetchList = useCallback(async (filter: QuickFilter) => {
    setListLoading(true)
    setListError(null)
    const today = todayStr()
    const params = new URLSearchParams({ saleType: 'SALE', pageSize: '10' })
    if (filter === 'today') {
      params.set('dateFrom', today)
      params.set('dateTo', today)
    } else {
      // 'recent' and 'mine': past 90 days
      params.set('dateFrom', pastDateStr(90))
      params.set('dateTo', today)
    }
    try {
      const res = await apiFetch(`/api/records?${params}`)
      if (res.ok) {
        const data = await res.json()
        setListItems(data.items ?? [])
      } else {
        const body = await res.json().catch(() => ({}))
        setListError(body.message ?? '加载失败，请重试')
      }
    } catch {
      setListError('网络错误，请重试')
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchList(quickFilter)
  }, [fetchList, quickFilter])

  // Client-side search across visible list
  const filteredItems = searchQuery.trim()
    ? listItems.filter((rec) => {
        const q = searchQuery.toLowerCase()
        return (
          rec.recordNo.toLowerCase().includes(q) ||
          rec.productNameSnapshot.toLowerCase().includes(q) ||
          (rec.specSnapshot ?? '').toLowerCase().includes(q) ||
          rec.operatorDisplayName.toLowerCase().includes(q)
        )
      })
    : listItems

  // ── Start refund flow from a list card ────────────────────────────────────

  async function startRefund(record: SaleListItem) {
    setPhase('refund')
    setLookupState('loading')
    setLookupError(null)
    setLookup(null)
    setRefundQty(1)
    setRefundReason('商品拿错')
    setRefundReasonOther('')
    setRemark('')
    setResult(null)
    setSubmitError(null)

    try {
      const res = await apiFetch(
        `/api/sales/lookup?recordNo=${encodeURIComponent(record.recordNo)}`
      )
      const body = await res.json()
      if (res.ok) {
        setLookup(body)
        setRefundQty(body.items[0]?.availableQty ?? 1)
        setLookupState('found')
      } else {
        const msg = LOOKUP_ERROR_MSG[body.reason ?? body.error] ?? '该订单无法退款'
        setLookupError(msg)
        setLookupState('error')
      }
    } catch {
      setLookupError('网络错误，请重试')
      setLookupState('error')
    }
  }

  // ── Back to list ──────────────────────────────────────────────────────────

  function backToList(refresh = false) {
    setPhase('list')
    setLookupState('idle')
    setLookupError(null)
    setLookup(null)
    setResult(null)
    setSubmitError(null)
    if (refresh) fetchList(quickFilter)
  }

  // ── Submit refund ─────────────────────────────────────────────────────────

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!item) return
    if (rQty <= 0) { setSubmitError('退款数量必须大于 0'); return }
    if (rQty > item.availableQty) {
      setSubmitError(`退款数量不能超过可退数量 ${item.availableQty}`)
      return
    }
    if (!refundReason) { setSubmitError('请选择退款原因'); return }
    if (refundReason === '其他' && !refundReasonOther.trim()) {
      setSubmitError('请补充"其他"的具体原因')
      return
    }

    const finalReason =
      refundReason === '其他'
        ? `其他：${refundReasonOther.trim()}`
        : refundReason

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
          refundReason: finalReason,
          remark: remark.trim() || null,
        }),
      })
      const body = await res.json()
      if (res.ok) {
        setResult({
          ...body,
          productNameSnapshot: item.productNameSnapshot,
          quantity: rQty,
        })
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

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={s.page}>
      {/* ── Header ── */}
      <div style={s.headerBar}>
        {phase === 'refund' && (
          <button style={s.backBtn} onClick={() => backToList(false)}>‹</button>
        )}
        <span style={s.headerTitle}>
          {phase === 'list' ? '退款' : '确认退款'}
        </span>
      </div>

      <div style={s.body}>

        {/* ══════════ LIST PHASE ══════════ */}
        {phase === 'list' && (
          <>
            {/* Search bar */}
            <div style={s.searchCard}>
              <div style={s.searchRow}>
                <span style={s.searchIcon}>🔍</span>
                <input
                  style={s.searchInput}
                  type="text"
                  placeholder="搜索单号 / 商品名 / 规格 / 店员"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button style={s.clearSearch} onClick={() => setSearchQuery('')}>✕</button>
                )}
              </div>
            </div>

            {/* Quick filter pills */}
            <div style={s.filterRow}>
              {FILTERS.map(([key, label]) => (
                <button
                  key={key}
                  style={{
                    ...s.filterPill,
                    ...(quickFilter === key ? s.filterPillActive : {}),
                  }}
                  onClick={() => setQuickFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* States */}
            {listLoading && <div style={s.hint}>加载中…</div>}
            {listError && (
              <div style={s.hintError}>
                {listError}
                <button style={s.retryBtn} onClick={() => fetchList(quickFilter)}>重试</button>
              </div>
            )}

            {!listLoading && !listError && filteredItems.length === 0 && (
              <div style={s.emptyState}>
                <div style={s.emptyIcon}>↩</div>
                <div style={s.emptyTitle}>
                  {searchQuery ? '无匹配订单' : '暂无可退款销售单'}
                </div>
                <div style={s.emptyDesc}>
                  {searchQuery ? '请尝试其他关键词' : '切换筛选条件或等待新销售记录'}
                </div>
              </div>
            )}

            {/* Sale record cards */}
            {filteredItems.map((record) => (
              <SaleCard
                key={record.id}
                item={record}
                onRefund={() => startRefund(record)}
              />
            ))}
          </>
        )}

        {/* ══════════ REFUND PHASE ══════════ */}
        {phase === 'refund' && (
          <>
            {/* Success card */}
            {result && (
              <div style={s.successCard}>
                <div style={s.successIconWrap}>✓</div>
                <div style={s.successTitle}>退款成功</div>
                <div style={s.successGrid}>
                  <InfoRow label="退款单号" value={result.recordNo} mono />
                  <InfoRow
                    label="退款金额"
                    value={`-$${Math.abs(result.lineAmount).toFixed(2)}`}
                    red
                  />
                  <InfoRow
                    label="时间"
                    value={new Date(result.createdAt).toLocaleTimeString('zh-CN')}
                  />
                  {result.productNameSnapshot && (
                    <InfoRow label="商品" value={result.productNameSnapshot} />
                  )}
                  {result.quantity != null && (
                    <InfoRow label="数量" value={String(result.quantity)} />
                  )}
                </div>
                <button style={s.nextBtn} onClick={() => backToList(true)}>
                  返回订单列表
                </button>
              </div>
            )}

            {/* Lookup loading */}
            {!result && lookupState === 'loading' && (
              <div style={s.hint}>查询订单中…</div>
            )}

            {/* Lookup error */}
            {!result && lookupState === 'error' && (
              <div style={s.errorCard}>
                <div style={s.errorCardText}>{lookupError}</div>
                <button style={s.backToListBtn} onClick={() => backToList(false)}>
                  ← 返回列表
                </button>
              </div>
            )}

            {/* Refund form */}
            {!result && lookupState === 'found' && lookup && item && (
              <form onSubmit={handleSubmit}>
                {/* Product info */}
                <div style={s.productCard}>
                  <div style={s.productName}>{item.productNameSnapshot}</div>
                  {item.specSnapshot && (
                    <div style={s.productSpec}>{item.specSnapshot}</div>
                  )}
                  <div style={s.productMeta}>
                    <span style={s.metaLabel}>原售价</span>
                    <span style={s.metaValue}>${item.unitPrice.toFixed(2)}</span>
                  </div>
                  <div style={s.qtyGrid}>
                    <QtyCell label="已售" value={item.originalQty} />
                    <div style={s.qtyDivider} />
                    <QtyCell label="已退" value={item.refundedQty} />
                    <div style={s.qtyDivider} />
                    <QtyCell label="可退" value={item.availableQty} highlight />
                  </div>
                  <div style={s.origNo}>原单号：{lookup.originalRecordNo}</div>
                </div>

                {/* Qty stepper */}
                <div style={s.card}>
                  <div style={s.cardLabel}>
                    本次退款数量（最多 {item.availableQty}）
                  </div>
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
                      onClick={() =>
                        setRefundQty(Math.min(item.availableQty, rQty + 1))
                      }
                    >+</button>
                  </div>
                </div>

                {/* Amount preview */}
                <div style={s.previewCard}>
                  <span style={s.previewLabel}>退款金额</span>
                  <span style={s.previewAmount}>-${refundPreview}</span>
                </div>

                {/* Reason (required) — dropdown */}
                <div style={s.card}>
                  <div style={s.cardLabel}>退款原因 *</div>
                  <select
                    style={s.reasonSelect}
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                  >
                    {REFUND_REASONS.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                  {refundReason === '其他' && (
                    <input
                      style={{ ...s.remarkInput, marginTop: 8 }}
                      type="text"
                      placeholder="请补充说明…"
                      value={refundReasonOther}
                      onChange={(e) => setRefundReasonOther(e.target.value)}
                    />
                  )}
                </div>

                {/* Remark (optional) */}
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

                <div style={s.actions}>
                  <button
                    type="button"
                    style={s.clearBtn}
                    onClick={() => backToList(false)}
                  >
                    返回
                  </button>
                  <button
                    type="submit"
                    style={{
                      ...s.submitBtn,
                      ...(submitState === 'submitting' ? s.submitBtnLoading : {}),
                    }}
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

// ─── SaleCard ─────────────────────────────────────────────────────────────────

function SaleCard({
  item,
  onRefund,
}: {
  item: SaleListItem
  onRefund: () => void
}) {
  return (
    <div style={sc.card}>
      <div style={sc.top}>
        <div style={sc.productLine}>
          <span style={sc.name}>{item.productNameSnapshot}</span>
          {item.specSnapshot && (
            <span style={sc.spec}> · {item.specSnapshot}</span>
          )}
        </div>
        <span style={sc.time}>{fmtDateTime(item.createdAt)}</span>
      </div>
      <div style={sc.recNo}>{item.recordNo}</div>
      <div style={sc.bottom}>
        <span style={sc.qty}>
          {Math.abs(item.quantity)}件 × ${item.unitPrice.toFixed(2)}
        </span>
        <span style={sc.amount}>${item.lineAmount.toFixed(2)}</span>
        <button style={sc.refundBtn} onClick={onRefund}>退款</button>
      </div>
    </div>
  )
}

const sc: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--card)',
    borderRadius: 'var(--radius)',
    padding: '12px 14px',
    marginBottom: 8,
  },
  top: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 4,
  },
  productLine: {
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
  time: {
    fontSize: 12,
    color: 'var(--muted)',
    flexShrink: 0,
  },
  recNo: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#c0c0c0',
    marginBottom: 8,
  },
  bottom: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  qty: {
    flex: 1,
    fontSize: 13,
    color: 'var(--muted)',
  },
  amount: {
    fontSize: 16,
    fontWeight: 700,
    color: 'var(--text)',
    flexShrink: 0,
  },
  refundBtn: {
    flexShrink: 0,
    height: 34,
    padding: '0 14px',
    background: 'var(--red)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    fontSize: 13,
    fontWeight: 600,
  },
}

// ─── InfoRow / QtyCell ────────────────────────────────────────────────────────

function InfoRow({
  label,
  value,
  mono,
  red,
}: {
  label: string
  value: string
  mono?: boolean
  red?: boolean
}) {
  return (
    <div style={ir.row}>
      <span style={ir.label}>{label}</span>
      <span
        style={{
          ...ir.value,
          ...(mono ? ir.mono : {}),
          ...(red ? ir.red : {}),
        }}
      >
        {value}
      </span>
    </div>
  )
}

function QtyCell({
  label,
  value,
  highlight,
}: {
  label: string
  value: number
  highlight?: boolean
}) {
  return (
    <div style={qc.cell}>
      <div style={{ ...qc.value, ...(highlight ? qc.highlight : {}) }}>
        {value}
      </div>
      <div style={qc.label}>{label}</div>
    </div>
  )
}

const ir: Record<string, React.CSSProperties> = {
  row: { display: 'flex', justifyContent: 'space-between', padding: '5px 0' },
  label: { fontSize: 13, color: 'rgba(255,255,255,0.75)' },
  value: { fontSize: 13, color: '#fff' },
  mono: { fontFamily: 'monospace', fontSize: 11 },
  red: { color: '#ffccc7', fontWeight: 700, fontSize: 17 },
}

const qc: Record<string, React.CSSProperties> = {
  cell: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
  },
  value: { fontSize: 20, fontWeight: 700, color: '#1a1a1a' },
  highlight: { color: '#ff4d4f' },
  label: {
    fontSize: 11,
    color: '#8c8c8c',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
  },
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
    background: 'var(--red)',
    padding: '16px 16px 18px',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  backBtn: {
    background: 'none',
    border: 'none',
    color: '#fff',
    fontSize: 26,
    lineHeight: 1,
    padding: '0 4px 0 0',
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

  // ── Search ──
  searchCard: {
    background: 'var(--card)',
    borderRadius: 'var(--radius)',
    padding: '10px 14px',
    marginBottom: 10,
  },
  searchRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  searchIcon: {
    fontSize: 16,
    flexShrink: 0,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: 38,
    border: 'none',
    outline: 'none',
    fontSize: 15,
    background: 'transparent',
    color: 'var(--text)',
  },
  clearSearch: {
    background: 'none',
    border: 'none',
    color: 'var(--muted)',
    fontSize: 14,
    flexShrink: 0,
    padding: '0 2px',
  },

  // ── Filter pills ──
  filterRow: {
    display: 'flex',
    gap: 8,
    marginBottom: 10,
  },
  filterPill: {
    flex: 1,
    height: 34,
    border: '1.5px solid var(--border)',
    borderRadius: 20,
    background: 'var(--card)',
    fontSize: 12,
    color: 'var(--muted)',
    fontWeight: 500,
  },
  filterPillActive: {
    background: 'var(--red)',
    borderColor: 'var(--red)',
    color: '#fff',
    fontWeight: 700,
  },

  // ── States ──
  hint: {
    textAlign: 'center',
    color: 'var(--muted)',
    padding: '32px 0',
    fontSize: 14,
  },
  hintError: {
    textAlign: 'center',
    color: 'var(--red)',
    padding: '16px 0',
    fontSize: 14,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
  },
  retryBtn: {
    height: 34,
    padding: '0 18px',
    background: 'var(--red)',
    color: '#fff',
    border: 'none',
    borderRadius: 20,
    fontSize: 13,
    fontWeight: 600,
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '36px 20px',
    gap: 6,
  },
  emptyIcon: {
    fontSize: 40,
    color: '#d0d0d0',
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

  // ── Refund phase: error card ──
  errorCard: {
    background: 'var(--card)',
    borderRadius: 'var(--radius)',
    padding: '24px 16px',
    marginBottom: 10,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 16,
  },
  errorCardText: {
    fontSize: 15,
    color: 'var(--red)',
    textAlign: 'center',
  },
  backToListBtn: {
    height: 44,
    padding: '0 20px',
    background: '#fff',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 14,
    color: 'var(--muted)',
  },

  // ── Refund phase: form cards ──
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
  metaLabel: { fontSize: 13, color: 'var(--muted)' },
  metaValue: { fontSize: 16, fontWeight: 600, color: 'var(--text)' },
  qtyGrid: {
    display: 'flex',
    alignItems: 'center',
    background: '#fff',
    borderRadius: 'var(--radius-sm)',
    padding: '10px 0',
    marginBottom: 10,
    border: '1px solid #ffccc7',
  },
  qtyDivider: { width: 1, height: 28, background: '#ffccc7' },
  origNo: { fontSize: 11, color: '#aaa', fontFamily: 'monospace' },

  // Stepper
  stepperRow: {
    display: 'flex',
    alignItems: 'center',
    background: '#f7f8fa',
    borderRadius: 'var(--radius-sm)',
    overflow: 'hidden',
    border: '1px solid var(--border)',
    width: '100%',
  },
  stepperBtn: {
    width: 52,
    height: 46,
    flexShrink: 0,
    background: 'none',
    border: 'none',
    fontSize: 24,
    color: 'var(--red)',
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

  // Preview
  previewCard: {
    background: 'var(--red)',
    borderRadius: 'var(--radius)',
    padding: '14px 18px',
    marginBottom: 10,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  previewLabel: { fontSize: 14, color: 'rgba(255,255,255,0.8)', fontWeight: 500 },
  previewAmount: {
    fontSize: 28,
    fontWeight: 800,
    color: '#fff',
    letterSpacing: '-0.02em',
  },

  // Reason select
  reasonSelect: {
    display: 'block',
    width: '100%',
    height: 44,
    border: '1.5px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '0 12px',
    fontSize: 15,
    outline: 'none',
    background: '#f7f8fa',
    appearance: 'auto',
  },

  // Inputs
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

  // Error inline
  errorMsg: {
    fontSize: 13,
    color: 'var(--red)',
    padding: '4px 2px 6px',
  },

  // Actions
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
    background: 'var(--red)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    fontSize: 16,
    fontWeight: 700,
  },
  submitBtnLoading: {
    opacity: 0.7,
  },

  // Success
  successCard: {
    background: 'var(--green)',
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
    background: 'rgba(255,255,255,0.25)',
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
    borderTop: '1px solid rgba(255,255,255,0.25)',
    paddingTop: 12,
    marginBottom: 18,
  },
  nextBtn: {
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
