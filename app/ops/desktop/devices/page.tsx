'use client'

import type { CSSProperties } from 'react'
import { useEffect, useState } from 'react'
import type { DesktopDevice, DevicesResponse } from '../_components/types'
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

const STATUS_OPTIONS = ['ALL', 'ACTIVE', 'OFFLINE', 'BLOCKED', 'REVOKED']

const REVOKE_ERROR_MESSAGES: Record<string, string> = {
  DEVICE_NOT_FOUND: '设备不存在或已被删除。',
  DEVICE_REFERENCE_AMBIGUOUS: '设备短 ID 不唯一，请刷新列表后联系管理员。',
  OPS_ADMIN_IDENTITY_REQUIRED: '当前登录身份不是有效运营管理员，请重新登录。',
  REVOCATION_REASON_REQUIRED: '请输入至少 3 个字符的撤销原因。',
}

export default function DesktopDevicesPage() {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('ALL')
  const [data, setData] = useState<DevicesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revokeDevice, setRevokeDevice] = useState<DesktopDevice | null>(null)
  const [reason, setReason] = useState('')
  const [revoking, setRevoking] = useState(false)

  async function loadDevices(page: number, search = query, nextStatus = status) {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ view: 'devices', page: String(page), pageSize: '15', status: nextStatus })
      if (search.trim()) params.set('query', search.trim())
      const response = await fetch(`/api/ops/desktop-management?${params}`, { cache: 'no-store' })
      if (!response.ok) throw new Error('设备列表加载失败')
      setData(await response.json() as DevicesResponse)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '设备列表加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadDevices(1, '', 'ALL') }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function submitSearch() {
    const nextQuery = input.trim()
    setQuery(nextQuery)
    loadDevices(1, nextQuery, status)
  }

  function changeStatus(nextStatus: string) {
    setStatus(nextStatus)
    loadDevices(1, query, nextStatus)
  }

  async function confirmRevoke() {
    if (!revokeDevice || reason.trim().length < 3 || revoking) return
    setRevoking(true)
    setError('')
    try {
      const response = await fetch(`/api/ops/desktop-management/devices/${encodeURIComponent(revokeDevice.deviceRef)}/revoke`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        const code = typeof body?.error === 'string' ? body.error : `HTTP_${response.status}`
        throw new Error(`${REVOKE_ERROR_MESSAGES[code] ?? '设备撤销失败。'} Reference: ${code}`)
      }
      setRevokeDevice(null)
      setReason('')
      await loadDevices(data?.page ?? 1)
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : '设备撤销失败。')
    } finally {
      setRevoking(false)
    }
  }

  return (
    <main style={sharedStyles.content}>
      <PageHeading title="Desktop Devices" />
      <SearchBar value={input} onChange={setInput} onSubmit={submitSearch} placeholder="搜索 Store Code、Store Name 或 Tenant">
        <select value={status} onChange={(event) => changeStatus(event.target.value)} style={s.select} aria-label="Device status">
          {STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </SearchBar>

      {error && <ErrorState message={error} />}
      {loading && <LoadingState />}

      {!loading && data && (
        <>
          {data.devices.length === 0 ? <DesktopEmptyState /> : (
            <section style={sharedStyles.list} aria-label="Desktop devices">
              {data.devices.map((device) => (
                <DeviceRow key={`${device.storeCode}:${device.deviceRef}:${device.activatedAt}`} device={device} onRevoke={() => { setRevokeDevice(device); setReason('') }} />
              ))}
            </section>
          )}
          <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onChange={(page) => loadDevices(page)} />
        </>
      )}

      {revokeDevice && (
        <div style={s.overlay} role="presentation">
          <section style={s.modal} role="dialog" aria-modal="true" aria-labelledby="revoke-device-title">
            <h2 id="revoke-device-title" style={s.modalTitle}>Revoke Desktop Device</h2>
            <div style={s.confirmGrid}>
              <Info label="Store" value={`${revokeDevice.storeName} · ${revokeDevice.storeCode}`} />
              <Info label="Device" value={`${revokeDevice.deviceName} · ${revokeDevice.deviceRef}`} />
              <Info label="Status" value={<StatusBadge value={revokeDevice.status} />} />
            </div>
            <label style={s.reasonLabel} htmlFor="revoke-reason">Reason</label>
            <textarea
              id="revoke-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              placeholder="输入撤销原因"
              style={s.reasonInput}
            />
            <div style={s.warning}>撤销后该设备将在下一次验证时被阻断。</div>
            <div style={s.modalActions}>
              <button type="button" style={sharedStyles.secondaryButton} disabled={revoking} onClick={() => setRevokeDevice(null)}>取消</button>
              <button
                type="button"
                style={{ ...sharedStyles.dangerButton, opacity: reason.trim().length >= 3 ? 1 : 0.5 }}
                disabled={reason.trim().length < 3 || revoking}
                onClick={confirmRevoke}
              >
                {revoking ? '撤销中...' : '确认撤销'}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

function DeviceRow({ device, onRevoke }: { device: DesktopDevice; onRevoke: () => void }) {
  return (
    <article style={s.deviceRow}>
      <div style={s.deviceHeader}>
        <div>
          <div style={s.deviceName}>{device.deviceName}</div>
          <div style={s.deviceMeta}>ID {device.deviceRef} · {device.storeName} · {device.storeCode}</div>
        </div>
        <StatusBadge value={device.status} />
      </div>
      <div className="desktop-device-grid" style={s.deviceGrid}>
        <Info label="Tenant" value={device.tenantName} />
        <Info label="Subscription" value={device.subscriptionStatus} />
        <Info label="Activated At" value={fmtDateTime(device.activatedAt)} />
        <Info label="Last Verification" value={fmtDateTime(device.lastVerification)} />
        <Info label="Desktop Version" value={device.desktopVersion ?? '未上报'} />
        <Info label="Windows Version" value={device.windowsVersion ?? '未上报'} />
        <Info label="Revoked At" value={device.revokedAt ? fmtDateTime(device.revokedAt) : '—'} wide />
      </div>
      <div style={s.rowActions}>
        <button
          type="button"
          style={{ ...sharedStyles.dangerButton, opacity: device.canRevoke ? 1 : 0.45 }}
          disabled={!device.canRevoke}
          onClick={onRevoke}
        >
          Revoke
        </button>
      </div>
    </article>
  )
}

function Info({ label, value, wide = false }: { label: string; value: React.ReactNode; wide?: boolean }) {
  return <div style={{ ...s.info, ...(wide ? { gridColumn: 'span 2' } : {}) }}><div style={s.infoLabel}>{label}</div><div style={s.infoValue}>{value}</div></div>
}

function DesktopEmptyState() {
  return (
    <section style={s.empty}>
      <div style={s.emptyTitle}>Desktop Activation Guide</div>
      <div style={s.emptySteps}>
        <span>1. 下载安装 Desktop</span>
        <span>2. 输入 Store Code</span>
        <span>3. 输入一次性 PIN</span>
      </div>
    </section>
  )
}

const s: Record<string, CSSProperties> = {
  select: { height: 40, minWidth: 134, border: '1px solid #cbd5e1', borderRadius: 6, padding: '0 10px', background: '#fff', color: '#334155', fontSize: 12, fontWeight: 800 },
  deviceRow: { background: '#fff', border: '1px solid #dfe3e8', borderRadius: 8, padding: 16 },
  deviceHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14 },
  deviceName: { color: '#111827', fontSize: 15, fontWeight: 900 },
  deviceMeta: { marginTop: 4, color: '#64748b', fontSize: 12, fontWeight: 700, overflowWrap: 'anywhere' },
  deviceGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 1, marginTop: 14, border: '1px solid #e2e8f0', background: '#e2e8f0' },
  info: { minWidth: 0, minHeight: 58, padding: '9px 10px', boxSizing: 'border-box', background: '#f8fafc' },
  infoLabel: { marginBottom: 5, color: '#64748b', fontSize: 10, fontWeight: 900 },
  infoValue: { color: '#1f2937', fontSize: 12, fontWeight: 800, overflowWrap: 'anywhere' },
  rowActions: { display: 'flex', justifyContent: 'flex-end', marginTop: 12 },
  empty: { padding: 30, border: '1px solid #dbeafe', borderRadius: 8, background: '#eff6ff' },
  emptyTitle: { color: '#1e3a8a', fontSize: 15, fontWeight: 900 },
  emptySteps: { display: 'flex', flexWrap: 'wrap', gap: '8px 22px', marginTop: 12, color: '#1e40af', fontSize: 13, fontWeight: 700 },
  overlay: { position: 'fixed', inset: 0, zIndex: 100, display: 'grid', placeItems: 'center', padding: 16, background: 'rgba(15,23,42,0.56)' },
  modal: { width: 'min(520px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', boxSizing: 'border-box', padding: 18, borderTop: '4px solid #dc2626', borderRadius: 8, background: '#fff', boxShadow: '0 18px 50px rgba(15,23,42,0.3)' },
  modalTitle: { margin: 0, color: '#111827', fontSize: 18, letterSpacing: 0 },
  confirmGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1, marginTop: 16, border: '1px solid #e2e8f0', background: '#e2e8f0' },
  reasonLabel: { display: 'block', marginTop: 15, marginBottom: 6, color: '#475569', fontSize: 12, fontWeight: 900 },
  reasonInput: { width: '100%', minHeight: 88, resize: 'vertical', boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6, padding: 10, color: '#111827', fontFamily: 'inherit', fontSize: 13, outline: 'none' },
  warning: { marginTop: 12, padding: '10px 11px', border: '1px solid #fecaca', borderRadius: 6, background: '#fef2f2', color: '#991b1b', fontSize: 12, fontWeight: 800 },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
}
