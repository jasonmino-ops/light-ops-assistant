import { Prisma } from '@prisma/client'
import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { auditRequestHashes, writeDesktopActivationAudit } from './audit'
import {
  DESKTOP_ACTIVATION_PIN_HASH_VERSION,
  DesktopSecretError,
  assertDesktopActivationSecretsConfigured,
  createActivationPin,
  getActivationPinExpiresAt,
  hashActivationPin,
} from './crypto'
import {
  isDesktopSubscriptionAllowed,
  resolveDesktopSubscriptionAccess,
  type DesktopSubscriptionAccess,
} from './subscription-access'

export type DesktopActivationPinIssueStore = {
  id: string
  tenantId: string
}

export type DesktopActivationPinIssueSuccess = {
  ok: true
  pinId: string
  pin: string
  storeId: string
  expiresAt: string
  subscription: DesktopSubscriptionAccess
  replacedActivePin: boolean
}

export type DesktopActivationPinIssueFailure = {
  ok: false
  status: number
  error: string
  subscription?: DesktopSubscriptionAccess
}

export type DesktopActivationPinIssueResult =
  | DesktopActivationPinIssueSuccess
  | DesktopActivationPinIssueFailure

export type DesktopActivationPinIssueInput = {
  req: NextRequest
  store: DesktopActivationPinIssueStore
  createdByUserId: string
  auditActorUserId?: string | null
  auditReasonCode?: string | null
  auditMetadata?: {
    reason?: string
    eventVersion?: string
  }
}

function isP2002(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function failure(
  status: number,
  error: string,
  extra?: Omit<DesktopActivationPinIssueFailure, 'ok' | 'status' | 'error'>,
): DesktopActivationPinIssueFailure {
  return { ok: false, status, error, ...(extra ?? {}) }
}

export async function issueDesktopActivationPin(
  input: DesktopActivationPinIssueInput,
): Promise<DesktopActivationPinIssueResult> {
  const pin = createActivationPin()
  const now = new Date()
  const expiresAt = getActivationPinExpiresAt(now)
  let pinHash: string

  try {
    assertDesktopActivationSecretsConfigured()
    pinHash = hashActivationPin({ tenantId: input.store.tenantId, storeId: input.store.id, pin })
  } catch (error) {
    if (error instanceof DesktopSecretError) return failure(503, error.code)
    throw error
  }

  const requestHashes = auditRequestHashes(input.req)
  const actorUserId = input.auditActorUserId === undefined ? input.createdByUserId : input.auditActorUserId

  const result = await prisma.$transaction(async (tx) => {
    const subscription = await resolveDesktopSubscriptionAccess(tx, input.store.tenantId)
    if (!isDesktopSubscriptionAllowed(subscription)) {
      await writeDesktopActivationAudit(tx, {
        tenantId: input.store.tenantId,
        storeId: input.store.id,
        actorUserId,
        eventType: 'PIN_CREATE_DENIED',
        result: 'DENIED',
        reasonCode: 'SUBSCRIPTION_BLOCKED',
        ...requestHashes,
        metadata: { accessState: subscription.accessState, status: subscription.status },
      })
      return { ok: false as const, subscription }
    }

    const existingActivePin = await tx.desktopActivationPin.findFirst({
      where: { storeId: input.store.id, activeSlot: 'ACTIVE' },
      select: { id: true },
    })

    await tx.desktopActivationPin.updateMany({
      where: { storeId: input.store.id, activeSlot: 'ACTIVE' },
      data: { status: 'REVOKED', activeSlot: null, revokedAt: now },
    })

    const row = await tx.desktopActivationPin.create({
      data: {
        tenantId: input.store.tenantId,
        storeId: input.store.id,
        pinHash,
        pinHashVersion: DESKTOP_ACTIVATION_PIN_HASH_VERSION,
        status: 'ACTIVE',
        activeSlot: 'ACTIVE',
        expiresAt,
        createdByUserId: input.createdByUserId,
      },
    })

    await writeDesktopActivationAudit(tx, {
      tenantId: input.store.tenantId,
      storeId: input.store.id,
      pinId: row.id,
      actorUserId,
      eventType: 'PIN_CREATED',
      result: 'SUCCESS',
      reasonCode: input.auditReasonCode ?? null,
      ...requestHashes,
      metadata: {
        expiresAt: row.expiresAt.toISOString(),
        accessState: subscription.accessState,
        status: subscription.status,
        reason: input.auditMetadata?.reason,
        eventVersion: input.auditMetadata?.eventVersion,
      },
    })

    return {
      ok: true as const,
      row,
      subscription,
      replacedActivePin: Boolean(existingActivePin),
    }
  }).catch((error) => {
    if (isP2002(error)) return { ok: 'conflict' as const }
    throw error
  })

  if (result.ok === 'conflict') return failure(409, 'CONFLICT_RETRY_REQUIRED')
  if (!result.ok) return failure(403, 'SUBSCRIPTION_BLOCKED', { subscription: result.subscription })

  return {
    ok: true,
    pinId: result.row.id,
    pin,
    storeId: input.store.id,
    expiresAt: result.row.expiresAt.toISOString(),
    subscription: result.subscription,
    replacedActivePin: result.replacedActivePin,
  }
}
