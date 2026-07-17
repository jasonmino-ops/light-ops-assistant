import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { apiError, noStoreJson, withDesktopApiError } from '@/lib/desktop-activation/http'

export async function GET(req: NextRequest) {
  return withDesktopApiError(async () => {
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
        tokenVersion: true,
        tokenExpiresAt: true,
        lastSeenAt: true,
        activatedAt: true,
        revokedAt: true,
        store: { select: { code: true } },
      },
      orderBy: [{ status: 'asc' }, { activatedAt: 'desc' }],
      take: 200,
    })

    return noStoreJson({
      devices: devices.map((device) => ({
        deviceId: device.id,
        tenantId: device.tenantId,
        storeId: device.storeId,
        storeCode: device.store.code,
        status: device.status,
        tokenExpiresAt: device.tokenExpiresAt.toISOString(),
        credentialVersion: device.tokenVersion,
        lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
        activatedAt: device.activatedAt.toISOString(),
        revokedAt: device.revokedAt?.toISOString() ?? null,
      })),
    })
  })
}
