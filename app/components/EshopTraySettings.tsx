'use client'

import { useState, type CSSProperties } from 'react'
import { apiFetch } from '@/lib/api'
import { useLocale } from '@/app/components/LangProvider'
import { useWorkMode } from '@/app/components/WorkModeProvider'

type ConnectionCode = { pin: string; expiresAt: string }
type SetupState = 'idle' | 'creating' | 'ready' | 'failed'

export default function EshopTraySettings() {
  const { t } = useLocale()
  const { storeId } = useWorkMode()
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<SetupState>('idle')
  const [code, setCode] = useState<ConnectionCode | null>(null)

  async function createConnectionCode() {
    if (!storeId || state === 'creating') return
    setState('creating')
    setCode(null)
    try {
      const response = await apiFetch('/api/desktop/activation-pins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId }),
      })
      const body = await response.json().catch(() => null) as { pin?: unknown; expiresAt?: unknown } | null
      if (!response.ok || typeof body?.pin !== 'string' || !/^\d{6}$/.test(body.pin) || typeof body.expiresAt !== 'string') {
        throw new Error('FIELD_CONNECTION_CODE_FAILED')
      }
      setCode({ pin: body.pin, expiresAt: body.expiresAt })
      setState('ready')
    } catch {
      setState('failed')
    }
  }

  const statusColor = state === 'ready' ? '#15803d' : state === 'failed' ? '#b91c1c' : state === 'creating' ? '#2563eb' : '#6b7280'
  const statusLabel = state === 'ready'
    ? t('tray.codeReady')
    : state === 'failed'
      ? t('tray.cloudFailed')
      : state === 'creating'
        ? t('tray.creatingCode')
        : t('tray.cloudReady')

  return (
    <>
      <button type="button" style={s.trigger} onClick={() => setOpen(true)} data-eshop-tray-settings-trigger>
        {t('tray.entry')}
      </button>
      {open && (
        <div role="presentation" style={s.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
          <section role="dialog" aria-modal="true" aria-labelledby="eshop-tray-settings-title" style={s.dialog}>
            <div style={s.titleRow}>
              <div>
                <div id="eshop-tray-settings-title" style={s.title}>{t('tray.title')}</div>
                <div style={s.subtitle}>{t('tray.cloudSubtitle')}</div>
              </div>
              <button type="button" aria-label={t('common.close')} style={s.close} onClick={() => setOpen(false)}>×</button>
            </div>

            <div style={s.statusRow} aria-live="polite">
              <span style={s.statusTitle}>{t('tray.cloudRelay')}</span>
              <span style={{ ...s.statusValue, color: statusColor }} data-eshop-tray-cloud-status={state}>
                <span style={{ ...s.statusDot, background: statusColor }} />{statusLabel}
              </span>
            </div>

            <div style={s.hint}>{t('tray.cloudHint')}</div>

            {code && (
              <div style={s.codeCard} data-eshop-tray-connection-code>
                <span style={s.codeLabel}>{t('tray.connectionCode')}</span>
                <strong style={s.codeValue}>{code.pin}</strong>
                <span style={s.codeHint}>{t('tray.connectionCodeHint')}</span>
              </div>
            )}

            {state === 'failed' && <div style={s.error} role="status">{t('tray.codeFailed')}</div>}

            <button
              type="button"
              style={{ ...s.primaryButton, ...(!storeId || state === 'creating' ? s.disabledButton : {}) }}
              disabled={!storeId || state === 'creating'}
              onClick={createConnectionCode}
              data-eshop-tray-create-code
            >
              {state === 'creating' ? t('tray.creatingCode') : code ? t('tray.regenerateCode') : t('tray.createCode')}
            </button>
          </section>
        </div>
      )}
    </>
  )
}

const s: Record<string, CSSProperties> = {
  trigger: { minWidth: 82, minHeight: 30, padding: '5px 10px', borderRadius: 999, border: '1px solid #dbeafe', background: '#eff6ff', color: '#1d4ed8', fontSize: 11, fontWeight: 750, whiteSpace: 'nowrap' },
  overlay: { position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 14, background: 'rgba(15, 23, 42, 0.48)' },
  dialog: { width: '100%', maxWidth: 440, borderRadius: 22, background: '#fff', padding: '20px 18px 18px', boxShadow: '0 24px 70px rgba(15, 23, 42, 0.28)' },
  titleRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20 },
  title: { fontSize: 20, fontWeight: 850, color: '#111827' },
  subtitle: { marginTop: 4, fontSize: 12, lineHeight: 1.45, color: '#6b7280' },
  close: { width: 32, height: 32, border: 0, borderRadius: '50%', background: '#f3f4f6', color: '#4b5563', fontSize: 22, lineHeight: 1 },
  statusRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 13px', borderRadius: 12, background: '#f8fafc' },
  statusTitle: { fontSize: 13, color: '#4b5563' },
  statusValue: { display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 800 },
  statusDot: { display: 'inline-block', width: 8, height: 8, borderRadius: '50%' },
  hint: { marginTop: 12, fontSize: 12, lineHeight: 1.55, color: '#4b5563' },
  codeCard: { display: 'grid', justifyItems: 'center', gap: 6, marginTop: 16, padding: 16, border: '1px solid #bbf7d0', borderRadius: 14, background: '#f0fdf4' },
  codeLabel: { fontSize: 12, color: '#166534' },
  codeValue: { fontSize: 30, letterSpacing: 6, color: '#14532d' },
  codeHint: { fontSize: 11, color: '#166534', textAlign: 'center' },
  error: { marginTop: 12, fontSize: 12, lineHeight: 1.45, color: '#b91c1c' },
  primaryButton: { width: '100%', minHeight: 46, marginTop: 18, borderRadius: 12, border: 0, background: '#2563eb', color: '#fff', fontSize: 14, fontWeight: 800 },
  disabledButton: { opacity: 0.45 },
}
