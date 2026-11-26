import { NextRequest, NextResponse } from 'next/server'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/prisma'
import { listPrintReplacementTargets } from '@/lib/v3-print-replacement-target'
import { printReplacementOwner } from '@/lib/v3-print-replacement-owner'
import { confirmPrintReplacement, controlledV3OwnerHandoff, type V3ControlPlaneDb } from '@/lib/v3-print-control-plane'

export const runtime = 'nodejs'
const db = prisma as unknown as V3ControlPlaneDb

const privateResponse = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })

export async function GET(req: NextRequest) {
  const owner = await printReplacementOwner(req)
  if (!owner) return privateResponse({ error: 'OWNER_PRESENCE_REQUIRED' }, 403)
  const receiptId = req.nextUrl.searchParams.get('confirmationId')
  if (receiptId && !/^[A-Za-z0-9_-]{1,128}$/.test(receiptId)) return privateResponse({ error: 'INVALID_REQUEST' }, 400)
  const targets = await listPrintReplacementTargets(prisma, { tenantId: owner.tenantId, storeId: owner.storeId })
  const plane = await prisma.v3PrintControlPlane.findFirst({ where: { storeId: owner.storeId, tenantId: owner.tenantId },
    select: { ownerDeviceId: true, ownerEpoch: true, mode: true } })
  const audit = receiptId && await prisma.operationLog.findFirst({ where: { tenantId: owner.tenantId,
    storeId: owner.storeId, userId: owner.userId, actionType: 'V3_PRINT_CONTROLLED_HANDOFF', targetType: 'V3PrintControlPlane',
    requestId: receiptId, message: 'HANDOFF_CONFIRMED', status: 'SUCCESS' }, select: { payloadSnapshot: true } })
  const fact = audit && audit.payloadSnapshot as Record<string, unknown> | null
  const confirmed = fact && fact.replacement === true && typeof fact.intendedOwnerDeviceId === 'string' &&
    Number.isSafeInteger(fact.ownerEpoch) ? { deviceId: fact.intendedOwnerDeviceId, epoch: fact.ownerEpoch } : null
  return privateResponse({ storeId: owner.storeId, targets, plane, confirmed })
}

export async function POST(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ ok: false, error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 })
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || !Number.isInteger(body.expectedStateVersion)) return NextResponse.json({ ok: false, error: 'INVALID_REQUEST' }, { status: 400 })
  if (body.action === 'REPLACE_PRINT_COMPUTER') {
    const origin = req.headers.get('origin')
    if (origin !== req.nextUrl.origin || !req.headers.get('content-type')?.startsWith('application/json') ||
        (req.headers.has('sec-fetch-site') && req.headers.get('sec-fetch-site') !== 'same-origin')) {
      return privateResponse({ error: 'INVALID_REQUEST_ORIGIN' }, 403)
    }
    const owner = await printReplacementOwner(req)
    if (!owner) return privateResponse({ error: 'OWNER_PRESENCE_REQUIRED' }, 403)
    if (Object.keys(body).sort().join(',') !== 'action,confirmationId,deviceId,expectedStateVersion,previousDeviceId,previousDeviceStopped,previousEpoch,storeId' ||
      body.storeId !== owner.storeId || body.previousDeviceStopped !== true || !Number.isSafeInteger(body.previousEpoch) ||
      typeof body.confirmationId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.confirmationId) ||
      typeof body.deviceId !== 'string' || typeof body.previousDeviceId !== 'string') return privateResponse({ error: 'INVALID_REQUEST' }, 400)
    const scope = { storeId: owner.storeId, tenantId: owner.tenantId }
    const selected = (await listPrintReplacementTargets(prisma, scope)).find(target => target.confirmationId === body.confirmationId)
    if (!selected || selected.deviceId !== body.deviceId || selected.previousDeviceId !== body.previousDeviceId ||
      selected.previousEpoch !== body.previousEpoch || selected.expectedStateVersion !== body.expectedStateVersion) {
      return privateResponse({ error: 'HANDOFF_TARGET_NOT_READY' }, 409)
    }
    const result = await confirmPrintReplacement(db, { ...scope, actorUserId: owner.userId, intendedOwnerDeviceId: selected.deviceId,
      confirmationId: selected.confirmationId, expectedStateVersion: selected.expectedStateVersion },
      { previousDeviceId: selected.previousDeviceId, previousEpoch: selected.previousEpoch, previousDeviceStopped: true })
    return result.ok ? privateResponse({ ok: true, ownerDeviceId: result.value.controlPlane.ownerDeviceId, epoch: result.value.controlPlane.ownerEpoch }) :
      privateResponse({ error: result.code }, 409)
  }
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
