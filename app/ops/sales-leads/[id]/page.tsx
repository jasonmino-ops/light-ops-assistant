'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { apiFetch, OWNER_CTX } from '@/lib/api'

type Lead = Record<string, unknown> & {
  id: string; storeName: string; ownerName: string; normalizedPhone: string; address: string | null
  latitude: number | null; longitude: number | null; firstSourceChannel: string; firstCampaign: string | null
  status: string; telegramId: string | null; telegramUsername: string | null; lastActivityAt: string
  firstInvite: { code: string; campaignLabel: string | null; internalNote: string | null } | null
  initialSalesOwner: { name: string; role: string } | null
  applications: Array<{ id: string; status: string; createdAt: string; createdStore: { id: string; code: string; name: string } | null }>
  block: { active: boolean; reason: string; note: string | null; blockedAt: string } | null
  conversationUrl: string | null
}

export default function SalesLeadDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [lead, setLead] = useState<Lead | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    const response = await apiFetch(`/api/ops/sales-leads/${id}`, { cache: 'no-store' }, OWNER_CTX)
    if (response.ok) setLead(await response.json())
    else setError('Lead 加载失败')
  }, [id])
  useEffect(() => { void load() }, [load])

  async function changeStatus(status: string) {
    setBusy(true)
    const response = await apiFetch(`/api/ops/sales-leads/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }, OWNER_CTX)
    if (response.ok) await load(); else setError('状态更新失败')
    setBusy(false)
  }

  async function changeBlock(action: 'BAN' | 'UNBAN') {
    const reason = action === 'BAN' ? window.prompt('封禁开店申请原因（必填）') : ''
    if (action === 'BAN' && !reason?.trim()) return
    const note = action === 'BAN' ? window.prompt('内部备注（可空）') : ''
    setBusy(true)
    const response = await apiFetch(`/api/ops/sales-leads/${id}/block`, {
      method: 'POST', body: JSON.stringify({ action, reason, note }),
    }, OWNER_CTX)
    const body = await response.json()
    if (response.ok) await load(); else setError(body.error === 'FORBIDDEN' ? '仅 FK-backed OPS_ADMIN / SUPER_ADMIN 可 Ban/Unban' : body.error)
    setBusy(false)
  }

  if (error && !lead) return <main style={s.page}>{error}</main>
  if (!lead) return <main style={s.page}>加载中…</main>
  return (
    <main style={s.page}>
      <div style={s.wrap}><Link href="/ops/sales-leads" style={s.link}>← Sales Leads</Link><div style={s.titleRow}><h1>{lead.storeName}</h1><span>{lead.status}</span></div>
        {error && <div style={s.error}>{error}</div>}
        <section style={s.grid}>
          <Card title="Contact"><p>{lead.ownerName}</p><p>{lead.normalizedPhone}</p><p>{lead.address || 'No address'}</p><p>{lead.latitude != null ? `${lead.latitude}, ${lead.longitude}` : 'No GPS'}</p></Card>
          <Card title="Attribution"><p>{lead.firstSourceChannel}</p><p>{lead.firstCampaign || 'No campaign'}</p><p>{lead.firstInvite?.code || 'DIRECT_TELEGRAM'}</p><p>{lead.initialSalesOwner?.name || 'UNASSIGNED'}</p></Card>
          <Card title="Telegram"><p>{lead.telegramId || 'Not bound'}</p><p>{lead.telegramUsername ? `@${lead.telegramUsername}` : ''}</p>{lead.conversationUrl && <a href={lead.conversationUrl} style={s.link}>打开现有会话</a>}</Card>
          <Card title="Guard / Block"><p>{lead.block?.active ? `BLOCKED · ${lead.block.reason}` : 'NOT BLOCKED'}</p>{lead.telegramId && <button disabled={busy} style={s.secondary} onClick={() => void changeBlock(lead.block?.active ? 'UNBAN' : 'BAN')}>{lead.block?.active ? 'Unban Application' : 'Ban Application'}</button>}</Card>
        </section>
        <section style={s.card}><h2>Minimal Status</h2><div style={s.actions}>{['NEW','FOLLOWING','LOST'].map((status) => <button key={status} disabled={busy || lead.status === 'APPLIED' || lead.status === 'ACTIVATED'} style={s.secondary} onClick={() => void changeStatus(status)}>{status}</button>)}</div></section>
        <section style={s.card}><h2>Applications / Conversion</h2>{lead.applications.length === 0 ? <p>NONE</p> : lead.applications.map((app) => <div key={app.id} style={s.application}><span>{app.status} · {new Date(app.createdAt).toLocaleString()}</span><span>{app.createdStore ? `Store ${app.createdStore.code} / ${app.createdStore.name}` : 'No Store conversion'}</span></div>)}</section>
      </div>
    </main>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) { return <section style={s.card}><h2>{title}</h2>{children}</section> }
const s: Record<string, React.CSSProperties> = { page: { minHeight: '100vh', background: '#f5f7fb', padding: 24, color: '#172033' }, wrap: { maxWidth: 1000, margin: '0 auto' }, link: { color: '#2563eb', textDecoration: 'none' }, titleRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, error: { color: '#be123c', marginBottom: 10 }, grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }, card: { background: '#fff', borderRadius: 13, padding: 16, marginBottom: 12 }, actions: { display: 'flex', flexWrap: 'wrap', gap: 8 }, secondary: { border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8', borderRadius: 8, padding: '8px 11px', cursor: 'pointer' }, application: { display: 'flex', justifyContent: 'space-between', gap: 12, borderTop: '1px solid #eee', padding: '10px 0', fontSize: 13 } }
