import type { CSSProperties } from 'react'

export default function PublicHomePage() {
  return (
    <main style={s.page}>
      <section style={s.hero}>
        <div style={s.brand}>E-Life KH</div>
        <h1 style={s.title}>E-Life KH</h1>
        <p style={s.subtitle}>
          Digital store assistant and product pages for local merchants in Cambodia.
        </p>
        <div style={s.actions}>
          <a href="/e-life" style={{ ...s.button, ...s.primary }}>
            View Products / Explore Stores
          </a>
          <a href="/relogin" style={{ ...s.button, ...s.secondary }}>
            Merchant Login
          </a>
        </div>
      </section>
      <footer style={s.footer}>
        <a href="/privacy" style={s.footerLink}>Privacy Policy</a>
        <span style={s.dot}>•</span>
        <a href="/terms" style={s.footerLink}>Terms of Service</a>
        <span style={s.dot}>•</span>
        <a href="/contact" style={s.footerLink}>Contact Us</a>
      </footer>
    </main>
  )
}

const s: Record<string, CSSProperties> = {
  page: {
    minHeight: '100dvh',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    background: '#f5f7fb',
    color: '#172033',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    padding: 24,
  },
  hero: {
    width: 'min(720px, 100%)',
    margin: '18vh auto 0',
  },
  brand: {
    color: '#1677ff',
    fontSize: 14,
    fontWeight: 800,
    marginBottom: 12,
  },
  title: {
    margin: 0,
    fontSize: 42,
    lineHeight: 1.1,
    letterSpacing: 0,
  },
  subtitle: {
    maxWidth: 560,
    margin: '16px 0 0',
    color: '#596579',
    fontSize: 18,
    lineHeight: 1.55,
  },
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 28,
  },
  button: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderRadius: 8,
    padding: '0 16px',
    fontSize: 15,
    fontWeight: 800,
    textDecoration: 'none',
  },
  primary: {
    background: '#1677ff',
    color: '#fff',
  },
  secondary: {
    background: '#fff',
    color: '#172033',
    border: '1px solid #d0d5dd',
  },
  footer: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
    color: '#667085',
    fontSize: 13,
    paddingTop: 36,
  },
  footerLink: {
    color: '#475467',
    textDecoration: 'none',
  },
  dot: {
    color: '#98a2b3',
  },
}
