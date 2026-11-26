import { verifyPosDeviceToken } from './desktop-pos-auth'
import type { NextRequest, NextResponse } from 'next/server'

// This header carries committed business time only. Authorization remains with the device batch and V3 ledger.
export function withPrintOrigin(response: NextResponse, req: NextRequest, scope: { tenantId: string; storeId: string },
  orderNo: string | undefined, occurredAt: string | null | undefined, roles: readonly ('FRONT' | 'KITCHEN')[]): NextResponse {
  if (!response.ok || req.nextUrl.protocol !== 'https:' || req.headers.get('x-eshop-print-origin-version') !== '1' ||
      !orderNo || !/^[A-Za-z0-9._:-]{1,128}$/.test(orderNo) || !occurredAt || !Number.isFinite(Date.parse(occurredAt)) ||
      new Date(occurredAt).toISOString() !== occurredAt) return response
  if (!process.env.AUTH_SECRET?.trim() || process.env.AUTH_SECRET === 'dev-secret-change-in-production') return response
  const device = verifyPosDeviceToken(req.headers.get('x-pos-device-token') ?? '')
  if (!device || device.tenantId !== scope.tenantId || device.storeId !== scope.storeId || device.issuedBy !== 'DESKTOP_DEVICE' ||
      !device.browserPosSessionId || device.deviceId !== req.headers.get('x-pos-device-id') || !/^desktop-[A-Za-z0-9_-]+$/.test(device.deviceId)) return response
  const fact = { tenantId: scope.tenantId, storeId: scope.storeId, deviceId: device.deviceId.slice(8), orderNo, occurredAt, roles }
  response.headers.set('X-EShop-Print-Origin', Buffer.from(JSON.stringify(fact)).toString('base64url'))
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}
