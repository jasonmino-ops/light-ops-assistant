/**
 * POST /api/admin/users/[id]/resign  — OWNER only
 *
 * Formal resignation / archive of a staff member.
 * Clears telegramId AND sets status = DISABLED in one atomic update.
 *
 * All historical data (SaleRecord, logs, stats) is preserved unchanged.
 * The user will no longer appear in the default active member list.
 *
 * Restrictions:
 *  - OWNER only
 *  - Cannot resign yourself
 *  - Cannot resign another OWNER (would remove tenant ownership)
 *  - Target must belong to the same tenant
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') {
    return NextResponse.json({ error: 'FORBIDDEN', message: '只有老板可以操作员工归档' }, { status: 403 })
  }

  const { id } = await params

  if (id === ctx.userId) {
    return NextResponse.json({ error: 'SELF_RESIGN', message: '不能归档自己的账号' }, { status: 400 })
  }

  const user = await prisma.user.findFirst({
    where: { id, tenantId: ctx.tenantId },
    select: { id: true, displayName: true, username: true, role: true, status: true },
  })
  if (!user) return NextResponse.json({ error: 'USER_NOT_FOUND' }, { status: 404 })
  if (user.role === 'OWNER') {
    return NextResponse.json({ error: 'CANNOT_RESIGN_OWNER', message: '不能归档老板账号' }, { status: 400 })
  }
  if (user.status === 'DISABLED') {
    return NextResponse.json({ error: 'ALREADY_ARCHIVED', message: '该员工已是归档状态' }, { status: 400 })
  }

  await prisma.user.update({
    where: { id },
    data: { telegramId: null, status: 'DISABLED' },
  })

  return NextResponse.json({ ok: true, displayName: user.displayName || user.username })
}
