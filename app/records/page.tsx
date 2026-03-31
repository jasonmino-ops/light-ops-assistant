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
  return n < 0 ? `-¥${abs}` : `¥${abs}`
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

  // Reload from page 1 whenever filters change
  useEffect(() => {
    fetchRecords(1, false)
  }, [fetchRecords])

  function handleLoadMore() {
    fetchRecords(page + 1, true)
  }

  const hasMore = items.length < total

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <main style={s.page}>
      <h1 style={s.title}>记录</h1>

      {/* ── Filters ── */}
      <div style={s.filterBar}>
        <div style={s.filterRow}>
          <label style={s.filterLabel}>从</label>
          <input
            type="date"
            style={s.dateInput}
            value={dateFrom}
            max={dateTo}
            onChange={(e) => setDateFrom(e.target.value)}
          />
          <label style={s.filterLabel}>到</label>
          <input
            type="date"
            style={s.dateInput}
            value={dateTo}
            min={dateFrom}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>

        <div style={s.typeRow}>
          {(['ALL', 'SALE', 'REFUND'] as const).map((t) => (
            <button
              key={t}
              style={{
                ...s.typeBtn,
                ...(saleTypeFilter === t ? s.typeBtnActive : {}),
              }}
              onClick={() => setSaleTypeFilter(t)}
            >
              {t === 'ALL' ? '全部' : t === 'SALE' ? '销售' : '退款'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Summary ── */}
      {summary && (
        <div style={s.summaryBar}>
          <SummaryCell label="销售" value={String(summary.saleCount)} />
          <div style={s.summaryDivider} />
          <SummaryCell label="退款" value={String(summary.refundCount)} />
          <div style={s.summaryDivider} />
          <SummaryCell
            label="净收入"
            value={fmtAmount(summary.netAmount)}
            valueStyle={{ color: summary.netAmount >= 0 ? '#389e0d' : '#cf1322' }}
          />
        </div>
      )}

      {/* ── List ── */}
      {loading && <p style={s.hint}>加载中…</p>}
      {error && <p style={s.errorText}>{error}</p>}

      {!loading && !error && items.length === 0 && (
        <p style={s.hint}>暂无记录</p>
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
          {loadingMore ? '加载中…' : `加载更多（已显示 ${items.length} / ${total}）`}
        </button>
      )}
    </main>
  )
}

// ─── RecordCard ───────────────────────────────────────────────────────────────

function RecordCard({ item }: { item: RecordItem }) {
  const isRefund = item.saleType === 'REFUND'
  return (
    <div style={{ ...s.card, ...(isRefund ? s.cardRefund : {}) }}>
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
          <span style={s.cardSpec}>{item.specSnapshot}</span>
        )}
      </div>

      <div style={s.cardFooter}>
        <span style={s.cardQtyPrice}>
          {Math.abs(item.quantity)} 件 × ¥{item.unitPrice.toFixed(2)}
        </span>
        <span style={{ ...s.cardAmount, color: isRefund ? '#cf1322' : '#1a1a1a' }}>
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
  valueStyle,
}: {
  label: string
  value: string
  valueStyle?: React.CSSProperties
}) {
  return (
    <div style={s.summaryCell}>
      <span style={{ ...s.summaryCellValue, ...valueStyle }}>{value}</span>
      <span style={s.summaryCellLabel}>{label}</span>
    </div>
  )
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
    marginBottom: 16,
  },
  // Filter bar
  filterBar: {
    background: '#fff',
    border: '1px solid #e8e8e8',
    borderRadius: 10,
    padding: '12px 14px',
    marginBottom: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  filterRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  filterLabel: {
    fontSize: 13,
    color: '#888',
    whiteSpace: 'nowrap',
  },
  dateInput: {
    flex: 1,
    height: 36,
    padding: '0 8px',
    border: '1px solid #d0d0d0',
    borderRadius: 6,
    fontSize: 14,
    background: '#fff',
  },
  typeRow: {
    display: 'flex',
    gap: 8,
  },
  typeBtn: {
    flex: 1,
    height: 34,
    border: '1px solid #d0d0d0',
    borderRadius: 6,
    background: '#fff',
    fontSize: 14,
    cursor: 'pointer',
    color: '#555',
  },
  typeBtnActive: {
    background: '#1677ff',
    borderColor: '#1677ff',
    color: '#fff',
    fontWeight: 600,
  },
  // Summary bar
  summaryBar: {
    display: 'flex',
    background: '#fff',
    border: '1px solid #e8e8e8',
    borderRadius: 10,
    marginBottom: 12,
    overflow: 'hidden',
  },
  summaryCell: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '10px 0',
    gap: 2,
  },
  summaryCellValue: {
    fontSize: 18,
    fontWeight: 600,
    color: '#1a1a1a',
  },
  summaryCellLabel: {
    fontSize: 12,
    color: '#888',
  },
  summaryDivider: {
    width: 1,
    background: '#e8e8e8',
    margin: '8px 0',
  },
  // Cards
  card: {
    background: '#fff',
    border: '1px solid #e8e8e8',
    borderRadius: 10,
    padding: '12px 14px',
    marginBottom: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  cardRefund: {
    background: '#fff1f0',
    borderColor: '#ffa39e',
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
    color: '#1677ff',
    padding: '1px 6px',
    borderRadius: 4,
  },
  tagRefund: {
    fontSize: 11,
    fontWeight: 600,
    background: '#fff1f0',
    color: '#cf1322',
    padding: '1px 6px',
    borderRadius: 4,
    border: '1px solid #ffa39e',
  },
  cardTime: {
    fontSize: 13,
    color: '#888',
  },
  cardRecordNo: {
    fontSize: 12,
    color: '#bbb',
    marginLeft: 'auto',
    fontFamily: 'monospace',
  },
  cardProduct: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
  },
  cardProductName: {
    fontSize: 16,
    fontWeight: 500,
  },
  cardSpec: {
    fontSize: 13,
    color: '#888',
  },
  cardFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardQtyPrice: {
    fontSize: 13,
    color: '#888',
  },
  cardAmount: {
    fontSize: 18,
    fontWeight: 600,
  },
  cardReason: {
    fontSize: 12,
    color: '#888',
    borderTop: '1px solid #ffd6d6',
    paddingTop: 6,
    marginTop: 2,
  },
  // Misc
  hint: {
    textAlign: 'center',
    color: '#aaa',
    padding: '32px 0',
    fontSize: 14,
  },
  errorText: {
    textAlign: 'center',
    color: '#cf1322',
    padding: '16px 0',
    fontSize: 14,
  },
  loadMoreBtn: {
    width: '100%',
    height: 44,
    background: '#fff',
    border: '1px solid #d0d0d0',
    borderRadius: 8,
    fontSize: 14,
    color: '#555',
    cursor: 'pointer',
    marginTop: 4,
  },
}
