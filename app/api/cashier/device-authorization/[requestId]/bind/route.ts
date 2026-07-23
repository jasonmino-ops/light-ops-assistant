/**
 * POST /api/cashier/device-authorization/[requestId]/bind
 *
 * Public, capability-bound final step for an OWNER-shared browser link. The
 * requestId is a short-lived, one-time capability; it is not an account
 * session and this endpoint never returns or establishes OWNER access.
 */
import { NextRequest, NextResponse } from 'next/server'
import { redeemBrowserPosAuthorization } from '@/lib/browser-pos-authorization'

function validDeviceId(value: string) {
  return value.length >= 8 && value.length <= 200
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await params
  let body: { deviceId?: unknown; deviceName?: unknown }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })
  }
  const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : ''
  if (!validDeviceId(deviceId)) return NextResponse.json({ error: 'INVALID_DEVICE_ID' }, { status: 400 })

  const result = await redeemBrowserPosAuthorization({
    requestId,
    deviceId,
    deviceName: typeof body.deviceName === 'string' ? body.deviceName : null,
    browserInfo: req.headers.get('user-agent'),
  })
  if (!result.ok) {
    const message = result.error === 'CHALLENGE_EXPIRED'
      ? '分享链接已过期，请让老板重新生成。'
      : result.error === 'CHALLENGE_RECOVERY_NOT_READY'
        ? '绑定已完成，正在确认授权交付；请数秒后在本机重试本链接。'
      : result.error === 'CHALLENGE_USED'
        ? '分享链接已被使用，请让老板重新生成。'
        : result.error === 'ISSUER_UNAVAILABLE'
          ? '授权老板账号或门店权限已失效。'
          : '这台收银电脑暂时无法绑定。'
    return NextResponse.json({ error: result.error, message }, { status: result.status })
  }

  // Raw pos-device-v1 is intentionally returned only in this TLS response and
  // stored by the current browser; no OWNER cookie or session is issued here.
  return NextResponse.json({
    status: 'BOUND',
    token: result.token,
    storeCode: result.storeCode,
    storeName: result.storeName,
    deviceName: result.deviceName,
    tokenExpiresAt: result.expiresAt.toISOString(),
  })
}
