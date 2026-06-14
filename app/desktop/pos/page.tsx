'use client'

/**
 * /desktop/pos — 员工端电脑收银台
 *
 * 复用现有 /cashier 页面，避免复制或重构收银主流程。
 */

import { useEffect } from 'react'
import CashierPage from '@/app/cashier/page'

type DesktopLang = 'zh' | 'en' | 'km'

function resolveDesktopLang(raw: string | null): DesktopLang {
  if (raw === 'en' || raw === 'km' || raw === 'zh') return raw
  return 'en'
}

export default function DesktopPosPage() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const lang = resolveDesktopLang(params.get('lang'))
    document.documentElement.lang = lang === 'km' ? 'km' : lang === 'en' ? 'en' : 'zh-CN'
    document.documentElement.dataset.lang = lang
    document.body.dataset.lang = lang
  }, [])

  return <CashierPage />
}
