'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import { useLocale } from '@/app/components/LangProvider'
import { apiFetch, OWNER_CTX } from '@/lib/api'

const DEV_OWNER_CTX = process.env.NODE_ENV !== 'production' ? OWNER_CTX : undefined

type DesktopActivationPinResult = {
  pinId: string
  pin: string
  expiresAt: string
}

type StoreIdentity = {
  id: string
  code: string
}

type Props = {
  cashierUrl: string
  storeCode: string | null
  canManagePin: boolean
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
  storeCode,
  canManagePin,
  onClose,
}: Props) {
  const { t } = useLocale()
  const [storeId, setStoreId] = useState<string | null>(null)
  const [storeLoading, setStoreLoading] = useState(canManagePin)
  const [issuedPin, setIssuedPin] = useState<DesktopActivationPinResult | null>(null)
  const [busyAction, setBusyAction] = useState<'generate' | 'revoke' | null>(null)
  const [messageKey, setMessageKey] = useState<string | null>(null)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<'browser' | 'pin' | null>(null)

  useEffect(() => {
    if (!canManagePin) return
    let active = true
    setStoreLoading(true)
    setStoreId(null)
    setIssuedPin(null)
    setMessageKey(null)
    setCopiedKey(null)
    setErrorKey(null)

    apiFetch('/api/stores', { cache: 'no-store' }, DEV_OWNER_CTX)
      .then(async (response) => {
        if (!response.ok) throw new Error('STORE_LOOKUP_FAILED')
        const body = await response.json()
        if (!Array.isArray(body)) throw new Error('STORE_LOOKUP_FAILED')
        const stores = body.filter((item): item is StoreIdentity => (
          typeof item?.id === 'string' && typeof item?.code === 'string'
        ))
        const currentStore = storeCode
          ? stores.find((item) => item.code === storeCode)
          : stores.length === 1 ? stores[0] : null
        if (!currentStore) throw new Error('STORE_LOOKUP_FAILED')
        return currentStore.id
      })
      .then((id) => {
        if (active) setStoreId(id)
      })
      .catch(() => {
        if (active) setErrorKey('home.desktopStoreUnavailable')
      })
      .finally(() => {
        if (active) setStoreLoading(false)
      })

    return () => {
      active = false
    }
  }, [canManagePin, storeCode])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busyAction) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [busyAction, onClose])

  async function handleCopy(value: string, key: 'browser' | 'pin') {
    setErrorKey(null)
    const copied = await copyText(value)
    if (!copied) {
      setErrorKey('home.computerConsoleCopyFailed')
      return
    }
    setCopiedKey(key)
    window.setTimeout(() => setCopiedKey((current) => current === key ? null : current), 2000)
  }

  async function generatePin() {
    if (!storeId || busyAction) return
    setBusyAction('generate')
    setErrorKey(null)
    setMessageKey(null)
    try {
      const response = await apiFetch('/api/desktop/activation-pins', {
        method: 'POST',
        body: JSON.stringify({ storeId }),
      }, DEV_OWNER_CTX)
      const body = await response.json().catch(() => ({}))
      if (
        !response.ok ||
        typeof body.pinId !== 'string' ||
        typeof body.pin !== 'string' ||
        typeof body.expiresAt !== 'string'
      ) {
        throw new Error(typeof body.error === 'string' ? body.error : 'PIN_GENERATE_FAILED')
      }
      setIssuedPin({ pinId: body.pinId, pin: body.pin, expiresAt: body.expiresAt })
      setCopiedKey(null)
    } catch {
      setErrorKey('home.desktopPinGenerateFailed')
    } finally {
      setBusyAction(null)
    }
  }

  async function revokePin() {
    if (!issuedPin || busyAction) return
    setBusyAction('revoke')
    setErrorKey(null)
    setMessageKey(null)
    try {
      const response = await apiFetch(`/api/desktop/activation-pins/${issuedPin.pinId}/revoke`, {
        method: 'POST',
      }, DEV_OWNER_CTX)
      if (!response.ok) throw new Error('PIN_REVOKE_FAILED')
      setIssuedPin(null)
      setCopiedKey(null)
      setMessageKey('home.desktopPinRevoked')
    } catch {
      setErrorKey('home.desktopPinRevokeFailed')
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <div style={s.backdrop} role="presentation" onMouseDown={() => { if (!busyAction) onClose() }}>
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
            disabled={busyAction !== null}
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
          <div style={s.link}>{cashierUrl}</div>
          <div style={s.actions}>
            <button type="button" style={s.secondaryBtn} onClick={() => handleCopy(cashierUrl, 'browser')}>
              {copiedKey === 'browser' ? t('home.copied') : t('home.copyCashierLink')}
            </button>
            <a
              href={cashierUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...s.primaryBtn, textAlign: 'center', textDecoration: 'none' }}
            >
              {t('home.openCashier')}
            </a>
          </div>
        </div>

        {canManagePin && (
          <div style={s.section}>
            <div style={s.sectionHeading}>
              <span style={s.sectionIcon}>🖥️</span>
              <div>
                <div style={s.sectionTitle}>{t('home.desktopClientTitle')}</div>
                <div style={s.sectionDesc}>{t('home.desktopClientDesc')}</div>
              </div>
            </div>

            {issuedPin ? (
              <>
                <div style={s.pinPanel}>
                  <div style={s.pinLabel}>{t('home.desktopPinLabel')}</div>
                  <div style={s.pinValue}>{issuedPin.pin}</div>
                  <div style={s.pinExpiry}>
                    {t('home.desktopPinExpires')} {new Date(issuedPin.expiresAt).toLocaleString()}
                  </div>
                </div>
                <div style={s.warning}>{t('home.desktopPinOneTimeHint')}</div>
                <div style={s.actions}>
                  <button
                    type="button"
                    style={s.dangerBtn}
                    onClick={revokePin}
                    disabled={busyAction !== null}
                  >
                    {busyAction === 'revoke' ? t('home.revokingDesktopPin') : t('home.revokeDesktopPin')}
                  </button>
                  <button
                    type="button"
                    style={s.primaryBtn}
                    onClick={() => handleCopy(issuedPin.pin, 'pin')}
                    disabled={busyAction !== null}
                  >
                    {copiedKey === 'pin' ? t('home.copied') : t('home.copyDesktopPin')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={s.warning}>{t('home.desktopPinReplaceHint')}</div>
                <button
                  type="button"
                  style={{ ...s.primaryBtn, width: '100%' }}
                  onClick={generatePin}
                  disabled={storeLoading || !storeId || busyAction !== null}
                >
                  {storeLoading
                    ? t('home.desktopStoreLoading')
                    : busyAction === 'generate'
                      ? t('home.generatingDesktopPin')
                      : t('home.generateDesktopPin')}
                </button>
              </>
            )}
          </div>
        )}

        {messageKey && <div style={s.success}>{t(messageKey)}</div>}
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
  dangerBtn: {
    flex: 1,
    border: '1px solid #fecaca',
    borderRadius: 12,
    background: '#fff1f2',
    color: '#be123c',
    padding: '10px 12px',
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 900,
    cursor: 'pointer',
  },
  warning: {
    borderRadius: 10,
    background: '#fffbeb',
    border: '1px solid #fde68a',
    color: '#92400e',
    padding: '8px 10px',
    fontSize: 11,
    lineHeight: 1.5,
    margin: '9px 0',
  },
  success: {
    borderRadius: 10,
    background: '#f0fdf4',
    border: '1px solid #bbf7d0',
    color: '#15803d',
    padding: '9px 10px',
    fontSize: 12,
    fontWeight: 700,
    marginTop: 10,
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
  pinPanel: {
    borderRadius: 14,
    background: '#f5f3ff',
    border: '1px solid #ddd6fe',
    padding: '12px',
    textAlign: 'center',
  },
  pinLabel: {
    color: '#6d28d9',
    fontSize: 10,
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  pinValue: {
    color: '#3b0764',
    fontSize: 30,
    fontWeight: 950,
    letterSpacing: '0.18em',
    lineHeight: 1.3,
    margin: '3px 0',
    paddingLeft: '0.18em',
  },
  pinExpiry: {
    color: '#7c3aed',
    fontSize: 10,
    lineHeight: 1.4,
  },
}
