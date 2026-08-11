'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useLocale } from '@/app/components/LangProvider'
import {
  clearEshopTrayBaseUrl,
  eshopTrayAddressFromBaseUrl,
  normalizeEshopTrayAddress,
  readSavedEshopTrayBaseUrl,
  saveEshopTrayBaseUrl,
  testEshopTrayConnection,
  type EshopTrayHealth,
} from '@/lib/eShopTrayClient'

type ConnectionState = 'unset' | 'unconnected' | 'checking' | 'connected' | 'failed'

export default function EshopTraySettings() {
  const { t } = useLocale()
  const [open, setOpen] = useState(false)
  const [address, setAddress] = useState('')
  const [connectionState, setConnectionState] = useState<ConnectionState>('unset')
  const [verifiedBaseUrl, setVerifiedBaseUrl] = useState<string | null>(null)
  const [connectedHealth, setConnectedHealth] = useState<EshopTrayHealth | null>(null)
  const [testing, setTesting] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const savedBaseUrl = readSavedEshopTrayBaseUrl()
    if (savedBaseUrl) {
      setAddress(eshopTrayAddressFromBaseUrl(savedBaseUrl))
      setConnectionState('unconnected')
    }
  }, [])

  const normalizedBaseUrl = useMemo(() => normalizeEshopTrayAddress(address), [address])
  const canSave = !!normalizedBaseUrl && normalizedBaseUrl === verifiedBaseUrl && !testing

  function updateAddress(value: string) {
    setAddress(value)
    setConnectionState(value.trim() ? 'unconnected' : 'unset')
    setVerifiedBaseUrl(null)
    setConnectedHealth(null)
    setNotice('')
  }

  async function handleTestConnection() {
    setTesting(true)
    setConnectionState('checking')
    setNotice('')
    setVerifiedBaseUrl(null)
    setConnectedHealth(null)
    try {
      const endpoint = await testEshopTrayConnection(address)
      setVerifiedBaseUrl(endpoint.baseUrl)
      setConnectedHealth(endpoint.health)
      setConnectionState('connected')
    } catch {
      setConnectionState('failed')
      setNotice(normalizedBaseUrl ? t('tray.connectionFailed') : t('tray.invalidAddress'))
    } finally {
      setTesting(false)
    }
  }

  function handleSave() {
    if (!canSave || !verifiedBaseUrl) return
    try {
      saveEshopTrayBaseUrl(verifiedBaseUrl)
      setNotice(t('tray.saved'))
      setConnectionState('connected')
    } catch {
      setNotice(t('tray.storageFailed'))
    }
  }

  function handleClear() {
    clearEshopTrayBaseUrl()
    setAddress('')
    setVerifiedBaseUrl(null)
    setConnectedHealth(null)
    setConnectionState('unset')
    setNotice(t('tray.cleared'))
  }

  const statusLabel = connectionState === 'unset'
    ? t('tray.unset')
    : connectionState === 'checking'
      ? t('tray.checking')
      : connectionState === 'connected'
        ? t('tray.connected')
        : connectionState === 'failed'
          ? t('tray.failed')
          : t('tray.unconnected')
  const statusColor = connectionState === 'connected'
    ? '#15803d'
    : connectionState === 'failed'
      ? '#b91c1c'
      : connectionState === 'checking'
        ? '#2563eb'
        : '#6b7280'

  return (
    <>
      <button
        type="button"
        style={s.trigger}
        onClick={() => setOpen(true)}
        data-eshop-tray-settings-trigger
      >
        {t('tray.entry')}
      </button>

      {open && (
        <div
          role="presentation"
          style={s.overlay}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false)
          }}
        >
          <section role="dialog" aria-modal="true" aria-labelledby="eshop-tray-settings-title" style={s.dialog}>
            <div style={s.titleRow}>
              <div>
                <div id="eshop-tray-settings-title" style={s.title}>{t('tray.title')}</div>
                <div style={s.subtitle}>{t('tray.subtitle')}</div>
              </div>
              <button type="button" aria-label={t('common.close')} style={s.close} onClick={() => setOpen(false)}>×</button>
            </div>

            <label htmlFor="eshop-tray-address" style={s.label}>{t('tray.address')}</label>
            <input
              id="eshop-tray-address"
              value={address}
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="192.168.18.48"
              style={s.input}
              onChange={(event) => updateAddress(event.target.value)}
              data-eshop-tray-address-input
            />
            <div style={s.hint}>{t('tray.endpointHint')}</div>

            <div style={s.statusRow} aria-live="polite">
              <span style={s.statusTitle}>{t('tray.status')}</span>
              <span style={{ ...s.statusValue, color: statusColor }} data-eshop-tray-status={connectionState}>
                <span style={{ ...s.statusDot, background: statusColor }} />
                {statusLabel}
              </span>
            </div>

            {connectionState === 'connected' && connectedHealth && (
              <div style={s.serviceCard} data-eshop-tray-service-online>
                <span style={s.serviceName}>E-Shop Tray</span>
                <span style={s.onlineLabel}>{t('tray.online')}</span>
                <span style={s.versionLabel}>{t('tray.version')} {connectedHealth.version}</span>
              </div>
            )}

            {notice && (
              <div style={{ ...s.notice, color: connectionState === 'failed' ? '#b91c1c' : '#166534' }} role="status">
                {notice}
              </div>
            )}

            <div style={s.actions}>
              <button
                type="button"
                style={s.secondaryButton}
                disabled={testing || !address.trim()}
                onClick={handleTestConnection}
                data-eshop-tray-test
              >
                {testing ? t('tray.testing') : t('tray.test')}
              </button>
              <button
                type="button"
                style={{ ...s.primaryButton, ...(!canSave ? s.disabledButton : {}) }}
                disabled={!canSave}
                onClick={handleSave}
                data-eshop-tray-save
              >
                {t('tray.save')}
              </button>
            </div>

            <button type="button" style={s.clearButton} onClick={handleClear} data-eshop-tray-clear>
              {t('tray.clear')}
            </button>
          </section>
        </div>
      )}
    </>
  )
}

const s: Record<string, CSSProperties> = {
  trigger: {
    minWidth: 82,
    minHeight: 30,
    padding: '5px 10px',
    borderRadius: 999,
    border: '1px solid #dbeafe',
    background: '#eff6ff',
    color: '#1d4ed8',
    fontSize: 11,
    fontWeight: 750,
    whiteSpace: 'nowrap',
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 1200,
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    padding: 14,
    background: 'rgba(15, 23, 42, 0.48)',
  },
  dialog: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 22,
    background: '#fff',
    padding: '20px 18px 18px',
    boxShadow: '0 24px 70px rgba(15, 23, 42, 0.28)',
  },
  titleRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 20,
  },
  title: { fontSize: 20, fontWeight: 850, color: '#111827' },
  subtitle: { marginTop: 4, fontSize: 12, lineHeight: 1.45, color: '#6b7280' },
  close: {
    width: 32,
    height: 32,
    border: 0,
    borderRadius: '50%',
    background: '#f3f4f6',
    color: '#4b5563',
    fontSize: 22,
    lineHeight: 1,
  },
  label: { display: 'block', marginBottom: 7, fontSize: 13, fontWeight: 750, color: '#374151' },
  input: {
    width: '100%',
    minHeight: 48,
    boxSizing: 'border-box',
    padding: '11px 13px',
    border: '1px solid #d1d5db',
    borderRadius: 12,
    outline: 'none',
    background: '#fff',
    color: '#111827',
    fontSize: 16,
  },
  hint: { marginTop: 7, fontSize: 11, lineHeight: 1.4, color: '#6b7280' },
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
    padding: '12px 13px',
    borderRadius: 12,
    background: '#f8fafc',
  },
  statusTitle: { fontSize: 13, color: '#4b5563' },
  statusValue: { display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 800 },
  statusDot: { display: 'inline-block', width: 8, height: 8, borderRadius: '50%' },
  serviceCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    padding: '11px 13px',
    border: '1px solid #bbf7d0',
    borderRadius: 12,
    background: '#f0fdf4',
  },
  serviceName: { fontSize: 13, fontWeight: 850, color: '#166534' },
  onlineLabel: {
    padding: '3px 7px',
    borderRadius: 999,
    background: '#dcfce7',
    color: '#15803d',
    fontSize: 10,
    fontWeight: 850,
    textTransform: 'uppercase',
  },
  versionLabel: { marginLeft: 'auto', fontSize: 11, color: '#166534' },
  notice: { marginTop: 10, fontSize: 12, lineHeight: 1.45 },
  actions: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 18 },
  secondaryButton: {
    minHeight: 46,
    borderRadius: 12,
    border: '1px solid #bfdbfe',
    background: '#eff6ff',
    color: '#1d4ed8',
    fontSize: 14,
    fontWeight: 800,
  },
  primaryButton: {
    minHeight: 46,
    borderRadius: 12,
    border: 0,
    background: '#2563eb',
    color: '#fff',
    fontSize: 14,
    fontWeight: 800,
  },
  disabledButton: { opacity: 0.45 },
  clearButton: {
    display: 'block',
    margin: '13px auto 0',
    padding: '8px 12px',
    border: 0,
    background: 'transparent',
    color: '#6b7280',
    fontSize: 12,
  },
}
