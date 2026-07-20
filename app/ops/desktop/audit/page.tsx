'use client'

import type { CSSProperties } from 'react'
import { useEffect, useState } from 'react'
import type { AuditResponse, DesktopAuditEvent } from '../_components/types'
import {
  ErrorState,
  LoadingState,
  PageHeading,
  Pagination,
  SearchBar,
  StatusBadge,
  fmtDateTime,
  sharedStyles,
} from '../_components/ui'

const CATEGORIES = [
  { value: 'ALL', label: 'All Events' },
  { value: 'PIN', label: 'PIN' },
  { value: 'ACTIVATION', label: 'Activation' },
  { value: 'VERIFICATION', label: 'Verification' },
  { value: 'REVOCATION', label: 'Revocation' },
  { value: 'SUBSCRIPTION', label: 'Subscription' },
]

export default function DesktopAuditPage() {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('ALL')
  const [data, setData] = useState<AuditResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function loadAudit(page: number, search = query, nextCategory = category) {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ view: 'audit', page: String(page), pageSize: '20', category: nextCategory })
      if (search.trim()) params.set('query', search.trim())
      const response = await fetch(`/api/ops/desktop-management?${params}`, { cache: 'no-store' })
      if (!response.ok) throw new Error('审计时间线加载失败')
      setData(await response.json() as AuditResponse)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '审计时间线加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadAudit(1, '', 'ALL') }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function submitSearch() {
    const nextQuery = input.trim()
    setQuery(nextQuery)
    loadAudit(1, nextQuery, category)
  }

  function changeCategory(nextCategory: string) {
    setCategory(nextCategory)
    loadAudit(1, query, nextCategory)
  }

  return (
    <main style={sharedStyles.content}>
      <PageHeading title="Desktop Audit" />
      <SearchBar value={input} onChange={setInput} onSubmit={submitSearch} placeholder="搜索 Store Code、Store Name 或 Tenant">
        <select value={category} onChange={(event) => changeCategory(event.target.value)} style={s.select} aria-label="Audit category">
          {CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </SearchBar>

      {error && <ErrorState message={error} />}
      {loading && <LoadingState />}

      {!loading && data && (
        <>
          <section style={s.timeline} aria-label="Desktop audit timeline">
            {data.events.length === 0 ? (
              <div style={s.empty}>暂无 Desktop 审计记录</div>
            ) : data.events.map((event) => <AuditRow key={event.eventKey} event={event} />)}
          </section>
          <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onChange={(page) => loadAudit(page)} />
        </>
      )}
    </main>
  )
}

function AuditRow({ event }: { event: DesktopAuditEvent }) {
  return (
    <article style={s.eventRow}>
      <div style={s.markerColumn} aria-hidden="true"><span style={s.marker} /></div>
      <div style={s.eventBody}>
        <div style={s.eventHeader}>
          <div>
            <div style={s.eventTitle}>{event.label}</div>
            <div style={s.eventStore}>{event.storeName} · {event.storeCode}</div>
          </div>
          <StatusBadge value={event.result} />
        </div>
        <div style={s.eventDetails}>
          <span>{fmtDateTime(event.createdAt)}</span>
          <span>{event.tenantName}</span>
          {event.deviceRef && <span>Device {event.deviceRef}</span>}
          <span>{event.actor}</span>
          {event.reasonCode && <span>Reason {event.reasonCode}</span>}
        </div>
      </div>
    </article>
  )
}

const s: Record<string, CSSProperties> = {
  select: { height: 40, minWidth: 150, border: '1px solid #cbd5e1', borderRadius: 6, padding: '0 10px', background: '#fff', color: '#334155', fontSize: 12, fontWeight: 800 },
  timeline: { background: '#fff', border: '1px solid #dfe3e8', borderRadius: 8, overflow: 'hidden' },
  eventRow: { display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr)', minHeight: 84, borderBottom: '1px solid #edf2f7' },
  markerColumn: { position: 'relative', display: 'flex', justifyContent: 'center', paddingTop: 20, background: '#f8fafc' },
  marker: { position: 'relative', zIndex: 1, width: 8, height: 8, borderRadius: '50%', background: '#2563eb', boxShadow: '0 0 0 4px #dbeafe' },
  eventBody: { minWidth: 0, padding: '14px 14px 13px' },
  eventHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  eventTitle: { color: '#111827', fontSize: 14, fontWeight: 900 },
  eventStore: { marginTop: 3, color: '#475569', fontSize: 12, fontWeight: 800, overflowWrap: 'anywhere' },
  eventDetails: { display: 'flex', flexWrap: 'wrap', gap: '5px 14px', marginTop: 9, color: '#64748b', fontSize: 11, fontWeight: 700 },
  empty: { padding: 42, color: '#64748b', textAlign: 'center', fontSize: 13, fontWeight: 700 },
}
