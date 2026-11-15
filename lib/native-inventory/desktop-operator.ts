import { createHash, randomBytes } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { getDesktopDeviceContext } from '@/lib/desktop-activation/auth'
import { computeDesktopSubscriptionAccess, isDesktopSubscriptionAllowed } from '@/lib/desktop-activation/subscription-access'
import { getPosAuthHeaders, verifyPosDeviceRequest, verifyPosDeviceToken } from '@/lib/desktop-pos-auth'
import { prisma } from '@/lib/prisma'
import { InventoryError } from './input'

export const INVENTORY_CLAIM_HEADER = 'x-inventory-operator'
const claimPattern = /^[a-f0-9]{64}$/
const codePattern = /^[a-f0-9]{16}$/
const digest = (value: string) => createHash('sha256').update(value).digest('hex')

export async function inventoryDesktopDevice(req: NextRequest) {
  const token = verifyPosDeviceToken(getPosAuthHeaders(req).token)
  if (!token) throw new InventoryError('DESKTOP_DEVICE_REQUIRED', 403)
  const { tenantId, storeId, storeCode } = token
  const scope = { tenantId, storeId, storeCode }
  const session = await verifyPosDeviceRequest(req, scope, { ignoreOperatorBoundary: true })
  const sessionId = session?.browserPosSessionId
  const deviceId = session?.issuedBy === 'DESKTOP_DEVICE'
    ? /^desktop-([A-Za-z0-9_-]{1,64})$/.exec(session.deviceId)?.[1]
    : undefined
  if (!sessionId || !deviceId) throw new InventoryError('DESKTOP_DEVICE_REQUIRED', 403)

  if (req.headers.has('authorization')) {
    const native = await getDesktopDeviceContext(req)
    if (!native.ok || native.context.tenantId !== tenantId || native.context.storeId !== storeId ||
        native.context.deviceId !== deviceId) throw new InventoryError('DESKTOP_DEVICE_REQUIRED', 403)
  }
  const authorization = await prisma.desktopDevice.findFirst({
    where: {
      id: deviceId, tenantId, storeId, status: 'ACTIVE', activeSlot: 'ACTIVE', tokenExpiresAt: { gt: new Date() },
      store: { code: storeCode, status: 'ACTIVE', tenant: { status: 'ACTIVE' } },
    },
    select: { store: { select: { name: true } }, tenant: { select: { subscription: { select: { status: true } } } } },
  })
  const status = authorization?.tenant.subscription?.status
  if (!authorization || !status || !isDesktopSubscriptionAllowed(computeDesktopSubscriptionAccess(status))) {
    throw new InventoryError('DESKTOP_DEVICE_REQUIRED', 403)
  }
  return { ...scope, sessionId, deviceId, storeName: authorization.store.name }
}

type DesktopDevice = Awaited<ReturnType<typeof inventoryDesktopDevice>>

export async function inventoryEnabledForDevice(device: DesktopDevice) {
  const { tenantId, storeId } = device
  const inventory = await prisma.nativeInventoryStore.findUnique({
    where: { tenantId_storeId: { tenantId, storeId } }, select: { enabledAt: true },
  })
  return !!inventory?.enabledAt
}

export async function beginDesktopOperatorPairing(device: DesktopDevice) {
  const { tenantId, storeId, deviceId, sessionId } = device
  if (!await inventoryEnabledForDevice(device)) throw new InventoryError('NATIVE_INVENTORY_DISABLED', 403)
  const code = randomBytes(8).toString('hex')
  const claim = randomBytes(32).toString('hex')
  await prisma.$executeRaw`
    INSERT INTO native_inventory.desktop_operator
      (device_session_id, device_id, tenant_id, store_id, code_hash, claim_hash, expires_at)
    VALUES (${sessionId}, ${deviceId}, ${tenantId}, ${storeId}, ${digest(code)}, ${digest(claim)}, now() + interval '5 minutes')
    ON CONFLICT (device_session_id) DO UPDATE SET
      code_hash = EXCLUDED.code_hash, claim_hash = EXCLUDED.claim_hash, expires_at = EXCLUDED.expires_at, operator_id = NULL
    WHERE desktop_operator.tenant_id = EXCLUDED.tenant_id AND desktop_operator.store_id = EXCLUDED.store_id
      AND desktop_operator.device_id = EXCLUDED.device_id
  `
  return { code, claim, storeName: device.storeName }
}

export async function desktopOperatorClaim(req: NextRequest, device: DesktopDevice) {
  const claim = req.headers.get(INVENTORY_CLAIM_HEADER) ?? ''
  if (!claimPattern.test(claim)) throw new InventoryError('DESKTOP_OPERATOR_REQUIRED', 403)
  const [grant] = await prisma.$queryRaw<{ operator_id: string | null }[]>`
    SELECT operator_id FROM native_inventory.desktop_operator
    WHERE device_session_id = ${device.sessionId} AND device_id = ${device.deviceId}
      AND tenant_id = ${device.tenantId} AND store_id = ${device.storeId}
      AND claim_hash = ${digest(claim)} AND expires_at > now()
  `
  if (!grant) throw new InventoryError('DESKTOP_OPERATOR_REQUIRED', 403)
  return grant.operator_id
}

export async function endDesktopOperatorPairing(req: NextRequest, device: DesktopDevice) {
  const claim = req.headers.get(INVENTORY_CLAIM_HEADER) ?? ''
  if (!claimPattern.test(claim)) return
  await prisma.$executeRaw`
    UPDATE native_inventory.desktop_operator
    SET expires_at = now(), operator_id = NULL
    WHERE device_session_id = ${device.sessionId} AND device_id = ${device.deviceId}
      AND tenant_id = ${device.tenantId} AND store_id = ${device.storeId} AND claim_hash = ${digest(claim)}
  `
}

export async function approveDesktopOperatorPairing(input: unknown, actor: { tenantId: string; storeId: string; userId: string }) {
  const code = typeof input === 'string' ? input.trim().replaceAll('-', '').toLowerCase() : ''
  if (!codePattern.test(code)) throw new InventoryError('DESKTOP_PAIRING_INVALID', 403)
  const applied = await prisma.$executeRaw`
    UPDATE native_inventory.desktop_operator AS pairing
    SET operator_id = ${actor.userId}, expires_at = now() + interval '15 minutes'
    FROM public."BrowserPosDevice" AS session, public."DesktopDevice" AS device
    WHERE pairing.code_hash = ${digest(code)} AND pairing.tenant_id = ${actor.tenantId} AND pairing.store_id = ${actor.storeId}
      AND pairing.expires_at > now() AND pairing.operator_id IS NULL
      AND session.id = pairing.device_session_id AND session."tenantId" = pairing.tenant_id AND session."storeId" = pairing.store_id
      AND session."browserDeviceId" = 'desktop-' || pairing.device_id
      AND session.status = 'ACTIVE' AND session."activeSlot" = 'ACTIVE' AND session."tokenExpiresAt" > timezone('UTC', now())
      AND device.id = pairing.device_id AND device.status = 'ACTIVE' AND device."activeSlot" = 'ACTIVE' AND device."tokenExpiresAt" > timezone('UTC', now())
  `
  if (applied !== 1) throw new InventoryError('DESKTOP_PAIRING_INVALID', 403)
}
