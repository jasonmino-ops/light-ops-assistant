'use client'

import { useEffect, useState } from 'react'

/**
 * TelegramInit — mounts on every page.
 *
 * Normal flow (telegramId already bound in DB):
 *  1. Reads window.Telegram.WebApp.initData
 *  2. Calls POST /api/auth/telegram → sets auth-session cookie
 *  3. Reloads once so the server layout picks up the new cookie
 *
 * First-time binding flow (USER_NOT_FOUND):
 *  - Shows an overlay asking the user to enter their app username
 *  - Calls POST /api/auth/bind → binds telegramId + sets cookie in one step
 *  - Reloads on success
 *
 * No-op when not inside a Telegram WebApp.
 */

type BindState = 'idle' | 'binding' | 'error'

export default function TelegramInit() {
  // null = hidden, string = initData waiting for bind
  const [pendingInitData, setPendingInitData] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [bindState, setBindState] = useState<BindState>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tg = (window as any).Telegram?.WebApp
    if (!tg?.initData) return

    if (sessionStorage.getItem('tg-authed')) return

    const initData: string = tg.initData

    fetch('/api/auth/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData }),
    })
      .then((r) => r.json())
      .then((body) => {
        if (body.ok) {
          sessionStorage.setItem('tg-authed', '1')
          window.location.reload()
        } else if (body.error === 'USER_NOT_FOUND') {
          // First-time user — show binding UI
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
        sessionStorage.setItem('tg-authed', '1')
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
