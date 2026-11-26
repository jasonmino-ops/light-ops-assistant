'use client'

import { useEffect, useRef, useState } from 'react'
import { useLocale } from '@/app/components/LangProvider'
import { telegramPresenceHeaders } from '@/lib/inventory-profit/client'

type Target = { confirmationId: string; deviceId: string; previousDeviceId: string; previousEpoch: number; expectedStateVersion: number }
const endpoint = '/api/owner/v3-print-control-plane'

export function PrintReplacementConfirmation({ storeId }: { storeId: string }) {
  const { t } = useLocale()
  const [targets, setTargets] = useState<Target[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [currentDevice, setCurrentDevice] = useState('')
  const inFlight = useRef(false)

  useEffect(() => {
    const headers = telegramPresenceHeaders()
    if (!headers) return
    const controller = new AbortController()
    const receiptId = sessionStorage.getItem('eshop:print-replacement:' + storeId)
    const readUrl = receiptId ? endpoint + '?confirmationId=' + encodeURIComponent(receiptId) : endpoint
    fetch(readUrl, { headers, cache: 'no-store', signal: controller.signal })
      .then(async res => {
        if (!res.ok) return
        const data = await res.json()
        if (controller.signal.aborted || data.storeId !== storeId || !Array.isArray(data.targets)) return
        setTargets(data.targets)
        if (receiptId && data.plane?.ownerDeviceId) setCurrentDevice(data.plane.ownerDeviceId)
        if (data.confirmed) setMessage(t('printSettings.replaceDone') + ' ' + data.confirmed.deviceId + ' · epoch ' + data.confirmed.epoch)
      }).catch(() => {})
    return () => controller.abort()
  }, [storeId, t])

  async function confirm(target: Target) {
    const headers = telegramPresenceHeaders()
    if (inFlight.current || !headers || !window.confirm(t('printSettings.replaceWarning') + '\n' +
        target.previousDeviceId + ' → ' + target.deviceId)) return
    inFlight.current = true
    setBusy(true)
    setMessage('')
    try {
      sessionStorage.setItem('eshop:print-replacement:' + storeId, target.confirmationId)
      const response = await fetch(endpoint, { method: 'POST', cache: 'no-store', headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'REPLACE_PRINT_COMPUTER', storeId, ...target, previousDeviceStopped: true }) })
      const result = await response.json()
      if (!response.ok || result.ok !== true || result.ownerDeviceId !== target.deviceId || result.epoch !== target.previousEpoch + 1) {
        setMessage(t('printSettings.replaceReadback') + (typeof result.error === 'string' ? ' (' + result.error + ')' : ''))
      } else setMessage(t('printSettings.replaceDone') + ' ' + target.deviceId)
    } catch { setMessage(t('printSettings.replaceReadback')) }
    finally {
      // A lost POST reply is ambiguous. Only read back the plane; never repeat the mutation.
      try {
        const read = await fetch(endpoint + '?confirmationId=' + encodeURIComponent(target.confirmationId), { headers, cache: 'no-store' })
        const state = read.ok && await read.json()
        if (state?.storeId === storeId && state.plane?.mode === 'V3_ACTIVE' && typeof state.plane.ownerDeviceId === 'string') {
          setCurrentDevice(state.plane.ownerDeviceId)
          if (state.confirmed?.deviceId === target.deviceId && state.confirmed.epoch === target.previousEpoch + 1) {
            setMessage(t('printSettings.replaceDone') + ' ' + target.deviceId + ' · epoch ' + state.confirmed.epoch)
          }
        }
      } catch {}
      setTargets([])
      setBusy(false)
      inFlight.current = false
    }
  }

  if (!targets.length && !message && !currentDevice) return null
  return <div>{targets.map(target => <p key={target.confirmationId}>
    <button type="button" disabled={busy} onClick={() => void confirm(target)}>{t('printSettings.replaceButton')} · {target.deviceId}</button>
  </p>)}{message && <p role="status">{message}</p>}{currentDevice && <p>{t('printSettings.currentComputer')} · {currentDevice}</p>}</div>
}
