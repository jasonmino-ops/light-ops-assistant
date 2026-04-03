/**
 * GET /api/ops/check — verify the current authenticated user is an ops admin
 *
 * Guards the /ops internal admin page.
 * Returns 200 if the logged-in OWNER is in the OPS_USER_IDS whitelist.
 * Returns 403 otherwise.
 *
 * OPS_USER_IDS: comma-separated DB user UUIDs (not Telegram IDs).
 * Leave empty to allow any OWNER (dev / single-operator setups).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getContext } from '@/lib/context'

export async function GET(req: NextRequest) {
  const ctx = getContext(req)
  if (!ctx) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const allowed = (process.env.OPS_USER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  // Empty whitelist = allow any OWNER (dev / single-operator deployment)
  if (allowed.length === 0 || allowed.includes(ctx.userId)) {
    return NextResponse.json({ ok: true, userId: ctx.userId, tenantId: ctx.tenantId })
  }

  return NextResponse.json({ error: 'NOT_IN_WHITELIST' }, { status: 403 })
}
