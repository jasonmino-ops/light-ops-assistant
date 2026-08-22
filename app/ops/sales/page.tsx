'use client'

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { apiFetch, OWNER_CTX } from '@/lib/api'
import { type Lang, useLocale } from '@/app/components/LangProvider'

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
  telegramDisplayName: string | null
  telegramUsername: string | null
  status: string
  applicationStatus: string
  converted: boolean
  lastActivityAt: string
  conversation: {
    lastMessage: string
    lastAt: string
    lastSentBy: string
    hasNewMessage: boolean
  } | null
}

type UnassignedLead = Pick<Lead,
  'id' | 'storeName' | 'source' | 'campaign' | 'inviteCode' | 'status' | 'applicationStatus' | 'lastActivityAt'
>

type Inquiry = {
  id: string
  senderName: string | null
  senderUsername: string | null
  latestMessage: string
  lastAt: string
  hasNewMessage: boolean
  claimed: boolean
  ownedByMe: boolean
  owner: { id: string; name: string } | null
}

type Message = {
  id: string
  sentBy: string
  senderName: string | null
  senderUsername: string | null
  content: string
  messageType: string
  status: string
  createdAt: string
}

type QueueKey = 'mine' | 'new' | 'following' | 'unlinked' | 'pending' | 'unanswered'
type WorkspaceItem =
  | { kind: 'lead'; value: Lead }
  | { kind: 'unassigned'; value: UnassignedLead }
  | { kind: 'inquiry'; value: Inquiry }

type Summary = Record<QueueKey, number>

const EMPTY_SUMMARY: Summary = {
  mine: 0,
  new: 0,
  following: 0,
  unlinked: 0,
  pending: 0,
  unanswered: 0,
}

const LANGUAGE_OPTIONS: Array<{ code: Lang; label: string }> = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: 'English' },
  { code: 'km', label: 'ខ្មែរ' },
]

export default function SalesWorkspacePage() {
  const { t, lang, setLang } = useLocale()
  const [role, setRole] = useState('')
  const [leads, setLeads] = useState<Lead[]>([])
  const [unassigned, setUnassigned] = useState<UnassignedLead[]>([])
  const [inquiries, setInquiries] = useState<Inquiry[]>([])
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY)
  const [queue, setQueue] = useState<QueueKey>('mine')
  const [query, setQuery] = useState('')
  const [selectedLeadId, setSelectedLeadId] = useState('')
  const [selectedInquiryId, setSelectedInquiryId] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [reply, setReply] = useState('')
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')
  const composerRef = useRef<HTMLTextAreaElement>(null)

  const selectedLead = useMemo(
    () => leads.find((lead) => lead.id === selectedLeadId) ?? null,
    [leads, selectedLeadId],
  )
  const selectedInquiry = useMemo(
    () => inquiries.find((inquiry) => inquiry.id === selectedInquiryId) ?? null,
    [inquiries, selectedInquiryId],
  )

  const makeSummary = useCallback((nextLeads: Lead[], nextUnassigned: UnassignedLead[], nextInquiries: Inquiry[]): Summary => ({
    mine: nextLeads.length,
    new: nextLeads.filter((lead) => ['NEW', 'WAITING_TELEGRAM'].includes(lead.status)).length + nextUnassigned.length,
    following: nextLeads.filter((lead) => lead.status === 'FOLLOWING').length,
    unlinked: nextInquiries.length,
    pending: nextLeads.filter((lead) => ['NOT_APPLIED', 'PENDING'].includes(lead.applicationStatus)).length,
    unanswered: nextLeads.filter((lead) => lead.conversation?.hasNewMessage).length
      + nextInquiries.filter((inquiry) => inquiry.hasNewMessage).length,
  }), [])

  const loadWorkspace = useCallback(async (search: string) => {
    if (search) setSearching(true)
    else if (!role) setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (search) params.set('q', search)
      const suffix = params.size ? `?${params}` : ''
      const [leadResponse, inquiryResponse] = await Promise.all([
        apiFetch(`/api/sales/leads${suffix}`, { cache: 'no-store' }, OWNER_CTX),
        apiFetch(`/api/sales/inquiries${suffix}`, { cache: 'no-store' }, OWNER_CTX),
      ])
      const [leadBody, inquiryBody] = await Promise.all([
        leadResponse.json(),
        inquiryResponse.json(),
      ])
      if (!leadResponse.ok) throw new Error(leadBody.error)
      if (!inquiryResponse.ok) throw new Error(inquiryBody.error)
      const nextLeads = leadBody.leads ?? []
      const nextUnassigned = leadBody.unassigned ?? []
      const nextInquiries = inquiryBody.inquiries ?? []
      setRole(leadBody.role)
      setLeads(nextLeads)
      setUnassigned(nextUnassigned)
      setInquiries(nextInquiries)
      if (!search) setSummary(makeSummary(nextLeads, nextUnassigned, nextInquiries))
    } catch {
      setError(t('salesWorkspace.workspaceError'))
    } finally {
      setLoading(false)
      setSearching(false)
    }
  }, [makeSummary, role, t])

  const loadConversation = useCallback(async (kind: 'lead' | 'inquiry', id: string) => {
    const params = new URLSearchParams(kind === 'lead'
      ? { salesLeadId: id }
      : { inquiryId: id })
    const path = kind === 'lead' ? '/api/sales/conversations' : '/api/sales/inquiries'
    const response = await apiFetch(`${path}?${params}`, { cache: 'no-store' }, OWNER_CTX)
    const body = await response.json()
    if (!response.ok) {
      setError(body.error ?? t('salesWorkspace.conversationError'))
      setMessages([])
      return
    }
    setMessages(body.messages ?? [])
  }, [t])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadWorkspace(query.trim()), 240)
    return () => window.clearTimeout(timer)
  }, [query, loadWorkspace])

  useEffect(() => {
    if (selectedLeadId) void loadConversation('lead', selectedLeadId)
    else if (selectedInquiryId) void loadConversation('inquiry', selectedInquiryId)
    else setMessages([])
  }, [selectedLeadId, selectedInquiryId, loadConversation])

  const items = useMemo<WorkspaceItem[]>(() => {
    if (query.trim()) {
      return [
        ...leads.map((value) => ({ kind: 'lead' as const, value })),
        ...unassigned.map((value) => ({ kind: 'unassigned' as const, value })),
        ...inquiries.map((value) => ({ kind: 'inquiry' as const, value })),
      ].sort((a, b) => itemTime(b) - itemTime(a))
    }
    if (queue === 'mine') return leads.map((value) => ({ kind: 'lead', value }))
    if (queue === 'new') return [
      ...leads.filter((lead) => ['NEW', 'WAITING_TELEGRAM'].includes(lead.status))
        .map((value) => ({ kind: 'lead' as const, value })),
      ...unassigned.map((value) => ({ kind: 'unassigned' as const, value })),
    ].sort((a, b) => itemTime(b) - itemTime(a))
    if (queue === 'following') return leads
      .filter((lead) => lead.status === 'FOLLOWING')
      .map((value) => ({ kind: 'lead', value }))
    if (queue === 'unlinked') return inquiries.map((value) => ({ kind: 'inquiry', value }))
    if (queue === 'unanswered') return [
      ...leads.filter((lead) => lead.conversation?.hasNewMessage)
        .map((value) => ({ kind: 'lead' as const, value })),
      ...inquiries.filter((inquiry) => inquiry.hasNewMessage)
        .map((value) => ({ kind: 'inquiry' as const, value })),
    ].sort((a, b) => itemTime(b) - itemTime(a))
    return leads.filter((lead) => ['NOT_APPLIED', 'PENDING'].includes(lead.applicationStatus))
      .map((value) => ({ kind: 'lead', value }))
  }, [inquiries, leads, query, queue, unassigned])

  function chooseQueue(next: QueueKey) {
    setQueue(next)
    if (query) setQuery('')
  }

  function selectLead(id: string) {
    setSelectedInquiryId('')
    setSelectedLeadId(id)
    setError('')
    setCopyState('idle')
  }

  function selectInquiry(inquiry: Inquiry) {
    if (role === 'BD' && !inquiry.ownedByMe) return
    setSelectedLeadId('')
    setSelectedInquiryId(inquiry.id)
    setError('')
    setCopyState('idle')
  }

  async function claimLead(id: string) {
    setBusy(true)
    setError('')
    const response = await apiFetch(`/api/sales/leads/${id}/claim`, { method: 'POST' }, OWNER_CTX)
    const body = await response.json()
    if (response.ok) {
      await loadWorkspace(query.trim())
      selectLead(id)
    } else {
      setError(body.error === 'ALREADY_CLAIMED'
        ? t('salesWorkspace.alreadyClaimedLead')
        : body.error)
      await loadWorkspace(query.trim())
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
      await loadWorkspace(query.trim())
      setSelectedLeadId('')
      setSelectedInquiryId(id)
      await loadConversation('inquiry', id)
    } else {
      setError(body.error === 'ALREADY_CLAIMED'
        ? t('salesWorkspace.alreadyClaimedInquiry')
        : body.error)
      await loadWorkspace(query.trim())
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
    if (response.ok) await loadWorkspace(query.trim())
    else setError(body.error ?? t('salesWorkspace.statusError'))
    setBusy(false)
  }

  async function copyPhone() {
    if (!selectedLead?.phone) return
    try {
      await navigator.clipboard.writeText(selectedLead.phone)
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 1800)
    } catch {
      setError(t('salesWorkspace.copyError'))
    }
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
      await loadWorkspace(query.trim())
    } else {
      setError(body.error ?? t('salesWorkspace.replyError'))
    }
    setBusy(false)
  }

  const queueItems: Array<{ key: QueueKey; label: string; count: number }> = [
    { key: 'mine', label: t('salesWorkspace.myCustomers'), count: summary.mine },
    { key: 'new', label: t('salesWorkspace.newLeads'), count: summary.new },
    { key: 'following', label: t('salesWorkspace.following'), count: summary.following },
    { key: 'unlinked', label: t('salesWorkspace.unlinkedInquiries'), count: summary.unlinked },
    { key: 'pending', label: t('salesWorkspace.pendingApplication'), count: summary.pending },
  ]

  return (
    <main className="sales-page">
      <header className="sales-header">
        <div className="title-block">
          <Link href="/ops" className="back-link">← {t('salesWorkspace.backOps')}</Link>
          <h1>{t('salesWorkspace.pageTitle')}</h1>
          <p>{t('salesWorkspace.pageSubtitle')} · {role || 'CHECKING'}</p>
        </div>
        <div className="header-actions">
          <div className="language-switch" aria-label="language">
            {LANGUAGE_OPTIONS.map((option) => (
              <button key={option.code} type="button" className={lang === option.code ? 'active' : ''} onClick={() => setLang(option.code)}>{option.label}</button>
            ))}
          </div>
          <button type="button" className="refresh-button" onClick={() => void loadWorkspace(query.trim())}>{t('salesWorkspace.refresh')}</button>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}
      {loading ? <div className="loading-state">{t('salesWorkspace.loading')}</div> : (
        <div className="sales-shell">
          <aside className="queue-column column-surface">
            <section>
              <div className="section-label">{t('salesWorkspace.personalSummary')}</div>
              <div className="summary-grid">
                <button type="button" onClick={() => chooseQueue('mine')}><strong>{summary.mine}</strong><span>{t('salesWorkspace.myCustomers')}</span></button>
                <button type="button" onClick={() => chooseQueue('new')}><strong>{summary.new}</strong><span>{t('salesWorkspace.newLeads')}</span></button>
                <button type="button" onClick={() => chooseQueue('unlinked')}><strong>{summary.unlinked}</strong><span>{t('salesWorkspace.unlinkedInquiries')}</span></button>
                <button type="button" onClick={() => chooseQueue('unanswered')}><strong>{summary.unanswered}</strong><span>{t('salesWorkspace.unanswered')}</span></button>
              </div>
            </section>
            <section>
              <div className="section-label">{t('salesWorkspace.queueTitle')}</div>
              <nav className="queue-nav">
                {queueItems.map((item) => (
                  <button key={item.key} type="button" className={queue === item.key && !query ? 'active' : ''} onClick={() => chooseQueue(item.key)}>
                    <span>{item.label}</span><strong>{item.count}</strong>
                  </button>
                ))}
              </nav>
            </section>
          </aside>

          <section className="list-column column-surface">
            <div className="list-header">
              <div><h2>{t('salesWorkspace.listTitle')}</h2><span>{items.length} {t('salesWorkspace.resultCount')}</span></div>
              <div className="search-wrap">
                <span aria-hidden="true">⌕</span>
                <input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={80} placeholder={t('salesWorkspace.searchPlaceholder')} aria-label={t('salesWorkspace.searchPlaceholder')} />
                {searching && <small>{t('salesWorkspace.searching')}</small>}
              </div>
            </div>
            <div className="customer-list">
              {items.map((item) => item.kind === 'lead'
                ? <LeadCard key={`lead-${item.value.id}`} lead={item.value} active={selectedLeadId === item.value.id} t={t} lang={lang} onSelect={() => selectLead(item.value.id)} />
                : item.kind === 'unassigned'
                  ? <UnassignedCard key={`pool-${item.value.id}`} lead={item.value} t={t} lang={lang} busy={busy} onClaim={() => void claimLead(item.value.id)} />
                  : <InquiryCard key={`inquiry-${item.value.id}`} inquiry={item.value} active={selectedInquiryId === item.value.id} t={t} lang={lang} role={role} busy={busy} onSelect={() => selectInquiry(item.value)} onClaim={() => void claimInquiry(item.value.id)} />)}
              {items.length === 0 && <div className="empty-list">{query ? t('salesWorkspace.noSearchResults') : t('salesWorkspace.emptyList')}</div>}
            </div>
          </section>

          <section className="detail-column column-surface">
            {!selectedLead && !selectedInquiry ? <div className="empty-detail"><div>↗</div><h2>{t('salesWorkspace.customerDetail')}</h2><p>{t('salesWorkspace.choosePrompt')}</p></div> : <>
              <div className="detail-scroll">
                {selectedLead
                  ? <LeadDetail lead={selectedLead} t={t} lang={lang} busy={busy} copyState={copyState} onCopy={() => void copyPhone()} onReply={() => composerRef.current?.focus()} onStatus={(status) => void changeStatus(status)} />
                  : <InquiryDetail inquiry={selectedInquiry!} t={t} lang={lang} onReply={() => composerRef.current?.focus()} />}
                <section className="conversation-section">
                  <div className="conversation-title"><h3>{t('salesWorkspace.conversation')}</h3><span>{messages.length}</span></div>
                  <div className="thread">
                    {messages.map((message) => <div key={message.id} className={`message ${message.sentBy === 'CUSTOMER' ? 'incoming' : 'outgoing'}`}>
                      <strong>{message.sentBy === 'CUSTOMER' ? message.senderName || t('salesWorkspace.customer') : t('salesWorkspace.sales')}</strong>
                      <span>{message.content}</span>
                      <small>{formatDate(message.createdAt, lang)}</small>
                    </div>)}
                    {messages.length === 0 && <div className="no-messages">{t('salesWorkspace.noMessages')}</div>}
                  </div>
                  <form className="reply-box" onSubmit={sendReply}>
                    <textarea ref={composerRef} value={reply} onChange={(event) => setReply(event.target.value)} maxLength={2000} placeholder={t('salesWorkspace.replyPlaceholder')} />
                    <button disabled={busy || !messages.length || !reply.trim()}>{t('salesWorkspace.send')}</button>
                  </form>
                </section>
              </div>
            </>}
          </section>
        </div>
      )}

      <style jsx global>{`
        .sales-page{min-height:100vh;background:#f3f5f8;color:#18202c;padding:16px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow-x:hidden}
        .sales-header{max-width:1440px;margin:0 auto 14px;display:flex;align-items:flex-end;justify-content:space-between;gap:16px}.back-link{color:#2563eb;text-decoration:none;font-size:13px}.title-block h1{font-size:24px;line-height:1.15;margin:7px 0 3px}.title-block p{margin:0;color:#667085;font-size:13px}.header-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end}.language-switch{display:flex;padding:3px;background:#e9edf3;border-radius:10px}.language-switch button,.refresh-button{min-height:40px;border:0;border-radius:8px;background:transparent;padding:0 11px;color:#596273;font-size:13px;white-space:normal}.language-switch button.active{background:#fff;color:#111827;box-shadow:0 1px 4px #0f172a1c}.refresh-button{background:#fff;border:1px solid #d9dee7;color:#344054}.error-banner,.loading-state{max-width:1440px;margin:0 auto 12px;border-radius:10px;padding:11px 13px}.error-banner{background:#fff1f2;color:#b42318}.loading-state{background:#fff;color:#667085}
        .sales-shell{max-width:1440px;margin:0 auto;display:grid;grid-template-columns:minmax(180px,220px) minmax(300px,370px) minmax(360px,1fr);gap:12px;align-items:stretch;min-width:0}.column-surface{background:#fff;border:1px solid #e4e7ec;border-radius:15px;min-width:0;min-height:calc(100vh - 112px);box-shadow:0 1px 2px #1018280a}.queue-column,.list-column{padding:14px}.queue-column{display:flex;flex-direction:column;gap:22px}.section-label{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#98a2b3;margin:0 0 8px}.summary-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.summary-grid button{min-height:66px;border:1px solid #e7eaf0;background:#fafbfc;border-radius:11px;padding:9px;text-align:left;display:grid;align-content:center;gap:2px;color:#344054}.summary-grid strong{font-size:20px}.summary-grid span{font-size:11px;line-height:1.3;overflow-wrap:anywhere}.queue-nav{display:grid;gap:5px}.queue-nav button{min-height:46px;border:0;background:transparent;border-radius:10px;padding:8px 10px;display:flex;align-items:center;justify-content:space-between;gap:8px;text-align:left;color:#344054}.queue-nav button span{overflow-wrap:anywhere}.queue-nav button strong{min-width:26px;border-radius:999px;background:#eef1f5;padding:3px 7px;text-align:center;font-size:11px}.queue-nav button.active{background:#eef6ff;color:#175cd3}.queue-nav button.active strong{background:#dbeafe;color:#175cd3}
        .list-column{display:flex;flex-direction:column;gap:12px}.list-header{display:grid;gap:10px}.list-header>div:first-child{display:flex;align-items:baseline;justify-content:space-between;gap:8px}.list-header h2{font-size:17px;margin:0}.list-header span{font-size:11px;color:#98a2b3}.search-wrap{height:44px;border:1px solid #d9dee7;border-radius:11px;display:flex;align-items:center;gap:8px;padding:0 11px;background:#fafbfc;min-width:0}.search-wrap>span{font-size:20px;color:#98a2b3}.search-wrap input{border:0;outline:0;background:transparent;min-width:0;flex:1;font-size:16px;color:#1d2939}.search-wrap small{color:#667085;white-space:nowrap}.customer-list{display:grid;gap:8px;align-content:start;overflow-y:auto;max-height:calc(100vh - 215px);padding-right:2px}.empty-list{padding:36px 14px;text-align:center;color:#98a2b3;font-size:13px}
        .detail-column{overflow:hidden}.detail-scroll{height:calc(100vh - 112px);overflow-y:auto}.empty-detail{min-height:420px;display:grid;place-content:center;text-align:center;padding:30px;color:#98a2b3}.empty-detail>div{font-size:28px}.empty-detail h2{color:#475467;font-size:18px;margin:10px 0 4px}.empty-detail p{max-width:320px;margin:0;font-size:13px;line-height:1.55}.conversation-section{border-top:1px solid #eaecf0;padding:14px}.conversation-title{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}.conversation-title h3{font-size:15px;margin:0}.conversation-title span{font-size:11px;border-radius:999px;background:#f2f4f7;padding:3px 8px}.thread{min-height:220px;max-height:390px;overflow-y:auto;background:#f7f8fa;border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:8px}.message{max-width:82%;padding:9px 11px;border-radius:12px;display:grid;gap:4px;font-size:13px;overflow-wrap:anywhere}.message.incoming{align-self:flex-start;background:#fff;border:1px solid #e4e7ec}.message.outgoing{align-self:flex-end;background:#e9f2ff}.message strong{font-size:11px}.message small{font-size:10px;color:#98a2b3}.no-messages{margin:auto;color:#98a2b3;font-size:13px}.reply-box{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;margin-top:10px}.reply-box textarea{min-height:68px;resize:vertical;border:1px solid #d0d5dd;border-radius:11px;padding:10px 11px;font:16px/1.45 inherit;outline:none}.reply-box textarea:focus{border-color:#84adff;box-shadow:0 0 0 3px #dbeafe}.reply-box button{min-width:78px;border:0;border-radius:10px;background:#1769e0;color:#fff;font-weight:700;padding:0 16px;min-height:48px}.reply-box button:disabled{opacity:.45}
        .sales-page button{font:inherit;cursor:pointer}.sales-page button:disabled{cursor:not-allowed}.card{width:100%;border:1px solid #e4e7ec;border-radius:12px;background:#fff;padding:11px;text-align:left;color:#1d2939;min-width:0}.card:hover{border-color:#b8c2d1}.card.active{border-color:#84adff;box-shadow:0 0 0 2px #dbeafe}.card-top,.card-meta,.card-contact{display:flex;align-items:center;justify-content:space-between;gap:8px}.card-top strong{font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.card-contact{justify-content:flex-start;font-size:12px;color:#475467;margin-top:5px;min-width:0}.card-contact span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.card-meta{font-size:11px;color:#98a2b3;margin-top:6px}.card-message{font-size:12px;color:#475467;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:6px}.status-pill,.new-pill{border-radius:999px;padding:3px 7px;font-size:10px;white-space:nowrap}.status-pill{background:#f2f4f7;color:#475467}.new-pill{background:#fff1f3;color:#c01048}.pool-card,.inquiry-card{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center}.card-action{min-height:44px;border:0;border-radius:9px;background:#edf7f4;color:#08745d;font-weight:700;padding:7px 10px;white-space:normal;max-width:100px}.inquiry-main{border:0;background:transparent;text-align:left;min-width:0;color:#1d2939;padding:1px}.inquiry-main:disabled{color:#1d2939}.inquiry-main .card-top,.inquiry-main .card-meta{display:flex}.inquiry-main strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.inquiry-main p{margin:6px 0 0;font-size:12px;color:#475467;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        @media(max-width:1080px){.sales-shell{grid-template-columns:minmax(180px,220px) minmax(0,1fr)}.detail-column{grid-column:1/-1;min-height:auto}.detail-scroll{height:auto}.customer-list{max-height:620px}}
        @media(max-width:720px){.sales-page{padding:10px}.sales-header{align-items:flex-start;display:grid}.header-actions{justify-content:flex-start}.language-switch{width:100%;display:grid;grid-template-columns:repeat(3,1fr)}.language-switch button{min-height:44px}.refresh-button{min-height:44px}.sales-shell{display:grid;grid-template-columns:minmax(0,1fr);gap:10px}.column-surface{min-height:auto;border-radius:13px}.queue-column{gap:14px}.summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.queue-nav{grid-template-columns:repeat(2,minmax(0,1fr))}.queue-nav button{min-height:50px}.customer-list{max-height:none;overflow:visible}.detail-column{grid-column:auto}.detail-scroll{height:auto}.thread{max-height:420px}.reply-box{grid-template-columns:minmax(0,1fr)}.reply-box button{min-height:48px}.title-block h1{font-size:21px}.pool-card,.inquiry-card{grid-template-columns:minmax(0,1fr)}.card-action{max-width:none;width:100%}}
        @media(max-width:360px){.sales-page{padding:7px}.queue-column,.list-column{padding:11px}.summary-grid{gap:5px}.language-switch button{padding:0 6px;font-size:12px}.queue-nav{grid-template-columns:minmax(0,1fr)}.header-actions{width:100%}}
      `}</style>
    </main>
  )
}

function LeadCard({ lead, active, t, lang, onSelect }: { lead: Lead; active: boolean; t: (key: string) => string; lang: Lang; onSelect: () => void }) {
  return <button type="button" className={`card ${active ? 'active' : ''}`} onClick={onSelect}>
    <div className="card-top"><strong>{lead.storeName}</strong>{lead.conversation?.hasNewMessage ? <span className="new-pill">{t('salesWorkspace.hasNewMessage')}</span> : <span className="status-pill">{leadStatusLabel(lead.status, t)}</span>}</div>
    <div className="card-contact"><span>{lead.ownerName}</span><span>·</span><span>{lead.phone}</span></div>
    <div className="card-meta"><span>{lead.source}</span><span>{formatDate(lead.conversation?.lastAt ?? lead.lastActivityAt, lang)}</span></div>
  </button>
}

function UnassignedCard({ lead, t, lang, busy, onClaim }: { lead: UnassignedLead; t: (key: string) => string; lang: Lang; busy: boolean; onClaim: () => void }) {
  return <div className="card pool-card">
    <div><div className="card-top"><strong>{lead.storeName}</strong><span className="status-pill">{t('salesWorkspace.unassignedLead')}</span></div><div className="card-meta"><span>{lead.source}</span><span>{formatDate(lead.lastActivityAt, lang)}</span></div><div className="card-message">{t('salesWorkspace.limitedSummary')}</div></div>
    <button type="button" disabled={busy} className="card-action" onClick={onClaim}>{t('salesWorkspace.claimLead')}</button>
  </div>
}

function InquiryCard({ inquiry, active, t, lang, role, busy, onSelect, onClaim }: { inquiry: Inquiry; active: boolean; t: (key: string) => string; lang: Lang; role: string; busy: boolean; onSelect: () => void; onClaim: () => void }) {
  return <div className={`card inquiry-card ${active ? 'active' : ''}`}>
    <button type="button" className="inquiry-main" disabled={role === 'BD' && !inquiry.ownedByMe} onClick={onSelect}>
      <div className="card-top"><strong>{inquiry.senderName || t('salesWorkspace.customer')}</strong>{inquiry.hasNewMessage && <span className="new-pill">{t('salesWorkspace.hasNewMessage')}</span>}</div>
      <p>{inquiry.latestMessage}</p>
      <div className="card-meta"><span>{inquiry.claimed ? t('salesWorkspace.claimed') : t('salesWorkspace.unclaimed')}</span><span>{formatDate(inquiry.lastAt, lang)}</span></div>
    </button>
    {!inquiry.claimed && <button type="button" disabled={busy} className="card-action" onClick={onClaim}>{t('salesWorkspace.claimInquiry')}</button>}
  </div>
}

function LeadDetail({ lead, t, lang, busy, copyState, onCopy, onReply, onStatus }: { lead: Lead; t: (key: string) => string; lang: Lang; busy: boolean; copyState: 'idle' | 'copied'; onCopy: () => void; onReply: () => void; onStatus: (status: 'NEW' | 'FOLLOWING' | 'LOST') => void }) {
  return <div className="detail-card">
    <div className="detail-heading"><div><span>{t('salesWorkspace.customerDetail')}</span><h2>{lead.storeName}</h2><p>{lead.ownerName} · {lead.phone}</p></div><span className="detail-status">{leadStatusLabel(lead.status, t)}</span></div>
    <div className="quick-actions"><a href={`tel:${lead.phone}`}>☎ {t('salesWorkspace.call')}</a><button type="button" onClick={onCopy}>⧉ {copyState === 'copied' ? t('salesWorkspace.copied') : t('salesWorkspace.copyPhone')}</button><button type="button" onClick={onReply}>➤ {t('salesWorkspace.replyTelegram')}</button></div>
    <DetailSection title={t('salesWorkspace.contactInfo')} rows={[
      [t('salesWorkspace.storeName'), lead.storeName],
      [t('salesWorkspace.ownerName'), lead.ownerName],
      [t('salesWorkspace.phone'), lead.phone],
      [t('salesWorkspace.telegramName'), lead.telegramDisplayName || t('salesWorkspace.notAvailable')],
      [t('salesWorkspace.telegramUsername'), lead.telegramUsername ? `@${lead.telegramUsername}` : `${t('salesWorkspace.noTelegramUsername')} · ${t('salesWorkspace.telegramConnected')}`],
    ]} />
    <DetailSection title={t('salesWorkspace.attribution')} rows={[
      [t('salesWorkspace.source'), lead.source],
      [t('salesWorkspace.campaign'), lead.campaign || t('salesWorkspace.notAvailable')],
      [t('salesWorkspace.currentOwner'), lead.salesOwner?.name || t('salesWorkspace.unassigned')],
    ]} />
    <DetailSection title={t('salesWorkspace.application')} rows={[
      [t('salesWorkspace.leadStatus'), leadStatusLabel(lead.status, t)],
      [t('salesWorkspace.applicationStatus'), applicationStatusLabel(lead.applicationStatus, t)],
      [t('salesWorkspace.lastActivity'), formatDate(lead.lastActivityAt, lang)],
      [t('salesWorkspace.lastContact'), lead.conversation ? formatDate(lead.conversation.lastAt, lang) : t('salesWorkspace.noConversation')],
    ]} />
    <div className="status-actions">{(['NEW', 'FOLLOWING', 'LOST'] as const).map((status) => <button key={status} type="button" disabled={busy || ['APPLIED', 'ACTIVATED'].includes(lead.status)} onClick={() => onStatus(status)}>{leadStatusLabel(status, t)}</button>)}</div>
    <style jsx global>{detailStyles}</style>
  </div>
}

function InquiryDetail({ inquiry, t, lang, onReply }: { inquiry: Inquiry; t: (key: string) => string; lang: Lang; onReply: () => void }) {
  return <div className="detail-card">
    <div className="detail-heading"><div><span>{t('salesWorkspace.customerDetail')}</span><h2>{inquiry.senderName || t('salesWorkspace.customer')}</h2><p>{t('salesWorkspace.telegramConnected')}</p></div><span className="detail-status">{t('salesWorkspace.unlinkedStatus')}</span></div>
    <div className="quick-actions"><button type="button" onClick={onReply}>➤ {t('salesWorkspace.replyTelegram')}</button></div>
    <DetailSection title={t('salesWorkspace.contactInfo')} rows={[
      [t('salesWorkspace.telegramName'), inquiry.senderName || t('salesWorkspace.notAvailable')],
      [t('salesWorkspace.telegramUsername'), inquiry.senderUsername ? `@${inquiry.senderUsername}` : t('salesWorkspace.noTelegramUsername')],
      [t('salesWorkspace.source'), t('salesWorkspace.onboardingSource')],
      [t('salesWorkspace.currentOwner'), inquiry.owner?.name || t('salesWorkspace.unassigned')],
      [t('salesWorkspace.lastContact'), formatDate(inquiry.lastAt, lang)],
      [t('salesWorkspace.leadStatus'), t('salesWorkspace.unlinkedStatus')],
    ]} />
    <style jsx global>{detailStyles}</style>
  </div>
}

function DetailSection({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return <section className="detail-section"><h3>{title}</h3><dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>
}

const detailStyles = `
  .detail-card{padding:16px}.detail-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding-bottom:13px}.detail-heading>div>span{font-size:11px;color:#98a2b3;text-transform:uppercase;letter-spacing:.07em}.detail-heading h2{font-size:21px;margin:5px 0 3px}.detail-heading p{margin:0;color:#667085;font-size:13px}.detail-status{background:#f2f4f7;color:#475467;border-radius:999px;padding:5px 9px;font-size:11px;white-space:nowrap}.quick-actions{display:flex;flex-wrap:wrap;gap:7px;padding:0 0 14px}.quick-actions a,.quick-actions button{min-height:44px;border:1px solid #d0d5dd;background:#fff;border-radius:9px;padding:8px 11px;color:#344054;text-decoration:none;font:600 12px/1.2 inherit;display:flex;align-items:center}.detail-section{border-top:1px solid #eaecf0;padding:13px 0 4px}.detail-section h3{font-size:12px;color:#667085;margin:0 0 8px}.detail-section dl{margin:0;display:grid;grid-template-columns:1fr 1fr;column-gap:18px}.detail-section dl>div{display:grid;gap:3px;padding:7px 0;min-width:0}.detail-section dt{font-size:11px;color:#98a2b3}.detail-section dd{margin:0;font-size:13px;color:#1d2939;overflow-wrap:anywhere}.status-actions{border-top:1px solid #eaecf0;padding-top:12px;display:flex;flex-wrap:wrap;gap:7px}.status-actions button{min-height:40px;border:1px solid #d0d5dd;border-radius:9px;background:#fff;padding:7px 11px;color:#344054}.status-actions button:disabled{opacity:.45}@media(max-width:420px){.detail-card{padding:13px}.detail-heading{display:grid}.detail-section dl{grid-template-columns:minmax(0,1fr)}.quick-actions>*{flex:1;justify-content:center;min-width:120px}}
`

function itemTime(item: WorkspaceItem): number {
  if (item.kind === 'lead') return new Date(item.value.conversation?.lastAt ?? item.value.lastActivityAt).getTime()
  if (item.kind === 'unassigned') return new Date(item.value.lastActivityAt).getTime()
  return new Date(item.value.lastAt).getTime()
}

function formatDate(value: string, lang: Lang): string {
  const locale = lang === 'km' ? 'km-KH' : lang === 'en' ? 'en-US' : 'zh-CN'
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function leadStatusLabel(status: string, t: (key: string) => string): string {
  const key: Record<string, string> = {
    NEW: 'statusNew', WAITING_TELEGRAM: 'statusWaitingTelegram', FOLLOWING: 'statusFollowing',
    APPLIED: 'statusApplied', ACTIVATED: 'statusActivated', LOST: 'statusLost',
  }
  return t(`salesWorkspace.${key[status] ?? 'statusNew'}`)
}

function applicationStatusLabel(status: string, t: (key: string) => string): string {
  const key: Record<string, string> = {
    NOT_APPLIED: 'applicationNotApplied', PENDING: 'applicationPending',
    REJECTED: 'applicationRejected', APPROVED: 'applicationApproved',
  }
  return t(`salesWorkspace.${key[status] ?? 'applicationNotApplied'}`)
}
