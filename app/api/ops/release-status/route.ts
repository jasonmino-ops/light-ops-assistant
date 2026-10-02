import { NextRequest, NextResponse } from 'next/server'
import { checkOpsAuth, hasOpsRole } from '@/lib/ops-auth'
import { OPS_RELEASE_STATUS } from '@/lib/ops-release-status'

export async function GET(req: NextRequest) {
  const opsRole = await checkOpsAuth(req)
  if (!opsRole || !hasOpsRole(opsRole, 'OPS_ADMIN')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  return NextResponse.json(OPS_RELEASE_STATUS, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
