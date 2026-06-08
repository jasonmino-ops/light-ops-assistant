import type { CSSProperties } from 'react'

const updatedAt = 'June 2026'

export default function PrivacyPolicyPage() {
  return (
    <main style={s.page}>
      <section style={s.card}>
        <h1 style={s.title}>Privacy Policy</h1>
        <p style={s.muted}>Last updated: {updatedAt}</p>
        <p>
          Store pages powered by light-ops-assistant collect only the information needed to process customer orders,
          such as name, phone number, delivery address, order items, and optional notes.
        </p>
        <p>
          We may use basic advertising and analytics parameters, including UTM parameters and TikTok Pixel events,
          to understand campaign performance. These signals do not change order pricing or fulfillment.
        </p>
        <p>
          Order information is shared with the relevant merchant so they can confirm and fulfill the order. We do not
          sell customer personal information.
        </p>
        <p>
          Customers can contact the merchant or platform operator through the Contact Us page for privacy questions or
          data requests.
        </p>
      </section>
    </main>
  )
}

const s: Record<string, CSSProperties> = {
  page: { minHeight: '100dvh', background: '#f5f7fb', padding: 20, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', color: '#172033' },
  card: { maxWidth: 760, margin: '0 auto', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 24, lineHeight: 1.65 },
  title: { margin: '0 0 8px', fontSize: 28, letterSpacing: 0 },
  muted: { color: '#667085', fontSize: 14 },
}
