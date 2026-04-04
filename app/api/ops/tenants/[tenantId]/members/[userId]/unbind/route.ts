/**
 * POST /api/ops/tenants/[tenantId]/members/[userId]/unbind
 * Unbind a user's Telegram account (cross-tenant, ops-admin only).
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkOpsAuth } from '@/lib/ops-auth'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tenantId: string; userId: string }> },
) {
  const opsRole = checkOpsAuth(req)
  if (!opsRole) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  if (opsRole === 'BD') return NextResponse.json({ error: 'FORBIDDEN', message: 'BD 角色无解绑权限' }, { status: 403 })
  const { tenantId, userId } = await params

  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId, status: 'ACTIVE' },
    select: { id: true, displayName: true, username: true, telegramId: true },
  })

  if (!user) return NextResponse.json({ error: 'USER_NOT_FOUND' }, { status: 404 })
  if (!user.telegramId) return NextResponse.json({ error: 'NOT_BOUND' }, { status: 400 })

  await prisma.user.update({ where: { id: userId }, data: { telegramId: null } })

  return NextResponse.json({ ok: true, displayName: user.displayName || user.username })
}
