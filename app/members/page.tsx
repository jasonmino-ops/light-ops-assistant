'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { apiFetch, OWNER_CTX } from '@/lib/api'
import LangToggleBtn from '@/app/components/LangToggleBtn'
import { useLocale } from '@/app/components/LangProvider'
import { useWorkMode } from '@/app/components/WorkModeProvider'

const DEV_OWNER_CTX = process.env.NODE_ENV !== 'production' ? OWNER_CTX : undefined

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

type ImportPreviewRow = {
  rowNum: number
  name: string
  phone: string | null
  normalizedPhone: string | null
  balance: string
  note: string | null
  joinedAtRaw: string | null
  errors: string[]
  warnings: string[]
  canImport: boolean
}

type ImportSummary = {
  totalRows: number
  importableCount: number
  skippedCount: number
  errorCount: number
  warningCount: number
  totalImportBalance: string
}

type ImportPreview = {
  summary: ImportSummary
  rows: ImportPreviewRow[]
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
  importOldPos: string
  importTitle: string
  importDesc: string
  chooseExcel: string
  selectedFile: string
  previewImport: string
  previewing: string
  confirmImport: string
  confirmingImport: string
  importSuccess: string
  importFailed: string
  importRows: string
  importableRows: string
  skippedRows: string
  errorRows: string
  warningRows: string
  totalImportBalance: string
  rowNumber: string
  reason: string
  warnings: string
  noImportPreview: string
  backHome: string
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
    importOldPos: '导入旧 POS 会员',
    importTitle: '导入旧 POS 会员',
    importDesc: '上传 Excel，先预览校验，再确认导入。不会覆盖已有会员余额。',
    chooseExcel: '选择 Excel 文件',
    selectedFile: '已选择',
    previewImport: '预览导入',
    previewing: '预览中…',
    confirmImport: '确认导入',
    confirmingImport: '导入中…',
    importSuccess: '会员导入完成',
    importFailed: '会员导入失败',
    importRows: '总行数',
    importableRows: '可导入',
    skippedRows: '跳过',
    errorRows: '错误',
    warningRows: '警告',
    totalImportBalance: '导入余额',
    rowNumber: '行号',
    reason: '原因',
    warnings: '提示',
    noImportPreview: '请先选择 Excel 并预览',
    backHome: '返回首页',
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
    importOldPos: 'Import old POS members',
    importTitle: 'Import old POS members',
    importDesc: 'Upload Excel, preview validation first, then confirm import. Existing balances will not be overwritten.',
    chooseExcel: 'Choose Excel file',
    selectedFile: 'Selected',
    previewImport: 'Preview import',
    previewing: 'Previewing…',
    confirmImport: 'Confirm import',
    confirmingImport: 'Importing…',
    importSuccess: 'Members imported',
    importFailed: 'Member import failed',
    importRows: 'Rows',
    importableRows: 'Importable',
    skippedRows: 'Skipped',
    errorRows: 'Errors',
    warningRows: 'Warnings',
    totalImportBalance: 'Import balance',
    rowNumber: 'Row',
    reason: 'Reason',
    warnings: 'Warnings',
    noImportPreview: 'Choose an Excel file and preview first',
    backHome: 'Back home',
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
    importOldPos: 'នាំចូលសមាជិក POS ចាស់',
    importTitle: 'នាំចូលសមាជិក POS ចាស់',
    importDesc: 'ផ្ទុក Excel ពិនិត្យជាមុន រួចបញ្ជាក់នាំចូល។ មិនសរសេរជាន់លើសមតុល្យចាស់ទេ។',
    chooseExcel: 'ជ្រើសឯកសារ Excel',
    selectedFile: 'បានជ្រើស',
    previewImport: 'មើលមុននាំចូល',
    previewing: 'កំពុងពិនិត្យ…',
    confirmImport: 'បញ្ជាក់នាំចូល',
    confirmingImport: 'កំពុងនាំចូល…',
    importSuccess: 'បាននាំចូលសមាជិក',
    importFailed: 'នាំចូលសមាជិកបរាជ័យ',
    importRows: 'ចំនួនជួរ',
    importableRows: 'អាចនាំចូល',
    skippedRows: 'រំលង',
    errorRows: 'កំហុស',
    warningRows: 'ការព្រមាន',
    totalImportBalance: 'សមតុល្យនាំចូល',
    rowNumber: 'ជួរ',
    reason: 'មូលហេតុ',
    warnings: 'ការព្រមាន',
    noImportPreview: 'សូមជ្រើស Excel ហើយមើលមុន',
    backHome: 'ត្រឡប់ទំព័រដើម',
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
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [previewingImport, setPreviewingImport] = useState(false)
  const [confirmingImport, setConfirmingImport] = useState(false)

  const activeCount = useMemo(() => members.filter((m) => m.status === 'ACTIVE').length, [members])
  const pageBalance = useMemo(() => members.reduce((sum, m) => sum + (Number(m.balance) || 0), 0), [members])

  async function loadMembers(nextQuery = query) {
    setLoading(true)
    setError('')
    const params = new URLSearchParams({ status: 'ALL', pageSize: '50' })
    if (nextQuery.trim()) params.set('q', nextQuery.trim())
    try {
      const res = await apiFetch(`/api/members?${params}`, { cache: 'no-store' }, DEV_OWNER_CTX)
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
      }, DEV_OWNER_CTX)
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

  async function previewMemberImport() {
    if (!importFile) {
      setToast(c.noImportPreview)
      return
    }
    setPreviewingImport(true)
    try {
      const formData = new FormData()
      formData.set('file', importFile)
      const res = await fetch('/api/members/import/dry-run', {
        method: 'POST',
        headers: DEV_OWNER_CTX,
        body: formData,
      })
      const body = await res.json()
      if (!res.ok || body?.error) throw new Error(body?.message || body?.error || c.importFailed)
      setImportPreview(body)
    } catch (err) {
      setToast(err instanceof Error ? err.message : c.importFailed)
    } finally {
      setPreviewingImport(false)
    }
  }

  async function confirmMemberImport() {
    if (!importPreview || importPreview.summary.importableCount <= 0) {
      setToast(c.noImportPreview)
      return
    }
    setConfirmingImport(true)
    try {
      const res = await apiFetch('/api/members/import/confirm', {
        method: 'POST',
        body: JSON.stringify({ rows: importPreview.rows }),
      }, DEV_OWNER_CTX)
      const body = await res.json()
      if (!res.ok || body?.error) throw new Error(body?.message || body?.error || c.importFailed)
      setToast(`${c.importSuccess}: ${body.importedCount ?? 0}`)
      setImportOpen(false)
      setImportFile(null)
      setImportPreview(null)
      await loadMembers(query)
    } catch (err) {
      setToast(err instanceof Error ? err.message : c.importFailed)
    } finally {
      setConfirmingImport(false)
    }
  }

  return (
    <main style={s.page}>
      <header style={s.header}>
        <Link href="/home" style={s.backHome}>{c.backHome}</Link>
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
        <div style={s.heroActions}>
          {effectiveRole === 'OWNER' && (
            <button
              type="button"
              style={s.secondaryBlueBtn}
              onClick={() => setImportOpen(true)}
            >
              {c.importOldPos}
            </button>
          )}
          <button
            type="button"
            style={s.primaryBtn}
            onClick={() => setModalOpen(true)}
            disabled={effectiveRole !== 'OWNER'}
          >
            + {c.newMember}
          </button>
        </div>
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

      {importOpen && (
        <div style={s.overlay} onClick={() => setImportOpen(false)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <div style={s.modalTitle}>{c.importTitle}</div>
            <p style={s.modalDesc}>{c.importDesc}</p>
            <label style={s.uploadBox}>
              <input
                type="file"
                accept=".xlsx,.xls"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null
                  setImportFile(file)
                  setImportPreview(null)
                }}
              />
              <strong>{c.chooseExcel}</strong>
              <span>{importFile ? `${c.selectedFile}: ${importFile.name}` : 'Excel .xlsx / .xls'}</span>
            </label>
            <div style={s.modalActions}>
              <button type="button" style={s.secondaryBtn} onClick={() => setImportOpen(false)}>{c.cancel}</button>
              <button type="button" style={s.secondaryBlueBtn} onClick={previewMemberImport} disabled={!importFile || previewingImport}>
                {previewingImport ? c.previewing : c.previewImport}
              </button>
            </div>

            {importPreview && (
              <div style={s.importPreview}>
                <div style={s.importSummaryGrid}>
                  <Stat label={c.importRows} value={String(importPreview.summary.totalRows)} />
                  <Stat label={c.importableRows} value={String(importPreview.summary.importableCount)} />
                  <Stat label={c.skippedRows} value={String(importPreview.summary.skippedCount)} />
                  <Stat label={c.totalImportBalance} value={money(importPreview.summary.totalImportBalance)} />
                </div>
                {(importPreview.summary.errorCount > 0 || importPreview.summary.warningCount > 0) && (
                  <div style={s.importIssueList}>
                    {importPreview.rows
                      .filter((row) => row.errors.length > 0 || row.warnings.length > 0)
                      .slice(0, 8)
                      .map((row) => (
                        <div key={`${row.rowNum}-${row.phone ?? row.name}`} style={s.importIssue}>
                          <strong>{c.rowNumber} {row.rowNum} · {row.name}</strong>
                          {row.errors.length > 0 && <div>{c.reason}: {row.errors.join(' / ')}</div>}
                          {row.warnings.length > 0 && <div>{c.warnings}: {row.warnings.join(' / ')}</div>}
                        </div>
                      ))}
                  </div>
                )}
                <div style={s.modalActions}>
                  <button
                    type="button"
                    style={s.primaryBtn}
                    onClick={confirmMemberImport}
                    disabled={confirmingImport || importPreview.summary.importableCount <= 0}
                  >
                    {confirmingImport ? c.confirmingImport : c.confirmImport}
                  </button>
                </div>
              </div>
            )}
          </div>
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
  backHome: { border: '1px solid #dbeafe', background: '#eff6ff', color: '#1d4ed8', borderRadius: 999, padding: '8px 10px', fontSize: 12, fontWeight: 850, textDecoration: 'none', whiteSpace: 'nowrap' },
  avatar: { width: 42, height: 42, borderRadius: 21, background: 'linear-gradient(135deg,#1677ff,#4f46e5)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900 },
  headerText: { flex: 1, minWidth: 0 },
  storeName: { fontSize: 16, fontWeight: 850, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  headerSub: { fontSize: 12, color: '#6b7280', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  hero: { background: 'linear-gradient(135deg,#eff6ff,#f5f3ff)', borderRadius: 24, padding: 18, display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 16px 36px rgba(15,23,42,0.08)' },
  heroActions: { display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'stretch' },
  eyebrow: { fontSize: 12, color: '#2563eb', fontWeight: 800 },
  title: { margin: '4px 0', fontSize: 28, lineHeight: 1.1, letterSpacing: 0 },
  sub: { margin: 0, color: '#4b5563', fontSize: 13, lineHeight: 1.45 },
  primaryBtn: { border: 'none', borderRadius: 16, background: 'linear-gradient(135deg,#1677ff,#4f46e5)', color: '#fff', fontWeight: 850, padding: '12px 14px', minHeight: 46, whiteSpace: 'nowrap', boxShadow: '0 12px 24px rgba(37,99,235,0.25)' },
  secondaryBtn: { border: '1px solid #e5e7eb', borderRadius: 14, background: '#fff', color: '#374151', fontWeight: 800, padding: '11px 14px' },
  secondaryBlueBtn: { border: '1px solid #bfdbfe', borderRadius: 14, background: '#eff6ff', color: '#1d4ed8', fontWeight: 850, padding: '11px 14px', minHeight: 44, whiteSpace: 'nowrap' },
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
  modalDesc: { margin: '-6px 0 12px', color: '#6b7280', fontSize: 13, lineHeight: 1.45 },
  uploadBox: { display: 'flex', flexDirection: 'column', gap: 6, border: '1px dashed #93c5fd', borderRadius: 18, background: '#eff6ff', padding: 16, color: '#1d4ed8', cursor: 'pointer' },
  label: { display: 'block', fontSize: 13, fontWeight: 800, color: '#374151', marginTop: 12 },
  muted: { color: '#9ca3af', fontWeight: 600 },
  field: { width: '100%', marginTop: 6, border: '1px solid #e5e7eb', borderRadius: 14, padding: '11px 12px', fontSize: 15, boxSizing: 'border-box', outline: 'none' },
  modalActions: { display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 },
  importPreview: { marginTop: 14, borderTop: '1px solid #eef2f7', paddingTop: 12 },
  importSummaryGrid: { display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8 },
  importIssueList: { display: 'grid', gap: 8, marginTop: 12, maxHeight: 190, overflow: 'auto' },
  importIssue: { borderRadius: 14, background: '#fff7ed', color: '#9a3412', padding: 10, fontSize: 12, lineHeight: 1.45 },
}
