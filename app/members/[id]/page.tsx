'use client'

import { FormEvent, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { apiFetch, OWNER_CTX } from '@/lib/api'
import LangToggleBtn from '@/app/components/LangToggleBtn'
import { useLocale } from '@/app/components/LangProvider'
import { useWorkMode } from '@/app/components/WorkModeProvider'

const DEV_OWNER_CTX = process.env.NODE_ENV !== 'production' ? OWNER_CTX : undefined

type Member = {
  id: string
  memberCode: string
  name: string
  phone: string | null
  balance: string
  status: 'ACTIVE' | 'INACTIVE'
  telegramUsername: string | null
  note: string | null
  createdAt: string
}

type Ledger = {
  id: string
  type: 'IMPORT' | 'RECHARGE' | 'CONSUME' | 'REFUND' | 'ADJUST'
  sourceType: string
  amount: string
  balanceBefore: string
  balanceAfter: string
  note: string | null
  createdAt: string
}

type DetailBody = { member: Member; recentLedgers: Ledger[] }

type Copy = {
  back: string
  title: string
  currentBalance: string
  memberCode: string
  phone: string
  status: string
  active: string
  inactive: string
  createdAt: string
  telegram: string
  note: string
  noNote: string
  recharge: string
  adjust: string
  amount: string
  adjustAmount: string
  noteRequired: string
  submit: string
  submitting: string
  cancel: string
  ledger: string
  before: string
  after: string
  emptyLedger: string
  loadFailed: string
  actionSuccess: string
  actionFailed: string
  ownerOnly: string
}

const copy: Record<'zh' | 'en' | 'km', Copy> = {
  zh: {
    back: '返回会员',
    title: '会员详情',
    currentBalance: '当前余额',
    memberCode: '会员码',
    phone: '手机号',
    status: '状态',
    active: '正常',
    inactive: '停用',
    createdAt: '创建时间',
    telegram: 'Telegram',
    note: '备注',
    noNote: '暂无备注',
    recharge: '充值',
    adjust: '调整余额',
    amount: '金额',
    adjustAmount: '调整金额，可正可负',
    noteRequired: '备注必填',
    submit: '确认',
    submitting: '提交中…',
    cancel: '取消',
    ledger: '余额流水',
    before: '变动前',
    after: '变动后',
    emptyLedger: '暂无流水',
    loadFailed: '会员详情加载失败',
    actionSuccess: '操作成功',
    actionFailed: '操作失败',
    ownerOnly: '仅老板可充值或调整余额',
  },
  en: {
    back: 'Back to members',
    title: 'Member details',
    currentBalance: 'Current balance',
    memberCode: 'Member code',
    phone: 'Phone',
    status: 'Status',
    active: 'Active',
    inactive: 'Inactive',
    createdAt: 'Created at',
    telegram: 'Telegram',
    note: 'Note',
    noNote: 'No note',
    recharge: 'Recharge',
    adjust: 'Adjust balance',
    amount: 'Amount',
    adjustAmount: 'Adjustment amount, positive or negative',
    noteRequired: 'Note is required',
    submit: 'Confirm',
    submitting: 'Submitting…',
    cancel: 'Cancel',
    ledger: 'Balance ledger',
    before: 'Before',
    after: 'After',
    emptyLedger: 'No ledger entries',
    loadFailed: 'Failed to load member',
    actionSuccess: 'Done',
    actionFailed: 'Action failed',
    ownerOnly: 'Owner only: recharge or adjust balance',
  },
  km: {
    back: 'ត្រឡប់ទៅសមាជិក',
    title: 'ព័ត៌មានសមាជិក',
    currentBalance: 'សមតុល្យបច្ចុប្បន្ន',
    memberCode: 'លេខសមាជិក',
    phone: 'ទូរសព្ទ',
    status: 'ស្ថានភាព',
    active: 'សកម្ម',
    inactive: 'ផ្អាក',
    createdAt: 'ថ្ងៃបង្កើត',
    telegram: 'Telegram',
    note: 'កំណត់ចំណាំ',
    noNote: 'មិនមានកំណត់ចំណាំ',
    recharge: 'បញ្ចូលប្រាក់',
    adjust: 'កែសម្រួលសមតុល្យ',
    amount: 'ចំនួនប្រាក់',
    adjustAmount: 'ចំនួនកែសម្រួល វិជ្ជមាន ឬ អវិជ្ជមាន',
    noteRequired: 'ត្រូវការកំណត់ចំណាំ',
    submit: 'បញ្ជាក់',
    submitting: 'កំពុងផ្ញើ…',
    cancel: 'បោះបង់',
    ledger: 'ប្រវត្តិសមតុល្យ',
    before: 'មុន',
    after: 'ក្រោយ',
    emptyLedger: 'មិនទាន់មានប្រវត្តិ',
    loadFailed: 'ទាញយកសមាជិកបរាជ័យ',
    actionSuccess: 'បានជោគជ័យ',
    actionFailed: 'ប្រតិបត្តិការបរាជ័យ',
    ownerOnly: 'សម្រាប់ម្ចាស់ហាងប៉ុណ្ណោះ',
  },
}

function money(value: string | number): string {
  const n = Number(value)
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : '$0.00'
}

function formatDate(value: string): string {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString()
}

export default function MemberDetailPage() {
  const params = useParams<{ id: string }>()
  const { lang } = useLocale()
  const c = copy[lang]
  const { effectiveRole } = useWorkMode()
  const [data, setData] = useState<DetailBody | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [modal, setModal] = useState<'recharge' | 'adjust' | null>(null)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function loadDetail() {
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch(`/api/members/${encodeURIComponent(params.id)}`, { cache: 'no-store' }, DEV_OWNER_CTX)
      const body = await res.json()
      if (!res.ok || body?.error) throw new Error(body?.error || c.loadFailed)
      setData(body)
    } catch {
      setError(c.loadFailed)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (params.id) loadDetail()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 2600)
    return () => clearTimeout(timer)
  }, [toast])

  function openModal(next: 'recharge' | 'adjust') {
    setModal(next)
    setAmount('')
    setNote('')
  }

  async function submitAction(e: FormEvent) {
    e.preventDefault()
    if (!modal) return
    if (modal === 'adjust' && !note.trim()) {
      setToast(c.noteRequired)
      return
    }
    setSubmitting(true)
    try {
      const res = await apiFetch(`/api/members/${encodeURIComponent(params.id)}/${modal}`, {
        method: 'POST',
        body: JSON.stringify({ amount, note }),
      }, DEV_OWNER_CTX)
      const body = await res.json()
      if (!res.ok || body?.error) throw new Error(body?.error || c.actionFailed)
      setToast(c.actionSuccess)
      setModal(null)
      await loadDetail()
    } catch (err) {
      setToast(err instanceof Error ? err.message : c.actionFailed)
    } finally {
      setSubmitting(false)
    }
  }

  const member = data?.member

  return (
    <main style={s.page}>
      <header style={s.header}>
        <Link href="/members" style={s.back}>‹ {c.back}</Link>
        <LangToggleBtn />
      </header>

      {toast && <div style={s.toast}>{toast}</div>}
      {error && <div style={s.error}>{error}</div>}

      {loading ? (
        <div style={s.card}>Loading…</div>
      ) : member ? (
        <>
          <section style={s.hero}>
            <div>
              <div style={s.eyebrow}>{c.title}</div>
              <h1 style={s.name}>{member.name}</h1>
              <div style={s.code}>{c.memberCode}: {member.memberCode}</div>
            </div>
            <div style={s.balanceBox}>
              <div style={s.balanceLabel}>{c.currentBalance}</div>
              <div style={s.balance}>{money(member.balance)}</div>
            </div>
          </section>

          <section style={s.card}>
            <Info label={c.phone} value={member.phone || '-'} />
            <Info label={c.status} value={member.status === 'ACTIVE' ? c.active : c.inactive} />
            <Info label={c.createdAt} value={formatDate(member.createdAt)} />
            {member.telegramUsername && <Info label={c.telegram} value={`@${member.telegramUsername}`} />}
            <Info label={c.note} value={member.note || c.noNote} />
          </section>

          <section style={s.actionCard}>
            {effectiveRole === 'OWNER' ? (
              <div style={s.actionRow}>
                <button type="button" style={s.primaryBtn} onClick={() => openModal('recharge')}>+ {c.recharge}</button>
                <button type="button" style={s.secondaryBtn} onClick={() => openModal('adjust')}>{c.adjust}</button>
              </div>
            ) : (
              <div style={s.ownerOnly}>{c.ownerOnly}</div>
            )}
          </section>

          <section style={s.ledgerSection}>
            <div style={s.sectionTitle}>{c.ledger}</div>
            {!data.recentLedgers.length ? (
              <div style={s.card}>{c.emptyLedger}</div>
            ) : (
              <div style={s.ledgerList}>
                {data.recentLedgers.map((l) => (
                  <div key={l.id} style={s.ledgerCard}>
                    <div style={s.ledgerTop}>
                      <div>
                        <div style={s.ledgerType}>{l.type}</div>
                        <div style={s.ledgerMeta}>{l.sourceType} · {formatDate(l.createdAt)}</div>
                      </div>
                      <div style={Number(l.amount) >= 0 ? s.amountPlus : s.amountMinus}>
                        {Number(l.amount) >= 0 ? '+' : ''}{money(l.amount)}
                      </div>
                    </div>
                    <div style={s.ledgerBalances}>
                      {c.before}: {money(l.balanceBefore)} · {c.after}: {money(l.balanceAfter)}
                    </div>
                    {l.note && <div style={s.note}>{l.note}</div>}
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}

      {modal && (
        <div style={s.overlay} onClick={() => setModal(null)}>
          <form style={s.modal} onSubmit={submitAction} onClick={(e) => e.stopPropagation()}>
            <div style={s.modalTitle}>{modal === 'recharge' ? c.recharge : c.adjust}</div>
            <label style={s.label}>{modal === 'recharge' ? c.amount : c.adjustAmount}
              <input style={s.field} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoFocus />
            </label>
            <label style={s.label}>{c.note}{modal === 'adjust' ? '' : ` (${copy[lang].note})`}
              <textarea style={{ ...s.field, minHeight: 78, resize: 'vertical' }} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <div style={s.modalActions}>
              <button type="button" style={s.secondaryBtn} onClick={() => setModal(null)}>{c.cancel}</button>
              <button type="submit" style={s.primaryBtn} disabled={submitting || !amount.trim()}>
                {submitting ? c.submitting : c.submit}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div style={s.infoRow}>
      <span style={s.infoLabel}>{label}</span>
      <span style={s.infoValue}>{value}</span>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f7f8fa', padding: '14px 14px 92px', color: '#111827' },
  header: { minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  back: { color: '#1677ff', textDecoration: 'none', fontSize: 14, fontWeight: 850 },
  hero: { background: 'linear-gradient(135deg,#ecfdf5,#eff6ff)', borderRadius: 24, padding: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, boxShadow: '0 16px 36px rgba(15,23,42,0.08)' },
  eyebrow: { fontSize: 12, color: '#059669', fontWeight: 850 },
  name: { margin: '4px 0', fontSize: 26, lineHeight: 1.1, letterSpacing: 0 },
  code: { color: '#4b5563', fontSize: 12, fontWeight: 650 },
  balanceBox: { textAlign: 'right', flexShrink: 0 },
  balanceLabel: { color: '#6b7280', fontSize: 11, fontWeight: 750 },
  balance: { marginTop: 4, color: '#047857', fontSize: 24, fontWeight: 950 },
  card: { background: '#fff', borderRadius: 20, padding: 15, marginTop: 12, boxShadow: '0 10px 26px rgba(15,23,42,0.05)' },
  infoRow: { display: 'flex', justifyContent: 'space-between', gap: 14, padding: '9px 0', borderBottom: '1px solid #f3f4f6' },
  infoLabel: { color: '#6b7280', fontSize: 13 },
  infoValue: { color: '#111827', fontSize: 13, fontWeight: 800, textAlign: 'right' },
  actionCard: { background: '#fff', borderRadius: 20, padding: 12, marginTop: 12, boxShadow: '0 10px 26px rgba(15,23,42,0.05)' },
  actionRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  primaryBtn: { border: 'none', borderRadius: 16, background: 'linear-gradient(135deg,#1677ff,#4f46e5)', color: '#fff', fontWeight: 850, padding: '12px 14px', minHeight: 46, boxShadow: '0 12px 24px rgba(37,99,235,0.25)' },
  secondaryBtn: { border: '1px solid #e5e7eb', borderRadius: 16, background: '#fff', color: '#374151', fontWeight: 850, padding: '12px 14px', minHeight: 46 },
  ownerOnly: { color: '#6b7280', fontSize: 13, padding: 4 },
  ledgerSection: { marginTop: 14 },
  sectionTitle: { fontSize: 16, fontWeight: 900, margin: '0 0 10px 2px' },
  ledgerList: { display: 'grid', gap: 10 },
  ledgerCard: { background: '#fff', borderRadius: 18, padding: 13, boxShadow: '0 10px 26px rgba(15,23,42,0.05)' },
  ledgerTop: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  ledgerType: { fontWeight: 900, fontSize: 14 },
  ledgerMeta: { marginTop: 4, color: '#6b7280', fontSize: 12 },
  amountPlus: { color: '#047857', fontSize: 16, fontWeight: 950 },
  amountMinus: { color: '#dc2626', fontSize: 16, fontWeight: 950 },
  ledgerBalances: { marginTop: 9, fontSize: 12, color: '#4b5563' },
  note: { marginTop: 8, fontSize: 12, color: '#6b7280', lineHeight: 1.4 },
  toast: { marginBottom: 12, background: '#ecfdf5', color: '#047857', borderRadius: 14, padding: 12, fontWeight: 750, fontSize: 13 },
  error: { marginBottom: 12, background: '#fef2f2', color: '#b91c1c', borderRadius: 14, padding: 12, fontWeight: 750, fontSize: 13 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.35)', zIndex: 120, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 14 },
  modal: { width: '100%', maxWidth: 460, background: '#fff', borderRadius: 24, padding: 18, boxShadow: '0 24px 70px rgba(15,23,42,0.22)' },
  modalTitle: { fontSize: 19, fontWeight: 900, marginBottom: 14 },
  label: { display: 'block', fontSize: 13, fontWeight: 800, color: '#374151', marginTop: 12 },
  field: { width: '100%', marginTop: 6, border: '1px solid #e5e7eb', borderRadius: 14, padding: '11px 12px', fontSize: 15, boxSizing: 'border-box', outline: 'none' },
  modalActions: { display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 },
}
