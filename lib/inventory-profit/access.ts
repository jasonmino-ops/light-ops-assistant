import { NextRequest, NextResponse } from 'next/server'
import { getContext, type RequestContext } from '@/lib/context'
import { prisma } from '@/lib/prisma'
import { extractTgUserIdFromParams, verifyTgInitData } from '@/lib/verify-tg-init-data'

export type InventoryProfitAccess = {
  ctx: RequestContext
  pilotStoreId: string
}

export type InventoryProfitAccessResult =
  | { ok: true; access: InventoryProfitAccess }
  | { ok: false; response: NextResponse }

function denied(error: string, status: number): InventoryProfitAccessResult {
  return {
    ok: false,
    response: NextResponse.json({ ok: false, error }, {
      status,
      headers: { 'cache-control': 'no-store' },
    }),
  }
}

export async function requireInventoryProfitAccess(
  req: NextRequest,
  options: { telegramPresence?: boolean } = {},
): Promise<InventoryProfitAccessResult> {
  const ctx = await getContext(req)
  if (!ctx) return denied('MISSING_CONTEXT', 401)
  if (ctx.role !== 'OWNER') return denied('OWNER_REQUIRED', 403)

  const pilotStoreId = process.env.INVENTORY_PROFIT_PILOT_STORE_ID?.trim()
  if (!pilotStoreId) return denied('PILOT_NOT_CONFIGURED', 503)
  if (ctx.storeId !== pilotStoreId) return denied('PILOT_STORE_REQUIRED', 403)

  if (options.telegramPresence) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim()
    if (!botToken) return denied('TELEGRAM_PRESENCE_NOT_CONFIGURED', 503)
    const initData = req.headers.get('x-telegram-init-data')
    if (!initData) return denied('TELEGRAM_PRESENCE_REQUIRED', 403)
    const params = verifyTgInitData(initData, botToken)
    const telegramId = params ? extractTgUserIdFromParams(params) : null
    const authDate = params ? Number(params.get('auth_date')) : Number.NaN
    const nowSeconds = Math.floor(Date.now() / 1000)
    if (
      !params ||
      !telegramId ||
      !Number.isFinite(authDate) ||
      authDate > nowSeconds + 60 ||
      nowSeconds - authDate > 15 * 60
    ) {
      return denied('TELEGRAM_PRESENCE_INVALID', 403)
    }
    const user = await prisma.user.findFirst({
      where: {
        id: ctx.userId,
        tenantId: ctx.tenantId,
        role: 'OWNER',
        status: 'ACTIVE',
      },
      select: { telegramId: true },
    })
    if (!user?.telegramId || user.telegramId !== telegramId) {
      return denied('TELEGRAM_PRESENCE_MISMATCH', 403)
    }
  }

  return { ok: true, access: { ctx, pilotStoreId } }
}
