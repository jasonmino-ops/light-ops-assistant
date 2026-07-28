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
      <section style={s.card} aria-labelledby="computer-client-management-title">
        <div style={s.icon} aria-hidden="true">🖥️</div>
        <h1 id="computer-client-management-title" style={s.title}>
          {t('home.computerClientManagementTitle')}
        </h1>
        <p style={s.description}>{t('home.computerClientManagementDesc')}</p>
        <div style={s.unavailable} role="status">
          {t('home.computerClientCloudUnavailable')}
        </div>
        <Link href="/home" style={s.backLink}>
          ← {t('common.back')}
        </Link>
      </section>
    </main>
  )
}

const s: Record<string, CSSProperties> = {
  page: {
    minHeight: 'calc(100vh - 64px)',
    display: 'grid',
    placeItems: 'center',
    padding: '28px 16px calc(36px + env(safe-area-inset-bottom))',
    background: 'var(--bg)',
  },
  card: {
    width: '100%',
    maxWidth: 480,
    boxSizing: 'border-box',
    padding: '28px 22px',
    border: '1px solid #e2e8f0',
    borderRadius: 22,
    background: 'var(--card)',
    boxShadow: '0 16px 36px rgba(15,23,42,0.08)',
    textAlign: 'center',
  },
  icon: {
    width: 54,
    height: 54,
    margin: '0 auto 14px',
    display: 'grid',
    placeItems: 'center',
    borderRadius: 16,
    background: '#f5f3ff',
    fontSize: 26,
  },
  title: {
    margin: 0,
    color: 'var(--text)',
    fontSize: 22,
    fontWeight: 900,
    lineHeight: 1.3,
  },
  description: {
    margin: '10px 0 0',
    color: 'var(--muted)',
    fontSize: 14,
    lineHeight: 1.65,
  },
  unavailable: {
    marginTop: 20,
    padding: '12px 14px',
    border: '1px solid #ddd6fe',
    borderRadius: 12,
    background: '#f5f3ff',
    color: '#6d28d9',
    fontSize: 13,
    fontWeight: 800,
    lineHeight: 1.5,
  },
  backLink: {
    display: 'inline-block',
    marginTop: 22,
    color: 'var(--blue)',
    fontSize: 13,
    fontWeight: 800,
    textDecoration: 'none',
  },
}
