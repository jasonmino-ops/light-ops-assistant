import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { auditRequestHashes, writeDesktopActivationAudit } from '@/lib/desktop-activation/audit'
import {
  DesktopSecretError,
  DESKTOP_ACTIVATION_PIN_HASH_VERSION,
  assertDesktopActivationSecretsConfigured,
  createActivationPin,
  getActivationPinExpiresAt,
  hashActivationPin,
} from '@/lib/desktop-activation/crypto'
import { apiError, noStoreJson } from '@/lib/desktop-activation/http'
import {
  isDesktopSubscriptionAllowed,
  resolveDesktopSubscriptionAccess,
} from '@/lib/desktop-activation/subscription-access'

type PinCreateBody = { storeId?: unknown }

export async function POST(req: NextRequest) {
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

  const pin = createActivationPin()
  const now = new Date()
  const expiresAt = getActivationPinExpiresAt(now)
  let pinHash: string
  try {
    assertDesktopActivationSecretsConfigured()
    pinHash = hashActivationPin({ tenantId: store.tenantId, storeId: store.id, pin })
  } catch (error) {
    if (error instanceof DesktopSecretError) return apiError(error.code, 503)
    throw error
  }

  const requestHashes = auditRequestHashes(req)
  const result = await prisma.$transaction(async (tx) => {
    const subscription = await resolveDesktopSubscriptionAccess(tx, store.tenantId)
    if (!isDesktopSubscriptionAllowed(subscription)) {
      await writeDesktopActivationAudit(tx, {
        tenantId: store.tenantId,
        storeId: store.id,
        actorUserId: ctx.userId,
        eventType: 'PIN_CREATE_DENIED',
        result: 'DENIED',
        reasonCode: 'SUBSCRIPTION_BLOCKED',
        ...requestHashes,
        metadata: { accessState: subscription.accessState, status: subscription.status },
      })
      return { ok: false as const, subscription }
    }

    await tx.desktopActivationPin.updateMany({
      where: { storeId: store.id, activeSlot: 'ACTIVE' },
      data: { status: 'REVOKED', activeSlot: null, revokedAt: now },
    })

    const row = await tx.desktopActivationPin.create({
      data: {
        tenantId: store.tenantId,
        storeId: store.id,
        pinHash,
        pinHashVersion: DESKTOP_ACTIVATION_PIN_HASH_VERSION,
        status: 'ACTIVE',
        activeSlot: 'ACTIVE',
        expiresAt,
        createdByUserId: ctx.userId,
      },
    })

    await writeDesktopActivationAudit(tx, {
      tenantId: store.tenantId,
      storeId: store.id,
      pinId: row.id,
      actorUserId: ctx.userId,
      eventType: 'PIN_CREATED',
      result: 'SUCCESS',
      ...requestHashes,
      metadata: {
        expiresAt: row.expiresAt.toISOString(),
        accessState: subscription.accessState,
        status: subscription.status,
      },
    })

    return { ok: true as const, row, subscription }
  })

  if (!result.ok) {
    return apiError('SUBSCRIPTION_BLOCKED', 403, { subscription: result.subscription })
  }

  return noStoreJson({
    pinId: result.row.id,
    pin,
    storeId: store.id,
    expiresAt: result.row.expiresAt.toISOString(),
    subscription: result.subscription,
  }, { status: 201 })
}
