'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import LangToggleBtn from '@/app/components/LangToggleBtn'
import { useLocale } from '@/app/components/LangProvider'

type Support = {
  phoneDisplay: string | null
  phoneHref: string | null
  telegramUrl: string | null
}

type LandingState = 'LOADING' | 'ACTIVE' | 'INACTIVE' | 'NOT_FOUND'
type SubmitState = 'FORM' | 'CREATED' | 'RESTORED' | 'EXISTING_APPLICATION' | 'ACTIVATED' | 'SHARED_PHONE_REVIEW'

export default function PublicSalesLeadPage() {
  const { t } = useLocale()
  const params = useParams<{ code: string }>()
  const code = typeof params.code === 'string' ? params.code : ''
  const visitRecorded = useRef(false)
  const [landing, setLanding] = useState<LandingState>('LOADING')
  const [submitState, setSubmitState] = useState<SubmitState>('FORM')
  const [support, setSupport] = useState<Support>({ phoneDisplay: null, phoneHref: null, telegramUrl: null })
  const [storeName, setStoreName] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [latitude, setLatitude] = useState<number | null>(null)
  const [longitude, setLongitude] = useState<number | null>(null)
  const [locationMessage, setLocationMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!code || visitRecorded.current) return
    visitRecorded.current = true
    fetch(`/api/public/acquisition-invites/${encodeURIComponent(code)}/landing`, { method: 'POST' })
      .then(async (response) => ({ ok: response.ok, body: await response.json() }))
      .then(({ ok, body }) => {
        if (body.support) setSupport(body.support)
        if (!ok) setLanding('NOT_FOUND')
        else setLanding(body.state === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE')
      })
      .catch(() => setLanding('NOT_FOUND'))
  }, [code])

  function requestLocation() {
    setLocationMessage('')
    if (!navigator.geolocation) {
      setLocationMessage(t('salesLead.locationDenied'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude)
        setLongitude(position.coords.longitude)
        setLocationMessage(t('salesLead.locationReady'))
      },
      () => setLocationMessage(t('salesLead.locationDenied')),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    )
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch('/api/public/sales-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode: code, storeName, ownerName, phone, address, latitude, longitude }),
      })
      const body = await response.json()
      if (body.support) setSupport(body.support)
      if (!response.ok) {
        if (body.error === 'RATE_LIMITED') setError(t('salesLead.rateLimited'))
        else if (body.error === 'INVALID_LOCATION') setError(t('salesLead.invalidLocation'))
        else if (body.error === 'INVITE_INACTIVE') setLanding('INACTIVE')
        else setError(body.error === 'INVALID_INPUT' ? t('salesLead.invalidInput') : t('salesLead.genericError'))
        return
      }
      setSubmitState(body.state as SubmitState)
    } catch {
      setError(t('salesLead.genericError'))
    } finally {
      setSubmitting(false)
    }
  }

  const resultCopy: Record<Exclude<SubmitState, 'FORM'>, [string, string]> = {
    CREATED: [t('salesLead.createdTitle'), t('salesLead.createdBody')],
    RESTORED: [t('salesLead.restoredTitle'), t('salesLead.restoredBody')],
    EXISTING_APPLICATION: [t('salesLead.existingApplicationTitle'), t('salesLead.existingApplicationBody')],
    ACTIVATED: [t('salesLead.activatedTitle'), t('salesLead.activatedBody')],
    SHARED_PHONE_REVIEW: [t('salesLead.sharedPhoneTitle'), t('salesLead.sharedPhoneBody')],
  }

  return (
    <main style={styles.page}>
      <div style={styles.lang}><LangToggleBtn /></div>
      <section style={styles.card}>
        {landing === 'LOADING' && <p style={styles.center}>{t('salesLead.loading')}</p>}
        {landing === 'NOT_FOUND' && <State title={t('salesLead.invalidInvite')} body={t('salesLead.invalidInviteBody')} />}
        {landing === 'INACTIVE' && <State title={t('salesLead.inactiveTitle')} body={t('salesLead.inactiveBody')} />}
        {landing === 'ACTIVE' && submitState === 'FORM' && (
          <>
            <div style={styles.eyebrow}>E-Shop</div>
            <h1 style={styles.title}>{t('salesLead.title')}</h1>
            <p style={styles.subtitle}>{t('salesLead.subtitle')}</p>
            <form onSubmit={submit} style={styles.form}>
              <Field label={t('salesLead.storeName')} value={storeName} onChange={setStoreName} required />
              <Field label={t('salesLead.ownerName')} value={ownerName} onChange={setOwnerName} required />
              <Field label={t('salesLead.phone')} value={phone} onChange={setPhone} inputMode="tel" required />
              <Field label={t('salesLead.address')} value={address} onChange={setAddress} maxLength={500} />
              <button type="button" style={styles.secondaryButton} onClick={requestLocation}>
                {t('salesLead.getLocation')}
              </button>
              <div style={styles.hint}>{locationMessage || t('salesLead.locationOptional')}</div>
              {error && <div style={styles.error}>{error}</div>}
              <button type="submit" style={styles.primaryButton} disabled={submitting}>
                {submitting ? t('salesLead.submitting') : t('salesLead.submit')}
              </button>
              <p style={styles.privacy}>{t('salesLead.privacyHint')}</p>
            </form>
          </>
        )}
        {landing === 'ACTIVE' && submitState !== 'FORM' && (
          <State title={resultCopy[submitState][0]} body={resultCopy[submitState][1]} />
        )}
        {landing !== 'LOADING' && <SupportFooter support={support} />}
      </section>
    </main>
  )
}

function Field(props: {
  label: string
  value: string
  onChange: (value: string) => void
  required?: boolean
  inputMode?: 'tel'
  maxLength?: number
}) {
  return (
    <label style={styles.label}>
      <span>{props.label}{props.required ? ' *' : ''}</span>
      <input
        style={styles.input}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        required={props.required}
        inputMode={props.inputMode}
        maxLength={props.maxLength ?? 120}
      />
    </label>
  )
}

function State({ title, body }: { title: string; body: string }) {
  return <div style={styles.state}><div style={styles.stateIcon}>✓</div><h1 style={styles.title}>{title}</h1><p style={styles.subtitle}>{body}</p></div>
}

function SupportFooter({ support }: { support: Support }) {
  const { t } = useLocale()
  if (!support.phoneHref && !support.telegramUrl) return null
  return (
    <div style={styles.support}>
      <strong>{t('salesLead.supportTitle')}</strong>
      <div style={styles.supportLinks}>
        {support.phoneHref && <a style={styles.linkButton} href={support.phoneHref}>{t('salesLead.callSupport')} {support.phoneDisplay}</a>}
        {support.telegramUrl && <a style={styles.linkButton} href={support.telegramUrl}>{t('salesLead.telegramSupport')}</a>}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: 'linear-gradient(180deg,#edf5ff,#f7f9fc)', padding: '24px 16px 48px', color: '#172033' },
  lang: { maxWidth: 560, margin: '0 auto 12px', display: 'flex', justifyContent: 'flex-end' },
  card: { maxWidth: 560, margin: '0 auto', background: '#fff', borderRadius: 22, padding: '28px 24px', boxShadow: '0 18px 50px rgba(30,64,175,.10)' },
  center: { textAlign: 'center', color: '#64748b' },
  eyebrow: { color: '#2563eb', fontWeight: 800, letterSpacing: 1 },
  title: { fontSize: 28, margin: '8px 0', lineHeight: 1.25 },
  subtitle: { color: '#64748b', lineHeight: 1.6, margin: '0 0 24px' },
  form: { display: 'grid', gap: 15 },
  label: { display: 'grid', gap: 7, fontSize: 14, fontWeight: 700 },
  input: { height: 46, border: '1px solid #dbe3ef', borderRadius: 12, padding: '0 13px', fontSize: 16, color: '#172033', background: '#fff' },
  primaryButton: { minHeight: 48, border: 0, borderRadius: 13, background: '#2563eb', color: '#fff', fontSize: 16, fontWeight: 800, cursor: 'pointer' },
  secondaryButton: { minHeight: 44, border: '1px solid #bfdbfe', borderRadius: 12, background: '#eff6ff', color: '#1d4ed8', fontWeight: 700, cursor: 'pointer' },
  hint: { color: '#64748b', fontSize: 13 },
  error: { background: '#fff1f2', color: '#be123c', padding: 11, borderRadius: 10, fontSize: 14 },
  privacy: { color: '#94a3b8', fontSize: 12, lineHeight: 1.5, margin: 0 },
  state: { textAlign: 'center', padding: '20px 0 12px' },
  stateIcon: { width: 54, height: 54, borderRadius: 27, margin: '0 auto 14px', display: 'grid', placeItems: 'center', background: '#dcfce7', color: '#15803d', fontSize: 28, fontWeight: 900 },
  support: { borderTop: '1px solid #e5e7eb', marginTop: 26, paddingTop: 20, color: '#475569' },
  supportLinks: { display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  linkButton: { textDecoration: 'none', color: '#1d4ed8', background: '#eff6ff', borderRadius: 10, padding: '10px 13px', fontWeight: 700 },
}
