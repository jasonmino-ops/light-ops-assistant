import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  isValidActivationPinFormat,
  isValidInstallationId,
} from '@/lib/desktop-activation/crypto'
import { apiError, minimalDesktopSubscription, noStoreJson, withDesktopApiError } from '@/lib/desktop-activation/http'
import { activateDesktopDevice } from '@/lib/desktop-activation/service'

type ActivateBody = {
  storeCode?: unknown
  pin?: unknown
  installationId?: unknown
}

export async function POST(req: NextRequest) {
  return withDesktopApiError(async () => {
    let body: ActivateBody
    try {
      body = await req.json()
    } catch {
      return apiError('INVALID_JSON', 400)
    }

    const storeCode = typeof body.storeCode === 'string' ? body.storeCode.trim() : ''
    const pin = typeof body.pin === 'string' ? body.pin.trim() : ''
    const installationId = typeof body.installationId === 'string' ? body.installationId.trim() : ''

    if (!storeCode || !isValidActivationPinFormat(pin) || !isValidInstallationId(installationId)) {
      return apiError('INVALID_REQUEST', 400)
    }

    const store = await prisma.store.findUnique({
      where: { code: storeCode },
      include: { tenant: { select: { status: true } } },
    })
    if (!store) return apiError('STORE_NOT_FOUND', 404)
    if (store.tenant.status !== 'ACTIVE') return apiError('TENANT_INACTIVE', 403)
    if (store.status !== 'ACTIVE') return apiError('STORE_INACTIVE', 403)

    const result = await activateDesktopDevice({
      req,
      store: { id: store.id, code: store.code, tenantId: store.tenantId },
      pin,
      installationId,
    })

    if (!result.ok) {
      return apiError(result.error, result.status, {
        ...(result.retryAfterSeconds ? { retryAfterSeconds: result.retryAfterSeconds } : {}),
        ...(result.subscription ? { subscription: minimalDesktopSubscription(result.subscription) } : {}),
      })
    }

    return noStoreJson({
      deviceToken: result.deviceToken,
      tokenExpiresAt: result.tokenExpiresAt,
      device: {
        deviceId: result.device.id,
        tenantId: result.device.tenantId,
        storeId: result.device.storeId,
        storeCode: store.code,
        status: result.device.status,
        tokenExpiresAt: result.tokenExpiresAt,
        credentialVersion: result.device.tokenVersion,
      },
      subscription: minimalDesktopSubscription(result.subscription),
    }, { status: 201 })
  })
}
