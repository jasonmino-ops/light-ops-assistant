/**
 * POST /api/ops/admins/[id]/reset-password — reset admin password (SUPER_ADMIN only)
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkOpsAuth } from '@/lib/ops-auth'
import { hashPassword } from '@/lib/password'

function genPassword(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const opsRole = checkOpsAuth(req)
  if (!opsRole) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  if (opsRole !== 'SUPER_ADMIN') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const { id } = await params
  const newPassword = genPassword()

  try {
    await prisma.opsAdmin.update({ where: { id }, data: { passwordHash: hashPassword(newPassword) } })
    return NextResponse.json({ ok: true, newPassword })
  } catch {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }
}
