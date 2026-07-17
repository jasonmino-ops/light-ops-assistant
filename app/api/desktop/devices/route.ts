import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { serializeDesktopDevice } from '@/lib/desktop-activation/auth'
import { apiError, noStoreJson } from '@/lib/desktop-activation/http'

export async function GET(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return apiError('LOGIN_REQUIRED', 401)
  if (ctx.role !== 'OWNER') return apiError('OWNER_REQUIRED', 403)

  const storeId = req.nextUrl.searchParams.get('storeId')?.trim() || ''
  if (storeId) {
    const store = await prisma.store.findFirst({
      where: { id: storeId, tenantId: ctx.tenantId },
      select: { id: true },
    })
    if (!store) return apiError('STORE_NOT_FOUND', 404)
  }

  const devices = await prisma.desktopDevice.findMany({
    where: {
      tenantId: ctx.tenantId,
      ...(storeId ? { storeId } : {}),
    },
    select: {
      id: true,
      tenantId: true,
      storeId: true,
      status: true,
      tokenHashVersion: true,
      tokenIssuedAt: true,
      tokenExpiresAt: true,
      tokenLastUsedAt: true,
      lastSeenAt: true,
      activatedAt: true,
      revokedAt: true,
      revocationReason: true,
      replacesDeviceId: true,
      store: { select: { id: true, name: true, status: true } },
    },
    orderBy: [{ status: 'asc' }, { activatedAt: 'desc' }],
    take: 200,
  })

  return noStoreJson({
    devices: devices.map((device) => ({
      ...serializeDesktopDevice(device),
      store: device.store,
    })),
  })
}
