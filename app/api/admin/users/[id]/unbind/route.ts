/**
 * POST /api/admin/users/[id]/unbind  — OWNER only
 *
 * Clears the telegramId of the specified user so they can re-bind with a
 * new Telegram account.  The user record stays ACTIVE; only the Telegram
 * identity link is removed.
 *
 * Restrictions:
 *  - OWNER only
 *  - Cannot unbind yourself (prevents self-lockout)
 *  - Target user must belong to the same tenant
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') {
    return NextResponse.json(
      { error: 'FORBIDDEN', message: '只有老板可以解绑账号' },
      { status: 403 },
    )
  }

  const { id } = await params

  if (id === ctx.userId) {
    return NextResponse.json(
      { error: 'SELF_UNBIND', message: '不能解绑自己的账号，请联系其他管理员操作' },
      { status: 400 },
    )
  }

  const user = await prisma.user.findFirst({
    where: { id, tenantId: ctx.tenantId, status: 'ACTIVE' },
  })
  if (!user) {
    return NextResponse.json({ error: 'USER_NOT_FOUND' }, { status: 404 })
  }
  if (!user.telegramId) {
    return NextResponse.json(
      { error: 'NOT_BOUND', message: '该用户尚未绑定 Telegram 账号' },
      { status: 400 },
    )
  }

  await prisma.user.update({
    where: { id },
    data: { telegramId: null },
  })

  return NextResponse.json({ ok: true })
}
