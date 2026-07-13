'use client'

import { CSSProperties, useEffect, useRef, useState } from 'react'
import {
  clearCustomerDisplay,
  connectCustomerDisplay,
  CUSTOMER_DISPLAY_DEFAULT_BAUD_RATE,
  CUSTOMER_DISPLAY_SUPPORTED_BAUD_RATES,
  CustomerDisplayStatus,
  disconnectCustomerDisplay,
  getCustomerDisplayStatus,
  reconnectAuthorizedCustomerDisplay,
  showCustomerDisplayAmount,
  subscribeCustomerDisplayStatus,
  testCustomerDisplay,
} from '@/lib/customer-display-adapter'

type SessionPayload = {
  status: 'DRAFT' | 'AWAITING_PAYMENT' | 'COMPLETED' | 'CANCELLED' | string
  totalAmount: number
  orderNo: string | null
  updatedAt: string
}

type ApiResp = {
  session: SessionPayload | null
}

type CustomerDisplayConfig = {
  enabled: boolean
  baudRate: number
  portInfo?: CustomerDisplayStatus['portInfo']
}

export const USB_CUSTOMER_DISPLAY_POLL_MS = 800
export const USB_CUSTOMER_DISPLAY_COMPLETED_LINGER_MS = 2500
export const USB_CUSTOMER_DISPLAY_CONFIG_KEY = 'cashier:customerDisplay:config'

function defaultConfig(): CustomerDisplayConfig {
  return { enabled: false, baudRate: CUSTOMER_DISPLAY_DEFAULT_BAUD_RATE }
}

function loadConfig(): CustomerDisplayConfig {
  try {
    const raw = window.localStorage.getItem(USB_CUSTOMER_DISPLAY_CONFIG_KEY)
    if (!raw) return defaultConfig()
    const parsed = JSON.parse(raw) as Partial<CustomerDisplayConfig>
    return {
      enabled: parsed.enabled === true,
      baudRate: parsed.baudRate === 9600 ? 9600 : CUSTOMER_DISPLAY_DEFAULT_BAUD_RATE,
      portInfo: parsed.portInfo ?? undefined,
    }
  } catch {
    return defaultConfig()
  }
}

function saveConfig(config: CustomerDisplayConfig) {
  try {
    window.localStorage.setItem(USB_CUSTOMER_DISPLAY_CONFIG_KEY, JSON.stringify({
      enabled: config.enabled,
      baudRate: config.baudRate === 9600 ? 9600 : CUSTOMER_DISPLAY_DEFAULT_BAUD_RATE,
      portInfo: config.portInfo ?? undefined,
    }))
  } catch {}
}

function isValidStoreCode(raw: string | null | undefined) {
  const value = raw?.trim()
  return !!value && /^[A-Za-z0-9_-]{2,80}$/.test(value)
}

function resolveStoreCode() {
  const params = new URLSearchParams(window.location.search)
  const urlStoreCode = params.get('storeCode')?.trim() || null
  if (isValidStoreCode(urlStoreCode)) return urlStoreCode
  try {
    const cached = window.localStorage.getItem('cashier:lastStoreCode')?.trim() || null
    if (isValidStoreCode(cached)) return cached
  } catch {}
  return null
}

function buildSessionSignature(session: SessionPayload) {
  return [
    session.orderNo || 'no-order',
    session.status || 'no-status',
    Number(session.totalAmount).toFixed(2),
    session.updatedAt || 'no-updated',
  ].join('|')
}

export function shouldSendCustomerDisplayAmount(
  session: SessionPayload,
  lastSuccessfulSignature: string | null,
  lastSuccessfulAmount: string | null,
) {
  const amount = Number(session.totalAmount)
  const amountKey = Number.isFinite(amount) ? amount.toFixed(2) : ''
  const signature = buildSessionSignature(session)
  return {
    shouldSend: session.status === 'AWAITING_PAYMENT'
      && amount > 0
      && signature !== lastSuccessfulSignature
      && amountKey !== lastSuccessfulAmount,
    amount,
    amountKey,
    signature,
  }
}

export default function UsbCustomerDisplayBridge() {
  const [storeCode, setStoreCode] = useState<string | null>(null)
  const [status, setStatus] = useState<CustomerDisplayStatus>(() => getCustomerDisplayStatus())
  const [config, setConfig] = useState<CustomerDisplayConfig>(() => defaultConfig())
  const [open, setOpen] = useState(false)
  const [syncState, setSyncState] = useState<'idle' | 'ok' | 'error'>('idle')
  const lastSuccessfulSignatureRef = useRef<string | null>(null)
  const lastSuccessfulAmountRef = useRef<string | null>(null)
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollInFlightRef = useRef(false)
  const consecutiveFailureRef = useRef(0)

  useEffect(() => {
    setStoreCode(resolveStoreCode())
    const nextConfig = loadConfig()
    setConfig(nextConfig)
    const unsubscribe = subscribeCustomerDisplayStatus((nextStatus) => {
      setStatus(nextStatus)
      if (nextStatus.status === 'connected') {
        setConfig((current) => {
          const saved = { ...current, enabled: true, portInfo: nextStatus.portInfo ?? current.portInfo }
          saveConfig(saved)
          return saved
        })
      }
    })

    if (nextConfig.enabled) {
      reconnectAuthorizedCustomerDisplay(nextConfig.baudRate).catch((error) => {
        console.warn('[usb-customer-display] silent reconnect failed', error)
      })
    }

    return () => {
      unsubscribe()
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
      disconnectCustomerDisplay().catch((error) => {
        console.warn('[usb-customer-display] unload disconnect failed', error)
      })
    }
  }, [])

  useEffect(() => {
    if (!storeCode || status.status !== 'connected') return
    let aborted = false

    async function poll() {
      if (pollInFlightRef.current) return
      pollInFlightRef.current = true
      try {
        const res = await fetch(`/api/pos/session/current?storeCode=${encodeURIComponent(storeCode!)}`, { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = await res.json() as ApiResp
        if (aborted) return
        consecutiveFailureRef.current = 0
        setSyncState('ok')
        await applySessionToCustomerDisplay(body.session)
      } catch (error) {
        consecutiveFailureRef.current += 1
        if (consecutiveFailureRef.current >= 3) setSyncState('error')
        console.warn('[usb-customer-display] poll failed', error)
      } finally {
        pollInFlightRef.current = false
      }
    }

    poll()
    const timer = setInterval(poll, USB_CUSTOMER_DISPLAY_POLL_MS)
    return () => {
      aborted = true
      clearInterval(timer)
    }
  }, [storeCode, status.status])

  async function applySessionToCustomerDisplay(session: SessionPayload | null) {
    if (!session) {
      await clearOnce()
      return
    }

    if (session.status === 'AWAITING_PAYMENT') {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
      const next = shouldSendCustomerDisplayAmount(
        session,
        lastSuccessfulSignatureRef.current,
        lastSuccessfulAmountRef.current,
      )
      if (!next.shouldSend) return
      const nextStatus = await showCustomerDisplayAmount(next.amount)
      if (nextStatus.status === 'connected') {
        lastSuccessfulSignatureRef.current = next.signature
        lastSuccessfulAmountRef.current = next.amountKey
      }
      return
    }

    if (session.status === 'COMPLETED') {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
      clearTimerRef.current = setTimeout(() => {
        clearOnce().catch((error) => console.warn('[usb-customer-display] delayed clear failed', error))
      }, USB_CUSTOMER_DISPLAY_COMPLETED_LINGER_MS)
      return
    }

    if (session.status === 'CANCELLED' || session.status === 'DRAFT') {
      await clearOnce()
    }
  }

  async function clearOnce() {
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current)
      clearTimerRef.current = null
    }
    const hadDisplay = Boolean(lastSuccessfulSignatureRef.current || lastSuccessfulAmountRef.current)
    if (!hadDisplay) return
    await clearCustomerDisplay()
    lastSuccessfulSignatureRef.current = null
    lastSuccessfulAmountRef.current = null
  }

  async function handleConnect() {
    const nextStatus = await connectCustomerDisplay(config.baudRate)
    if (nextStatus.status === 'connected') {
      const saved = { ...config, enabled: true, portInfo: nextStatus.portInfo }
      setConfig(saved)
      saveConfig(saved)
    }
  }

  async function handleDisconnect() {
    await disconnectCustomerDisplay()
    const saved = { ...config, enabled: false }
    setConfig(saved)
    saveConfig(saved)
  }

  function setBaudRate(baudRate: number) {
    const saved = { ...config, baudRate }
    setConfig(saved)
    saveConfig(saved)
  }

  const label = statusLabel(status.status, syncState)

  return (
    <div style={styles.root}>
      <button type="button" style={styles.fab} onClick={() => setOpen((value) => !value)}>
        客显 {label}
      </button>
      {open ? (
        <div style={styles.panel}>
          <div style={styles.title}>USB 客显</div>
          <div style={styles.row}>
            <span>状态</span>
            <strong>{label}</strong>
          </div>
          {status.message ? <div style={styles.message}>{status.message}</div> : null}
          <div style={styles.row}>
            <span>波特率</span>
            <select
              style={styles.select}
              value={config.baudRate}
              disabled={status.status === 'connected' || status.status === 'connecting'}
              onChange={(event) => setBaudRate(Number(event.target.value))}
            >
              {CUSTOMER_DISPLAY_SUPPORTED_BAUD_RATES.map((rate) => (
                <option key={rate} value={rate}>{rate}</option>
              ))}
            </select>
          </div>
          <div style={styles.buttons}>
            <button
              type="button"
              style={styles.primaryButton}
              disabled={status.status === 'connecting' || status.status === 'disconnecting' || status.status === 'connected'}
              onClick={handleConnect}
            >
              连接设备
            </button>
            <button type="button" style={styles.button} disabled={status.status !== 'connected'} onClick={() => testCustomerDisplay()}>测试显示</button>
            <button type="button" style={styles.button} disabled={status.status !== 'connected'} onClick={() => clearCustomerDisplay()}>清屏</button>
            <button type="button" style={styles.button} disabled={status.status !== 'connected'} onClick={handleDisconnect}>断开</button>
          </div>
          <div style={styles.hint}>
            {storeCode ? `门店 ${storeCode}` : '未识别门店编号'}
            {config.portInfo?.usbVendorId ? ` · USB ${config.portInfo.usbVendorId}:${config.portInfo.usbProductId ?? '-'}` : ''}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function statusLabel(status: CustomerDisplayStatus['status'], syncState: 'idle' | 'ok' | 'error') {
  if (status === 'unsupported') return '浏览器不支持'
  if (status === 'connecting') return '连接中'
  if (status === 'disconnecting') return '断开中'
  if (status === 'connected') return syncState === 'error' ? '数据同步异常' : '已连接'
  if (status === 'error') return '异常'
  return '未连接'
}

const styles: Record<string, CSSProperties> = {
  root: {
    position: 'fixed',
    right: 14,
    bottom: 14,
    zIndex: 80,
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  fab: {
    border: '1px solid rgba(15,23,42,0.12)',
    background: 'var(--blue)',
    color: '#fff',
    borderRadius: 8,
    minHeight: 38,
    padding: '0 12px',
    fontSize: 13,
    fontWeight: 800,
    boxShadow: '0 8px 24px rgba(15,23,42,0.18)',
    cursor: 'pointer',
  },
  panel: {
    position: 'absolute',
    right: 0,
    bottom: 48,
    width: 280,
    padding: 12,
    border: '1px solid rgba(15,23,42,0.12)',
    borderRadius: 8,
    background: 'var(--card)',
    boxShadow: '0 14px 36px rgba(15,23,42,0.18)',
    color: 'var(--text)',
  },
  title: {
    fontSize: 14,
    fontWeight: 900,
    marginBottom: 10,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    fontSize: 13,
    marginBottom: 10,
  },
  message: {
    fontSize: 12,
    color: 'var(--red)',
    marginBottom: 10,
    wordBreak: 'break-word',
  },
  select: {
    border: '1px solid rgba(15,23,42,0.18)',
    borderRadius: 6,
    padding: '6px 8px',
    background: '#fff',
    fontSize: 13,
  },
  buttons: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
  },
  primaryButton: {
    border: 0,
    borderRadius: 7,
    padding: '9px 8px',
    background: 'var(--blue)',
    color: '#fff',
    fontSize: 13,
    fontWeight: 800,
    cursor: 'pointer',
  },
  button: {
    border: '1px solid rgba(15,23,42,0.16)',
    borderRadius: 7,
    padding: '9px 8px',
    background: '#fff',
    color: 'var(--text)',
    fontSize: 13,
    fontWeight: 800,
    cursor: 'pointer',
  },
  hint: {
    marginTop: 10,
    color: 'var(--muted)',
    fontSize: 12,
    lineHeight: 1.4,
    wordBreak: 'break-word',
  },
}
