import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { auditRequestHashes, writeDesktopActivationAudit } from '@/lib/desktop-activation/audit'
import { apiError, noStoreJson, withDesktopApiError } from '@/lib/desktop-activation/http'

type RevokeBody = { reason?: unknown }

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withDesktopApiError(async () => {
    const ctx = await getContext(req)
    if (!ctx) return apiError('LOGIN_REQUIRED', 401)
    if (ctx.role !== 'OWNER') return apiError('OWNER_REQUIRED', 403)

    const { id } = await params
    if (!id) return apiError('DEVICE_NOT_FOUND', 404)

    let body: RevokeBody = {}
    try {
      body = await req.json()
    } catch {
      body = {}
    }

    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : null
    const requestHashes = auditRequestHashes(req)
    const now = new Date()

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "DesktopDevice" WHERE "id" = ${id} FOR UPDATE`
      const device = await tx.desktopDevice.findFirst({
        where: { id, tenantId: ctx.tenantId },
      })
      if (!device) return null
      if (device.status === 'REVOKED') return device

      const revoked = await tx.desktopDevice.update({
        where: { id: device.id },
        data: {
          status: 'REVOKED',
          activeSlot: null,
          revokedAt: now,
          revokedByUserId: ctx.userId,
          revocationReason: reason,
        },
      })

      await writeDesktopActivationAudit(tx, {
        tenantId: revoked.tenantId,
        storeId: revoked.storeId,
        deviceId: revoked.id,
        actorUserId: ctx.userId,
        eventType: 'DEVICE_REVOKED',
        result: 'SUCCESS',
        reasonCode: 'OWNER_REVOKED',
        ...requestHashes,
      })

      return revoked
    })

    if (!result) return apiError('DEVICE_NOT_FOUND', 404)

    return noStoreJson({
      ok: true,
      deviceId: result.id,
      status: result.status,
    })
  })
}
