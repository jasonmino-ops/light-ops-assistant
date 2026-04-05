'use client'

import { useEffect, useState } from 'react'

export default function OpsLoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // When opened via Telegram Mini App with a bind token, suppress the ops login
  // form entirely — TelegramInit (in root layout) will redirect to /bind.
  // This prevents customers from seeing the ops backend when they scan a
  // merchant bind QR whose bot happens to open at the /ops path.
  const [isTgBind, setIsTgBind] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tg = (window as any).Telegram?.WebApp
    if (tg?.initData && String(tg.initDataUnsafe?.start_param ?? '').startsWith('bind_')) {
      setIsTgBind(true)
    }
  }, [])

  async function handleLogin(e?: React.FormEvent) {
    e?.preventDefault()
    if (!username.trim() || !password) {
      setError('请填写用户名和密码')
      return
    }
    setLoading(true)
    setError('')
    try {
      const r = await fetch('/api/ops/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      const body = await r.json()
      if (body.ok) {
        window.location.href = '/ops'
      } else {
        setError(body.message ?? '登录失败')
      }
    } catch {
      setError('网络错误，请重试')
    } finally {
      setLoading(false)
    }
  }

  if (isTgBind) {
    return (
      <div style={pg}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid #e8e8e8', borderTopColor: '#1677ff', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    )
  }

  return (
    <div style={pg}>
      <div style={card}>
        <div style={logo}>🔧</div>
        <div style={title}>E-shop 店小二助手</div>
        <div style={sub}>运营后台登录</div>

        <form onSubmit={handleLogin} style={{ display: 'contents' }}>
          <input
            style={inp}
            type="text"
            placeholder="用户名"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="none"
            autoComplete="username"
          />
          <input
            style={inp}
            type="password"
            placeholder="密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />

          {error && <div style={err}>{error}</div>}

          <button
            type="submit"
            style={{ ...btn, opacity: loading ? 0.6 : 1 }}
            disabled={loading}
          >
            {loading ? '登录中…' : '登录'}
          </button>
        </form>
      </div>
    </div>
  )
}

const pg: React.CSSProperties = {
  minHeight: '100vh', display: 'flex', alignItems: 'center',
  justifyContent: 'center', background: '#f0f2f5',
}
const card: React.CSSProperties = {
  background: '#fff', borderRadius: 16, padding: '36px 28px',
  width: 'min(340px, 92vw)', display: 'flex', flexDirection: 'column',
  gap: 14, boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
}
const logo: React.CSSProperties = { fontSize: 36, textAlign: 'center' }
const title: React.CSSProperties = { fontSize: 20, fontWeight: 700, color: '#1a1a2e', textAlign: 'center' }
const sub: React.CSSProperties = { fontSize: 13, color: '#aaa', textAlign: 'center', marginBottom: 4 }
const inp: React.CSSProperties = {
  height: 44, border: '1.5px solid #e8e8e8', borderRadius: 8,
  padding: '0 12px', fontSize: 15, outline: 'none', boxSizing: 'border-box', width: '100%',
}
const err: React.CSSProperties = { fontSize: 13, color: '#ff4d4f', textAlign: 'center' }
const btn: React.CSSProperties = {
  height: 46, background: '#1a1a2e', color: '#fff', border: 'none',
  borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: 'pointer', marginTop: 4,
}
