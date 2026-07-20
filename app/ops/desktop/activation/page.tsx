'use client'

import type { CSSProperties } from 'react'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { DesktopStore, StoresResponse } from '../_components/types'
import {
  ErrorState,
  LoadingState,
  PageHeading,
  Pagination,
  SearchBar,
  StatusBadge,
  fmtDateTime,
  sharedStyles,
} from '../_components/ui'

type IssuedPin = {
  pin: string
  expiresAt: string
  pinTtlHours: number
  replacedActivePin: boolean
  store: { code: string; name: string }
}

const ERROR_MESSAGES: Record<string, string> = {
  FORBIDDEN: '当前账号没有 Desktop 管理权限。',
  OPS_ADMIN_REQUIRED: '当前账号没有 Desktop 管理权限。',
  STORE_NOT_FOUND: '门店不存在，请刷新后重试。',
  SUBSCRIPTION_BLOCKED: 'Subscription blocked，无法生成激活 PIN。',
  TENANT_INACTIVE: '商户已停用，无法生成激活 PIN。',
  STORE_INACTIVE: '门店已停用，无法生成激活 PIN。',
  CONFLICT_RETRY_REQUIRED: '生成请求发生冲突，请刷新后重试。',
  INTERNAL_ERROR: '服务端暂时无法完成请求。',
}

async function responseError(response: Response) {
  const body = await response.json().catch(() => ({}))
  const code = typeof body?.error === 'string' ? body.error : `HTTP_${response.status}`
  return `${ERROR_MESSAGES[code] ?? '请求失败，请稍后重试。'} Reference: ${code}`
}

export default function DesktopActivationPage() {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [data, setData] = useState<StoresResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirmStore, setConfirmStore] = useState<DesktopStore | null>(null)
  const [issued, setIssued] = useState<IssuedPin | null>(null)
  const [issuing, setIssuing] = useState(false)
  const [copied, setCopied] = useState(false)

  async function loadStores(page: number, search = query) {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ view: 'stores', page: String(page), pageSize: '10' })
      if (search.trim()) params.set('query', search.trim())
      const response = await fetch(`/api/ops/desktop-management?${params}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(await responseError(response))
      setData(await response.json() as StoresResponse)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadStores(1, '') }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function submitSearch() {
    const nextQuery = input.trim()
    setQuery(nextQuery)
    setIssued(null)
    setCopied(false)
    loadStores(1, nextQuery)
  }

  async function issuePin() {
    if (!confirmStore || issuing) return
    setIssuing(true)
    setError('')
    try {
      const response = await fetch('/api/ops/desktop-activation', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeCode: confirmStore.storeCode }),
      })
      if (!response.ok) throw new Error(await responseError(response))
      setIssued(await response.json() as IssuedPin)
      setCopied(false)
      setConfirmStore(null)
      await loadStores(data?.page ?? 1)
    } catch (issueError) {
      setError(issueError instanceof Error ? issueError.message : '生成失败')
    } finally {
      setIssuing(false)
    }
  }

  async function copyPin() {
    if (!issued?.pin) return
    try {
      await navigator.clipboard.writeText(issued.pin)
      setCopied(true)
    } catch {
      setError('复制失败，请手动读取 PIN。Reference: COPY_FAILED')
    }
  }

  return (
    <main style={sharedStyles.content}>
      <PageHeading title="Desktop Activation" />
      <SearchBar
        value={input}
        onChange={setInput}
        onSubmit={submitSearch}
        placeholder="搜索 Store Code、Store Name 或 Tenant"
      />

      {error && <ErrorState message={error} />}
      {loading && <LoadingState />}

      {!loading && data && (
        <>
          <section style={sharedStyles.list} aria-label="Desktop activation stores">
            {data.stores.length === 0 ? (
              <div style={s.empty}>没有符合条件的门店</div>
            ) : data.stores.map((store) => (
              <StoreActivationRow key={store.storeId} store={store} onGenerate={() => setConfirmStore(store)} />
            ))}
          </section>
          <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onChange={(page) => loadStores(page)} />
        </>
      )}

      {confirmStore && (
        <div style={s.overlay} role="presentation">
          <section style={s.modal} role="dialog" aria-modal="true" aria-labelledby="generate-pin-title">
            <h2 id="generate-pin-title" style={s.modalTitle}>Generate Activation PIN</h2>
            <div style={s.confirmRows}>
              <ConfirmRow label="Store" value={`${confirmStore.storeName} · ${confirmStore.storeCode}`} />
              <ConfirmRow label="Tenant" value={confirmStore.tenantName} />
              <ConfirmRow label="Subscription" value={confirmStore.subscription.status} />
            </div>
            <div style={s.warning}>
              PIN 只显示一次。关闭结果后无法再次查看。
              {confirmStore.currentPinStatus === 'ACTIVE' ? ' 当前有效 PIN 将立即失效。' : ''}
            </div>
            <div style={s.modalActions}>
              <button type="button" style={sharedStyles.secondaryButton} disabled={issuing} onClick={() => setConfirmStore(null)}>取消</button>
              <button type="button" style={sharedStyles.primaryButton} disabled={issuing} onClick={issuePin}>
                {issuing ? '生成中...' : '确认生成'}
              </button>
            </div>
          </section>
        </div>
      )}

      {issued && (
        <div style={s.overlay} role="presentation">
          <section style={{ ...s.modal, ...s.pinModal }} role="dialog" aria-modal="true" aria-labelledby="pin-result-title">
            <div style={s.resultHeader}>
              <div>
                <div style={s.success}>PIN 已生成</div>
                <h2 id="pin-result-title" style={s.modalTitle}>{issued.store.name}</h2>
              </div>
              <StatusBadge value="ACTIVE" />
            </div>
            <div style={s.pinDisplay} aria-label="activation pin">{issued.pin}</div>
            <div style={s.pinMeta}>到期时间 {fmtDateTime(issued.expiresAt)} · 有效 {issued.pinTtlHours} 小时</div>
            <div style={s.warning}>请立即使用。关闭此窗口后无法再次查看。</div>
            <div style={s.modalActions}>
              <button type="button" style={sharedStyles.secondaryButton} onClick={() => { setIssued(null); setCopied(false) }}>关闭并清除</button>
              <button type="button" style={sharedStyles.primaryButton} onClick={copyPin}>{copied ? '已复制' : '复制 PIN'}</button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

function StoreActivationRow({ store, onGenerate }: { store: DesktopStore; onGenerate: () => void }) {
  const canGenerate = store.storeStatus === 'ACTIVE'
    && store.tenantStatus === 'ACTIVE'
    && store.subscription.accessState === 'ALLOWED'
  return (
    <article style={s.storeRow}>
      <div style={s.storeHeader}>
        <div style={s.storeIdentity}>
          <div style={s.storeName}>{store.storeName}</div>
          <div style={s.storeMeta}>{store.storeCode} · {store.tenantName}</div>
        </div>
        <div style={s.badges}>
          <StatusBadge value={store.subscription.status} />
          <StatusBadge value={store.activationStatus} />
        </div>
      </div>

      <div className="desktop-store-grid" style={s.infoGrid}>
        <Info label="Desktop Count" value={`${store.activeDesktopCount} active / ${store.desktopCount} total`} />
        <Info label="Last Verification" value={fmtDateTime(store.lastVerification)} />
        <Info label="Current PIN" value={<StatusBadge value={store.currentPinStatus} />} />
        <Info label="Runtime" value={store.currentRuntimeVersion} />
        <Info label="Current Desktop" value={`${store.currentDesktopVersion} target`} />
        <Info label="Subscription" value={store.subscription.status} />
      </div>

      {store.desktopCount === 0 && (
        <div style={s.guide}>
          <strong>Desktop Activation Guide</strong>
          <span>下载安装 Desktop</span>
          <span>输入 Store Code</span>
          <span>输入一次性 PIN</span>
        </div>
      )}

      <div style={s.rowActions}>
        {!canGenerate && <span style={s.blockedText}>Subscription blocked</span>}
        {!canGenerate && <Link href={`/ops/${store.tenantId}`} style={s.subscriptionLink}>Go To Subscription</Link>}
        <button
          type="button"
          style={{ ...sharedStyles.primaryButton, opacity: canGenerate ? 1 : 0.5 }}
          disabled={!canGenerate}
          onClick={onGenerate}
        >
          Generate Activation PIN
        </button>
      </div>
    </article>
  )
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={s.info}>
      <div style={s.infoLabel}>{label}</div>
      <div style={s.infoValue}>{value}</div>
    </div>
  )
}

function ConfirmRow({ label, value }: { label: string; value: string }) {
  return <div style={s.confirmRow}><span>{label}</span><strong>{value}</strong></div>
}

const s: Record<string, CSSProperties> = {
  storeRow: { background: '#fff', border: '1px solid #dfe3e8', borderRadius: 8, padding: 16 },
  storeHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14 },
  storeIdentity: { minWidth: 0 },
  storeName: { color: '#111827', fontSize: 16, lineHeight: 1.3, fontWeight: 900 },
  storeMeta: { marginTop: 4, color: '#64748b', fontSize: 12, fontWeight: 700, overflowWrap: 'anywhere' },
  badges: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 6 },
  infoGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1, marginTop: 14, background: '#e2e8f0', border: '1px solid #e2e8f0' },
  info: { minWidth: 0, minHeight: 58, padding: '9px 10px', boxSizing: 'border-box', background: '#f8fafc' },
  infoLabel: { color: '#64748b', fontSize: 10, fontWeight: 900, marginBottom: 5 },
  infoValue: { color: '#1f2937', fontSize: 12, fontWeight: 800, overflowWrap: 'anywhere' },
  guide: { display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: 12, padding: '10px 12px', borderLeft: '3px solid #60a5fa', background: '#eff6ff', color: '#1e3a8a', fontSize: 12 },
  rowActions: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  blockedText: { color: '#b91c1c', fontSize: 12, fontWeight: 800 },
  subscriptionLink: { color: '#2563eb', fontSize: 12, fontWeight: 800, textDecoration: 'none' },
  empty: { padding: 42, border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', textAlign: 'center', fontSize: 13 },
  overlay: { position: 'fixed', inset: 0, zIndex: 100, display: 'grid', placeItems: 'center', padding: 16, background: 'rgba(15,23,42,0.56)' },
  modal: { width: 'min(500px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', boxSizing: 'border-box', padding: 18, borderRadius: 8, background: '#fff', boxShadow: '0 18px 50px rgba(15,23,42,0.3)' },
  pinModal: { borderTop: '4px solid #16a34a' },
  modalTitle: { margin: 0, color: '#111827', fontSize: 18, lineHeight: 1.3, letterSpacing: 0 },
  confirmRows: { display: 'grid', gap: 1, marginTop: 16, background: '#e2e8f0', border: '1px solid #e2e8f0' },
  confirmRow: { display: 'flex', justifyContent: 'space-between', gap: 16, padding: '10px 11px', background: '#f8fafc', color: '#475569', fontSize: 12 },
  warning: { marginTop: 14, padding: '10px 11px', border: '1px solid #fcd34d', borderRadius: 6, background: '#fffbeb', color: '#92400e', fontSize: 12, fontWeight: 800, lineHeight: 1.5 },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
  resultHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  success: { color: '#15803d', fontSize: 12, fontWeight: 900, marginBottom: 4 },
  pinDisplay: { height: 78, marginTop: 16, display: 'grid', placeItems: 'center', border: '1px solid #86efac', borderRadius: 6, background: '#f0fdf4', color: '#052e16', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 36, fontWeight: 900, letterSpacing: 0 },
  pinMeta: { marginTop: 8, color: '#64748b', textAlign: 'center', fontSize: 12, fontWeight: 700 },
}
