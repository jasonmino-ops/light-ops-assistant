import { NextRequest, NextResponse } from 'next/server'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/prisma'
import { createBrowserPosSharedLink } from '@/lib/browser-pos-authorization'

async function ownerContext(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return { ok: false as const, response: NextResponse.json({ error: 'LOGIN_REQUIRED' }, { status: 401 }) }
  if (ctx.role !== 'OWNER') return { ok: false as const, response: NextResponse.json({ error: 'OWNER_REQUIRED' }, { status: 403 }) }
  const membership = await prisma.userStoreRole.findFirst({
    where: {
      tenantId: ctx.tenantId,
      storeId: ctx.storeId,
      userId: ctx.userId,
      role: 'OWNER',
      status: 'ACTIVE',
      user: { status: 'ACTIVE' },
      store: { tenantId: ctx.tenantId, status: 'ACTIVE' },
    },
    select: {
      store: { select: { id: true, tenantId: true, code: true, name: true } },
    },
  })
  if (!membership) return { ok: false as const, response: NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 }) }
  return { ok: true as const, ctx, store: membership.store }
}

export async function GET(req: NextRequest) {
  const auth = await ownerContext(req)
  if (!auth.ok) return auth.response
  const devices = await prisma.browserPosDevice.findMany({
    where: { tenantId: auth.ctx.tenantId, storeId: auth.store.id },
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
  if (requestedStoreCode && requestedStoreCode !== auth.store.code) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  const shared = await createBrowserPosSharedLink({
    tenantId: auth.store.tenantId,
    storeId: auth.store.id,
    storeCode: auth.store.code,
    storeName: auth.store.name,
    issuedByUserId: auth.ctx.userId,
  })
  const shareUrl = `${req.nextUrl.origin}/cashier/authorize?requestId=${encodeURIComponent(shared.requestId)}`
  return NextResponse.json({
    requestId: shared.requestId,
    shareUrl,
    expiresAt: shared.expiresAt.toISOString(),
    storeCode: auth.store.code,
    storeName: auth.store.name,
  }, { status: 201 })
}
