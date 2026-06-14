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
  const [lang, setLang] = useState<DesktopLang>('zh')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const sc = params.get('storeCode')?.trim() ?? ''
    const nextLang = resolveDesktopLang(params.get('lang'))
    setStoreCode(sc)
    setLang(nextLang)
    document.documentElement.lang = nextLang === 'km' ? 'km' : nextLang === 'en' ? 'en' : 'zh-CN'
  }, [])

  const t = desktopCopy[lang]
  const qs = buildDesktopQuery(storeCode, lang)
  function changeLang(nextLang: DesktopLang) {
    setLang(nextLang)
    document.documentElement.lang = nextLang === 'km' ? 'km' : nextLang === 'en' ? 'en' : 'zh-CN'
    const nextQuery = buildDesktopQuery(storeCode, nextLang)
    window.history.replaceState(null, '', `/desktop${nextQuery}`)
  }

  return (
    <main style={s.page}>
      <section style={s.panel}>
        <div style={s.topLine}>
          <div style={s.kicker}>{t.kicker}</div>
          <LangSwitch lang={lang} onChange={changeLang} />
        </div>
        <h1 style={s.title}>{t.title}</h1>
        <p style={s.desc}>
          {t.desc}
        </p>
        {storeCode ? (
          <div style={s.storeBadge}>{t.storeLabel}{storeCode}</div>
        ) : (
          <div style={s.warn}>{t.missingStore}</div>
        )}

        <div style={s.grid}>
          <a href={`/desktop/pos${qs}`} style={{ ...s.card, ...s.primaryCard }}>
            <div style={s.icon}>🧾</div>
            <div style={s.cardBody}>
              <div style={s.cardTitle}>{t.posTitle}</div>
              <div style={s.cardDesc}>{t.posDesc}</div>
            </div>
            <div style={s.cardAction}>{t.posAction}</div>
          </a>
          <a href={`/desktop/display${qs}`} style={s.card}>
            <div style={s.icon}>🖥️</div>
            <div style={s.cardBody}>
              <div style={s.cardTitle}>{t.displayTitle}</div>
              <div style={s.cardDesc}>{t.displayDesc}</div>
            </div>
            <div style={s.cardAction}>{t.displayAction}</div>
          </a>
        </div>
      </section>
    </main>
  )
}

type DesktopLang = 'zh' | 'en' | 'km'

function resolveDesktopLang(raw: string | null): DesktopLang {
  if (raw === 'en' || raw === 'km' || raw === 'zh') return raw
  return 'en'
}

function buildDesktopQuery(storeCode: string, lang: DesktopLang) {
  const params = new URLSearchParams()
  if (storeCode) params.set('storeCode', storeCode)
  params.set('lang', lang)
  return `?${params.toString()}`
}

const desktopCopy: Record<DesktopLang, Record<string, string>> = {
  zh: {
    kicker: '店小二电脑端',
    title: '选择电脑端模式',
    desc: '员工收银台用于电脑端直接点单收款；顾客显示屏用于把手机 /sale 当前订单同步给顾客查看。',
    storeLabel: '当前门店：',
    missingStore: '未带门店编号。建议使用 /desktop?storeCode=门店编号 打开。',
    posTitle: '员工收银台',
    posDesc: '适合店员在电脑上操作销售、收款、查看购物车。',
    posAction: '进入收银台',
    displayTitle: '顾客显示屏',
    displayDesc: '适合二手一体机/柜台大屏，给顾客查看商品、金额和 KHQR。',
    displayAction: '打开显示屏',
  },
  en: {
    kicker: 'Light Ops Desktop',
    title: 'Choose Desktop Mode',
    desc: 'Use Staff POS to sell and collect payment on a computer, or Customer Display to mirror the current /sale order for shoppers.',
    storeLabel: 'Store: ',
    missingStore: 'Missing store code. Open this page with /desktop?storeCode=STORE_CODE.',
    posTitle: 'Staff POS',
    posDesc: 'For staff to sell, collect payment, and manage the cart on a computer.',
    posAction: 'Open POS',
    displayTitle: 'Customer Display',
    displayDesc: 'For a counter screen or second-hand all-in-one PC showing items, amount, and KHQR.',
    displayAction: 'Open Display',
  },
  km: {
    kicker: 'Light Ops លើកុំព្យូទ័រ',
    title: 'ជ្រើសរើសរបៀបកុំព្យូទ័រ',
    desc: 'បញ្ជរបុគ្គលិកសម្រាប់លក់ និងទទួលប្រាក់លើកុំព្យូទ័រ។ អេក្រង់អតិថិជនសម្រាប់បង្ហាញការបញ្ជាទិញពី /sale។',
    storeLabel: 'ហាង៖ ',
    missingStore: 'ខ្វះលេខកូដហាង។ សូមបើក /desktop?storeCode=STORE_CODE។',
    posTitle: 'បញ្ជរបុគ្គលិក',
    posDesc: 'សម្រាប់បុគ្គលិកលក់ ទទួលប្រាក់ និងមើលកន្ត្រកលើកុំព្យូទ័រ។',
    posAction: 'ចូលបញ្ជរ',
    displayTitle: 'អេក្រង់អតិថិជន',
    displayDesc: 'សម្រាប់អេក្រង់មុខបញ្ជរ បង្ហាញទំនិញ ចំនួនទឹកប្រាក់ និង KHQR។',
    displayAction: 'បើកអេក្រង់',
  },
}

function LangSwitch({ lang, onChange }: { lang: DesktopLang; onChange: (lang: DesktopLang) => void }) {
  return (
    <div style={s.langSwitch} aria-label="Language">
      {(['zh', 'en', 'km'] as DesktopLang[]).map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onChange(item)}
          style={item === lang ? s.langBtnOn : s.langBtn}
        >
          {item}
        </button>
      ))}
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'var(--bg, #f1f5f9)',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: 24,
    fontFamily: 'var(--font-sans, system-ui, -apple-system, sans-serif)',
  },
  panel: {
    width: '100%',
    maxWidth: 860,
    background: '#fff',
    borderRadius: 18,
    padding: 28,
    marginTop: 36,
    boxShadow: '0 18px 45px rgba(15,23,42,0.12)',
  },
  topLine: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 },
  kicker: { fontSize: 13, fontWeight: 800, color: '#2563eb' },
  langSwitch: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: 3, borderRadius: 999, background: '#f1f5f9', border: '1px solid #e2e8f0' },
  langBtn: { border: 'none', borderRadius: 999, background: 'transparent', color: '#64748b', fontSize: 12, fontWeight: 800, padding: '5px 8px', cursor: 'pointer' },
  langBtnOn: { border: 'none', borderRadius: 999, background: '#2563eb', color: '#fff', fontSize: 12, fontWeight: 800, padding: '5px 8px', cursor: 'pointer' },
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
  grid: { display: 'grid', gridTemplateColumns: '1fr', gap: 12 },
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    minHeight: 96,
    padding: 18,
    borderRadius: 16,
    border: '1px solid #e2e8f0',
    background: '#fff',
    color: '#0f172a',
    textDecoration: 'none',
  },
  primaryCard: { borderColor: '#bfdbfe', background: '#f8fbff' },
  icon: { fontSize: 34, flex: '0 0 auto' },
  cardBody: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 20, fontWeight: 850 },
  cardDesc: { marginTop: 4, fontSize: 14, lineHeight: 1.6, color: '#64748b' },
  cardAction: { flex: '0 0 auto', fontSize: 14, fontWeight: 800, color: '#2563eb' },
}
