'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { apiFetch, OWNER_CTX } from '@/lib/api'

type LeadRow = {
  id: string
  storeName: string
  ownerName: string
  phone: string
  source: string
  campaign: string | null
  inviteCode: string | null
  salesOwner: { id: string; name: string } | null
  telegramBound: boolean
  telegramUsername: string | null
  status: string
  lastActivityAt: string
  application: { status: string; createdStoreId: string | null } | null
  blocked: boolean
}
type Funnel = { visits: number; validLeads: number; telegramBound: number; applications: number; approved: number; stores: number }

export default function SalesLeadListPage() {
  const [leads, setLeads] = useState<LeadRow[]>([])
  const [funnel, setFunnel] = useState<Funnel | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async (nextQuery: string, nextStatus: string) => {
    setLoading(true)
    setError('')
    const params = new URLSearchParams()
    if (nextQuery.trim()) params.set('q', nextQuery.trim())
    if (nextStatus) params.set('status', nextStatus)
    try {
      const response = await apiFetch(`/api/ops/sales-leads?${params}`, { cache: 'no-store' }, OWNER_CTX)
      const body = await response.json()
      if (!response.ok) throw new Error(body.error)
      setLeads(body.leads)
      setFunnel(body.funnel)
    } catch {
      setError('Sales Lead 加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load('', '') }, [load])

  function search(event: FormEvent) {
    event.preventDefault()
    void load(query, status)
  }

  return (
    <main style={s.page}>
      <header style={s.header}><Link href="/ops" style={s.link}>← 运营后台</Link><h1>Sales Leads</h1><p style={s.muted}>最小销售跟进视图，不含 CRM tasks、tags 或自动化。</p></header>
      {funnel && <div style={s.funnel}>{Object.entries(funnel).map(([key, value]) => <div key={key} style={s.metric}><strong>{value}</strong><span>{key}</span></div>)}</div>}
      <form style={s.filters} onSubmit={search}>
        <input style={s.input} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="店铺 / 老板 / 手机 / Campaign / Invite" />
        <select style={s.input} value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option>{['NEW','FOLLOWING','WAITING_TELEGRAM','APPLIED','ACTIVATED','LOST'].map((value) => <option key={value}>{value}</option>)}</select>
        <button style={s.button}>搜索</button>
      </form>
      {error && <div style={s.error}>{error}</div>}
      {loading ? <p>加载中…</p> : <div style={s.list}>{leads.map((lead) => (
        <Link key={lead.id} href={`/ops/sales-leads/${lead.id}`} style={s.card}>
          <div style={s.row}><strong>{lead.storeName}</strong><span>{lead.status}{lead.blocked ? ' · BLOCKED' : ''}</span></div>
          <div>{lead.ownerName} · {lead.phone}</div>
          <div style={s.muted}>{lead.source}{lead.campaign ? ` / ${lead.campaign}` : ''} · {lead.inviteCode || 'DIRECT'} · {lead.salesOwner?.name || 'UNASSIGNED'}</div>
          <div style={s.muted}>Telegram {lead.telegramBound ? lead.telegramUsername ? `@${lead.telegramUsername}` : 'BOUND' : 'NOT BOUND'} · Application {lead.application?.status || 'NONE'} · {new Date(lead.lastActivityAt).toLocaleString()}</div>
        </Link>
      ))}</div>}
    </main>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f5f7fb', padding: 24, color: '#172033' }, header: { maxWidth: 1080, margin: '0 auto' }, link: { color: '#2563eb', textDecoration: 'none' }, muted: { color: '#64748b', fontSize: 13 }, funnel: { maxWidth: 1080, margin: '18px auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10 }, metric: { background: '#fff', borderRadius: 12, padding: 14, display: 'grid', gap: 5 }, filters: { maxWidth: 1080, margin: '0 auto 16px', display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: 10 }, input: { minHeight: 42, border: '1px solid #dbe3ef', borderRadius: 9, padding: '0 10px', background: '#fff' }, button: { border: 0, borderRadius: 9, background: '#2563eb', color: '#fff', padding: '0 18px', fontWeight: 700 }, error: { maxWidth: 1080, margin: '0 auto 12px', color: '#be123c' }, list: { maxWidth: 1080, margin: '0 auto', display: 'grid', gap: 10 }, card: { display: 'grid', gap: 6, color: '#172033', textDecoration: 'none', background: '#fff', borderRadius: 13, padding: 16, boxShadow: '0 3px 14px rgba(15,23,42,.05)' }, row: { display: 'flex', justifyContent: 'space-between', gap: 12 },
}
