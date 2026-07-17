import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { auditRequestHashes, writeDesktopActivationAudit } from '@/lib/desktop-activation/audit'
import { apiError, noStoreJson, withDesktopApiError } from '@/lib/desktop-activation/http'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withDesktopApiError(async () => {
    const ctx = await getContext(req)
    if (!ctx) return apiError('LOGIN_REQUIRED', 401)
    if (ctx.role !== 'OWNER') return apiError('OWNER_REQUIRED', 403)

    const { id } = await params
    if (!id) return apiError('PIN_NOT_FOUND', 404)

    const requestHashes = auditRequestHashes(req)
    const now = new Date()

    const result = await prisma.$transaction(async (tx) => {
      const pin = await tx.desktopActivationPin.findFirst({
        where: { id, tenantId: ctx.tenantId },
      })
      if (!pin) return null

      if (pin.status !== 'ACTIVE' || pin.activeSlot !== 'ACTIVE') return pin

      const revoked = await tx.desktopActivationPin.update({
        where: { id: pin.id },
        data: {
          status: 'REVOKED',
          activeSlot: null,
          revokedAt: now,
        },
      })

      await writeDesktopActivationAudit(tx, {
        tenantId: revoked.tenantId,
        storeId: revoked.storeId,
        pinId: revoked.id,
        actorUserId: ctx.userId,
        eventType: 'PIN_REVOKED',
        result: 'SUCCESS',
        reasonCode: 'OWNER_REVOKED',
        ...requestHashes,
      })

      return revoked
    })

    if (!result) return apiError('PIN_NOT_FOUND', 404)

    return noStoreJson({
      ok: true,
      pinId: result.id,
    })
  })
}
