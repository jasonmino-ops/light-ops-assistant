import { NextRequest } from 'next/server'
import { getContext } from '@/lib/context'
import { getDesktopDeviceContext } from '@/lib/desktop-activation/auth'
import { verifyPosDeviceRequest } from '@/lib/desktop-pos-auth'
import { prisma } from '@/lib/prisma'
import { verifySession } from '@/lib/session'
import { extractTgUserIdFromParams, verifyTgInitData } from '@/lib/verify-tg-init-data'
import { InventoryError } from './input'
import type { InventoryPerson } from './service'

export async function inventoryPerson(req: NextRequest): Promise<InventoryPerson> {
  const token = req.cookies.get('auth-session')?.value
  if (token && verifySession(token)?.opsRole) throw new InventoryError('PERSON_REQUIRED', 403)
  const ctx = await getContext(req)
  if (!ctx) throw new InventoryError('PERSON_REQUIRED', 401)

  const scope = { tenantId: ctx.tenantId, storeId: ctx.storeId }
  const [membership, inventory] = await Promise.all([
    prisma.userStoreRole.findFirst({
      where: {
        ...scope,
        userId: ctx.userId,
        status: 'ACTIVE',
        user: { tenantId: ctx.tenantId, status: 'ACTIVE' },
        store: { tenantId: ctx.tenantId, status: 'ACTIVE', tenant: { status: 'ACTIVE' } },
      },
      select: { role: true, user: { select: { telegramId: true } }, store: { select: { code: true, name: true, currencyCode: true } } },
    }),
    prisma.nativeInventoryStore.findUnique({
      where: { tenantId_storeId: scope },
      select: { enabledAt: true, currencyCode: true, receivers: { where: { userId: ctx.userId }, select: { userId: true } } },
    }),
  ])
  if (!membership) throw new InventoryError('STORE_ACCESS_DENIED', 403)

  // Desktop can mint the existing OWNER web cookie from device authority alone.
  // Verify the Telegram person separately before accepting that cookie here.
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim()
  const initData = req.headers.get('x-telegram-init-data')
  if (!botToken || !initData || initData.length > 16384) throw new InventoryError('PERSON_PROOF_REQUIRED', 403)
  const proof = verifyTgInitData(initData, botToken)
  const authDate = Number(proof?.get('auth_date'))
  const now = Math.floor(Date.now() / 1000)
  if (!proof || !membership.user.telegramId || extractTgUserIdFromParams(proof) !== membership.user.telegramId ||
    !Number.isSafeInteger(authDate) || authDate > now + 60 || now - authDate > 15 * 60) {
    throw new InventoryError('PERSON_PROOF_INVALID', 403)
  }

  const hasPosCredential = req.headers.has('x-pos-device-token') || req.headers.has('x-pos-device-id')
  const hasNativeCredential = req.headers.has('authorization')
  const desktop = req.headers.get('x-lightops-client') === 'desktop-pos'
  if (desktop || hasPosCredential || hasNativeCredential) {
    if (hasNativeCredential) {
      const device = await getDesktopDeviceContext(req)
      if (!device.ok || device.context.tenantId !== scope.tenantId || device.context.storeId !== scope.storeId) {
        throw new InventoryError('DESKTOP_DEVICE_REQUIRED', 403)
      }
    } else {
      const device = await verifyPosDeviceRequest(req, { ...scope, storeCode: membership.store.code }, { ignoreOperatorBoundary: true })
      if (!device?.browserPosSessionId) throw new InventoryError('DESKTOP_DEVICE_REQUIRED', 403)
    }
  }

  if (!inventory?.enabledAt) throw new InventoryError('NATIVE_INVENTORY_DISABLED', 403)
  if (membership.store.currencyCode !== inventory.currencyCode) throw new InventoryError('INVENTORY_CURRENCY_MISMATCH', 409)
  const isOwner = ctx.role === 'OWNER' && membership.role === 'OWNER'
  if (!isOwner && !inventory.receivers.length) throw new InventoryError('RECEIVING_ACCESS_DENIED', 403)
  return { ...scope, userId: ctx.userId, role: isOwner ? 'OWNER' : 'RECEIVER', currencyCode: membership.store.currencyCode, storeName: membership.store.name }
}

export function requireInventoryOwner(person: InventoryPerson) {
  if (person.role !== 'OWNER') throw new InventoryError('OWNER_REQUIRED', 403)
}
