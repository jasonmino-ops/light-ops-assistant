/**
 * GET /api/cashier/device-authorization/status
 *
 * Public desktop polling endpoint. Returns the POS device token only to the
 * same deviceId that created the request.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { issueBrowserPosDevice } from '@/lib/browser-pos-device'

type AuthPayload = {
  expiresAt?: string
  storeCode?: string
  storeName?: string
  deviceName?: string
  deliveredAt?: string
}

function readPayload(value: unknown): AuthPayload {
  return (typeof value === 'object' && value !== null ? value : {}) as AuthPayload
}

export async function GET(req: NextRequest) {
  const requestId = req.nextUrl.searchParams.get('requestId')?.trim()
  const deviceId = req.nextUrl.searchParams.get('deviceId')?.trim()
  if (!requestId) return NextResponse.json({ error: 'MISSING_REQUEST_ID' }, { status: 400 })
  if (!deviceId) return NextResponse.json({ error: 'MISSING_DEVICE_ID' }, { status: 400 })

  const row = await prisma.operationLog.findFirst({
    where: {
      requestId,
      actionType: 'POS_DEVICE_AUTH_REQUEST',
      targetType: 'POS_DEVICE',
      targetId: deviceId,
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, tenantId: true, storeId: true, targetId: true, userId: true, status: true, payloadSnapshot: true },
  })
  if (!row) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  const payload = readPayload(row.payloadSnapshot)
  const expiresAt = payload.expiresAt ? new Date(payload.expiresAt).getTime() : 0
  if (!expiresAt || Date.now() > expiresAt) {
    return NextResponse.json({ status: 'EXPIRED' })
  }
  if (row.status === 'SUCCESS' && row.storeId && row.targetId && row.userId && payload.storeCode && !payload.deliveredAt) {
    const issued = await issueBrowserPosDevice({
      tenantId: row.tenantId,
      storeId: row.storeId,
      storeCode: payload.storeCode,
      deviceId: row.targetId,
      issuedByUserId: row.userId,
    })
    await prisma.operationLog.update({
      where: { id: row.id },
      data: {
        payloadSnapshot: {
          ...payload,
          deliveredAt: new Date().toISOString(),
          tokenExpiresAt: issued.expiresAt.toISOString(),
        },
      },
    })
    return NextResponse.json({
      status: 'APPROVED',
      token: issued.token,
      storeCode: payload.storeCode,
      storeName: payload.storeName,
      deviceName: payload.deviceName,
    })
  }
  if (row.status === 'SUCCESS') return NextResponse.json({ status: 'APPROVED' })
  return NextResponse.json({ status: 'PENDING' })
}
