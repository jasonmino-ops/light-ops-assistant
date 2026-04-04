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
import { checkOpsAuth } from '@/lib/ops-auth'

export async function GET(req: NextRequest) {
  if (!checkOpsAuth(req)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  return NextResponse.json({ ok: true })
}
