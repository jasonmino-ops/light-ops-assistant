'use client'

import { useEffect, useState } from 'react'

/**
 * TelegramInit — mounts once per layout.
 *
 * Session guard stores the TG user ID (not just a boolean) so that if a
 * different Telegram account opens the same WebApp in the same WebView
 * session, auth is re-triggered for the new account.
 *
 * Normal flow (telegramId already bound):
 *  1. Parse TG user ID from initData (no HMAC, client-side only)
 *  2. Compare to sessionStorage key — skip if same user already authed
 *  3. Call POST /api/auth/telegram → cookie set → reload once
 *
 * First-time binding (USER_NOT_FOUND):
 *  - Clear sessionStorage guard
 *  - Show username input overlay
 *  - POST /api/auth/bind → cookie set → reload
 *
 * No-op when not inside Telegram WebApp.
 */

type BindState = 'idle' | 'binding' | 'error'

const SESSION_KEY = 'tg-authed-uid'

function extractTgUserId(initData: string): string | null {
  try {
    const userStr = new URLSearchParams(initData).get('user')
    if (!userStr) return null
    return String(JSON.parse(userStr).id)
  } catch {
    return null
  }
}

export default function TelegramInit() {
  const [pendingInitData, setPendingInitData] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [bindState, setBindState] = useState<BindState>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tg = (window as any).Telegram?.WebApp
    if (!tg?.initData) return

    // Request full viewport height — prevents Telegram's default half-screen mode
    tg.expand?.()

    // ── startapp bind token: e.g. https://t.me/bot?startapp=bind_<token> ──
    // Telegram passes the startapp value via initDataUnsafe.start_param.
    // Navigating to /bind?token= within the same origin preserves WebApp context.
    // IMPORTANT: skip this redirect when already on /bind to avoid infinite replace loop.
    const startParam: string = tg.initDataUnsafe?.start_param ?? ''
    if (startParam.startsWith('bind_')) {
      if (!window.location.pathname.startsWith('/bind')) {
        const token = startParam.slice(5)
        window.location.replace(`/bind?token=${encodeURIComponent(token)}`)
      }
      // Already on /bind — let BindFlow handle it; skip normal auth flow entirely.
      return
    }

    const initData: string = tg.initData
    const tgUserId = extractTgUserId(initData)

    // Skip only if the SAME Telegram user already authed in this WebView session
    if (tgUserId && sessionStorage.getItem(SESSION_KEY) === tgUserId) return

    fetch('/api/auth/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData }),
    })
      .then((r) => r.json())
      .then((body) => {
        if (body.ok) {
          sessionStorage.setItem(SESSION_KEY, tgUserId ?? '1')
          window.location.reload()
        } else if (body.error === 'USER_NOT_FOUND') {
          sessionStorage.removeItem(SESSION_KEY)
          setPendingInitData(initData)
        } else {
          tg.showAlert?.(body.message ?? '登录失败，请联系管理员')
        }
      })
      .catch(() => {
        tg.showAlert?.('网络错误，请重试')
      })
  }, [])

  async function handleBind() {
    if (!pendingInitData || !username.trim()) return
    setBindState('binding')
    setErrorMsg('')

    try {
      const r = await fetch('/api/auth/bind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData: pendingInitData, username: username.trim() }),
      })
      const body = await r.json()
      if (body.ok) {
        const tgUserId = extractTgUserId(pendingInitData)
        sessionStorage.setItem(SESSION_KEY, tgUserId ?? '1')
        window.location.reload()
      } else {
        setErrorMsg(body.message ?? '绑定失败，请检查用户名')
        setBindState('error')
      }
    } catch {
      setErrorMsg('网络错误，请重试')
      setBindState('error')
    }
  }

  if (!pendingInitData) return null

  return (
    <div style={overlay}>
      <div style={card}>
        <p style={title}>首次登录，请绑定账号</p>
        <p style={hint}>输入管理员分配给你的用户名</p>
        <input
          style={input}
          type="text"
          placeholder="用户名（如 boss / staff_a）"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleBind()}
          autoCapitalize="none"
          autoComplete="off"
        />
        {errorMsg && <p style={errStyle}>{errorMsg}</p>}
        <button
          style={{ ...btn, opacity: bindState === 'binding' ? 0.6 : 1 }}
          onClick={handleBind}
          disabled={bindState === 'binding'}
        >
          {bindState === 'binding' ? '绑定中…' : '确认绑定'}
        </button>
      </div>
    </div>
  )
}

const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.55)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 9999,
}

const card: React.CSSProperties = {
  background: '#fff',
  borderRadius: 16,
  padding: '28px 24px',
  width: 'min(320px, 90vw)',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
}

const title: React.CSSProperties = {
  margin: 0,
  fontSize: 17,
  fontWeight: 700,
  color: '#111',
  textAlign: 'center',
}

const hint: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  color: '#888',
  textAlign: 'center',
}

const input: React.CSSProperties = {
  border: '1px solid #d9d9d9',
  borderRadius: 8,
  padding: '10px 12px',
  fontSize: 15,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
}

const errStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  color: '#ff4d4f',
  textAlign: 'center',
}

const btn: React.CSSProperties = {
  background: '#1677ff',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  padding: '12px 0',
  fontSize: 15,
  fontWeight: 600,
  cursor: 'pointer',
}
