import { NextRequest, NextResponse } from 'next/server'
import { DIAMOND_RECOVERY } from '@/lib/diamond-recovery/case'
import { prisma } from '@/lib/prisma'

// A separate case-only dispatcher; the ordinary cashier route is unchanged.
const { createController } = require('@/lib/diamond-recovery/controller.cjs')
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 90

function reply(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store, private' } })
  if (response.headers.has('set-cookie')) throw new Error('RECOVERY_AUTH_ISSUANCE_FORBIDDEN')
  return response
}
export async function GET(req: NextRequest) {
  try {
    const controller = createController(prisma)
    const identity = await controller.authenticate(req)
    return reply(await controller.status(identity))
  } catch { return reply({ state: 'UNKNOWN', reason: 'READ_OR_AUTH_UNPROVED_STOP' }, 403) }
}
export async function POST(req: NextRequest) {
  // Same-origin JSON only. No GET side effects or cross-site trigger.
  if (req.headers.get('origin') !== DIAMOND_RECOVERY.origin ||
      req.headers.get('content-type')?.split(';')[0] !== 'application/json' ||
      Number(req.headers.get('content-length') || 0) > 1024) {
    return reply({ state: 'BLOCKED_NOT_ACCEPTED', accepted: false, reason: 'INVALID_REQUEST' }, 403)
  }
  let input
  try {
    const raw = await req.text()
    if (Buffer.byteLength(raw) > 1024) return reply({ state: 'BLOCKED' }, 400)
    input = JSON.parse(raw)
  } catch { return reply({ state: 'BLOCKED', reason: 'INVALID_BODY' }, 400) }
  try { return reply(await createController(prisma).execute(req, input)) }
  catch { return reply({ state: 'UNKNOWN', reason: 'STOP_NO_RESUBMIT' }, 409) }
}
