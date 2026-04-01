'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { apiFetch, STAFF_CTX } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

type Summary = {
  saleCount: number
  refundCount: number
  netAmount: number
}

type RecordItem = {
  id: string
  recordNo: string
  orderNo: string | null
  productNameSnapshot: string
  specSnapshot: string | null
  quantity: number
  lineAmount: number
  saleType: 'SALE' | 'REFUND'
  refundReason: string | null
  createdAt: string
}

type OrderGroup = {
  kind: 'order'
  orderNo: string
  createdAt: string
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
        groupMap.set(key, { kind: 'order', orderNo: key, createdAt: item.createdAt, items: [], totalAmount: 0 })
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
  return all.slice(0, 5)
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [entries, setEntries] = useState<DisplayEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const today = todayStr()
    const params = new URLSearchParams({ dateFrom: today, dateTo: today, pageSize: '30' })

    apiFetch(`/api/records?${params}`, undefined, STAFF_CTX)
      .then((res) => res.json())
      .then((data) => {
        setSummary(data.summary)
        setEntries(buildEntries(data.items ?? []))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <main style={s.page}>
      {/* ── Brand header ── */}
      <div style={s.brandBar}>
        <div style={s.brandLeft}>
          <span style={s.brandIcon}>🏪</span>
          <div>
            <div style={s.brandName}>店小二</div>
            <div style={s.brandSub}>轻店助手</div>
          </div>
        </div>
        <div style={s.brandRight}>
          <div style={s.identity}>BKK1 · Amy</div>
          <button style={s.langBtn}>中文 / 柬语</button>
        </div>
      </div>

      {/* ── Today summary ── */}
      <div style={s.summaryCard}>
        <div style={s.summaryTitle}>今日汇总</div>
        {loading ? (
          <div style={s.summaryLoading}>加载中…</div>
        ) : (
          <>
            <div style={s.netRow}>
              <span style={s.netLabel}>净收入</span>
              <span style={{
                ...s.netAmount,
                color: (summary?.netAmount ?? 0) >= 0 ? '#52c41a' : '#ff4d4f',
              }}>
                ${(summary?.netAmount ?? 0).toFixed(2)}
              </span>
            </div>
            <div style={s.summaryGrid}>
              <SummaryCell label="销售" value={String(summary?.saleCount ?? 0)} unit="笔" />
              <div style={s.summaryDivider} />
              <SummaryCell label="退款" value={String(summary?.refundCount ?? 0)} unit="笔" />
            </div>
          </>
        )}
      </div>

      {/* ── Quick actions ── */}
      <div style={s.sectionTitle}>快捷操作</div>
      <div style={s.actionGrid}>
        <ActionBtn href="/sale" icon="💰" label="销售" color="#1677ff" />
        <ActionBtn href="/refund" icon="↩️" label="退款" color="#ff4d4f" />
        <ActionBtn href="/records" icon="📋" label="记录" color="#fa8c16" />
      </div>

      {/* ── Recent records ── */}
      <div style={s.sectionHeader}>
        <span style={s.sectionTitle}>最近记录</span>
        <Link href="/records" style={s.viewAll}>查看全部 →</Link>
      </div>

      {!loading && entries.length === 0 && (
        <div style={s.emptyHint}>今日暂无记录</div>
      )}

      {entries.map((entry, i) =>
        entry.kind === 'order' ? (
          <OrderCard key={entry.orderNo} group={entry} index={i} />
        ) : (
          <RefundCard key={entry.item.id + '-' + i} item={entry.item} />
        )
      )}
    </main>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryCell({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div style={s.summaryCell}>
      <div style={s.summaryCellValue}>{value}<span style={s.summaryUnit}>{unit}</span></div>
      <div style={s.summaryCellLabel}>{label}</div>
    </div>
  )
}

function ActionBtn({ href, icon, label, color }: {
  href: string; icon: string; label: string; color: string
}) {
  return (
    <Link href={href} style={{ ...s.actionBtn, borderColor: color + '33' }}>
      <span style={{ ...s.actionIcon, background: color + '15' }}>{icon}</span>
      <span style={{ ...s.actionLabel, color }}>{label}</span>
    </Link>
  )
}

function OrderCard({ group, index }: { group: OrderGroup; index: number }) {
  const accent = ORDER_COLORS[index % ORDER_COLORS.length]
  const isSingle = group.items.length === 1
  return (
    <div style={{ ...s.recentCard, borderLeft: `3px solid ${accent}` }}>
      <div style={s.recentLeft}>
        <span style={s.tagSale}>销售单</span>
        <div style={s.recentProduct}>
          {isSingle
            ? group.items[0].productNameSnapshot +
              (group.items[0].specSnapshot ? ` · ${group.items[0].specSnapshot}` : '')
            : buildItemSummary(group.items)}
        </div>
        <div style={s.recentMeta}>
          {group.orderNo} · {fmtTime(group.createdAt)}
          {!isSingle && (
            <span style={s.itemCount}> · {group.items.length}件</span>
          )}
        </div>
      </div>
      <div style={{ ...s.recentAmount, color: '#1a1a1a' }}>
        +${group.totalAmount.toFixed(2)}
      </div>
    </div>
  )
}

function RefundCard({ item }: { item: RecordItem }) {
  return (
    <div style={{ ...s.recentCard, ...s.recentCardRefund }}>
      <div style={s.recentLeft}>
        <span style={s.tagRefund}>退款</span>
        <div style={s.recentProduct}>
          {item.productNameSnapshot}
          {item.specSnapshot && <span style={s.recentSpec}> · {item.specSnapshot}</span>}
        </div>
        <div style={s.recentMeta}>{fmtTime(item.createdAt)}</div>
      </div>
      <div style={{ ...s.recentAmount, color: '#ff4d4f' }}>
        -${Math.abs(item.lineAmount).toFixed(2)}
      </div>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: 480,
    margin: '0 auto',
    padding: '0 0 16px',
  },
  brandBar: {
    background: '#1677ff',
    padding: '16px 16px 20px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  brandLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  brandIcon: {
    fontSize: 32,
    lineHeight: 1,
  },
  brandName: {
    fontSize: 20,
    fontWeight: 700,
    color: '#fff',
    lineHeight: 1.2,
  },
  brandSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 2,
  },
  brandRight: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 6,
  },
  identity: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.9)',
    fontWeight: 500,
  },
  langBtn: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.8)',
    background: 'rgba(255,255,255,0.15)',
    border: '1px solid rgba(255,255,255,0.3)',
    borderRadius: 12,
    padding: '2px 8px',
    cursor: 'pointer',
  },
  summaryCard: {
    background: '#fff',
    margin: '0 12px',
    marginTop: -10,
    borderRadius: 14,
    padding: '16px',
    boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
    marginBottom: 16,
  },
  summaryTitle: {
    fontSize: 12,
    color: '#8c8c8c',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: 10,
  },
  summaryLoading: {
    textAlign: 'center',
    color: '#bbb',
    padding: '12px 0',
    fontSize: 14,
  },
  netRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 12,
    borderBottom: '1px solid #f0f0f0',
  },
  netLabel: {
    fontSize: 14,
    color: '#8c8c8c',
  },
  netAmount: {
    fontSize: 28,
    fontWeight: 700,
    letterSpacing: '-0.02em',
  },
  summaryGrid: {
    display: 'flex',
    alignItems: 'center',
  },
  summaryCell: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
  },
  summaryCellValue: {
    fontSize: 20,
    fontWeight: 600,
    color: '#1a1a1a',
  },
  summaryUnit: {
    fontSize: 12,
    fontWeight: 400,
    color: '#8c8c8c',
    marginLeft: 2,
  },
  summaryCellLabel: {
    fontSize: 12,
    color: '#8c8c8c',
  },
  summaryDivider: {
    width: 1,
    height: 32,
    background: '#e8e8e8',
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0 16px',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: '#1a1a1a',
    padding: '0 16px',
    marginBottom: 8,
    display: 'block',
  },
  viewAll: {
    fontSize: 13,
    color: '#1677ff',
    textDecoration: 'none',
  },
  actionGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: 10,
    padding: '0 12px',
    marginBottom: 20,
  },
  actionBtn: {
    background: '#fff',
    border: '1.5px solid',
    borderRadius: 12,
    padding: '14px 8px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    textDecoration: 'none',
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 22,
  },
  actionLabel: {
    fontSize: 13,
    fontWeight: 600,
  },
  recentCard: {
    background: '#fff',
    margin: '0 12px 8px',
    borderRadius: 10,
    padding: '12px 14px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  recentCardRefund: {
    background: '#fff1f0',
  },
  recentLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    flex: 1,
    minWidth: 0,
  },
  recentProduct: {
    fontSize: 15,
    fontWeight: 500,
    color: '#1a1a1a',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  recentSpec: {
    fontWeight: 400,
    color: '#8c8c8c',
  },
  recentMeta: {
    fontSize: 12,
    color: '#bbb',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  itemCount: {
    color: '#1677ff',
  },
  recentAmount: {
    fontSize: 17,
    fontWeight: 700,
    flexShrink: 0,
  },
  tagSale: {
    fontSize: 10,
    fontWeight: 600,
    background: '#e6f4ff',
    color: '#1677ff',
    padding: '1px 6px',
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  tagRefund: {
    fontSize: 10,
    fontWeight: 600,
    background: '#fff1f0',
    color: '#ff4d4f',
    border: '1px solid #ffccc7',
    padding: '1px 6px',
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  emptyHint: {
    textAlign: 'center',
    color: '#bbb',
    padding: '24px 0',
    fontSize: 14,
  },
}
