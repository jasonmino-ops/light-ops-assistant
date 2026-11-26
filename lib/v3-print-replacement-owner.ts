import type { NextRequest } from 'next/server'
import { getContext } from './context'
import { prisma } from './prisma'
import { verifySession } from './session'
import { extractTgUserIdFromParams, verifyTgInitData } from './verify-tg-init-data'

// A device-issued owner Web cookie is sufficient for existing settings but cannot prove a person approved a change of executor.
export async function printReplacementOwner(req: NextRequest) {
  const token = req.cookies.get('auth-session')?.value
  const session = token && verifySession(token)
  if (!process.env.AUTH_SECRET?.trim() || !session || session.opsRole || session.role !== 'OWNER') return null
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim()
  const init = req.headers.get('x-telegram-init-data')
  if (!botToken || !init || init.length > 16384) return null
  const proof = verifyTgInitData(init, botToken)
  const id = proof && extractTgUserIdFromParams(proof)
  const issued = Number(proof?.get('auth_date'))
  const seconds = Math.floor(Date.now() / 1000)
  if (!id || !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(issued) || issued > seconds + 60 || issued < seconds - 900) return null
  const ctx = await getContext(req)
  if (!ctx || ctx.role !== 'OWNER' || ctx.tenantId !== session.tenantId || ctx.userId !== session.userId || ctx.storeId !== session.storeId) return null
  const member = await prisma.userStoreRole.findFirst({ where: { tenantId: ctx.tenantId, storeId: ctx.storeId,
    userId: ctx.userId, role: 'OWNER', status: 'ACTIVE', user: { tenantId: ctx.tenantId, status: 'ACTIVE', role: 'OWNER', telegramId: id },
    store: { tenantId: ctx.tenantId, status: 'ACTIVE', tenant: { status: 'ACTIVE' } } }, select: { userId: true } })
  return member ? ctx : null
}
