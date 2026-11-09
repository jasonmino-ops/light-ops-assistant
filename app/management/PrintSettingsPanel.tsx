'use client'

import { useEffect, useState } from 'react'
import { useLocale } from '@/app/components/LangProvider'
import type { PrintSettingsReply, PrintSettingsRequest, PrintSettingsState, UsbQueueChoice } from '../../desktop/src/shared/v3PrintSettings'

declare global {
  interface Window {
    eshopDesktopV3PrintSettings?: { request: (input: PrintSettingsRequest) => Promise<PrintSettingsReply> }
  }
}

const statusKeys: Record<string, string> = {
  PRINT_SETTINGS_AUTHORITY_REQUIRED: 'authority',
  NO_OWNER_SCOPED_BATCH: 'authority',
  CONTROL_PLANE_FENCED: 'authority',
  PRINT_SETTINGS_CANCELLED: 'cancelled',
  PRINT_SETTINGS_BUSY: 'busy',
  PRINT_SETTINGS_PENDING_REPORTS: 'pending',
  PRINT_SETTINGS_STORE_MISMATCH: 'store',
  ENDPOINT_CONFIG_REVISION_STALE: 'stale',
  ENDPOINT_CONFIG_INVALID: 'invalid',
  PRINT_SETTINGS_INPUT_INVALID: 'invalid',
  USB_QUEUE_NOT_READY: 'queueChanged',
  USB_QUEUE_DISCOVERY_FAILED: 'discovery',
  USB_FRONT_NOT_CONFIGURED: 'usbNotSaved',
  USB_TEST_FAILED_NOT_CROSSED: 'notSent',
  LOCAL_EFFECT_AMBIGUITY: 'unknown',
  USB_TEST_EXECUTION_UNVERIFIABLE: 'unknown',
  SETTINGS_SAVED: 'saved',
  USB_TEST_SPOOLED: 'spooled',
}

const additionalCodes = new Set([
  'PRINT_SETTINGS_UNAVAILABLE', 'PRINT_SETTINGS_CHANGE_FAILED', 'PRINT_SETTINGS_ACCESS_DENIED',
  'ENDPOINT_CONFIG_CORRUPT', 'ENDPOINT_CONFIG_UNAVAILABLE',
  'ENDPOINT_IDENTITY_MISMATCH', 'ENDPOINT_SECURE_STORAGE_UNAVAILABLE', 'USB_TEST_UNAVAILABLE',
  'USB_TEST_NOT_EXECUTED', 'RUNTIME_STOPPED',
])

function statusCode(value: string): string {
  return Object.hasOwn(statusKeys, value) || additionalCodes.has(value) ? value : 'PRINT_SETTINGS_UNAVAILABLE'
}

export function PrintSettingsPanel({ storeCode, onLegacy, legacyBusy }: {
  storeCode: string | null
  onLegacy: () => void
  legacyBusy: boolean
}) {
  const { t } = useLocale()
  const [state, setState] = useState<PrintSettingsState | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [frontKind, setFrontKind] = useState<'USB' | 'TCP'>('TCP')
  const [frontHost, setFrontHost] = useState('')
  const [frontPort, setFrontPort] = useState('9100')
  const [kitchenHost, setKitchenHost] = useState('')
  const [kitchenPort, setKitchenPort] = useState('9100')
  const [queues, setQueues] = useState<UsbQueueChoice[] | null>(null)
  const [queueKey, setQueueKey] = useState('')
  const [testLocked, setTestLocked] = useState(false)

  function apply(snapshot: PrintSettingsState) {
    setState(snapshot)
    setFrontKind(snapshot.front?.kind ?? 'TCP')
    setFrontHost(snapshot.front?.kind === 'TCP' ? snapshot.front.host : '')
    setFrontPort(snapshot.front?.kind === 'TCP' ? String(snapshot.front.port) : '9100')
    setKitchenHost(snapshot.kitchen?.host ?? '')
    setKitchenPort(snapshot.kitchen ? String(snapshot.kitchen.port) : '9100')
    setQueueKey('')
  }

  useEffect(() => {
    const bridge = window.eshopDesktopV3PrintSettings
    if (!storeCode || !bridge) return
    let active = true
    bridge.request({ action: 'read', storeCode }).then((reply) => {
      if (!active) return
      if (reply.ok && 'state' in reply) apply(reply.state)
      else if (!reply.ok) setStatus(statusCode(reply.code))
    }).catch(() => { if (active) setStatus('PRINT_SETTINGS_UNAVAILABLE') })
    return () => { active = false }
  }, [storeCode])

  async function run(request: PrintSettingsRequest) {
    const bridge = window.eshopDesktopV3PrintSettings
    if (!bridge || busy) return
    setBusy(true)
    setStatus(null)
    try {
      const reply = await bridge.request(request)
      if (!reply.ok) {
        setStatus(statusCode(reply.code))
        if (request.action === 'test' && ['LOCAL_EFFECT_AMBIGUITY', 'USB_TEST_EXECUTION_UNVERIFIABLE', 'PRINT_SETTINGS_UNAVAILABLE'].includes(reply.code)) {
          setTestLocked(true)
        }
        return
      }
      if ('state' in reply) apply(reply.state)
      if ('queues' in reply) {
        setQueues(reply.queues)
        setQueueKey('')
      }
      if ('code' in reply) {
        setStatus(reply.code)
        if (reply.code === 'USB_TEST_SPOOLED') setTestLocked(true)
        if (reply.code === 'SETTINGS_SAVED') {
          const refreshed = await bridge.request({ action: 'read', storeCode: request.storeCode })
          if (refreshed.ok && 'state' in refreshed) apply(refreshed.state)
          else setState(null)
        }
      }
    } catch {
      if (request.action === 'test') {
        setStatus('USB_TEST_EXECUTION_UNVERIFIABLE')
        setTestLocked(true)
      } else {
        setStatus('PRINT_SETTINGS_UNAVAILABLE')
        if (request.action === 'save') setState(null)
      }
    } finally {
      setBusy(false)
    }
  }

  const selected = queues?.find((queue) => queue.key === queueKey)
  const effectiveStatus = status ?? state?.blockedCode
  const canEdit = !!state && state.mode === 'V3' && !state.blockedCode && effectiveStatus !== 'LOCAL_EFFECT_AMBIGUITY' && !busy
  const configured = (endpoint: PrintSettingsState['front']) => endpoint?.kind === 'USB'
    ? `${endpoint.queueName} (${endpoint.portName})`
    : endpoint?.kind === 'TCP' ? `${endpoint.host}:${endpoint.port}` : t('printSettings.notConfigured')

  const noticeKey = effectiveStatus ? statusKeys[statusCode(effectiveStatus)] ?? 'failed' : null
  const noticeTone = noticeKey === 'unknown' || noticeKey === 'invalid' || noticeKey === 'failed'
    ? 'error' : noticeKey === 'saved' || noticeKey === 'spooled' ? 'success' : 'notice'
  const frontSummary = state?.front?.kind ?? ''
  const button = (primary = false): React.CSSProperties => primary ? { ...styles.button, ...styles.primary } : styles.button

  return (
    <div data-print-settings-ui style={styles.panel}>
      <style>{`
        [data-print-settings-ui] :is(button, input, select):focus-visible { outline: 2px solid #155dcc; outline-offset: 2px; }
        [data-print-settings-ui] button:disabled, [data-print-settings-ui] fieldset:disabled button { opacity: .55; cursor: not-allowed; }
      `}</style>
      <div style={styles.toolbar}>
        <p style={styles.body}>{state?.mode === 'V3' ? t('printSettings.v3Only') : t('printSettings.deviceScope')}</p>
        {storeCode && <button type="button" style={button()} disabled={busy} onClick={() => run({ action: 'read', storeCode })}>
          {t('printSettings.refresh')}
        </button>}
      </div>
      {!storeCode && <p role="status" style={styles.body}>{t('printSettings.store')}</p>}
      {storeCode && !state && !effectiveStatus && <p role="status" style={styles.body}>{t('printSettings.loading')}</p>}
      {state?.mode === 'LEGACY' && <div style={styles.notice}>
        <p style={styles.body}>{t('printSettings.legacyOnly')}</p>
        <button type="button" style={button()} disabled={legacyBusy} onClick={onLegacy}>{t('printSettings.openLegacy')}</button>
      </div>}
      {effectiveStatus && noticeKey && (
        <div role="status" style={{ ...styles.notice, ...noticeStyles[noticeTone] }}>
          <div>
            <strong>{t(`printSettings.${noticeTitles[noticeKey] ?? 'noticeTitle'}`)}</strong>
            <p style={styles.noticeText}>{t(`printSettings.${noticeKey}`)}</p>
          </div>
          <code style={styles.code}>{statusCode(effectiveStatus)}</code>
        </div>
      )}
      {state?.mode === 'V3' && storeCode && <>
        <div style={styles.cards}>
          <fieldset aria-labelledby="front-printer-title" disabled={busy} style={styles.card}>
            <div style={styles.cardHeader}>
              <div>
                <h3 id="front-printer-title" style={styles.cardTitle}>{t('printSettings.frontTitle')}</h3>
                <p style={styles.description}>{t('management.frontPrinterDesc')}</p>
              </div>
              <span style={styles.badge}>{frontSummary || t('printSettings.notConfigured')}</span>
            </div>
            <div style={styles.saved}>
              <span style={styles.label}>{t('printSettings.current')}</span>
              <strong style={styles.configured}>{configured(state.front)}</strong>
            </div>
            <label style={styles.field}>{t('printSettings.method')}
              <select style={styles.control} value={frontKind} onChange={(event) => setFrontKind(event.target.value === 'USB' ? 'USB' : 'TCP')}>
                <option value="TCP">TCP</option>
                {state.usbSupported && <option value="USB">USB</option>}
              </select>
            </label>
            {frontKind === 'USB' ? <>
              <div style={styles.queueRow}>
                <label style={{ ...styles.field, flex: '1 1 180px' }}>{t('printSettings.queue')}
                  <select style={styles.control} value={queueKey} disabled={!queues?.length} onChange={(event) => setQueueKey(event.target.value)}>
                    <option value="">{t('printSettings.choose')}</option>
                    {queues?.map((queue) => <option key={queue.key} value={queue.key}>{queue.queueName} ({queue.portName})</option>)}
                  </select>
                </label>
                <button type="button" style={button()} onClick={() => run({ action: 'queues', storeCode })}>{t('printSettings.findQueues')}</button>
              </div>
              <p role={queues?.length === 0 ? 'status' : undefined} style={queues?.length === 0 ? styles.noQueues : styles.description}>
                {t(queues?.length === 0 ? 'printSettings.noQueues' : 'printSettings.usbHelp')}
              </p>
            </> : (
              <div style={styles.addressRow}>
                <label style={styles.field}>{t('printSettings.host')}
                  <input style={styles.control} value={frontHost} onChange={(event) => setFrontHost(event.target.value)} />
                </label>
                <label style={styles.field}>{t('printSettings.port')}
                  <input style={styles.control} type="number" min="1" max="65535" value={frontPort} onChange={(event) => setFrontPort(event.target.value)} />
                </label>
              </div>
            )}
            <div style={styles.cardFooter}>
              <div style={styles.actions}>
                <button type="button" style={button(true)} disabled={!canEdit || (frontKind === 'USB' ? !selected : !frontHost || !frontPort)} onClick={() => {
                  if (frontKind === 'USB' && !selected) return
                  void run({ action: 'save', role: 'FRONT', storeCode, revision: state.revision, target: frontKind === 'USB' && selected
                    ? { kind: 'USB', ...selected } : { kind: 'TCP', host: frontHost.trim(), port: Number(frontPort) } })
                }}>{t('printSettings.save')}</button>
                <button type="button" style={button()} disabled={!canEdit || state.front?.kind !== 'USB' || testLocked} onClick={() => {
                  void run({ action: 'test', storeCode, revision: state.revision })
                }}>{t('printSettings.test')}</button>
              </div>
              <p style={styles.description}>{t(testLocked ? 'printSettings.testLockedHelp' : 'printSettings.testHelp')}</p>
            </div>
          </fieldset>
          <fieldset aria-labelledby="kitchen-printer-title" disabled={busy} style={styles.card}>
            <div style={styles.cardHeader}>
              <div>
                <h3 id="kitchen-printer-title" style={styles.cardTitle}>{t('printSettings.kitchenTitle')}</h3>
                <p style={styles.description}>{t('management.kitchenPrinterDesc')}</p>
              </div>
              <span style={styles.badge}>TCP</span>
            </div>
            <div style={styles.saved}>
              <span style={styles.label}>{t('printSettings.current')}</span>
              <strong style={styles.configured}>{configured(state.kitchen)}</strong>
            </div>
            <div style={styles.addressRow}>
              <label style={styles.field}>{t('printSettings.host')}
                <input style={styles.control} value={kitchenHost} onChange={(event) => setKitchenHost(event.target.value)} />
              </label>
              <label style={styles.field}>{t('printSettings.port')}
                <input style={styles.control} type="number" min="1" max="65535" value={kitchenPort} onChange={(event) => setKitchenPort(event.target.value)} />
              </label>
            </div>
            <p style={styles.description}>{t('printSettings.kitchenHelp')}</p>
            <div style={styles.cardFooter}>
              <button type="button" style={button(true)} disabled={!canEdit || !kitchenHost || !kitchenPort} onClick={() => {
                void run({ action: 'save', role: 'KITCHEN', storeCode, revision: state.revision,
                  target: { kind: 'TCP', host: kitchenHost.trim(), port: Number(kitchenPort) } })
              }}>{t('printSettings.save')}</button>
            </div>
          </fieldset>
        </div>
        <p style={styles.footnote}>{t('printSettings.pause')}</p>
      </>}
    </div>
  )
}

const noticeTitles: Record<string, string> = {
  authority: 'authorityTitle',
  queueChanged: 'queueChangedTitle',
  invalid: 'invalidTitle',
  stale: 'staleTitle',
  unknown: 'unknownTitle',
  saved: 'savedTitle',
  spooled: 'spooledTitle',
}

const noticeStyles = {
  notice: { background: '#fff8e9', borderColor: '#e9d3a4', color: '#65460f' },
  error: { background: '#fff2f0', borderColor: '#ecc4bf', color: '#822b28' },
  success: { background: '#eef8f2', borderColor: '#c6e1d0', color: '#245b3b' },
}

const styles: Record<string, React.CSSProperties> = {
  panel: { display: 'grid', gap: 16, marginTop: 20 },
  toolbar: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  body: { margin: 0, color: '#536174', fontSize: 14, lineHeight: 1.55 },
  cards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 400px), 1fr))', gap: 16 },
  card: {
    minWidth: 0, margin: 0, padding: 18, display: 'flex', flexDirection: 'column', gap: 13,
    border: '1px solid #dfe6ef', borderRadius: 14, background: '#fbfcfe',
  },
  cardHeader: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 9 },
  cardTitle: { margin: '0 0 4px', fontSize: 18, lineHeight: 1.35, fontWeight: 750 },
  badge: { padding: '4px 9px', borderRadius: 999, background: '#eaf2fd', color: '#245489', fontSize: 12, fontWeight: 700 },
  saved: { display: 'grid', gap: 4, padding: '10px 12px', borderRadius: 9, background: '#edf3fa', minWidth: 0 },
  label: { color: '#536174', fontSize: 12 },
  configured: { fontSize: 14, lineHeight: 1.4, overflowWrap: 'anywhere' },
  field: { display: 'grid', gap: 5, color: '#34445b', fontSize: 13, fontWeight: 650, minWidth: 0 },
  control: {
    width: '100%', minWidth: 0, minHeight: 38, boxSizing: 'border-box', border: '1px solid #ccd7e6',
    borderRadius: 8, background: '#fff', color: '#182234', padding: '6px 9px', font: 'inherit', fontWeight: 500,
  },
  addressRow: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(82px, 120px)', gap: 10 },
  queueRow: { display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 8 },
  description: { margin: 0, color: '#536174', fontSize: 13, lineHeight: 1.55 },
  noQueues: { margin: 0, padding: '8px 10px', borderRadius: 8, background: '#fff4db', color: '#65460f', fontSize: 13, lineHeight: 1.5 },
  cardFooter: { display: 'grid', justifyItems: 'start', gap: 8, borderTop: '1px solid #e1e8f2', marginTop: 'auto', paddingTop: 12 },
  actions: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  button: {
    minHeight: 38, border: '1px solid #ccd7e6', borderRadius: 8, padding: '6px 12px', background: '#fff',
    color: '#1857ad', font: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'normal',
  },
  primary: { background: '#155dcc', borderColor: '#155dcc', color: '#fff' },
  notice: {
    display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'start', gap: 8,
    padding: '11px 13px', border: '1px solid #dfe6ef', borderRadius: 10, fontSize: 14,
  },
  noticeText: { margin: '3px 0 0', lineHeight: 1.5 },
  code: { maxWidth: '100%', padding: '3px 6px', borderRadius: 5, background: '#ffffffa8', fontSize: 11, overflowWrap: 'anywhere' },
  footnote: { margin: 0, color: '#536174', fontSize: 13, lineHeight: 1.55 },
}
