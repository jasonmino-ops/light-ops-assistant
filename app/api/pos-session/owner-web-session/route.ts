import { NextRequest } from 'next/server'
import { apiError, noStoreJson, withDesktopApiError } from '@/lib/desktop-activation/http'
import {
  issueDesktopOwnerWebSession,
  OWNER_WEB_SESSION_COOKIE,
  ownerWebSessionCookieOptions,
} from '@/lib/desktop-owner-web-session'

/**
 * POST /api/pos-session/owner-web-session
 *
 * ES-DESKTOP-OWNER-WEB-SESSION-01: exchanges the Desktop-only managed POS
 * session (x-pos-device-token / x-pos-device-id) for the standard OWNER
 * `auth-session` cookie of the Desktop's bound store. Every failed condition
 * fails closed without setting a cookie. The response never echoes a token.
 */
export async function POST(req: NextRequest) {
  return withDesktopApiError(async () => {
    const result = await issueDesktopOwnerWebSession(req)
    if (!result.ok) return apiError(result.error, result.status)
    const res = noStoreJson({ ok: true, expiresAt: result.expiresAt.toISOString() })
    res.cookies.set(OWNER_WEB_SESSION_COOKIE, result.sessionToken, ownerWebSessionCookieOptions())
    return res
  })
}
