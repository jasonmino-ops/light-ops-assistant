'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import zh from '@/lib/i18n/zh'
import km from '@/lib/i18n/km'

/**
 * /open
 *
 * Self-service merchant registration page.
 * Opened when the fixed "开店" QR code is scanned:
 *   https://t.me/<bot>?startapp=open
 *
 * TelegramInit detects start_param === 'open' for unbound users
 * and redirects here. Already-bound users bypass this page via normal auth.
 */

function bi(zhStr: string, kmStr: string) {
  return (
    <>
      {zhStr}
      <br />
      <span style={{ fontSize: '0.85em', opacity: 0.72 }}>{kmStr}</span>
    </>
  )
}

type OpenState = 'form' | 'submitting' | 'success' | 'error' | 'no_tg' | 'already_bound'

const SESSION_KEY = 'tg-authed-uid'

function OpenFlow() {
  const searchParams = useSearchParams()
  // Allow ?from=open as a debug hint, but primarily driven by TelegramInit redirect
  void searchParams

  const [state, setState] = useState<OpenState>('form')
  const [errorMsg, setErrorMsg] = useState('')
  const [storeName, setStoreName] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [verifyCode, setVerifyCode] = useState('')
  const [initDataRef, setInitDataRef] = useState('')

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tg = (window as any).Telegram?.WebApp
    const initData: string = tg?.initData ?? ''
    if (!initData) {
      setState('no_tg')
      return
    }

    tg.expand?.()

    // Pre-fill owner name from Telegram profile
    try {
      const tgUser = JSON.parse(new URLSearchParams(initData).get('user') ?? '{}')
      const autoName =
        [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') ||
        tgUser.username ||
        ''
      if (autoName) setOwnerName(autoName)
    } catch {
      // leave blank
    }

    setInitDataRef(initData)
  }, [])

  const canSubmit =
    storeName.trim().length > 0 &&
    ownerName.trim().length > 0 &&
    verifyCode.trim().length > 0

  async function handleSubmit() {
    if (!canSubmit) return
    setState('submitting')
    try {
      const r = await fetch('/api/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          initData: initDataRef,
          storeName: storeName.trim(),
          ownerName: ownerName.trim(),
          verifyCode: verifyCode.trim(),
        }),
      })
      const body = await r.json()
      if (body.ok) {
        // Cache TG user ID so TelegramInit skips re-auth on next load
        try {
          const tgUserId = String(
            JSON.parse(new URLSearchParams(initDataRef).get('user') ?? '{}').id,
          )
          sessionStorage.setItem(SESSION_KEY, tgUserId)
        } catch {
          sessionStorage.setItem(SESSION_KEY, '1')
        }
        setState('success')
        setTimeout(() => {
          window.location.replace('/home')
        }, 800)
      } else if (body.error === 'ALREADY_BOUND') {
        setState('already_bound')
        setErrorMsg(body.message ?? '该账号已绑定商户')
      } else {
        setErrorMsg(body.message ?? '开通失败，请重试')
        setState('error')
      }
    } catch {
      setErrorMsg('网络错误，请重试')
      setState('error')
    }
  }

  return (
    <div style={card}>
      {(state === 'form' || state === 'submitting') && (
        <>
          <div style={shopIcon}>🏪</div>
          <p style={titleStyle}>{bi(zh.open.title, km.open.title)}</p>

          <div style={fieldGroup}>
            <label style={fieldLabel}>{bi(zh.open.fieldStoreName, km.open.fieldStoreName)}</label>
            <input
              style={inputStyle}
              type="text"
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              placeholder={zh.open.storeNamePlaceholder}
              maxLength={40}
              disabled={state === 'submitting'}
              autoFocus
            />
          </div>

          <div style={fieldGroup}>
            <label style={fieldLabel}>{bi(zh.open.fieldOwnerName, km.open.fieldOwnerName)}</label>
            <input
              style={inputStyle}
              type="text"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              placeholder={zh.open.ownerNamePlaceholder}
              maxLength={40}
              disabled={state === 'submitting'}
            />
          </div>

          <div style={fieldGroup}>
            <label style={fieldLabel}>{bi(zh.open.fieldVerifyCode, km.open.fieldVerifyCode)}</label>
            <input
              style={inputStyle}
              type="text"
              value={verifyCode}
              onChange={(e) => setVerifyCode(e.target.value)}
              placeholder={zh.open.verifyCodePlaceholder}
              maxLength={20}
              disabled={state === 'submitting'}
              autoComplete="off"
            />
          </div>

          <button
            style={{ ...submitBtn, opacity: canSubmit ? 1 : 0.5 }}
            onClick={handleSubmit}
            disabled={!canSubmit || state === 'submitting'}
          >
            {state === 'submitting'
              ? bi(zh.open.submitting, km.open.submitting)
              : bi(zh.open.submit, km.open.submit)}
          </button>
        </>
      )}

      {state === 'success' && (
        <>
          <div style={checkIcon}>✓</div>
          <p style={{ ...msgStyle, color: '#52c41a', fontWeight: 700 }}>
            {bi(zh.open.success, km.open.success)}
          </p>
        </>
      )}

      {state === 'error' && (
        <>
          <div style={errIconStyle}>✕</div>
          <p style={{ ...msgStyle, color: '#ff4d4f' }}>{errorMsg}</p>
          <button style={retryBtn} onClick={() => setState('form')}>
            {bi(zh.open.retry, km.open.retry)}
          </button>
        </>
      )}

      {state === 'already_bound' && (
        <>
          <div style={warnIconStyle}>⚠</div>
          <p style={{ ...msgStyle, color: '#fa8c16' }}>{errorMsg}</p>
          <button style={retryBtn} onClick={() => window.location.replace('/home')}>
            {bi(zh.open.enterAccount, km.open.enterAccount)}
          </button>
        </>
      )}

      {state === 'no_tg' && (
        <>
          <div style={warnIconStyle}>⚠</div>
          <p style={{ ...msgStyle, color: '#fa8c16' }}>
            {bi(zh.open.noTg, km.open.noTg)}
          </p>
          <p style={hintStyle}>{bi(zh.open.noTgHint, km.open.noTgHint)}</p>
        </>
      )}
    </div>
  )
}

export default function OpenPage() {
  return (
    <div style={pg}>
      <Suspense fallback={<div style={card}><p style={msgStyle}>{zh.common.loading}</p></div>}>
        <OpenFlow />
      </Suspense>
    </div>
  )
}

const pg: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#f5f7fa',
}

const card: React.CSSProperties = {
  background: '#fff',
  borderRadius: 16,
  padding: '36px 24px',
  width: 'min(340px, 92vw)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 14,
  boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
}

const shopIcon: React.CSSProperties = {
  width: 56,
  height: 56,
  borderRadius: '50%',
  background: '#fff7e6',
  border: '2px solid #ffd591',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 26,
}

const checkIcon: React.CSSProperties = {
  width: 56,
  height: 56,
  borderRadius: '50%',
  background: '#f6ffed',
  border: '2px solid #b7eb8f',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 26,
  color: '#52c41a',
}

const errIconStyle: React.CSSProperties = {
  width: 56,
  height: 56,
  borderRadius: '50%',
  background: '#fff1f0',
  border: '2px solid #ffa39e',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 22,
  color: '#ff4d4f',
}

const warnIconStyle: React.CSSProperties = {
  width: 56,
  height: 56,
  borderRadius: '50%',
  background: '#fffbe6',
  border: '2px solid #ffe58f',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 22,
  color: '#fa8c16',
}

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 18,
  fontWeight: 700,
  color: '#1a1a1a',
  textAlign: 'center',
}

const msgStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 15,
  color: '#1a1a1a',
  textAlign: 'center',
}

const hintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  color: '#aaa',
  textAlign: 'center',
}

const fieldGroup: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
}

const fieldLabel: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#888',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 44,
  border: '1.5px solid #d9d9d9',
  borderRadius: 8,
  padding: '0 12px',
  fontSize: 15,
  outline: 'none',
  boxSizing: 'border-box',
}

const submitBtn: React.CSSProperties = {
  width: '100%',
  height: 50,
  background: '#1677ff',
  color: '#fff',
  border: 'none',
  borderRadius: 10,
  fontSize: 15,
  fontWeight: 700,
  cursor: 'pointer',
  marginTop: 4,
}

const retryBtn: React.CSSProperties = {
  width: '100%',
  height: 44,
  background: 'transparent',
  color: '#666',
  border: '1.5px solid #e8e8e8',
  borderRadius: 10,
  fontSize: 14,
  cursor: 'pointer',
}
