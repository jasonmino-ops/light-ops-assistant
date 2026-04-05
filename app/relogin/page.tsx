'use client'

import { useEffect, useState } from 'react'

const BOT_URL = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME
  ? `https://t.me/${process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME}`
  : null

const REDIRECT_DELAY = 1500 // ms

export default function ReloginPage() {
  const [countdown, setCountdown] = useState(false)

  useEffect(() => {
    if (!BOT_URL) return
    setCountdown(true)
    const t = setTimeout(() => {
      window.location.href = BOT_URL
    }, REDIRECT_DELAY)
    return () => clearTimeout(t)
  }, [])

  return (
    <div style={s.page}>
      <div style={s.card}>
        {/* 品牌图标 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon-192.png" alt="店小二助手" style={s.logo} />

        <div style={s.brand}>店小二助手</div>
        <div style={s.brandSub}>ជំនួយការហាង</div>

        <p style={s.msg}>
          登录已过期，即将跳转至 Telegram 重新登录
          <br />
          <span style={s.msgSub}>
            វគ្គបានផុតកំណត់ កំពុងប្តូរទៅ Telegram ដើម្បីចូលឡើងវិញ
          </span>
        </p>

        {countdown && <div style={s.dots}>· · ·</div>}

        {BOT_URL ? (
          <a href={BOT_URL} style={s.btn}>
            前往 Telegram 重新登录
            <br />
            <span style={{ fontSize: '0.82em', opacity: 0.85 }}>
              ចូលឡើងវិញតាម Telegram
            </span>
          </a>
        ) : (
          <p style={s.noBot}>未配置 Telegram Bot，请联系管理员</p>
        )}
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100dvh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(160deg, #e6f4ff 0%, #f5f7fa 100%)',
    padding: '0 20px',
  },
  card: {
    background: '#fff',
    borderRadius: 20,
    padding: '36px 28px 32px',
    width: 'min(340px, 100%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
    boxShadow: '0 4px 24px rgba(22,119,255,0.10)',
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 16,
    marginBottom: 4,
  },
  brand: {
    fontSize: 20,
    fontWeight: 700,
    color: '#1a1a1a',
    letterSpacing: '0.02em',
  },
  brandSub: {
    fontSize: 13,
    color: '#888',
    marginTop: -4,
    marginBottom: 8,
  },
  msg: {
    margin: 0,
    fontSize: 14,
    color: '#444',
    textAlign: 'center',
    lineHeight: 1.6,
  },
  msgSub: {
    fontSize: '0.88em',
    color: '#888',
  },
  dots: {
    fontSize: 20,
    color: '#1677ff',
    letterSpacing: 6,
    animation: 'pulse 1.2s ease-in-out infinite',
  },
  btn: {
    display: 'block',
    marginTop: 8,
    width: '100%',
    padding: '13px 16px',
    background: '#1677ff',
    color: '#fff',
    borderRadius: 12,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: 700,
    textDecoration: 'none',
    lineHeight: 1.5,
    boxSizing: 'border-box',
  },
  noBot: {
    fontSize: 13,
    color: '#ff4d4f',
    textAlign: 'center',
    margin: 0,
  },
}
