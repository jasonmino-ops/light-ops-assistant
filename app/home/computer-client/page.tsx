'use client'

import { useEffect, type CSSProperties } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/app/components/LangProvider'
import { useWorkMode } from '@/app/components/WorkModeProvider'

export default function ComputerClientPage() {
  const router = useRouter()
  const { t } = useLocale()
  const { realRole } = useWorkMode()

  useEffect(() => {
    if (realRole !== 'OWNER') router.replace('/home')
  }, [realRole, router])

  if (realRole !== 'OWNER') return null

  return (
    <main style={s.page}>
      <div style={s.content}>
        <Link href="/home" style={s.backLink}>
          ← {t('common.back')}
        </Link>

        <section style={s.intro} aria-labelledby="computer-client-management-title">
          <div style={s.introHeading}>
            <div style={s.icon} aria-hidden="true">🖥️</div>
            <div>
              <h1 id="computer-client-management-title" style={s.title}>
                {t('home.computerClientManagementTitle')}
              </h1>
              <p style={s.description}>{t('home.computerClientManagementDesc')}</p>
            </div>
          </div>
        </section>

        <section style={s.pendingSection} aria-labelledby="pending-computers-title">
          <div style={s.sectionHeading}>
            <span style={s.sectionIcon} aria-hidden="true">⌛</span>
            <h2 id="pending-computers-title" style={s.sectionTitle}>
              {t('home.computerClientPendingTitle')}
            </h2>
          </div>

          <div
            style={s.requestStateRegion}
            data-computer-request-region="loading-error-list"
            aria-live="polite"
          >
            {/*
              Future API boundary: loading and error states, followed by real request cards,
              render inside this region. Each real card owns the Computer ID, computer name,
              system version, request time, and decision action area.
            */}
            <div style={s.emptyState}>
              <div style={s.emptyIcon} aria-hidden="true">🖥️</div>
              <h3 style={s.emptyTitle}>{t('home.computerClientEmptyTitle')}</h3>
              <p style={s.emptyDescription}>{t('home.computerClientCloudUnavailable')}</p>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

const s: Record<string, CSSProperties> = {
  page: {
    minHeight: 'calc(100vh - 64px)',
    padding: '18px 16px calc(36px + env(safe-area-inset-bottom))',
    background: 'var(--bg)',
  },
  content: {
    width: '100%',
    maxWidth: 560,
    margin: '0 auto',
    boxSizing: 'border-box',
  },
  backLink: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 36,
    marginBottom: 12,
    color: 'var(--blue)',
    fontSize: 13,
    fontWeight: 800,
    textDecoration: 'none',
  },
  intro: {
    padding: '20px 18px',
    border: '1px solid #e2e8f0',
    borderRadius: 20,
    background: 'var(--card)',
    boxShadow: '0 10px 28px rgba(15,23,42,0.06)',
  },
  introHeading: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 13,
  },
  icon: {
    width: 48,
    height: 48,
    display: 'grid',
    placeItems: 'center',
    flex: '0 0 auto',
    borderRadius: 15,
    background: '#f5f3ff',
    fontSize: 23,
  },
  title: {
    margin: 0,
    color: 'var(--text)',
    fontSize: 21,
    fontWeight: 900,
    lineHeight: 1.3,
  },
  description: {
    margin: '7px 0 0',
    color: 'var(--muted)',
    fontSize: 14,
    lineHeight: 1.65,
  },
  pendingSection: {
    marginTop: 14,
    padding: '18px 16px 16px',
    border: '1px solid #e2e8f0',
    borderRadius: 20,
    background: 'var(--card)',
    boxShadow: '0 10px 28px rgba(15,23,42,0.05)',
  },
  sectionHeading: {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    marginBottom: 14,
  },
  sectionIcon: {
    width: 32,
    height: 32,
    display: 'grid',
    placeItems: 'center',
    borderRadius: 10,
    background: '#fff7ed',
    fontSize: 16,
  },
  sectionTitle: {
    margin: 0,
    color: 'var(--text)',
    fontSize: 16,
    fontWeight: 900,
    lineHeight: 1.35,
  },
  requestStateRegion: {
    minHeight: 220,
  },
  emptyState: {
    minHeight: 220,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '26px 18px',
    border: '1px dashed #cbd5e1',
    borderRadius: 16,
    background: '#f8fafc',
    textAlign: 'center',
    boxSizing: 'border-box',
  },
  emptyIcon: {
    width: 52,
    height: 52,
    display: 'grid',
    placeItems: 'center',
    borderRadius: 16,
    background: '#eef2ff',
    fontSize: 24,
    opacity: 0.78,
  },
  emptyTitle: {
    margin: '14px 0 0',
    color: 'var(--text)',
    fontSize: 16,
    fontWeight: 900,
    lineHeight: 1.4,
  },
  emptyDescription: {
    maxWidth: 390,
    margin: '9px 0 0',
    padding: '11px 12px',
    border: '1px solid #ddd6fe',
    borderRadius: 12,
    background: '#f5f3ff',
    color: '#6d28d9',
    fontSize: 12.5,
    fontWeight: 700,
    lineHeight: 1.65,
  },
}
