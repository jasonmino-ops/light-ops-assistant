import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  authorizeDesktopPosAccount,
  verifyPosDeviceRequest,
} from '@/lib/desktop-pos-auth'
import { getContext } from '@/lib/context'

export async function GET(req: NextRequest) {
  const storeCode = req.nextUrl.searchParams.get('storeCode')?.trim()
  if (!storeCode) return NextResponse.json({ error: 'MISSING_STORE_CODE' }, { status: 400 })

  const store = await prisma.store.findUnique({
    where: { code: storeCode },
    select: { id: true, code: true, tenantId: true, status: true, name: true },
  })
  if (!store || store.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })
  }

  const expectedStore = {
    tenantId: store.tenantId,
    storeId: store.id,
    storeCode: store.code,
  }
  const ctx = await getContext(req)
  const accountAuth = ctx
    ? await authorizeDesktopPosAccount(req, expectedStore)
    : null
  const deviceAuth = await verifyPosDeviceRequest(req, expectedStore)

  if (!accountAuth && !deviceAuth && !ctx) {
    return NextResponse.json(
      { error: 'LOGIN_REQUIRED', message: '请先登录本店老板或员工账号后再进入收银台。' },
      { status: 401 },
    )
  }
  if (!accountAuth && !deviceAuth) {
    return NextResponse.json(
      { error: 'FORBIDDEN', message: '当前账号没有进入这家门店收银台的权限。' },
      { status: 403 },
    )
  }

  let qzRawCanary = false
  if (
    process.env.QZ_RAW_CANARY_ENABLED === '1' &&
    deviceAuth?.browserPosSessionId
  ) {
    // Only prove at page load that this valid Browser POS Session originated
    // from a Computer Launch Ticket. Business APIs do not read the binding.
    const computerLaunch = await prisma.computerBrowserLaunchTicket.findFirst({
      where: {
        browserPosDeviceId: deviceAuth.browserPosSessionId,
        binding: {
          tenantId: store.tenantId,
          storeId: store.id,
        },
      },
      select: { id: true },
    })
    qzRawCanary = Boolean(computerLaunch)
  }

  return NextResponse.json({
    ok: true,
    role: accountAuth?.role ?? 'OWNER',
    storeName: store.name,
    storeCode: store.code,
    qzRawCanary,
  }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
