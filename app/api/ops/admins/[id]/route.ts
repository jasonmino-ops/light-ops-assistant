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
  const opsRole = checkOpsAuth(req)
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

  try {
    const updated = await prisma.opsAdmin.update({ where: { id }, data })
    return NextResponse.json({ ok: true, id: updated.id, role: updated.role, status: updated.status })
  } catch {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const opsRole = checkOpsAuth(req)
  if (!opsRole) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  if (opsRole !== 'SUPER_ADMIN') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const { id } = await params
  try {
    await prisma.opsAdmin.update({ where: { id }, data: { status: 'DISABLED' } })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }
}
