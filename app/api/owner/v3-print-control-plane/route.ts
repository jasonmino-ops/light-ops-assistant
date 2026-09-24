import { NextRequest, NextResponse } from 'next/server'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/prisma'
import { controlledV3OwnerHandoff, type V3ControlPlaneDb } from '@/lib/v3-print-control-plane'

export const runtime = 'nodejs'
const db = prisma as unknown as V3ControlPlaneDb

export async function POST(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ ok: false, error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 })
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || !Number.isInteger(body.expectedStateVersion)) return NextResponse.json({ ok: false, error: 'INVALID_REQUEST' }, { status: 400 })
  const identity = { tenantId: ctx.tenantId, storeId: ctx.storeId, expectedStateVersion: body.expectedStateVersion as number }
  if (body.action === 'SET_MODE') {
    return NextResponse.json({ ok: false, error: 'RAW_SET_MODE_RETIRED' }, {
      status: 409,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  }
  let result
  if (body.action === 'CONTROLLED_HANDOFF') {
    if (typeof body.intendedOwnerDeviceId !== 'string' || !body.intendedOwnerDeviceId ||
      typeof body.confirmationId !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(body.confirmationId)) {
      return NextResponse.json({ ok: false, error: 'INVALID_HANDOFF_CONFIRMATION' }, { status: 400 })
    }
    result = await controlledV3OwnerHandoff(db, {
      ...identity,
      actorUserId: ctx.userId,
      intendedOwnerDeviceId: body.intendedOwnerDeviceId,
      confirmationId: body.confirmationId,
    })
  }
  else return NextResponse.json({ ok: false, error: 'INVALID_ACTION' }, { status: 400 })
  return NextResponse.json(result.ok ? { ok: true, ...result.value } : { ok: false, error: result.code }, {
    status: result.ok ? 200 : 409,
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
