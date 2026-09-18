'use client'

/**
 * /desktop/pos — 员工端电脑收银台
 *
 * 复用现有 /cashier 页面，避免复制或重构收银主流程。
 */

import { useEffect, useState } from 'react'
import CashierPage from '@/app/cashier/page'
import DesktopModePage from '@/app/desktop/page'
import UsbCustomerDisplayBridge from './UsbCustomerDisplayBridge'
import {
  getDesktopOperatorSelection,
  posDeviceHeaders,
  saveDesktopOperatorSelection,
  type DesktopOperatorSelection,
} from '@/lib/desktop-pos-client'

type DesktopLang = 'zh' | 'en' | 'km'

type OperatorBoundaryState = {
  enabled: boolean
  deviceAvailable: boolean
  account: { role: 'OWNER' | 'STAFF' } | null
  active: { source: 'ACCOUNT' | 'DEVICE' | 'STORE_CODE'; role: 'OWNER' | 'STAFF' } | null
}

function resolveDesktopLang(raw: string | null): DesktopLang {
  if (raw === 'en' || raw === 'km' || raw === 'zh') return raw
  return 'en'
}

function OperatorBoundary() {
  const [storeCode, setStoreCode] = useState('')
  const [online, setOnline] = useState(true)
  const [state, setState] = useState<OperatorBoundaryState | null>(null)
  const [selected, setSelected] = useState<DesktopOperatorSelection | null>(null)
  const [open, setOpen] = useState(false)
  const [retryNonce, setRetryNonce] = useState(0)

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine)
    updateOnline()
    window.addEventListener('online', updateOnline)
    window.addEventListener('offline', updateOnline)
    return () => {
      window.removeEventListener('online', updateOnline)
      window.removeEventListener('offline', updateOnline)
    }
  }, [])

  useEffect(() => {
    let attempts = 0

    const readStoreCode = () => {
      const queryStoreCode = new URLSearchParams(window.location.search).get('storeCode')?.trim()
      if (queryStoreCode) {
        setStoreCode(queryStoreCode)
        return true
      }
      try {
        const restoredStoreCode = localStorage.getItem('cashier:lastStoreCode')?.trim()
        if (restoredStoreCode) {
          setStoreCode(restoredStoreCode)
          return true
        }
      } catch {}
      return false
    }

    if (readStoreCode()) return
    const timer = window.setInterval(() => {
      attempts += 1
      if (readStoreCode() || attempts >= 25) window.clearInterval(timer)
    }, 200)
    return () => {
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (!online || !storeCode) return
    const existing = getDesktopOperatorSelection(storeCode)
    setSelected(existing)
    let cancelled = false
    let retryTimer: number | null = null
    const retryIfUnselected = () => {
      if (existing || getDesktopOperatorSelection(storeCode) || cancelled) return
      retryTimer = window.setTimeout(() => setRetryNonce((value) => value + 1), 2000)
    }
    fetch(`/api/operator-boundary?storeCode=${encodeURIComponent(storeCode)}`, {
      cache: 'no-store',
      headers: posDeviceHeaders(storeCode),
    })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as OperatorBoundaryState | null
        if (!response.ok || !body || cancelled) return
        setState(body)
        if (!body.enabled) return
        if (!body.deviceAvailable && !body.account) {
          retryIfUnselected()
          return
        }
        const existingStillAvailable = existing === 'ACCOUNT'
          ? Boolean(body.account)
          : existing === 'DEVICE'
            ? body.deviceAvailable
            : false
        if (!existingStillAvailable) {
          try {
            sessionStorage.removeItem(`cashier:desktopOperatorSelection:${storeCode}`)
          } catch {}
          setSelected(null)
          setOpen(Boolean(body.deviceAvailable || body.account))
        } else {
          setOpen(false)
        }
      })
      .catch(() => {
        // Network failure must not block the existing Desktop / offline path.
        retryIfUnselected()
      })
    return () => {
      cancelled = true
      if (retryTimer !== null) window.clearTimeout(retryTimer)
    }
  }, [online, retryNonce, storeCode])

  if (!online || !state?.enabled || (!state.deviceAvailable && !state.account)) return null

  const choose = (next: DesktopOperatorSelection) => {
    if (!online || (next === 'DEVICE' && !state.deviceAvailable) || (next === 'ACCOUNT' && !state.account)) return
    saveDesktopOperatorSelection(storeCode, next)
    setSelected(next)
    setOpen(false)
  }

  const activeRole = selected === 'ACCOUNT' ? state.account?.role : 'OWNER'
  const activeLabel = selected === 'ACCOUNT'
    ? `当前操作人 · ${activeRole ?? 'STAFF'}`
    : '当前操作人 · OWNER（本机授权）'

  return (
    <>
      {selected && !open && (
        <div
          aria-label="当前 Desktop 操作人"
          style={{
            position: 'fixed', top: 10, right: 14, zIndex: 10001,
            padding: '7px 10px', borderRadius: 999,
            background: 'rgba(15,23,42,.88)', color: '#fff',
            fontSize: 11, fontWeight: 800, pointerEvents: 'none',
          }}
        >
          {activeLabel}
        </div>
      )}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="选择 Desktop 操作人"
          style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            display: 'grid', placeItems: 'center', padding: 24,
            background: 'rgba(15,23,42,.72)',
          }}
        >
          <section style={{ width: 'min(440px, 100%)', borderRadius: 18, padding: 24, background: '#fff', boxShadow: '0 24px 80px rgba(15,23,42,.35)' }}>
            <div style={{ color: '#64748b', fontSize: 12, fontWeight: 800, letterSpacing: '.08em' }}>DESKTOP OPERATOR BOUNDARY</div>
            <h1 style={{ margin: '8px 0 6px', color: '#0f172a', fontSize: 24 }}>选择本次操作人</h1>
            <p style={{ margin: '0 0 18px', color: '#475569', fontSize: 13, lineHeight: 1.6 }}>
              这是本次 Desktop 会话的明确边界。浏览器账号不会自动覆盖本机授权身份。
            </p>
            <div style={{ display: 'grid', gap: 10 }}>
              {state.deviceAvailable && (
                <button
                  type="button"
                  onClick={() => choose('DEVICE')}
                  style={{ padding: '14px 16px', borderRadius: 12, border: '1px solid #cbd5e1', background: '#f8fafc', color: '#0f172a', textAlign: 'left', cursor: 'pointer' }}
                >
                  <strong style={{ display: 'block', fontSize: 15 }}>OWNER · 本机授权</strong>
                  <span style={{ display: 'block', marginTop: 4, color: '#64748b', fontSize: 12 }}>沿用现有 Desktop 设备授权和 legacy OWNER fallback</span>
                </button>
              )}
              {state.account && (
                <button
                  type="button"
                  onClick={() => choose('ACCOUNT')}
                  style={{ padding: '14px 16px', borderRadius: 12, border: '1px solid #93c5fd', background: '#eff6ff', color: '#0f172a', textAlign: 'left', cursor: 'pointer' }}
                >
                  <strong style={{ display: 'block', fontSize: 15 }}>{state.account.role} · 当前登录账号</strong>
                  <span style={{ display: 'block', marginTop: 4, color: '#475569', fontSize: 12 }}>复用现有账号与 UserStoreRole，并写入已有 operatorUserId</span>
                </button>
              )}
            </div>
            <p style={{ margin: '16px 0 0', color: '#94a3b8', fontSize: 11, lineHeight: 1.5 }}>
              当前 MVP 不新增员工 PIN，也不做离线锁定；离线 CASH 继续沿用现有能力。
            </p>
          </section>
        </div>
      )}
    </>
  )
}

export default function DesktopPosPage() {
  const [mode, setMode] = useState<'checking' | 'select' | 'pos'>('checking')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const lang = resolveDesktopLang(params.get('lang'))
    document.documentElement.lang = lang === 'km' ? 'km' : lang === 'en' ? 'en' : 'zh-CN'
    document.documentElement.dataset.lang = lang
    document.body.dataset.lang = lang
    setMode(params.get('mode') === 'pos' ? 'pos' : 'select')
  }, [])

  if (mode === 'checking') return null
  return mode === 'pos' ? (
    <>
      <CashierPage />
      <OperatorBoundary />
      <UsbCustomerDisplayBridge />
    </>
  ) : <DesktopModePage />
}
