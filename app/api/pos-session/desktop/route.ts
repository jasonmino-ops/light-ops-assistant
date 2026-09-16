import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getDesktopDeviceContext } from '@/lib/desktop-activation/auth'
import { hashDesktopDeviceToken, isValidDesktopDeviceTokenFormat } from '@/lib/desktop-activation/crypto'
import { apiError, noStoreJson, withDesktopApiError } from '@/lib/desktop-activation/http'
import { issuePosDeviceSession } from '@/lib/desktop-pos-auth'

function bearerToken(req: NextRequest) {
  const value = req.headers.get('authorization')?.trim() ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(value)
  return match?.[1]?.trim() ?? ''
}

function browserDeviceIdForDesktop(deviceId: string) {
  return `desktop-${deviceId}`
}

export async function POST(req: NextRequest) {
  return withDesktopApiError(async () => {
    const verified = await getDesktopDeviceContext(req)
    if (!verified.ok) return apiError(verified.error, verified.status)

    const desktopToken = bearerToken(req)
    if (!isValidDesktopDeviceTokenFormat(desktopToken)) {
      return apiError('DESKTOP_DEVICE_UNAUTHORIZED', 401)
    }
    const tokenHash = hashDesktopDeviceToken(desktopToken)
    const now = new Date()

    const result = await prisma.$transaction(async (tx) => {
      // Serialize issuance with OWNER revocation. Whichever transaction runs
      // second must observe the first transaction's final device/session state.
      await tx.$queryRaw`SELECT "id" FROM "DesktopDevice" WHERE "id" = ${verified.context.deviceId} FOR UPDATE`

      const device = await tx.desktopDevice.findUnique({
        where: { id: verified.context.deviceId },
        include: {
          tenant: { select: { status: true } },
          store: { select: { code: true, name: true, status: true } },
        },
      })

      if (!device || device.tokenHash !== tokenHash) {
        return { ok: false as const, status: 401, error: 'DESKTOP_DEVICE_UNAUTHORIZED' }
      }
      if (
        device.tenantId !== verified.context.tenantId ||
        device.storeId !== verified.context.storeId ||
        device.tokenHashVersion !== verified.context.tokenHashVersion ||
        device.tokenVersion !== verified.context.tokenVersion
      ) {
        return { ok: false as const, status: 401, error: 'DESKTOP_DEVICE_UNAUTHORIZED' }
      }
      if (device.status !== 'ACTIVE' || device.activeSlot !== 'ACTIVE') {
        return { ok: false as const, status: 403, error: 'DESKTOP_DEVICE_REVOKED' }
      }
      if (device.tokenExpiresAt.getTime() <= now.getTime()) {
        return { ok: false as const, status: 401, error: 'DESKTOP_TOKEN_EXPIRED' }
      }
      if (device.tenant.status !== 'ACTIVE') {
        return { ok: false as const, status: 403, error: 'TENANT_INACTIVE' }
      }
      if (device.store.status !== 'ACTIVE') {
        return { ok: false as const, status: 403, error: 'STORE_INACTIVE' }
      }

      const browserDeviceId = browserDeviceIdForDesktop(device.id)
      const session = await issuePosDeviceSession(tx, {
        tenantId: device.tenantId,
        storeId: device.storeId,
        storeCode: device.store.code,
        browserDeviceId,
        issuedBy: 'DESKTOP_DEVICE',
        issuedByUserId: null,
        displayName: `${device.store.name} Desktop`,
      })

      return {
        ok: true as const,
        browserDeviceId,
        storeCode: device.store.code,
        token: session.token,
        expiresAt: session.expiresAt.toISOString(),
      }
    })

    if (!result.ok) return apiError(result.error, result.status)
    return noStoreJson(result)
  })
}
