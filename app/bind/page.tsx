'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

/**
 * /bind?token=<token>
 *
 * Opens inside the Telegram Mini App via an invite link.
 * Reads the token from the query string and the current user's Telegram
 * identity from window.Telegram.WebApp.initData, then calls POST /api/bind.
 *
 * On success: redirects to /dashboard (OWNER) or /home (STAFF).
 * On error:   shows an error message.
 */

type BindState = 'loading' | 'success' | 'error' | 'no_tg'

const SESSION_KEY = 'tg-authed-uid'

function BindFlow() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [state, setState] = useState<BindState>('loading')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (!token) {
      setErrorMsg('链接无效：缺少邀请码参数')
      setState('error')
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tg = (window as any).Telegram?.WebApp
    // initData may take a brief moment to populate; wait one tick then fail-fast
    const initData: string = tg?.initData ?? ''
    if (!initData) {
      setState('no_tg')
      return
    }

    fetch('/api/bind', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, initData }),
    })
      .then((r) => r.json())
      .then((body) => {
        if (body.ok) {
          // Store TG user ID so TelegramInit doesn't re-auth on reload
          try {
            const tgUserId = String(
              JSON.parse(new URLSearchParams(initData).get('user') ?? '{}').id,
            )
            sessionStorage.setItem(SESSION_KEY, tgUserId)
          } catch {
            sessionStorage.setItem(SESSION_KEY, '1')
          }

          setState('success')
          setTimeout(() => {
            window.location.replace(body.role === 'OWNER' ? '/dashboard' : '/home')
          }, 800)
        } else {
          setErrorMsg(body.message ?? body.error ?? '绑定失败，请联系管理员')
          setState('error')
        }
      })
      .catch(() => {
        setErrorMsg('网络错误，请重试')
        setState('error')
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  return (
    <div style={card}>
      {state === 'loading' && (
        <>
          <div style={spinnerStyle} />
          <p style={msg}>正在验证邀请码…</p>
        </>
      )}

      {state === 'success' && (
        <>
          <div style={checkmark}>✓</div>
          <p style={{ ...msg, color: '#52c41a', fontWeight: 700 }}>绑定成功！正在跳转…</p>
        </>
      )}

      {state === 'error' && (
        <>
          <div style={errIcon}>✕</div>
          <p style={{ ...msg, color: '#ff4d4f' }}>{errorMsg}</p>
          <p style={hint}>请联系管理员重新生成邀请链接</p>
        </>
      )}

      {state === 'no_tg' && (
        <>
          <div style={warnIcon}>⚠</div>
          <p style={{ ...msg, color: '#fa8c16' }}>请在 Telegram 中打开此链接</p>
          <p style={hint}>此页面需要通过 Telegram Mini App 访问</p>
        </>
      )}
    </div>
  )
}

export default function BindPage() {
  return (
    <div style={pg}>
      <Suspense fallback={<div style={card}><p style={msg}>加载中…</p></div>}>
        <BindFlow />
      </Suspense>

      {/* Inline keyframe for spinner (avoids adding a global CSS file) */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
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
  padding: '40px 28px',
  width: 'min(320px, 90vw)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 12,
  boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
}

const spinnerStyle: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: '50%',
  border: '3px solid #e8e8e8',
  borderTopColor: '#1677ff',
  animation: 'spin 0.8s linear infinite',
}

const checkmark: React.CSSProperties = {
  width: 52,
  height: 52,
  borderRadius: '50%',
  background: '#f6ffed',
  border: '2px solid #b7eb8f',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 24,
  color: '#52c41a',
}

const warnIcon: React.CSSProperties = {
  width: 52,
  height: 52,
  borderRadius: '50%',
  background: '#fffbe6',
  border: '2px solid #ffe58f',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 22,
  color: '#fa8c16',
}

const errIcon: React.CSSProperties = {
  width: 52,
  height: 52,
  borderRadius: '50%',
  background: '#fff1f0',
  border: '2px solid #ffa39e',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 22,
  color: '#ff4d4f',
}

const msg: React.CSSProperties = {
  margin: 0,
  fontSize: 16,
  color: '#1a1a1a',
  textAlign: 'center',
}

const hint: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  color: '#aaa',
  textAlign: 'center',
}
