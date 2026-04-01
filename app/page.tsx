import { redirect } from 'next/navigation'

/**
 * Root index — dev-period role-based redirect.
 * Set DEV_ROLE in .env:
 *   DEV_ROLE=OWNER  → /dashboard
 *   DEV_ROLE=STAFF  → /home   (default)
 */
export default function Root() {
  const role = process.env.DEV_ROLE ?? 'STAFF'
  redirect(role === 'OWNER' ? '/dashboard' : '/home')
}
