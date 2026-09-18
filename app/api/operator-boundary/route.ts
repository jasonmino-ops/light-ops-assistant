import { NextRequest, NextResponse } from 'next/server'
import {
  authorizeDesktopPosAccount,
  authorizeDesktopPosRequest,
  getDesktopOperatorSource,
  isDesktopOperatorBoundaryEnabled,
  verifyPosDeviceRequest,
} from '@/lib/desktop-pos-auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const storeCode = req.nextUrl.searchParams.get('storeCode')?.trim()
  if (!storeCode) return NextResponse.json({ error: 'MISSING_STORE_CODE' }, { status: 400 })

  if (req.headers.get('x-lightops-client') !== 'desktop-pos') {
    return NextResponse.json({ enabled: false }, { headers: { 'Cache-Control': 'no-store' } })
  }

  const store = await prisma.store.findUnique({
    where: { code: storeCode },
    select: { id: true, code: true, tenantId: true, status: true },
  })
  if (!store || store.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })
  }

  const expected = {
    tenantId: store.tenantId,
    storeId: store.id,
    storeCode: store.code,
  }
  if (!isDesktopOperatorBoundaryEnabled()) {
    return NextResponse.json({ enabled: false }, { headers: { 'Cache-Control': 'no-store' } })
  }

  const [accountAuth, deviceAuth, activeAuth] = await Promise.all([
    authorizeDesktopPosAccount(req, expected, { ignoreOperatorBoundary: true }),
    verifyPosDeviceRequest(req, expected, { ignoreOperatorBoundary: true }),
    authorizeDesktopPosRequest(req, expected, { allowStoreCodeFallback: false }),
  ])

  return NextResponse.json({
    enabled: true,
    selectedSource: getDesktopOperatorSource(req) ?? 'DEVICE',
    deviceAvailable: Boolean(deviceAuth),
    account: accountAuth ? { role: accountAuth.role } : null,
    active: activeAuth ? { source: activeAuth.source, role: activeAuth.role } : null,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
