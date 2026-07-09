import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authorizeDesktopPosAccount } from '@/lib/desktop-pos-auth'
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

  const ctx = await getContext(req)
  if (!ctx) {
    return NextResponse.json(
      { error: 'LOGIN_REQUIRED', message: '请先登录本店老板或员工账号后再进入收银台。' },
      { status: 401 },
    )
  }

  const auth = await authorizeDesktopPosAccount(req, {
    tenantId: store.tenantId,
    storeId: store.id,
    storeCode: store.code,
  })
  if (!auth) {
    return NextResponse.json(
      { error: 'FORBIDDEN', message: '当前账号没有进入这家门店收银台的权限。' },
      { status: 403 },
    )
  }

  return NextResponse.json({
    ok: true,
    role: auth.role,
    storeName: store.name,
    storeCode: store.code,
  })
}
