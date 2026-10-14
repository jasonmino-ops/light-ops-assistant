import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { apiError, noStoreJson, withComputerClientApiError } from '@/lib/computer-client/http'
import { buildUnifiedTerminalView } from '@/lib/computer-client/unified-terminal'

/**
 * OWNER-only presentation view over the two intentionally separate terminal
 * identity models. This route never creates, merges, or mutates either model.
 */
export async function GET(_req: NextRequest) {
  return withComputerClientApiError(async () => {
    const ctx = await getContext(_req)
    if (!ctx) return apiError('LOGIN_REQUIRED', 401)
    if (ctx.role !== 'OWNER') return apiError('OWNER_REQUIRED', 403)

    const [desktopDevices, legacyBindings] = await Promise.all([
      prisma.desktopDevice.findMany({
        where: { tenantId: ctx.tenantId, storeId: ctx.storeId },
        select: {
          id: true,
          storeId: true,
          status: true,
          activeSlot: true,
          tokenExpiresAt: true,
          lastSeenAt: true,
          activatedAt: true,
        },
        orderBy: { activatedAt: 'desc' },
        take: 100,
      }),
      prisma.computerBinding.findMany({
        where: { tenantId: ctx.tenantId, storeId: ctx.storeId, status: 'APPROVED' },
        select: {
          id: true,
          storeId: true,
          computerName: true,
          agentVersion: true,
          credentialStatus: true,
          credentialExpiresAt: true,
          boundAt: true,
          lastSeenAt: true,
          disabledAt: true,
        },
        orderBy: { boundAt: 'desc' },
        take: 100,
      }),
    ])

    const posSessions = new Map<string, {
      status: 'ACTIVE' | 'REVOKED' | 'EXPIRED'
      activeSlot: string | null
      tokenExpiresAt: Date
      lastSeenAt: Date | null
    }>()
    if (desktopDevices.length > 0) {
      const sessions = await prisma.browserPosDevice.findMany({
        where: {
          tenantId: ctx.tenantId,
          storeId: ctx.storeId,
          browserDeviceId: { in: desktopDevices.map((device) => `desktop-${device.id}`) },
        },
        select: { browserDeviceId: true, status: true, activeSlot: true, tokenExpiresAt: true, lastSeenAt: true },
        orderBy: { activatedAt: 'desc' },
      })
      for (const session of sessions) {
        if (!posSessions.has(session.browserDeviceId)) posSessions.set(session.browserDeviceId, session)
      }
    }

    return noStoreJson({
      terminals: buildUnifiedTerminalView({
        now: new Date(),
        desktopDevices,
        legacyBindings,
        posSessions,
      }),
    })
  })
}
