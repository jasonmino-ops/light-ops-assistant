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
import { getPosDeviceToken } from '@/lib/desktop-pos-client'

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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const lang = resolveDesktopLang(params.get('lang'))
    document.documentElement.lang = lang === 'km' ? 'km' : lang === 'en' ? 'en' : 'zh-CN'
    document.documentElement.dataset.lang = lang
    document.body.dataset.lang = lang
    const storeCode = params.get('storeCode')?.trim() ?? ''
    // Store identity is never Browser POS authorization. An unbound direct
    // /desktop/pos legacy URL must render the existing binding guidance rather
    // than a product/checkout screen that fails only at payment time.
    setMode(params.get('mode') === 'pos' && storeCode && (isNativeDesktopRuntime() || getPosDeviceToken(storeCode)) ? 'pos' : 'select')
  }, [])

  if (mode === 'checking') return null
  return mode === 'pos' ? (
    <>
      <CashierPage />
      <UsbCustomerDisplayBridge />
    </>
  ) : <DesktopModePage />
}
