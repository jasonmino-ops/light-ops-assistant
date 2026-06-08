import type { CSSProperties } from 'react'

const updatedAt = 'June 2026'

export default function TermsPage() {
  return (
    <main style={s.page}>
      <section style={s.card}>
        <h1 style={s.title}>Terms of Service</h1>
        <p style={s.muted}>Last updated: {updatedAt}</p>
        <p>
          Product landing pages are provided for customers to submit purchase requests to participating merchants.
          Submitting an order does not create an online payment transaction on this page.
        </p>
        <p>
          Product availability, delivery timing, after-sales handling, and final order confirmation are managed by the
          merchant. Customers should provide accurate contact and delivery information.
        </p>
        <p>
          Merchants are responsible for their product descriptions, pricing, fulfillment, and customer support. The
          platform may update or disable pages that are unavailable, inaccurate, or unsafe.
        </p>
        <p>
          By using these pages, customers agree that order and campaign data may be processed for order fulfillment,
          support, and campaign measurement.
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
