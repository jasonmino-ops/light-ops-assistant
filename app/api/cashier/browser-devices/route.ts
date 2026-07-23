import { NextRequest, NextResponse } from 'next/server'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/prisma'
import { createBrowserPosSharedLink } from '@/lib/browser-pos-authorization'

async function ownerContext(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return { ok: false as const, response: NextResponse.json({ error: 'LOGIN_REQUIRED' }, { status: 401 }) }
  if (ctx.role !== 'OWNER') return { ok: false as const, response: NextResponse.json({ error: 'OWNER_REQUIRED' }, { status: 403 }) }
  return { ok: true as const, ctx }
}

export async function GET(req: NextRequest) {
  const auth = await ownerContext(req)
  if (!auth.ok) return auth.response
  const devices = await prisma.browserPosDevice.findMany({
    where: { tenantId: auth.ctx.tenantId },
    include: { store: { select: { code: true, name: true } } },
    orderBy: [{ status: 'asc' }, { lastSeenAt: 'desc' }],
  })
  return NextResponse.json({
    devices: devices.map((device) => ({
      id: device.id,
      storeCode: device.store.code,
      storeName: device.store.name,
      browserDeviceId: device.browserDeviceId,
      displayName: device.displayName,
      browserInfo: device.browserInfo,
      status: device.status,
      activatedAt: device.activatedAt.toISOString(),
      lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
      revokedAt: device.revokedAt?.toISOString() ?? null,
      tokenExpiresAt: device.tokenExpiresAt.toISOString(),
    })),
  })
}

export async function POST(req: NextRequest) {
  const auth = await ownerContext(req)
  if (!auth.ok) return auth.response
  let body: { storeCode?: unknown } = {}
  try { body = await req.json() } catch {}
  const requestedStoreCode = typeof body.storeCode === 'string' ? body.storeCode.trim() : ''
  const store = await prisma.store.findFirst({
    where: {
      tenantId: auth.ctx.tenantId,
      status: 'ACTIVE',
      ...(requestedStoreCode ? { code: requestedStoreCode } : { id: auth.ctx.storeId }),
    },
    select: { id: true, tenantId: true, code: true, name: true },
  })
  if (!store) return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })
  const ownerRole = await prisma.userStoreRole.findFirst({
    where: {
      tenantId: store.tenantId,
      storeId: store.id,
      userId: auth.ctx.userId,
      role: 'OWNER',
      status: 'ACTIVE',
      user: { status: 'ACTIVE' },
    },
    select: { id: true },
  })
  if (!ownerRole) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const shared = await createBrowserPosSharedLink({
    tenantId: store.tenantId,
    storeId: store.id,
    storeCode: store.code,
    storeName: store.name,
    issuedByUserId: auth.ctx.userId,
  })
  const shareUrl = `${req.nextUrl.origin}/cashier/authorize?requestId=${encodeURIComponent(shared.requestId)}`
  return NextResponse.json({
    requestId: shared.requestId,
    shareUrl,
    expiresAt: shared.expiresAt.toISOString(),
    storeCode: store.code,
    storeName: store.name,
  }, { status: 201 })
}
