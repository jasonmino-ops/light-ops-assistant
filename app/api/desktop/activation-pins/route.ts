import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { apiError, minimalDesktopSubscription, noStoreJson, withDesktopApiError } from '@/lib/desktop-activation/http'
import { issueDesktopActivationPin } from '@/lib/desktop-activation/pin-issuance'

type PinCreateBody = { storeId?: unknown }

export async function POST(req: NextRequest) {
  return withDesktopApiError(async () => {
    const ctx = await getContext(req)
    if (!ctx) return apiError('LOGIN_REQUIRED', 401)
    if (ctx.role !== 'OWNER') return apiError('OWNER_REQUIRED', 403)

    let body: PinCreateBody
    try {
      body = await req.json()
    } catch {
      return apiError('INVALID_JSON', 400)
    }

    const storeId = typeof body.storeId === 'string' ? body.storeId.trim() : ''
    if (!storeId) return apiError('MISSING_STORE_ID', 400)

    const store = await prisma.store.findFirst({
      where: { id: storeId, tenantId: ctx.tenantId },
      include: { tenant: { select: { status: true } } },
    })
    if (!store) return apiError('STORE_NOT_FOUND', 404)
    if (store.tenant.status !== 'ACTIVE') return apiError('TENANT_INACTIVE', 403)
    if (store.status !== 'ACTIVE') return apiError('STORE_INACTIVE', 403)

    const result = await issueDesktopActivationPin({
      req,
      store: { id: store.id, tenantId: store.tenantId },
      createdByUserId: ctx.userId,
    })

    if (!result.ok) {
      if (result.error === 'CONFLICT_RETRY_REQUIRED') return apiError('CONFLICT_RETRY_REQUIRED', 409)
      return apiError(result.error, result.status, {
        ...(result.subscription ? { subscription: minimalDesktopSubscription(result.subscription) } : {}),
      })
    }

    return noStoreJson({
      pinId: result.pinId,
      pin: result.pin,
      storeId: store.id,
      expiresAt: result.expiresAt,
      subscription: minimalDesktopSubscription(result.subscription),
    }, { status: 201 })
  })
}
