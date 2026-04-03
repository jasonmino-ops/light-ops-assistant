'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import QRCode from 'react-qr-code'
import { apiFetch, OWNER_CTX } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

type Store = { id: string; name: string }

type Member = {
  id: string
  username: string
  displayName: string
  role: 'OWNER' | 'STAFF'
  bound: boolean
  storeName: string
}

type TokenResult = {
  token: string
  role: string
  storeName: string
  expiresAt: string
  tgLink: string | null
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OpsPage() {
  const [authState, setAuthState] = useState<'checking' | 'ok' | 'denied'>('checking')

  const [stores, setStores] = useState<Store[]>([])
  const [selectedStoreId, setSelectedStoreId] = useState('')

  const [members, setMembers] = useState<Member[]>([])
  const [membersLoading, setMembersLoading] = useState(false)

  const [tokenResult, setTokenResult] = useState<TokenResult | null>(null)
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)

  const [unbindingId, setUnbindingId] = useState<string | null>(null)
  const [unbindMsg, setUnbindMsg] = useState<string | null>(null)

  // ── Auth check ─────────────────────────────────────────────────────────────

  useEffect(() => {
    apiFetch('/api/ops/check', undefined, OWNER_CTX)
      .then((r) => {
        if (r.ok) setAuthState('ok')
        else setAuthState('denied')
      })
      .catch(() => setAuthState('denied'))
  }, [])

  // ── Load stores ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (authState !== 'ok') return
    apiFetch('/api/stores', undefined, OWNER_CTX)
      .then((r) => r.json())
      .then((list: Store[]) => {
        setStores(list)
        if (list.length > 0) setSelectedStoreId(list[0].id)
      })
      .catch(() => {})
  }, [authState])

  // ── Load members ───────────────────────────────────────────────────────────

  const loadMembers = useCallback(async () => {
    setMembersLoading(true)
    setUnbindMsg(null)
    try {
      const r = await apiFetch('/api/admin/users', undefined, OWNER_CTX)
      if (r.ok) setMembers(await r.json())
    } finally {
      setMembersLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authState === 'ok') loadMembers()
  }, [authState, loadMembers])

  // ── Generate bind token ────────────────────────────────────────────────────

  async function genToken(role: 'OWNER' | 'STAFF') {
    if (!selectedStoreId) return
    setGenerating(true)
    setGenError(null)
    setTokenResult(null)
    try {
      const r = await apiFetch('/api/admin/bind-tokens', {
        method: 'POST',
        body: JSON.stringify({ storeId: selectedStoreId, role, expiresInHours: 24, maxUses: 1 }),
      }, OWNER_CTX)
      const body = await r.json()
      if (r.ok) setTokenResult(body)
      else setGenError(body.message ?? body.error ?? '生成失败')
    } catch {
      setGenError('网络错误，请重试')
    } finally {
      setGenerating(false)
    }
  }

  // ── Unbind ─────────────────────────────────────────────────────────────────

  async function unbind(member: Member) {
    if (!confirm(`确认解绑 ${member.displayName || member.username} 的 Telegram 账号？`)) return
    setUnbindingId(member.id)
    setUnbindMsg(null)
    try {
      const r = await apiFetch(`/api/admin/users/${member.id}/unbind`, { method: 'POST' }, OWNER_CTX)
      const body = await r.json()
      if (r.ok) {
        setUnbindMsg(`✅ 已解绑 ${member.displayName || member.username}`)
        await loadMembers()
      } else {
        setUnbindMsg(`❌ ${body.message ?? body.error ?? '解绑失败'}`)
      }
    } catch {
      setUnbindMsg('❌ 网络错误')
    } finally {
      setUnbindingId(null)
    }
  }

  // ─── Render: checking / denied ─────────────────────────────────────────────

  if (authState === 'checking') {
    return (
      <div style={s.center}>
        <div style={s.spinner} />
        <p style={s.muted}>权限校验中…</p>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    )
  }

  if (authState === 'denied') {
    return (
      <div style={s.center}>
        <div style={s.deniedIcon}>⛔</div>
        <p style={{ ...s.muted, color: '#ff4d4f', fontWeight: 600 }}>无权限访问内部后台</p>
        <Link href="/dashboard" style={s.backLink}>← 返回概览</Link>
      </div>
    )
  }

  // ─── Render: main ──────────────────────────────────────────────────────────

  return (
    <div style={s.page}>

      {/* ── Header ── */}
      <div style={s.header}>
        <div>
          <div style={s.headerTitle}>🔧 内部运营后台</div>
          <div style={s.headerSub}>仅限内部管理员使用</div>
        </div>
        <Link href="/system" style={s.sysLink}>系统自检 →</Link>
      </div>

      <div style={s.body}>

        {/* ══ 1. 门店选择 ══ */}
        <section style={s.section}>
          <div style={s.sectionTitle}>📍 选择门店</div>
          {stores.length === 0 ? (
            <p style={s.muted}>加载门店中…</p>
          ) : (
            <select
              style={s.select}
              value={selectedStoreId}
              onChange={(e) => { setSelectedStoreId(e.target.value); setTokenResult(null) }}
            >
              {stores.map((st) => (
                <option key={st.id} value={st.id}>{st.name}</option>
              ))}
            </select>
          )}
        </section>

        {/* ══ 2 & 3. 生成绑定码 ══ */}
        <section style={s.section}>
          <div style={s.sectionTitle}>🔑 生成绑定码</div>
          <div style={s.btnRow}>
            <button
              style={{ ...s.genBtn, background: '#1677ff' }}
              disabled={generating || !selectedStoreId}
              onClick={() => genToken('OWNER')}
            >
              {generating ? '生成中…' : '👑 生成老板码'}
            </button>
            <button
              style={{ ...s.genBtn, background: '#52c41a' }}
              disabled={generating || !selectedStoreId}
              onClick={() => genToken('STAFF')}
            >
              {generating ? '生成中…' : '👤 生成员工码'}
            </button>
          </div>
          <p style={s.hint}>单次使用 · 24 小时有效</p>

          {genError && <div style={s.errorMsg}>{genError}</div>}

          {tokenResult && (
            <div style={s.resultCard}>
              <div style={s.resultHeader}>
                <span style={s.resultRole}>
                  {tokenResult.role === 'OWNER' ? '👑 老板绑定码' : '👤 员工绑定码'}
                </span>
                <span style={s.resultStore}>{tokenResult.storeName}</span>
              </div>

              {tokenResult.tgLink ? (
                <>
                  <div style={s.qrWrap}>
                    <QRCode value={tokenResult.tgLink} size={180} />
                  </div>
                  <div style={s.linkBox}>
                    <span style={s.linkLabel}>链接</span>
                    <a href={tokenResult.tgLink} style={s.linkValue} target="_blank" rel="noreferrer">
                      {tokenResult.tgLink}
                    </a>
                  </div>
                </>
              ) : (
                <div style={s.errorMsg}>
                  未配置 TELEGRAM_BOT_USERNAME，无法生成 tgLink。请在 Vercel 环境变量中配置。
                </div>
              )}

              <div style={s.metaRow}>
                <MetaItem label="角色" value={tokenResult.role === 'OWNER' ? '老板' : '员工'} />
                <MetaItem label="有效至" value={new Date(tokenResult.expiresAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} />
                <MetaItem label="次数" value="单次" />
              </div>
            </div>
          )}
        </section>

        {/* ══ 4 & 5. 成员状态 & 解绑 ══ */}
        <section style={s.section}>
          <div style={s.sectionHeader}>
            <div style={s.sectionTitle}>👥 成员绑定状态</div>
            <button style={s.refreshBtn} onClick={loadMembers} disabled={membersLoading}>
              {membersLoading ? '…' : '刷新'}
            </button>
          </div>

          {unbindMsg && (
            <div style={{ ...s.hint, color: unbindMsg.startsWith('✅') ? '#52c41a' : '#ff4d4f', marginBottom: 8 }}>
              {unbindMsg}
            </div>
          )}

          {membersLoading && members.length === 0 ? (
            <p style={s.muted}>加载中…</p>
          ) : members.length === 0 ? (
            <p style={s.muted}>暂无成员</p>
          ) : (
            <div style={s.table}>
              <div style={s.tableHead}>
                <span style={{ flex: 2 }}>姓名</span>
                <span style={{ flex: 1 }}>角色</span>
                <span style={{ flex: 1.5 }}>状态</span>
                <span style={{ flex: 1 }}>操作</span>
              </div>
              {members.map((m) => (
                <div key={m.id} style={s.tableRow}>
                  <span style={{ flex: 2, fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.displayName || m.username}
                  </span>
                  <span style={{ flex: 1, fontSize: 12, color: m.role === 'OWNER' ? '#1677ff' : '#52c41a' }}>
                    {m.role === 'OWNER' ? '老板' : '员工'}
                  </span>
                  <span style={{ flex: 1.5, fontSize: 13 }}>
                    {m.bound
                      ? <span style={{ color: '#52c41a' }}>🟢 已绑定</span>
                      : <span style={{ color: '#bbb' }}>🔴 未绑定</span>
                    }
                  </span>
                  <span style={{ flex: 1 }}>
                    {m.bound && (
                      <button
                        style={s.unbindBtn}
                        disabled={unbindingId === m.id}
                        onClick={() => unbind(m)}
                      >
                        {unbindingId === m.id ? '…' : '解绑'}
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: '#333' }}>{value}</span>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f5f7fa',
    paddingBottom: 40,
  },
  header: {
    background: '#1a1a2e',
    padding: '20px 20px 18px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 700,
  },
  headerSub: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    marginTop: 2,
  },
  sysLink: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    textDecoration: 'none',
  },
  body: {
    maxWidth: 600,
    margin: '0 auto',
    padding: '16px 14px',
  },
  section: {
    background: '#fff',
    borderRadius: 12,
    padding: '16px 16px 18px',
    marginBottom: 12,
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: '#1a1a1a',
    marginBottom: 12,
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  select: {
    width: '100%',
    height: 42,
    border: '1.5px solid #e8e8e8',
    borderRadius: 8,
    padding: '0 12px',
    fontSize: 15,
    background: '#fafafa',
    outline: 'none',
  },
  btnRow: {
    display: 'flex',
    gap: 10,
    marginBottom: 6,
  },
  genBtn: {
    flex: 1,
    height: 46,
    border: 'none',
    borderRadius: 8,
    color: '#fff',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
  },
  hint: {
    fontSize: 12,
    color: '#aaa',
    marginBottom: 0,
  },
  errorMsg: {
    fontSize: 13,
    color: '#ff4d4f',
    marginTop: 10,
  },
  resultCard: {
    marginTop: 14,
    border: '1.5px solid #e8e8e8',
    borderRadius: 10,
    padding: '16px',
    background: '#fafafa',
  },
  resultHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  resultRole: {
    fontSize: 15,
    fontWeight: 700,
    color: '#1a1a1a',
  },
  resultStore: {
    fontSize: 12,
    color: '#aaa',
  },
  qrWrap: {
    display: 'flex',
    justifyContent: 'center',
    padding: '12px 0 16px',
  },
  linkBox: {
    background: '#f0f5ff',
    borderRadius: 6,
    padding: '8px 12px',
    marginBottom: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  linkLabel: {
    fontSize: 11,
    color: '#aaa',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  linkValue: {
    fontSize: 12,
    color: '#1677ff',
    wordBreak: 'break-all',
  },
  metaRow: {
    display: 'flex',
    gap: 16,
    paddingTop: 12,
    borderTop: '1px solid #efefef',
  },
  refreshBtn: {
    height: 30,
    padding: '0 14px',
    background: '#f5f5f5',
    border: '1px solid #e0e0e0',
    borderRadius: 6,
    fontSize: 12,
    color: '#666',
    cursor: 'pointer',
  },
  table: {
    border: '1px solid #f0f0f0',
    borderRadius: 8,
    overflow: 'hidden',
  },
  tableHead: {
    display: 'flex',
    padding: '8px 12px',
    background: '#fafafa',
    borderBottom: '1px solid #f0f0f0',
    fontSize: 12,
    color: '#aaa',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
  },
  tableRow: {
    display: 'flex',
    padding: '11px 12px',
    borderBottom: '1px solid #f8f8f8',
    alignItems: 'center',
  },
  unbindBtn: {
    height: 28,
    padding: '0 10px',
    background: '#fff1f0',
    border: '1px solid #ffa39e',
    borderRadius: 4,
    color: '#ff4d4f',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  center: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    background: '#f5f7fa',
  },
  spinner: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    border: '3px solid #e8e8e8',
    borderTopColor: '#1677ff',
    animation: 'spin 0.8s linear infinite',
  },
  deniedIcon: {
    fontSize: 48,
  },
  muted: {
    fontSize: 14,
    color: '#aaa',
    margin: 0,
  },
  backLink: {
    fontSize: 14,
    color: '#1677ff',
    textDecoration: 'none',
  },
}
