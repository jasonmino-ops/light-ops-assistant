'use client'

import type { CSSProperties } from 'react'
import { useEffect, useState } from 'react'
import type { RuntimeResponse } from '../_components/types'
import {
  ErrorState,
  LoadingState,
  PageHeading,
  SearchBar,
  StatusBadge,
  fmtDateTime,
  sharedStyles,
} from '../_components/ui'

export default function DesktopRuntimePage() {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [data, setData] = useState<RuntimeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function loadRuntime(search = query) {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ view: 'runtime' })
      if (search.trim()) params.set('query', search.trim())
      const response = await fetch(`/api/ops/desktop-management?${params}`, { cache: 'no-store' })
      if (!response.ok) throw new Error('Runtime 状态加载失败')
      setData(await response.json() as RuntimeResponse)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Runtime 状态加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadRuntime('') }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function submitSearch() {
    const nextQuery = input.trim()
    setQuery(nextQuery)
    loadRuntime(nextQuery)
  }

  return (
    <main style={sharedStyles.content}>
      <PageHeading title="Desktop Runtime" />
      <SearchBar value={input} onChange={setInput} onSubmit={submitSearch} placeholder="搜索 Store Code、Store Name 或 Tenant" />

      {error && <ErrorState message={error} />}
      {loading && <LoadingState />}

      {!loading && data && (
        <>
          <section style={s.releaseBand}>
            <div>
              <div style={s.kicker}>Runtime Version</div>
              <div style={s.releaseValue}>{data.runtimeVersion}</div>
            </div>
            <div>
              <div style={s.kicker}>Current Desktop Version</div>
              <div style={s.releaseValue}>{data.currentDesktopVersion}</div>
            </div>
            <div>
              <div style={s.kicker}>Last Verification</div>
              <div style={s.releaseValue}>{fmtDateTime(data.lastVerification)}</div>
            </div>
          </section>

          <section className="desktop-runtime-grid" style={s.statusGrid} aria-label="Runtime device status">
            <RuntimeMetric label="All Devices" value={data.deviceCount} />
            <RuntimeMetric label="Active" value={data.statusCounts.ACTIVE} status="ACTIVE" />
            <RuntimeMetric label="Offline" value={data.statusCounts.OFFLINE} status="OFFLINE" />
            <RuntimeMetric label="Blocked" value={data.statusCounts.BLOCKED} status="BLOCKED" />
            <RuntimeMetric label="Revoked" value={data.statusCounts.REVOKED} status="REVOKED" />
          </section>

          <section style={s.telemetryRows}>
            <TelemetryRow label="Per-device Desktop Version" value={data.desktopTelemetry === 'NOT_REPORTED' ? '未上报' : data.desktopTelemetry} />
            <TelemetryRow label="Per-device Windows Version" value={data.windowsTelemetry === 'NOT_REPORTED' ? '未上报' : data.windowsTelemetry} />
          </section>
        </>
      )}
    </main>
  )
}

function RuntimeMetric({ label, value, status }: { label: string; value: number; status?: string }) {
  return (
    <div style={s.metric}>
      <div style={s.metricTop}>{status ? <StatusBadge value={status} /> : <span style={s.allLabel}>{label}</span>}</div>
      <div style={s.metricValue}>{value}</div>
      {status && <div style={s.metricLabel}>{label}</div>}
    </div>
  )
}

function TelemetryRow({ label, value }: { label: string; value: string }) {
  return <div style={s.telemetryRow}><span>{label}</span><strong>{value}</strong></div>
}

const s: Record<string, CSSProperties> = {
  releaseBand: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 1, border: '1px solid #dfe3e8', background: '#dfe3e8' },
  kicker: { padding: '12px 13px 0', background: '#fff', color: '#64748b', fontSize: 10, fontWeight: 900 },
  releaseValue: { minHeight: 46, padding: '5px 13px 12px', boxSizing: 'border-box', background: '#fff', color: '#111827', fontSize: 14, fontWeight: 900, overflowWrap: 'anywhere' },
  statusGrid: { display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 1, marginTop: 18, border: '1px solid #dfe3e8', background: '#dfe3e8' },
  metric: { minHeight: 106, padding: 13, boxSizing: 'border-box', background: '#fff' },
  metricTop: { minHeight: 24 },
  allLabel: { color: '#475569', fontSize: 11, fontWeight: 900 },
  metricValue: { marginTop: 8, color: '#111827', fontSize: 28, lineHeight: 1, fontWeight: 900 },
  metricLabel: { marginTop: 7, color: '#64748b', fontSize: 11, fontWeight: 700 },
  telemetryRows: { marginTop: 18, borderTop: '1px solid #dfe3e8' },
  telemetryRow: { display: 'flex', justifyContent: 'space-between', gap: 16, padding: '12px 2px', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: 12 },
}
