'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { apiFetch, OWNER_CTX } from '@/lib/api'

type Status = 'PASS' | 'WARN' | 'FAIL' | 'INFO'

type Check = {
  key: string
  name: string
  status: Status
  detail: string
}

type HealthResult = {
  status: Status
  checks: Check[]
}

const STATUS_COLOR: Record<Status, string> = {
  PASS: '#52c41a',
  WARN: '#fa8c16',
  FAIL: '#ff4d4f',
  INFO: '#1677ff',
}

const STATUS_BG: Record<Status, string> = {
  PASS: '#f6ffed',
  WARN: '#fff7e6',
  FAIL: '#fff1f0',
  INFO: '#e6f4ff',
}

const STATUS_ICON: Record<Status, string> = {
  PASS: '✓',
  WARN: '⚠',
  FAIL: '✕',
  INFO: 'i',
}

const OVERALL_LABEL: Record<Status, string> = {
  PASS: '系统正常',
  WARN: '存在警告',
  FAIL: '存在故障',
  INFO: '配置提示',
}

export default function SystemPage() {
  const [health, setHealth] = useState<HealthResult | null>(null)
  const [loading, setLoading] = useState(true)

  function load() {
    setLoading(true)
    apiFetch('/api/health', undefined, OWNER_CTX)
      .then((r) => r.json())
      .then((data: HealthResult) => setHealth(data))
      .catch(() => {
        setHealth({
          status: 'FAIL',
          checks: [{ key: 'fetch', name: '自检请求', status: 'FAIL', detail: '无法连接到健康检查 API' }],
        })
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const overall = health?.status ?? 'WARN'
  const runtimeChecks = health?.checks.filter((check) => check.status !== 'INFO') ?? []
  const configNotices = health?.checks.filter((check) => check.status === 'INFO') ?? []

  return (
    <div style={s.page}>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }`}</style>
      {/* Header */}
      <div style={{ ...s.header, background: STATUS_COLOR[overall] }}>
        <div>
          <Link href="/ops" style={s.backLink}>← 返回运营后台</Link>
          <div style={s.headerTitle}>系统自检</div>
          <div style={s.headerSub}>
            {loading ? '检测中…' : OVERALL_LABEL[overall]}
          </div>
        </div>
        <button style={s.refreshBtn} onClick={load} disabled={loading}>
          {loading ? '…' : '刷新'}
        </button>
      </div>

      <div style={s.body}>
        {/* Overall badge */}
        {!loading && health && (
          <div style={{ ...s.overallCard, background: STATUS_BG[overall], borderColor: STATUS_COLOR[overall] + '66' }}>
            <span style={{ ...s.overallIcon, color: STATUS_COLOR[overall] }}>
              {STATUS_ICON[overall]}
            </span>
            <span style={{ ...s.overallLabel, color: STATUS_COLOR[overall] }}>
              {OVERALL_LABEL[overall]}
            </span>
            <span style={s.overallCount}>
              {runtimeChecks.filter((c) => c.status === 'PASS').length} PASS ·{' '}
              {runtimeChecks.filter((c) => c.status === 'WARN').length} WARN ·{' '}
              {runtimeChecks.filter((c) => c.status === 'FAIL').length} FAIL ·{' '}
              {configNotices.length} 配置提示
            </span>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && [1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <div key={i} style={s.skeletonCard} />
        ))}

        {/* Runtime checks */}
        {!loading && health && (
          <>
            <div style={s.sectionTitle}>系统运行检查</div>
            {runtimeChecks.map((check) => (
              <CheckCard key={check.key} check={check} />
            ))}

            <div style={s.sectionTitle}>配置提示</div>
            {configNotices.map((check) => (
              <CheckCard key={check.key} check={check} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function CheckCard({ check }: { check: Check }) {
  return (
    <div style={s.checkCard}>
      <div
        style={{
          ...s.statusDot,
          background: STATUS_COLOR[check.status],
        }}
      >
        <span style={s.statusIcon}>{STATUS_ICON[check.status]}</span>
      </div>
      <div style={s.checkBody}>
        <div style={s.checkName}>{check.name}</div>
        <div style={s.checkDetail}>{check.detail}</div>
      </div>
      <div style={{ ...s.badge, color: STATUS_COLOR[check.status], background: STATUS_BG[check.status] }}>
        {check.status}
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f5f7fa', display: 'flex', flexDirection: 'column' },

  header: { padding: '18px 16px 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  backLink: {
    display: 'inline-flex', alignItems: 'center', minHeight: 34, marginBottom: 8,
    color: 'rgba(255,255,255,0.95)', fontSize: 14, fontWeight: 700,
    textDecoration: 'none',
  },
  headerTitle: { fontSize: 18, fontWeight: 700, color: '#fff' },
  headerSub: { fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 4 },
  refreshBtn: {
    fontSize: 13, color: 'rgba(255,255,255,0.9)',
    background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.35)',
    borderRadius: 14, padding: '4px 14px', cursor: 'pointer',
  },

  body: { flex: 1, padding: '14px 12px 80px', maxWidth: 480, margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', gap: 8 },

  overallCard: {
    border: '1.5px solid', borderRadius: 12, padding: '12px 16px',
    display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4,
  },
  overallIcon: { fontSize: 22, fontWeight: 700, flexShrink: 0 },
  overallLabel: { fontSize: 15, fontWeight: 700, flex: 1 },
  overallCount: { fontSize: 12, color: '#aaa' },

  skeletonCard: {
    height: 66, borderRadius: 12, background: '#e8e8e8',
    animation: 'pulse 1.2s ease-in-out infinite',
  },

  checkCard: {
    background: '#fff', borderRadius: 12, padding: '12px 14px',
    display: 'flex', alignItems: 'center', gap: 12,
    boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
  },
  sectionTitle: { fontSize: 13, fontWeight: 700, color: '#555', margin: '10px 4px 2px' },
  statusDot: {
    width: 32, height: 32, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  statusIcon: { fontSize: 15, color: '#fff', fontWeight: 700 },
  checkBody: { flex: 1, minWidth: 0 },
  checkName: { fontSize: 14, fontWeight: 600, color: '#1a1a1a' },
  checkDetail: { fontSize: 12, color: '#8c8c8c', marginTop: 2, wordBreak: 'break-all' },
  badge: { fontSize: 11, fontWeight: 700, borderRadius: 6, padding: '2px 7px', flexShrink: 0 },
}
