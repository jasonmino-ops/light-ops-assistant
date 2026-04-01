'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

type SaleType = 'SALE' | 'REFUND'

type RecordItem = {
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
  saleType: SaleType
  refundReason: string | null
}

type Summary = {
  saleCount: number
  refundCount: number
  netAmount: number
}

type ApiResponse = {
  total: number
  page: number
  pageSize: number
  items: RecordItem[]
  summary: Summary
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function fmtAmount(n: number) {
  const abs = Math.abs(n).toFixed(2)
  return n < 0 ? `-$${abs}` : `$${abs}`
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20

export default function RecordsPage() {
  const today = todayStr()

  const [dateFrom, setDateFrom] = useState(today)
  const [dateTo, setDateTo] = useState(today)
  const [saleTypeFilter, setSaleTypeFilter] = useState<'ALL' | SaleType>('ALL')

  const [items, setItems] = useState<RecordItem[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)

  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchRecords = useCallback(
    async (targetPage: number, append: boolean) => {
      append ? setLoadingMore(true) : setLoading(true)
      setError(null)

      const params = new URLSearchParams({
        dateFrom,
        dateTo,
        page: String(targetPage),
        pageSize: String(PAGE_SIZE),
      })
      if (saleTypeFilter !== 'ALL') params.set('saleType', saleTypeFilter)

      try {
        const res = await apiFetch(`/api/records?${params}`)
        if (!res.ok) {
          setError('加载失败，请重试')
          return
        }
        const data: ApiResponse = await res.json()

        setItems((prev) => (append ? [...prev, ...data.items] : data.items))
        setSummary(data.summary)
        setTotal(data.total)
        setPage(data.page)
      } catch {
        setError('网络错误，请重试')
      } finally {
        append ? setLoadingMore(false) : setLoading(false)
      }
    },
    [dateFrom, dateTo, saleTypeFilter],
  )

  useEffect(() => {
    fetchRecords(1, false)
  }, [fetchRecords])

  function handleLoadMore() {
    fetchRecords(page + 1, true)
  }

  const hasMore = items.length < total

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={s.page}>
      {/* ── Blue header bar ── */}
      <div style={s.headerBar}>
        <span style={s.headerTitle}>记录</span>
      </div>

      <div style={s.body}>
        {/* ── Filter card ── */}
        <div style={s.card}>
          {/* Date row */}
          <div style={s.dateRow}>
            <input
              type="date"
              style={s.dateInput}
              value={dateFrom}
              max={dateTo}
              onChange={(e) => setDateFrom(e.target.value)}
            />
            <span style={s.dateSep}>—</span>
            <input
              type="date"
              style={s.dateInput}
              value={dateTo}
              min={dateFrom}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          {/* Type pills */}
          <div style={s.pillRow}>
            {(['ALL', 'SALE', 'REFUND'] as const).map((t) => (
              <button
                key={t}
                style={{ ...s.pill, ...(saleTypeFilter === t ? s.pillActive : {}) }}
                onClick={() => setSaleTypeFilter(t)}
              >
                {t === 'ALL' ? '全部' : t === 'SALE' ? '销售' : '退款'}
              </button>
            ))}
          </div>
        </div>

        {/* ── Summary bar ── */}
        {summary && (
          <div style={s.summaryCard}>
            <SummaryCell label="销售" value={String(summary.saleCount)} unit="笔" />
            <div style={s.summaryDivider} />
            <SummaryCell label="退款" value={String(summary.refundCount)} unit="笔" />
            <div style={s.summaryDivider} />
            <SummaryCell
              label="净收入"
              value={fmtAmount(summary.netAmount)}
              colored={summary.netAmount >= 0 ? 'green' : 'red'}
            />
          </div>
        )}

        {/* ── List ── */}
        {loading && <div style={s.hint}>加载中…</div>}
        {error && <div style={s.errorText}>{error}</div>}

        {!loading && !error && items.length === 0 && (
          <div style={s.emptyState}>
            <div style={s.emptyIcon}>📋</div>
            <div style={s.emptyTitle}>暂无记录</div>
          </div>
        )}

        {items.map((item) => (
          <RecordCard key={item.id} item={item} />
        ))}

        {hasMore && (
          <button
            style={s.loadMoreBtn}
            onClick={handleLoadMore}
            disabled={loadingMore}
          >
            {loadingMore ? '加载中…' : `加载更多（${items.length} / ${total}）`}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── RecordCard ───────────────────────────────────────────────────────────────

function RecordCard({ item }: { item: RecordItem }) {
  const isRefund = item.saleType === 'REFUND'
  return (
    <div style={{ ...s.recordCard, ...(isRefund ? s.recordCardRefund : {}) }}>
      <div style={s.cardHeader}>
        <span style={isRefund ? s.tagRefund : s.tagSale}>
          {isRefund ? '退款' : '销售'}
        </span>
        <span style={s.cardTime}>{fmtTime(item.createdAt)}</span>
        <span style={s.cardRecordNo}>{item.recordNo}</span>
      </div>

      <div style={s.cardProduct}>
        <span style={s.cardProductName}>{item.productNameSnapshot}</span>
        {item.specSnapshot && (
          <span style={s.cardSpec}> · {item.specSnapshot}</span>
        )}
      </div>

      <div style={s.cardFooter}>
        <span style={s.cardQtyPrice}>
          {Math.abs(item.quantity)} 件 × ${item.unitPrice.toFixed(2)}
        </span>
        <span style={{ ...s.cardAmount, color: isRefund ? 'var(--red)' : 'var(--text)' }}>
          {fmtAmount(item.lineAmount)}
        </span>
      </div>

      {isRefund && item.refundReason && (
        <div style={s.cardReason}>退款原因：{item.refundReason}</div>
      )}
    </div>
  )
}

// ─── SummaryCell ──────────────────────────────────────────────────────────────

function SummaryCell({
  label,
  value,
  unit,
  colored,
}: {
  label: string
  value: string
  unit?: string
  colored?: 'green' | 'red'
}) {
  const color = colored === 'green' ? 'var(--green)' : colored === 'red' ? 'var(--red)' : 'var(--text)'
  return (
    <div style={sc.cell}>
      <div style={{ ...sc.value, color }}>
        {value}{unit && <span style={sc.unit}>{unit}</span>}
      </div>
      <div style={sc.label}>{label}</div>
    </div>
  )
}

const sc: Record<string, React.CSSProperties> = {
  cell: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 },
  value: { fontSize: 18, fontWeight: 700, color: 'var(--text)' },
  unit: { fontSize: 12, fontWeight: 400, color: 'var(--muted)', marginLeft: 2 },
  label: { fontSize: 12, color: 'var(--muted)' },
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
  // Filter card
  card: {
    background: 'var(--card)',
    borderRadius: 'var(--radius)',
    padding: '14px 16px',
    marginBottom: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  dateRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  dateInput: {
    flex: 1,
    height: 38,
    padding: '0 8px',
    border: '1.5px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 14,
    background: '#f7f8fa',
    outline: 'none',
  },
  dateSep: {
    color: 'var(--muted)',
    flexShrink: 0,
    fontSize: 14,
  },
  pillRow: {
    display: 'flex',
    gap: 8,
  },
  pill: {
    flex: 1,
    height: 34,
    border: '1.5px solid var(--border)',
    borderRadius: 20,
    background: '#f7f8fa',
    fontSize: 13,
    color: 'var(--muted)',
    fontWeight: 500,
  },
  pillActive: {
    background: 'var(--blue)',
    borderColor: 'var(--blue)',
    color: '#fff',
    fontWeight: 700,
  },
  // Summary card
  summaryCard: {
    background: 'var(--card)',
    borderRadius: 'var(--radius)',
    padding: '12px 16px',
    marginBottom: 10,
    display: 'flex',
    alignItems: 'center',
  },
  summaryDivider: {
    width: 1,
    height: 30,
    background: 'var(--border)',
    flexShrink: 0,
  },
  // Record cards
  recordCard: {
    background: 'var(--card)',
    borderRadius: 'var(--radius)',
    padding: '12px 14px',
    marginBottom: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  recordCardRefund: {
    background: '#fff1f0',
    border: '1px solid #ffccc7',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  tagSale: {
    fontSize: 11,
    fontWeight: 600,
    background: '#e6f4ff',
    color: 'var(--blue)',
    padding: '1px 7px',
    borderRadius: 10,
  },
  tagRefund: {
    fontSize: 11,
    fontWeight: 600,
    background: '#fff1f0',
    color: 'var(--red)',
    padding: '1px 7px',
    borderRadius: 10,
    border: '1px solid #ffccc7',
  },
  cardTime: {
    fontSize: 13,
    color: 'var(--muted)',
  },
  cardRecordNo: {
    fontSize: 11,
    color: '#ccc',
    marginLeft: 'auto',
    fontFamily: 'monospace',
  },
  cardProduct: {
    display: 'flex',
    alignItems: 'baseline',
    flexWrap: 'wrap',
  },
  cardProductName: {
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--text)',
  },
  cardSpec: {
    fontSize: 13,
    color: 'var(--muted)',
  },
  cardFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardQtyPrice: {
    fontSize: 13,
    color: 'var(--muted)',
  },
  cardAmount: {
    fontSize: 18,
    fontWeight: 700,
  },
  cardReason: {
    fontSize: 12,
    color: 'var(--muted)',
    borderTop: '1px solid #ffccc7',
    paddingTop: 6,
    marginTop: 2,
  },
  // States
  hint: {
    textAlign: 'center',
    color: 'var(--muted)',
    padding: '32px 0',
    fontSize: 14,
  },
  errorText: {
    textAlign: 'center',
    color: 'var(--red)',
    padding: '16px 0',
    fontSize: 14,
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '40px 20px',
    gap: 8,
  },
  emptyIcon: {
    fontSize: 40,
    color: '#d0d0d0',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: '#aaa',
  },
  loadMoreBtn: {
    width: '100%',
    height: 44,
    background: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 14,
    color: 'var(--muted)',
    marginBottom: 12,
  },
}
