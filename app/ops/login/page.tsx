'use client'

import { useState } from 'react'

export default function OpsLoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleLogin() {
    if (!username.trim() || !password) return
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

  return (
    <div style={pg}>
      <div style={card}>
        <div style={logo}>🔧</div>
        <div style={title}>E-shop 店小二助手</div>
        <div style={sub}>运营后台登录</div>

        <input
          style={inp}
          type="text"
          placeholder="用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
          autoCapitalize="none"
          autoComplete="username"
        />
        <input
          style={inp}
          type="password"
          placeholder="密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
          autoComplete="current-password"
        />

        {error && <div style={err}>{error}</div>}

        <button
          style={{ ...btn, opacity: loading || !username.trim() || !password ? 0.6 : 1 }}
          onClick={handleLogin}
          disabled={loading || !username.trim() || !password}
        >
          {loading ? '登录中…' : '登录'}
        </button>
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
