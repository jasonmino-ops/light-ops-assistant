import type { CSSProperties } from 'react'

export default function ContactPage() {
  return (
    <main style={s.page}>
      <section style={s.card}>
        <h1 style={s.title}>Contact Us</h1>
        <p>
          For questions about a product, delivery, returns, or an existing order, please contact the merchant shown on
          the product page directly.
        </p>
        <p>
          For platform or privacy questions, contact the light-ops-assistant operator through your merchant support
          channel.
        </p>
        <div style={s.box}>
          <div style={s.label}>Platform</div>
          <div>light-ops-assistant / 店小二 SaaS</div>
        </div>
      </section>
    </main>
  )
}

const s: Record<string, CSSProperties> = {
  page: { minHeight: '100dvh', background: '#f5f7fb', padding: 20, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', color: '#172033' },
  card: { maxWidth: 760, margin: '0 auto', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 24, lineHeight: 1.65 },
  title: { margin: '0 0 8px', fontSize: 28, letterSpacing: 0 },
  box: { marginTop: 18, border: '1px solid #e5e7eb', borderRadius: 8, padding: 14, background: '#f9fafb' },
  label: { fontSize: 12, color: '#667085', fontWeight: 800, textTransform: 'uppercase', marginBottom: 4 },
}
