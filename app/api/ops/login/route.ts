/**
 * POST /api/ops/login — web password login for the ops admin backend.
 *
 * Looks up the admin in the OpsAdmin table. On the very first call, if the
 * table is empty, auto-seeds a SUPER_ADMIN from OPS_USERNAME/OPS_PASSWORD
 * env vars (migration convenience — remove seed logic once bootstrapped).
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyPassword, hashPassword } from '@/lib/password'
import { signSession } from '@/lib/session'

export async function POST(req: NextRequest) {
  let body: { username?: string; password?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const { username = '', password = '' } = body
  if (!username.trim() || !password) {
    return NextResponse.json({ error: 'MISSING_FIELDS' }, { status: 400 })
  }

  // ── Auto-seed: create SUPER_ADMIN on first login if table is empty ────────
  const OPS_USERNAME = process.env.OPS_USERNAME ?? 'admin'
  const OPS_PASSWORD = process.env.OPS_PASSWORD ?? ''
  if (OPS_PASSWORD) {
    const count = await prisma.opsAdmin.count()
    if (count === 0) {
      await prisma.opsAdmin.create({
        data: {
          name: 'Super Admin',
          username: OPS_USERNAME,
          passwordHash: hashPassword(OPS_PASSWORD),
          role: 'SUPER_ADMIN',
          status: 'ACTIVE',
        },
      })
    }
  }

  // ── Look up admin ─────────────────────────────────────────────────────────
  const admin = await prisma.opsAdmin.findFirst({
    where: { username: username.trim(), status: 'ACTIVE' },
  })

  if (!admin || !admin.passwordHash) {
    return NextResponse.json({ error: 'INVALID_CREDENTIALS', message: '用户名或密码错误' }, { status: 401 })
  }

  if (!verifyPassword(password, admin.passwordHash)) {
    return NextResponse.json({ error: 'INVALID_CREDENTIALS', message: '用户名或密码错误' }, { status: 401 })
  }

  const sessionToken = signSession({
    tenantId: '_ops',
    userId: admin.id,
    storeId: '',
    role: 'OWNER',
    opsRole: admin.role,
  })

  const isProd = process.env.NODE_ENV === 'production'
  const res = NextResponse.json({ ok: true, opsRole: admin.role })
  res.cookies.set('auth-session', sessionToken, {
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd,
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  })
  return res
}
