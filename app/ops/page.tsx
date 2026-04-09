'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { apiFetch, OWNER_CTX } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

type StoreApplicationRow = {
  id: string
  storeName: string
  ownerName: string
  telegramId: string
  telegramUsername: string | null
  status: string
  createdAt: string
}

type ConversationRow = {
  telegramId: string
  senderName: string | null
  tenantId: string | null
  lastMessage: string
  lastAt: string
  messageCount: number
  sessionState: string | null  // auto_active | awaiting_human | human_active | null
}

type ThreadMessage = {
  id: string
  sentBy: string
  senderName: string | null
  content: string
  messageType: string
  status: string
  errorMessage: string | null
  createdAt: string
}

type TenantRow = {
  id: string
  name: string
  status: string
  tier: string
  createdAt: string
  storeCount: number
  ownerBound: number
  ownerTotal: number
  staffBound: number
  staffTotal: number
  todaySaleCount: number
  lastActiveAt: string | null
}

const TIER_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  LITE:        { label: '轻试用版',     color: '#389e0d', bg: '#f6ffed', border: '#b7eb8f' },
  STANDARD:    { label: '标准收银版',   color: '#1677ff', bg: '#e6f4ff', border: '#91caff' },
  MULTI_STORE: { label: '门店标准化版', color: '#722ed1', bg: '#f9f0ff', border: '#d3adf7' },
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type StatusFilter = 'ACTIVE' | 'ARCHIVED' | 'all'

export default function OpsPage() {
  const [authState, setAuthState] = useState<'checking' | 'ok' | 'denied'>('checking')
  const [tenants, setTenants] = useState<TenantRow[]>([])
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ACTIVE')
  const [opsRole, setOpsRole] = useState<string>('')
  const [applications, setApplications] = useState<StoreApplicationRow[]>([])
  const [conversations, setConversations] = useState<ConversationRow[]>([])

  // ── Auth check ─────────────────────────────────────────────────────────────
  useEffect(() => {
    apiFetch('/api/ops/check', undefined, OWNER_CTX)
      .then(async (r) => {
        if (r.ok) {
          const data = await r.json()
          setOpsRole(data.opsRole ?? '')
          setAuthState('ok')
        } else {
          setAuthState('denied')
        }
      })
      .catch(() => setAuthState('denied'))
  }, [])

  // ── Load tenants ───────────────────────────────────────────────────────────
  async function loadTenants(filter: StatusFilter = statusFilter) {
    setLoading(true)
    try {
      const url = filter === 'ACTIVE' ? '/api/ops/tenants' : `/api/ops/tenants?status=${filter}`
      const r = await apiFetch(url, undefined, OWNER_CTX)
      if (r.ok) setTenants(await r.json())
    } finally {
      setLoading(false)
    }
  }

  function applyFilter(f: StatusFilter) {
    setStatusFilter(f)
    loadTenants(f)
  }

  function loadApplications() {
    apiFetch('/api/ops/applications', undefined, OWNER_CTX)
      .then((r) => (r.ok ? r.json() : []))
      .then(setApplications)
      .catch(() => {})
  }

  function loadConversations() {
    apiFetch('/api/ops/conversations', undefined, OWNER_CTX)
      .then((r) => (r.ok ? r.json() : []))
      .then(setConversations)
      .catch(() => {})
  }

  useEffect(() => {
    if (authState === 'ok') {
      loadTenants()
      loadApplications()
      loadConversations()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState])

  // ─── Render: checking / denied ─────────────────────────────────────────────
  if (authState === 'checking') {
    return (
      <div style={s.center}>
        <div style={s.spinner} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    )
  }
  if (authState === 'denied') {
    return (
      <div style={s.center}>
        <div style={{ fontSize: 40 }}>⛔</div>
        <p style={{ color: '#ff4d4f', fontWeight: 600 }}>无权限访问内部后台</p>
        <Link href="/dashboard" style={s.backLink}>← 返回概览</Link>
      </div>
    )
  }

  // ─── Render: main ──────────────────────────────────────────────────────────
  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <div style={s.headerTitle}>🔧 内部运营后台</div>
          <div style={s.headerSub}>{tenants.length} 个商户</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {opsRole === 'SUPER_ADMIN' && (
            <Link href="/ops/admins" style={s.sysLink}>管理员</Link>
          )}
          <Link href="/system" style={s.sysLink}>系统自检</Link>
          <button style={s.createBtn} onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? '取消' : '+ 新增商户'}
          </button>
        </div>
      </div>

      <div style={s.body}>

        {/* ── Status filter tabs ── */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {([
            { key: 'ACTIVE',   label: '运营中' },
            { key: 'ARCHIVED', label: '已归档' },
            { key: 'all',      label: '全部' },
          ] as { key: StatusFilter; label: string }[]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => applyFilter(key)}
              style={{
                height: 30, padding: '0 14px', fontSize: 12, fontWeight: statusFilter === key ? 700 : 400,
                border: `1.5px solid ${statusFilter === key ? '#1677ff' : '#e8e8e8'}`,
                borderRadius: 20, cursor: 'pointer',
                background: statusFilter === key ? '#e6f4ff' : '#fff',
                color: statusFilter === key ? '#1677ff' : '#888',
              }}
            >{label}</button>
          ))}
        </div>

        {/* ── Store applications ── */}
        {applications.length > 0 && (
          <ApplicationsSection
            applications={applications}
            onApproved={() => { loadApplications(); loadTenants() }}
          />
        )}

        {/* ── Broadcast ── */}
        <BroadcastSection tenants={tenants} />

        {/* ── Customer conversations ── */}
        <ConversationsSection conversations={conversations} onRefresh={loadConversations} />

        {/* ── Create form ── */}
        {showCreate && (
          <CreateForm
            onCreated={(id) => { setShowCreate(false); loadTenants(); window.location.href = `/ops/${id}` }}
            onCancel={() => setShowCreate(false)}
          />
        )}

        {/* ── Tenant list ── */}
        {loading && tenants.length === 0 ? (
          <div style={s.emptyHint}>加载中…</div>
        ) : tenants.length === 0 ? (
          <div style={s.emptyHint}>暂无商户，点击「新增商户」创建第一个。</div>
        ) : (
          tenants.map((t) => <TenantCard key={t.id} tenant={t} />)
        )}

      </div>
    </div>
  )
}

// ─── TenantCard ───────────────────────────────────────────────────────────────

function TenantCard({ tenant: t }: { tenant: TenantRow }) {
  const active = t.status === 'ACTIVE'
  const lastActive = t.lastActiveAt
    ? new Date(t.lastActiveAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '无记录'

  return (
    <Link href={`/ops/${t.id}`} style={s.card}>
      <div style={s.cardTop}>
        <div style={s.cardName}>{t.name}</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {(() => { const tm = TIER_META[t.tier] ?? TIER_META.LITE; return (
            <span style={{ ...s.statusBadge, background: tm.bg, color: tm.color, borderColor: tm.border }}>{tm.label}</span>
          )})()}
          <span style={active ? { ...s.statusBadge, background: '#f6ffed', color: '#52c41a', borderColor: '#b7eb8f' } : { ...s.statusBadge, background: '#fff1f0', color: '#ff4d4f', borderColor: '#ffa39e' }}>
            {active ? '运营中' : '已归档'}
          </span>
        </div>
      </div>
      <div style={s.cardId}>ID: {t.id.slice(0, 16)}…</div>

      <div style={s.statsRow}>
        <StatPill icon="🏪" label="门店" value={String(t.storeCount)} />
        <StatPill icon="👑" label="老板" value={`${t.ownerBound}/${t.ownerTotal}`} color={t.ownerBound === t.ownerTotal && t.ownerTotal > 0 ? '#52c41a' : '#fa8c16'} />
        <StatPill icon="👤" label="员工" value={`${t.staffBound}/${t.staffTotal}`} />
        <StatPill icon="📦" label="今日单" value={String(t.todaySaleCount)} color={t.todaySaleCount > 0 ? '#1677ff' : undefined} />
      </div>

      <div style={s.cardFooter}>
        <span style={s.cardMeta}>最近活跃：{lastActive}</span>
        <span style={s.cardArrow}>查看详情 →</span>
      </div>
    </Link>
  )
}

function StatPill({ icon, label, value, color }: { icon: string; label: string; value: string; color?: string }) {
  return (
    <div style={s.statPill}>
      <span style={s.statIcon}>{icon}</span>
      <span style={s.statLabel}>{label}</span>
      <span style={{ ...s.statValue, color: color ?? '#333' }}>{value}</span>
    </div>
  )
}

// ─── BroadcastSection ────────────────────────────────────────────────────────

type BroadcastScope = 'ALL_OWNERS' | 'ALL_STAFF' | 'TENANT_MEMBERS'

type BroadcastResult = {
  total: number
  success: number
  failed: number
  errors: { displayName: string; telegramId: string; error: string }[]
}

const SCOPE_OPTIONS: { value: BroadcastScope; label: string; desc: string }[] = [
  { value: 'ALL_OWNERS', label: '全部老板', desc: '所有已绑定的 OWNER 账号' },
  { value: 'ALL_STAFF',  label: '全部员工', desc: '所有已绑定的 STAFF 账号' },
  { value: 'TENANT_MEMBERS', label: '指定商户', desc: '某个商户下全部已绑定成员' },
]

function BroadcastSection({ tenants }: { tenants: TenantRow[] }) {
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<BroadcastScope>('ALL_OWNERS')
  const [tenantId, setTenantId] = useState('')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<BroadcastResult | null>(null)
  const [sendError, setSendError] = useState('')

  const activeTenants = tenants.filter((t) => t.status === 'ACTIVE')

  async function send() {
    if (!text.trim()) { setSendError('请输入消息内容'); return }
    if (scope === 'TENANT_MEMBERS' && !tenantId) { setSendError('请选择目标商户'); return }
    setSending(true)
    setSendError('')
    setResult(null)
    try {
      const r = await apiFetch('/api/ops/broadcast', {
        method: 'POST',
        body: JSON.stringify({ scope, tenantId: scope === 'TENANT_MEMBERS' ? tenantId : undefined, text }),
      }, OWNER_CTX)
      const body = await r.json()
      if (r.ok && body.ok) {
        setResult(body)
        setText('')
      } else {
        setSendError(body.message ?? body.error ?? '发送失败')
      }
    } catch {
      setSendError('网络错误，请重试')
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{ ...s.appSection, border: '1.5px solid #722ed122', marginBottom: 12 }}>
      {/* 标题栏 */}
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
        onClick={() => { setOpen((v) => !v); setResult(null); setSendError('') }}
      >
        <div style={{ ...s.appSectionTitle, color: '#722ed1', margin: 0 }}>
          📣 广播发送
        </div>
        <span style={{ fontSize: 12, color: '#aaa' }}>{open ? '收起 ↑' : '展开 ↓'}</span>
      </div>

      {open && (
        <div style={{ marginTop: 14 }}>
          {/* 发送范围 */}
          <div style={s.fieldLabel}>发送范围</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            {SCOPE_OPTIONS.map(({ value, label, desc }) => (
              <button
                key={value}
                onClick={() => { setScope(value); setTenantId('') }}
                title={desc}
                style={{
                  height: 32, padding: '0 14px', fontSize: 12, cursor: 'pointer', borderRadius: 6,
                  fontWeight: scope === value ? 700 : 400,
                  border: `1.5px solid ${scope === value ? '#722ed1' : '#e8e8e8'}`,
                  background: scope === value ? '#f9f0ff' : '#f5f5f5',
                  color: scope === value ? '#722ed1' : '#888',
                }}
              >{label}</button>
            ))}
          </div>

          {/* 商户选择（仅 TENANT_MEMBERS） */}
          {scope === 'TENANT_MEMBERS' && (
            <div style={{ marginTop: 10 }}>
              <div style={s.fieldLabel}>目标商户</div>
              <select
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                style={{ ...s.fieldInput, marginTop: 6, height: 38, cursor: 'pointer' }}
              >
                <option value="">请选择商户…</option>
                {activeTenants.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* 消息内容 */}
          <div style={{ marginTop: 10 }}>
            <div style={s.fieldLabel}>消息内容（文本）</div>
            <textarea
              style={{ ...s.replyArea, marginTop: 6, height: 100 }}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="请输入要群发的消息内容…"
            />
            <div style={{ fontSize: 11, color: '#bbb', marginTop: 3, textAlign: 'right' }}>
              {text.length} 字
            </div>
          </div>

          {/* 错误提示 */}
          {sendError && (
            <div style={{ fontSize: 12, color: '#ff4d4f', marginTop: 6 }}>{sendError}</div>
          )}

          {/* 发送结果 */}
          {result && (
            <div style={{ marginTop: 10, padding: '10px 12px', background: '#f6ffed', borderRadius: 8, border: '1px solid #b7eb8f' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#389e0d', marginBottom: 6 }}>
                发送完成 — 共 {result.total} 人，成功 {result.success}，失败 {result.failed}
              </div>
              {result.errors.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, color: '#ff4d4f', marginBottom: 4 }}>失败详情：</div>
                  {result.errors.map((e, i) => (
                    <div key={i} style={{ fontSize: 11, color: '#ff4d4f', marginBottom: 2 }}>
                      · {e.displayName}（{e.telegramId}）：{e.error}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 发送按钮 */}
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
            <button
              style={{
                height: 36, padding: '0 20px', background: '#722ed1', color: '#fff',
                border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600,
                cursor: (!text.trim() || sending) ? 'not-allowed' : 'pointer',
                opacity: (!text.trim() || sending) ? 0.5 : 1,
              }}
              disabled={!text.trim() || sending}
              onClick={send}
            >
              {sending ? '发送中…' : '群发消息'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── ConversationsSection ────────────────────────────────────────────────────

function ConversationsSection({
  conversations,
  onRefresh,
}: {
  conversations: ConversationRow[]
  onRefresh: () => void
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [thread, setThread] = useState<ThreadMessage[]>([])
  const [loadingThread, setLoadingThread] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [takingOver, setTakingOver] = useState(false)
  const [takeoverDone, setTakeoverDone] = useState<Set<string>>(new Set())

  async function openConversation(telegramId: string) {
    setSelected(telegramId)
    setReplyText('')
    setSendError('')
    setLoadingThread(true)
    try {
      const r = await apiFetch(`/api/ops/conversations/${telegramId}`, undefined, OWNER_CTX)
      if (r.ok) setThread(await r.json())
    } finally {
      setLoadingThread(false)
    }
  }

  async function takeover(telegramId: string) {
    if (takingOver) return
    setTakingOver(true)
    try {
      const r = await apiFetch(`/api/ops/support/${telegramId}/takeover`, { method: 'POST' }, OWNER_CTX)
      if (r.ok) {
        setTakeoverDone((prev) => new Set([...prev, telegramId]))
        onRefresh()
      }
    } catch { /* ignore */ } finally {
      setTakingOver(false)
    }
  }

  async function sendReply(conv: ConversationRow) {
    if (!replyText.trim() || sending) return
    setSending(true)
    setSendError('')
    try {
      const r = await apiFetch('/api/ops/messages', {
        method: 'POST',
        body: JSON.stringify({
          recipientTelegramId: conv.telegramId,
          text: replyText.trim(),
          ...(conv.tenantId ? { tenantId: conv.tenantId } : {}),
        }),
      }, OWNER_CTX)
      const body = await r.json()
      if (r.ok && body.ok) {
        setReplyText('')
        // 重新拉线程
        const r2 = await apiFetch(`/api/ops/conversations/${conv.telegramId}`, undefined, OWNER_CTX)
        if (r2.ok) setThread(await r2.json())
      } else {
        setSendError(body.message ?? body.error ?? '发送失败')
      }
    } catch {
      setSendError('网络错误，请重试')
    } finally {
      setSending(false)
    }
  }

  const selectedConv = conversations.find((c) => c.telegramId === selected) ?? null

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })

  return (
    <div style={{ ...s.appSection, border: '1.5px solid #1677ff22', marginBottom: 12 }}>
      {/* 区块标题 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ ...s.appSectionTitle, color: '#1677ff', margin: 0 }}>
          💬 客户会话
          {conversations.length > 0 && (
            <span style={{ ...s.appBadge, background: '#1677ff' }}>{conversations.length}</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {selected && (
            <button
              onClick={() => { setSelected(null); setThread([]) }}
              style={{ fontSize: 12, color: '#888', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              ← 返回列表
            </button>
          )}
          <button
            onClick={() => { onRefresh(); if (selected) openConversation(selected) }}
            style={{ fontSize: 12, color: '#1677ff', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            刷新
          </button>
        </div>
      </div>

      {/* 会话列表 */}
      {!selected && (
        <>
          {conversations.length === 0 ? (
            <div style={{ fontSize: 13, color: '#ccc', textAlign: 'center', padding: '12px 0' }}>
              暂无客户消息
            </div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.telegramId}
                onClick={() => openConversation(conv.telegramId)}
                style={s.convRow}
              >
                <div style={s.convAvatar}>
                  {(conv.senderName ?? conv.telegramId).slice(0, 1).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={s.convName}>{conv.senderName ?? conv.telegramId}</span>
                    <span style={s.convTime}>{fmtTime(conv.lastAt)}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    <div style={s.convPreview}>
                      {conv.lastMessage.length > 40 ? conv.lastMessage.slice(0, 40) + '…' : conv.lastMessage}
                    </div>
                    {conv.sessionState === 'awaiting_human' && (
                      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10, background: '#fff7e6', color: '#fa8c16', border: '1px solid #ffd591', whiteSpace: 'nowrap' }}>等待接管</span>
                    )}
                    {conv.sessionState === 'human_active' && (
                      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10, background: '#f6ffed', color: '#52c41a', border: '1px solid #b7eb8f', whiteSpace: 'nowrap' }}>人工中</span>
                    )}
                  </div>
                  {conv.tenantId && (
                    <div style={{ fontSize: 10, color: '#ccc', marginTop: 1 }}>
                      商户 {conv.tenantId.slice(0, 10)}…
                    </div>
                  )}
                </div>
                <div style={s.convCount}>{conv.messageCount}</div>
              </div>
            ))
          )}
        </>
      )}

      {/* 会话详情 + 回复 */}
      {selected && selectedConv && (
        <div>
          {/* 客户名称 + 接管按钮 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid #f0f0f0' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>
              {selectedConv.senderName ?? selectedConv.telegramId}
              <span style={{ fontSize: 11, color: '#bbb', marginLeft: 8, fontWeight: 400 }}>
                TG: {selectedConv.telegramId}
              </span>
              {(selectedConv.sessionState === 'human_active' || takeoverDone.has(selectedConv.telegramId)) && (
                <span style={{ fontSize: 10, marginLeft: 8, padding: '1px 6px', borderRadius: 10, background: '#f6ffed', color: '#52c41a', border: '1px solid #b7eb8f' }}>人工接管中</span>
              )}
              {selectedConv.sessionState === 'awaiting_human' && !takeoverDone.has(selectedConv.telegramId) && (
                <span style={{ fontSize: 10, marginLeft: 8, padding: '1px 6px', borderRadius: 10, background: '#fff7e6', color: '#fa8c16', border: '1px solid #ffd591' }}>等待接管</span>
              )}
            </div>
            {selectedConv.sessionState !== 'human_active' && !takeoverDone.has(selectedConv.telegramId) && (
              <button
                onClick={() => takeover(selectedConv.telegramId)}
                disabled={takingOver}
                style={{
                  height: 28, padding: '0 12px', fontSize: 11, fontWeight: 600,
                  background: '#1677ff', color: '#fff', border: 'none', borderRadius: 6,
                  cursor: takingOver ? 'not-allowed' : 'pointer',
                  opacity: takingOver ? 0.6 : 1,
                }}
              >
                {takingOver ? '接管中…' : '人工接管'}
              </button>
            )}
          </div>

          {/* 消息气泡区 */}
          <div style={s.threadBox}>
            {loadingThread ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={s.spinner} />
                <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
              </div>
            ) : thread.length === 0 ? (
              <div style={{ fontSize: 12, color: '#ccc', textAlign: 'center', padding: '16px 0' }}>暂无记录</div>
            ) : (
              thread.map((msg) => {
                const isOps = msg.sentBy === 'OPS' || msg.sentBy === 'SYSTEM'
                return (
                  <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isOps ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
                    <div style={{ ...s.bubble, ...(isOps ? s.bubbleOps : s.bubbleCustomer) }}>
                      {msg.content}
                    </div>
                    <div style={{ fontSize: 10, color: '#ccc', marginTop: 2 }}>
                      {fmtTime(msg.createdAt)}
                      {isOps && msg.status === 'FAILED' && (
                        <span style={{ color: '#ff4d4f', marginLeft: 4 }}>✕ 发送失败</span>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* 回复输入区 */}
          <div style={{ marginTop: 10 }}>
            <textarea
              style={s.replyArea}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="输入回复内容…"
              rows={3}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendReply(selectedConv)
              }}
            />
            {sendError && (
              <div style={{ fontSize: 12, color: '#ff4d4f', marginTop: 4 }}>{sendError}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
              <button
                style={{ ...s.sendBtn, opacity: (!replyText.trim() || sending) ? 0.5 : 1 }}
                disabled={!replyText.trim() || sending}
                onClick={() => sendReply(selectedConv)}
              >
                {sending ? '发送中…' : '发送 (Ctrl+Enter)'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── ApplicationsSection ─────────────────────────────────────────────────────

function ApplicationsSection({
  applications,
  onApproved,
}: {
  applications: StoreApplicationRow[]
  onApproved: () => void
}) {
  const [approving, setApproving] = useState<string | null>(null)
  // approved: id → { notified: boolean }
  const [approved, setApproved] = useState<Record<string, { notified: boolean }>>({})
  const [sending, setSending] = useState<string | null>(null)
  const [sendResult, setSendResult] = useState<Record<string, 'sent' | string>>({})

  async function approve(id: string) {
    setApproving(id)
    try {
      const r = await apiFetch(`/api/ops/applications/${id}/approve`, { method: 'POST' }, OWNER_CTX)
      const body = await r.json()
      if (r.ok && body.ok) {
        setApproved((prev) => ({ ...prev, [id]: { notified: !!body.notified } }))
        onApproved()
      } else {
        window.alert(body.message ?? body.error ?? '审核失败')
      }
    } catch {
      window.alert('网络错误')
    } finally {
      setApproving(null)
    }
  }

  async function resendNotify(id: string) {
    setSending(id)
    setSendResult((prev) => { const n = { ...prev }; delete n[id]; return n })
    try {
      const r = await apiFetch(`/api/ops/applications/${id}/notify`, { method: 'POST' }, OWNER_CTX)
      const body = await r.json()
      if (r.ok && body.ok) {
        setSendResult((prev) => ({ ...prev, [id]: 'sent' }))
      } else {
        setSendResult((prev) => ({ ...prev, [id]: body.message ?? body.error ?? '发送失败' }))
      }
    } catch {
      setSendResult((prev) => ({ ...prev, [id]: '网络错误，请重试' }))
    } finally {
      setSending(null)
    }
  }

  return (
    <div style={s.appSection}>
      <div style={s.appSectionTitle}>
        📋 开店申请
        <span style={s.appBadge}>{applications.length}</span>
      </div>
      {applications.map((app) => (
        <div key={app.id} style={s.appRow}>
          <div style={s.appInfo}>
            <div style={s.appStoreName}>{app.storeName}</div>
            <div style={s.appMeta}>
              {app.ownerName}
              {app.telegramUsername ? ` · @${app.telegramUsername}` : ` · ID:${app.telegramId}`}
              {' · '}
              {new Date(app.createdAt).toLocaleString('zh-CN', {
                month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
              })}
            </div>
            {approved[app.id] && (
              <div style={{ fontSize: 12, marginTop: 4, color: approved[app.id].notified ? '#52c41a' : '#fa8c16' }}>
                {approved[app.id].notified ? '✓ 已通过，通知已发送' : '✓ 已通过（通知发送失败，请手动补发）'}
              </div>
            )}
            {sendResult[app.id] && (
              <div style={{
                fontSize: 12, marginTop: 2,
                color: sendResult[app.id] === 'sent' ? '#52c41a' : '#ff4d4f',
              }}>
                {sendResult[app.id] === 'sent' ? '✓ 通知已重新发送' : `✕ ${sendResult[app.id]}`}
              </div>
            )}
          </div>
          {!approved[app.id] && (
            <button
              style={{ ...s.approveBtn, opacity: approving === app.id ? 0.6 : 1 }}
              disabled={approving === app.id}
              onClick={() => approve(app.id)}
            >
              {approving === app.id ? '处理中…' : '通过'}
            </button>
          )}
          {approved[app.id] && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
              <span style={s.approvedTag}>✓ 已通过</span>
              <button
                style={{ ...s.sendBtn, opacity: sending === app.id ? 0.6 : 1 }}
                disabled={sending === app.id}
                onClick={() => resendNotify(app.id)}
              >
                {sending === app.id ? '发送中…' : '重新发送通知'}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── CreateForm ───────────────────────────────────────────────────────────────

const TIER_OPTIONS = [
  { value: 'LITE',        label: '轻试用版' },
  { value: 'STANDARD',    label: '标准收银版' },
  { value: 'MULTI_STORE', label: '门店标准化版' },
]

function CreateForm({ onCreated, onCancel }: { onCreated: (tenantId: string) => void; onCancel: () => void }) {
  const [form, setForm] = useState({ tenantName: '', storeName: '', tier: 'LITE' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function set(k: keyof typeof form, v: string) { setForm((f) => ({ ...f, [k]: v })) }

  async function submit() {
    if (!form.tenantName.trim()) {
      setError('请填写商户名')
      return
    }
    if (!form.storeName.trim()) {
      setError('请填写门店名')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const r = await apiFetch('/api/ops/tenants', {
        method: 'POST',
        body: JSON.stringify(form),
      }, OWNER_CTX)
      const body = await r.json()
      if (r.ok) onCreated(body.tenantId)
      else setError(body.message ?? body.error ?? '创建失败')
    } catch {
      setError('网络错误，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={s.createForm}>
      <div style={s.formTitle}>新增商户</div>
      <div style={s.formGrid}>
        <Field label="商户名 *" value={form.tenantName} onChange={(v) => set('tenantName', v)} placeholder="张记超市" />
        <Field label="门店名 *" value={form.storeName} onChange={(v) => set('storeName', v)} placeholder="请输入门店名称 / សូមបញ្ចូលឈ្មោះហាង" />
      </div>
      <div style={{ marginTop: 12 }}>
        <div style={s.fieldLabel}>产品档次</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          {TIER_OPTIONS.map(({ value, label }) => {
            const tm = TIER_META[value]
            const active = form.tier === value
            return (
              <button
                key={value}
                type="button"
                onClick={() => set('tier', value)}
                style={{
                  flex: 1, height: 34, border: `1.5px solid ${active ? tm.border : '#e8e8e8'}`,
                  borderRadius: 6, fontSize: 12, fontWeight: active ? 700 : 400,
                  background: active ? tm.bg : '#f5f5f5', color: active ? tm.color : '#888',
                  cursor: 'pointer',
                }}
              >{label}</button>
            )
          })}
        </div>
      </div>
      {error && <div style={s.errorMsg}>{error}</div>}
      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <button style={s.cancelBtn} onClick={onCancel}>取消</button>
        <button style={{ ...s.submitFormBtn, opacity: submitting ? 0.7 : 1 }} disabled={submitting} onClick={submit}>
          {submitting ? '创建中…' : '确认创建'}
        </button>
      </div>
      <p style={{ ...s.emptyHint, marginTop: 10 }}>老板账号自动生成，创建后跳转详情页生成绑定码</p>
    </div>
  )
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <div style={s.fieldLabel}>{label}</div>
      <input style={s.fieldInput} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f0f2f5', paddingBottom: 40 },
  header: {
    background: '#1a1a2e', padding: '18px 20px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: 700 },
  headerSub: { color: 'rgba(255,255,255,0.45)', fontSize: 12, marginTop: 2 },
  sysLink: { color: 'rgba(255,255,255,0.6)', fontSize: 13, textDecoration: 'none' },
  createBtn: {
    height: 34, padding: '0 16px', background: '#1677ff', color: '#fff',
    border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  body: { maxWidth: 680, margin: '0 auto', padding: '14px 12px' },

  card: {
    display: 'block', background: '#fff', borderRadius: 12, padding: '14px 16px',
    marginBottom: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', textDecoration: 'none',
    color: 'inherit', cursor: 'pointer',
  },
  cardTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  cardName: { fontSize: 16, fontWeight: 700, color: '#1a1a1a' },
  statusBadge: {
    fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
    border: '1px solid', letterSpacing: '0.02em',
  },
  cardId: { fontSize: 11, color: '#ccc', fontFamily: 'monospace', marginBottom: 12 },
  statsRow: { display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  statPill: {
    display: 'flex', alignItems: 'center', gap: 4, background: '#f8f8f8',
    borderRadius: 6, padding: '4px 10px', border: '1px solid #f0f0f0',
  },
  statIcon: { fontSize: 13 },
  statLabel: { fontSize: 11, color: '#aaa' },
  statValue: { fontSize: 13, fontWeight: 700 },
  cardFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  cardMeta: { fontSize: 12, color: '#bbb' },
  cardArrow: { fontSize: 12, color: '#1677ff', fontWeight: 600 },

  createForm: {
    background: '#fff', borderRadius: 12, padding: '18px 16px',
    marginBottom: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    border: '1.5px solid #1677ff33',
  },
  formTitle: { fontSize: 14, fontWeight: 700, color: '#1677ff', marginBottom: 14 },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  fieldLabel: { fontSize: 12, color: '#888', marginBottom: 4 },
  fieldInput: {
    width: '100%', height: 38, border: '1.5px solid #e8e8e8', borderRadius: 6,
    padding: '0 10px', fontSize: 14, outline: 'none', boxSizing: 'border-box',
  },
  errorMsg: { fontSize: 13, color: '#ff4d4f', marginTop: 8 },
  cancelBtn: {
    height: 38, padding: '0 18px', background: '#f5f5f5', border: '1px solid #e0e0e0',
    borderRadius: 6, fontSize: 13, cursor: 'pointer',
  },
  submitFormBtn: {
    flex: 1, height: 38, background: '#1677ff', color: '#fff',
    border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer',
  },

  center: {
    minHeight: '100vh', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 12, background: '#f0f2f5',
  },
  spinner: {
    width: 32, height: 32, borderRadius: '50%', border: '3px solid #e8e8e8',
    borderTopColor: '#1677ff', animation: 'spin 0.8s linear infinite',
  },
  backLink: { fontSize: 14, color: '#1677ff', textDecoration: 'none' },
  emptyHint: { fontSize: 13, color: '#bbb', textAlign: 'center', padding: '20px 0' },

  appSection: {
    background: '#fff', borderRadius: 12, padding: '14px 16px',
    marginBottom: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    border: '1.5px solid #fa8c1633',
  },
  appSectionTitle: {
    fontSize: 13, fontWeight: 700, color: '#fa8c16', marginBottom: 10,
    display: 'flex', alignItems: 'center', gap: 6,
  },
  appBadge: {
    fontSize: 11, fontWeight: 700, background: '#fa8c16', color: '#fff',
    borderRadius: 10, padding: '1px 7px',
  },
  appRow: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10,
    padding: '10px 0', borderTop: '1px solid #f5f5f5',
  },
  appInfo: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 },
  appStoreName: { fontSize: 14, fontWeight: 700, color: '#1a1a1a' },
  appMeta: { fontSize: 12, color: '#8c8c8c' },
  approveBtn: {
    height: 32, padding: '0 14px', background: '#52c41a', color: '#fff',
    border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
  },
  approvedTag: {
    fontSize: 12, color: '#52c41a', fontWeight: 600, flexShrink: 0,
  },
  sendBtn: {
    height: 32, padding: '0 16px', background: '#1677ff', color: '#fff',
    border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
  },

  // conversations
  convRow: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0',
    borderTop: '1px solid #f5f5f5', cursor: 'pointer',
  },
  convAvatar: {
    width: 36, height: 36, borderRadius: '50%', background: '#e6f4ff',
    border: '1.5px solid #91caff', display: 'flex', alignItems: 'center',
    justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#1677ff', flexShrink: 0,
  },
  convName: { fontSize: 13, fontWeight: 600, color: '#1a1a1a' },
  convTime: { fontSize: 11, color: '#bbb' },
  convPreview: { fontSize: 12, color: '#888', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  convCount: {
    minWidth: 20, height: 20, borderRadius: 10, background: '#1677ff', color: '#fff',
    fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '0 5px', flexShrink: 0,
  },

  // thread
  threadBox: {
    maxHeight: 280, overflowY: 'auto', padding: '8px 0',
    borderTop: '1px solid #f0f0f0', borderBottom: '1px solid #f0f0f0',
  },
  bubble: {
    maxWidth: '75%', padding: '8px 12px', borderRadius: 12,
    fontSize: 13, lineHeight: 1.5, wordBreak: 'break-word',
  },
  bubbleCustomer: { background: '#f5f5f5', color: '#1a1a1a', borderBottomLeftRadius: 4 },
  bubbleOps: { background: '#1677ff', color: '#fff', borderBottomRightRadius: 4 },

  replyArea: {
    width: '100%', border: '1.5px solid #e8e8e8', borderRadius: 8,
    padding: '8px 10px', fontSize: 13, outline: 'none',
    boxSizing: 'border-box', resize: 'none', fontFamily: 'inherit',
  } as React.CSSProperties,
}
