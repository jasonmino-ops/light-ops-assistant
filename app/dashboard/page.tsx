'use client'

import { useState, FormEvent } from 'react'
import { apiFetch, OWNER_CTX } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

type Dimension = 'GLOBAL' | 'STORE' | 'STAFF'

type SummaryResult = {
  dateFrom: string
  dateTo: string
  dimension: Dimension
  storeName: string | null
  operatorDisplayName: string | null
  totalSaleAmount: number
  totalRefundAmount: number
  netAmount: number
  saleCount: number
  refundCount: number
  avgSaleAmount: number
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function fmtAmount(n: number) {
  const abs = Math.abs(n).toFixed(2)
  return n < 0 ? `-$${abs}` : `$${abs}`
}

// Seed data — replace with API-driven options when auth is implemented
const STORES = [
  { id: 'seed-store-a', name: '总店' },
  { id: 'seed-store-b', name: '分店' },
]

const STAFFS = [
  { id: 'seed-user-staff-a', name: '小张（总店）' },
  { id: 'seed-user-staff-b', name: '小李（分店）' },
]

const DIM_LABEL: Record<Dimension, string> = {
  GLOBAL: '全局汇总',
  STORE: '单门店',
  STAFF: '单销售员',
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const today = todayStr()

  const [dateFrom, setDateFrom] = useState(today)
  const [dateTo, setDateTo] = useState(today)
  const [dimension, setDimension] = useState<Dimension>('GLOBAL')
  const [storeId, setStoreId] = useState(STORES[0].id)
  const [operatorUserId, setOperatorUserId] = useState(STAFFS[0].id)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SummaryResult | null>(null)

  // ── Dimension switch — clear result to avoid stale display ─────────────────

  function handleDimension(d: Dimension) {
    setDimension(d)
    setResult(null)
    setError(null)
  }

  // ── Query ──────────────────────────────────────────────────────────────────

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setResult(null)

    if (dimension === 'STAFF' && !operatorUserId) {
      setError('请选择销售员')
      return
    }

    setLoading(true)
    try {
      const params = new URLSearchParams({ dateFrom, dateTo })
      if (dimension === 'STORE') params.set('storeId', storeId.trim())
      if (dimension === 'STAFF') {
        if (storeId.trim()) params.set('storeId', storeId.trim())
        params.set('operatorUserId', operatorUserId.trim())
      }

      const res = await apiFetch(`/api/summary?${params}`, undefined, OWNER_CTX)
      const body = await res.json()

      if (res.ok) {
        setResult(body)
      } else {
        setError(body.message ?? body.error ?? '查询失败')
      }
    } catch {
      setError('网络错误，请重试')
    } finally {
      setLoading(false)
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <main style={s.page}>
      <h1 style={s.title}>老板概览</h1>

      <form onSubmit={handleSubmit} style={s.card}>

        {/* ── Date range ── */}
        <div style={s.group}>
          <label style={s.label}>日期范围</label>
          <div style={s.row}>
            <input
              type="date"
              style={{ ...s.input, flex: 1 }}
              value={dateFrom}
              max={dateTo}
              onChange={(e) => setDateFrom(e.target.value)}
            />
            <span style={s.dateSep}>—</span>
            <input
              type="date"
              style={{ ...s.input, flex: 1 }}
              value={dateTo}
              min={dateFrom}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
        </div>

        {/* ── Dimension ── */}
        <div style={s.group}>
          <label style={s.label}>查询维度</label>
          <div style={s.dimRow}>
            {(['GLOBAL', 'STORE', 'STAFF'] as Dimension[]).map((d) => (
              <button
                key={d}
                type="button"
                style={{ ...s.dimBtn, ...(dimension === d ? s.dimBtnActive : {}) }}
                onClick={() => handleDimension(d)}
              >
                {DIM_LABEL[d]}
              </button>
            ))}
          </div>
        </div>

        {/* ── Store select (STORE / STAFF) ── */}
        {(dimension === 'STORE' || dimension === 'STAFF') && (
          <div style={s.group}>
            <label style={s.label}>
              门店{dimension === 'STAFF' ? '（可选）' : ''}
            </label>
            <select
              style={s.select}
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
            >
              {dimension === 'STAFF' && <option value="">— 不限门店 —</option>}
              {STORES.map((store) => (
                <option key={store.id} value={store.id}>{store.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* ── Staff select (STAFF only) ── */}
        {dimension === 'STAFF' && (
          <div style={s.group}>
            <label style={s.label}>销售员</label>
            <select
              style={s.select}
              value={operatorUserId}
              onChange={(e) => setOperatorUserId(e.target.value)}
            >
              {STAFFS.map((staff) => (
                <option key={staff.id} value={staff.id}>{staff.name}</option>
              ))}
            </select>
          </div>
        )}

        {error && <p style={s.error}>{error}</p>}

        <button type="submit" style={s.btnPrimary} disabled={loading}>
          {loading ? '查询中…' : '查询'}
        </button>
      </form>

      {/* ── Result ── */}
      {result && <SummaryCard result={result} />}
    </main>
  )
}

// ─── SummaryCard ──────────────────────────────────────────────────────────────

function SummaryCard({ result }: { result: SummaryResult }) {
  const dimLabel = DIM_LABEL[result.dimension]
  const subLabel =
    result.dimension === 'STORE'
      ? result.storeName ?? result.dimension
      : result.dimension === 'STAFF'
      ? result.operatorDisplayName ?? result.dimension
      : '全部门店 / 全部员工'

  return (
    <div style={s.resultWrap}>
      {/* Header */}
      <div style={s.resultHeader}>
        <div style={s.resultDim}>{dimLabel}</div>
        <div style={s.resultSub}>{subLabel}</div>
        <div style={s.resultDate}>
          {result.dateFrom === result.dateTo
            ? result.dateFrom
            : `${result.dateFrom} ~ ${result.dateTo}`}
        </div>
      </div>

      {/* Main metric */}
      <div style={s.netAmountBlock}>
        <div style={s.netAmountLabel}>净收入</div>
        <div
          style={{
            ...s.netAmountValue,
            color: result.netAmount >= 0 ? '#389e0d' : '#cf1322',
          }}
        >
          {fmtAmount(result.netAmount)}
        </div>
      </div>

      {/* Grid metrics */}
      <div style={s.metricsGrid}>
        <MetricCell label="销售总额" value={fmtAmount(result.totalSaleAmount)} />
        <MetricCell
          label="退款总额"
          value={fmtAmount(result.totalRefundAmount)}
          valueStyle={{ color: result.totalRefundAmount < 0 ? '#cf1322' : '#1a1a1a' }}
        />
        <MetricCell label="销售笔数" value={String(result.saleCount)} />
        <MetricCell label="退款笔数" value={String(result.refundCount)} />
        <MetricCell label="客单价" value={fmtAmount(result.avgSaleAmount)} spanFull />
      </div>
    </div>
  )
}

function MetricCell({
  label,
  value,
  valueStyle,
  spanFull,
}: {
  label: string
  value: string
  valueStyle?: React.CSSProperties
  spanFull?: boolean
}) {
  return (
    <div style={{ ...s.metricCell, ...(spanFull ? { gridColumn: 'span 2' } : {}) }}>
      <div style={{ ...s.metricValue, ...valueStyle }}>{value}</div>
      <div style={s.metricLabel}>{label}</div>
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
  card: {
    background: '#fff',
    border: '1px solid #e8e8e8',
    borderRadius: 10,
    padding: '16px',
    marginBottom: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
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
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  dateSep: {
    color: '#aaa',
    flexShrink: 0,
  },
  input: {
    height: 44,
    padding: '0 12px',
    border: '1px solid #d0d0d0',
    borderRadius: 8,
    fontSize: 15,
    background: '#fff',
    outline: 'none',
    width: '100%',
  },
  select: {
    height: 44,
    padding: '0 12px',
    border: '1px solid #d0d0d0',
    borderRadius: 8,
    fontSize: 15,
    background: '#fff',
    outline: 'none',
    width: '100%',
    appearance: 'auto',
  },
  dimRow: {
    display: 'flex',
    gap: 8,
  },
  dimBtn: {
    flex: 1,
    height: 36,
    border: '1px solid #d0d0d0',
    borderRadius: 6,
    background: '#fff',
    fontSize: 13,
    cursor: 'pointer',
    color: '#555',
  },
  dimBtnActive: {
    background: '#1677ff',
    borderColor: '#1677ff',
    color: '#fff',
    fontWeight: 600,
  },
  btnPrimary: {
    height: 48,
    background: '#1677ff',
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
  // Result
  resultWrap: {
    background: '#fff',
    border: '1px solid #e8e8e8',
    borderRadius: 10,
    overflow: 'hidden',
  },
  resultHeader: {
    background: '#f0f5ff',
    padding: '12px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  resultDim: {
    fontSize: 12,
    color: '#1677ff',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  resultSub: {
    fontSize: 16,
    fontWeight: 600,
    color: '#1a1a1a',
  },
  resultDate: {
    fontSize: 12,
    color: '#888',
  },
  netAmountBlock: {
    padding: '20px 16px 16px',
    borderBottom: '1px solid #f0f0f0',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
  },
  netAmountLabel: {
    fontSize: 13,
    color: '#888',
  },
  netAmountValue: {
    fontSize: 36,
    fontWeight: 700,
    letterSpacing: '-0.02em',
  },
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 1,
    background: '#f0f0f0',
  },
  metricCell: {
    background: '#fff',
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  metricValue: {
    fontSize: 18,
    fontWeight: 600,
    color: '#1a1a1a',
  },
  metricLabel: {
    fontSize: 12,
    color: '#888',
  },
}
