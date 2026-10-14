import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiError, noStoreJson, withDesktopApiError } from '@/lib/desktop-activation/http'
import { authenticateDeviceRelayPrincipal } from '@/lib/es-tray-relay/device-auth'
import { createComputerBindingAudit } from '@/lib/computer-client/audit'
import {
  isValidDeviceSecretFormat,
  isValidInstallationId,
} from '@/lib/computer-client/crypto'
import { provisionManagedPrintChild } from '@/lib/computer-client/service'

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/**
 * Provision or recover the single hidden print-only child for a verified
 * DesktopDevice-derived POS session. The POS session is only a bounded
 * server-issued proof; tenant/store authority comes from the server-side
 * DesktopDevice resolution in authenticateDeviceRelayPrincipal.
 */
export async function POST(req: NextRequest) {
  return withDesktopApiError(async () => {
    const auth = await authenticateDeviceRelayPrincipal(req, new Date(), { allowDesktopDerivedSession: true })
    if (!auth.ok) return apiError(auth.error, auth.status)
    const context = auth.context
    if (context.principal !== 'DESKTOP_POS_DEVICE' || !context.enabled) {
      return apiError('DESKTOP_DEVICE_PRINT_CHILD_UNAVAILABLE', 403)
    }

    const body = object(await req.json().catch(() => null))
    const installationId = typeof body?.installationId === 'string' ? body.installationId.trim() : ''
    const deviceSecret = typeof body?.deviceSecret === 'string' ? body.deviceSecret.trim() : ''
    const agentVersion = typeof body?.agentVersion === 'string' ? body.agentVersion.trim().slice(0, 80) : null
    if (!isValidInstallationId(installationId) || !isValidDeviceSecretFormat(deviceSecret)) {
      return apiError('PRINT_CHILD_CREDENTIAL_INVALID', 400)
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "DesktopDevice" WHERE "id" = ${context.desktopDeviceId} FOR UPDATE`
      const parent = await tx.desktopDevice.findUnique({
        where: { id: context.desktopDeviceId },
        select: {
          id: true, tenantId: true, storeId: true, status: true, activeSlot: true,
          tokenExpiresAt: true,
        },
      })
      if (
        !parent
        || parent.id !== context.desktopDeviceId
        || parent.tenantId !== context.tenantId
        || parent.storeId !== context.storeId
        || parent.status !== 'ACTIVE'
        || parent.activeSlot !== 'ACTIVE'
        || parent.tokenExpiresAt.getTime() <= Date.now()
      ) {
        return { ok: false as const, status: 403, error: 'DESKTOP_DEVICE_PRINT_CHILD_UNAVAILABLE' }
      }

      try {
        const child = await provisionManagedPrintChild({
          parentDesktopDeviceId: parent.id,
          tenantId: parent.tenantId,
          storeId: parent.storeId,
          tokenExpiresAt: parent.tokenExpiresAt,
          installationId,
          deviceSecret,
          agentVersion,
        }, tx)
        await createComputerBindingAudit(tx, {
          tenantId: parent.tenantId,
          storeId: parent.storeId,
          bindingId: child.childId,
          eventType: 'DESKTOP_PRINT_CHILD_PROVISION',
          result: 'SUCCESS',
          reasonCode: child.idempotent ? 'IDEMPOTENT_RECOVERY' : 'CREATED',
          metadata: {
            status: 'APPROVED',
            credentialStatus: 'ACTIVE',
            reason: 'DESKTOP_DEVICE_OWNED_PRINT_ONLY',
            idempotent: child.idempotent,
            expiresAt: child.credentialExpiresAt.toISOString(),
          },
        })
        return { ok: true as const, child }
      } catch (error) {
        const code = error instanceof Error ? error.message : 'PRINT_CHILD_PROVISION_FAILED'
        if (code === 'PRINT_CHILD_IDENTITY_CONFLICT' || code === 'PRINT_CHILD_ALREADY_PROVISIONED') {
          return { ok: false as const, status: 409, error: code }
        }
        throw error
      }
    })

    if (!result.ok) return apiError(result.error, result.status)
    return noStoreJson({
      ok: true,
      childId: result.child.childId,
      storeCode: result.child.storeCode,
      credentialExpiresAt: result.child.credentialExpiresAt.toISOString(),
      idempotent: result.child.idempotent,
    })
  })
}
