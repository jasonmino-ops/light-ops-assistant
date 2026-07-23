/**
 * GET/POST /api/cashier/device-authorization/[requestId]
 *
 * Owner phone confirmation for a desktop POS authorization request.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import {
  approveBrowserPosAuthorization,
  getPosAuthorizationChallengeType,
  getPosAuthorizationPayload,
  isPosAuthorizationExpired,
  POS_DEVICE_AUTH_SHARED_LINK,
} from '@/lib/browser-pos-authorization'

async function findRequest(requestId: string) {
  return prisma.operationLog.findFirst({
    where: {
      requestId,
      actionType: 'POS_DEVICE_AUTH_REQUEST',
      targetType: 'POS_DEVICE',
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      tenantId: true,
      storeId: true,
      targetId: true,
      userId: true,
      status: true,
      payloadSnapshot: true,
    },
  })
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await params
  const row = await findRequest(requestId)
  if (!row) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  const payload = getPosAuthorizationPayload(row.payloadSnapshot)
  const sharedLink = getPosAuthorizationChallengeType(row.payloadSnapshot) === POS_DEVICE_AUTH_SHARED_LINK
  const expired = isPosAuthorizationExpired(row.payloadSnapshot)
  const bound = Boolean(payload.browserPosDeviceId || (row.status === 'SUCCESS' && payload.deliveredAt))
  const approved = !sharedLink && Boolean(payload.approvedAt || (row.status === 'SUCCESS' && row.userId && !bound))
  return NextResponse.json({
    requestId,
    status: expired ? 'EXPIRED' : bound ? 'USED' : approved ? 'APPROVED' : 'PENDING',
    flow: sharedLink ? 'SHARED_LINK' : 'OWNER_QR',
    storeName: payload.storeName ?? '',
    storeCode: payload.storeCode ?? '',
    deviceName: payload.deviceName ?? '前台收银机',
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const ctx = await getContext(req)
  if (!ctx) {
    return NextResponse.json({ error: 'LOGIN_REQUIRED', message: '请先用老板账号登录后再授权。' }, { status: 401 })
  }
  if (ctx.role !== 'OWNER') {
    return NextResponse.json({ error: 'OWNER_REQUIRED', message: '只有老板可以授权这台收银机。' }, { status: 403 })
  }

  const { requestId } = await params
  let body: { deviceName?: string }
  try { body = await req.json() } catch { body = {} }
  const result = await approveBrowserPosAuthorization({
    requestId,
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    deviceName: typeof body.deviceName === 'string' ? body.deviceName : null,
  })
  if (!result.ok) {
    const message = result.error === 'CHALLENGE_EXPIRED'
      ? '授权二维码已过期，请在电脑上刷新后重新扫码。'
      : result.error === 'CHALLENGE_TYPE_INVALID'
        ? '该链接由老板直接分享，请在收银电脑上打开后绑定。'
        : result.error === 'ISSUER_UNAVAILABLE'
          ? '老板账号或门店权限已失效，无法完成授权。'
          : '授权请求无效或已使用，请在电脑上重新发起。'
    return NextResponse.json({ error: result.error, message }, { status: result.status })
  }

  // The raw token is deliberately not persisted. The original requesting browser
  // consumes this approved challenge atomically with its BrowserPosDevice bind.
  return NextResponse.json({ status: 'APPROVED', storeName: result.storeName, deviceName: result.deviceName })
}
