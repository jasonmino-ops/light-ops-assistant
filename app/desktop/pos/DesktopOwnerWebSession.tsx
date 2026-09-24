'use client'

/**
 * ES-DESKTOP-OWNER-WEB-SESSION-01 — once per Desktop app run (and again after
 * ~11 h), exchange the Desktop-managed POS session for the store OWNER web
 * session. Renderer Desktop flags only decide WHEN to ask; the server decides
 * everything. Any failure is silent and never blocks trading.
 */
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getPosDeviceToken } from '@/lib/desktop-pos-client'

const EXCHANGE_PATH = '/api/pos-session/owner-web-session'
const ISSUED_KEY_PREFIX = 'desktop-owner-web-session:'
const POS_DEVICE_ID_KEY = 'cashier:deviceId'
const RENEW_AFTER_MS = 11 * 60 * 60 * 1000
const TOKEN_WAIT_ATTEMPTS = 5
const TOKEN_WAIT_MS = 2000

// One exchange in flight per page, even if the effect is mounted twice.
let exchangeInFlight = false

function readIssuedAt(key: string): number | null {
  try {
    const value = Number(sessionStorage.getItem(key))
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

export default function DesktopOwnerWebSession() {
  const router = useRouter()

  useEffect(() => {
    const runtime = window.eshopDesktopRuntime
    if (runtime?.isDesktop !== true || runtime.windowRole !== 'employee') return
    const storeCode = new URLSearchParams(window.location.search).get('storeCode')?.trim() ?? ''
    if (!storeCode) return

    const key = `${ISSUED_KEY_PREFIX}${storeCode}`
    let cancelled = false
    let timer: number | null = null
    let attempts = 0

    const schedule = (delay: number) => {
      if (!cancelled) timer = window.setTimeout(run, delay)
    }

    function run() {
      if (cancelled) return
      const issuedAt = readIssuedAt(key)
      if (issuedAt !== null && Date.now() - issuedAt < RENEW_AFTER_MS) {
        schedule(RENEW_AFTER_MS - (Date.now() - issuedAt))
        return
      }
      if (!navigator.onLine) return
      const token = getPosDeviceToken(storeCode)
      let deviceId = ''
      try {
        deviceId = localStorage.getItem(POS_DEVICE_ID_KEY)?.trim() ?? ''
      } catch {}
      if (!token || !deviceId.startsWith('desktop-')) {
        attempts += 1
        if (attempts < TOKEN_WAIT_ATTEMPTS) schedule(TOKEN_WAIT_MS)
        return
      }
      if (exchangeInFlight) {
        // Another mount is exchanging; re-check shortly so this instance still owns renewal.
        schedule(TOKEN_WAIT_MS)
        return
      }
      exchangeInFlight = true
      fetch(EXCHANGE_PATH, {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'x-pos-device-token': token, 'x-pos-device-id': deviceId },
      })
        .then((response) => {
          if (!response.ok) return
          // Record the issuance even if this effect instance was already cleaned up,
          // so the same app run never exchanges twice.
          try {
            sessionStorage.setItem(key, String(Date.now()))
          } catch {}
          router.refresh()
          schedule(RENEW_AFTER_MS)
        })
        .catch(() => {
          // Fail closed and silent: the Management Center simply stays in its current view.
        })
        .finally(() => {
          exchangeInFlight = false
        })
    }

    run()
    return () => {
      cancelled = true
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [router])

  return null
}
