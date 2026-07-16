'use client'

import { useEffect, useState, type CSSProperties } from 'react'

type DisplayMode = 'single' | 'dual'

type DesktopDisplayState = {
  configuredMode: DisplayMode
  effectiveMode: DisplayMode
  displayCount: number
  primaryDisplayId: number | null
  employeeDisplayId: number | null
  customerDisplayId: number | null
  customerVisible: boolean
  canSwap: boolean
  degraded: boolean
  reason: string
}

type DesktopDisplayResult = {
  ok: boolean
  state: DesktopDisplayState
  errorCode?: string
}

type DesktopDisplayApi = {
  getState: () => Promise<DesktopDisplayResult>
  setMode: (mode: DisplayMode) => Promise<DesktopDisplayResult>
  swap: () => Promise<DesktopDisplayResult>
}

declare global {
  interface Window {
    eshopDesktopDisplay?: DesktopDisplayApi
  }
}

export default function DesktopDisplayControls() {
  const [state, setState] = useState<DesktopDisplayState | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    let mounted = true
    async function load() {
      if (typeof window === 'undefined' || !window.eshopDesktopDisplay) return
      setAvailable(true)
      const result = await window.eshopDesktopDisplay?.getState().catch(() => null)
      if (!mounted || !result?.state) return
      setState(result.state)
    }
    void load()
    const timer = window.setInterval(() => { void load() }, 3000)
    return () => {
      mounted = false
      window.clearInterval(timer)
    }
  }, [])

  if (!available || !state) return null

  async function run(action: () => Promise<DesktopDisplayResult>, success: string) {
    if (busy) return
    setBusy(true)
    setMessage('')
    try {
      const result = await action()
      setState(result.state)
      setMessage(result.ok ? success : messageForError(result.errorCode))
    } catch {
      setMessage('屏幕操作失败')
    } finally {
      setBusy(false)
    }
  }

  const isDual = state.configuredMode === 'dual'
  const canSwap = state.canSwap && !busy

  return (
    <section style={s.panel} aria-label="Desktop display controls">
      <div style={s.header}>
        <span style={s.title}>双屏</span>
        <span style={state.effectiveMode === 'dual' ? s.ok : s.warn}>
          {state.effectiveMode === 'dual' ? '运行中' : '单屏'}
        </span>
      </div>
      <div style={s.row}>
        <button
          type="button"
          style={isDual ? s.button : s.buttonPrimary}
          disabled={busy || !isDual}
          onClick={() => run(() => window.eshopDesktopDisplay!.setMode('single'), '已切换单屏')}
        >
          单屏
        </button>
        <button
          type="button"
          style={isDual ? s.buttonPrimary : s.button}
          disabled={busy || isDual}
          onClick={() => run(() => window.eshopDesktopDisplay!.setMode('dual'), '已切换双屏')}
        >
          双屏
        </button>
        <button
          type="button"
          style={canSwap ? s.buttonPrimary : s.buttonDisabled}
          disabled={!canSwap}
          onClick={() => run(() => window.eshopDesktopDisplay!.swap(), '已交换')}
        >
          交换
        </button>
      </div>
      <div style={s.meta}>
        {state.displayCount} 屏 · 员工 {state.employeeDisplayId ?? '-'} · 顾客 {state.customerDisplayId ?? '-'}
      </div>
      {message && <div style={s.message}>{message}</div>}
    </section>
  )
}

function messageForError(code?: string) {
  if (code === 'SWAP_UNAVAILABLE') return '当前不可交换'
  if (code === 'INVALID_DISPLAY_MODE') return '显示模式无效'
  if (code === 'UNAUTHORIZED') return '无权限'
  return '屏幕操作失败'
}

const s: Record<string, CSSProperties> = {
  panel: {
    position: 'fixed',
    right: 16,
    bottom: 16,
    zIndex: 80,
    width: 260,
    padding: 10,
    border: '1px solid rgba(148, 163, 184, 0.35)',
    background: 'rgba(15, 17, 21, 0.92)',
    color: '#f8fafc',
    boxShadow: '0 10px 24px rgba(0,0,0,0.22)',
    fontSize: 12,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontWeight: 700,
  },
  ok: {
    color: '#86efac',
  },
  warn: {
    color: '#fde68a',
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: 6,
  },
  button: {
    height: 32,
    border: '1px solid rgba(148, 163, 184, 0.5)',
    background: '#1f2937',
    color: '#f8fafc',
    cursor: 'pointer',
  },
  buttonPrimary: {
    height: 32,
    border: '1px solid rgba(59, 130, 246, 0.8)',
    background: 'var(--blue)',
    color: '#fff',
    cursor: 'pointer',
  },
  buttonDisabled: {
    height: 32,
    border: '1px solid rgba(148, 163, 184, 0.25)',
    background: '#334155',
    color: '#94a3b8',
    cursor: 'not-allowed',
  },
  meta: {
    marginTop: 8,
    color: '#cbd5e1',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  message: {
    marginTop: 6,
    color: '#bfdbfe',
  },
}
