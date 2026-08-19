'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { apiFetch, OWNER_CTX } from '@/lib/api'

type Lead = {
  id: string
  storeName: string
  ownerName: string
  phone: string
  source: string
  campaign: string | null
  inviteCode: string | null
  salesOwner: { id: string; name: string } | null
  telegramBound: boolean
  status: string
  applicationStatus: string
  converted: boolean
  lastActivityAt: string
  conversation: { lastMessage: string; lastAt: string; lastSentBy: string } | null
}

type UnassignedLead = Pick<Lead,
  'id' | 'storeName' | 'source' | 'campaign' | 'inviteCode' | 'status' | 'applicationStatus' | 'lastActivityAt'
>

type Message = {
  id: string
  sentBy: string
  senderName: string | null
  content: string
  messageType: string
  status: string
  createdAt: string
}

export default function SalesWorkspacePage() {
  const [role, setRole] = useState('')
  const [leads, setLeads] = useState<Lead[]>([])
  const [unassigned, setUnassigned] = useState<UnassignedLead[]>([])
  const [unlinkedCount, setUnlinkedCount] = useState(0)
  const [selectedId, setSelectedId] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [reply, setReply] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const selected = useMemo(
    () => leads.find((lead) => lead.id === selectedId) ?? null,
    [leads, selectedId],
  )

  const loadLeads = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await apiFetch('/api/sales/leads', { cache: 'no-store' }, OWNER_CTX)
      const body = await response.json()
      if (!response.ok) throw new Error(body.error)
      setRole(body.role)
      setLeads(body.leads ?? [])
      setUnassigned(body.unassigned ?? [])
      setUnlinkedCount(body.unlinkedInquiryCount ?? 0)
    } catch {
      setError('Sales Workspace 加载失败或无权限')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadConversation = useCallback(async (salesLeadId: string) => {
    const params = new URLSearchParams({ salesLeadId })
    const response = await apiFetch(`/api/sales/conversations?${params}`, { cache: 'no-store' }, OWNER_CTX)
    const body = await response.json()
    if (!response.ok) {
      setError(body.error ?? '会话加载失败')
      return
    }
    setMessages(body.messages ?? [])
  }, [])

  useEffect(() => { void loadLeads() }, [loadLeads])
  useEffect(() => {
    if (selectedId) void loadConversation(selectedId)
    else setMessages([])
  }, [selectedId, loadConversation])

  async function claim(id: string) {
    setBusy(true)
    setError('')
    const response = await apiFetch(`/api/sales/leads/${id}/claim`, { method: 'POST' }, OWNER_CTX)
    const body = await response.json()
    if (response.ok) {
      await loadLeads()
      setSelectedId(id)
    } else {
      setError(body.error === 'ALREADY_CLAIMED' ? '该 Lead 已被其他销售领取' : body.error)
      await loadLeads()
    }
    setBusy(false)
  }

  async function changeStatus(status: 'NEW' | 'FOLLOWING' | 'LOST') {
    if (!selected) return
    setBusy(true)
    const response = await apiFetch(`/api/sales/leads/${selected.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }, OWNER_CTX)
    const body = await response.json()
    if (response.ok) await loadLeads()
    else setError(body.error ?? '状态更新失败')
    setBusy(false)
  }

  async function sendReply(event: FormEvent) {
    event.preventDefault()
    if (!selected || !reply.trim()) return
    setBusy(true)
    const response = await apiFetch('/api/sales/messages', {
      method: 'POST',
      body: JSON.stringify({ salesLeadId: selected.id, text: reply.trim() }),
    }, OWNER_CTX)
    const body = await response.json()
    if (response.ok) {
      setReply('')
      await loadConversation(selected.id)
      await loadLeads()
    } else {
      setError(body.error ?? '回复失败')
    }
    setBusy(false)
  }

  return (
    <main style={s.page}>
      <div style={s.wrap}>
        <header style={s.header}>
          <div><Link href="/ops" style={s.link}>← 运营入口</Link><h1 style={s.h1}>Sales / BD Workspace</h1><p style={s.muted}>{role || 'CHECKING'} · 仅销售 Lead 与 Onboarding 会话</p></div>
          <button type="button" style={s.ghost} onClick={() => void loadLeads()}>刷新</button>
        </header>
        {error && <div style={s.error}>{error}</div>}
        {loading ? <p>加载中…</p> : (
          <div style={s.columns}>
            <section style={s.panel}>
              <h2 style={s.h2}>{role === 'BD' ? '我的 Leads' : 'Sales Leads 监督视图'} <span style={s.badge}>{leads.length}</span></h2>
              <div style={s.list}>{leads.map((lead) => (
                <button key={lead.id} type="button" onClick={() => setSelectedId(lead.id)} style={{ ...s.leadCard, ...(selectedId === lead.id ? s.selected : {}) }}>
                  <span style={s.cardTop}><strong>{lead.storeName}</strong><span>{lead.status}</span></span>
                  <span>{lead.ownerName} · {lead.phone}</span>
                  <span style={s.muted}>{lead.source}{lead.campaign ? ` / ${lead.campaign}` : ''} · {lead.salesOwner?.name ?? 'UNASSIGNED'}</span>
                  <span style={s.muted}>Application {lead.applicationStatus} · Support {lead.conversation ? 'CONNECTED' : 'NONE'}</span>
                </button>
              ))}{leads.length === 0 && <p style={s.muted}>暂无负责 Lead</p>}</div>

              <h2 style={{ ...s.h2, marginTop: 20 }}>未分配 Leads <span style={s.badge}>{unassigned.length}</span></h2>
              <p style={s.muted}>领取前仅展示业务摘要，不展示老板姓名、手机号或 Telegram 身份。</p>
              <div style={s.list}>{unassigned.map((lead) => (
                <div key={lead.id} style={s.poolCard}>
                  <div><strong>{lead.storeName}</strong><div style={s.muted}>{lead.source}{lead.campaign ? ` / ${lead.campaign}` : ''} · {lead.status} · {lead.applicationStatus}</div></div>
                  <button disabled={busy} type="button" style={s.claim} onClick={() => void claim(lead.id)}>领取</button>
                </div>
              ))}</div>
              {role !== 'BD' && <p style={s.muted}>未关联普通咨询：{unlinkedCount}（V0.1 不自动建 Lead，不向 BD 暴露身份）</p>}
            </section>

            <section style={s.panel}>
              {!selected ? <p style={s.muted}>选择一个属于你的 Lead 查看会话。</p> : <>
                <div style={s.detailTop}><div><h2 style={s.h2}>{selected.storeName}</h2><p>{selected.ownerName} · {selected.phone}</p><p style={s.muted}>{selected.source}{selected.campaign ? ` / ${selected.campaign}` : ''} · {selected.inviteCode ?? 'DIRECT'}</p></div><span style={s.badge}>{selected.applicationStatus}</span></div>
                <div style={s.statuses}>{(['NEW','FOLLOWING','LOST'] as const).map((status) => <button type="button" key={status} disabled={busy || ['APPLIED','ACTIVATED'].includes(selected.status)} style={s.ghost} onClick={() => void changeStatus(status)}>{status}</button>)}</div>
                <div style={s.thread}>{messages.map((message) => <div key={message.id} style={{ ...s.message, alignSelf: message.sentBy === 'CUSTOMER' ? 'flex-start' : 'flex-end', background: message.sentBy === 'CUSTOMER' ? '#f1f5f9' : '#dbeafe' }}><strong>{message.sentBy === 'CUSTOMER' ? message.senderName || '客户' : 'Sales'}</strong><span>{message.content}</span><small>{new Date(message.createdAt).toLocaleString()}</small></div>)}{messages.length === 0 && <p style={s.muted}>客户尚未通过 Onboarding Bot 建立会话。</p>}</div>
                <form style={s.reply} onSubmit={sendReply}><textarea value={reply} onChange={(event) => setReply(event.target.value)} maxLength={2000} placeholder="回复潜在商户…" style={s.textarea} /><button disabled={busy || !messages.length} style={s.send}>发送</button></form>
              </>}
            </section>
          </div>
        )}
      </div>
    </main>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f4f7fb', padding: 20, color: '#172033' },
  wrap: { maxWidth: 1200, margin: '0 auto' }, header: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 16 },
  h1: { fontSize: 24, margin: '8px 0 4px' }, h2: { fontSize: 17, margin: '0 0 10px' }, link: { color: '#2563eb', textDecoration: 'none' }, muted: { color: '#64748b', fontSize: 12 },
  columns: { display: 'grid', gridTemplateColumns: 'minmax(300px, .9fr) minmax(340px, 1.1fr)', gap: 14 }, panel: { background: '#fff', borderRadius: 14, padding: 16, minWidth: 0 },
  list: { display: 'grid', gap: 8 }, leadCard: { border: '1px solid #e2e8f0', borderRadius: 11, padding: 12, background: '#fff', textAlign: 'left', display: 'grid', gap: 5, cursor: 'pointer', color: '#172033' }, selected: { borderColor: '#2563eb', boxShadow: '0 0 0 2px #dbeafe' }, cardTop: { display: 'flex', justifyContent: 'space-between', gap: 8 },
  poolCard: { border: '1px solid #e2e8f0', borderRadius: 11, padding: 11, display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }, claim: { border: 0, borderRadius: 8, background: '#0f766e', color: '#fff', padding: '8px 12px', fontWeight: 700 },
  badge: { background: '#eef2ff', color: '#4338ca', borderRadius: 999, padding: '3px 8px', fontSize: 11 }, detailTop: { display: 'flex', justifyContent: 'space-between', gap: 12 }, statuses: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }, ghost: { border: '1px solid #cbd5e1', background: '#fff', borderRadius: 8, padding: '7px 11px', cursor: 'pointer' },
  thread: { minHeight: 320, maxHeight: 520, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, padding: 10, background: '#f8fafc', borderRadius: 10 }, message: { maxWidth: '82%', padding: 9, borderRadius: 10, display: 'grid', gap: 4, fontSize: 13 }, reply: { display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, marginTop: 10 }, textarea: { minHeight: 72, resize: 'vertical', border: '1px solid #cbd5e1', borderRadius: 9, padding: 10 }, send: { border: 0, borderRadius: 9, background: '#2563eb', color: '#fff', padding: '0 18px', fontWeight: 700 }, error: { background: '#fff1f2', color: '#be123c', borderRadius: 9, padding: 10, marginBottom: 12 },
}
