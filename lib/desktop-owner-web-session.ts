/**
 * ES-DESKTOP-OWNER-WEB-SESSION-01 — Trusted Desktop → OWNER Web Session.
 *
 * Product model: a legally activated, store-bound E-Shop Desktop is that
 * store's OWNER management terminal. This module exchanges the Desktop-only
 * managed POS session (issued by /api/pos-session/desktop from the Desktop
 * device credential) for the existing standard `auth-session` cookie of the
 * store's active OWNER.
 *
 * Authority chain (all existing, reused):
 *   signed POS token (issuedBy DESKTOP_DEVICE, browserPosSessionId, desktop-<id>)
 *   → BrowserPosDevice ACTIVE / hash / expiry   (verifyPosDeviceRequest)
 *   → DesktopDevice ACTIVE / tenant / store / expiry
 *   → tenant ACTIVE, subscription allowed
 *   → active store OWNER                          (authorizationForDevice)
 *   → signSession (standard auth-session)
 *
 * Never used as authority: renderer Desktop flags (isDesktop), storeCode,
 * request marker headers, or any existing cookie.
 *
 * Known accepted limitation (Founder Decision, 方案 A): the standard session
 * has no server-side expiry or device binding, so a DesktopDevice revocation
 * does not invalidate an already-issued cookie before its 12 h Max-Age ends.
 */
import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { signSession } from '@/lib/session'
import { authorizeDesktopPosDevice, verifyPosDeviceToken } from '@/lib/desktop-pos-auth'
import { auditRequestHashes, writeDesktopActivationAudit } from '@/lib/desktop-activation/audit'
import {
  isDesktopSubscriptionAllowed,
  resolveDesktopSubscriptionAccess,
} from '@/lib/desktop-activation/subscription-access'

export const OWNER_WEB_SESSION_COOKIE = 'auth-session'
export const OWNER_WEB_SESSION_MAX_AGE_SECONDS = 12 * 60 * 60
export const OWNER_WEB_SESSION_EVENT_ISSUED = 'DESKTOP_OWNER_WEB_SESSION_ISSUED'
export const OWNER_WEB_SESSION_EVENT_DENIED = 'DESKTOP_OWNER_WEB_SESSION_DENIED'
export const OWNER_WEB_SESSION_UNAUTHORIZED = 'DESKTOP_OWNER_SESSION_UNAUTHORIZED'
export const OWNER_WEB_SESSION_DENIED = 'DESKTOP_OWNER_SESSION_DENIED'

const DESKTOP_SESSION_ISSUER = 'DESKTOP_DEVICE'
const DESKTOP_BROWSER_DEVICE_ID = /^desktop-([A-Za-z0-9_-]{1,64})$/
const EVENT_VERSION = 1

export type DeniedReason =
  | 'STORE_INACTIVE'
  | 'NOT_DESKTOP_SESSION'
  | 'DESKTOP_DEVICE_UNAUTHORIZED'
  | 'DESKTOP_DEVICE_REVOKED'
  | 'DESKTOP_TOKEN_EXPIRED'
  | 'TENANT_INACTIVE'
  | 'SUBSCRIPTION_BLOCKED'
  | 'POS_SESSION_INVALID'
  | 'OWNER_NOT_FOUND'

export type OwnerWebSessionResult =
  | { ok: true; sessionToken: string; expiresAt: Date }
  | { ok: false; status: 401 | 403; error: string; reason?: DeniedReason }

/** Same attributes as the existing Telegram login cookie, with a 12 h Max-Age. */
export function ownerWebSessionCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production'
  return {
    httpOnly: true,
    sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
    secure: isProd,
    maxAge: OWNER_WEB_SESSION_MAX_AGE_SECONDS,
    path: '/',
  }
}

const unauthorized: OwnerWebSessionResult = { ok: false, status: 401, error: OWNER_WEB_SESSION_UNAUTHORIZED }

export async function issueDesktopOwnerWebSession(req: NextRequest): Promise<OwnerWebSessionResult> {
  // Early, unattributable rejections: generic response, no audit.
  const token = req.headers.get('x-pos-device-token')?.trim() ?? ''
  const browserDeviceId = req.headers.get('x-pos-device-id')?.trim() ?? ''
  if (!token || !browserDeviceId) return unauthorized

  const signed = verifyPosDeviceToken(token)
  if (!signed || signed.deviceId !== browserDeviceId) return unauthorized

  const store = await prisma.store.findUnique({
    where: { id: signed.storeId },
    select: { id: true, tenantId: true, code: true, status: true },
  })
  if (!store || store.tenantId !== signed.tenantId || store.code !== signed.storeCode) return unauthorized

  // From here the tenant/store scope is attributable (signed token + existing store).
  const scope = { tenantId: store.tenantId, storeId: store.id, storeCode: store.code }
  const hashes = auditRequestHashes(req)
  let auditedDeviceId: string | null = null

  const deny = async (reason: DeniedReason): Promise<OwnerWebSessionResult> => {
    try {
      await writeDesktopActivationAudit(prisma, {
        tenantId: scope.tenantId,
        storeId: scope.storeId,
        deviceId: auditedDeviceId,
        eventType: OWNER_WEB_SESSION_EVENT_DENIED,
        result: 'DENIED',
        reasonCode: reason,
        ...hashes,
        metadata: { reason, eventVersion: EVENT_VERSION },
      })
    } catch {
      // The request is denied regardless; an audit failure never issues a session.
    }
    return { ok: false, status: 403, error: OWNER_WEB_SESSION_DENIED, reason }
  }

  if (store.status !== 'ACTIVE') return deny('STORE_INACTIVE')

  const desktopMatch = DESKTOP_BROWSER_DEVICE_ID.exec(signed.deviceId)
  if (
    signed.issuedBy !== DESKTOP_SESSION_ISSUER ||
    !signed.browserPosSessionId ||
    !desktopMatch
  ) {
    return deny('NOT_DESKTOP_SESSION')
  }

  const now = Date.now()
  const device = await prisma.desktopDevice.findUnique({
    where: { id: desktopMatch[1] },
    select: { id: true, tenantId: true, storeId: true, status: true, activeSlot: true, tokenExpiresAt: true },
  })
  if (!device || device.tenantId !== scope.tenantId || device.storeId !== scope.storeId) {
    return deny('DESKTOP_DEVICE_UNAUTHORIZED')
  }
  auditedDeviceId = device.id
  if (device.status !== 'ACTIVE' || device.activeSlot !== 'ACTIVE') return deny('DESKTOP_DEVICE_REVOKED')
  if (device.tokenExpiresAt.getTime() <= now) return deny('DESKTOP_TOKEN_EXPIRED')

  const tenant = await prisma.tenant.findUnique({ where: { id: scope.tenantId }, select: { status: true } })
  if (tenant?.status !== 'ACTIVE') return deny('TENANT_INACTIVE')

  const subscription = await resolveDesktopSubscriptionAccess(prisma, scope.tenantId)
  if (!isDesktopSubscriptionAllowed(subscription)) return deny('SUBSCRIPTION_BLOCKED')

  // Existing managed POS session verification + existing device → OWNER authority.
  const authority = await authorizeDesktopPosDevice(req, scope)
  if (!authority.ok) return deny(authority.reason)

  const owner = await prisma.user.findUnique({
    where: { id: authority.authorization.operatorUserId },
    select: { id: true, tenantId: true, role: true, status: true },
  })
  if (!owner || owner.tenantId !== scope.tenantId || owner.role !== 'OWNER' || owner.status !== 'ACTIVE') {
    return deny('OWNER_NOT_FOUND')
  }

  const expiresAt = new Date(now + OWNER_WEB_SESSION_MAX_AGE_SECONDS * 1000)
  const sessionToken = signSession({
    tenantId: scope.tenantId,
    userId: owner.id,
    storeId: scope.storeId,
    role: 'OWNER',
  })

  // Issuance is audited before the cookie is returned; an audit failure fails closed.
  await writeDesktopActivationAudit(prisma, {
    tenantId: scope.tenantId,
    storeId: scope.storeId,
    deviceId: device.id,
    actorUserId: owner.id,
    eventType: OWNER_WEB_SESSION_EVENT_ISSUED,
    result: 'SUCCESS',
    ...hashes,
    metadata: { expiresAt: expiresAt.toISOString(), eventVersion: EVENT_VERSION },
  })

  return { ok: true, sessionToken, expiresAt }
}
