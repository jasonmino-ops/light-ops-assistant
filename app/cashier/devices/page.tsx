'use client'

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { apiFetch, OWNER_CTX } from '@/lib/api'
import { useWorkMode } from '@/app/components/WorkModeProvider'

type BrowserDevice = {
  id: string
  storeCode: string
  storeName: string
  browserDeviceId: string
  displayName: string | null
  browserInfo: string | null
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED'
  activatedAt: string
  lastSeenAt: string | null
  revokedAt: string | null
  tokenExpiresAt: string
}

type BrowserDeviceApiError = {
  error?: string
  message?: string
}

function formatTime(value: string | null) {
  if (!value) return '尚未在线'
  const time = new Date(value)
  return Number.isNaN(time.getTime()) ? '—' : time.toLocaleString('zh-CN', { hour12: false })
}

function deviceManagementError(body: BrowserDeviceApiError | null, fallback: string) {
  if (body?.error === 'LOGIN_REQUIRED') return '登录状态已失效，请重新进入 Telegram 老板端后再试。'
  if (body?.error === 'OWNER_REQUIRED' || body?.error === 'FORBIDDEN') return '仅当前门店的老板可以管理收银电脑。'
  if (body?.error === 'BROWSER_DEVICE_NOT_FOUND') return '这台收银电脑不存在，可能已被撤销或不属于当前门店。'
  return body?.message || fallback
}

export default function BrowserPosDevicesPage() {
  const { realRole, storeCode, storeName } = useWorkMode()
  const [devices, setDevices] = useState<BrowserDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [listError, setListError] = useState('')
  const [shareUrl, setShareUrl] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [working, setWorking] = useState(false)

  const load = useCallback(async (clearOnError = true) => {
    setLoading(true)
    setListError('')
    try {
      const response = await apiFetch('/api/cashier/browser-devices', { cache: 'no-store' }, OWNER_CTX)
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(deviceManagementError(body, '无法读取收银电脑。'))
      setDevices(Array.isArray(body?.devices) ? body.devices : [])
    } catch (error) {
      if (clearOnError) setDevices([])
      setListError(error instanceof Error ? error.message : '无法读取收银电脑。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function createLink() {
    setWorking(true)
    setMessage('')
    try {
      const response = await apiFetch('/api/cashier/browser-devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeCode }),
      }, OWNER_CTX)
      const body = await response.json().catch(() => null)
      if (!response.ok || !body?.shareUrl) throw new Error(deviceManagementError(body, '生成分享链接失败。'))
      setShareUrl(body.shareUrl)
      setExpiresAt(body.expiresAt || '')
      setMessage('分享链接已生成。请发送给要绑定的收银电脑；链接仅可使用一次。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '生成分享链接失败。')
    } finally {
      setWorking(false)
    }
  }

  async function copyLink() {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setMessage('分享链接已复制。')
    } catch {
      setMessage('复制失败，请长按下方链接手动复制。')
    }
  }

  async function revoke(device: BrowserDevice) {
    if (!window.confirm(`撤销“${device.displayName || device.browserDeviceId}”的收银权限？`)) return
    setWorking(true)
    setMessage('')
    try {
      const response = await apiFetch(`/api/cashier/browser-devices/${encodeURIComponent(device.id)}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'OWNER_DEVICE_MANAGEMENT' }),
      }, OWNER_CTX)
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(deviceManagementError(body, '撤销失败，请稍后重试。'))
      setDevices((current) => current.map((item) => item.id === device.id
        ? { ...item, status: 'REVOKED', revokedAt: new Date().toISOString() }
        : item,
      ))
      setMessage('已撤销这台收银电脑。')
      await load(false)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '撤销失败，请稍后重试。')
    } finally {
      setWorking(false)
    }
  }

  if (realRole !== 'OWNER') {
    return <main style={s.page}><section style={s.card}>仅老板可以管理收银电脑。</section></main>
  }

  return (
    <main style={s.page}>
      <section style={s.card}>
        <a href="/home" style={s.back}>‹ 返回老板端</a>
        <h1 style={s.title}>我的收银电脑</h1>
        <p style={s.sub}>为 {storeName || storeCode || '当前门店'} 生成一次性电脑绑定链接，并管理已绑定的浏览器收银设备。</p>

        <section style={s.shareCard}>
          <div style={s.shareTitle}>绑定新的收银电脑</div>
          <p style={s.shareCopy}>链接 10 分钟有效、只能绑定一次，不包含老板登录或长期收银 token。</p>
          <button type="button" style={{ ...s.primary, ...(working ? s.disabled : {}) }} disabled={working} onClick={createLink}>
            {working ? '处理中…' : '生成电脑分享链接'}
          </button>
          {shareUrl && (
            <>
              <button type="button" style={s.secondary} onClick={copyLink}>复制分享链接</button>
              <div style={s.link}>{shareUrl}</div>
              {expiresAt && <div style={s.expire}>有效至：{formatTime(expiresAt)}</div>}
            </>
          )}
        </section>

        {message && <div style={s.message}>{message}</div>}
        <h2 style={s.listTitle}>已绑定设备</h2>
        {listError && <div style={s.error}>{listError}</div>}
        {loading ? <div style={s.muted}>正在读取…</div> : devices.length === 0 ? (
          <div style={s.empty}>暂未绑定收银电脑。</div>
        ) : (
          <div style={s.list}>
            {devices.map((device) => (
              <article key={device.id} style={s.device}>
                <div style={s.deviceTop}>
                  <div>
                    <div style={s.deviceName}>{device.displayName || '前台收银机'}</div>
                    <div style={s.deviceStore}>{device.storeName} · {device.storeCode}</div>
                  </div>
                  <span style={{ ...s.status, ...(device.status === 'ACTIVE' ? s.statusActive : s.statusInactive) }}>{device.status}</span>
                </div>
                <div style={s.detail}>浏览器：{device.browserInfo || '未记录'}</div>
                <div style={s.detail}>绑定时间：{formatTime(device.activatedAt)}</div>
                <div style={s.detail}>最近在线：{formatTime(device.lastSeenAt)}</div>
                {device.status === 'ACTIVE' && (
                  <button type="button" style={{ ...s.revoke, ...(working ? s.disabled : {}) }} disabled={working} onClick={() => revoke(device)}>撤销设备</button>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}

const s: Record<string, CSSProperties> = {
  page: { minHeight: '100dvh', background: '#f1f5f9', padding: '24px 16px', fontFamily: 'system-ui,-apple-system,sans-serif', color: '#172033' },
  card: { width: 'min(720px, 100%)', margin: '0 auto', background: '#fff', borderRadius: 18, padding: 22, boxShadow: '0 12px 36px rgba(15,23,42,.10)' },
  back: { color: '#2563eb', textDecoration: 'none', fontWeight: 700, fontSize: 14 },
  title: { margin: '16px 0 6px', fontSize: 25, lineHeight: 1.2 },
  sub: { margin: 0, color: '#64748b', fontSize: 14, lineHeight: 1.6 },
  shareCard: { marginTop: 20, borderRadius: 14, border: '1px solid #bfdbfe', background: '#eff6ff', padding: 16 },
  shareTitle: { fontSize: 16, fontWeight: 900 },
  shareCopy: { margin: '7px 0 13px', color: '#475569', fontSize: 13, lineHeight: 1.5 },
  primary: { width: '100%', minHeight: 44, border: 0, borderRadius: 10, background: '#2563eb', color: '#fff', fontSize: 15, fontWeight: 800, cursor: 'pointer' },
  secondary: { width: '100%', minHeight: 40, marginTop: 10, border: '1px solid #93c5fd', borderRadius: 10, background: '#fff', color: '#1d4ed8', fontWeight: 800, cursor: 'pointer' },
  disabled: { opacity: .55, cursor: 'not-allowed' },
  link: { marginTop: 10, padding: 10, borderRadius: 9, background: '#fff', border: '1px solid #dbeafe', color: '#334155', wordBreak: 'break-all', fontSize: 12, lineHeight: 1.5 },
  expire: { marginTop: 8, color: '#64748b', fontSize: 12 },
  message: { marginTop: 14, padding: '10px 12px', borderRadius: 10, background: '#f8fafc', color: '#334155', fontSize: 13, lineHeight: 1.5 },
  error: { marginBottom: 10, padding: '10px 12px', borderRadius: 10, background: '#fef2f2', color: '#b91c1c', fontSize: 13, lineHeight: 1.5 },
  listTitle: { margin: '24px 0 10px', fontSize: 17 },
  muted: { color: '#64748b', fontSize: 14 },
  empty: { padding: 18, borderRadius: 12, background: '#f8fafc', color: '#64748b', fontSize: 14 },
  list: { display: 'grid', gap: 10 },
  device: { border: '1px solid #e2e8f0', borderRadius: 12, padding: 14 },
  deviceTop: { display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', marginBottom: 9 },
  deviceName: { fontWeight: 900, fontSize: 15 },
  deviceStore: { marginTop: 3, color: '#64748b', fontSize: 12 },
  status: { borderRadius: 999, padding: '3px 7px', fontSize: 11, fontWeight: 900 },
  statusActive: { color: '#047857', background: '#d1fae5' },
  statusInactive: { color: '#b91c1c', background: '#fee2e2' },
  detail: { marginTop: 4, color: '#475569', fontSize: 12, lineHeight: 1.45, overflowWrap: 'anywhere' },
  revoke: { marginTop: 11, minHeight: 34, padding: '0 12px', border: '1px solid #fecaca', borderRadius: 8, background: '#fff', color: '#b91c1c', fontWeight: 800, fontSize: 12, cursor: 'pointer' },
}
