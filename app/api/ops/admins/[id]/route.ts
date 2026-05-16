/**
 * PATCH /api/ops/admins/[id] — update ops admin (SUPER_ADMIN only)
 * DELETE /api/ops/admins/[id] — disable ops admin (SUPER_ADMIN only)
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkOpsAuth } from '@/lib/ops-auth'
import { hashPassword } from '@/lib/password'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const opsRole = await checkOpsAuth(req)
  if (!opsRole) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  if (opsRole !== 'SUPER_ADMIN') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const { id } = await params
  let body: { name?: string; role?: string; password?: string; telegramId?: string; status?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const data: Record<string, unknown> = {}
  if (body.name?.trim()) data.name = body.name.trim()
  if (body.role && ['SUPER_ADMIN', 'OPS_ADMIN', 'BD'].includes(body.role)) data.role = body.role
  if (body.password) data.passwordHash = hashPassword(body.password)
  if (body.telegramId !== undefined) data.telegramId = body.telegramId?.trim() || null
  if (body.status && ['ACTIVE', 'DISABLED'].includes(body.status)) data.status = body.status

  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'NO_CHANGE' }, { status: 400 })

  // 任一高风险字段变更同时 bump sessionVersion 强制旧 cookie 失效
  const needBump = data.passwordHash !== undefined
    || data.telegramId !== undefined
    || data.status === 'DISABLED'

  try {
    const before = await prisma.opsAdmin.findUnique({
      where: { id },
      select: { telegramId: true, status: true, role: true },
    })
    if (!before) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

    const updated = await prisma.opsAdmin.update({
      where: { id },
      data: needBump ? { ...data, sessionVersion: { increment: 1 } } : data,
    })

    const audits: { type: string; message: string }[] = []
    if (data.passwordHash !== undefined) audits.push({ type: 'OPS_PWD_CHANGED', message: 'password updated' })
    if (data.telegramId !== undefined && before.telegramId !== updated.telegramId) {
      audits.push({ type: 'OPS_TG_REBIND', message: `from ${before.telegramId ?? 'null'} to ${updated.telegramId ?? 'null'}` })
    }
    if (data.role !== undefined && before.role !== updated.role) {
      audits.push({ type: 'OPS_ROLE_CHANGED', message: `from ${before.role} to ${updated.role}` })
    }
    if (data.status === 'DISABLED' && before.status !== 'DISABLED') {
      audits.push({ type: 'OPS_DISABLED', message: 'account disabled by SUPER_ADMIN' })
    }
    for (const a of audits) {
      await prisma.operationLog.create({
        data: {
          tenantId:   '_ops',
          userId:     null,
          actionType: a.type,
          targetType: 'OpsAdmin',
          targetId:   id,
          status:     'SUCCESS',
          message:    a.message,
          payloadSnapshot: { opsRole, bumpedSessionVersion: needBump },
        },
      }).catch(() => {})
    }

    return NextResponse.json({ ok: true, id: updated.id, role: updated.role, status: updated.status })
  } catch {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const opsRole = await checkOpsAuth(req)
  if (!opsRole) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  if (opsRole !== 'SUPER_ADMIN') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const { id } = await params
  try {
    await prisma.opsAdmin.update({
      where: { id },
      data:  { status: 'DISABLED', sessionVersion: { increment: 1 } },
    })
    await prisma.operationLog.create({
      data: {
        tenantId:   '_ops',
        userId:     null,
        actionType: 'OPS_DISABLED',
        targetType: 'OpsAdmin',
        targetId:   id,
        status:     'SUCCESS',
        message:    'account disabled (DELETE)',
        payloadSnapshot: { opsRole },
      },
    }).catch(() => {})
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }
}
