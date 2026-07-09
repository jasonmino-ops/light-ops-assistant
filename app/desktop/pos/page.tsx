'use client'

/**
 * /desktop/pos — 员工端电脑收银台
 *
 * 复用现有 /cashier 页面，避免复制或重构收银主流程。
 */

import { useEffect, useState } from 'react'
import CashierPage from '@/app/cashier/page'
import DesktopModePage from '@/app/desktop/page'

type DesktopLang = 'zh' | 'en' | 'km'

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
    setMode(params.get('mode') === 'pos' ? 'pos' : 'select')
  }, [])

  if (mode === 'checking') return null
  return mode === 'pos' ? <CashierPage /> : <DesktopModePage />
}
