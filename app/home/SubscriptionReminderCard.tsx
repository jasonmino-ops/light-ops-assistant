'use client'

import type { CSSProperties } from 'react'
import { useLocale, type Lang } from '@/app/components/LangProvider'
import type { SubscriptionReminderResult } from '@/lib/subscription-reminder'

type Props = {
  reminder: SubscriptionReminderResult
}

const LOCALE: Record<Lang, string> = {
  zh: 'zh-CN',
  en: 'en-US',
  km: 'km-KH',
}

function formatDateTime(value: string | null, lang: Lang): string {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return new Intl.DateTimeFormat(LOCALE[lang], {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export default function SubscriptionReminderCard({ reminder }: Props) {
  const { t, lang } = useLocale()
  if (reminder.displayState === 'NORMAL') return null

  const urgent = reminder.displayState === 'EXPIRED'
  const palette = urgent
    ? { background: '#fff1f2', border: '#fecdd3', icon: '#e11d48', title: '#9f1239', text: '#881337' }
    : { background: '#fffbeb', border: '#fde68a', icon: '#d97706', title: '#92400e', text: '#78350f' }

  let title = t('home.subscriptionExpiredTitle')
  let lines = [t('home.subscriptionExpiredBody')]

  if (reminder.displayState === 'REMIND') {
    title = reminder.storedStatus === 'TRIAL'
      ? t('home.subscriptionTrialRemindTitle')
      : t('home.subscriptionActiveRemindTitle')
    lines = [
      `${t('home.subscriptionExpiryAt')} ${formatDateTime(reminder.expiry, lang)}`,
      t('home.subscriptionRemindBody'),
    ]
  } else if (reminder.displayState === 'GRACE') {
    title = t('home.subscriptionGraceTitle')
    lines = [
      t('home.subscriptionGraceBody'),
      `${t('home.subscriptionGraceUntil')} ${formatDateTime(reminder.graceEndsAt, lang)}`,
      t('home.subscriptionRemindBody'),
    ]
  }

  return (
    <section
      role="status"
      data-subscription-reminder={reminder.displayState}
      style={{ ...styles.card, background: palette.background, borderColor: palette.border }}
    >
      <span aria-hidden="true" style={{ ...styles.icon, color: palette.icon }}>!</span>
      <div style={styles.content}>
        <div style={{ ...styles.title, color: palette.title }}>{title}</div>
        {lines.map((line) => (
          <div key={line} style={{ ...styles.line, color: palette.text }}>{line}</div>
        ))}
      </div>
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  card: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 11,
    marginBottom: 12,
    padding: '12px 14px',
    border: '1px solid',
    borderRadius: 16,
    boxShadow: '0 8px 24px rgba(15,23,42,0.06)',
  },
  icon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 22,
    height: 22,
    flexShrink: 0,
    borderRadius: 999,
    border: '1.5px solid currentColor',
    fontSize: 13,
    fontWeight: 900,
    lineHeight: 1,
  },
  content: {
    minWidth: 0,
  },
  title: {
    marginBottom: 3,
    fontSize: 14,
    fontWeight: 800,
    lineHeight: 1.35,
  },
  line: {
    fontSize: 12,
    lineHeight: 1.55,
  },
}
