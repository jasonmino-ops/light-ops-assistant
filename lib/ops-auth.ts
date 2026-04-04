import { NextRequest } from 'next/server'
import { verifySession } from './session'

/**
 * Checks if the caller is an authorized ops admin and returns their role.
 * Returns false if not authorized.
 *
 * Role hierarchy: SUPER_ADMIN > OPS_ADMIN > BD
 *
 * Backward compat:
 * - _ops_admin userId (legacy web login without opsRole) → SUPER_ADMIN
 * - OPS_USER_IDS env var (legacy DB user IDs) → OPS_ADMIN
 */
export type OpsRole = 'SUPER_ADMIN' | 'OPS_ADMIN' | 'BD'

export function checkOpsAuth(req: NextRequest): OpsRole | false {
  const sessionToken = req.cookies.get('auth-session')?.value
  let userId: string | null = null
  let role: string | null = null
  let opsRole: string | null = null

  if (sessionToken) {
    const session = verifySession(sessionToken)
    if (session) {
      userId = session.userId
      role = session.role
      opsRole = session.opsRole ?? null
    }
  }

  // Dev x-* header fallback
  if (!role) {
    role = req.headers.get('x-role')
    userId = req.headers.get('x-user-id')
    opsRole = req.headers.get('x-ops-role')
  }

  if (role !== 'OWNER') return false

  // New: opsRole in session (set by new OpsAdmin-based login)
  if (opsRole === 'SUPER_ADMIN') return 'SUPER_ADMIN'
  if (opsRole === 'OPS_ADMIN') return 'OPS_ADMIN'
  if (opsRole === 'BD') return 'BD'

  // Legacy: _ops_admin without opsRole → SUPER_ADMIN
  if (userId === '_ops_admin') return 'SUPER_ADMIN'

  // Legacy: OPS_USER_IDS check
  const allowed = (process.env.OPS_USER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (allowed.length === 0 || (userId != null && allowed.includes(userId))) {
    return 'OPS_ADMIN'
  }

  return false
}

/** Returns true if the given ops role meets the minimum required role. */
export function hasOpsRole(actual: OpsRole, required: OpsRole): boolean {
  const rank: Record<OpsRole, number> = { SUPER_ADMIN: 3, OPS_ADMIN: 2, BD: 1 }
  return rank[actual] >= rank[required]
}
