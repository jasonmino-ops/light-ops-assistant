'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { apiFetch, OWNER_CTX } from '@/lib/api'
import { useLocale, type Lang } from '@/app/components/LangProvider'
import { useWorkMode } from '@/app/components/WorkModeProvider'

type StoreSettings = {
  storeId: string
  storeCode: string
  storeName: string
  businessType: string
  checkoutMode: 'DIRECT_PAYMENT' | 'DEFERRED_PAYMENT'
  currencyCode: string
  printKitchenTicket: boolean
  contactPhone: string | null
  contactTelegram: string | null
  contactWhatsApp: string | null
  storeAddress: string | null
  storeLat: number | null
  storeLng: number | null
}

type StoreSettingsDraft = Omit<StoreSettings, 'storeId'>

type StoreListEntry = {
  id: string
  code: string
  name: string
  checkoutMode?: StoreSettings['checkoutMode']
  currencyCode?: string
  contactPhone?: string | null
  contactTelegram?: string | null
  contactWhatsApp?: string | null
  storeAddress?: string | null
  storeLat?: number | null
  storeLng?: number | null
}

const BUSINESS_TYPES = ['FOOD', 'RETAIL', 'SERVICE', 'GENERAL'] as const
const CURRENCIES = ['USD', 'XAF'] as const

function readDesktopRuntime() {
  return typeof window !== 'undefined' && window.eshopDesktopRuntime?.isDesktop === true
}

export default function SettingsPage() {
  const router = useRouter()
  const { lang, setLang, t } = useLocale()
  const { effectiveRole } = useWorkMode()
  const [isDesktop, setIsDesktop] = useState(false)
  const [desktopVersion, setDesktopVersion] = useState('')
  const [settings, setSettings] = useState<StoreSettings | null>(null)
  const [draft, setDraft] = useState<StoreSettingsDraft | null>(null)
  const [autoPrint, setAutoPrint] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [navigationContext, setNavigationContext] = useState({ fromDesktop: false, storeCode: '' })

  const managementHref = useMemo(() => {
    if (!navigationContext.fromDesktop) return '/management'
    const query = navigationContext.storeCode
      ? `?from=desktop&storeCode=${encodeURIComponent(navigationContext.storeCode)}`
      : '?from=desktop'
    return `/management${query}`
  }, [navigationContext])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const desktop = readDesktopRuntime()
    setIsDesktop(desktop)
    setDesktopVersion(window.eshopDesktopRuntime?.version ?? '')
    setNavigationContext({
      fromDesktop: params.get('from') === 'desktop',
      storeCode: params.get('storeCode')?.trim() ?? '',
    })
    if (desktop) setAutoPrint(localStorage.getItem('cashier:autoPrint') === '1')
  }, [])

  useEffect(() => {
    if (effectiveRole !== 'OWNER') {
      router.replace('/home')
      return
    }

    let active = true
    setLoading(true)
    Promise.all([
      apiFetch('/api/store/settings', { cache: 'no-store' }, OWNER_CTX),
      apiFetch('/api/stores', { cache: 'no-store' }, OWNER_CTX),
    ])
      .then(async ([settingsResponse, storesResponse]) => {
        if (!settingsResponse.ok || !storesResponse.ok) throw new Error('LOAD_FAILED')
        const current = await settingsResponse.json() as Partial<StoreSettings>
        const stores = await storesResponse.json() as StoreListEntry[]
        const listed = stores.find((store) => store.id === current.storeId)
        const next: StoreSettings = {
          storeId: String(current.storeId ?? listed?.id ?? ''),
          storeCode: String(current.storeCode ?? listed?.code ?? ''),
          storeName: String(current.storeName ?? listed?.name ?? ''),
          businessType: String(current.businessType ?? 'GENERAL'),
          checkoutMode: current.checkoutMode === 'DEFERRED_PAYMENT' ? 'DEFERRED_PAYMENT' : 'DIRECT_PAYMENT',
          currencyCode: String(current.currencyCode ?? 'USD'),
          printKitchenTicket: current.printKitchenTicket === true,
          contactPhone: current.contactPhone ?? listed?.contactPhone ?? null,
          contactTelegram: current.contactTelegram ?? listed?.contactTelegram ?? null,
          contactWhatsApp: current.contactWhatsApp ?? listed?.contactWhatsApp ?? null,
          storeAddress: current.storeAddress ?? listed?.storeAddress ?? null,
          storeLat: current.storeLat ?? listed?.storeLat ?? null,
          storeLng: current.storeLng ?? listed?.storeLng ?? null,
        }
        if (!active) return
        setSettings(next)
        setDraft({ ...next })
      })
      .catch(() => {
        if (active) setNotice({ ok: false, text: t('settings.loadFailed') })
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => { active = false }
  }, [effectiveRole, router, t])

  function updateDraft<K extends keyof StoreSettingsDraft>(key: K, value: StoreSettingsDraft[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current)
  }

  async function saveSettings() {
    if (!draft || !settings || saving) return
    setSaving(true)
    setNotice(null)
    try {
      const [storeResponse, checkoutResponse, menuResponse] = await Promise.all([
        apiFetch('/api/store/settings', {
          method: 'PATCH',
          body: JSON.stringify({
            businessType: draft.businessType,
            currencyCode: draft.currencyCode,
            printKitchenTicket: draft.printKitchenTicket,
            contactPhone: draft.contactPhone ?? '',
            contactTelegram: draft.contactTelegram ?? '',
            contactWhatsApp: draft.contactWhatsApp ?? '',
          }),
        }, OWNER_CTX),
        apiFetch(`/api/stores/${encodeURIComponent(settings.storeId)}/checkout-mode`, {
          method: 'PATCH',
          body: JSON.stringify({ checkoutMode: draft.checkoutMode }),
        }, OWNER_CTX),
        apiFetch(`/api/stores/${encodeURIComponent(settings.storeId)}/menu-config`, {
          method: 'PATCH',
          body: JSON.stringify({
            storeAddress: draft.storeAddress ?? '',
            storeLat: draft.storeLat,
            storeLng: draft.storeLng,
          }),
        }, OWNER_CTX),
      ])

      if (!storeResponse.ok || !checkoutResponse.ok || !menuResponse.ok) {
        throw new Error('SAVE_FAILED')
      }
      const next = { ...settings, ...draft }
      setSettings(next)
      setDraft({ ...next })
      setNotice({ ok: true, text: t('settings.saved') })
    } catch {
      setNotice({ ok: false, text: t('settings.saveFailed') })
    } finally {
      setSaving(false)
    }
  }

  function handleLanguageChange(next: Lang) {
    setLang(next)
    setNotice({ ok: true, text: t('settings.languageSaved') })
  }

  function handleAutoPrintChange(next: boolean) {
    setAutoPrint(next)
    localStorage.setItem('cashier:autoPrint', next ? '1' : '0')
    setNotice({ ok: true, text: t('settings.autoPrintSaved') })
  }

  if (effectiveRole !== 'OWNER') return null

  return (
    <main style={styles.page} data-settings-page="owner">
      <style>{responsiveStyles}</style>
      <div style={styles.shell}>
        <header style={styles.header}>
          <div>
            <Link href={managementHref} style={styles.backLink}>← {t('settings.backToManagement')}</Link>
            <div style={styles.eyebrow}>{t('settings.eyebrow')}</div>
            <h1 style={styles.title}>{t('settings.title')}</h1>
            <p style={styles.subtitle}>{t('settings.subtitle')}</p>
          </div>
          <div style={styles.headerActions}>
            <span style={styles.ownerBadge}>{t('settings.ownerOnly')}</span>
            <button type="button" style={styles.saveButton} disabled={!draft || loading || saving} onClick={saveSettings}>
              {saving ? t('settings.saving') : t('settings.save')}
            </button>
          </div>
        </header>

        {notice && <div role="status" style={{ ...styles.notice, ...(notice.ok ? styles.noticeOk : styles.noticeError) }}>{notice.text}</div>}
        {loading && <div style={styles.loading}>{t('settings.loading')}</div>}
        {!loading && !settings && <div style={styles.error}>{t('settings.loadFailed')}</div>}

        {draft && settings && (
          <div style={styles.layout}>
            <section style={styles.group} aria-labelledby="settings-store-heading">
              <div style={styles.groupHeader}>
                <div><div style={styles.groupKicker}>{t('settings.storeKicker')}</div><h2 id="settings-store-heading" style={styles.groupTitle}>{t('settings.storeGroup')}</h2></div>
                <span style={styles.groupHint}>{settings.storeCode || '—'}</span>
              </div>

              <div style={styles.cards}>
                <article style={styles.card}>
                  <h3 style={styles.cardTitle}>{t('settings.storeInfo')}</h3>
                  <p style={styles.cardDescription}>{t('settings.storeInfoDesc')}</p>
                  <div className="settings-fields" style={styles.fields}>
                    <ReadOnlyField label={t('settings.storeName')} value={settings.storeName || '—'} />
                    <ReadOnlyField label={t('settings.storeCode')} value={settings.storeCode || '—'} />
                    <label style={styles.field}><span style={styles.label}>{t('settings.businessType')}</span><select value={draft.businessType} onChange={(event) => updateDraft('businessType', event.target.value)} style={styles.input}>{BUSINESS_TYPES.map((type) => <option key={type} value={type}>{t(`settings.businessTypes.${type}`)}</option>)}</select></label>
                    <label style={styles.field}><span style={styles.label}>{t('settings.address')}</span><input value={draft.storeAddress ?? ''} onChange={(event) => updateDraft('storeAddress', event.target.value)} style={styles.input} placeholder={t('settings.addressPlaceholder')} /></label>
                    <label style={styles.field}><span style={styles.label}>{t('settings.phone')}</span><input value={draft.contactPhone ?? ''} onChange={(event) => updateDraft('contactPhone', event.target.value)} style={styles.input} placeholder={t('settings.phonePlaceholder')} /></label>
                    <label style={styles.field}><span style={styles.label}>{t('settings.telegram')}</span><input value={draft.contactTelegram ?? ''} onChange={(event) => updateDraft('contactTelegram', event.target.value)} style={styles.input} placeholder={t('settings.telegramPlaceholder')} /></label>
                    <label style={styles.field}><span style={styles.label}>{t('settings.whatsapp')}</span><input value={draft.contactWhatsApp ?? ''} onChange={(event) => updateDraft('contactWhatsApp', event.target.value)} style={styles.input} placeholder={t('settings.whatsappPlaceholder')} /></label>
                  </div>
                </article>

                <article style={styles.card}>
                  <h3 style={styles.cardTitle}>{t('settings.payment')}</h3>
                  <p style={styles.cardDescription}>{t('settings.paymentDesc')}</p>
                  <div style={styles.fields}>
                    <label style={styles.field}><span style={styles.label}>{t('settings.checkoutMode')}</span><select value={draft.checkoutMode} onChange={(event) => updateDraft('checkoutMode', event.target.value as StoreSettingsDraft['checkoutMode'])} style={styles.input}><option value="DIRECT_PAYMENT">{t('settings.directPayment')}</option><option value="DEFERRED_PAYMENT">{t('settings.deferredPayment')}</option></select></label>
                    <label style={styles.field}><span style={styles.label}>{t('settings.currency')}</span><select value={draft.currencyCode} onChange={(event) => updateDraft('currencyCode', event.target.value) } style={styles.input}>{CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label>
                  </div>
                  <p style={styles.note}>{t('settings.khqrNote')}</p>
                </article>

                <article style={styles.card}>
                  <h3 style={styles.cardTitle}>{t('settings.language')}</h3>
                  <p style={styles.cardDescription}>{t('settings.languageDesc')}</p>
                  <select aria-label={t('settings.language')} value={lang} onChange={(event) => handleLanguageChange(event.target.value as Lang)} style={styles.input}>
                    <option value="zh">中文</option><option value="en">English</option><option value="km">ខ្មែរ</option>
                  </select>
                  <p style={styles.note}>{t('settings.languageBoundary')}</p>
                </article>

                <article style={styles.card}>
                  <h3 style={styles.cardTitle}>{t('settings.tableQr')}</h3>
                  <p style={styles.cardDescription}>{t('settings.tableQrDesc')}</p>
                  <Link href="/table-qrcodes" style={styles.secondaryButton}>{t('settings.openTableQr')}</Link>
                </article>
              </div>
            </section>

            <section style={styles.group} aria-labelledby="settings-device-heading">
              <div style={styles.groupHeader}><div><div style={styles.groupKicker}>{t('settings.deviceKicker')}</div><h2 id="settings-device-heading" style={styles.groupTitle}>{t('settings.deviceGroup')}</h2></div></div>
              <div style={styles.cards}>
                <article id="printing" style={styles.card} data-settings-printing="canonical">
                  <h3 style={styles.cardTitle}>{t('settings.printing')}</h3>
                  <p style={styles.cardDescription}>{t('settings.printingDesc')}</p>
                  <div style={styles.noteBox}>{t('settings.printingBoundary')}</div>
                  {isDesktop && (
                    <label style={styles.preferenceRow} data-settings-auto-print="desktop-only">
                      <span><strong>{t('settings.autoPrint')}</strong><small>{t('settings.autoPrintDesc')}</small></span>
                      <input type="checkbox" checked={autoPrint} onChange={(event) => handleAutoPrintChange(event.target.checked)} />
                    </label>
                  )}
                  {!isDesktop && <p style={styles.note}>{t('settings.browserPrintNote')}</p>}
                </article>

                {isDesktop && (
                  <article style={styles.card} data-settings-display="desktop-only">
                    <h3 style={styles.cardTitle}>{t('settings.display')}</h3>
                    <p style={styles.cardDescription}>{t('settings.displayDesc')}</p>
                    <div style={styles.noteBox}>{t('settings.displayBoundary')}</div>
                  </article>
                )}

                {isDesktop && (
                  <article style={styles.card} data-settings-desktop-preferences="desktop-only">
                    <h3 style={styles.cardTitle}>{t('settings.desktopPreferences')}</h3>
                    <p style={styles.cardDescription}>{t('settings.desktopPreferencesDesc')}</p>
                    <div style={styles.readOnlyValue}>{desktopVersion ? `${t('settings.desktopRuntime')} ${desktopVersion}` : t('settings.desktopRuntimeUnknown')}</div>
                  </article>
                )}
              </div>
            </section>

            <section style={styles.group} aria-labelledby="settings-system-heading">
              <div style={styles.groupHeader}><div><div style={styles.groupKicker}>{t('settings.systemKicker')}</div><h2 id="settings-system-heading" style={styles.groupTitle}>{t('settings.systemGroup')}</h2></div></div>
              <div style={styles.cards}>
                <article style={styles.card}>
                  <h3 style={styles.cardTitle}>{t('settings.about')}</h3>
                  <p style={styles.cardDescription}>{t('settings.aboutDesc')}</p>
                  <div style={styles.readOnlyValue}>{t('settings.productName')}</div>
                </article>
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  )
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return <div style={styles.field}><span style={styles.label}>{label}</span><div style={styles.readOnlyValue}>{value}</div></div>
}

const responsiveStyles = `
  .settings-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  @media (max-width: 760px) {
    .settings-fields { grid-template-columns: 1fr; }
  }
`

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: 'calc(100dvh - 76px)', background: '#f7f9fc', color: '#182234', padding: '28px 24px 52px' },
  shell: { width: 'min(1120px, 100%)', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', gap: 24, alignItems: 'flex-start', marginBottom: 22 },
  backLink: { display: 'inline-flex', color: '#52627a', textDecoration: 'none', fontSize: 13, fontWeight: 700, marginBottom: 16 },
  eyebrow: { color: '#3b82f6', fontSize: 12, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase' },
  title: { margin: '6px 0 0', fontSize: 'clamp(28px, 4vw, 42px)', letterSpacing: '-.04em' },
  subtitle: { margin: '8px 0 0', color: '#65748b', fontSize: 14, lineHeight: 1.6, maxWidth: 620 },
  headerActions: { display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, paddingTop: 24 },
  ownerBadge: { borderRadius: 999, padding: '7px 12px', background: '#eef5ff', color: '#2563eb', fontSize: 12, fontWeight: 800 },
  saveButton: { border: 0, borderRadius: 10, padding: '10px 16px', background: '#2563eb', color: '#fff', fontWeight: 800, cursor: 'pointer' },
  notice: { borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13, fontWeight: 700 },
  noticeOk: { color: '#166534', background: '#ecfdf3' },
  noticeError: { color: '#b42318', background: '#fff1f0' },
  loading: { padding: 32, background: '#fff', borderRadius: 16, color: '#65748b' },
  error: { padding: 20, background: '#fff1f0', borderRadius: 16, color: '#b42318', fontWeight: 700 },
  layout: { display: 'grid', gap: 18 },
  group: { background: 'rgba(255,255,255,.7)', border: '1px solid #e6ebf2', borderRadius: 20, padding: 20, boxShadow: '0 8px 24px rgba(24,34,52,.04)' },
  groupHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 16 },
  groupKicker: { color: '#8190a5', fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase' },
  groupTitle: { margin: '4px 0 0', fontSize: 22, letterSpacing: '-.025em' },
  groupHint: { color: '#8190a5', fontSize: 12, fontWeight: 800 },
  cards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 },
  card: { background: '#fff', border: '1px solid #e8edf4', borderRadius: 16, padding: 18, minWidth: 0 },
  cardTitle: { margin: 0, fontSize: 16, letterSpacing: '-.01em' },
  cardDescription: { margin: '7px 0 16px', color: '#69788e', fontSize: 13, lineHeight: 1.55 },
  fields: { display: 'grid', gap: 12 },
  field: { display: 'grid', gap: 6, minWidth: 0 },
  label: { color: '#52627a', fontSize: 12, fontWeight: 800 },
  input: { width: '100%', boxSizing: 'border-box', border: '1px solid #d7dfeb', borderRadius: 9, padding: '10px 11px', background: '#fff', color: '#182234', fontSize: 13 },
  readOnlyValue: { border: '1px solid #edf0f5', borderRadius: 9, padding: '10px 11px', background: '#f8fafc', color: '#52627a', fontSize: 13, minHeight: 18 },
  note: { margin: '14px 0 0', color: '#8190a5', fontSize: 12, lineHeight: 1.55 },
  noteBox: { borderRadius: 10, padding: '11px 12px', background: '#f8fafc', color: '#52627a', fontSize: 12, lineHeight: 1.55 },
  secondaryButton: { display: 'inline-flex', borderRadius: 9, padding: '10px 12px', background: '#eef5ff', color: '#2563eb', textDecoration: 'none', fontSize: 13, fontWeight: 800 },
  preferenceRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 14, padding: 12, border: '1px solid #e5eaf2', borderRadius: 10, color: '#182234', fontSize: 13 },
}
