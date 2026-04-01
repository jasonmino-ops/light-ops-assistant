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
  GLOBAL: '全局',
  STORE: '门店',
  STAFF: '员工',
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

  // ── Dimension switch ────────────────────────────────────────────────────────

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
    <div style={s.page}>
      {/* ── Brand header ── */}
      <div style={s.headerBar}>
        <div style={s.headerLeft}>
          <div style={s.brandName}>轻店助手</div>
          <div style={s.brandSub}>老板概览</div>
        </div>
        <button style={s.langBtn}>中 / EN</button>
      </div>

      <div style={s.body}>
        <form onSubmit={handleSubmit}>
          {/* Date card */}
          <div style={s.card}>
            <div style={s.cardLabel}>日期范围</div>
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
          </div>

          {/* Dimension card */}
          <div style={s.card}>
            <div style={s.cardLabel}>查询维度</div>
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

          {/* Filter card (store / staff) */}
          {(dimension === 'STORE' || dimension === 'STAFF') && (
            <div style={s.card}>
              <div style={s.group}>
                <div style={s.cardLabel}>
                  门店{dimension === 'STAFF' ? '（可选）' : ''}
                </div>
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

              {dimension === 'STAFF' && (
                <div style={{ ...s.group, marginTop: 10 }}>
                  <div style={s.cardLabel}>销售员</div>
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
            </div>
          )}

          {error && <div style={s.errorMsg}>{error}</div>}

          <button type="submit" style={s.submitBtn} disabled={loading}>
            {loading ? '查询中…' : '查询'}
          </button>
        </form>

        {/* ── Result ── */}
        {result && <SummaryCard result={result} />}
      </div>
    </div>
  )
}

// ─── SummaryCard ──────────────────────────────────────────────────────────────

function SummaryCard({ result }: { result: SummaryResult }) {
  const subLabel =
    result.dimension === 'STORE'
      ? result.storeName ?? '全部门店'
      : result.dimension === 'STAFF'
      ? result.operatorDisplayName ?? '全部员工'
      : '全部门店 · 全部员工'

  const dateLabel =
    result.dateFrom === result.dateTo
      ? result.dateFrom
      : `${result.dateFrom} ~ ${result.dateTo}`

  return (
    <div style={sc.wrap}>
      {/* Hero net amount */}
      <div style={sc.hero}>
        <div style={sc.heroMeta}>
          <span style={sc.heroDim}>{DIM_LABEL[result.dimension]}</span>
          <span style={sc.heroSub}>{subLabel}</span>
          <span style={sc.heroDate}>{dateLabel}</span>
        </div>
        <div style={sc.heroLabel}>净收入</div>
        <div style={{
          ...sc.heroAmount,
          color: result.netAmount >= 0 ? '#a0f0a0' : '#ffccc7',
        }}>
          {fmtAmount(result.netAmount)}
        </div>
      </div>

      {/* Metrics grid */}
      <div style={sc.grid}>
        <MetricCell label="销售总额" value={fmtAmount(result.totalSaleAmount)} />
        <MetricCell
          label="退款总额"
          value={fmtAmount(result.totalRefundAmount)}
          red={result.totalRefundAmount < 0}
        />
        <MetricCell label="销售笔数" value={String(result.saleCount)} unit="笔" />
        <MetricCell label="退款笔数" value={String(result.refundCount)} unit="笔" />
        <MetricCell label="客单价" value={fmtAmount(result.avgSaleAmount)} spanFull />
      </div>
    </div>
  )
}

function MetricCell({
  label,
  value,
  unit,
  red,
  spanFull,
}: {
  label: string
  value: string
  unit?: string
  red?: boolean
  spanFull?: boolean
}) {
  return (
    <div style={{ ...mc.cell, ...(spanFull ? { gridColumn: 'span 2' } : {}) }}>
      <div style={{ ...mc.value, ...(red ? { color: 'var(--red)' } : {}) }}>
        {value}
        {unit && <span style={mc.unit}>{unit}</span>}
      </div>
      <div style={mc.label}>{label}</div>
    </div>
  )
}

const sc: Record<string, React.CSSProperties> = {
  wrap: {
    borderRadius: 'var(--radius)',
    overflow: 'hidden',
    marginBottom: 12,
    background: 'var(--card)',
  },
  hero: {
    background: 'var(--blue)',
    padding: '18px 18px 20px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
  },
  heroMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  heroDim: {
    fontSize: 11,
    fontWeight: 700,
    background: 'rgba(255,255,255,0.2)',
    color: '#fff',
    padding: '1px 8px',
    borderRadius: 10,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  heroSub: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.9)',
    fontWeight: 600,
  },
  heroDate: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.65)',
  },
  heroLabel: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
  },
  heroAmount: {
    fontSize: 40,
    fontWeight: 800,
    letterSpacing: '-0.03em',
    lineHeight: 1.1,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
  },
}

const mc: Record<string, React.CSSProperties> = {
  cell: {
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    borderTop: '1px solid var(--border)',
  },
  value: {
    fontSize: 18,
    fontWeight: 700,
    color: 'var(--text)',
  },
  unit: {
    fontSize: 12,
    fontWeight: 400,
    color: 'var(--muted)',
    marginLeft: 2,
  },
  label: {
    fontSize: 12,
    color: 'var(--muted)',
  },
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'var(--bg)',
    display: 'flex',
    flexDirection: 'column',
  },
  // Brand header
  headerBar: {
    background: 'var(--blue)',
    padding: '16px 16px 20px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  brandName: {
    fontSize: 18,
    fontWeight: 700,
    color: '#fff',
    letterSpacing: '0.02em',
  },
  brandSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
  },
  langBtn: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.8)',
    background: 'rgba(255,255,255,0.15)',
    border: '1px solid rgba(255,255,255,0.3)',
    borderRadius: 12,
    padding: '3px 10px',
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
    marginBottom: 10,
  },
  group: {
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
  },
  dateRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  dateInput: {
    flex: 1,
    height: 40,
    padding: '0 10px',
    border: '1.5px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 14,
    background: '#f7f8fa',
    outline: 'none',
  },
  dateSep: {
    color: 'var(--muted)',
    flexShrink: 0,
  },
  dimRow: {
    display: 'flex',
    gap: 8,
  },
  dimBtn: {
    flex: 1,
    height: 38,
    border: '1.5px solid var(--border)',
    borderRadius: 20,
    background: '#f7f8fa',
    fontSize: 14,
    color: 'var(--muted)',
    fontWeight: 500,
  },
  dimBtnActive: {
    background: 'var(--blue)',
    borderColor: 'var(--blue)',
    color: '#fff',
    fontWeight: 700,
  },
  select: {
    height: 42,
    padding: '0 12px',
    border: '1.5px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 15,
    background: '#f7f8fa',
    outline: 'none',
    width: '100%',
    appearance: 'auto',
  },
  submitBtn: {
    width: '100%',
    height: 48,
    background: 'var(--blue)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    fontSize: 16,
    fontWeight: 700,
    marginBottom: 12,
  },
  errorMsg: {
    fontSize: 13,
    color: 'var(--red)',
    padding: '4px 0 6px 2px',
  },
}

