'use client'

import type { CSSProperties } from 'react'

const BRAND = '#07c160'
// TODO: Move production customer service entry to NEXT_PUBLIC_SUPPORT_URL
// or NEXT_PUBLIC_CUSTOMER_SERVICE_BOT_USERNAME once the final support bot is fixed.
const FALLBACK_CUSTOMER_SERVICE_URL = 'https://t.me/Eshop_sale_bot'

type Lang = 'zh' | 'en' | 'km'

const T: Record<Lang, {
  title: string
  desc: string
  account: string
  open: string
  copy: string
  copied: string
  openFailed: string
}> = {
  zh: {
    title: '联系客服',
    desc: '如需订单帮助、商户问题或平台咨询，请联系 E-Life 客服',
    account: '客服账号',
    open: '打开 Telegram 客服',
    copy: '复制客服账号',
    copied: '已复制客服账号',
    openFailed: '请复制客服账号后在 Telegram 搜索联系',
  },
  en: {
    title: 'Customer Service',
    desc: 'For order help, merchant issues, or platform questions, contact E-Life customer service.',
    account: 'Service account',
    open: 'Open Telegram service',
    copy: 'Copy service account',
    copied: 'Service account copied',
    openFailed: 'Please copy the account and search it in Telegram',
  },
  km: {
    title: 'ជំនួយ',
    desc: 'សម្រាប់ជំនួយការបញ្ជាទិញ បញ្ហាហាង ឬសំណួរអំពីប្រព័ន្ធ សូមទាក់ទងជំនួយ E-Life',
    account: 'គណនីជំនួយ',
    open: 'បើកជំនួយ Telegram',
    copy: 'ចម្លងគណនីជំនួយ',
    copied: 'បានចម្លងគណនីជំនួយ',
    openFailed: 'សូមចម្លងគណនី ហើយស្វែងរកក្នុង Telegram',
  },
}

function cleanBotUsername(raw?: string) {
  return (raw ?? '').replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '')
}

function resolveCustomerServiceUrl() {
  const explicitUrl = process.env.NEXT_PUBLIC_SUPPORT_URL?.trim()
    || process.env.NEXT_PUBLIC_CUSTOMER_SERVICE_URL?.trim()
  if (explicitUrl) return explicitUrl

  const botUsername = cleanBotUsername(
    process.env.NEXT_PUBLIC_SUPPORT_BOT_USERNAME
      || process.env.NEXT_PUBLIC_CUSTOMER_SERVICE_BOT_USERNAME
      || process.env.NEXT_PUBLIC_CUSTOMER_BOT_USERNAME
  )
  if (botUsername) return `https://t.me/${botUsername}`

  return FALLBACK_CUSTOMER_SERVICE_URL
}

const CUSTOMER_SERVICE_URL = resolveCustomerServiceUrl()

function resolveCustomerServiceAccount() {
  const botUsername = cleanBotUsername(
    process.env.NEXT_PUBLIC_SUPPORT_BOT_USERNAME
      || process.env.NEXT_PUBLIC_CUSTOMER_SERVICE_BOT_USERNAME
      || process.env.NEXT_PUBLIC_CUSTOMER_BOT_USERNAME
  )
  if (botUsername) return `@${botUsername}`

  const match = CUSTOMER_SERVICE_URL.match(/^https:\/\/t\.me\/([a-zA-Z0-9_]+)/)
  return match ? `@${match[1]}` : '@Eshop_sale_bot'
}

const CUSTOMER_SERVICE_ACCOUNT = resolveCustomerServiceAccount()

function isTelegramServiceLink(url: string) {
  return url.startsWith('https://t.me/') || url.startsWith('tg://resolve')
}

export default function ELifeSupportModal({
  lang,
  onClose,
  onToast,
}: {
  lang: Lang
  onClose: () => void
  onToast?: (message: string) => void
}) {
  const t = T[lang] ?? T.zh

  function notify(message: string) {
    if (onToast) {
      onToast(message)
      return
    }
    window.alert?.(message)
  }

  function openCustomerService() {
    const url = CUSTOMER_SERVICE_URL.trim()
    if (!url) return

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tg = (window as any).Telegram?.WebApp
      if (isTelegramServiceLink(url) && typeof tg?.openTelegramLink === 'function') {
        tg.openTelegramLink(url)
        return
      }
      if (typeof tg?.openLink === 'function') {
        tg.openLink(url)
        return
      }
      window.location.href = url
    } catch {
      notify(t.openFailed)
      window.alert?.(t.openFailed)
    }
  }

  async function copyCustomerServiceAccount() {
    try {
      await navigator.clipboard.writeText(CUSTOMER_SERVICE_ACCOUNT)
      notify(t.copied)
    } catch {
      notify(CUSTOMER_SERVICE_ACCOUNT)
      window.alert?.(CUSTOMER_SERVICE_ACCOUNT)
    }
  }

  return (
    <>
      <div style={s.overlay} onClick={onClose} />
      <div style={s.sheet}>
        <div style={s.icon}>💬</div>
        <h3 style={s.title}>{t.title}</h3>
        <p style={s.desc}>{t.desc}</p>
        <div style={s.accountBox}>
          <span style={s.accountLabel}>{t.account}</span>
          <strong style={s.accountValue}>{CUSTOMER_SERVICE_ACCOUNT}</strong>
        </div>
        <button style={s.primaryBtn} onClick={openCustomerService}>
          {t.open}
        </button>
        <button style={s.secondaryBtn} onClick={copyCustomerServiceAccount}>
          {t.copy}
        </button>
      </div>
    </>
  )
}

const s: Record<string, CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.2)',
    zIndex: 100,
  },
  sheet: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    background: '#fff',
    borderRadius: '18px 18px 0 0',
    zIndex: 102,
    padding: '22px 20px',
    paddingBottom: 'max(22px, env(safe-area-inset-bottom))',
    boxShadow: '0 -12px 30px rgba(0,0,0,0.14)',
  },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    background: 'rgba(7,193,96,0.1)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 22,
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: 800,
    color: '#111827',
    margin: '0 0 12px',
  },
  desc: {
    fontSize: 13,
    lineHeight: 1.55,
    color: '#6b7280',
    margin: '8px 0 14px',
  },
  accountBox: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '12px 14px',
    borderRadius: 12,
    background: '#f9fafb',
    border: '1px solid rgba(0,0,0,0.06)',
    marginBottom: 14,
  },
  accountLabel: {
    fontSize: 12,
    color: '#6b7280',
    flexShrink: 0,
  },
  accountValue: {
    fontSize: 14,
    color: '#111827',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  primaryBtn: {
    width: '100%',
    border: 'none',
    borderRadius: 12,
    background: BRAND,
    color: '#fff',
    fontSize: 15,
    fontWeight: 800,
    padding: '13px 16px',
    cursor: 'pointer',
    marginBottom: 10,
  },
  secondaryBtn: {
    width: '100%',
    border: '1px solid rgba(7,193,96,0.25)',
    borderRadius: 12,
    background: '#fff',
    color: BRAND,
    fontSize: 15,
    fontWeight: 800,
    padding: '12px 16px',
    cursor: 'pointer',
  },
}
