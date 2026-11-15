import type { NextRequest } from 'next/server'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/prisma'
import { verifySession } from '@/lib/session'
import { extractTgUserIdFromParams, verifyTgInitData } from '@/lib/verify-tg-init-data'
import { desktopOperatorClaim, inventoryDesktopDevice } from './desktop-operator'
import { InventoryError } from './input'
import type { InventoryPerson } from './service'

function verifiedInventoryTelegramId(req: NextRequest) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim()
  const initData = req.headers.get('x-telegram-init-data')
  if (!botToken || !initData || initData.length > 16384) throw new InventoryError('PERSON_PROOF_REQUIRED', 403)
  const proof = verifyTgInitData(initData, botToken)
  const authDate = Number(proof?.get('auth_date'))
  const now = Math.floor(Date.now() / 1000)
  const telegramId = proof && extractTgUserIdFromParams(proof)
  if (!telegramId || !Number.isSafeInteger(authDate) || authDate > now + 60 || now - authDate > 15 * 60) {
    throw new InventoryError('PERSON_PROOF_INVALID', 403)
  }
  return telegramId
}

async function inventoryMembership(
  ctx: { tenantId: string; storeId: string; userId: string },
  proof: { role: string; telegramId: string } | null,
): Promise<InventoryPerson> {
  const scope = { tenantId: ctx.tenantId, storeId: ctx.storeId }
  const [membership, inventory] = await Promise.all([
    prisma.userStoreRole.findFirst({
      where: {
        ...scope, userId: ctx.userId, status: 'ACTIVE',
        user: { tenantId: ctx.tenantId, status: 'ACTIVE' },
        store: { tenantId: ctx.tenantId, status: 'ACTIVE', tenant: { status: 'ACTIVE' } },
      },
      select: { role: true, user: { select: { telegramId: true, role: true } }, store: { select: { name: true, currencyCode: true } } },
    }),
    prisma.nativeInventoryStore.findUnique({
      where: { tenantId_storeId: scope },
      select: { enabledAt: true, currencyCode: true, receivers: { where: { userId: ctx.userId }, select: { userId: true } } },
    }),
  ])
  if (!membership) throw new InventoryError('STORE_ACCESS_DENIED', 403)
  if (proof && membership.user.telegramId !== proof.telegramId) throw new InventoryError('PERSON_PROOF_INVALID', 403)
  if (!inventory?.enabledAt) throw new InventoryError('NATIVE_INVENTORY_DISABLED', 403)
  if (membership.store.currencyCode !== inventory.currencyCode) throw new InventoryError('INVENTORY_CURRENCY_MISMATCH', 409)
  const isOwner = (!proof || proof.role === 'OWNER') && membership.role === 'OWNER' && membership.user.role === 'OWNER'
  if (!isOwner && !inventory.receivers.length) throw new InventoryError('RECEIVING_ACCESS_DENIED', 403)
  return { ...scope, userId: ctx.userId, role: isOwner ? 'OWNER' : 'RECEIVER', currencyCode: membership.store.currencyCode, storeName: membership.store.name }
}

export async function inventoryTelegramPerson(req: NextRequest) {
  const token = req.cookies.get('auth-session')?.value
  if (token && verifySession(token)?.opsRole) throw new InventoryError('PERSON_REQUIRED', 403)
  const ctx = await getContext(req)
  if (!ctx) throw new InventoryError('PERSON_REQUIRED', 401)
  return inventoryMembership(ctx, { role: ctx.role, telegramId: verifiedInventoryTelegramId(req) })
}

export async function inventoryPerson(req: NextRequest): Promise<InventoryPerson> {
  if (req.headers.get('x-lightops-client') === 'desktop-pos' || req.headers.has('x-pos-device-token') ||
      req.headers.has('x-pos-device-id') || req.headers.has('authorization') || req.headers.has('x-inventory-operator')) {
    const device = await inventoryDesktopDevice(req)
    const userId = await desktopOperatorClaim(req, device)
    if (!userId) throw new InventoryError('DESKTOP_OPERATOR_REQUIRED', 403)
    try {
      return await inventoryMembership({ ...device, userId }, null)
    } catch (error) {
      if (error instanceof InventoryError && ['STORE_ACCESS_DENIED', 'RECEIVING_ACCESS_DENIED'].includes(error.code)) {
        throw new InventoryError('DESKTOP_OPERATOR_REVOKED', 403)
      }
      throw error
    }
  }
  return inventoryTelegramPerson(req)
}

export function requireInventoryOwner(person: InventoryPerson) {
  if (person.role !== 'OWNER') throw new InventoryError('OWNER_REQUIRED', 403)
}
