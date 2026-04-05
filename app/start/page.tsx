'use client'

/**
 * /start — Unified onboarding entry
 *
 * Shown when a Telegram user opens the Mini App for the first time
 * and has no bound account (TelegramInit redirects here on USER_NOT_FOUND
 * when no startapp parameter is present).
 *
 * Two paths:
 *  1. 申请开店 → /open  (new merchant, needs STORE_OPEN_CODE)
 *  2. 我有邀请链接 → info card: click the link your boss sent you
 *
 * This page is also accessible from a regular browser — in that case
 * /open and /bind will show their own no_tg states.
 */

import zh from '@/lib/i18n/zh'
import km from '@/lib/i18n/km'

function bi(zhStr: string, kmStr: string) {
  return (
    <>
      {zhStr}
      <br />
      <span style={{ fontSize: '0.85em', opacity: 0.72 }}>{kmStr}</span>
    </>
  )
}

export default function StartPage() {
  function goOpen() {
    window.location.replace('/open')
  }

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div style={s.headerTitle}>{bi(zh.start.welcomeTitle, km.start.welcomeTitle)}</div>
        <div style={s.headerSub}>{bi(zh.start.welcomeSub, km.start.welcomeSub)}</div>
      </div>

      <div style={s.body}>
        {/* ── Path 1: new merchant ── */}
        <div style={s.card} onClick={goOpen}>
          <div style={s.cardIcon}>🏪</div>
          <div style={s.cardText}>
            <div style={s.cardTitle}>{bi(zh.start.goOpen, km.start.goOpen)}</div>
            <div style={s.cardDesc}>{bi(zh.start.goOpenDesc, km.start.goOpenDesc)}</div>
          </div>
          <div style={s.chevron}>›</div>
        </div>

        {/* ── Path 2: has invite link (info card, no navigation) ── */}
        <div style={s.cardInfo}>
          <div style={s.cardIcon}>🔗</div>
          <div style={s.cardText}>
            <div style={s.cardTitle}>{bi(zh.start.hasInvite, km.start.hasInvite)}</div>
            <div style={s.cardDesc}>{bi(zh.start.hasInviteDesc, km.start.hasInviteDesc)}</div>
          </div>
        </div>

        <div style={s.note}>
          {bi(zh.start.alreadyBound, km.start.alreadyBound)}
        </div>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f5f7fa', display: 'flex', flexDirection: 'column' },
  header: {
    background: '#1677ff', padding: '32px 20px 28px',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
  },
  headerTitle: { fontSize: 22, fontWeight: 700, color: '#fff', textAlign: 'center' },
  headerSub: { fontSize: 14, color: 'rgba(255,255,255,0.75)', textAlign: 'center' },

  body: { flex: 1, padding: '24px 16px 40px', maxWidth: 480, margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', gap: 12 },

  card: {
    background: '#fff', borderRadius: 14, padding: '18px 16px',
    display: 'flex', alignItems: 'center', gap: 14,
    boxShadow: '0 2px 12px rgba(0,0,0,0.06)', cursor: 'pointer',
  },
  cardInfo: {
    background: '#f0f7ff', borderRadius: 14, padding: '18px 16px',
    display: 'flex', alignItems: 'center', gap: 14,
    border: '1px solid #d0e8ff',
  },
  cardIcon: { fontSize: 28, flexShrink: 0 },
  cardText: { flex: 1, display: 'flex', flexDirection: 'column', gap: 4 },
  cardTitle: { fontSize: 16, fontWeight: 700, color: '#1a1a1a', lineHeight: 1.4 },
  cardDesc: { fontSize: 13, color: '#888', lineHeight: 1.5 },
  chevron: { fontSize: 20, color: '#bbb', flexShrink: 0 },

  note: {
    fontSize: 12, color: '#aaa', textAlign: 'center',
    lineHeight: 1.6, padding: '8px 12px',
  },
}
