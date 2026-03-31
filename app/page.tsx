import { redirect } from 'next/navigation'

/**
 * Root index page — dev-period role-based redirect.
 *
 * Set DEV_ROLE in .env.local to switch identity:
 *   DEV_ROLE=OWNER   → /dashboard
 *   DEV_ROLE=STAFF   → /sale  (default)
 *
 * Replace with real session-based redirect when auth is implemented.
 */
export default function HomePage() {
  const role = process.env.DEV_ROLE ?? 'STAFF'
  redirect(role === 'OWNER' ? '/dashboard' : '/sale')
}
