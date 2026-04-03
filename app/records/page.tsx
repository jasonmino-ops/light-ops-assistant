'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

type SaleType = 'SALE' | 'REFUND'

type RecordItem = {
  id: string
  recordNo: string
  orderNo: string | null
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

type OrderGroup = {
  kind: 'order'
  orderNo: string
  createdAt: string
  storeName: string
  operatorDisplayName: string
  items: RecordItem[]
  totalAmount: number
}

type RefundEntry = {
  kind: 'refund'
  item: RecordItem
}

type DisplayEntry = OrderGroup | RefundEntry

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

const ORDER_COLORS = ['#1677ff', '#52c41a', '#fa8c16', '#722ed1']

function buildItemSummary(items: RecordItem[]): string {
  return items.map((i) => `${i.productNameSnapshot}×${i.quantity}`).join('、')
}

function buildEntries(items: RecordItem[]): DisplayEntry[] {
  const groupMap = new Map<string, OrderGroup>()
  const refunds: RefundEntry[] = []

  for (const item of items) {
    if (item.saleType === 'SALE') {
      const key = item.orderNo ?? item.recordNo
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          kind: 'order',
          orderNo: key,
          createdAt: item.createdAt,
          storeName: item.storeName,
          operatorDisplayName: item.operatorDisplayName,
          items: [],
          totalAmount: 0,
        })
      }
      const g = groupMap.get(key)!
      g.items.push(item)
      g.totalAmount += item.lineAmount
    } else {
      refunds.push({ kind: 'refund', item })
    }
  }

  const all: DisplayEntry[] = [...groupMap.values(), ...refunds]
  all.sort((a, b) => {
    const at = a.kind === 'order' ? a.createdAt : a.item.createdAt
    const bt = b.kind === 'order' ? b.createdAt : b.item.createdAt
    return bt.localeCompare(at)
  })
  return all
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50

export default function RecordsPage() {
  const today = todayStr()

  const [dateFrom, setDateFrom] = useState(today)
  const [dateTo, setDateTo] = useState(today)
  const [saleTypeFilter, setSaleTypeFilter] = useState<'ALL' | SaleType>('ALL')

  const [allItems, setAllItems] = useState<RecordItem[]>([])
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
        setAllItems((prev) => (append ? [...prev, ...data.items] : data.items))
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

  const entries = buildEntries(allItems)
  const hasMore = allItems.length < total

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={s.page}>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }`}</style>
      <div style={s.headerBar}>
        <span style={s.headerTitle}>记录</span>
      </div>

      <div style={s.body}>
        {/* ── Filter card ── */}
        <div style={s.card}>
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
        {loading && (
          <div style={s.skeletonWrap}>
            {[72, 60, 72, 60, 72].map((h, i) => (
              <div key={i} style={{ ...s.skeletonCard, height: h }} />
            ))}
          </div>
        )}
        {error && <div style={s.errorText}>{error}</div>}

        {!loading && !error && entries.length === 0 && (
          <div style={s.emptyState}>
            <div style={s.emptyIcon}>📋</div>
            <div style={s.emptyTitle}>暂无记录</div>
          </div>
        )}

        {entries.map((entry, i) =>
          entry.kind === 'order' ? (
            <OrderCard key={entry.orderNo} group={entry} index={i} />
          ) : (
            <RefundCard key={entry.item.id + '-' + i} item={entry.item} />
          )
        )}

        {hasMore && (
          <button
            style={s.loadMoreBtn}
            onClick={handleLoadMore}
            disabled={loadingMore}
          >
            {loadingMore ? '加载中…' : `加载更多（已显示 ${allItems.length} / ${total}）`}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── OrderCard ────────────────────────────────────────────────────────────────

function OrderCard({ group, index }: { group: OrderGroup; index: number }) {
  const accent = ORDER_COLORS[index % ORDER_COLORS.length]
  const isSingle = group.items.length === 1
  const item = group.items[0]

  return (
    <div style={{ ...s.recordCard, borderLeft: `3px solid ${accent}` }}>
      <div style={s.cardHeader}>
        <span style={s.tagSale}>销售单</span>
        <span style={s.cardTime}>{fmtTime(group.createdAt)}</span>
        <span style={s.cardRecordNo}>{group.orderNo}</span>
      </div>

      {isSingle ? (
        <div style={s.cardProduct}>
          <span style={s.cardProductName}>{item.productNameSnapshot}</span>
          {item.specSnapshot && <span style={s.cardSpec}> · {item.specSnapshot}</span>}
        </div>
      ) : (
        <div style={s.cardSummary}>{buildItemSummary(group.items)}</div>
      )}

      <div style={s.cardFooter}>
        {isSingle ? (
          <span style={s.cardQtyPrice}>
            {Math.abs(item.quantity)}件 × ${item.unitPrice.toFixed(2)}
          </span>
        ) : (
          <span style={s.cardQtyPrice}>{group.items.length} 种商品</span>
        )}
        <span style={{ ...s.cardAmount, color: 'var(--text)' }}>
          ${group.totalAmount.toFixed(2)}
        </span>
      </div>

      {!isSingle && (
        <div style={s.itemList}>
          {group.items.map((it) => (
            <div key={it.id} style={s.itemRow}>
              <span style={s.itemName}>
                {it.productNameSnapshot}
                {it.specSnapshot && <span style={s.itemSpec}> · {it.specSnapshot}</span>}
              </span>
              <span style={s.itemAmt}>${it.lineAmount.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── RefundCard ───────────────────────────────────────────────────────────────

function RefundCard({ item }: { item: RecordItem }) {
  return (
    <div style={{ ...s.recordCard, ...s.recordCardRefund }}>
      <div style={s.cardHeader}>
        <span style={s.tagRefund}>退款</span>
        <span style={s.cardTime}>{fmtTime(item.createdAt)}</span>
        <span style={s.cardRecordNo}>{item.recordNo}</span>
      </div>
      <div style={s.cardProduct}>
        <span style={s.cardProductName}>{item.productNameSnapshot}</span>
        {item.specSnapshot && <span style={s.cardSpec}> · {item.specSnapshot}</span>}
      </div>
      <div style={s.cardFooter}>
        <span style={s.cardQtyPrice}>
          {Math.abs(item.quantity)}件 × ${item.unitPrice.toFixed(2)}
        </span>
        <span style={{ ...s.cardAmount, color: 'var(--red)' }}>
          {fmtAmount(item.lineAmount)}
        </span>
      </div>
      {item.refundReason && (
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
  cardSummary: {
    fontSize: 15,
    fontWeight: 500,
    color: 'var(--text)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
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
  itemList: {
    borderTop: '1px solid var(--border)',
    paddingTop: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  itemRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemName: {
    fontSize: 13,
    color: 'var(--text)',
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  itemSpec: {
    color: 'var(--muted)',
    fontWeight: 400,
  },
  itemAmt: {
    fontSize: 13,
    color: 'var(--muted)',
    flexShrink: 0,
    marginLeft: 8,
  },
  skeletonWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  skeletonCard: {
    borderRadius: 'var(--radius)',
    background: '#e8e8e8',
    animation: 'pulse 1.2s ease-in-out infinite',
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
