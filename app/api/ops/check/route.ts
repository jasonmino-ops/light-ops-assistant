/**
 * GET /api/ops/check — verify the current authenticated user is an ops admin
 * Returns 200 + { ok: true, opsRole } on success, 403 on failure.
 */
import { NextRequest, NextResponse } from 'next/server'
import { checkOpsAuth } from '@/lib/ops-auth'

export async function GET(req: NextRequest) {
  const opsRole = checkOpsAuth(req)
  if (!opsRole) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  return NextResponse.json({ ok: true, opsRole })
}
