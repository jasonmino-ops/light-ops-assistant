'use client'

import { useEffect, useRef, useState } from 'react'
import {
  getPosDeviceId,
  savePosDeviceToken,
  setComputerLaunchStoreCode,
} from '@/lib/desktop-pos-client'
import { useLocale } from '@/app/components/LangProvider'

type LaunchState = 'working' | 'failed'

/**
 * Agent 默认浏览器接力页。
 * Ticket 只存在于 URL fragment（不会发送给 Web Server），页面启动后立即清除；
 * 兑换成功后保存现有 POS device session，并跳到无参数的 /cashier。
 */
export default function ComputerCashierLaunchPage() {
  const { t } = useLocale()
  const started = useRef(false)
  const [state, setState] = useState<LaunchState>('working')

  useEffect(() => {
    if (started.current) return
    started.current = true

    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const ticket = fragment.get('ticket')?.trim() ?? ''
    window.history.replaceState(null, '', '/cashier/launch')
    if (!ticket) {
      setState('failed')
      return
    }

    const browserDeviceId = getPosDeviceId()
    fetch('/api/computer-client/browser-launch/consume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ ticket, browserDeviceId }),
    })
      .then(async (res) => {
        const body = await res.json().catch(() => null)
        if (
          !res.ok ||
          typeof body?.storeCode !== 'string' ||
          typeof body?.posDeviceToken !== 'string'
        ) {
          throw new Error('LAUNCH_FAILED')
        }
        savePosDeviceToken(body.storeCode, body.posDeviceToken)
        localStorage.setItem('cashier:lastStoreCode', body.storeCode)
        setComputerLaunchStoreCode(body.storeCode)
        window.location.replace('/cashier')
      })
      .catch(() => setState('failed'))
  }, [])

  return (
    <main style={styles.page}>
      <section style={styles.card} aria-live="polite">
        <div style={styles.icon}>{state === 'working' ? '⏳' : '⚠️'}</div>
        <h1 style={styles.title}>
          {state === 'working'
            ? t('home.computerClientLaunchWorking')
            : t('home.computerClientLaunchFailed')}
        </h1>
        <p style={styles.desc}>
          {state === 'working'
            ? t('home.computerClientLaunchWorkingDesc')
            : t('home.computerClientLaunchFailedDesc')}
        </p>
      </section>
    </main>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    padding: 24,
    background: 'var(--bg)',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    padding: '32px 24px',
    borderRadius: 20,
    background: 'var(--card)',
    boxShadow: '0 14px 36px rgba(15,23,42,0.10)',
    textAlign: 'center' as const,
  },
  icon: { fontSize: 34 },
  title: {
    margin: '14px 0 8px',
    color: 'var(--text)',
    fontSize: 21,
    fontWeight: 900,
  },
  desc: {
    margin: 0,
    color: 'var(--muted)',
    fontSize: 14,
    lineHeight: 1.7,
  },
}
