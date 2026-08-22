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

type Inquiry = {
  id: string
  senderName: string | null
  latestMessage: string
  lastAt: string
  claimed: boolean
  ownedByMe: boolean
  owner: { id: string; name: string } | null
}

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
  const [inquiries, setInquiries] = useState<Inquiry[]>([])
  const [selectedLeadId, setSelectedLeadId] = useState('')
  const [selectedInquiryId, setSelectedInquiryId] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [reply, setReply] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const selectedLead = useMemo(
    () => leads.find((lead) => lead.id === selectedLeadId) ?? null,
    [leads, selectedLeadId],
  )
  const selectedInquiry = useMemo(
    () => inquiries.find((inquiry) => inquiry.id === selectedInquiryId) ?? null,
    [inquiries, selectedInquiryId],
  )

  const loadWorkspace = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [leadResponse, inquiryResponse] = await Promise.all([
        apiFetch('/api/sales/leads', { cache: 'no-store' }, OWNER_CTX),
        apiFetch('/api/sales/inquiries', { cache: 'no-store' }, OWNER_CTX),
      ])
      const [leadBody, inquiryBody] = await Promise.all([
        leadResponse.json(),
        inquiryResponse.json(),
      ])
      if (!leadResponse.ok) throw new Error(leadBody.error)
      if (!inquiryResponse.ok) throw new Error(inquiryBody.error)
      setRole(leadBody.role)
      setLeads(leadBody.leads ?? [])
      setUnassigned(leadBody.unassigned ?? [])
      setInquiries(inquiryBody.inquiries ?? [])
    } catch {
      setError('Sales Workspace 加载失败或无权限')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadConversation = useCallback(async (kind: 'lead' | 'inquiry', id: string) => {
    const params = new URLSearchParams(kind === 'lead'
      ? { salesLeadId: id }
      : { inquiryId: id })
    const path = kind === 'lead' ? '/api/sales/conversations' : '/api/sales/inquiries'
    const response = await apiFetch(`${path}?${params}`, { cache: 'no-store' }, OWNER_CTX)
    const body = await response.json()
    if (!response.ok) {
      setError(body.error ?? '会话加载失败')
      setMessages([])
      return
    }
    setMessages(body.messages ?? [])
  }, [])

  useEffect(() => { void loadWorkspace() }, [loadWorkspace])
  useEffect(() => {
    if (selectedLeadId) void loadConversation('lead', selectedLeadId)
    else if (selectedInquiryId) void loadConversation('inquiry', selectedInquiryId)
    else setMessages([])
  }, [selectedLeadId, selectedInquiryId, loadConversation])

  function selectLead(id: string) {
    setSelectedInquiryId('')
    setSelectedLeadId(id)
    setError('')
  }

  function selectInquiry(inquiry: Inquiry) {
    if (role === 'BD' && !inquiry.ownedByMe) return
    setSelectedLeadId('')
    setSelectedInquiryId(inquiry.id)
    setError('')
  }

  async function claimLead(id: string) {
    setBusy(true)
    setError('')
    const response = await apiFetch(`/api/sales/leads/${id}/claim`, { method: 'POST' }, OWNER_CTX)
    const body = await response.json()
    if (response.ok) {
      await loadWorkspace()
      selectLead(id)
    } else {
      setError(body.error === 'ALREADY_CLAIMED' ? '该 Lead 已被其他销售领取' : body.error)
      await loadWorkspace()
    }
    setBusy(false)
  }

  async function claimInquiry(id: string) {
    setBusy(true)
    setError('')
    const response = await apiFetch('/api/sales/inquiries', {
      method: 'POST',
      body: JSON.stringify({ inquiryId: id }),
    }, OWNER_CTX)
    const body = await response.json()
    if (response.ok) {
      await loadWorkspace()
      setSelectedLeadId('')
      setSelectedInquiryId(id)
      await loadConversation('inquiry', id)
    } else {
      setError(body.error === 'ALREADY_CLAIMED' ? '该咨询已被其他销售领取' : body.error)
      await loadWorkspace()
    }
    setBusy(false)
  }

  async function changeStatus(status: 'NEW' | 'FOLLOWING' | 'LOST') {
    if (!selectedLead) return
    setBusy(true)
    const response = await apiFetch(`/api/sales/leads/${selectedLead.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }, OWNER_CTX)
    const body = await response.json()
    if (response.ok) await loadWorkspace()
    else setError(body.error ?? '状态更新失败')
    setBusy(false)
  }

  async function sendReply(event: FormEvent) {
    event.preventDefault()
    if ((!selectedLead && !selectedInquiry) || !reply.trim()) return
    setBusy(true)
    const response = await apiFetch('/api/sales/messages', {
      method: 'POST',
      body: JSON.stringify(selectedLead
        ? { salesLeadId: selectedLead.id, text: reply.trim() }
        : { inquiryId: selectedInquiry!.id, text: reply.trim() }),
    }, OWNER_CTX)
    const body = await response.json()
    if (response.ok) {
      setReply('')
      if (selectedLead) await loadConversation('lead', selectedLead.id)
      else if (selectedInquiry) await loadConversation('inquiry', selectedInquiry.id)
      await loadWorkspace()
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
          <button type="button" style={s.ghost} onClick={() => void loadWorkspace()}>刷新</button>
        </header>
        {error && <div style={s.error}>{error}</div>}
        {loading ? <p>加载中…</p> : (
          <div style={s.columns}>
            <section style={s.panel}>
              <h2 style={s.h2}>{role === 'BD' ? '我的 Leads' : 'Sales Leads 监督视图'} <span style={s.badge}>{leads.length}</span></h2>
              <div style={s.list}>{leads.map((lead) => (
                <button key={lead.id} type="button" onClick={() => selectLead(lead.id)} style={{ ...s.leadCard, ...(selectedLeadId === lead.id ? s.selected : {}) }}>
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
                  <button disabled={busy} type="button" style={s.claim} onClick={() => void claimLead(lead.id)}>领取</button>
                </div>
              ))}</div>

              <h2 style={{ ...s.h2, marginTop: 20 }}>未关联咨询 <span style={s.badge}>{inquiries.length}</span></h2>
              <p style={s.muted}>只显示 Telegram 名称、最新消息与领取状态；不会自动创建或匹配 Lead。</p>
              <div style={s.list}>{inquiries.map((inquiry) => (
                <div key={inquiry.id} style={{ ...s.inquiryCard, ...(selectedInquiryId === inquiry.id ? s.selected : {}) }}>
                  <button type="button" disabled={role === 'BD' && !inquiry.ownedByMe} onClick={() => selectInquiry(inquiry)} style={s.inquirySummary}>
                    <span style={s.cardTop}><strong>{inquiry.senderName || 'Telegram 咨询客户'}</strong><span>{inquiry.claimed ? '已领取' : '待领取'}</span></span>
                    <span>{inquiry.latestMessage}</span>
                    <span style={s.muted}>{new Date(inquiry.lastAt).toLocaleString()}{inquiry.owner ? ` · ${inquiry.owner.name}` : ''}</span>
                  </button>
                  {!inquiry.claimed && <button disabled={busy} type="button" style={s.claim} onClick={() => void claimInquiry(inquiry.id)}>领取咨询</button>}
                </div>
              ))}{inquiries.length === 0 && <p style={s.muted}>暂无未关联咨询</p>}</div>
            </section>

            <section style={s.panel}>
              {!selectedLead && !selectedInquiry ? <p style={s.muted}>选择一个属于你的 Lead 或已领取咨询查看会话。</p> : <>
                {selectedLead ? <>
                  <div style={s.detailTop}><div><h2 style={s.h2}>{selectedLead.storeName}</h2><p>{selectedLead.ownerName} · {selectedLead.phone}</p><p style={s.muted}>{selectedLead.source}{selectedLead.campaign ? ` / ${selectedLead.campaign}` : ''} · {selectedLead.inviteCode ?? 'DIRECT'}</p></div><span style={s.badge}>{selectedLead.applicationStatus}</span></div>
                  <div style={s.statuses}>{(['NEW','FOLLOWING','LOST'] as const).map((status) => <button type="button" key={status} disabled={busy || ['APPLIED','ACTIVATED'].includes(selectedLead.status)} style={s.ghost} onClick={() => void changeStatus(status)}>{status}</button>)}</div>
                </> : <div style={s.detailTop}><div><h2 style={s.h2}>未关联咨询</h2><p>{selectedInquiry?.senderName || 'Telegram 咨询客户'}</p><p style={s.muted}>无安全 Lead 关联；仅处理当前 Onboarding 会话。</p></div><span style={s.badge}>{selectedInquiry?.claimed ? 'CLAIMED' : 'UNCLAIMED'}</span></div>}
                <div style={s.thread}>{messages.map((message) => <div key={message.id} style={{ ...s.message, alignSelf: message.sentBy === 'CUSTOMER' ? 'flex-start' : 'flex-end', background: message.sentBy === 'CUSTOMER' ? '#f1f5f9' : '#dbeafe' }}><strong>{message.sentBy === 'CUSTOMER' ? message.senderName || '客户' : 'Sales'}</strong><span>{message.content}</span><small>{new Date(message.createdAt).toLocaleString()}</small></div>)}{messages.length === 0 && <p style={s.muted}>暂无可见消息。</p>}</div>
                <form style={s.reply} onSubmit={sendReply}><textarea value={reply} onChange={(event) => setReply(event.target.value)} maxLength={2000} placeholder="回复潜在商户…" style={s.textarea} /><button disabled={busy || !messages.length || (role === 'BD' && Boolean(selectedInquiry && !selectedInquiry.ownedByMe))} style={s.send}>发送</button></form>
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
  poolCard: { border: '1px solid #e2e8f0', borderRadius: 11, padding: 11, display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }, claim: { border: 0, borderRadius: 8, background: '#0f766e', color: '#fff', padding: '8px 12px', fontWeight: 700, whiteSpace: 'nowrap' },
  inquiryCard: { border: '1px solid #e2e8f0', borderRadius: 11, padding: 8, display: 'flex', gap: 8, alignItems: 'center' }, inquirySummary: { border: 0, padding: 3, background: 'transparent', color: '#172033', textAlign: 'left', display: 'grid', gap: 5, flex: 1, minWidth: 0 },
  badge: { background: '#eef2ff', color: '#4338ca', borderRadius: 999, padding: '3px 8px', fontSize: 11 }, detailTop: { display: 'flex', justifyContent: 'space-between', gap: 12 }, statuses: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }, ghost: { border: '1px solid #cbd5e1', background: '#fff', borderRadius: 8, padding: '7px 11px', cursor: 'pointer' },
  thread: { minHeight: 320, maxHeight: 520, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, padding: 10, background: '#f8fafc', borderRadius: 10 }, message: { maxWidth: '82%', padding: 9, borderRadius: 10, display: 'grid', gap: 4, fontSize: 13 }, reply: { display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, marginTop: 10 }, textarea: { minHeight: 72, resize: 'vertical', border: '1px solid #cbd5e1', borderRadius: 9, padding: 10 }, send: { border: 0, borderRadius: 9, background: '#2563eb', color: '#fff', padding: '0 18px', fontWeight: 700 }, error: { background: '#fff1f2', color: '#be123c', borderRadius: 9, padding: 10, marginBottom: 12 },
}
