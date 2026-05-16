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

const MAX_FAILS = 5
const LOCK_MS   = 15 * 60 * 1000

async function audit(action: string, adminId: string | null, username: string, message: string, ok: boolean) {
  try {
    await prisma.operationLog.create({
      data: {
        tenantId:   '_ops',
        userId:     null,
        actionType: action,
        targetType: 'OpsAdmin',
        targetId:   adminId,
        status:     ok ? 'SUCCESS' : 'FAILED',
        message,
        payloadSnapshot: { username },
      },
    })
  } catch { /* swallow */ }
}

export async function POST(req: NextRequest) {
  let body: { username?: string; password?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const { username = '', password = '' } = body
  const uname = username.trim()
  if (!uname || !password) {
    return NextResponse.json({ error: 'MISSING_FIELDS' }, { status: 400 })
  }

  // ── Auto-seed：仅当 OPS_AUTO_SEED=true 时启用（生产上线后请关闭并删除 OPS_PASSWORD）
  const AUTO_SEED    = process.env.OPS_AUTO_SEED === 'true'
  const OPS_USERNAME = process.env.OPS_USERNAME ?? 'admin'
  const OPS_PASSWORD = process.env.OPS_PASSWORD ?? ''
  if (AUTO_SEED && OPS_PASSWORD) {
    const count = await prisma.opsAdmin.count()
    if (count === 0) {
      const seeded = await prisma.opsAdmin.create({
        data: {
          name: 'Super Admin',
          username: OPS_USERNAME,
          passwordHash: hashPassword(OPS_PASSWORD),
          role: 'SUPER_ADMIN',
          status: 'ACTIVE',
        },
      })
      await audit('OPS_SEED', seeded.id, OPS_USERNAME, 'auto-seed first SUPER_ADMIN', true)
    }
  }

  const admin = await prisma.opsAdmin.findFirst({ where: { username: uname } })

  if (!admin || !admin.passwordHash || admin.status !== 'ACTIVE') {
    await audit('OPS_LOGIN_FAIL', admin?.id ?? null, uname, 'admin not found or disabled', false)
    return NextResponse.json({ error: 'INVALID_CREDENTIALS', message: '用户名或密码错误' }, { status: 401 })
  }

  // 锁定窗口检查
  if (admin.lockedUntil && admin.lockedUntil.getTime() > Date.now()) {
    await audit('OPS_LOGIN_LOCKED', admin.id, uname, `locked until ${admin.lockedUntil.toISOString()}`, false)
    return NextResponse.json({
      error: 'ACCOUNT_LOCKED',
      message: '登录失败次数过多，账号已锁定，请稍后再试',
      lockedUntil: admin.lockedUntil.toISOString(),
    }, { status: 423 })
  }

  if (!verifyPassword(password, admin.passwordHash)) {
    const nextFails = (admin.failedLoginCount ?? 0) + 1
    const willLock  = nextFails >= MAX_FAILS
    await prisma.opsAdmin.update({
      where: { id: admin.id },
      data: {
        failedLoginCount: willLock ? 0 : nextFails,
        lockedUntil:      willLock ? new Date(Date.now() + LOCK_MS) : admin.lockedUntil,
      },
    }).catch(() => {})
    await audit('OPS_LOGIN_FAIL', admin.id, uname, `bad password (fails=${nextFails}${willLock ? ', locked' : ''})`, false)
    if (willLock) await audit('OPS_ACCOUNT_LOCKED', admin.id, uname, `${MAX_FAILS} fails → lock ${LOCK_MS / 60000}min`, true)
    return NextResponse.json({ error: 'INVALID_CREDENTIALS', message: '用户名或密码错误' }, { status: 401 })
  }

  // 成功：清零失败次数 / 锁定
  await prisma.opsAdmin.update({
    where: { id: admin.id },
    data:  { failedLoginCount: 0, lockedUntil: null },
  }).catch(() => {})

  const sessionToken = signSession({
    tenantId: '_ops',
    userId:   admin.id,
    storeId:  '',
    role:     'OWNER',
    opsRole:  admin.role,
    opsSessionVersion: admin.sessionVersion ?? 0,
  })

  await audit('OPS_LOGIN_OK', admin.id, uname, `role=${admin.role}, ver=${admin.sessionVersion ?? 0}`, true)

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
