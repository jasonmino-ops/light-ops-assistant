import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { verifySession } from '@/lib/session'

/**
 * Root index — redirects based on the authenticated role.
 *
 * Priority:
 *   1. auth-session cookie (Telegram WebApp auth) → role from session
 *   2. DEV_ROLE env var (local development fallback)
 *   3. Default: STAFF → /home
 *
 * OWNER → /dashboard
 * STAFF → /home
 */
export default async function Root() {
  const cookieStore = await cookies()
  const sessionToken = cookieStore.get('auth-session')?.value
  const sessionRole = sessionToken ? verifySession(sessionToken)?.role : undefined
  const role = sessionRole ?? process.env.DEV_ROLE ?? 'STAFF'

  redirect('/home')
}
