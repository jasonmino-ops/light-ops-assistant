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
 *  2. 加入已有门店 → instructions to get an invite link from their boss
 *
 * This page is also accessible from a regular browser — in that case
 * /open and /bind will show their own no_tg states.
 */

export default function StartPage() {
  function goOpen() {
    window.location.replace('/open')
  }

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div style={s.headerTitle}>欢迎使用店小二</div>
        <div style={s.headerSub}>轻经营助手</div>
      </div>

      <div style={s.body}>
        {/* ── Path 1: new merchant ── */}
        <div style={s.card} onClick={goOpen}>
          <div style={s.cardIcon}>🏪</div>
          <div style={s.cardText}>
            <div style={s.cardTitle}>我要开店</div>
            <div style={s.cardDesc}>申请开通新门店，需要开通验证码</div>
          </div>
          <div style={s.chevron}>›</div>
        </div>

        {/* ── Path 2: join existing store ── */}
        <div style={s.card}>
          <div style={s.cardIcon}>👤</div>
          <div style={s.cardText}>
            <div style={s.cardTitle}>加入已有门店</div>
            <div style={s.cardDesc}>联系老板，让老板在系统中生成员工邀请链接，点击链接后直接完成绑定</div>
          </div>
        </div>

        <div style={s.note}>
          已有账号？点击老板或管理员发给你的绑定链接直接登录，无需在此操作。
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
  headerTitle: { fontSize: 22, fontWeight: 700, color: '#fff' },
  headerSub: { fontSize: 14, color: 'rgba(255,255,255,0.75)' },

  body: { flex: 1, padding: '24px 16px 40px', maxWidth: 480, margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', gap: 12 },

  card: {
    background: '#fff', borderRadius: 14, padding: '18px 16px',
    display: 'flex', alignItems: 'center', gap: 14,
    boxShadow: '0 2px 12px rgba(0,0,0,0.06)', cursor: 'pointer',
  },
  cardIcon: { fontSize: 28, flexShrink: 0 },
  cardText: { flex: 1, display: 'flex', flexDirection: 'column', gap: 4 },
  cardTitle: { fontSize: 16, fontWeight: 700, color: '#1a1a1a' },
  cardDesc: { fontSize: 13, color: '#888', lineHeight: 1.5 },
  chevron: { fontSize: 20, color: '#bbb', flexShrink: 0 },

  note: {
    fontSize: 12, color: '#aaa', textAlign: 'center',
    lineHeight: 1.6, padding: '8px 12px',
  },
}
