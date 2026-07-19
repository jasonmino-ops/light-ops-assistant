import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkOpsAuthContext, hasOpsRole } from '@/lib/ops-auth'
import { DESKTOP_ACTIVATION_PIN_TTL_HOURS } from '@/lib/desktop-activation/crypto'
import { apiError, minimalDesktopSubscription, noStoreJson, withDesktopApiError } from '@/lib/desktop-activation/http'
import { issueDesktopActivationPin } from '@/lib/desktop-activation/pin-issuance'
import { computeDesktopSubscriptionAccess } from '@/lib/desktop-activation/subscription-access'

type IssueBody = { storeCode?: unknown }

const STORE_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/

function cleanStoreCode(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function isValidStoreCode(value: string) {
  return STORE_CODE_PATTERN.test(value)
}

async function requireOpsAdmin(req: NextRequest) {
  const ops = await checkOpsAuthContext(req)
  if (!ops) return { ok: false as const, response: apiError('FORBIDDEN', 403) }
  if (!hasOpsRole(ops.role, 'OPS_ADMIN')) {
    return { ok: false as const, response: apiError('OPS_ADMIN_REQUIRED', 403) }
  }
  return { ok: true as const, ops }
}

async function findStoreByCode(storeCode: string) {
  return prisma.store.findUnique({
    where: { code: storeCode },
    select: {
      id: true,
      tenantId: true,
      code: true,
      name: true,
      status: true,
      tenant: {
        select: {
          id: true,
          name: true,
          status: true,
          tier: true,
          subscription: {
            select: {
              status: true,
              trialEndsAt: true,
              currentPeriodEndsAt: true,
            },
          },
        },
      },
    },
  })
}

function serializeStoreStatus(store: Awaited<ReturnType<typeof findStoreByCode>>, activePin: {
  id: string
  status: string
  expiresAt: Date
  lockedUntil: Date | null
  failedAttempts: number
  createdAt: Date
} | null) {
  if (!store) return null

  const subscription = computeDesktopSubscriptionAccess(store.tenant.subscription?.status ?? 'ACTIVE')
  const now = Date.now()
  const activePinExpired = activePin ? activePin.expiresAt.getTime() <= now : false

  return {
    store: {
      id: store.id,
      code: store.code,
      name: store.name,
      status: store.status,
    },
    tenant: {
      id: store.tenant.id,
      name: store.tenant.name,
      status: store.tenant.status,
      tier: store.tenant.tier,
    },
    subscription: {
      ...minimalDesktopSubscription(subscription),
      trialEndsAt: store.tenant.subscription?.trialEndsAt?.toISOString() ?? null,
      currentPeriodEndsAt: store.tenant.subscription?.currentPeriodEndsAt?.toISOString() ?? null,
    },
    activePin: activePin ? {
      pinId: activePin.id,
      status: activePinExpired ? 'EXPIRED' : activePin.status,
      hasValidPin: activePin.status === 'ACTIVE' && !activePinExpired,
      expiresAt: activePin.expiresAt.toISOString(),
      lockedUntil: activePin.lockedUntil?.toISOString() ?? null,
      failedAttempts: activePin.failedAttempts,
      createdAt: activePin.createdAt.toISOString(),
    } : null,
    pinTtlHours: DESKTOP_ACTIVATION_PIN_TTL_HOURS,
  }
}

export async function GET(req: NextRequest) {
  return withDesktopApiError(async () => {
    const auth = await requireOpsAdmin(req)
    if (!auth.ok) return auth.response

    const storeCode = cleanStoreCode(req.nextUrl.searchParams.get('storeCode'))
    if (!storeCode) return apiError('MISSING_STORE_CODE', 400)
    if (!isValidStoreCode(storeCode)) return apiError('INVALID_STORE_CODE', 400)

    const store = await findStoreByCode(storeCode)
    if (!store) return apiError('STORE_NOT_FOUND', 404)

    const activePin = await prisma.desktopActivationPin.findFirst({
      where: { storeId: store.id, activeSlot: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        expiresAt: true,
        lockedUntil: true,
        failedAttempts: true,
        createdAt: true,
      },
    })

    return noStoreJson(serializeStoreStatus(store, activePin))
  })
}

export async function POST(req: NextRequest) {
  return withDesktopApiError(async () => {
    const auth = await requireOpsAdmin(req)
    if (!auth.ok) return auth.response

    let body: IssueBody
    try {
      body = await req.json()
    } catch {
      return apiError('INVALID_JSON', 400)
    }

    const storeCode = cleanStoreCode(body.storeCode)
    if (!storeCode) return apiError('MISSING_STORE_CODE', 400)
    if (!isValidStoreCode(storeCode)) return apiError('INVALID_STORE_CODE', 400)

    const store = await findStoreByCode(storeCode)
    if (!store) return apiError('STORE_NOT_FOUND', 404)
    if (store.tenant.status !== 'ACTIVE') return apiError('TENANT_INACTIVE', 403)
    if (store.status !== 'ACTIVE') return apiError('STORE_INACTIVE', 403)

    const result = await issueDesktopActivationPin({
      req,
      store: { id: store.id, tenantId: store.tenantId },
      createdByUserId: null,
      createdByOpsAdminId: auth.ops.userId,
      actorUserId: null,
      actorOpsAdminId: auth.ops.userId,
      auditReasonCode: 'OPS_ISSUED',
      auditMetadata: {
        operatorRole: auth.ops.role,
        issuanceSource: 'OPS_CONSOLE',
      },
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
      expiresAt: result.expiresAt,
      pinTtlHours: DESKTOP_ACTIVATION_PIN_TTL_HOURS,
      replacedActivePin: result.replacedActivePin,
      store: {
        id: store.id,
        code: store.code,
        name: store.name,
        status: store.status,
      },
      tenant: {
        id: store.tenant.id,
        name: store.tenant.name,
        status: store.tenant.status,
        tier: store.tenant.tier,
      },
      subscription: minimalDesktopSubscription(result.subscription),
    }, { status: 201 })
  })
}
