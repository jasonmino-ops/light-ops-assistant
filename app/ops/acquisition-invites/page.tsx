'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import QRCode from 'react-qr-code'
import { apiFetch, OWNER_CTX } from '@/lib/api'

type SalesOwner = { id: string; name: string; role: string }
type Invite = {
  id: string
  code: string
  sourceChannel: string
  campaignLabel: string | null
  internalNote: string | null
  status: 'ACTIVE' | 'INACTIVE'
  visitCount: number
  leadCount: number
  url: string
  createdAt: string
  salesOwner: SalesOwner | null
}
type SupportConfig = {
  supportPhone: string | null
  telegramSupportTarget: string | null
  updatedAt: string | null
  updatedByName: string | null
  canManage: boolean
}

const sources = ['FACEBOOK', 'TIKTOK', 'SALES', 'POSTER', 'TELEGRAM', 'OTHER']

export default function AcquisitionInviteOpsPage() {
  const [invites, setInvites] = useState<Invite[]>([])
  const [owners, setOwners] = useState<SalesOwner[]>([])
  const [canManage, setCanManage] = useState(false)
  const [sourceChannel, setSourceChannel] = useState('SALES')
  const [campaignLabel, setCampaignLabel] = useState('')
  const [salesOwnerId, setSalesOwnerId] = useState('')
  const [internalNote, setInternalNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [supportPhone, setSupportPhone] = useState('')
  const [telegramSupportTarget, setTelegramSupportTarget] = useState('')
  const [supportUpdatedAt, setSupportUpdatedAt] = useState<string | null>(null)
  const [supportUpdatedBy, setSupportUpdatedBy] = useState<string | null>(null)
  const [savingSupport, setSavingSupport] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [inviteResponse, supportResponse] = await Promise.all([
        apiFetch('/api/ops/acquisition-invites', undefined, OWNER_CTX),
        apiFetch('/api/ops/sales-lead-support', undefined, OWNER_CTX),
      ])
      const body = await inviteResponse.json()
      const support = await supportResponse.json() as SupportConfig
      if (!inviteResponse.ok || !supportResponse.ok) throw new Error(body.error)
      setInvites(body.invites)
      setOwners(body.salesOwners)
      setCanManage(body.canManage && support.canManage)
      setSupportPhone(support.supportPhone ?? '')
      setTelegramSupportTarget(support.telegramSupportTarget ?? '')
      setSupportUpdatedAt(support.updatedAt)
      setSupportUpdatedBy(support.updatedByName)
    } catch {
      setError('邀请列表加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function create(event: FormEvent) {
    event.preventDefault()
    if (!canManage || saving) return
    setSaving(true)
    setError('')
    try {
      const response = await apiFetch('/api/ops/acquisition-invites', {
        method: 'POST',
        body: JSON.stringify({ sourceChannel, campaignLabel, salesOwnerId, internalNote }),
      }, OWNER_CTX)
      const body = await response.json()
      if (!response.ok) throw new Error(body.error)
      setCampaignLabel('')
      setInternalNote('')
      await load()
    } catch {
      setError('创建邀请失败，请检查权限或输入')
    } finally {
      setSaving(false)
    }
  }

  async function toggle(invite: Invite) {
    const status = invite.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
    const response = await apiFetch(`/api/ops/acquisition-invites/${invite.id}`, {
      method: 'PATCH', body: JSON.stringify({ status }),
    }, OWNER_CTX)
    if (response.ok) await load()
    else setError('更新邀请状态失败')
  }

  async function copy(url: string) {
    try { await navigator.clipboard.writeText(url) } catch { window.prompt('复制邀请链接', url) }
  }

  async function saveSupport(event: FormEvent) {
    event.preventDefault()
    if (!canManage || savingSupport) return
    setSavingSupport(true)
    setError('')
    try {
      const response = await apiFetch('/api/ops/sales-lead-support', {
        method: 'PATCH',
        body: JSON.stringify({ supportPhone, telegramSupportTarget }),
      }, OWNER_CTX)
      const body = await response.json() as SupportConfig & { error?: string }
      if (!response.ok) throw new Error(body.error)
      setSupportPhone(body.supportPhone ?? '')
      setTelegramSupportTarget(body.telegramSupportTarget ?? '')
      setSupportUpdatedAt(body.updatedAt)
      setSupportUpdatedBy(body.updatedByName)
    } catch {
      setError('客服设置保存失败，请检查电话或 Telegram 用户名')
    } finally {
      setSavingSupport(false)
    }
  }

  return (
    <main style={s.page}>
      <header style={s.header}>
        <div><Link href="/ops" style={s.back}>← 运营后台</Link><h1 style={s.title}>邀请开店</h1><p style={s.sub}>短链接是归因核心；二维码编码同一条链接。</p></div>
      </header>
      {canManage && (
        <form style={s.form} onSubmit={create}>
          <select style={s.input} value={sourceChannel} onChange={(event) => setSourceChannel(event.target.value)}>{sources.map((source) => <option key={source}>{source}</option>)}</select>
          <input style={s.input} placeholder="Campaign / Label（可空）" value={campaignLabel} onChange={(event) => setCampaignLabel(event.target.value)} maxLength={120} />
          <select style={s.input} value={salesOwnerId} onChange={(event) => setSalesOwnerId(event.target.value)}><option value="">未分配负责人</option>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name} · {owner.role}</option>)}</select>
          <input style={s.input} placeholder="Internal Note（可空）" value={internalNote} onChange={(event) => setInternalNote(event.target.value)} maxLength={1000} />
          <button style={s.primary} disabled={saving}>{saving ? '创建中…' : '生成邀请'}</button>
        </form>
      )}
      <form style={s.supportForm} onSubmit={saveSupport}>
        <div style={s.supportHeading}>
          <strong>开店申请客服设置</strong>
          <span style={s.meta}>仅用于留资、开店申请与等待审核页面</span>
        </div>
        <input style={s.input} aria-label="客服电话" placeholder="客服电话（可空）" value={supportPhone} onChange={(event) => setSupportPhone(event.target.value)} maxLength={25} disabled={!canManage} />
        <input style={s.input} aria-label="Telegram 客服" placeholder="Telegram Bot 用户名（可空）" value={telegramSupportTarget} onChange={(event) => setTelegramSupportTarget(event.target.value)} maxLength={32} disabled={!canManage} />
        {canManage && <button style={s.primary} disabled={savingSupport}>{savingSupport ? '保存中…' : '保存客服设置'}</button>}
        <span style={s.meta}>{supportUpdatedAt ? `最后更新：${supportUpdatedBy || 'Ops'} · ${new Date(supportUpdatedAt).toLocaleString()}` : '尚未配置；Telegram 将安全回退到 Merchant Bot'}</span>
      </form>
      {error && <div style={s.error}>{error}</div>}
      {loading ? <p>加载中…</p> : (
        <div style={s.grid}>
          {invites.map((invite) => (
            <article key={invite.id} style={s.card}>
              <div style={s.row}><strong>{invite.campaignLabel || invite.sourceChannel}</strong><span style={invite.status === 'ACTIVE' ? s.active : s.inactive}>{invite.status}</span></div>
              <div style={s.meta}>{invite.sourceChannel} · {invite.salesOwner?.name || 'UNASSIGNED'}</div>
              <div style={s.qr}><QRCode value={invite.url} size={116} /></div>
              <code style={s.url}>{invite.url}</code>
              <div style={s.stats}><span>Visits {invite.visitCount}</span><span>Leads {invite.leadCount}</span></div>
              <div style={s.actions}><button style={s.secondary} onClick={() => void copy(invite.url)}>复制链接</button>{canManage && <button style={s.secondary} onClick={() => void toggle(invite)}>{invite.status === 'ACTIVE' ? '停用' : '启用'}</button>}</div>
            </article>
          ))}
        </div>
      )}
    </main>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', padding: 24, background: '#f5f7fb', color: '#172033' },
  header: { maxWidth: 1080, margin: '0 auto 18px' }, back: { color: '#2563eb', textDecoration: 'none' }, title: { margin: '10px 0 4px' }, sub: { margin: 0, color: '#64748b' },
  form: { maxWidth: 1080, margin: '0 auto 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10, background: '#fff', padding: 16, borderRadius: 14 },
  supportForm: { maxWidth: 1080, margin: '0 auto 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10, alignItems: 'center', background: '#fff', padding: 16, borderRadius: 14 },
  supportHeading: { display: 'flex', flexDirection: 'column', gap: 4 },
  input: { minHeight: 42, border: '1px solid #dbe3ef', borderRadius: 9, padding: '0 10px', background: '#fff' }, primary: { border: 0, borderRadius: 9, background: '#2563eb', color: '#fff', fontWeight: 800 },
  error: { maxWidth: 1080, margin: '0 auto 14px', padding: 10, background: '#fff1f2', color: '#be123c', borderRadius: 9 }, grid: { maxWidth: 1080, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(270px,1fr))', gap: 14 },
  card: { background: '#fff', padding: 16, borderRadius: 14, boxShadow: '0 4px 20px rgba(15,23,42,.06)' }, row: { display: 'flex', justifyContent: 'space-between', gap: 12 }, active: { color: '#15803d', fontSize: 12 }, inactive: { color: '#b45309', fontSize: 12 }, meta: { color: '#64748b', fontSize: 13, marginTop: 5 }, qr: { display: 'grid', placeItems: 'center', padding: 16 }, url: { display: 'block', overflowWrap: 'anywhere', fontSize: 11, color: '#475569' }, stats: { display: 'flex', gap: 18, marginTop: 12, fontSize: 13 }, actions: { display: 'flex', gap: 8, marginTop: 12 }, secondary: { border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8', borderRadius: 8, padding: '8px 10px', cursor: 'pointer' },
}
