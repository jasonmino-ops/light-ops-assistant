import { NextRequest } from 'next/server'
import { verifySession } from './session'
import { prisma } from './prisma'

export type UserRole = 'OWNER' | 'STAFF'

export type RequestContext = {
  tenantId: string
  userId: string
  storeId: string
  role: UserRole
}

/**
 * Extracts the request context in priority order:
 *
 * 1. auth-session cookie — set by /api/auth/telegram after HMAC-verified
 *    Telegram WebApp auth. For cookie-based sessions the tenant status is
 *    checked against the DB: ARCHIVED tenants are blocked immediately.
 *
 * 2. x-* dev headers — local development fallback (injected by lib/api.ts).
 *    Never present in production Telegram WebApp traffic.
 *    Tenant status is NOT checked for dev headers (local seed data may vary).
 */
export async function getContext(req: NextRequest): Promise<RequestContext | null> {
  // ── 1. Signed session cookie ───────────────────────────────────────────────
  const sessionToken = req.cookies.get('auth-session')?.value
  if (sessionToken) {
    const session = verifySession(sessionToken)
    if (session) {
      // Block archived/stopped tenants — existing sessions are invalidated
      const tenant = await prisma.tenant.findUnique({
        where: { id: session.tenantId },
        select: { status: true },
      })
      if (!tenant || tenant.status !== 'ACTIVE') return null
      return {
        tenantId: session.tenantId,
        userId: session.userId,
        storeId: session.storeId,
        role: session.role,
      }
    }
  }

  // ── 2. Dev x-* header fallback ────────────────────────────────────────────
  const tenantId = req.headers.get('x-tenant-id')
  const userId = req.headers.get('x-user-id')
  const storeId = req.headers.get('x-store-id')
  const role = req.headers.get('x-role')

  if (!tenantId || !userId || !storeId || !role) return null
  if (role !== 'OWNER' && role !== 'STAFF') return null

  return { tenantId, userId, storeId, role }
}
