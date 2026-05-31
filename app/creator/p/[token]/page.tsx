'use client'

import { useEffect, useState, CSSProperties } from 'react'
import { useParams } from 'next/navigation'

// ── Types ────────────────────────────────────────────────────────────────────

type LinkStat = {
  code: string
  videoTitle: string | null
  viewCount: number; clickCount: number; orderCount: number; salesAmount: number
  commissionType: string | null; commissionValue: number | null
  estimatedCommission: number
  settlementStatus: string
  settledAt: string | null
  createdAt: string
}

type DashboardData = {
  creator: { name: string; displayName: string | null; tiktokHandle: string | null }
  summary: {
    totalViews: number; totalClicks: number; totalOrders: number
    totalSalesAmount: number; totalEstimatedCommission: number
    totalSettledCommission: number; totalUnsettledCommission: number
  }
  links: LinkStat[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function commLabel(type: string | null, value: number | null): string {
  if (!type || value == null) return '无佣金'
  if (type === 'percent') return `${value}%`
  return `$${value.toFixed(2)}/单`
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function CreatorDashboard() {
  const { token } = useParams<{ token: string }>()
  const [data,     setData]     = useState<DashboardData | null>(null)
  const [invalid,  setInvalid]  = useState(false)
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    fetch(`/api/creator-public/${token}`)
      .then((r) => {
        if (r.status === 404) { setInvalid(true); setLoading(false); return null }
        return r.json()
      })
      .then((d) => { if (d) { setData(d); setLoading(false) } })
      .catch(() => { setInvalid(true); setLoading(false) })
  }, [token])

  const s: Record<string, CSSProperties> = {
    wrap:     { minHeight: '100dvh', background: '#f9fafb', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",sans-serif' },
    inner:    { maxWidth: 480, margin: '0 auto', padding: '24px 16px 64px' },
    header:   { marginBottom: 20 },
    name:     { fontSize: 22, fontWeight: 800, color: '#111827', margin: '0 0 4px' },
    handle:   { fontSize: 14, color: '#6b7280' },
    grid:     { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 },
    gridFull: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 20 },
    statCard: { background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: '14px 16px' },
    statVal:  { fontSize: 22, fontWeight: 800, color: '#111827', margin: '0 0 2px' },
    statLbl:  { fontSize: 11, color: '#9ca3af', fontWeight: 500 },
    card:     { background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: '14px 16px', marginBottom: 10 },
    sectionH: { fontSize: 14, fontWeight: 700, color: '#111827', margin: '0 0 14px' },
    code:     { fontSize: 15, fontWeight: 700, color: '#07c160', letterSpacing: '0.04em' },
    row:      { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
    stat:     { fontSize: 11, color: '#9ca3af', marginTop: 3 },
    commCard: { background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: '14px 16px', marginBottom: 16 },
    commRow:  { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 },
    poweredBy:{ textAlign: 'center' as const, fontSize: 11, color: '#d1d5db', marginTop: 32 },
  }

  function badge(settled: boolean): CSSProperties {
    return {
      display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
      background: settled ? '#f0fdf4' : '#fef9c3',
      color:      settled ? '#15803d' : '#854d0e',
    }
  }

  if (loading) {
    return (
      <div style={s.wrap}>
        <div style={{ ...s.inner, paddingTop: 80, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>加载中…</div>
      </div>
    )
  }

  if (invalid || !data) {
    return (
      <div style={s.wrap}>
        <div style={{ ...s.inner, paddingTop: 80, textAlign: 'center' as const }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔗</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#374151', marginBottom: 8 }}>看板链接不存在或已失效</div>
          <div style={{ fontSize: 13, color: '#9ca3af' }}>请联系商家获取最新看板链接</div>
        </div>
      </div>
    )
  }

  const { creator, summary, links } = data

  return (
    <div style={s.wrap}>
      <div style={s.inner}>

        {/* 头部 */}
        <div style={s.header}>
          <h1 style={s.name}>{creator.displayName ?? creator.name}</h1>
          {creator.tiktokHandle && (
            <div style={s.handle}>🎵 @{creator.tiktokHandle}</div>
          )}
        </div>

        {/* 流量概览 */}
        <div style={s.grid}>
          <div style={s.statCard}>
            <div style={s.statVal}>{summary.totalViews}</div>
            <div style={s.statLbl}>👁 总浏览</div>
          </div>
          <div style={s.statCard}>
            <div style={s.statVal}>{summary.totalClicks}</div>
            <div style={s.statLbl}>🛒 总点击</div>
          </div>
          <div style={s.statCard}>
            <div style={s.statVal}>{summary.totalOrders}</div>
            <div style={s.statLbl}>📦 总订单</div>
          </div>
          <div style={s.statCard}>
            <div style={{ ...s.statVal, fontSize: 18 }}>${summary.totalSalesAmount.toFixed(2)}</div>
            <div style={s.statLbl}>💰 总成交</div>
          </div>
        </div>

        {/* 佣金概览 */}
        {summary.totalEstimatedCommission > 0 && (
          <div style={s.commCard}>
            <div style={s.commRow}>
              <span style={{ fontSize: 13, color: '#15803d', fontWeight: 600 }}>💵 预计佣金</span>
              <span style={{ fontSize: 20, fontWeight: 800, color: '#15803d' }}>
                ${summary.totalEstimatedCommission.toFixed(2)}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 20 }}>
              <div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>已结算</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#374151' }}>
                  ${summary.totalSettledCommission.toFixed(2)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>待结算</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: summary.totalUnsettledCommission > 0 ? '#b45309' : '#9ca3af' }}>
                  ${summary.totalUnsettledCommission.toFixed(2)}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 推广链接明细 */}
        {links.length > 0 && (
          <div>
            <div style={s.sectionH}>推广链接明细</div>
            {links.map((lk) => {
              const isSettled = lk.settlementStatus === 'settled'
              return (
                <div key={lk.code} style={s.card}>
                  <div style={s.row}>
                    <span style={s.code}>/v/{lk.code}</span>
                    <span style={badge(isSettled)}>{isSettled ? '已结算' : '未结算'}</span>
                  </div>
                  {lk.videoTitle && (
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>🎬 {lk.videoTitle}</div>
                  )}
                  <div style={s.stat}>
                    👁 {lk.viewCount} 浏览　🛒 {lk.clickCount} 点击　📦 {lk.orderCount} 单
                  </div>
                  <div style={{ ...s.stat, marginTop: 2 }}>
                    💰 成交 ${lk.salesAmount.toFixed(2)}
                    {lk.estimatedCommission > 0 && (
                      <span style={{ marginLeft: 8 }}>
                        佣金规则 {commLabel(lk.commissionType, lk.commissionValue)}　预计 ${lk.estimatedCommission.toFixed(2)}
                      </span>
                    )}
                  </div>
                  {isSettled && lk.settledAt && (
                    <div style={{ ...s.stat, marginTop: 3, color: '#15803d' }}>
                      ✓ 已结算于 {new Date(lk.settledAt).toLocaleDateString('zh-CN')}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {links.length === 0 && (
          <div style={{ textAlign: 'center' as const, fontSize: 13, color: '#9ca3af', padding: '24px 0' }}>
            暂无推广链接数据
          </div>
        )}

        <div style={s.poweredBy}>由店小二 · E-Life 驱动</div>
      </div>
    </div>
  )
}
