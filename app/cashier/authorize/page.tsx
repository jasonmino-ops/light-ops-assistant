'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import { useSearchParams } from 'next/navigation'

type RequestInfo = {
  status: 'PENDING' | 'APPROVED' | 'EXPIRED'
  storeName: string
  storeCode: string
  deviceName: string
}
type AuthRole = 'OWNER' | 'STAFF' | null

const s: Record<string, CSSProperties> = {
  page: { minHeight: '100dvh', background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18, fontFamily: 'system-ui,-apple-system,sans-serif' },
  panel: { width: 'min(440px, 100%)', background: '#fff', borderRadius: 16, padding: 22, boxShadow: '0 18px 52px rgba(15,23,42,.16)', border: '1px solid #e5e7eb' },
  icon: { width: 52, height: 52, borderRadius: 14, background: '#eff6ff', color: '#1d4ed8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, marginBottom: 14 },
  title: { fontSize: 22, fontWeight: 900, color: '#111827', marginBottom: 8, lineHeight: 1.2 },
  sub: { fontSize: 14, color: '#4b5563', lineHeight: 1.6, marginBottom: 16 },
  info: { borderRadius: 12, border: '1px solid #e5e7eb', background: '#f9fafb', padding: 14, display: 'grid', gap: 10, marginBottom: 16 },
  row: { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14 },
  label: { color: '#6b7280' },
  value: { color: '#111827', fontWeight: 800, textAlign: 'right' },
  input: { width: '100%', height: 42, borderRadius: 10, border: '1.5px solid #cbd5e1', padding: '0 12px', fontSize: 16, fontWeight: 700, color: '#111827', outline: 'none', marginTop: 8 },
  btn: { width: '100%', minHeight: 46, borderRadius: 12, border: 'none', background: '#2563eb', color: '#fff', fontSize: 16, fontWeight: 900, cursor: 'pointer' },
  secondaryBtn: { width: '100%', minHeight: 42, borderRadius: 12, border: '1px solid #cbd5e1', background: '#fff', color: '#334155', fontSize: 14, fontWeight: 900, cursor: 'pointer', marginTop: 10 },
  btnDis: { opacity: 0.55, cursor: 'not-allowed' },
  linkBox: { display: 'block', borderRadius: 10, padding: '9px 10px', background: '#f8fafc', border: '1px solid #e2e8f0', color: '#334155', fontSize: 12, lineHeight: 1.45, wordBreak: 'break-all' as const, textAlign: 'left' as const, marginTop: 12 },
  msg: { marginTop: 12, borderRadius: 10, padding: '10px 12px', background: '#ecfdf5', color: '#047857', fontSize: 14, lineHeight: 1.5 },
  err: { marginTop: 12, borderRadius: 10, padding: '10px 12px', background: '#fef2f2', color: '#b91c1c', fontSize: 14, lineHeight: 1.5 },
  loginTitle: { fontSize: 22, fontWeight: 900, color: '#111827', marginBottom: 8, lineHeight: 1.2 },
}

export default function CashierAuthorizePage() {
  const searchParams = useSearchParams()
  const requestId = searchParams.get('requestId')?.trim() ?? ''
  const [info, setInfo] = useState<RequestInfo | null>(null)
  const [deviceName, setDeviceName] = useState('前台收银机')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [authRole, setAuthRole] = useState<AuthRole>(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [copyMessage, setCopyMessage] = useState('')

  useEffect(() => {
    if (!requestId) {
      setError('授权链接无效，请回到电脑收银台重新扫码。')
      setLoading(false)
      return
    }
    fetch(`/api/cashier/device-authorization/${encodeURIComponent(requestId)}`, { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => null)
        if (!res.ok || !body) throw new Error(body?.message || '授权链接无效，请重新扫码。')
        setInfo(body)
        setDeviceName(body.deviceName || '前台收银机')
      })
      .catch((err) => setError(err instanceof Error ? err.message : '授权链接无效，请重新扫码。'))
      .finally(() => setLoading(false))

    fetch('/api/auth/status', { cache: 'no-store' })
      .then(async (res) => {
        if (res.status === 401) {
          setAuthRole(null)
          return
        }
        const body = await res.json().catch(() => null)
        setAuthRole(body?.role === 'OWNER' || body?.role === 'STAFF' ? body.role : null)
      })
      .catch(() => setAuthRole(null))
      .finally(() => setAuthChecked(true))
  }, [requestId])

  function currentAuthorizePath() {
    if (typeof window === 'undefined') return `/cashier/authorize?requestId=${encodeURIComponent(requestId)}`
    return `${window.location.pathname}${window.location.search}`
  }

  function currentAuthorizeUrl() {
    if (typeof window === 'undefined') return ''
    return window.location.href
  }

  function ownerLoginUrl() {
    return `/home?returnUrl=${encodeURIComponent(currentAuthorizePath())}`
  }

  function openOwnerLogin() {
    try {
      localStorage.setItem('cashier:pendingAuthorizeUrl', currentAuthorizePath())
    } catch {}
    window.location.href = ownerLoginUrl()
  }

  async function copyAuthorizeLink() {
    const url = currentAuthorizeUrl()
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopyMessage('授权链接已复制。')
    } catch {
      setCopyMessage('复制失败，请长按下面链接手动复制。')
    }
  }

  async function confirm() {
    if (!requestId || submitting) return
    setSubmitting(true)
    setMessage('')
    setError('')
    try {
      const res = await fetch(`/api/cashier/device-authorization/${encodeURIComponent(requestId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceName }),
      })
      const body = await res.json().catch(() => null)
      if (res.status === 401) {
        setAuthRole(null)
        throw new Error('请先用老板账号登录后再授权。')
      }
      if (res.status === 403 && body?.error === 'OWNER_REQUIRED') {
        setAuthRole('STAFF')
        throw new Error('当前登录账号不是老板账号，不能授权收银机。')
      }
      if (!res.ok) throw new Error(body?.message || '授权失败，请确认使用老板账号。')
      setInfo((prev) => prev ? { ...prev, status: 'APPROVED', deviceName } : prev)
      setMessage('授权成功。请回到电脑收银台，等待自动进入或点击“我已授权，重新检查”。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '授权失败，请稍后重试。')
    } finally {
      setSubmitting(false)
    }
  }

  const expired = info?.status === 'EXPIRED'
  const approved = info?.status === 'APPROVED'
  const showLoginPrompt = authChecked && authRole !== 'OWNER'

  return (
    <main style={s.page}>
      <section style={s.panel}>
        <div style={s.icon}>✓</div>
        {showLoginPrompt ? (
          <>
            <h1 style={s.loginTitle}>请先登录老板端</h1>
            <p style={s.sub}>
              这台电脑正在请求授权为收银机。请先用老板账号登录店小二老板端，登录后回到本授权页继续确认。
            </p>
            {info && (
              <div style={s.info}>
                <div style={s.row}><span style={s.label}>门店</span><span style={s.value}>{info.storeName || info.storeCode}</span></div>
                <div style={s.row}><span style={s.label}>设备</span><span style={s.value}>{info.deviceName || '前台收银机'}</span></div>
              </div>
            )}
            {authRole === 'STAFF' && (
              <div style={s.err}>当前登录账号不是老板账号。请切换为老板账号后再授权。</div>
            )}
            <button type="button" style={s.btn} onClick={openOwnerLogin}>
              打开老板端登录授权
            </button>
            <button type="button" style={s.secondaryBtn} onClick={copyAuthorizeLink}>
              复制授权链接
            </button>
            <span style={s.linkBox}>{currentAuthorizeUrl()}</span>
            {copyMessage && <div style={s.msg}>{copyMessage}</div>}
            <p style={{ ...s.sub, marginTop: 12, marginBottom: 0 }}>
              如果跳转后没有自动回到授权页，请重新打开本链接。
            </p>
          </>
        ) : (
          <>
            <h1 style={s.title}>授权这台电脑为收银机</h1>
            <p style={s.sub}>
              确认后，这台电脑以后可以为本门店收银。清除浏览器缓存或换电脑后，需要重新扫码授权。
            </p>

            {loading ? (
              <div style={s.sub}>正在读取授权信息...</div>
            ) : info ? (
              <>
                <div style={s.info}>
                  <div style={s.row}><span style={s.label}>门店</span><span style={s.value}>{info.storeName || info.storeCode}</span></div>
                  <div>
                    <div style={s.label}>设备名称</div>
                    <input
                      value={deviceName}
                      maxLength={20}
                      onChange={(e) => setDeviceName(e.target.value.slice(0, 20))}
                      style={s.input}
                      placeholder="前台收银机"
                      disabled={approved || expired}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  style={{ ...s.btn, ...((submitting || approved || expired) ? s.btnDis : {}) }}
                  disabled={submitting || approved || expired}
                  onClick={confirm}
                >
                  {approved ? '已授权' : expired ? '二维码已过期' : submitting ? '正在授权...' : '确认授权'}
                </button>
                <button type="button" style={s.secondaryBtn} onClick={copyAuthorizeLink}>
                  复制授权链接
                </button>
              </>
            ) : null}
          </>
        )}

        {message && <div style={s.msg}>{message}</div>}
        {error && <div style={s.err}>{error}</div>}
        {!showLoginPrompt && copyMessage && <div style={s.msg}>{copyMessage}</div>}
      </section>
    </main>
  )
}
