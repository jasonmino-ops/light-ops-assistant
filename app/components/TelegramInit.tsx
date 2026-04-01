'use client'

import { useEffect } from 'react'

/**
 * TelegramInit — mounts on every page.
 *
 * When running inside a Telegram WebApp, it:
 * 1. Reads window.Telegram.WebApp.initData
 * 2. Calls POST /api/auth/telegram to validate and set the session cookie
 * 3. Reloads once (guarded by sessionStorage) so the server layout picks up
 *    the new cookie and renders the correct role-based nav / redirects.
 *
 * When running in a regular browser (no Telegram context), it is a no-op.
 */
export default function TelegramInit() {
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tg = (window as any).Telegram?.WebApp
    if (!tg?.initData) return // not inside Telegram WebApp

    // Guard: only authenticate once per session (survives location.reload)
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
        } else {
          // Auth failed — display error via Telegram native popup if available
          tg.showAlert?.(body.message ?? '账号绑定失败，请联系管理员')
        }
      })
      .catch(() => {
        tg.showAlert?.('网络错误，请重试')
      })
  }, [])

  return null
}
