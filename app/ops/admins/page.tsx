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
  const [form, setForm] = useState({ name: '', username: '', password: '', telegramId: '', role: 'OPS_ADMIN' })
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

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
    if (!form.name.trim() || !form.username.trim()) { setFormError('请填写姓名和用户名'); return }
    setSubmitting(true)
    setFormError('')
    try {
      const r = await apiFetch('/api/ops/admins', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name.trim(),
          username: form.username.trim(),
          password: form.password || undefined,
          telegramId: form.telegramId.trim() || undefined,
          role: form.role,
        }),
      }, OWNER_CTX)
      const body = await r.json()
      if (r.ok) {
        setShowForm(false)
        setForm({ name: '', username: '', password: '', telegramId: '', role: 'OPS_ADMIN' })
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

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <div style={s.headerTitle}>管理员列表</div>
          <div style={s.headerSub}>仅 SUPER_ADMIN 可管理</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Link href="/ops" style={s.backLink}>← 返回后台</Link>
          <button style={s.addBtn} onClick={() => setShowForm((v) => !v)}>
            {showForm ? '取消' : '+ 新增管理员'}
          </button>
        </div>
      </div>

      <div style={s.body}>
        {showForm && (
          <div style={s.formCard}>
            <div style={s.formTitle}>新增管理员</div>
            <div style={s.formGrid}>
              <Field label="姓名 *" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="运营张三" />
              <Field label="登录账号 *" value={form.username} onChange={(v) => setForm((f) => ({ ...f, username: v }))} placeholder="zhangsan" />
              <Field label="登录密码" value={form.password} onChange={(v) => setForm((f) => ({ ...f, password: v }))} placeholder="留空则禁用密码登录" type="password" />
              <Field label="Telegram ID" value={form.telegramId} onChange={(v) => setForm((f) => ({ ...f, telegramId: v }))} placeholder="数字 ID，如 123456789" />
            </div>
            <div style={{ marginTop: 10 }}>
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
            {formError && <div style={s.errMsg}>{formError}</div>}
            <button style={{ ...s.submitBtn, opacity: submitting ? 0.6 : 1 }} onClick={createAdmin} disabled={submitting}>
              {submitting ? '创建中…' : '确认创建'}
            </button>
          </div>
        )}

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
                  <div style={s.rowLeft}>
                    <div style={s.rowName}>{a.name}</div>
                    <div style={s.rowMeta}>
                      <span style={{ ...s.badge, background: rm.bg, color: rm.color, borderColor: rm.border }}>{rm.label}</span>
                      <span style={s.metaText}>{a.username}</span>
                      <span style={{ fontSize: 11, color: a.telegramId ? '#52c41a' : '#bbb' }}>
                        {a.telegramId ? '✓ TG已绑' : 'TG未绑'}
                      </span>
                      {isDisabled && <span style={s.disabledTag}>已停用</span>}
                    </div>
                  </div>
                  <button
                    style={{ ...s.actionBtn, color: isDisabled ? '#52c41a' : '#ff4d4f', borderColor: isDisabled ? '#b7eb8f' : '#ffa39e', background: isDisabled ? '#f6ffed' : '#fff1f0' }}
                    onClick={() => toggleStatus(a)}
                  >
                    {isDisabled ? '启用' : '停用'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string
}) {
  return (
    <div>
      <div style={s.fieldLabel}>{label}</div>
      <input style={s.fieldInput} type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  )
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
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  fieldLabel: { fontSize: 12, color: '#888', marginBottom: 4 },
  fieldInput: { width: '100%', height: 36, border: '1.5px solid #e8e8e8', borderRadius: 6, padding: '0 10px', fontSize: 13, outline: 'none', boxSizing: 'border-box' },
  errMsg: { fontSize: 13, color: '#ff4d4f', marginTop: 8 },
  submitBtn: { marginTop: 12, height: 36, width: '100%', background: '#1677ff', color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  list: { display: 'flex', flexDirection: 'column', gap: 8 },
  row: { background: '#fff', borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  rowLeft: { display: 'flex', flexDirection: 'column', gap: 4 },
  rowName: { fontSize: 15, fontWeight: 700, color: '#1a1a1a' },
  rowMeta: { display: 'flex', alignItems: 'center', gap: 8 },
  badge: { fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 8, border: '1px solid' },
  metaText: { fontSize: 12, color: '#888' },
  disabledTag: { fontSize: 10, color: '#bbb', background: '#f5f5f5', border: '1px solid #e8e8e8', borderRadius: 4, padding: '1px 5px' },
  actionBtn: { height: 28, padding: '0 12px', border: '1px solid', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  hint: { fontSize: 13, color: '#bbb', textAlign: 'center', padding: '20px 0' },
}
