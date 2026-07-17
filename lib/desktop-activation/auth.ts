import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  DesktopSecretError,
  assertDesktopActivationSecretsConfigured,
  hashDesktopDeviceToken,
  isValidDesktopDeviceTokenFormat,
} from './crypto'
import {
  isDesktopSubscriptionAllowed,
  resolveDesktopSubscriptionAccess,
  type DesktopSubscriptionAccess,
} from './subscription-access'

export type DesktopDeviceContext = {
  tenantId: string
  storeId: string
  deviceId: string
  tokenHashVersion: number
  subscription: DesktopSubscriptionAccess
}

export type DesktopDeviceAuthFailure = {
  ok: false
  status: number
  error: string
  device?: SerializedDesktopDevice
  store?: SerializedDesktopStore
  subscription?: DesktopSubscriptionAccess
}

export type DesktopDeviceAuthSuccess = {
  ok: true
  context: DesktopDeviceContext
  device: SerializedDesktopDevice
  store: SerializedDesktopStore
}

export type DesktopDeviceAuthResult = DesktopDeviceAuthSuccess | DesktopDeviceAuthFailure

export type SerializedDesktopDevice = {
  id: string
  tenantId: string
  storeId: string
  status: string
  tokenHashVersion: number
  tokenIssuedAt: string
  tokenExpiresAt: string
  tokenLastUsedAt: string | null
  lastSeenAt: string | null
  activatedAt: string
  revokedAt: string | null
  revocationReason: string | null
  replacesDeviceId: string | null
}

export type SerializedDesktopStore = {
  id: string
  name: string
  status: string
}

function bearerToken(req: NextRequest) {
  const value = req.headers.get('authorization')?.trim() ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(value)
  return match?.[1]?.trim() ?? ''
}

export function serializeDesktopDevice(device: {
  id: string
  tenantId: string
  storeId: string
  status: string
  tokenHashVersion: number
  tokenIssuedAt: Date
  tokenExpiresAt: Date
  tokenLastUsedAt: Date | null
  lastSeenAt: Date | null
  activatedAt: Date
  revokedAt: Date | null
  revocationReason: string | null
  replacesDeviceId: string | null
}): SerializedDesktopDevice {
  return {
    id: device.id,
    tenantId: device.tenantId,
    storeId: device.storeId,
    status: device.status,
    tokenHashVersion: device.tokenHashVersion,
    tokenIssuedAt: device.tokenIssuedAt.toISOString(),
    tokenExpiresAt: device.tokenExpiresAt.toISOString(),
    tokenLastUsedAt: device.tokenLastUsedAt?.toISOString() ?? null,
    lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
    activatedAt: device.activatedAt.toISOString(),
    revokedAt: device.revokedAt?.toISOString() ?? null,
    revocationReason: device.revocationReason,
    replacesDeviceId: device.replacesDeviceId,
  }
}

export async function getDesktopDeviceContext(
  req: NextRequest,
  options: { updateLastSeen?: boolean } = {},
): Promise<DesktopDeviceAuthResult> {
  const token = bearerToken(req)
  if (!isValidDesktopDeviceTokenFormat(token)) {
    return { ok: false, status: 401, error: 'DESKTOP_DEVICE_UNAUTHORIZED' }
  }

  let tokenHash: string
  try {
    assertDesktopActivationSecretsConfigured()
    tokenHash = hashDesktopDeviceToken(token)
  } catch (error) {
    if (error instanceof DesktopSecretError) {
      return { ok: false, status: 503, error: error.code }
    }
    throw error
  }

  const device = await prisma.desktopDevice.findUnique({
    where: { tokenHash },
    include: {
      tenant: { select: { status: true } },
      store: { select: { id: true, name: true, status: true } },
    },
  })
  if (!device) return { ok: false, status: 401, error: 'DESKTOP_DEVICE_UNAUTHORIZED' }

  const serializedDevice = serializeDesktopDevice(device)
  const serializedStore = { id: device.store.id, name: device.store.name, status: device.store.status }

  if (device.status !== 'ACTIVE') {
    return { ok: false, status: 403, error: 'DESKTOP_DEVICE_REVOKED', device: serializedDevice, store: serializedStore }
  }
  if (device.tokenExpiresAt.getTime() <= Date.now()) {
    return { ok: false, status: 401, error: 'DESKTOP_TOKEN_EXPIRED', device: serializedDevice, store: serializedStore }
  }
  if (device.tenant.status !== 'ACTIVE') {
    return { ok: false, status: 403, error: 'TENANT_INACTIVE', device: serializedDevice, store: serializedStore }
  }
  if (device.store.status !== 'ACTIVE') {
    return { ok: false, status: 403, error: 'STORE_INACTIVE', device: serializedDevice, store: serializedStore }
  }

  const subscription = await resolveDesktopSubscriptionAccess(prisma, device.tenantId)
  if (!isDesktopSubscriptionAllowed(subscription)) {
    return {
      ok: false,
      status: 403,
      error: 'SUBSCRIPTION_BLOCKED',
      device: serializedDevice,
      store: serializedStore,
      subscription,
    }
  }

  if (options.updateLastSeen) {
    const now = new Date()
    await prisma.desktopDevice.update({
      where: { id: device.id },
      data: { tokenLastUsedAt: now, lastSeenAt: now },
    })
    serializedDevice.tokenLastUsedAt = now.toISOString()
    serializedDevice.lastSeenAt = now.toISOString()
  }

  return {
    ok: true,
    context: {
      tenantId: device.tenantId,
      storeId: device.storeId,
      deviceId: device.id,
      tokenHashVersion: device.tokenHashVersion,
      subscription,
    },
    device: serializedDevice,
    store: serializedStore,
  }
}
