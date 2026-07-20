import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkOpsAuthContext, getFkBackedOpsAdminIdentity, hasOpsRole } from '@/lib/ops-auth'
import { auditRequestHashes, writeDesktopActivationAudit } from '@/lib/desktop-activation/audit'
import { apiError, noStoreJson, withDesktopApiError } from '@/lib/desktop-activation/http'
import { shortDeviceReference } from '@/lib/ops-desktop-management'

type RevokeBody = { reason?: unknown }

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withDesktopApiError(async () => {
    const ops = await checkOpsAuthContext(req)
    if (!ops) return apiError('FORBIDDEN', 403)
    if (!hasOpsRole(ops.role, 'OPS_ADMIN')) return apiError('OPS_ADMIN_REQUIRED', 403)

    const actor = await getFkBackedOpsAdminIdentity(req, ops)
    if (!actor) return apiError('OPS_ADMIN_IDENTITY_REQUIRED', 403)

    const { id: rawDeviceRef } = await params
    const deviceRef = rawDeviceRef.trim().toLowerCase()
    if (!/^[a-z0-9]{8}$/.test(deviceRef)) return apiError('DEVICE_NOT_FOUND', 404)

    let body: RevokeBody
    try {
      body = await req.json()
    } catch {
      return apiError('INVALID_JSON', 400)
    }
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : ''
    if (reason.length < 3) return apiError('REVOCATION_REASON_REQUIRED', 400)

    const now = new Date()
    const requestHashes = auditRequestHashes(req)
    const deviceMatches = await prisma.desktopDevice.findMany({
      where: { id: { endsWith: deviceRef } },
      select: { id: true },
      take: 2,
    })
    if (deviceMatches.length === 0) return apiError('DEVICE_NOT_FOUND', 404)
    if (deviceMatches.length > 1) return apiError('DEVICE_REFERENCE_AMBIGUOUS', 409)
    const deviceId = deviceMatches[0].id

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "DesktopDevice" WHERE "id" = ${deviceId} FOR UPDATE`
      const device = await tx.desktopDevice.findUnique({
        where: { id: deviceId },
        select: { id: true, tenantId: true, storeId: true, status: true },
      })
      if (!device) return null
      if (device.status === 'REVOKED') return device

      const revoked = await tx.desktopDevice.update({
        where: { id: device.id },
        data: {
          status: 'REVOKED',
          activeSlot: null,
          revokedAt: now,
          revocationReason: reason,
        },
        select: { id: true, tenantId: true, storeId: true, status: true },
      })

      await writeDesktopActivationAudit(tx, {
        tenantId: revoked.tenantId,
        storeId: revoked.storeId,
        deviceId: revoked.id,
        actorOpsAdminId: actor.id,
        eventType: 'DEVICE_REVOKED',
        result: 'SUCCESS',
        reasonCode: 'OPS_REVOKED',
        metadata: { operatorRole: actor.role },
        ...requestHashes,
      })
      return revoked
    })

    if (!result) return apiError('DEVICE_NOT_FOUND', 404)
    return noStoreJson({
      ok: true,
      deviceRef: shortDeviceReference(result.id),
      status: result.status,
    })
  })
}
