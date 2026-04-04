import { NextRequest } from 'next/server'
import { verifySession } from './session'

/**
 * Checks if the caller is an authorized ops admin.
 *
 * Verifies the session directly (bypassing tenant status check) so that
 * ops admins can manage tenants including ARCHIVED ones without being
 * locked out by their own tenant's status.
 *
 * Returns true if authorized, false otherwise.
 */
export function checkOpsAuth(req: NextRequest): boolean {
  const sessionToken = req.cookies.get('auth-session')?.value
  let userId: string | null = null
  let role: string | null = null

  if (sessionToken) {
    const session = verifySession(sessionToken)
    if (session) {
      userId = session.userId
      role = session.role
    }
  }

  // Dev x-* header fallback
  if (!role) {
    role = req.headers.get('x-role')
    userId = req.headers.get('x-user-id')
  }

  if (role !== 'OWNER') return false

  // Web password login issues a session with this special userId.
  // It bypasses OPS_USER_IDS because the password itself is the auth factor.
  if (userId === '_ops_admin') return true

  const allowed = (process.env.OPS_USER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  return allowed.length === 0 || (userId != null && allowed.includes(userId))
}
