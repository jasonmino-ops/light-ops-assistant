/**
 * POST /api/cashier/device-token
 *
 * Minimal desktop POS authorization boundary.
 * Requires the normal OWNER/STAFF context, then returns a signed device token
 * that the same browser stores locally and sends to desktop cashier APIs.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { signPosDeviceToken } from '@/lib/desktop-pos-auth'

export async function POST(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) {
    return NextResponse.json({
      error: 'LOGIN_REQUIRED',
      message: 'Please sign in as the owner or an active staff member before authorizing this POS computer.',
    }, { status: 401 })
  }

  let body: { storeCode?: string; deviceId?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })
  }

  const storeCode = body.storeCode?.trim()
  const deviceId = body.deviceId?.trim()
  if (!storeCode) return NextResponse.json({ error: 'MISSING_STORE_CODE' }, { status: 400 })
  if (!deviceId) return NextResponse.json({ error: 'MISSING_DEVICE_ID' }, { status: 400 })

  const store = await prisma.store.findUnique({
    where: { code: storeCode },
    select: { id: true, code: true, tenantId: true, status: true },
  })
  if (!store || store.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })
  }

  if (ctx.role === 'STAFF' && ctx.storeId !== store.id) {
    return NextResponse.json({ error: 'FORBIDDEN', message: 'This account cannot authorize another store.' }, { status: 403 })
  }
  if (ctx.tenantId !== store.tenantId) {
    return NextResponse.json({ error: 'FORBIDDEN', message: 'This account cannot authorize this store.' }, { status: 403 })
  }

  if (ctx.role === 'STAFF') {
    const activeRole = await prisma.userStoreRole.findFirst({
      where: { tenantId: store.tenantId, storeId: store.id, userId: ctx.userId, status: 'ACTIVE' },
      select: { id: true },
    })
    if (!activeRole) {
      return NextResponse.json({ error: 'FORBIDDEN', message: 'This account is not active in this store.' }, { status: 403 })
    }
  }

  const token = signPosDeviceToken({
    tenantId: store.tenantId,
    storeId: store.id,
    storeCode: store.code,
    deviceId,
    issuedBy: ctx.userId,
  })

  return NextResponse.json({ token, storeCode: store.code, deviceId })
}
