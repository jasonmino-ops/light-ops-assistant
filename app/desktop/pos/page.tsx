'use client'

/**
 * /desktop/pos — 员工端电脑收银台
 *
 * 复用现有 /cashier 页面，避免复制或重构收银主流程。
 */

import { useEffect, useState, type CSSProperties } from 'react'
import CashierPage from '@/app/cashier/page'
import DesktopModePage from '@/app/desktop/page'
import UsbCustomerDisplayBridge from './UsbCustomerDisplayBridge'
import { getPosDeviceToken } from '@/lib/desktop-pos-client'
import { browserPosCustomerDisplayPath } from '@/lib/browser-pos-customer-display'

type DesktopLang = 'zh' | 'en' | 'km'

function isNativeDesktopRuntime() {
  return Boolean((window as Window & { eshopDesktopRuntime?: { isDesktop?: boolean } }).eshopDesktopRuntime?.isDesktop)
}

function resolveDesktopLang(raw: string | null): DesktopLang {
  if (raw === 'en' || raw === 'km' || raw === 'zh') return raw
  return 'en'
}

export default function DesktopPosPage() {
  const [mode, setMode] = useState<'checking' | 'select' | 'pos'>('checking')
  const [boundStoreCode, setBoundStoreCode] = useState('')
  const [lang, setLang] = useState<DesktopLang>('en')
  const [displayError, setDisplayError] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const lang = resolveDesktopLang(params.get('lang'))
    setLang(lang)
    document.documentElement.lang = lang === 'km' ? 'km' : lang === 'en' ? 'en' : 'zh-CN'
    document.documentElement.dataset.lang = lang
    document.body.dataset.lang = lang
    const storeCode = params.get('storeCode')?.trim() ?? ''
    // Store identity is never Browser POS authorization. An unbound direct
    // /desktop/pos legacy URL must render the existing binding guidance rather
    // than a product/checkout screen that fails only at payment time.
    const authorized = params.get('mode') === 'pos' && storeCode
      && (isNativeDesktopRuntime() || getPosDeviceToken(storeCode))
    if (authorized) setBoundStoreCode(storeCode)
    setMode(authorized ? 'pos' : 'select')
  }, [])

  function openCustomerDisplay() {
    const displayPath = browserPosCustomerDisplayPath(boundStoreCode, lang)
    if (!displayPath) {
      setDisplayError('当前收银台未识别有效门店，无法打开顾客显示屏。请重新打开已绑定的电脑收银台。')
      return
    }

    // Open synchronously from the click handler so normal browsers retain the
    // user gesture. Keep the cashier tab open and remove the opener link.
    const displayWindow = window.open('about:blank', '_blank')
    if (!displayWindow) {
      setDisplayError('无法打开顾客显示屏。请允许浏览器打开新标签页后重试。')
      return
    }
    displayWindow.opener = null
    displayWindow.location.replace(displayPath)
    setDisplayError('')
  }

  if (mode === 'checking') return null
  return mode === 'pos' ? (
    <>
      <div style={s.customerDisplayEntry}>
        <button type="button" style={s.customerDisplayButton} onClick={openCustomerDisplay}>
          🖥️ {lang === 'en' ? 'Open Customer Display' : lang === 'km' ? 'បើកអេក្រង់អតិថិជន' : '打开顾客显示屏'}
        </button>
        {displayError && <div role="alert" style={s.customerDisplayError}>{displayError}</div>}
      </div>
      <CashierPage />
      <UsbCustomerDisplayBridge />
    </>
  ) : <DesktopModePage />
}

const s: Record<string, CSSProperties> = {
  customerDisplayEntry: { position: 'fixed', top: 12, right: 12, zIndex: 60, display: 'grid', justifyItems: 'end', gap: 6 },
  customerDisplayButton: { minHeight: 38, border: '1px solid #93c5fd', borderRadius: 9, padding: '0 12px', background: '#eff6ff', color: '#1d4ed8', fontSize: 13, fontWeight: 850, cursor: 'pointer', boxShadow: '0 3px 12px rgba(30,64,175,.16)' },
  customerDisplayError: { maxWidth: 320, borderRadius: 8, padding: '8px 10px', background: '#fef2f2', color: '#b91c1c', fontSize: 12, lineHeight: 1.45, boxShadow: '0 3px 12px rgba(127,29,29,.12)' },
}
