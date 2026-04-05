/**
 * GET /api/auth/status
 *
 * Lightweight session check used by PWA mode (non-Telegram context).
 * Returns 200 { ok: true } when the auth-session cookie is valid.
 * Returns 401 { ok: false } when the session is missing or expired.
 *
 * Unlike /api/me, this endpoint never returns 200 for unauthenticated requests,
 * making it safe to use as a 401-detector.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getContext } from '@/lib/context'

export async function GET(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  return NextResponse.json({ ok: true })
}
