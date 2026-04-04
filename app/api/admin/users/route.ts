/**
 * GET /api/admin/users  — OWNER only
 *
 * By default returns only ACTIVE users (default member list).
 * Pass ?includeArchived=true to also include DISABLED users (resigned staff).
 * Returns status field so the UI can distinguish active vs archived members.
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

  const includeArchived = req.nextUrl.searchParams.get('includeArchived') === 'true'

  const users = await prisma.user.findMany({
    where: {
      tenantId: ctx.tenantId,
      ...(includeArchived ? {} : { status: 'ACTIVE' }),
    },
    orderBy: [{ status: 'asc' }, { role: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      username: true,
      displayName: true,
      role: true,
      status: true,
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
      status: u.status,
      bound: !!u.telegramId,
      staffNumber: u.staffNumber ?? null,
      storeName: u.storeRoles[0]?.store.name ?? '—',
    })),
  )
}
