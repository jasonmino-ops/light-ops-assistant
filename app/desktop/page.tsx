'use client'

import { useEffect, useState, CSSProperties } from 'react'

/**
 * /desktop — 电脑端模式选择页
 *
 * 只负责把店员引导到员工收银台或顾客显示屏；具体收银逻辑继续由 /desktop/pos
 * 复用既有 /cashier 页面，顾客显示屏由 /desktop/display 读取 PosSession。
 */

export default function DesktopModePage() {
  const [storeCode, setStoreCode] = useState('')

  useEffect(() => {
    const sc = new URLSearchParams(window.location.search).get('storeCode')?.trim() ?? ''
    setStoreCode(sc)
  }, [])

  const qs = storeCode ? `?storeCode=${encodeURIComponent(storeCode)}` : ''

  return (
    <main style={s.page}>
      <section style={s.panel}>
        <div style={s.kicker}>店小二电脑端</div>
        <h1 style={s.title}>选择电脑端模式</h1>
        <p style={s.desc}>
          员工收银台用于电脑端直接点单收款；顾客显示屏用于把手机 /sale 当前订单同步给顾客查看。
        </p>
        {storeCode ? (
          <div style={s.storeBadge}>当前门店：{storeCode}</div>
        ) : (
          <div style={s.warn}>未带门店编号。建议使用 /desktop?storeCode=门店编号 打开。</div>
        )}

        <div style={s.grid}>
          <a href={`/desktop/pos${qs}`} style={{ ...s.card, ...s.primaryCard }}>
            <div style={s.icon}>🧾</div>
            <div style={s.cardTitle}>员工收银台</div>
            <div style={s.cardDesc}>商品搜索、购物车、CASH / KHQR、完成销售。</div>
            <div style={s.cardAction}>进入收银台</div>
          </a>
          <a href={`/desktop/display${qs}`} style={s.card}>
            <div style={s.icon}>🖥️</div>
            <div style={s.cardTitle}>顾客显示屏</div>
            <div style={s.cardDesc}>只读展示当前订单、收款二维码和完成状态。</div>
            <div style={s.cardAction}>打开显示屏</div>
          </a>
        </div>
      </section>
    </main>
  )
}

const s: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f1f5f9',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  panel: {
    width: '100%',
    maxWidth: 760,
    background: '#fff',
    borderRadius: 18,
    padding: 28,
    boxShadow: '0 18px 45px rgba(15,23,42,0.12)',
  },
  kicker: { fontSize: 13, fontWeight: 800, color: '#2563eb', marginBottom: 8 },
  title: { margin: 0, fontSize: 30, lineHeight: 1.2, color: '#0f172a' },
  desc: { margin: '10px 0 14px', fontSize: 14, lineHeight: 1.7, color: '#64748b' },
  storeBadge: {
    display: 'inline-flex',
    padding: '6px 10px',
    borderRadius: 999,
    background: '#eff6ff',
    color: '#1d4ed8',
    fontSize: 13,
    fontWeight: 700,
    marginBottom: 18,
  },
  warn: {
    padding: '8px 10px',
    borderRadius: 10,
    background: '#fffbeb',
    border: '1px solid #fcd34d',
    color: '#92400e',
    fontSize: 13,
    marginBottom: 18,
  },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    minHeight: 180,
    padding: 20,
    borderRadius: 16,
    border: '1px solid #e2e8f0',
    background: '#fff',
    color: '#0f172a',
    textDecoration: 'none',
  },
  primaryCard: { borderColor: '#bfdbfe', background: '#f8fbff' },
  icon: { fontSize: 34 },
  cardTitle: { fontSize: 20, fontWeight: 850 },
  cardDesc: { flex: 1, fontSize: 14, lineHeight: 1.6, color: '#64748b' },
  cardAction: { fontSize: 14, fontWeight: 800, color: '#2563eb' },
}
