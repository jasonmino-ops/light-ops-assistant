'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { apiFetch, OWNER_CTX } from '@/lib/api'
import LangToggleBtn from '@/app/components/LangToggleBtn'
import { useLocale } from '@/app/components/LangProvider'
import { useWorkMode } from '@/app/components/WorkModeProvider'

type MemberStatus = 'ACTIVE' | 'INACTIVE'

type Member = {
  id: string
  memberCode: string
  name: string
  phone: string | null
  normalizedPhone: string | null
  balance: string
  status: MemberStatus
  telegramUsername: string | null
  note: string | null
  createdAt: string
}

type Copy = {
  title: string
  sub: string
  totalMembers: string
  currentBalance: string
  activeMembers: string
  searchPlaceholder: string
  newMember: string
  name: string
  phone: string
  note: string
  optional: string
  cancel: string
  create: string
  creating: string
  empty: string
  viewDetail: string
  balance: string
  code: string
  status: string
  active: string
  inactive: string
  loadFailed: string
  createSuccess: string
  duplicatePhone: string
  createFailed: string
}

const copy: Record<'zh' | 'en' | 'km', Copy> = {
  zh: {
    title: '会员',
    sub: '管理旧 POS 迁移会员和储值余额',
    totalMembers: '会员数量',
    currentBalance: '当前页储值余额',
    activeMembers: '当前页活跃会员',
    searchPlaceholder: '搜索姓名 / 手机号 / 会员码',
    newMember: '新建会员',
    name: '姓名',
    phone: '手机号',
    note: '备注',
    optional: '可选',
    cancel: '取消',
    create: '创建会员',
    creating: '创建中…',
    empty: '暂无会员',
    viewDetail: '查看详情',
    balance: '余额',
    code: '会员码',
    status: '状态',
    active: '正常',
    inactive: '停用',
    loadFailed: '会员加载失败，请重试',
    createSuccess: '会员已创建',
    duplicatePhone: '该手机号已存在会员',
    createFailed: '创建会员失败',
  },
  en: {
    title: 'Members',
    sub: 'Manage migrated POS members and stored balances',
    totalMembers: 'Members',
    currentBalance: 'Balance on this page',
    activeMembers: 'Active on this page',
    searchPlaceholder: 'Search name / phone / member code',
    newMember: 'New member',
    name: 'Name',
    phone: 'Phone',
    note: 'Note',
    optional: 'Optional',
    cancel: 'Cancel',
    create: 'Create member',
    creating: 'Creating…',
    empty: 'No members yet',
    viewDetail: 'View details',
    balance: 'Balance',
    code: 'Member code',
    status: 'Status',
    active: 'Active',
    inactive: 'Inactive',
    loadFailed: 'Failed to load members',
    createSuccess: 'Member created',
    duplicatePhone: 'This phone already belongs to a member',
    createFailed: 'Failed to create member',
  },
  km: {
    title: 'សមាជិក',
    sub: 'គ្រប់គ្រងសមាជិក POS ចាស់ និងសមតុល្យ',
    totalMembers: 'ចំនួនសមាជិក',
    currentBalance: 'សមតុល្យលើទំព័រ',
    activeMembers: 'សមាជិកសកម្មលើទំព័រ',
    searchPlaceholder: 'ស្វែងរកឈ្មោះ / ទូរសព្ទ / លេខសមាជិក',
    newMember: 'បង្កើតសមាជិក',
    name: 'ឈ្មោះ',
    phone: 'ទូរសព្ទ',
    note: 'កំណត់ចំណាំ',
    optional: 'មិនចាំបាច់',
    cancel: 'បោះបង់',
    create: 'បង្កើត',
    creating: 'កំពុងបង្កើត…',
    empty: 'មិនទាន់មានសមាជិក',
    viewDetail: 'មើលលម្អិត',
    balance: 'សមតុល្យ',
    code: 'លេខសមាជិក',
    status: 'ស្ថានភាព',
    active: 'សកម្ម',
    inactive: 'ផ្អាក',
    loadFailed: 'ទាញយកសមាជិកបរាជ័យ',
    createSuccess: 'បានបង្កើតសមាជិក',
    duplicatePhone: 'លេខទូរសព្ទនេះមានសមាជិករួចហើយ',
    createFailed: 'បង្កើតសមាជិកបរាជ័យ',
  },
}

function money(value: string | number): string {
  const n = Number(value)
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : '$0.00'
}

export default function MembersPage() {
  const { lang } = useLocale()
  const c = copy[lang]
  const { storeName, effectiveRole } = useWorkMode()
  const [members, setMembers] = useState<Member[]>([])
  const [total, setTotal] = useState(0)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [creating, setCreating] = useState(false)

  const activeCount = useMemo(() => members.filter((m) => m.status === 'ACTIVE').length, [members])
  const pageBalance = useMemo(() => members.reduce((sum, m) => sum + (Number(m.balance) || 0), 0), [members])

  async function loadMembers(nextQuery = query) {
    setLoading(true)
    setError('')
    const params = new URLSearchParams({ status: 'ALL', pageSize: '50' })
    if (nextQuery.trim()) params.set('q', nextQuery.trim())
    try {
      const res = await apiFetch(`/api/members?${params}`, { cache: 'no-store' }, OWNER_CTX)
      const body = await res.json()
      if (!res.ok || body?.error) throw new Error(body?.error || c.loadFailed)
      setMembers(body.items ?? [])
      setTotal(body.pagination?.total ?? 0)
    } catch {
      setError(c.loadFailed)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadMembers('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => loadMembers(query), 280)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 2600)
    return () => clearTimeout(timer)
  }, [toast])

  async function submitCreate(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setCreating(true)
    try {
      const res = await apiFetch('/api/members', {
        method: 'POST',
        body: JSON.stringify({ name, phone, note }),
      }, OWNER_CTX)
      const body = await res.json()
      if (!res.ok || body?.error) {
        throw new Error(body?.error === 'MEMBER_PHONE_EXISTS' ? c.duplicatePhone : c.createFailed)
      }
      setToast(c.createSuccess)
      setModalOpen(false)
      setName('')
      setPhone('')
      setNote('')
      await loadMembers(query)
    } catch (err) {
      setToast(err instanceof Error ? err.message : c.createFailed)
    } finally {
      setCreating(false)
    }
  }

  return (
    <main style={s.page}>
      <header style={s.header}>
        <div style={s.avatar}>{(storeName || c.title).slice(0, 1).toUpperCase()}</div>
        <div style={s.headerText}>
          <div style={s.storeName}>{storeName || c.title}</div>
          <div style={s.headerSub}>{c.sub}</div>
        </div>
        <LangToggleBtn />
      </header>

      <section style={s.hero}>
        <div>
          <div style={s.eyebrow}>{c.title}</div>
          <h1 style={s.title}>{c.title}</h1>
          <p style={s.sub}>{c.sub}</p>
        </div>
        <button
          type="button"
          style={s.primaryBtn}
          onClick={() => setModalOpen(true)}
          disabled={effectiveRole !== 'OWNER'}
        >
          + {c.newMember}
        </button>
      </section>

      <section style={s.statsGrid}>
        <Stat label={c.totalMembers} value={String(total)} />
        <Stat label={c.currentBalance} value={money(pageBalance)} />
        <Stat label={c.activeMembers} value={String(activeCount)} />
      </section>

      <section style={s.searchCard}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={c.searchPlaceholder}
          style={s.searchInput}
        />
      </section>

      {toast && <div style={s.toast}>{toast}</div>}
      {error && <div style={s.error}>{error}</div>}

      <section style={s.list}>
        {loading ? (
          <div style={s.emptyCard}>Loading…</div>
        ) : members.length === 0 ? (
          <div style={s.emptyCard}>{c.empty}</div>
        ) : (
          members.map((m) => (
            <Link key={m.id} href={`/members/${m.id}`} style={s.memberCard}>
              <div style={s.memberTop}>
                <div>
                  <div style={s.memberName}>{m.name}</div>
                  <div style={s.memberMeta}>{c.code}: {m.memberCode}</div>
                </div>
                <div style={s.balancePill}>{money(m.balance)}</div>
              </div>
              <div style={s.memberInfo}>
                <span>{m.phone || '-'}</span>
                <span style={m.status === 'ACTIVE' ? s.activeBadge : s.inactiveBadge}>
                  {m.status === 'ACTIVE' ? c.active : c.inactive}
                </span>
              </div>
              {m.note && <div style={s.note}>{m.note}</div>}
              <div style={s.detailLink}>{c.viewDetail} →</div>
            </Link>
          ))
        )}
      </section>

      {modalOpen && (
        <div style={s.overlay} onClick={() => setModalOpen(false)}>
          <form style={s.modal} onSubmit={submitCreate} onClick={(e) => e.stopPropagation()}>
            <div style={s.modalTitle}>{c.newMember}</div>
            <label style={s.label}>{c.name}
              <input style={s.field} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </label>
            <label style={s.label}>{c.phone} <span style={s.muted}>({c.optional})</span>
              <input style={s.field} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
            <label style={s.label}>{c.note} <span style={s.muted}>({c.optional})</span>
              <textarea style={{ ...s.field, minHeight: 76, resize: 'vertical' }} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <div style={s.modalActions}>
              <button type="button" style={s.secondaryBtn} onClick={() => setModalOpen(false)}>{c.cancel}</button>
              <button type="submit" style={s.primaryBtn} disabled={!name.trim() || creating}>
                {creating ? c.creating : c.create}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={s.statCard}>
      <div style={s.statValue}>{value}</div>
      <div style={s.statLabel}>{label}</div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f7f8fa', padding: '14px 14px 92px', color: '#111827' },
  header: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, minHeight: 48 },
  avatar: { width: 42, height: 42, borderRadius: 21, background: 'linear-gradient(135deg,#1677ff,#4f46e5)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900 },
  headerText: { flex: 1, minWidth: 0 },
  storeName: { fontSize: 16, fontWeight: 850, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  headerSub: { fontSize: 12, color: '#6b7280', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  hero: { background: 'linear-gradient(135deg,#eff6ff,#f5f3ff)', borderRadius: 24, padding: 18, display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 16px 36px rgba(15,23,42,0.08)' },
  eyebrow: { fontSize: 12, color: '#2563eb', fontWeight: 800 },
  title: { margin: '4px 0', fontSize: 28, lineHeight: 1.1, letterSpacing: 0 },
  sub: { margin: 0, color: '#4b5563', fontSize: 13, lineHeight: 1.45 },
  primaryBtn: { border: 'none', borderRadius: 16, background: 'linear-gradient(135deg,#1677ff,#4f46e5)', color: '#fff', fontWeight: 850, padding: '12px 14px', minHeight: 46, whiteSpace: 'nowrap', boxShadow: '0 12px 24px rgba(37,99,235,0.25)' },
  secondaryBtn: { border: '1px solid #e5e7eb', borderRadius: 14, background: '#fff', color: '#374151', fontWeight: 800, padding: '11px 14px' },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginTop: 12 },
  statCard: { background: '#fff', borderRadius: 18, padding: 12, minHeight: 70, boxShadow: '0 10px 26px rgba(15,23,42,0.05)' },
  statValue: { fontSize: 18, fontWeight: 900, color: '#111827' },
  statLabel: { marginTop: 5, fontSize: 11, color: '#6b7280', lineHeight: 1.25 },
  searchCard: { background: '#fff', borderRadius: 18, padding: 10, marginTop: 12, boxShadow: '0 10px 26px rgba(15,23,42,0.05)' },
  searchInput: { width: '100%', height: 48, border: '1px solid #e5e7eb', borderRadius: 14, padding: '0 14px', fontSize: 15, outline: 'none', boxSizing: 'border-box' },
  toast: { marginTop: 12, background: '#ecfdf5', color: '#047857', borderRadius: 14, padding: 12, fontWeight: 750, fontSize: 13 },
  error: { marginTop: 12, background: '#fef2f2', color: '#b91c1c', borderRadius: 14, padding: 12, fontWeight: 750, fontSize: 13 },
  list: { display: 'grid', gap: 10, marginTop: 12 },
  memberCard: { display: 'block', textDecoration: 'none', color: 'inherit', background: '#fff', borderRadius: 20, padding: 14, boxShadow: '0 10px 26px rgba(15,23,42,0.05)' },
  memberTop: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  memberName: { fontSize: 17, fontWeight: 900 },
  memberMeta: { marginTop: 4, fontSize: 12, color: '#6b7280' },
  balancePill: { borderRadius: 999, padding: '7px 10px', background: '#eef2ff', color: '#3730a3', fontWeight: 900, fontSize: 13 },
  memberInfo: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 11, color: '#4b5563', fontSize: 13 },
  activeBadge: { borderRadius: 999, padding: '3px 8px', background: '#dcfce7', color: '#15803d', fontWeight: 800, fontSize: 11 },
  inactiveBadge: { borderRadius: 999, padding: '3px 8px', background: '#f3f4f6', color: '#6b7280', fontWeight: 800, fontSize: 11 },
  note: { marginTop: 10, color: '#6b7280', fontSize: 12, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
  detailLink: { marginTop: 10, color: '#1677ff', fontWeight: 850, fontSize: 13 },
  emptyCard: { background: '#fff', borderRadius: 20, padding: 24, textAlign: 'center', color: '#6b7280', boxShadow: '0 10px 26px rgba(15,23,42,0.05)' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.35)', zIndex: 120, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 14 },
  modal: { width: '100%', maxWidth: 460, background: '#fff', borderRadius: 24, padding: 18, boxShadow: '0 24px 70px rgba(15,23,42,0.22)' },
  modalTitle: { fontSize: 19, fontWeight: 900, marginBottom: 14 },
  label: { display: 'block', fontSize: 13, fontWeight: 800, color: '#374151', marginTop: 12 },
  muted: { color: '#9ca3af', fontWeight: 600 },
  field: { width: '100%', marginTop: 6, border: '1px solid #e5e7eb', borderRadius: 14, padding: '11px 12px', fontSize: 15, boxSizing: 'border-box', outline: 'none' },
  modalActions: { display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 },
}
