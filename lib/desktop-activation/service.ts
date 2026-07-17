import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { auditRequestHashes, writeDesktopActivationAudit } from './audit'
import {
  DESKTOP_ACTIVATION_PIN_MAX_FAILED_ATTEMPTS,
  DesktopSecretError,
  createDesktopDeviceToken,
  getActivationPinLockedUntil,
  hashActivationPin,
  hashInstallationId,
} from './crypto'
import { serializeDesktopDevice } from './auth'
import {
  isDesktopSubscriptionAllowed,
  resolveDesktopSubscriptionAccess,
  type DesktopSubscriptionAccess,
} from './subscription-access'
import type { NextRequest } from 'next/server'

export type DesktopActivationStore = {
  id: string
  code: string
  tenantId: string
}

export type DesktopActivationSuccess = {
  ok: true
  deviceToken: string
  tokenExpiresAt: string
  device: {
    id: string
    tenantId: string
    storeId: string
    status: string
    tokenHashVersion: number
    tokenVersion: number
  }
  subscription: DesktopSubscriptionAccess
}

export type DesktopActivationFailure = {
  ok: false
  status: number
  error: string
  retryAfterSeconds?: number
  subscription?: DesktopSubscriptionAccess
}

export type DesktopActivationResult = DesktopActivationSuccess | DesktopActivationFailure

type ActivationInput = {
  req: NextRequest
  store: DesktopActivationStore
  pin: string
  installationId: string
}

function isP2002(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function failure(
  status: number,
  error: string,
  extra?: Omit<DesktopActivationFailure, 'ok' | 'status' | 'error'>,
): DesktopActivationFailure {
  return { ok: false, status, error, ...(extra ?? {}) }
}

export async function activateDesktopDevice(input: ActivationInput): Promise<DesktopActivationResult> {
  const requestHashes = auditRequestHashes(input.req)
  let installationIdHash: string
  let pinHash: string
  let tokenBundle: ReturnType<typeof createDesktopDeviceToken>

  try {
    installationIdHash = hashInstallationId(input.installationId)
    pinHash = hashActivationPin({ tenantId: input.store.tenantId, storeId: input.store.id, pin: input.pin })
    tokenBundle = createDesktopDeviceToken()
  } catch (error) {
    if (error instanceof DesktopSecretError) {
      return failure(503, error.code)
    }
    throw error
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const subscription = await resolveDesktopSubscriptionAccess(tx, input.store.tenantId)
      if (!isDesktopSubscriptionAllowed(subscription)) {
        await writeDesktopActivationAudit(tx, {
          tenantId: input.store.tenantId,
          storeId: input.store.id,
          eventType: 'ACTIVATION_DENIED',
          result: 'DENIED',
          reasonCode: 'SUBSCRIPTION_BLOCKED',
          ...requestHashes,
          metadata: { accessState: subscription.accessState, status: subscription.status },
        })
        return failure(403, 'SUBSCRIPTION_BLOCKED', { subscription })
      }

      await tx.$queryRaw`SELECT "id" FROM "DesktopActivationPin" WHERE "storeId" = ${input.store.id} AND "activeSlot" = 'ACTIVE' FOR UPDATE`
      const activationPin = await tx.desktopActivationPin.findFirst({
        where: { storeId: input.store.id, activeSlot: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
      })

      if (!activationPin) {
        await writeDesktopActivationAudit(tx, {
          tenantId: input.store.tenantId,
          storeId: input.store.id,
          eventType: 'PIN_VERIFY_FAILED',
          result: 'FAILED',
          reasonCode: 'INVALID_PIN',
          ...requestHashes,
        })
        return failure(401, 'INVALID_PIN')
      }

      const now = new Date()
      if (activationPin.status !== 'ACTIVE') {
        await writeDesktopActivationAudit(tx, {
          tenantId: input.store.tenantId,
          storeId: input.store.id,
          pinId: activationPin.id,
          eventType: 'PIN_VERIFY_FAILED',
          result: 'FAILED',
          reasonCode: 'PIN_ALREADY_USED',
          ...requestHashes,
        })
        return failure(409, 'PIN_ALREADY_USED')
      }

      if (activationPin.expiresAt.getTime() <= now.getTime()) {
        await tx.desktopActivationPin.update({
          where: { id: activationPin.id },
          data: { status: 'EXPIRED', activeSlot: null },
        })
        await writeDesktopActivationAudit(tx, {
          tenantId: input.store.tenantId,
          storeId: input.store.id,
          pinId: activationPin.id,
          eventType: 'PIN_EXPIRED',
          result: 'FAILED',
          reasonCode: 'PIN_EXPIRED',
          ...requestHashes,
          metadata: { expiresAt: activationPin.expiresAt.toISOString() },
        })
        return failure(410, 'PIN_EXPIRED')
      }

      if (activationPin.lockedUntil && activationPin.lockedUntil.getTime() > now.getTime()) {
        const retryAfterSeconds = Math.max(1, Math.ceil((activationPin.lockedUntil.getTime() - now.getTime()) / 1000))
        await writeDesktopActivationAudit(tx, {
          tenantId: input.store.tenantId,
          storeId: input.store.id,
          pinId: activationPin.id,
          eventType: 'PIN_LOCKED',
          result: 'DENIED',
          reasonCode: 'PIN_LOCKED',
          ...requestHashes,
          metadata: { lockedUntil: activationPin.lockedUntil.toISOString(), failedAttempts: activationPin.failedAttempts },
        })
        return failure(423, 'PIN_LOCKED', { retryAfterSeconds })
      }

      if (activationPin.pinHash !== pinHash) {
        const failedAttempts = activationPin.failedAttempts + 1
        const lockedUntil = failedAttempts >= DESKTOP_ACTIVATION_PIN_MAX_FAILED_ATTEMPTS
          ? getActivationPinLockedUntil(now)
          : null
        await tx.desktopActivationPin.update({
          where: { id: activationPin.id },
          data: {
            failedAttempts,
            lockedUntil,
          },
        })
        await writeDesktopActivationAudit(tx, {
          tenantId: input.store.tenantId,
          storeId: input.store.id,
          pinId: activationPin.id,
          eventType: 'PIN_VERIFY_FAILED',
          result: 'FAILED',
          reasonCode: lockedUntil ? 'PIN_LOCKED' : 'INVALID_PIN',
          ...requestHashes,
          metadata: {
            failedAttempts,
            lockedUntil: lockedUntil?.toISOString() ?? null,
          },
        })
        return lockedUntil
          ? failure(423, 'PIN_LOCKED', { retryAfterSeconds: Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000) })
          : failure(401, 'INVALID_PIN')
      }

      await tx.$queryRaw`SELECT "id" FROM "DesktopDevice" WHERE "installationIdHash" = ${installationIdHash} AND "activeSlot" = 'ACTIVE' FOR UPDATE`
      const activeDevice = await tx.desktopDevice.findFirst({
        where: { installationIdHash, activeSlot: 'ACTIVE' },
      })

      if (activeDevice && activeDevice.storeId !== input.store.id) {
        await writeDesktopActivationAudit(tx, {
          tenantId: input.store.tenantId,
          storeId: input.store.id,
          deviceId: activeDevice.id,
          pinId: activationPin.id,
          eventType: 'ACTIVATION_DENIED',
          result: 'DENIED',
          reasonCode: 'INSTALLATION_BOUND_TO_OTHER_STORE',
          ...requestHashes,
        })
        return failure(409, 'INSTALLATION_BOUND_TO_OTHER_STORE')
      }

      const latestRevokedDevice = activeDevice ? null : await tx.desktopDevice.findFirst({
        where: { installationIdHash, status: 'REVOKED' },
        orderBy: { revokedAt: 'desc' },
        select: { id: true },
      })

      const device = activeDevice
        ? await tx.desktopDevice.update({
            where: { id: activeDevice.id },
            data: {
              tokenHash: tokenBundle.tokenHash,
              tokenHashVersion: tokenBundle.tokenHashVersion,
              tokenVersion: { increment: 1 },
              tokenIssuedAt: tokenBundle.tokenIssuedAt,
              tokenExpiresAt: tokenBundle.tokenExpiresAt,
              tokenLastUsedAt: null,
              lastSeenAt: null,
              activatedAt: now,
            },
          })
        : await tx.desktopDevice.create({
            data: {
              tenantId: input.store.tenantId,
              storeId: input.store.id,
              installationIdHash,
              status: 'ACTIVE',
              activeSlot: 'ACTIVE',
              tokenHash: tokenBundle.tokenHash,
              tokenHashVersion: tokenBundle.tokenHashVersion,
              tokenVersion: 1,
              tokenIssuedAt: tokenBundle.tokenIssuedAt,
              tokenExpiresAt: tokenBundle.tokenExpiresAt,
              activatedAt: now,
              replacesDeviceId: latestRevokedDevice?.id ?? null,
            },
          })

      await tx.desktopActivationPin.update({
        where: { id: activationPin.id },
        data: {
          status: 'USED',
          activeSlot: null,
          usedAt: now,
          usedByDeviceId: device.id,
        },
      })

      await writeDesktopActivationAudit(tx, {
        tenantId: input.store.tenantId,
        storeId: input.store.id,
        deviceId: device.id,
        pinId: activationPin.id,
        eventType: activeDevice ? 'DEVICE_REACTIVATED' : 'DEVICE_ACTIVATED',
        result: 'SUCCESS',
        ...requestHashes,
        metadata: {
          credentialVersion: device.tokenVersion,
          reusedDevice: Boolean(activeDevice),
          replacesDeviceId: latestRevokedDevice?.id ?? null,
        },
      })
      if (activeDevice) {
        await writeDesktopActivationAudit(tx, {
          tenantId: input.store.tenantId,
          storeId: input.store.id,
          deviceId: device.id,
          pinId: activationPin.id,
          eventType: 'TOKEN_ROTATED',
          result: 'SUCCESS',
          ...requestHashes,
          metadata: { credentialVersion: device.tokenVersion },
        })
      }
      await writeDesktopActivationAudit(tx, {
        tenantId: input.store.tenantId,
        storeId: input.store.id,
        deviceId: device.id,
        pinId: activationPin.id,
        eventType: 'PIN_USED',
        result: 'SUCCESS',
        ...requestHashes,
      })

      const serialized = serializeDesktopDevice(device)
      return {
        ok: true,
        deviceToken: tokenBundle.token,
        tokenExpiresAt: tokenBundle.tokenExpiresAt.toISOString(),
        device: {
          id: serialized.id,
          tenantId: serialized.tenantId,
          storeId: serialized.storeId,
          status: serialized.status,
          tokenHashVersion: serialized.tokenHashVersion,
          tokenVersion: serialized.tokenVersion,
        },
        subscription,
      }
    })
  } catch (error) {
    if (isP2002(error)) {
      return failure(409, 'CONFLICT_RETRY_REQUIRED')
    }
    throw error
  }
}
