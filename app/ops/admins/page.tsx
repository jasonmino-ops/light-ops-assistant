'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { apiFetch, OWNER_CTX } from '@/lib/api'

type Admin = {
  id: string
  name: string
  username: string
  role: string
  status: string
  telegramId: string | null
  createdAt: string
}

type CreatedResult = {
  id: string
  name: string
  username: string
  role: string
  initialPassword: string
}

const ROLE_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  SUPER_ADMIN: { label: 'SUPER_ADMIN', color: '#722ed1', bg: '#f9f0ff', border: '#d3adf7' },
  OPS_ADMIN:   { label: 'OPS_ADMIN',   color: '#1677ff', bg: '#e6f4ff', border: '#91caff' },
  BD:          { label: 'BD',          color: '#fa8c16', bg: '#fff7e6', border: '#ffd591' },
}

export default function OpsAdminsPage() {
  const [admins, setAdmins] = useState<Admin[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', role: 'OPS_ADMIN' })
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [created, setCreated] = useState<CreatedResult | null>(null)
  const [copied, setCopied] = useState(false)
  // TG binding dialog
  const [tgAdmin, setTgAdmin] = useState<Admin | null>(null)
  const [tgInput, setTgInput] = useState('')
  const [tgSubmitting, setTgSubmitting] = useState(false)
  const [tgError, setTgError] = useState('')
  // Reset password result
  const [resetResult, setResetResult] = useState<{ adminName: string; newPassword: string } | null>(null)
  const [resetCopied, setResetCopied] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const r = await apiFetch('/api/ops/admins', undefined, OWNER_CTX)
      if (r.ok) setAdmins(await r.json())
      else setError('加载失败（可能无权限）')
    } catch {
      setError('网络错误')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function createAdmin() {
    if (!form.name.trim()) { setFormError('请填写姓名'); return }
    setSubmitting(true)
    setFormError('')
    try {
      const r = await apiFetch('/api/ops/admins', {
        method: 'POST',
        body: JSON.stringify({ name: form.name.trim(), role: form.role }),
      }, OWNER_CTX)
      const body = await r.json()
      if (r.ok) {
        setCreated({ id: body.id, name: body.name, username: body.username, role: body.role, initialPassword: body.initialPassword })
        setShowForm(false)
        setForm({ name: '', role: 'OPS_ADMIN' })
        load()
      } else {
        setFormError(body.message ?? body.error ?? '创建失败')
      }
    } catch {
      setFormError('网络错误')
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleStatus(admin: Admin) {
    const next = admin.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'
    const msg = next === 'DISABLED' ? `确认停用「${admin.name}」？` : `确认启用「${admin.name}」？`
    if (!confirm(msg)) return
    await apiFetch(`/api/ops/admins/${admin.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: next }),
    }, OWNER_CTX)
    load()
  }

  function copyLoginInfo(a: Admin | CreatedResult, password: string) {
    const text = `登录账号：${a.username}\n初始密码：${password}`
    navigator.clipboard.writeText(text).catch(() => {})
  }

  async function resetPassword(admin: Admin) {
    if (!confirm(`确认重置「${admin.name}」的登录密码？`)) return
    const r = await apiFetch(`/api/ops/admins/${admin.id}/reset-password`, { method: 'POST' }, OWNER_CTX)
    if (r.ok) {
      const body = await r.json()
      setResetResult({ adminName: admin.name, newPassword: body.newPassword })
      setResetCopied(false)
    } else {
      alert('重置失败，请重试')
    }
  }

  async function bindTelegram() {
    if (!tgInput.trim()) { setTgError('请输入 Telegram ID'); return }
    setTgSubmitting(true)
    setTgError('')
    try {
      const r = await apiFetch(`/api/ops/admins/${tgAdmin!.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ telegramId: tgInput.trim() }),
      }, OWNER_CTX)
      const body = await r.json()
      if (r.ok) {
        setTgAdmin(null)
        setTgInput('')
        load()
      } else {
        setTgError(body.message ?? body.error ?? '绑定失败')
      }
    } catch {
      setTgError('网络错误')
    } finally {
      setTgSubmitting(false)
    }
  }

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <div style={s.headerTitle}>管理员列表</div>
          <div style={s.headerSub}>仅 SUPER_ADMIN 可管理</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Link href="/ops" style={s.backLink}>← 返回后台</Link>
          <button style={s.addBtn} onClick={() => { setShowForm((v) => !v); setCreated(null) }}>
            {showForm ? '取消' : '+ 新增管理员'}
          </button>
        </div>
      </div>

      <div style={s.body}>
        {/* Create form */}
        {showForm && (
          <div style={s.formCard}>
            <div style={s.formTitle}>新增管理员</div>
            <div style={{ marginBottom: 10 }}>
              <div style={s.fieldLabel}>姓名 *</div>
              <input style={s.fieldInput} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="运营张三" />
            </div>
            <div>
              <div style={s.fieldLabel}>角色</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                {(['SUPER_ADMIN', 'OPS_ADMIN', 'BD'] as const).map((r) => {
                  const m = ROLE_META[r]
                  return (
                    <button key={r} onClick={() => setForm((f) => ({ ...f, role: r }))} style={{
                      flex: 1, height: 32, border: `1.5px solid ${form.role === r ? m.border : '#e8e8e8'}`,
                      borderRadius: 6, fontSize: 12, fontWeight: form.role === r ? 700 : 400,
                      background: form.role === r ? m.bg : '#f5f5f5',
                      color: form.role === r ? m.color : '#888', cursor: 'pointer',
                    }}>{m.label}</button>
                  )
                })}
              </div>
            </div>
            <div style={s.hint2}>账号和初始密码将自动生成，Telegram 可后续绑定</div>
            {formError && <div style={s.errMsg}>{formError}</div>}
            <button style={{ ...s.submitBtn, opacity: submitting ? 0.6 : 1 }} onClick={createAdmin} disabled={submitting}>
              {submitting ? '创建中…' : '确认创建'}
            </button>
          </div>
        )}

        {/* Created result card */}
        {created && (
          <div style={s.resultCard}>
            <div style={s.resultTitle}>✓ 管理员已创建</div>
            <div style={s.resultRow}><span style={s.resultLabel}>姓名</span><span>{created.name}</span></div>
            <div style={s.resultRow}><span style={s.resultLabel}>角色</span>
              <span style={{ ...s.badge, ...badgeStyle(created.role) }}>{ROLE_META[created.role]?.label ?? created.role}</span>
            </div>
            <div style={s.resultRow}><span style={s.resultLabel}>账号</span><span style={s.mono}>{created.username}</span></div>
            <div style={s.resultRow}><span style={s.resultLabel}>初始密码</span><span style={s.mono}>{created.initialPassword}</span></div>
            <button style={s.copyBtn} onClick={() => {
              copyLoginInfo(created, created.initialPassword)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }}>{copied ? '✓ 已复制' : '复制登录信息'}</button>
            <button style={s.dismissBtn} onClick={() => setCreated(null)}>关闭</button>
          </div>
        )}

        {/* Reset password result */}
        {resetResult && (
          <div style={{ ...s.resultCard, borderColor: '#ffd591' }}>
            <div style={{ ...s.resultTitle, color: '#fa8c16' }}>密码已重置</div>
            <div style={s.resultRow}><span style={s.resultLabel}>管理员</span><span>{resetResult.adminName}</span></div>
            <div style={s.resultRow}><span style={s.resultLabel}>新密码</span><span style={s.mono}>{resetResult.newPassword}</span></div>
            <button style={s.copyBtn} onClick={() => {
              navigator.clipboard.writeText(resetResult.newPassword).catch(() => {})
              setResetCopied(true)
              setTimeout(() => setResetCopied(false), 2000)
            }}>{resetCopied ? '✓ 已复制' : '复制新密码'}</button>
            <button style={s.dismissBtn} onClick={() => setResetResult(null)}>关闭</button>
          </div>
        )}

        {/* TG binding dialog */}
        {tgAdmin && (
          <div style={s.formCard}>
            <div style={s.formTitle}>绑定 Telegram — {tgAdmin.name}</div>
            <div style={s.fieldLabel}>Telegram 数字 ID</div>
            <input style={{ ...s.fieldInput, marginTop: 6 }} value={tgInput} onChange={(e) => setTgInput(e.target.value)} placeholder="如 123456789" />
            {tgError && <div style={s.errMsg}>{tgError}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button style={{ ...s.submitBtn, flex: 1, opacity: tgSubmitting ? 0.6 : 1 }} onClick={bindTelegram} disabled={tgSubmitting}>
                {tgSubmitting ? '绑定中…' : '确认绑定'}
              </button>
              <button style={{ ...s.submitBtn, flex: 1, background: '#f5f5f5', color: '#666', border: '1px solid #e8e8e8' }}
                onClick={() => { setTgAdmin(null); setTgInput(''); setTgError('') }}>取消</button>
            </div>
          </div>
        )}

        {/* Admin list */}
        {loading ? (
          <div style={s.hint}>加载中…</div>
        ) : error ? (
          <div style={{ ...s.hint, color: '#ff4d4f' }}>{error}</div>
        ) : admins.length === 0 ? (
          <div style={s.hint}>暂无管理员</div>
        ) : (
          <div style={s.list}>
            {admins.map((a) => {
              const rm = ROLE_META[a.role] ?? ROLE_META.OPS_ADMIN
              const isDisabled = a.status === 'DISABLED'
              return (
                <div key={a.id} style={{ ...s.row, opacity: isDisabled ? 0.55 : 1 }}>
                  <div style={s.rowTop}>
                    <div style={s.rowName}>{a.name}</div>
                    <div style={s.rowMeta}>
                      <span style={{ ...s.badge, background: rm.bg, color: rm.color, borderColor: rm.border }}>{rm.label}</span>
                      <span style={s.metaText}>{a.username}</span>
                      <span style={{ fontSize: 11, color: a.telegramId ? '#52c41a' : '#bbb' }}>
                        {a.telegramId ? `✓ TG:${a.telegramId}` : 'TG未绑'}
                      </span>
                      {isDisabled && <span style={s.disabledTag}>已停用</span>}
                    </div>
                  </div>
                  <div style={s.actionRow}>
                    <button style={s.actBtn} onClick={() => {
                      const info = `登录账号：${a.username}\n（密码请使用初始密码或重置后的密码）`
                      navigator.clipboard.writeText(info).catch(() => {})
                    }}>复制账号</button>
                    <button style={s.actBtn} onClick={() => { setTgAdmin(a); setTgInput(''); setTgError('') }}>
                      {a.telegramId ? '换绑 TG' : '绑定 TG'}
                    </button>
                    <button style={s.actBtn} onClick={() => resetPassword(a)}>重置密码</button>
                    <button
                      style={{ ...s.actBtn, color: isDisabled ? '#52c41a' : '#ff4d4f', borderColor: isDisabled ? '#b7eb8f' : '#ffa39e', background: isDisabled ? '#f6ffed' : '#fff1f0' }}
                      onClick={() => toggleStatus(a)}
                    >{isDisabled ? '启用' : '停用'}</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function badgeStyle(role: string) {
  const m = ROLE_META[role] ?? ROLE_META.OPS_ADMIN
  return { background: m.bg, color: m.color, borderColor: m.border }
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f0f2f5', paddingBottom: 40 },
  header: { background: '#1a1a2e', padding: '18px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: 700 },
  headerSub: { color: 'rgba(255,255,255,0.45)', fontSize: 11, marginTop: 2 },
  backLink: { color: 'rgba(255,255,255,0.7)', fontSize: 13, textDecoration: 'none' },
  addBtn: { height: 34, padding: '0 16px', background: '#1677ff', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  body: { maxWidth: 680, margin: '0 auto', padding: '14px 12px' },
  formCard: { background: '#fff', borderRadius: 12, padding: '16px', marginBottom: 14, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1.5px solid #1677ff33' },
  formTitle: { fontSize: 14, fontWeight: 700, color: '#1677ff', marginBottom: 12 },
  fieldLabel: { fontSize: 12, color: '#888', marginBottom: 4 },
  fieldInput: { width: '100%', height: 36, border: '1.5px solid #e8e8e8', borderRadius: 6, padding: '0 10px', fontSize: 13, outline: 'none', boxSizing: 'border-box' },
  hint2: { fontSize: 11, color: '#aaa', marginTop: 10, marginBottom: 2 },
  errMsg: { fontSize: 13, color: '#ff4d4f', marginTop: 8 },
  submitBtn: { marginTop: 12, height: 36, width: '100%', background: '#1677ff', color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  resultCard: { background: '#fff', borderRadius: 12, padding: '16px', marginBottom: 14, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1.5px solid #52c41a66' },
  resultTitle: { fontSize: 14, fontWeight: 700, color: '#52c41a', marginBottom: 12 },
  resultRow: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, marginBottom: 8 },
  resultLabel: { fontSize: 11, color: '#aaa', width: 52, flexShrink: 0 },
  mono: { fontFamily: 'monospace', background: '#f5f5f5', padding: '2px 8px', borderRadius: 4, fontSize: 13 },
  copyBtn: { marginTop: 10, height: 34, width: '100%', background: '#1677ff', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  dismissBtn: { marginTop: 8, height: 32, width: '100%', background: 'none', color: '#aaa', border: '1px solid #e8e8e8', borderRadius: 6, fontSize: 12, cursor: 'pointer' },
  list: { display: 'flex', flexDirection: 'column', gap: 8 },
  row: { background: '#fff', borderRadius: 10, padding: '12px 14px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  rowTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  rowName: { fontSize: 15, fontWeight: 700, color: '#1a1a1a' },
  rowMeta: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const, justifyContent: 'flex-end' },
  badge: { fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 8, border: '1px solid' },
  metaText: { fontSize: 12, color: '#888' },
  disabledTag: { fontSize: 10, color: '#bbb', background: '#f5f5f5', border: '1px solid #e8e8e8', borderRadius: 4, padding: '1px 5px' },
  actionRow: { display: 'flex', gap: 6 },
  actBtn: { flex: 1, height: 28, border: '1px solid #e8e8e8', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', background: '#fafafa', color: '#555' },
  hint: { fontSize: 13, color: '#bbb', textAlign: 'center', padding: '20px 0' },
}
