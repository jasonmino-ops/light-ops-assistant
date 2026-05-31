'use client'

import { useEffect, useState } from 'react'

type DelegateInfo = { storeId: string; storeName: string; opsAdminId: string }

function readDelegateInfo(): DelegateInfo | null {
  try {
    const pair = document.cookie
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('delegate-info='))
    if (!pair) return null
    return JSON.parse(decodeURIComponent(pair.slice('delegate-info='.length)))
  } catch {
    return null
  }
}

const NAV: { label: string; href: string }[] = [
  { label: '首页',   href: '/home' },
  { label: '商品',   href: '/products' },
  { label: '看板',   href: '/dashboard' },
  { label: '推广',   href: '/campaign' },
  { label: '销售记录', href: '/records' },
  { label: '顾客资产', href: '/customers' },
]

export default function DelegateBanner() {
  const [info, setInfo] = useState<DelegateInfo | null>(null)

  useEffect(() => {
    const data = readDelegateInfo()
    setInfo(data)
    if (data) {
      // Push page content below the banner (two-row banner ≈ 68px)
      document.body.style.paddingTop = '68px'
    }
    return () => { document.body.style.paddingTop = '' }
  }, [])

  if (!info) return null

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 10000,
      background: '#78350f',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    }}>
      {/* 标识行 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '5px 14px', borderBottom: '1px solid rgba(255,255,255,0.1)',
      }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#fef3c7', letterSpacing: '0.01em' }}>
          ⚠️ 平台代运营模式｜当前商户：<strong style={{ color: '#fcd34d' }}>{info.storeName}</strong>
        </span>
        <a
          href={`/ops/stores/${encodeURIComponent(info.storeId)}/delegate/clear`}
          style={{
            fontSize: 11, fontWeight: 600, color: '#fbbf24',
            textDecoration: 'none', padding: '2px 10px',
            border: '1px solid rgba(251,191,36,0.45)', borderRadius: 6,
            flexShrink: 0, marginLeft: 12,
          }}
        >
          退出代运营
        </a>
      </div>
      {/* 导航行 */}
      <div style={{
        display: 'flex', overflowX: 'auto', padding: '0 4px',
        scrollbarWidth: 'none',
      }}>
        {NAV.map((item) => (
          <a
            key={item.href}
            href={item.href}
            style={{
              display: 'inline-block', padding: '5px 12px',
              fontSize: 11, fontWeight: 500, color: 'rgba(254,243,199,0.85)',
              textDecoration: 'none', flexShrink: 0, whiteSpace: 'nowrap',
              borderRight: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            {item.label}
          </a>
        ))}
      </div>
    </div>
  )
}
