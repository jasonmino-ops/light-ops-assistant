'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { apiFetch, OWNER_CTX } from '@/lib/api'
import { OPS_RELEASE_STATUS, type ReleaseStatusItem } from '@/lib/ops-release-status'

function shortSha(sha: string) {
  return sha.slice(0, 12)
}

function formatRecordedDate(value: string) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('zh-CN', {
    timeZone: 'Asia/Phnom_Penh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

export default function OpsReleaseStatusPage() {
  const [authState, setAuthState] = useState<'checking' | 'ok' | 'denied'>('checking')

  useEffect(() => {
    let cancelled = false
    apiFetch('/api/ops/check', undefined, OWNER_CTX)
      .then((response) => {
        if (!cancelled) setAuthState(response.ok ? 'ok' : 'denied')
      })
      .catch(() => {
        if (!cancelled) setAuthState('denied')
      })
    return () => { cancelled = true }
  }, [])

  if (authState === 'checking') return <div style={s.center}>检查运营后台权限...</div>

  if (authState === 'denied') {
    return (
      <div style={s.center}>
        <div style={{ fontSize: 40 }}>⛔</div>
        <p style={s.denied}>无权限访问版本与待发布</p>
        <Link href="/ops" style={s.backLink}>← 返回运营后台</Link>
      </div>
    )
  }

  return (
    <div data-release-status-page="readonly" style={s.page}>
      <header style={s.header}>
        <div>
          <Link href="/ops" style={s.backLink}>← 返回运营后台</Link>
          <div style={s.kicker}>Founder / Ops · Read-only</div>
          <h1 style={s.title}>版本与待发布</h1>
          <p style={s.subtitle}>看清哪些修改已经开发完成，以及哪些仍在等待发布或验收。</p>
        </div>
        <div style={s.readonlyBadge}>只读</div>
      </header>

      <main style={s.main}>
        <div style={s.recordedNote}>
          状态源：仓库记录值 · 最近记录 {formatRecordedDate(OPS_RELEASE_STATUS.updatedAt)} · 不代表实时发布监控
        </div>

        <section aria-label="当前版本" style={s.summaryGrid}>
          <SummaryCard label="当前线上版本" value={shortSha(OPS_RELEASE_STATUS.production.sha)} detail="Production SHA" tone="good" />
          <SummaryCard label="线上状态" value={OPS_RELEASE_STATUS.production.status === 'READY' ? 'READY' : '未知'} detail="记录中的 Production 状态" tone="good" />
          <SummaryCard label="当前开发主线" value={shortSha(OPS_RELEASE_STATUS.main.sha)} detail="Main SHA" />
          <SummaryCard label="待发布数量" value={OPS_RELEASE_STATUS.pendingItems.length} detail="已在 Main，尚未进入 Production" tone={OPS_RELEASE_STATUS.pendingItems.length > 0 ? 'warn' : 'good'} />
        </section>

        <StatusSection title="待发布" count={OPS_RELEASE_STATUS.pendingItems.length}>
          {OPS_RELEASE_STATUS.pendingItems.length === 0 ? <EmptyState>当前没有已记录的待发布修改</EmptyState> : <ItemList items={OPS_RELEASE_STATUS.pendingItems} />}
        </StatusSection>

        <StatusSection title="已发布待验收" count={OPS_RELEASE_STATUS.releasedAwaitingAcceptance.length}>
          {OPS_RELEASE_STATUS.releasedAwaitingAcceptance.length === 0 ? <EmptyState>暂无待验收项目</EmptyState> : <ItemList items={OPS_RELEASE_STATUS.releasedAwaitingAcceptance} />}
        </StatusSection>

        <StatusSection title="最近已完成" count={OPS_RELEASE_STATUS.recentlyCompleted.length}>
          {OPS_RELEASE_STATUS.recentlyCompleted.length === 0 ? <EmptyState>暂无可靠的已完成记录</EmptyState> : <ItemList items={OPS_RELEASE_STATUS.recentlyCompleted} />}
        </StatusSection>
      </main>
    </div>
  )
}

function SummaryCard({ label, value, detail, tone = 'neutral' }: { label: string; value: string | number; detail: string; tone?: 'neutral' | 'good' | 'warn' }) {
  return (
    <div style={s.summaryCard}>
      <div style={s.summaryLabel}>{label}</div>
      <div style={{ ...s.summaryValue, color: tone === 'good' ? '#166534' : tone === 'warn' ? '#92400e' : '#111827' }}>{value}</div>
      <div style={s.summaryDetail}>{detail}</div>
    </div>
  )
}

function StatusSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section style={s.section}>
      <div style={s.sectionHeading}>
        <h2 style={s.sectionTitle}>{title}</h2>
        <span style={s.count}>{count}</span>
      </div>
      {children}
    </section>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div style={s.empty}>{children}</div>
}

function ItemList({ items }: { items: ReleaseStatusItem[] }) {
  return <div style={s.itemList}>{items.map((item) => <ReleaseItem key={item.taskId} item={item} />)}</div>
}

function ReleaseItem({ item }: { item: ReleaseStatusItem }) {
  return (
    <article style={s.item}>
      <div style={s.itemTop}>
        <div>
          <h3 style={s.itemTitle}>{item.title}</h3>
          <div style={s.taskId}>{item.taskId}</div>
        </div>
        <span style={s.statusBadge}>{item.status}</span>
      </div>
      <p style={s.itemSummary}>{item.summary}</p>
      <div style={s.evidenceGrid}>
        <Evidence label="Implemented on Main" value={item.implementedOnMain ? 'YES' : 'NO'} positive={item.implementedOnMain} />
        <Evidence label="Released to Production" value={item.releasedToProduction ? 'YES' : 'NO'} positive={item.releasedToProduction} />
        <Evidence label="V727 可见" value={item.visibleOnField === true ? 'YES' : item.visibleOnField === false ? 'NO' : '发布后待确认'} positive={item.visibleOnField === true} />
        <Evidence label="Visual Acceptance" value={item.visualAcceptance} />
        <Evidence label="FIELD Verified" value={item.fieldVerified ? 'YES' : 'NO'} positive={item.fieldVerified} />
      </div>
    </article>
  )
}

function Evidence({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div style={s.evidence}>
      <div style={s.evidenceLabel}>{label}</div>
      <div style={{ ...s.evidenceValue, color: positive === true ? '#166534' : positive === false ? '#92400e' : '#374151' }}>{value}</div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f6f7f9', color: '#111827' },
  header: { padding: '24px 18px 18px', background: '#fff', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 },
  main: { maxWidth: 1180, margin: '0 auto', padding: '20px 18px 48px' },
  backLink: { display: 'inline-flex', alignItems: 'center', minHeight: 36, padding: '0 10px', marginBottom: 10, border: '1px solid #d1d5db', borderRadius: 8, color: '#374151', textDecoration: 'none', background: '#fff' },
  kicker: { color: '#6b7280', fontSize: 12, letterSpacing: 0.4, textTransform: 'uppercase' as const },
  title: { margin: '4px 0 0', fontSize: 30, lineHeight: 1.2 },
  subtitle: { margin: '8px 0 0', color: '#4b5563', fontSize: 14 },
  readonlyBadge: { border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8', borderRadius: 999, padding: '6px 11px', fontSize: 12, fontWeight: 700 },
  recordedNote: { marginBottom: 16, color: '#6b7280', fontSize: 13 },
  summaryGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, marginBottom: 20 },
  summaryCard: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, minHeight: 112 },
  summaryLabel: { color: '#6b7280', fontSize: 13 },
  summaryValue: { marginTop: 9, fontSize: 22, fontWeight: 750, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', overflowWrap: 'anywhere' },
  summaryDetail: { marginTop: 7, color: '#6b7280', fontSize: 12 },
  section: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginBottom: 16 },
  sectionHeading: { display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 },
  sectionTitle: { margin: 0, fontSize: 18 },
  count: { minWidth: 24, padding: '2px 7px', borderRadius: 999, background: '#f3f4f6', color: '#4b5563', fontSize: 12, textAlign: 'center' as const },
  empty: { border: '1px dashed #d1d5db', borderRadius: 9, padding: '22px 16px', color: '#6b7280', textAlign: 'center' as const, fontSize: 14 },
  itemList: { display: 'grid', gap: 12 },
  item: { border: '1px solid #dbeafe', borderRadius: 10, padding: 16, background: '#f8fbff' },
  itemTop: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  itemTitle: { margin: 0, fontSize: 17 },
  taskId: { marginTop: 5, color: '#6b7280', fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', overflowWrap: 'anywhere' },
  statusBadge: { flexShrink: 0, border: '1px solid #93c5fd', borderRadius: 999, background: '#eff6ff', color: '#1d4ed8', padding: '5px 9px', fontSize: 12, fontWeight: 700 },
  itemSummary: { margin: '13px 0 15px', color: '#374151', lineHeight: 1.6, fontSize: 14 },
  evidenceGrid: { display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8 },
  evidence: { borderTop: '1px solid #dbeafe', paddingTop: 9 },
  evidenceLabel: { color: '#6b7280', fontSize: 11, lineHeight: 1.4 },
  evidenceValue: { marginTop: 4, fontSize: 12, fontWeight: 700, overflowWrap: 'anywhere' },
  center: { minHeight: '100vh', display: 'grid', placeItems: 'center', color: '#4b5563', background: '#f6f7f9' },
  denied: { color: '#b91c1c', fontWeight: 700 },
}
