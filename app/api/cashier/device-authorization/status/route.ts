/**
 * GET /api/cashier/device-authorization/status
 *
 * Public desktop polling endpoint. Returns the POS device token only to the
 * same deviceId that created the request.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  getPosAuthorizationPayload,
  isPosAuthorizationExpired,
  POS_DEVICE_AUTH_SHARED_LINK,
  redeemBrowserPosAuthorization,
  getPosAuthorizationChallengeType,
} from '@/lib/browser-pos-authorization'

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

  const payload = getPosAuthorizationPayload(row.payloadSnapshot)
  if (isPosAuthorizationExpired(row.payloadSnapshot)) {
    return NextResponse.json({ status: 'EXPIRED' })
  }
  const isSharedLink = getPosAuthorizationChallengeType(row.payloadSnapshot) === POS_DEVICE_AUTH_SHARED_LINK
  const hasApproval = Boolean(payload.approvedAt || (row.status === 'SUCCESS' && row.userId && !payload.deliveredAt))
  if (!isSharedLink && hasApproval && !payload.browserPosDeviceId && !payload.deliveredAt) {
    const redeemed = await redeemBrowserPosAuthorization({
      requestId,
      deviceId,
      deviceName: payload.deviceName,
      browserInfo: req.headers.get('user-agent'),
    })
    if (redeemed.ok) {
      return NextResponse.json({
        status: 'APPROVED',
        token: redeemed.token,
        storeCode: redeemed.storeCode,
        storeName: redeemed.storeName,
        deviceName: redeemed.deviceName,
      })
    }
    if (redeemed.error === 'CHALLENGE_EXPIRED') return NextResponse.json({ status: 'EXPIRED' })
    if (redeemed.error !== 'CHALLENGE_USED') {
      return NextResponse.json({ error: redeemed.error }, { status: redeemed.status })
    }
  }
  if (row.status === 'SUCCESS' || payload.browserPosDeviceId || payload.deliveredAt) {
    return NextResponse.json({ status: 'APPROVED' })
  }
  if (hasApproval) {
    return NextResponse.json({
      status: 'APPROVED',
      storeCode: payload.storeCode,
      storeName: payload.storeName,
      deviceName: payload.deviceName,
    })
  }
  return NextResponse.json({ status: 'PENDING' })
}
