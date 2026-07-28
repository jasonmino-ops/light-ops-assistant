'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { useLocale } from '@/app/components/LangProvider'

type Props = {
  cashierUrl: string | null
  canManageComputerClient: boolean
  onClose: () => void
}

async function copyText(value: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return true
    } catch {
      // Fall back for Telegram WebViews and non-secure local origins.
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(textarea)
  }
}

export default function ComputerConsoleModal({
  cashierUrl,
  canManageComputerClient,
  onClose,
}: Props) {
  const { t } = useLocale()
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<'browser' | null>(null)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  async function handleCopy(value: string, key: 'browser') {
    setErrorKey(null)
    const copied = await copyText(value)
    if (!copied) {
      setErrorKey('home.computerConsoleCopyFailed')
      return
    }
    setCopiedKey(key)
    window.setTimeout(() => setCopiedKey((current) => current === key ? null : current), 2000)
  }

  return (
    <div style={s.backdrop} role="presentation" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="computer-console-title"
        style={s.modal}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div style={s.header}>
          <div>
            <h2 id="computer-console-title" style={s.title}>{t('home.computerConsoleTitle')}</h2>
            <div style={s.subTitle}>{t('home.computerConsoleSubtitle')}</div>
          </div>
          <button
            type="button"
            aria-label={t('common.close')}
            style={s.close}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div style={s.section}>
          <div style={s.sectionHeading}>
            <span style={s.sectionIcon}>🌐</span>
            <div>
              <div style={s.sectionTitle}>{t('home.browserCashierTitle')}</div>
              <div style={s.sectionDesc}>{t('home.browserCashierDesc')}</div>
            </div>
          </div>
          <div style={cashierUrl ? s.link : { ...s.link, ...s.disabledLink }}>
            {cashierUrl ?? t('home.desktopStoreLoading')}
          </div>
          <div style={s.actions}>
            <button
              type="button"
              style={cashierUrl ? s.secondaryBtn : { ...s.secondaryBtn, ...s.disabledBtn }}
              onClick={() => { if (cashierUrl) void handleCopy(cashierUrl, 'browser') }}
              disabled={!cashierUrl}
            >
              {copiedKey === 'browser' ? t('home.copied') : t('home.copyCashierLink')}
            </button>
            {cashierUrl ? (
              <a
                href={cashierUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...s.primaryBtn, textAlign: 'center', textDecoration: 'none' }}
              >
                {t('home.openCashier')}
              </a>
            ) : (
              <button
                type="button"
                style={{ ...s.primaryBtn, ...s.disabledBtn }}
                disabled
              >
                {t('home.openCashier')}
              </button>
            )}
          </div>
        </div>

        {canManageComputerClient && (
          <div style={s.section}>
            <div style={s.sectionHeading}>
              <span style={s.sectionIcon}>🖥️</span>
              <div>
                <div style={s.sectionTitle}>{t('home.computerClientTitle')}</div>
                <div style={s.sectionDesc}>{t('home.computerClientDesc')}</div>
              </div>
            </div>
            <Link
              href="/home/computer-client"
              style={{ ...s.primaryBtn, display: 'block', textAlign: 'center', textDecoration: 'none' }}
            >
              {t('home.manageComputers')}
            </Link>
          </div>
        )}

        {errorKey && <div style={s.error}>{t(errorKey)}</div>}
      </section>
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 1200,
    background: 'rgba(15,23,42,0.48)',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    padding: 12,
  },
  modal: {
    width: '100%',
    maxWidth: 456,
    maxHeight: '88vh',
    overflowY: 'auto',
    background: '#f8fafc',
    borderRadius: 24,
    padding: '18px 16px calc(18px + env(safe-area-inset-bottom))',
    boxShadow: '0 24px 60px rgba(15,23,42,0.28)',
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 14,
    marginBottom: 14,
    padding: '0 2px',
  },
  title: {
    margin: 0,
    color: '#0f172a',
    fontSize: 20,
    fontWeight: 900,
    lineHeight: 1.25,
  },
  subTitle: {
    color: '#64748b',
    fontSize: 12,
    lineHeight: 1.5,
    marginTop: 4,
  },
  close: {
    flex: '0 0 auto',
    width: 34,
    height: 34,
    border: '1px solid #e2e8f0',
    borderRadius: 999,
    background: '#fff',
    color: '#475569',
    fontSize: 23,
    lineHeight: 1,
    cursor: 'pointer',
  },
  section: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 18,
    padding: 14,
    marginTop: 10,
    boxShadow: '0 6px 16px rgba(15,23,42,0.04)',
  },
  sectionHeading: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 11,
  },
  sectionIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    background: '#f5f3ff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 18,
    flex: '0 0 auto',
  },
  sectionTitle: {
    color: '#1e293b',
    fontSize: 15,
    fontWeight: 900,
    lineHeight: 1.3,
  },
  sectionDesc: {
    color: '#64748b',
    fontSize: 11,
    lineHeight: 1.5,
    marginTop: 2,
  },
  link: {
    padding: '9px 10px',
    borderRadius: 10,
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    color: '#475569',
    fontSize: 11,
    lineHeight: 1.45,
    overflowWrap: 'anywhere',
  },
  disabledLink: {
    color: '#94a3b8',
    fontStyle: 'italic',
  },
  actions: {
    display: 'flex',
    gap: 8,
    marginTop: 10,
  },
  primaryBtn: {
    flex: 1,
    border: 'none',
    borderRadius: 12,
    background: '#6d28d9',
    color: '#fff',
    padding: '10px 12px',
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 900,
    cursor: 'pointer',
  },
  secondaryBtn: {
    flex: 1,
    border: '1px solid #ddd6fe',
    borderRadius: 12,
    background: '#f5f3ff',
    color: '#6d28d9',
    padding: '10px 12px',
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 900,
    cursor: 'pointer',
  },
  disabledBtn: {
    cursor: 'not-allowed',
    opacity: 0.5,
  },
  error: {
    borderRadius: 10,
    background: '#fff1f2',
    border: '1px solid #fecdd3',
    color: '#be123c',
    padding: '9px 10px',
    fontSize: 12,
    fontWeight: 700,
    marginTop: 10,
  },
}
