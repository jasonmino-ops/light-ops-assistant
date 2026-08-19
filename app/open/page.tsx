'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import LangToggleBtn from '@/app/components/LangToggleBtn'
import { useLocale } from '@/app/components/LangProvider'
import {
  getOpenApplicationTokenFromStartParam,
  resolveTelegramStartParam,
} from '@/lib/telegram-start-param'

type Support = { phoneDisplay: string | null; phoneHref: string | null; telegramUrl: string | null }
type Profile = {
  storeName: string
  ownerName: string
  phone: string
  address: string | null
  latitude: number | null
  longitude: number | null
}
type OpenState = 'loading' | 'claim' | 'form' | 'submitting' | 'success' | 'error' | 'no_tg' | 'already_bound' | 'blocked'

function OpenFlow() {
  const { t } = useLocale()
  const searchParams = useSearchParams()
  const [state, setState] = useState<OpenState>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [initData, setInitData] = useState('')
  const [applicationToken, setApplicationToken] = useState('')
  const [claimPhone, setClaimPhone] = useState('')
  const [storeName, setStoreName] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [latitude, setLatitude] = useState<number | null>(null)
  const [longitude, setLongitude] = useState<number | null>(null)
  const [locationMessage, setLocationMessage] = useState('')
  const [support, setSupport] = useState<Support>({ phoneDisplay: null, phoneHref: null, telegramUrl: null })
  const [applicationNo, setApplicationNo] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('/api/open').then((response) => response.json()).then((body) => {
      if (!cancelled && body.support) setSupport(body.support)
    }).catch(() => {})

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tg = (window as any).Telegram?.WebApp
    const nextInitData: string = tg?.initData ?? ''
    if (!nextInitData) {
      setState('no_tg')
      return () => { cancelled = true }
    }
    tg.expand?.()
    const start = resolveTelegramStartParam({
      initDataUnsafeStartParam: tg?.initDataUnsafe?.start_param,
      initData: nextInitData,
      search: window.location.search,
      hash: window.location.hash,
    })
    const token = searchParams.get('applicationToken') || getOpenApplicationTokenFromStartParam(start?.value)
    setInitData(nextInitData)
    setApplicationToken(token)

    fetch('/api/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'STATUS', initData: nextInitData }),
    }).then(async (response) => ({ response, body: await response.json() })).then(({ response, body }) => {
      if (cancelled) return
      if (body.support) setSupport(body.support)
      if (!response.ok) {
        setErrorMsg(t('open.genericError'))
        setState('error')
        return
      }
      if (body.state === 'PENDING') {
        setApplicationNo(body.applicationNo ?? '')
        setState('success')
      } else if (body.state === 'ALREADY_BOUND') {
        setState('already_bound')
      } else if (body.state === 'BLOCKED') {
        setState('blocked')
      } else if (body.state === 'CLAIMED') {
        fillProfile(body.profile)
        setState('form')
      } else if (token) {
        setState('claim')
      } else {
        setOwnerName(body.ownerName ?? '')
        setState('form')
      }
    }).catch(() => {
      if (!cancelled) {
        setErrorMsg(t('open.genericError'))
        setState('error')
      }
    })
    return () => { cancelled = true }
  }, [searchParams, t])

  function fillProfile(profile: Profile) {
    setStoreName(profile.storeName)
    setOwnerName(profile.ownerName)
    setPhone(profile.phone)
    setAddress(profile.address ?? '')
    setLatitude(profile.latitude)
    setLongitude(profile.longitude)
  }

  async function claim() {
    if (!claimPhone.trim() || !applicationToken) return
    setState('submitting')
    try {
      const response = await fetch('/api/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'CLAIM', initData, applicationToken, phone: claimPhone }),
      })
      const body = await response.json()
      if (body.support) setSupport(body.support)
      if (response.ok && body.state === 'CLAIMED') {
        fillProfile(body.profile)
        setState('form')
      } else if (body.state === 'ALREADY_BOUND') {
        setState('already_bound')
      } else {
        setErrorMsg(body.state === 'RATE_LIMITED' ? t('open.rateLimited') : t('open.claimFailed'))
        setState('error')
      }
    } catch {
      setErrorMsg(t('open.genericError'))
      setState('error')
    }
  }

  function requestLocation() {
    setLocationMessage('')
    if (!navigator.geolocation) {
      setLocationMessage(t('open.locationDenied'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude)
        setLongitude(position.coords.longitude)
        setLocationMessage(t('open.locationReady'))
      },
      () => setLocationMessage(t('open.locationDenied')),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    )
  }

  async function apply() {
    if (!storeName.trim() || !ownerName.trim() || !phone.trim()) return
    setState('submitting')
    try {
      const response = await fetch('/api/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'APPLY', initData, storeName, ownerName, phone, address, latitude, longitude,
        }),
      })
      const body = await response.json()
      if (body.support) setSupport(body.support)
      if (body.state === 'PENDING') {
        setApplicationNo(body.applicationNo ?? '')
        setState('success')
      } else if (body.state === 'ALREADY_BOUND') {
        setState('already_bound')
      } else if (body.state === 'BLOCKED') {
        setState('blocked')
      } else {
        setErrorMsg(body.state === 'RATE_LIMITED' ? t('open.rateLimited') : t('open.invalidInput'))
        setState('error')
      }
    } catch {
      setErrorMsg(t('open.genericError'))
      setState('error')
    }
  }

  const retry = () => setState(applicationToken && !phone ? 'claim' : 'form')

  return (
    <div style={card}>
      <div style={langRow}><LangToggleBtn /></div>
      {state === 'loading' && <p style={msgStyle}>{t('common.loading')}</p>}

      {state === 'claim' && (
        <>
          <div style={shopIcon}>🔐</div>
          <h1 style={titleStyle}>{t('open.claimTitle')}</h1>
          <p style={hintStyle}>{t('open.claimHint')}</p>
          <Field label={t('open.fieldPhone')} value={claimPhone} onChange={setClaimPhone} inputMode="tel" />
          <button style={submitBtn} onClick={() => void claim()} disabled={!claimPhone.trim()}>{t('open.claimSubmit')}</button>
        </>
      )}

      {(state === 'form' || state === 'submitting') && (
        <>
          <div style={shopIcon}>🏪</div>
          <h1 style={titleStyle}>{t('open.title')}</h1>
          <Field label={t('open.fieldStoreName')} value={storeName} onChange={setStoreName} />
          <Field label={t('open.fieldOwnerName')} value={ownerName} onChange={setOwnerName} />
          <Field label={t('open.fieldPhone')} value={phone} onChange={setPhone} inputMode="tel" />
          <Field label={t('open.fieldAddress')} value={address} onChange={setAddress} maxLength={500} />
          <button style={secondaryBtn} onClick={requestLocation}>{t('open.getLocation')}</button>
          <p style={hintStyle}>{locationMessage || t('open.locationOptional')}</p>
          <button
            style={{ ...submitBtn, opacity: storeName.trim() && ownerName.trim() && phone.trim() ? 1 : 0.5 }}
            onClick={() => void apply()}
            disabled={state === 'submitting' || !storeName.trim() || !ownerName.trim() || !phone.trim()}
          >
            {state === 'submitting' ? t('open.submitting') : t('open.submit')}
          </button>
        </>
      )}

      {state === 'submitting' && !storeName && <p style={msgStyle}>{t('open.submitting')}</p>}
      {state === 'success' && <Message icon="⏳" title={t('open.success')} body={`${t('open.successDesc')}${applicationNo ? ` · ${applicationNo}` : ''}`} />}
      {state === 'already_bound' && <Message icon="✓" title={t('open.alreadyBound')} body={t('open.alreadyBoundHint')} action={<button style={secondaryBtn} onClick={() => window.location.replace('/home')}>{t('open.enterAccount')}</button>} />}
      {state === 'blocked' && <Message icon="⚠" title={t('open.blocked')} body={t('open.blockedHint')} />}
      {state === 'error' && <Message icon="✕" title={errorMsg} body={t('open.errorNeutral')} action={<button style={secondaryBtn} onClick={retry}>{t('open.retry')}</button>} />}
      {state === 'no_tg' && <Message icon="⚠" title={t('open.noTg')} body={t('open.noTgHint')} />}

      <SupportFooter support={support} />
    </div>
  )
}

function Field(props: { label: string; value: string; onChange: (value: string) => void; inputMode?: 'tel'; maxLength?: number }) {
  return <label style={fieldGroup}><span style={fieldLabel}>{props.label}</span><input style={inputStyle} value={props.value} onChange={(event) => props.onChange(event.target.value)} inputMode={props.inputMode} maxLength={props.maxLength ?? 120} /></label>
}

function Message(props: { icon: string; title: string; body: string; action?: React.ReactNode }) {
  return <><div style={messageIcon}>{props.icon}</div><p style={titleStyle}>{props.title}</p><p style={hintStyle}>{props.body}</p>{props.action}</>
}

function SupportFooter({ support }: { support: Support }) {
  const { t } = useLocale()
  if (!support.phoneHref && !support.telegramUrl) return null
  return <div style={supportBox}><strong>{t('salesLead.supportTitle')}</strong><div style={supportLinks}>{support.phoneHref && <a href={support.phoneHref}>{t('salesLead.callSupport')} {support.phoneDisplay}</a>}{support.telegramUrl && <a href={support.telegramUrl}>{t('salesLead.telegramSupport')}</a>}</div></div>
}

export default function OpenPage() {
  return <main style={pg}><Suspense fallback={<div style={card}>Loading…</div>}><OpenFlow /></Suspense></main>
}

const pg: React.CSSProperties = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f7fa', padding: '20px 0' }
const card: React.CSSProperties = { background: '#fff', borderRadius: 16, padding: '24px', width: 'min(360px,92vw)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, boxShadow: '0 4px 24px rgba(0,0,0,.08)' }
const langRow: React.CSSProperties = { width: '100%', display: 'flex', justifyContent: 'flex-end' }
const shopIcon: React.CSSProperties = { width: 56, height: 56, borderRadius: '50%', background: '#fff7e6', border: '2px solid #ffd591', display: 'grid', placeItems: 'center', fontSize: 26 }
const messageIcon: React.CSSProperties = { ...shopIcon, background: '#eff6ff', borderColor: '#bfdbfe' }
const titleStyle: React.CSSProperties = { margin: 0, fontSize: 18, fontWeight: 700, color: '#1a1a1a', textAlign: 'center' }
const msgStyle: React.CSSProperties = { margin: 0, fontSize: 15, color: '#1a1a1a', textAlign: 'center' }
const hintStyle: React.CSSProperties = { margin: 0, fontSize: 13, color: '#777', textAlign: 'center', lineHeight: 1.5 }
const fieldGroup: React.CSSProperties = { width: '100%', display: 'flex', flexDirection: 'column', gap: 6 }
const fieldLabel: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#666' }
const inputStyle: React.CSSProperties = { width: '100%', height: 44, border: '1.5px solid #d9d9d9', borderRadius: 8, padding: '0 12px', fontSize: 15, outline: 'none', boxSizing: 'border-box' }
const submitBtn: React.CSSProperties = { width: '100%', height: 50, background: '#1677ff', color: '#fff', border: 0, borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer' }
const secondaryBtn: React.CSSProperties = { width: '100%', minHeight: 44, background: '#fff', color: '#2563eb', border: '1.5px solid #bfdbfe', borderRadius: 10, fontSize: 14, cursor: 'pointer' }
const supportBox: React.CSSProperties = { width: '100%', borderTop: '1px solid #eee', paddingTop: 14, marginTop: 6, color: '#475569', fontSize: 13 }
const supportLinks: React.CSSProperties = { display: 'grid', gap: 8, marginTop: 8 }
