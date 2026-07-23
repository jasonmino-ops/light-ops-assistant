import { randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  issueBrowserPosDeviceInTransaction,
  type BrowserPosStoreScope,
} from '@/lib/browser-pos-device'

export const POS_DEVICE_AUTH_ACTION = 'POS_DEVICE_AUTH_REQUEST'
export const POS_DEVICE_AUTH_TARGET = 'POS_DEVICE'
export const POS_DEVICE_AUTH_SHARED_LINK = 'OWNER_SHARED_LINK'
export const POS_DEVICE_AUTH_QR = 'QR_OWNER_CONFIRMATION'
export const POS_DEVICE_AUTH_TTL_MS = 10 * 60 * 1000
// A short delay separates a real delivery retry from a second in-flight
// redemption request. It keeps concurrent requests single-winner while still
// allowing the bound browser to recover when the first HTTP response is lost.
export const POS_DEVICE_TOKEN_RECOVERY_GRACE_MS = 3_000

export type PosAuthorizationPayload = {
  challengeType?: typeof POS_DEVICE_AUTH_SHARED_LINK | typeof POS_DEVICE_AUTH_QR
  expiresAt?: string
  storeCode?: string
  storeName?: string
  deviceName?: string
  approvedAt?: string
  deliveredAt?: string
  boundAt?: string
  browserPosDeviceId?: string
  tokenExpiresAt?: string
  browserInfo?: string
  deliveryRecoveryAvailableAt?: string
  deliveryRecoveryCount?: number
  deliveryRecoveredAt?: string
}

type ChallengeFailure = {
  ok: false
  status: 403 | 404 | 409 | 410
  error: 'NOT_FOUND' | 'CHALLENGE_EXPIRED' | 'CHALLENGE_USED' | 'CHALLENGE_NOT_APPROVED' | 'CHALLENGE_TYPE_INVALID' | 'STORE_UNAVAILABLE' | 'ISSUER_UNAVAILABLE' | 'CHALLENGE_RECOVERY_NOT_READY' | 'RECOVERY_DEVICE_UNAVAILABLE'
}

type ChallengeSuccess<T> = { ok: true } & T

function readPayload(value: unknown): PosAuthorizationPayload {
  return (typeof value === 'object' && value !== null ? value : {}) as PosAuthorizationPayload
}

function cleanText(value: string | null | undefined, maxLength: number) {
  return value?.trim().slice(0, maxLength) || null
}

function challengeType(payload: PosAuthorizationPayload) {
  return payload.challengeType ?? POS_DEVICE_AUTH_QR
}

function isExpired(payload: PosAuthorizationPayload) {
  const expiresAt = payload.expiresAt ? new Date(payload.expiresAt).getTime() : 0
  return !expiresAt || Date.now() > expiresAt
}

function deliveryRecoveryAvailableAt(payload: PosAuthorizationPayload) {
  const explicit = payload.deliveryRecoveryAvailableAt ? new Date(payload.deliveryRecoveryAvailableAt).getTime() : NaN
  if (Number.isFinite(explicit)) return explicit
  const deliveredAt = payload.deliveredAt ? new Date(payload.deliveredAt).getTime() : NaN
  return Number.isFinite(deliveredAt) ? deliveredAt + POS_DEVICE_TOKEN_RECOVERY_GRACE_MS : NaN
}

function deliveryRecoveryCount(payload: PosAuthorizationPayload) {
  return typeof payload.deliveryRecoveryCount === 'number' && Number.isInteger(payload.deliveryRecoveryCount) && payload.deliveryRecoveryCount >= 0
    ? payload.deliveryRecoveryCount
    : 0
}

async function lockChallenge(tx: Prisma.TransactionClient, requestId: string) {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "OperationLog"
    WHERE "requestId" = ${requestId}
      AND "actionType" = ${POS_DEVICE_AUTH_ACTION}
      AND "targetType" = ${POS_DEVICE_AUTH_TARGET}
    ORDER BY "createdAt" DESC
    LIMIT 1
    FOR UPDATE
  `
  if (!locked[0]) return null
  return tx.operationLog.findUnique({ where: { id: locked[0].id } })
}

async function resolveActiveStoreAndIssuer(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; storeId: string | null; issuerUserId: string | null },
) {
  if (!input.storeId || !input.issuerUserId) return { ok: false as const, error: 'ISSUER_UNAVAILABLE' as const }
  const store = await tx.store.findFirst({
    where: {
      id: input.storeId,
      tenantId: input.tenantId,
      status: 'ACTIVE',
      tenant: { status: 'ACTIVE' },
    },
    select: { id: true, tenantId: true, code: true, name: true },
  })
  if (!store) return { ok: false as const, error: 'STORE_UNAVAILABLE' as const }
  const issuer = await tx.userStoreRole.findFirst({
    where: {
      tenantId: input.tenantId,
      storeId: store.id,
      userId: input.issuerUserId,
      role: 'OWNER',
      status: 'ACTIVE',
      user: { status: 'ACTIVE' },
    },
    select: { userId: true },
  })
  if (!issuer) return { ok: false as const, error: 'ISSUER_UNAVAILABLE' as const }
  return { ok: true as const, store, issuerUserId: issuer.userId }
}

/** Creates the owner-originated, one-time browser binding capability. */
export async function createBrowserPosSharedLink(input: BrowserPosStoreScope & {
  issuedByUserId: string
  storeName: string
}) {
  const requestId = randomUUID()
  const expiresAt = new Date(Date.now() + POS_DEVICE_AUTH_TTL_MS)
  await prisma.operationLog.create({
    data: {
      tenantId: input.tenantId,
      storeId: input.storeId,
      userId: input.issuedByUserId,
      actionType: POS_DEVICE_AUTH_ACTION,
      targetType: POS_DEVICE_AUTH_TARGET,
      requestId,
      status: 'FAILED', // FAILED is the legacy storage representation of an unconsumed challenge.
      message: 'Browser POS shared link generated by owner',
      payloadSnapshot: {
        challengeType: POS_DEVICE_AUTH_SHARED_LINK,
        storeCode: input.storeCode,
        storeName: input.storeName,
        expiresAt: expiresAt.toISOString(),
        issuedAt: new Date().toISOString(),
      },
    },
  })
  return { requestId, expiresAt }
}

/**
 * Records an OWNER's approval for the existing QR flow without consuming the
 * challenge. The original requesting browser consumes it later, atomically
 * with BrowserPosDevice issuance, through redeemBrowserPosAuthorization.
 */
export async function approveBrowserPosAuthorization(input: {
  requestId: string
  tenantId: string
  userId: string
  deviceName?: string | null
}) {
  return prisma.$transaction(async (tx): Promise<ChallengeSuccess<{ storeName: string; deviceName: string }> | ChallengeFailure> => {
    const row = await lockChallenge(tx, input.requestId)
    if (!row) return { ok: false, status: 404, error: 'NOT_FOUND' }
    if (row.tenantId !== input.tenantId) return { ok: false, status: 403, error: 'CHALLENGE_TYPE_INVALID' }
    const payload = readPayload(row.payloadSnapshot)
    if (challengeType(payload) !== POS_DEVICE_AUTH_QR) return { ok: false, status: 409, error: 'CHALLENGE_TYPE_INVALID' }
    if (isExpired(payload)) return { ok: false, status: 410, error: 'CHALLENGE_EXPIRED' }
    if (payload.browserPosDeviceId || row.status === 'SUCCESS') return { ok: false, status: 409, error: 'CHALLENGE_USED' }
    if (payload.approvedAt) return { ok: false, status: 409, error: 'CHALLENGE_USED' }

    const active = await resolveActiveStoreAndIssuer(tx, {
      tenantId: row.tenantId,
      storeId: row.storeId,
      issuerUserId: input.userId,
    })
    if (!active.ok) {
      return {
        ok: false,
        status: 403,
        error: active.error,
      }
    }

    const deviceName = cleanText(input.deviceName, 80) ?? payload.deviceName ?? '前台收银机'
    await tx.operationLog.update({
      where: { id: row.id },
      data: {
        userId: active.issuerUserId,
        message: 'Browser POS device approved by owner; awaiting requesting browser redemption',
        payloadSnapshot: {
          ...payload,
          challengeType: POS_DEVICE_AUTH_QR,
          storeCode: active.store.code,
          storeName: active.store.name,
          deviceName,
          approvedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    })
    return { ok: true, storeName: active.store.name, deviceName }
  })
}

/**
 * Atomically consumes a challenge, activates the requesting browser device,
 * signs its pos-device-v1 token and writes audit events. The token only exists
 * in this return value; it is never persisted in OperationLog or Prisma.
 */
export async function redeemBrowserPosAuthorization(input: {
  requestId: string
  deviceId: string
  deviceName?: string | null
  browserInfo?: string | null
}) {
  return prisma.$transaction(async (tx): Promise<ChallengeSuccess<{
    token: string
    storeCode: string
    storeName: string
    deviceName: string
    browserDeviceId: string
    expiresAt: Date
  }> | ChallengeFailure> => {
    const row = await lockChallenge(tx, input.requestId)
    if (!row) return { ok: false, status: 404, error: 'NOT_FOUND' }

    const payload = readPayload(row.payloadSnapshot)
    const type = challengeType(payload)
    if (isExpired(payload)) return { ok: false, status: 410, error: 'CHALLENGE_EXPIRED' }

    // The first bind response can be lost after this transaction commits. A
    // single, delayed retry is safe only for the exact browser already bound
    // to this challenge. It rotates that device's credential in this same
    // transaction; no raw token is retained in the challenge or database.
    if (payload.browserPosDeviceId || (row.status === 'SUCCESS' && payload.deliveredAt)) {
      if (
        row.status !== 'SUCCESS'
        || !payload.browserPosDeviceId
        || !payload.deliveredAt
        || !row.targetId
        || row.targetId !== input.deviceId
        || deliveryRecoveryCount(payload) >= 1
      ) {
        return { ok: false, status: 409, error: 'CHALLENGE_USED' }
      }
      const recoveryAt = deliveryRecoveryAvailableAt(payload)
      if (!Number.isFinite(recoveryAt) || Date.now() < recoveryAt) {
        return { ok: false, status: 409, error: 'CHALLENGE_RECOVERY_NOT_READY' }
      }

      const active = await resolveActiveStoreAndIssuer(tx, {
        tenantId: row.tenantId,
        storeId: row.storeId,
        issuerUserId: row.userId,
      })
      if (!active.ok) return { ok: false, status: 403, error: active.error }

      const lockedDevice = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "BrowserPosDevice"
        WHERE "id" = ${payload.browserPosDeviceId}
          AND "tenantId" = ${active.store.tenantId}
          AND "storeId" = ${active.store.id}
          AND "browserDeviceId" = ${input.deviceId}
          AND "status" = 'ACTIVE'
          AND "activeSlot" = 'ACTIVE'
        FOR UPDATE
      `
      if (!lockedDevice[0]) return { ok: false, status: 409, error: 'RECOVERY_DEVICE_UNAVAILABLE' }

      const deviceName = cleanText(input.deviceName, 80) ?? payload.deviceName ?? '前台收银机'
      const browserInfo = cleanText(input.browserInfo, 1_000) ?? payload.browserInfo ?? null
      const issued = await issueBrowserPosDeviceInTransaction(tx, {
        tenantId: active.store.tenantId,
        storeId: active.store.id,
        storeCode: active.store.code,
        deviceId: input.deviceId,
        issuedByUserId: active.issuerUserId,
        displayName: deviceName,
        browserInfo,
      })
      // Defensive fail-closed guard: the recovery path may only rotate the
      // credential of the device created by this challenge, never create one.
      if (issued.device.id !== payload.browserPosDeviceId) {
        throw new Error('Browser POS token recovery changed device identity')
      }

      const recoveredAt = new Date().toISOString()
      await tx.operationLog.update({
        where: { id: row.id },
        data: {
          payloadSnapshot: {
            ...payload,
            deviceName,
            browserInfo,
            tokenExpiresAt: issued.expiresAt.toISOString(),
            deliveryRecoveryCount: deliveryRecoveryCount(payload) + 1,
            deliveryRecoveredAt: recoveredAt,
          } as Prisma.InputJsonValue,
        },
      })
      await tx.operationLog.create({
        data: {
          tenantId: active.store.tenantId,
          storeId: active.store.id,
          userId: active.issuerUserId,
          actionType: 'BROWSER_POS_DEVICE_TOKEN_RECOVERED',
          targetType: 'BROWSER_POS_DEVICE',
          targetId: issued.device.id,
          requestId: row.requestId,
          status: 'SUCCESS',
          payloadSnapshot: {
            browserDeviceId: input.deviceId,
            deviceName,
            tokenExpiresAt: issued.expiresAt.toISOString(),
          },
        },
      })
      return {
        ok: true,
        token: issued.token,
        storeCode: active.store.code,
        storeName: active.store.name,
        deviceName,
        browserDeviceId: issued.device.id,
        expiresAt: issued.expiresAt,
      }
    }

    if (type === POS_DEVICE_AUTH_QR) {
      const hasLegacyApproval = row.status === 'SUCCESS' && Boolean(row.userId) && !payload.deliveredAt
      if (!payload.approvedAt && !hasLegacyApproval) return { ok: false, status: 409, error: 'CHALLENGE_NOT_APPROVED' }
      if (!row.targetId || row.targetId !== input.deviceId) return { ok: false, status: 403, error: 'CHALLENGE_TYPE_INVALID' }
    } else if (type !== POS_DEVICE_AUTH_SHARED_LINK) {
      return { ok: false, status: 409, error: 'CHALLENGE_TYPE_INVALID' }
    }

    const active = await resolveActiveStoreAndIssuer(tx, {
      tenantId: row.tenantId,
      storeId: row.storeId,
      issuerUserId: row.userId,
    })
    if (!active.ok) {
      return {
        ok: false,
        status: 403,
        error: active.error,
      }
    }

    const deviceName = cleanText(input.deviceName, 80) ?? payload.deviceName ?? '前台收银机'
    const browserInfo = cleanText(input.browserInfo, 1_000)
    // The helper signs the credential and writes the BrowserPosDevice plus its
    // audit row using *this same tx*. Any exception rolls the challenge back to
    // unconsumed, so a used link can never exist without its bound device.
    const issued = await issueBrowserPosDeviceInTransaction(tx, {
      tenantId: active.store.tenantId,
      storeId: active.store.id,
      storeCode: active.store.code,
      deviceId: input.deviceId,
      issuedByUserId: active.issuerUserId,
      displayName: deviceName,
      browserInfo,
    })
    const deliveredAt = new Date().toISOString()
    const recoveryAvailableAt = new Date(Date.now() + POS_DEVICE_TOKEN_RECOVERY_GRACE_MS).toISOString()
    await tx.operationLog.update({
      where: { id: row.id },
      data: {
        targetId: input.deviceId,
        userId: active.issuerUserId,
        status: 'SUCCESS',
        message: type === POS_DEVICE_AUTH_SHARED_LINK
          ? 'Browser POS shared link redeemed and device bound'
          : 'Browser POS authorization redeemed by requesting browser',
        payloadSnapshot: {
          ...payload,
          challengeType: type,
          storeCode: active.store.code,
          storeName: active.store.name,
          deviceName,
          browserInfo,
          deliveredAt,
          boundAt: deliveredAt,
          browserPosDeviceId: issued.device.id,
          tokenExpiresAt: issued.expiresAt.toISOString(),
          deliveryRecoveryAvailableAt: recoveryAvailableAt,
          deliveryRecoveryCount: 0,
        } as Prisma.InputJsonValue,
      },
    })
    await tx.operationLog.create({
      data: {
        tenantId: active.store.tenantId,
        storeId: active.store.id,
        userId: active.issuerUserId,
        actionType: type === POS_DEVICE_AUTH_SHARED_LINK
          ? 'BROWSER_POS_SHARED_LINK_REDEEMED'
          : 'BROWSER_POS_QR_AUTH_REDEEMED',
        targetType: 'BROWSER_POS_DEVICE',
        targetId: issued.device.id,
        requestId: row.requestId,
        status: 'SUCCESS',
        payloadSnapshot: {
          browserDeviceId: input.deviceId,
          deviceName,
          tokenExpiresAt: issued.expiresAt.toISOString(),
        },
      },
    })
    return {
      ok: true,
      token: issued.token,
      storeCode: active.store.code,
      storeName: active.store.name,
      deviceName,
      browserDeviceId: issued.device.id,
      expiresAt: issued.expiresAt,
    }
  })
}

export function getPosAuthorizationPayload(value: unknown) {
  return readPayload(value)
}

export function getPosAuthorizationChallengeType(value: unknown) {
  return challengeType(readPayload(value))
}

export function isPosAuthorizationExpired(value: unknown) {
  return isExpired(readPayload(value))
}
