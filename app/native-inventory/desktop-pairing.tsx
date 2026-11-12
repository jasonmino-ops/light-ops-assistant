'use client'

import { type FormEvent, useEffect, useState } from 'react'
import { desktopInventoryHeaders, message, RequestError, setDesktopInventoryClaim, telegramInitData } from './client'

type Pairing = { code: string; claim: string; storeName: string }

async function pair<T>(body: Record<string, string>, headers: HeadersInit): Promise<T> {
  const response = await fetch('/api/native-inventory/desktop-operator', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  const result = await response.json()
  if (!response.ok) throw new RequestError(result.error)
  return result
}

export function DesktopPairing({ authorized }: { authorized: () => void }) {
  const [pending, setPending] = useState<Pairing>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function begin() {
    setBusy(true)
    setPending(undefined)
    setError('')
    try {
      setPending(await pair<Pairing>({ action: 'begin' }, desktopInventoryHeaders()))
    } catch (err) { setError(message(err)) }
    finally { setBusy(false) }
  }

  useEffect(() => {
    if (!pending) return
    let cancelled = false
    let timer: number
    async function poll() {
      try {
        const result = await pair<{ state: 'APPROVED' | 'PENDING' }>(
          { action: 'status' }, { ...desktopInventoryHeaders(), 'x-inventory-operator': pending!.claim },
        )
        if (cancelled) return
        if (result.state === 'APPROVED') {
          setDesktopInventoryClaim(pending!.claim)
          authorized()
        } else timer = window.setTimeout(poll, 1500)
      } catch (err) {
        if (cancelled) return
        if (err instanceof RequestError) {
          setPending(undefined)
          setError(message(err))
        } else timer = window.setTimeout(poll, 2500)
      }
    }
    timer = window.setTimeout(poll, 1200)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [authorized, pending])

  return <section className="page">
    <h1>验证桌面操作员</h1>
    <p>请在手机 Telegram 的进销存页面打开「配对桌面」，输入本机显示的配对码。</p>
    {pending && <p>{pending.storeName} · <strong aria-label="配对码">{pending.code.match(/.{4}/g)?.join('-')}</strong> · 五分钟内有效</p>}
    {error && <p role="alert">{error}</p>}
    <button className="btn primary" type="button" onClick={begin} disabled={busy}>{pending ? '重新生成配对码' : '生成配对码'}</button>
  </section>
}

export function ApproveDesktopPairing() {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [state, setState] = useState<'READY' | 'WORKING' | 'APPROVED'>('READY')

  async function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setState('WORKING')
    try {
      const proof = telegramInitData()
      if (!proof) throw new RequestError('PERSON_PROOF_REQUIRED')
      await pair({ action: 'approve', code }, { 'x-telegram-init-data': proof })
      setState('APPROVED')
    } catch (err) {
      setError(message(err))
      setState('READY')
    }
  }

  return <div className="native-inventory"><section className="page">
    <h1>配对桌面</h1>
    <p>请核对实体桌面上的配对码，只授权自己正在操作的设备。</p>
    {state === 'APPROVED' ? <p role="status">桌面已授权，可以返回电脑操作。</p> : <form onSubmit={approve}>
      <label className="field">配对码<input className="inp" autoComplete="off" maxLength={19} value={code} onChange={(event) => setCode(event.target.value)} required /></label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" className="btn primary" disabled={state === 'WORKING'}>授权当前桌面</button>
    </form>}
  </section></div>
}
