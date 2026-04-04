/**
 * Next.js Edge middleware — route-level access control.
 *
 * Protects /dashboard: only OWNER may access it.
 * Non-owners are redirected to /home.
 *
 * The role is read from the auth-session cookie (set by /api/auth/telegram).
 * The cookie payload is parsed without HMAC verification here (Edge runtime
 * cannot use Node.js crypto). The real HMAC check happens in lib/context.ts
 * inside each API route, so forging the cookie only grants UI access — all
 * data calls still fail.
 *
 * In local dev (no cookie), falls back to the DEV_ROLE env var.
 */

import { NextRequest, NextResponse } from 'next/server'

function peekRole(token: string): string | null {
  try {
    // token format: <base64url-json>.<sig>
    const payload = token.slice(0, token.lastIndexOf('.'))
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/') +
      '='.repeat((4 - payload.length % 4) % 4)
    const json = atob(padded)
    return (JSON.parse(json) as { role?: string }).role ?? null
  } catch {
    return null
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // /ops/login is always public — it IS the login page
  if (pathname.startsWith('/ops/login')) return NextResponse.next()

  const isOwnerOnly =
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/products') ||
    pathname.startsWith('/invite') ||
    pathname.startsWith('/system') ||
    pathname.startsWith('/ops')
  if (!isOwnerOnly) {
    return NextResponse.next()
  }

  // Check session cookie
  const sessionToken = req.cookies.get('auth-session')?.value
  const roleFromCookie = sessionToken ? peekRole(sessionToken) : null

  // Fall back to DEV_ROLE in non-production environments
  const role = roleFromCookie ??
    (process.env.NODE_ENV !== 'production' ? process.env.DEV_ROLE : null)

  if (role === 'OWNER') return NextResponse.next()

  // /ops paths without a session go to the ops login page (not the tenant /home)
  if (pathname.startsWith('/ops')) {
    return NextResponse.redirect(new URL('/ops/login', req.url))
  }

  return NextResponse.redirect(new URL('/home', req.url))
}

export const config = {
  matcher: ['/dashboard/:path*', '/products/:path*', '/invite/:path*', '/system/:path*', '/ops/:path*'],
}
