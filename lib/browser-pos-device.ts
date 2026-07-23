import crypto from 'crypto'
import { Prisma } from '@prisma/client'
import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthSecret } from '@/lib/auth-secret'
import { POS_DEVICE_OPERATIONS, type PosDeviceOperation } from '@/lib/transaction-policy-types'
import { isDesktopSubscriptionAllowed, resolveDesktopSubscriptionAccess } from '@/lib/desktop-activation/subscription-access'

const TOKEN_VERSION = 'pos-device-v1'
const TOKEN_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000
const TOKEN_CLOCK_SKEW_MS = 5 * 60 * 1000

export const DEFAULT_BROWSER_POS_SCOPES = [...POS_DEVICE_OPERATIONS] as PosDeviceOperation[]

export type PosDeviceTokenPayload = {
  v: typeof TOKEN_VERSION
  tenantId: string
  storeId: string
  storeCode: string
  deviceId: string
  issuedBy: string
  iat: number
}

export type BrowserPosStoreScope = {
  tenantId: string
  storeId: string
  storeCode: string
}

export type BrowserPosDeviceAuthorization = {
  principalId: string
  browserDeviceId: string
  tenantId: string
  storeId: string
  storeCode: string
  authorizedByUserId: string | null
  scopes: PosDeviceOperation[]
  source: 'POS_DEVICE_V1'
  legacyMigrated: boolean
}

export type BrowserPosDeviceFailure = {
  ok: false
  status: 401 | 403
  error:
    | 'BROWSER_DEVICE_UNAUTHORIZED'
    | 'BROWSER_DEVICE_NOT_FOUND'
    | 'BROWSER_DEVICE_EXPIRED'
    | 'BROWSER_DEVICE_REVOKED'
    | 'TENANT_INACTIVE'
    | 'STORE_INACTIVE'
    | 'SUBSCRIPTION_BLOCKED'
    | 'DEVICE_STORE_MISMATCH'
    | 'TRANSACTION_SCOPE_FORBIDDEN'
}

export type BrowserPosDeviceResult =
  | { ok: true; authorization: BrowserPosDeviceAuthorization }
  | BrowserPosDeviceFailure

function signPayload(payload: string): string {
  return crypto.createHmac('sha256', requireAuthSecret()).update(payload).digest('base64url')
}

export function hashPosDeviceToken(token: string): string {
  return crypto.createHmac('sha256', requireAuthSecret()).update(`browser-pos-device-token:v1:${token}`).digest('hex')
}

export function signPosDeviceToken(
  input: Omit<PosDeviceTokenPayload, 'v' | 'iat'>,
  issuedAtMs = Date.now(),
): string {
  const payload: PosDeviceTokenPayload = {
    v: TOKEN_VERSION,
    ...input,
    iat: issuedAtMs,
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${encoded}.${signPayload(encoded)}`
}

export function verifyPosDeviceToken(token: string): PosDeviceTokenPayload | null {
  // Missing configuration is operationally distinct from an invalid credential.
  // Resolve before the catch so it fails closed rather than becoming a replay miss.
  const authSecret = requireAuthSecret()
  try {
    const dot = token.lastIndexOf('.')
    if (dot < 0) return null
    const encoded = token.slice(0, dot)
    const signature = token.slice(dot + 1)
    const expected = crypto.createHmac('sha256', authSecret).update(encoded).digest('base64url')
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as PosDeviceTokenPayload
    if (payload.v !== TOKEN_VERSION) return null
    if (!payload.tenantId || !payload.storeId || !payload.storeCode || !payload.deviceId || !payload.issuedBy) return null
    if (!Number.isFinite(payload.iat) || payload.iat > Date.now() + TOKEN_CLOCK_SKEW_MS) return null
    if (Date.now() - payload.iat > TOKEN_MAX_AGE_MS) return null
    return payload
  } catch {
    return null
  }
}

export function getPosAuthHeaders(req: NextRequest) {
  return {
    token: req.headers.get('x-pos-device-token')?.trim() ?? '',
    deviceId: req.headers.get('x-pos-device-id')?.trim() ?? '',
  }
}

function tokenExpiresAt(payload: PosDeviceTokenPayload) {
  return new Date(payload.iat + TOKEN_MAX_AGE_MS)
}

function scopesFrom(value: unknown): PosDeviceOperation[] {
  if (!Array.isArray(value)) return []
  const permitted = new Set(POS_DEVICE_OPERATIONS)
  return value.filter((scope): scope is PosDeviceOperation => typeof scope === 'string' && permitted.has(scope as PosDeviceOperation))
}

async function writeAudit(input: {
  tenantId: string
  storeId: string
  userId?: string | null
  actionType: string
  targetId?: string | null
  status: 'SUCCESS' | 'FAILED'
  message?: string
  payload?: Record<string, unknown>
}) {
  try {
    await prisma.operationLog.create({
      data: {
        tenantId: input.tenantId,
        storeId: input.storeId,
        userId: input.userId ?? null,
        actionType: input.actionType,
        targetType: 'BROWSER_POS_DEVICE',
        targetId: input.targetId ?? null,
        status: input.status,
        message: input.message,
        payloadSnapshot: input.payload as Prisma.InputJsonValue | undefined,
      },
    })
  } catch {
    // Authorization must not become available merely because audit persistence fails.
  }
}

async function writeAuthorizationFailure(
  expected: BrowserPosStoreScope,
  error: BrowserPosDeviceFailure['error'],
  browserDeviceId?: string,
) {
  await writeAudit({
    tenantId: expected.tenantId,
    storeId: expected.storeId,
    actionType: 'BROWSER_POS_DEVICE_AUTH_FAILED',
    targetId: browserDeviceId || null,
    status: 'FAILED',
    message: error,
    payload: { error },
  })
}

export type BrowserPosDeviceIssueInput = BrowserPosStoreScope & {
  deviceId: string
  issuedByUserId: string
  scopes?: readonly PosDeviceOperation[]
  displayName?: string | null
  browserInfo?: string | null
}

function normalizedDeviceMetadata(value: string | null | undefined, maxLength: number) {
  return value?.trim().slice(0, maxLength) || null
}

/**
 * Issues a Browser POS credential within an existing database transaction.
 *
 * Shared-link redemption calls this directly so challenge consumption, device
 * activation and credential issuance are one all-or-nothing unit. The raw
 * credential is returned to the caller only and is never written to storage.
 */
export async function issueBrowserPosDeviceInTransaction(
  tx: Prisma.TransactionClient,
  input: BrowserPosDeviceIssueInput,
) {
  const scopes = input.scopes ? [...input.scopes] : DEFAULT_BROWSER_POS_SCOPES
  const issuedAt = new Date()
  const token = signPosDeviceToken({
    tenantId: input.tenantId,
    storeId: input.storeId,
    storeCode: input.storeCode,
    deviceId: input.deviceId,
    issuedBy: input.issuedByUserId,
  }, issuedAt.getTime())
  const tokenHash = hashPosDeviceToken(token)
  const expiresAt = new Date(issuedAt.getTime() + TOKEN_MAX_AGE_MS)
  const displayName = normalizedDeviceMetadata(input.displayName, 80)
  const browserInfo = normalizedDeviceMetadata(input.browserInfo, 1_000)

  const existing = await tx.browserPosDevice.findFirst({
    where: { storeId: input.storeId, browserDeviceId: input.deviceId, activeSlot: 'ACTIVE' },
    select: { id: true },
  })
  const device = existing
    ? await tx.browserPosDevice.update({
      where: { id: existing.id },
      data: {
        tenantId: input.tenantId,
        status: 'ACTIVE',
        tokenHash,
        tokenHashVersion: 1,
        tokenIssuedAt: issuedAt,
        tokenExpiresAt: expiresAt,
        scopes,
        issuedByUserId: input.issuedByUserId,
        displayName,
        browserInfo,
        activatedAt: issuedAt,
        lastSeenAt: issuedAt,
        revokedAt: null,
        revokedByUserId: null,
        revocationReason: null,
        legacyMigratedAt: null,
      },
    })
    : await tx.browserPosDevice.create({
      data: {
        tenantId: input.tenantId,
        storeId: input.storeId,
        browserDeviceId: input.deviceId,
        displayName,
        browserInfo,
        status: 'ACTIVE',
        activeSlot: 'ACTIVE',
        tokenHash,
        tokenHashVersion: 1,
        tokenIssuedAt: issuedAt,
        tokenExpiresAt: expiresAt,
        scopes,
        issuedByUserId: input.issuedByUserId,
        activatedAt: issuedAt,
        lastSeenAt: issuedAt,
      },
    })

  // Keep issuance audit in the same transaction. If this fails, neither the
  // active device nor a consumed shared link can survive on its own.
  await tx.operationLog.create({
    data: {
      tenantId: input.tenantId,
      storeId: input.storeId,
      userId: input.issuedByUserId,
      actionType: 'BROWSER_POS_DEVICE_ISSUED',
      targetType: 'BROWSER_POS_DEVICE',
      targetId: device.id,
      status: 'SUCCESS',
      payloadSnapshot: {
        browserDeviceId: input.deviceId,
        displayName,
        browserInfo,
        scopes,
        tokenExpiresAt: expiresAt.toISOString(),
      },
    },
  })
  return { token, device, expiresAt }
}

export async function issueBrowserPosDevice(input: BrowserPosDeviceIssueInput) {
  return prisma.$transaction((tx) => issueBrowserPosDeviceInTransaction(tx, input))
}

async function registerLegacyBrowserPosDevice(
  payload: PosDeviceTokenPayload,
  tokenHash: string,
): Promise<{ device: Awaited<ReturnType<typeof prisma.browserPosDevice.findUnique>>; legacyMigrated: boolean }> {
  const existing = await prisma.browserPosDevice.findUnique({ where: { tokenHash } })
  if (existing) return { device: existing, legacyMigrated: false }

  const issuer = await prisma.userStoreRole.findFirst({
    where: {
      tenantId: payload.tenantId,
      storeId: payload.storeId,
      userId: payload.issuedBy,
      role: 'OWNER',
      status: 'ACTIVE',
      user: { status: 'ACTIVE' },
    },
    select: { userId: true },
  })
  if (!issuer) return { device: null, legacyMigrated: false }

  try {
    const device = await prisma.browserPosDevice.create({
      data: {
        tenantId: payload.tenantId,
        storeId: payload.storeId,
        browserDeviceId: payload.deviceId,
        status: 'ACTIVE',
        activeSlot: 'ACTIVE',
        tokenHash,
        tokenHashVersion: 1,
        tokenIssuedAt: new Date(payload.iat),
        tokenExpiresAt: tokenExpiresAt(payload),
        scopes: DEFAULT_BROWSER_POS_SCOPES,
        issuedByUserId: issuer.userId,
        legacyMigratedAt: new Date(),
      },
    })
    await writeAudit({
      tenantId: payload.tenantId,
      storeId: payload.storeId,
      userId: issuer.userId,
      actionType: 'BROWSER_POS_DEVICE_LEGACY_REGISTERED',
      targetId: device.id,
      status: 'SUCCESS',
      payload: { browserDeviceId: payload.deviceId, tokenExpiresAt: device.tokenExpiresAt.toISOString() },
    })
    return { device, legacyMigrated: true }
  } catch {
    const raced = await prisma.browserPosDevice.findUnique({ where: { tokenHash } })
    return { device: raced, legacyMigrated: false }
  }
}

export async function authorizeBrowserPosDevice(
  req: NextRequest,
  expected: BrowserPosStoreScope,
  requiredScope: PosDeviceOperation,
): Promise<BrowserPosDeviceResult> {
  const { token, deviceId } = getPosAuthHeaders(req)
  if (!token || !deviceId) {
    await writeAuthorizationFailure(expected, 'BROWSER_DEVICE_UNAUTHORIZED', deviceId)
    return { ok: false, status: 401, error: 'BROWSER_DEVICE_UNAUTHORIZED' }
  }

  const payload = verifyPosDeviceToken(token)
  if (!payload) {
    await writeAuthorizationFailure(expected, 'BROWSER_DEVICE_UNAUTHORIZED', deviceId)
    return { ok: false, status: 401, error: 'BROWSER_DEVICE_UNAUTHORIZED' }
  }
  if (
    payload.tenantId !== expected.tenantId ||
    payload.storeId !== expected.storeId ||
    payload.storeCode !== expected.storeCode ||
    payload.deviceId !== deviceId
  ) {
    await writeAuthorizationFailure(expected, 'DEVICE_STORE_MISMATCH', deviceId)
    return { ok: false, status: 403, error: 'DEVICE_STORE_MISMATCH' }
  }

  const { device, legacyMigrated } = await registerLegacyBrowserPosDevice(payload, hashPosDeviceToken(token))
  if (!device) {
    await writeAuthorizationFailure(expected, 'BROWSER_DEVICE_NOT_FOUND', deviceId)
    return { ok: false, status: 401, error: 'BROWSER_DEVICE_NOT_FOUND' }
  }
  if (
    device.tenantId !== expected.tenantId ||
    device.storeId !== expected.storeId ||
    device.browserDeviceId !== payload.deviceId
  ) {
    await writeAuthorizationFailure(expected, 'DEVICE_STORE_MISMATCH', device.browserDeviceId)
    return { ok: false, status: 403, error: 'DEVICE_STORE_MISMATCH' }
  }
  if (device.status === 'REVOKED') {
    await writeAuthorizationFailure(expected, 'BROWSER_DEVICE_REVOKED', device.browserDeviceId)
    return { ok: false, status: 403, error: 'BROWSER_DEVICE_REVOKED' }
  }
  const lifecycle = await prisma.browserPosDevice.findUnique({
    where: { id: device.id },
    include: {
      tenant: { select: { status: true } },
      store: { select: { status: true } },
    },
  })
  if (!lifecycle || lifecycle.tenant.status !== 'ACTIVE') {
    await writeAuthorizationFailure(expected, 'TENANT_INACTIVE', device.browserDeviceId)
    return { ok: false, status: 403, error: 'TENANT_INACTIVE' }
  }
  if (lifecycle.store.status !== 'ACTIVE') {
    await writeAuthorizationFailure(expected, 'STORE_INACTIVE', device.browserDeviceId)
    return { ok: false, status: 403, error: 'STORE_INACTIVE' }
  }
  const subscription = await resolveDesktopSubscriptionAccess(prisma, device.tenantId)
  if (!isDesktopSubscriptionAllowed(subscription)) {
    await writeAuthorizationFailure(expected, 'SUBSCRIPTION_BLOCKED', device.browserDeviceId)
    return { ok: false, status: 403, error: 'SUBSCRIPTION_BLOCKED' }
  }
  if (device.status === 'EXPIRED' || device.tokenExpiresAt.getTime() <= Date.now()) {
    if (device.status === 'ACTIVE') {
      await prisma.browserPosDevice.update({
        where: { id: device.id },
        data: { status: 'EXPIRED', activeSlot: null },
      }).catch(() => undefined)
    }
    await writeAuthorizationFailure(expected, 'BROWSER_DEVICE_EXPIRED', device.browserDeviceId)
    return { ok: false, status: 401, error: 'BROWSER_DEVICE_EXPIRED' }
  }
  if (device.tokenHash !== hashPosDeviceToken(token)) {
    await writeAuthorizationFailure(expected, 'BROWSER_DEVICE_UNAUTHORIZED', device.browserDeviceId)
    return { ok: false, status: 401, error: 'BROWSER_DEVICE_UNAUTHORIZED' }
  }

  const scopes = scopesFrom(device.scopes)
  if (!scopes.includes(requiredScope)) {
    await writeAuthorizationFailure(expected, 'TRANSACTION_SCOPE_FORBIDDEN', device.browserDeviceId)
    return { ok: false, status: 403, error: 'TRANSACTION_SCOPE_FORBIDDEN' }
  }

  await prisma.browserPosDevice.update({
    where: { id: device.id },
    data: { lastSeenAt: new Date() },
  }).catch(() => undefined)
  await writeAudit({
    tenantId: device.tenantId,
    storeId: device.storeId,
    userId: device.issuedByUserId,
    actionType: 'BROWSER_POS_DEVICE_VERIFIED',
    targetId: device.id,
    status: 'SUCCESS',
    payload: { browserDeviceId: device.browserDeviceId, requiredScope, legacyMigrated },
  })

  return {
    ok: true,
    authorization: {
      principalId: device.id,
      browserDeviceId: device.browserDeviceId,
      tenantId: device.tenantId,
      storeId: device.storeId,
      storeCode: expected.storeCode,
      authorizedByUserId: device.issuedByUserId,
      scopes,
      source: 'POS_DEVICE_V1',
      legacyMigrated,
    },
  }
}

export async function revokeBrowserPosDevice(input: {
  id: string
  tenantId: string
  storeId: string
  revokedByUserId: string
  reason?: string | null
}) {
  const now = new Date()
  const device = await prisma.browserPosDevice.findFirst({
    where: { id: input.id, tenantId: input.tenantId, storeId: input.storeId },
    select: { id: true, storeId: true, status: true },
  })
  if (!device) return null
  if (device.status !== 'REVOKED') {
    await prisma.browserPosDevice.update({
      where: { id: device.id },
      data: {
        status: 'REVOKED',
        activeSlot: null,
        revokedAt: now,
        revokedByUserId: input.revokedByUserId,
        revocationReason: input.reason?.trim().slice(0, 500) || null,
      },
    })
  }
  await writeAudit({
    tenantId: input.tenantId,
    storeId: device.storeId,
    userId: input.revokedByUserId,
    actionType: 'BROWSER_POS_DEVICE_REVOKED',
    targetId: device.id,
    status: 'SUCCESS',
  })
  return device
}
