import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashBrowserDeviceId } from '@/lib/computer-client/crypto'
import {
  getPosAuthHeaders,
  hashPosDeviceToken,
  verifyPosDeviceToken,
} from '@/lib/desktop-pos-auth'

export type DeviceRelayUnavailableReason =
  | 'COMPUTER_BINDING_NOT_APPROVED'
  | 'COMPUTER_BINDING_NOT_BOUND'
  | 'COMPUTER_DISABLED'
  | 'CREDENTIAL_NOT_ACTIVE'
  | 'CREDENTIAL_EXPIRED'
  | 'TENANT_INACTIVE'
  | 'STORE_INACTIVE'

export type DeviceRelayContext = {
  principal: 'BROWSER_POS_DEVICE'
  browserPosDeviceId: string
  computerBindingId: string
  tenantId: string
  storeId: string
  storeCode: string
  enabled: boolean
  unavailableReason: DeviceRelayUnavailableReason | null
}

export type DeviceRelayAuthResult =
  | { ok: true; context: DeviceRelayContext }
  | { ok: false; status: number; error: string }

function unavailableReason(
  binding: {
    status: string
    boundAt: Date | null
    disabledAt: Date | null
    credentialStatus: string
    credentialExpiresAt: Date | null
    tenant: { status: string }
    store: { status: string }
  },
  now: Date,
): DeviceRelayUnavailableReason | null {
  if (binding.status !== 'APPROVED') return 'COMPUTER_BINDING_NOT_APPROVED'
  if (!binding.boundAt) return 'COMPUTER_BINDING_NOT_BOUND'
  if (binding.disabledAt) return 'COMPUTER_DISABLED'
  if (binding.credentialStatus !== 'ACTIVE') return 'CREDENTIAL_NOT_ACTIVE'
  if (binding.credentialExpiresAt && binding.credentialExpiresAt.getTime() <= now.getTime()) {
    return 'CREDENTIAL_EXPIRED'
  }
  if (binding.tenant.status !== 'ACTIVE') return 'TENANT_INACTIVE'
  if (binding.store.status !== 'ACTIVE') return 'STORE_INACTIVE'
  return null
}

/**
 * Resolves the delegated Browser POS capability back to the ComputerBinding
 * that created it. The browser never submits a binding, tenant, or store ID,
 * and never receives the ComputerBinding device secret.
 */
export async function authenticateDeviceRelayPrincipal(
  req: NextRequest,
  now = new Date(),
): Promise<DeviceRelayAuthResult> {
  if (!process.env.AUTH_SECRET?.trim()) {
    return { ok: false, status: 503, error: 'DEVICE_AUTH_NOT_CONFIGURED' }
  }

  const { token, deviceId } = getPosAuthHeaders(req)
  if (!token || !deviceId) {
    return { ok: false, status: 401, error: 'POS_DEVICE_AUTH_REQUIRED' }
  }

  const payload = verifyPosDeviceToken(token)
  if (!payload?.browserPosSessionId || payload.deviceId !== deviceId) {
    return { ok: false, status: 401, error: 'POS_DEVICE_AUTH_REQUIRED' }
  }

  const session = await prisma.browserPosDevice.findUnique({
    where: { id: payload.browserPosSessionId },
  })
  if (
    !session
    || session.status !== 'ACTIVE'
    || session.activeSlot !== 'ACTIVE'
    || session.browserDeviceId !== deviceId
    || session.tokenHash !== hashPosDeviceToken(token)
    || session.tokenExpiresAt.getTime() <= now.getTime()
    || !Array.isArray(session.scopes)
    || !session.scopes.includes('BROWSER_POS')
  ) {
    return { ok: false, status: 403, error: 'POS_DEVICE_SESSION_INACTIVE' }
  }

  const links = await prisma.computerBrowserLaunchTicket.findMany({
    where: { browserPosDeviceId: session.id },
    include: {
      binding: {
        include: {
          tenant: { select: { status: true } },
          store: { select: { id: true, tenantId: true, code: true, status: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 2,
  })
  if (links.length !== 1) {
    return { ok: false, status: 403, error: 'POS_DEVICE_NOT_COMPUTER_BOUND' }
  }

  const link = links[0]
  if (
    !link.usedAt
    || link.usedAt.getTime() > link.expiresAt.getTime()
    || link.browserDeviceIdHash !== hashBrowserDeviceId(deviceId)
  ) {
    return { ok: false, status: 403, error: 'POS_DEVICE_LAUNCH_PROOF_INVALID' }
  }

  const binding = link.binding
  if (
    session.tenantId !== binding.tenantId
    || session.storeId !== binding.storeId
    || payload.tenantId !== binding.tenantId
    || payload.storeId !== binding.storeId
    || binding.store.id !== binding.storeId
    || binding.store.tenantId !== binding.tenantId
    || payload.storeCode !== binding.store.code
  ) {
    return { ok: false, status: 403, error: 'POS_DEVICE_SCOPE_MISMATCH' }
  }

  const reason = unavailableReason(binding, now)
  return {
    ok: true,
    context: {
      principal: 'BROWSER_POS_DEVICE',
      browserPosDeviceId: session.id,
      computerBindingId: binding.id,
      tenantId: binding.tenantId,
      storeId: binding.storeId,
      storeCode: binding.store.code,
      enabled: reason === null,
      unavailableReason: reason,
    },
  }
}
