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
  PRINT_SETTINGS_CANCELLED: 'cancelled',
  PRINT_SETTINGS_BUSY: 'busy',
  PRINT_SETTINGS_PENDING_REPORTS: 'pending',
  PRINT_SETTINGS_STORE_MISMATCH: 'store',
  ENDPOINT_CONFIG_REVISION_STALE: 'stale',
  ENDPOINT_CONFIG_INVALID: 'invalid',
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
  'PRINT_SETTINGS_INPUT_INVALID', 'ENDPOINT_CONFIG_CORRUPT', 'ENDPOINT_CONFIG_UNAVAILABLE',
  'ENDPOINT_IDENTITY_MISMATCH', 'ENDPOINT_SECURE_STORAGE_UNAVAILABLE', 'USB_TEST_UNAVAILABLE',
  'USB_TEST_NOT_EXECUTED', 'NO_OWNER_SCOPED_BATCH', 'RUNTIME_STOPPED', 'CONTROL_PLANE_FENCED',
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
  const canEdit = !!state && state.mode === 'V3' && !state.blockedCode && !busy
  const configured = (endpoint: PrintSettingsState['front']) => endpoint?.kind === 'USB'
    ? `${endpoint.queueName} (${endpoint.portName})`
    : endpoint?.kind === 'TCP' ? `${endpoint.host}:${endpoint.port}` : t('printSettings.notConfigured')

  return (
    <div>
      {storeCode && <button type="button" disabled={busy} onClick={() => run({ action: 'read', storeCode })}>
        {t('printSettings.refresh')}
      </button>}
      {!storeCode && <p>{t('printSettings.store')}</p>}
      {state?.mode === 'LEGACY' && <>
        <p>{t('printSettings.legacyOnly')}</p>
        <button type="button" disabled={legacyBusy} onClick={onLegacy}>{t('printSettings.openLegacy')}</button>
      </>}
      {state?.mode === 'V3' && storeCode && <>
        <p>{t('printSettings.v3Only')}</p>
        <p>{t('printSettings.pause')}</p>
        <fieldset disabled={busy}>
          <legend>{t('management.frontPrinter')}</legend>
          <p>{t('printSettings.current')} {configured(state.front)}</p>
          <label>{t('printSettings.method')}{' '}
            <select value={frontKind} onChange={(event) => setFrontKind(event.target.value === 'USB' ? 'USB' : 'TCP')}>
              <option value="TCP">TCP</option>
              {state.usbSupported && <option value="USB">USB</option>}
            </select>
          </label>
          {frontKind === 'USB' ? <>
            <button type="button" onClick={() => run({ action: 'queues', storeCode })}>{t('printSettings.findQueues')}</button>
            {queues?.length === 0 && <p>{t('printSettings.noQueues')}</p>}
            {!!queues?.length && <label>{t('printSettings.queue')}{' '}
              <select value={queueKey} onChange={(event) => setQueueKey(event.target.value)}>
                <option value="">{t('printSettings.choose')}</option>
                {queues.map((queue) => <option key={queue.key} value={queue.key}>{queue.queueName} ({queue.portName})</option>)}
              </select>
            </label>}
          </> : <>
            <label>{t('printSettings.host')}{' '}<input value={frontHost} onChange={(event) => setFrontHost(event.target.value)} /></label>
            <label>{t('printSettings.port')}{' '}<input type="number" min="1" max="65535" value={frontPort}
              onChange={(event) => setFrontPort(event.target.value)} /></label>
          </>}
          <button type="button" disabled={!canEdit || (frontKind === 'USB' ? !selected : !frontHost || !frontPort)} onClick={() => {
            if (frontKind === 'USB' && !selected) return
            void run({ action: 'save', role: 'FRONT', storeCode, revision: state.revision, target: frontKind === 'USB' && selected
              ? { kind: 'USB', ...selected } : { kind: 'TCP', host: frontHost.trim(), port: Number(frontPort) } })
          }}>{t('printSettings.save')}</button>
          <button type="button" disabled={!canEdit || state.front?.kind !== 'USB' || testLocked} onClick={() => {
            void run({ action: 'test', storeCode, revision: state.revision })
          }}>{t('printSettings.test')}</button>
        </fieldset>
        <fieldset disabled={busy}>
          <legend>{t('management.kitchenPrinter')} · TCP</legend>
          <p>{t('printSettings.current')} {configured(state.kitchen)}</p>
          <label>{t('printSettings.host')}{' '}<input value={kitchenHost} onChange={(event) => setKitchenHost(event.target.value)} /></label>
          <label>{t('printSettings.port')}{' '}<input type="number" min="1" max="65535" value={kitchenPort}
            onChange={(event) => setKitchenPort(event.target.value)} /></label>
          <button type="button" disabled={!canEdit || !kitchenHost || !kitchenPort} onClick={() => {
            void run({ action: 'save', role: 'KITCHEN', storeCode, revision: state.revision,
              target: { kind: 'TCP', host: kitchenHost.trim(), port: Number(kitchenPort) } })
          }}>{t('printSettings.save')}</button>
        </fieldset>
      </>}
      {effectiveStatus && <p role="status">
        {t(`printSettings.${statusKeys[effectiveStatus] ?? 'failed'}`)}{' '}<code>{effectiveStatus}</code>
      </p>}
    </div>
  )
}
