'use client'

import { useEffect, useState } from 'react'
import zh from '@/lib/i18n/zh'
import km from '@/lib/i18n/km'

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
 * First-time / unbound user (USER_NOT_FOUND):
 *  - startParam = bind_<token>  → /bind?token=<token>
 *  - startParam = open          → /open
 *  - no startParam              → /start  (unified onboarding entry)
 *  - already on /start, /open, /bind → no-op (page handles its own flow)
 *
 * No-op when not inside Telegram WebApp.
 */

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

// Paths that don't require an active session in PWA mode (non-Telegram context).
const ONBOARDING_PATHS = ['/start', '/open', '/bind', '/relogin']

export default function TelegramInit() {
  const [authError, setAuthError] = useState('')
  const [tenantInactive, setTenantInactive] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tg = (window as any).Telegram?.WebApp
    if (!tg?.initData) {
      // PWA mode (opened from home screen or browser, no Telegram context).
      // Skip session check on onboarding pages — they handle their own auth state.
      const path = window.location.pathname
      if (ONBOARDING_PATHS.some((p) => path.startsWith(p))) return

      fetch('/api/auth/status')
        .then((r) => { if (r.status === 401) window.location.replace('/relogin') })
        .catch(() => { /* network error — stay silent, don't block the page */ })
      return
    }

    // Request full viewport height — prevents Telegram's default half-screen mode
    tg.expand?.()

    const initData: string = tg.initData
    const tgUserId = extractTgUserId(initData)

    // If this Telegram user already authed in this WebView session, skip everything
    // (including bind redirects — prevents redirect loop after successful bind)
    if (tgUserId && sessionStorage.getItem(SESSION_KEY) === tgUserId) return

    // ── startapp bind token: e.g. https://t.me/bot?startapp=bind_<token> ──
    //
    // Read start_param from all sources, most-reliable first:
    //  1. URL hash tgWebAppStartParam — Telegram writes this directly into the Mini App
    //     URL hash before the JS SDK initialises, making it the most reliable source.
    //     Format: #tgWebAppData=...&tgWebAppStartParam=bind_<token>&...
    //  2. initDataUnsafe.start_param — parsed by Telegram JS SDK (may have timing lag)
    //  3. raw initData query string   — fallback for SDK parse timing issues
    //
    // IMPORTANT: skip this redirect when already on /bind to avoid infinite replace loop.
    const hashParams = new URLSearchParams(window.location.hash.slice(1))
    const startParam: string =
      hashParams.get('tgWebAppStartParam') ||
      tg.initDataUnsafe?.start_param ||
      new URLSearchParams(initData).get('start_param') ||
      ''
    if (startParam.startsWith('bind_')) {
      if (!window.location.pathname.startsWith('/bind')) {
        const token = startParam.slice(5)
        window.location.replace(`/bind?token=${encodeURIComponent(token)}`)
      }
      // Already on /bind — let BindFlow handle it; skip normal auth flow entirely.
      return
    }

    // /ops uses a separate bot (Mino ops) which may have a different bot token.
    // Route to the ops-specific auth endpoint to avoid INVALID_SIGNATURE errors.
    const isOpsPath = window.location.pathname.startsWith('/ops')
    const authUrl = isOpsPath ? '/api/auth/telegram-ops' : '/api/auth/telegram'

    fetch(authUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData }),
    })
      .then((r) => r.json())
      .then((body) => {
        if (body.ok) {
          sessionStorage.setItem(SESSION_KEY, tgUserId ?? '1')
          if (window.location.pathname.startsWith('/ops')) {
            window.location.href = '/ops'
          } else if (
            window.location.pathname.startsWith('/start') ||
            window.location.pathname.startsWith('/open')
          ) {
            // Auth succeeded but user is on an onboarding page — send them home.
            window.location.replace('/home')
          } else {
            window.location.reload()
          }
        } else if (body.error === 'USER_NOT_FOUND') {
          // Use same three-source priority for start_param.
          const sp =
            new URLSearchParams(window.location.hash.slice(1)).get('tgWebAppStartParam') ||
            tg.initDataUnsafe?.start_param ||
            new URLSearchParams(initData).get('start_param') ||
            ''

          // Employee/owner bind token: e.g. bind_<token>
          if (sp.startsWith('bind_') && !window.location.pathname.startsWith('/bind')) {
            window.location.replace(`/bind?token=${encodeURIComponent(sp.slice(5))}`)
            return
          }

          // Fixed "open store" QR code: startapp=open
          if (sp === 'open' && !window.location.pathname.startsWith('/open')) {
            window.location.replace('/open')
            return
          }

          // Already on an onboarding page — let it handle its own flow, do not interfere.
          const onboardingPaths = ['/start', '/open', '/bind']
          if (onboardingPaths.some((p) => window.location.pathname.startsWith(p))) return

          // Default: send to unified entry page.
          sessionStorage.removeItem(SESSION_KEY)
          window.location.replace('/start')
        } else if (body.error === 'TENANT_INACTIVE') {
          // Clear session so next open re-auth and sees the same message, then → /start
          sessionStorage.removeItem(SESSION_KEY)
          setTenantInactive(true)
          setTimeout(() => window.location.replace('/start'), 3000)
        } else {
          setAuthError(body.message ?? '登录失败，请联系管理员')
        }
      })
      .catch(() => {
        setAuthError('网络错误，请重试')
      })
  }, [])

  if (!authError && !tenantInactive) return null

  if (tenantInactive) {
    return (
      <div style={overlay}>
        <div style={card}>
          <p style={{ ...title, color: '#fa8c16' }}>
            ⚠ {zh.common.tenantInactive}
            <br />
            <span style={{ fontSize: '0.85em', opacity: 0.72 }}>{km.common.tenantInactive}</span>
          </p>
          <p style={hint}>
            {zh.common.tenantInactiveHint}
            <br />
            <span style={{ fontSize: '0.85em', opacity: 0.72 }}>{km.common.tenantInactiveHint}</span>
          </p>
        </div>
      </div>
    )
  }

  // Auth error overlay (replaces tg.showAlert to avoid Telegram-native English dialog chrome)
  return (
    <div style={overlay}>
      <div style={card}>
        <p style={{ ...title, color: '#ff4d4f' }}>
          ⚠ {zh.common.loginFailed}
          <br />
          <span style={{ fontSize: '0.85em', opacity: 0.72 }}>{km.common.loginFailed}</span>
        </p>
        <p style={hint}>{authError}</p>
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
