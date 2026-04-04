/**
 * GET  /api/ops/admins        — list all ops admins (SUPER_ADMIN only)
 * POST /api/ops/admins        — create new ops admin (SUPER_ADMIN only)
 * PATCH /api/ops/admins/[id]  — update admin (SUPER_ADMIN only)
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkOpsAuth } from '@/lib/ops-auth'
import { hashPassword } from '@/lib/password'

export async function GET(req: NextRequest) {
  const opsRole = checkOpsAuth(req)
  if (!opsRole) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  if (opsRole !== 'SUPER_ADMIN') return NextResponse.json({ error: 'FORBIDDEN', message: '仅 SUPER_ADMIN 可管理管理员列表' }, { status: 403 })

  const admins = await prisma.opsAdmin.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, name: true, username: true, role: true, status: true,
      telegramId: true, createdAt: true,
    },
  })

  return NextResponse.json(admins.map((a) => ({
    ...a,
    telegramId: a.telegramId ? '(bound)' : null, // redacted
    createdAt: a.createdAt.toISOString(),
  })))
}

export async function POST(req: NextRequest) {
  const opsRole = checkOpsAuth(req)
  if (!opsRole) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  if (opsRole !== 'SUPER_ADMIN') return NextResponse.json({ error: 'FORBIDDEN', message: '仅 SUPER_ADMIN 可新增管理员' }, { status: 403 })

  let body: { name?: string; username?: string; password?: string; telegramId?: string; role?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const { name, username, password, telegramId, role = 'OPS_ADMIN' } = body
  if (!name?.trim()) return NextResponse.json({ error: 'MISSING_NAME' }, { status: 400 })
  if (!username?.trim()) return NextResponse.json({ error: 'MISSING_USERNAME' }, { status: 400 })
  if (!['SUPER_ADMIN', 'OPS_ADMIN', 'BD'].includes(role)) return NextResponse.json({ error: 'INVALID_ROLE' }, { status: 400 })

  const existing = await prisma.opsAdmin.findFirst({ where: { username: username.trim() } })
  if (existing) return NextResponse.json({ error: 'USERNAME_TAKEN', message: '用户名已存在' }, { status: 409 })

  const admin = await prisma.opsAdmin.create({
    data: {
      name: name.trim(),
      username: username.trim(),
      passwordHash: password ? hashPassword(password) : null,
      telegramId: telegramId?.trim() || null,
      role,
      status: 'ACTIVE',
    },
  })

  return NextResponse.json({
    id: admin.id,
    name: admin.name,
    username: admin.username,
    role: admin.role,
    status: admin.status,
    telegramBound: !!admin.telegramId,
    createdAt: admin.createdAt.toISOString(),
  }, { status: 201 })
}
