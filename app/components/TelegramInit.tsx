'use client'

import { ReactNode, useEffect, useState } from 'react'
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
const OPS_SESSION_KEY = 'tg-ops-authed-uid'
const BOOT_DELAY_MS = 420
const BOOT_COPY = {
  zh: '正在进入店小二',
  en: 'Entering your store workspace',
  km: 'កំពុងចូលទៅកាន់ផ្ទាំងគ្រប់គ្រងហាង',
}

function extractTgUserId(initData: string): string | null {
  try {
    const userStr = new URLSearchParams(initData).get('user')
    if (!userStr) return null
    return String(JSON.parse(userStr).id)
  } catch {
    return null
  }
}

// Paths that don't require an active merchant session.
// 公开首页、顾客端公共入口（/e-life /menu /m /me）、合规公开页和商户端引导页（/start /open /bind /relogin）
// 均跳过商户 Bot auth 流程，由各页面自身处理身份或无需身份。
// /cashier is a standalone PC POS page — no Telegram session required
const PUBLIC_EXACT_PATHS = ['/']
const PUBLIC_PATH_PREFIXES = ['/start', '/open', '/bind', '/relogin', '/menu', '/m', '/e-life', '/me', '/v', '/p', '/creator/p', '/cashier', '/privacy', '/terms', '/contact']

function isPublicPath(path: string) {
  return PUBLIC_EXACT_PATHS.includes(path) ||
    PUBLIC_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}

function isMerchantEntryPath(path: string) {
  return !isPublicPath(path) && !path.startsWith('/ops')
}

export default function TelegramInit({
  children,
  initialProtected = false,
}: {
  children: ReactNode
  initialProtected?: boolean
}) {
  const [authError, setAuthError] = useState('')
  const [tenantInactive, setTenantInactive] = useState(false)
  const [authChecking, setAuthChecking] = useState(initialProtected)
  const [showBoot, setShowBoot] = useState(false)

  useEffect(() => {
    if (!authChecking || authError || tenantInactive) {
      setShowBoot(false)
      return
    }
    const timer = window.setTimeout(() => setShowBoot(true), BOOT_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [authChecking, authError, tenantInactive])

  useEffect(() => {
    // Skip auth entirely on onboarding pages — they handle their own flow.
    // This applies in BOTH Telegram and PWA modes to prevent TENANT_INACTIVE loops.
    const path = window.location.pathname
    if (isPublicPath(path)) {
      setAuthChecking(false)
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tg = (window as any).Telegram?.WebApp
    const isOpsRoute = path.startsWith('/ops')
    if (!tg?.initData) {
      // PWA mode (opened from home screen or browser, no Telegram context).
      // OPS 路径有自己的 /ops/login 表单 + cookie，不走商户 Bot relogin。
      if (isOpsRoute) {
        setAuthChecking(false)
        return
      }
      setAuthChecking(true)
      fetch('/api/auth/status')
        .then((r) => {
          if (r.status === 401) {
            window.location.replace('/relogin')
            return
          }
          setAuthChecking(false)
        })
        .catch(() => {
          setAuthChecking(false)
        })
      return
    }

    // Request full viewport height — prevents Telegram's default half-screen mode
    tg.expand?.()

    const initData: string = tg.initData
    const tgUserId = extractTgUserId(initData)

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

    // Ops Mini App uses its own bot/auth endpoint. Once the same Telegram user
    // has completed ops auth in this WebView, let the ops pages run their own
    // /api/ops/check guard instead of looping through the merchant boot shell.
    if (isOpsRoute && tgUserId && sessionStorage.getItem(OPS_SESSION_KEY) === tgUserId) {
      setAuthChecking(false)
      return
    }

    // Even when this WebView saw the same Telegram user before, verify the
    // server cookie before revealing merchant UI. This prevents expired-cookie
    // or first-load pages from flashing /home before /relogin or re-auth.
    if (isMerchantEntryPath(path) && tgUserId && sessionStorage.getItem(SESSION_KEY) === tgUserId) {
      setAuthChecking(true)
      fetch('/api/auth/status', { cache: 'no-store' })
        .then((r) => {
          if (r.ok) {
            sessionStorage.setItem(SESSION_KEY, tgUserId ?? '1')
            setAuthChecking(false)
            return
          }
          authenticateTelegram()
        })
        .catch(() => authenticateTelegram())
      return
    }

    // /ops uses a separate bot (Mino ops) which may have a different bot token.
    // Route to the ops-specific auth endpoint to avoid INVALID_SIGNATURE errors.
    authenticateTelegram()

    function authenticateTelegram() {
      const isOpsPath = window.location.pathname.startsWith('/ops')
      const authUrl = isOpsPath ? '/api/auth/telegram-ops' : '/api/auth/telegram'
      const sessionKey = isOpsPath ? OPS_SESSION_KEY : SESSION_KEY
      setAuthChecking(true)

      fetch(authUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData }),
      })
        .then((r) => r.json())
        .then((body) => {
          if (body.ok) {
            sessionStorage.setItem(sessionKey, tgUserId ?? '1')
            if (window.location.pathname.startsWith('/ops')) {
              window.location.href = '/ops'
            } else {
              // 首次进入（sessionStorage 为空 → 触发了 auth）统一落到 /home，
              // 不管 WebView 上次记住的路径是哪里（避免留在 /dashboard 等非默认页）
              window.location.replace('/home')
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
            // Clear session + server cookie so next open doesn't loop back here, then → /start
            sessionStorage.removeItem(SESSION_KEY)
            fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
            setTenantInactive(true)
            setTimeout(() => window.location.replace('/start'), 3000)
          } else {
            setAuthChecking(false)
            setAuthError(body.message ?? '登录失败，请联系管理员')
          }
        })
        .catch(() => {
          setAuthChecking(false)
          setAuthError('网络错误，请重试')
        })
    }
  }, [])

  if (authChecking && !authError && !tenantInactive) {
    return showBoot ? (
      <div style={bootOverlay} aria-live="polite">
        <style>{`
          @keyframes tgBootPulse {
            0%, 80%, 100% { opacity: 0.35; transform: translateY(0); }
            40% { opacity: 1; transform: translateY(-4px); }
          }
        `}</style>
        <div style={bootCard}>
          <div style={bootMark}>
            <span style={bootMarkText}>E</span>
          </div>
          <div style={bootBrand}>E-shop</div>
          <div style={bootCopy}>
            <div style={bootTextPrimary}>{BOOT_COPY.zh}</div>
            <div style={bootTextSecondary}>{BOOT_COPY.en}</div>
            <div style={bootTextSecondary}>{BOOT_COPY.km}</div>
          </div>
          <div style={bootDots} aria-hidden="true">
            <span style={{ ...bootDot, animationDelay: '0ms' }} />
            <span style={{ ...bootDot, animationDelay: '140ms' }} />
            <span style={{ ...bootDot, animationDelay: '280ms' }} />
          </div>
        </div>
      </div>
    ) : (
      <div style={bootBlank} aria-live="polite" />
    )
  }

  if (!authError && !tenantInactive) return <>{children}</>

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

const bootOverlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'linear-gradient(180deg, #f8fafc 0%, #eef4ff 100%)',
  zIndex: 9998,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  boxSizing: 'border-box',
}

const bootBlank: React.CSSProperties = {
  minHeight: '100dvh',
  background: '#f8fafc',
}

const bootCard: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 12,
  width: 'min(320px, 100%)',
  minHeight: 260,
  padding: '28px 24px',
  borderRadius: 18,
  background: 'rgba(255,255,255,0.88)',
  border: '1px solid rgba(226,232,240,0.95)',
  boxShadow: '0 20px 48px rgba(15,23,42,0.10)',
  boxSizing: 'border-box',
}

const bootMark: React.CSSProperties = {
  width: 68,
  height: 68,
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'linear-gradient(135deg, #1677ff 0%, #16a3ff 100%)',
  color: '#fff',
  boxShadow: '0 12px 26px rgba(22,119,255,0.24)',
}

const bootMarkText: React.CSSProperties = {
  fontSize: 30,
  lineHeight: 1,
  fontWeight: 900,
  letterSpacing: 0,
}

const bootBrand: React.CSSProperties = {
  color: '#101828',
  fontSize: 20,
  fontWeight: 800,
  letterSpacing: 0,
}

const bootCopy: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  textAlign: 'center',
}

const bootTextPrimary: React.CSSProperties = {
  color: '#1d2939',
  fontSize: 14,
  fontWeight: 700,
  lineHeight: 1.45,
}

const bootTextSecondary: React.CSSProperties = {
  color: '#667085',
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1.45,
}

const bootDots: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 5,
  marginTop: 4,
}

const bootDot: React.CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: '#1677ff',
  animation: 'tgBootPulse 900ms ease-in-out infinite',
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
