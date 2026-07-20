'use client'

import type { CSSProperties, ReactNode } from 'react'

const STATUS_TONES: Record<string, CSSProperties> = {
  ACTIVE: { color: '#166534', background: '#dcfce7', borderColor: '#86efac' },
  ALLOWED: { color: '#166534', background: '#dcfce7', borderColor: '#86efac' },
  TRIAL: { color: '#1d4ed8', background: '#dbeafe', borderColor: '#93c5fd' },
  OFFLINE: { color: '#475569', background: '#f1f5f9', borderColor: '#cbd5e1' },
  NOT_ACTIVATED: { color: '#475569', background: '#f1f5f9', borderColor: '#cbd5e1' },
  NONE: { color: '#475569', background: '#f1f5f9', borderColor: '#cbd5e1' },
  USED: { color: '#475569', background: '#f1f5f9', borderColor: '#cbd5e1' },
  BLOCKED: { color: '#991b1b', background: '#fee2e2', borderColor: '#fca5a5' },
  REVOKED: { color: '#991b1b', background: '#fee2e2', borderColor: '#fca5a5' },
  EXPIRED: { color: '#991b1b', background: '#fee2e2', borderColor: '#fca5a5' },
  CANCELLED: { color: '#991b1b', background: '#fee2e2', borderColor: '#fca5a5' },
  SUCCESS: { color: '#166534', background: '#dcfce7', borderColor: '#86efac' },
  DENIED: { color: '#991b1b', background: '#fee2e2', borderColor: '#fca5a5' },
  FAILED: { color: '#991b1b', background: '#fee2e2', borderColor: '#fca5a5' },
}

export function StatusBadge({ value, label }: { value: string; label?: string }) {
  const tone = STATUS_TONES[value] ?? {
    color: '#92400e', background: '#fef3c7', borderColor: '#fcd34d',
  }
  return <span style={{ ...s.badge, ...tone }}>{label ?? value.replaceAll('_', ' ')}</span>
}

export function PageHeading({ title, meta }: { title: string; meta?: string }) {
  return (
    <div style={s.pageHeading}>
      <h1 style={s.title}>{title}</h1>
      {meta && <div style={s.meta}>{meta}</div>}
    </div>
  )
}

export function SearchBar({
  value,
  onChange,
  onSubmit,
  placeholder,
  children,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  placeholder: string
  children?: ReactNode
}) {
  return (
    <form
      className="desktop-search-bar"
      style={s.searchBar}
      onSubmit={(event) => { event.preventDefault(); onSubmit() }}
    >
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        style={s.searchInput}
        maxLength={100}
      />
      {children}
      <button type="submit" style={s.searchButton}>搜索</button>
    </form>
  )
}

export function Pagination({
  page,
  totalPages,
  total,
  onChange,
}: {
  page: number
  totalPages: number
  total: number
  onChange: (page: number) => void
}) {
  return (
    <div style={s.pagination}>
      <span style={s.meta}>共 {total} 条</span>
      <div style={s.pageActions}>
        <button type="button" style={s.pageButton} disabled={page <= 1} onClick={() => onChange(page - 1)}>上一页</button>
        <span style={s.pageCount}>{page} / {totalPages}</span>
        <button type="button" style={s.pageButton} disabled={page >= totalPages} onClick={() => onChange(page + 1)}>下一页</button>
      </div>
    </div>
  )
}

export function LoadingState() {
  return <div style={s.state}>加载中...</div>
}

export function ErrorState({ message }: { message: string }) {
  return <div style={{ ...s.state, ...s.error }}>{message}</div>
}

export function fmtDateTime(value: string | null) {
  if (!value) return '未上报'
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Phnom_Penh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export const sharedStyles: Record<string, CSSProperties> = {
  content: {
    width: 'min(1180px, calc(100vw - 28px))',
    margin: '0 auto',
    padding: '22px 0 42px',
  },
  section: {
    borderTop: '1px solid #e2e8f0',
    marginTop: 18,
    paddingTop: 16,
  },
  list: { display: 'grid', gap: 10 },
  primaryButton: {
    minHeight: 38,
    padding: '0 14px',
    border: 'none',
    borderRadius: 6,
    background: '#111827',
    color: '#fff',
    fontSize: 13,
    fontWeight: 800,
    cursor: 'pointer',
  },
  secondaryButton: {
    minHeight: 38,
    padding: '0 14px',
    border: '1px solid #cbd5e1',
    borderRadius: 6,
    background: '#fff',
    color: '#1f2937',
    fontSize: 13,
    fontWeight: 800,
    cursor: 'pointer',
  },
  dangerButton: {
    minHeight: 36,
    padding: '0 13px',
    border: '1px solid #dc2626',
    borderRadius: 6,
    background: '#fff',
    color: '#b91c1c',
    fontSize: 13,
    fontWeight: 800,
    cursor: 'pointer',
  },
}

const s: Record<string, CSSProperties> = {
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 22,
    maxWidth: '100%',
    padding: '1px 7px',
    border: '1px solid',
    borderRadius: 6,
    fontSize: 11,
    lineHeight: 1.2,
    fontWeight: 900,
    whiteSpace: 'nowrap',
  },
  pageHeading: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 14,
    marginBottom: 16,
  },
  title: { margin: 0, color: '#111827', fontSize: 21, lineHeight: 1.25, letterSpacing: 0 },
  meta: { color: '#64748b', fontSize: 12, fontWeight: 700 },
  searchBar: {
    display: 'grid',
    gridTemplateColumns: 'minmax(240px, 1fr) auto auto',
    gap: 8,
    alignItems: 'center',
    padding: '12px 0 16px',
  },
  searchInput: {
    width: '100%',
    height: 40,
    boxSizing: 'border-box',
    border: '1px solid #cbd5e1',
    borderRadius: 6,
    padding: '0 11px',
    color: '#111827',
    background: '#fff',
    fontSize: 14,
    outline: 'none',
  },
  searchButton: {
    height: 40,
    padding: '0 16px',
    border: 'none',
    borderRadius: 6,
    background: '#2563eb',
    color: '#fff',
    fontSize: 13,
    fontWeight: 900,
    cursor: 'pointer',
  },
  pagination: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginTop: 16,
  },
  pageActions: { display: 'flex', alignItems: 'center', gap: 8 },
  pageButton: {
    height: 34,
    padding: '0 11px',
    border: '1px solid #cbd5e1',
    borderRadius: 6,
    background: '#fff',
    color: '#334155',
    fontSize: 12,
    fontWeight: 800,
    cursor: 'pointer',
  },
  pageCount: { minWidth: 52, textAlign: 'center', color: '#475569', fontSize: 12, fontWeight: 800 },
  state: {
    padding: '32px 14px',
    borderTop: '1px solid #e2e8f0',
    color: '#64748b',
    textAlign: 'center',
    fontSize: 13,
    fontWeight: 700,
  },
  error: { color: '#991b1b', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6 },
}
