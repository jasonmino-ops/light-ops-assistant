/**
 * GET /api/admin/users  — OWNER only
 *
 * Returns all active users in the tenant with their Telegram binding status
 * and primary store assignment.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

export async function GET(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  const users = await prisma.user.findMany({
    where: { tenantId: ctx.tenantId, status: 'ACTIVE' },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      username: true,
      displayName: true,
      role: true,
      telegramId: true,
      staffNumber: true,
      storeRoles: {
        where: { status: 'ACTIVE' },
        take: 1,
        select: { store: { select: { name: true } } },
      },
    },
  })

  return NextResponse.json(
    users.map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      role: u.role,
      bound: !!u.telegramId,
      staffNumber: u.staffNumber ?? null,
      storeName: u.storeRoles[0]?.store.name ?? '—',
    })),
  )
}
