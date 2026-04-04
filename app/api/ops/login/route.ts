/**
 * POST /api/ops/login — web password login for the ops admin backend.
 *
 * Credentials are stored in env vars:
 *   OPS_USERNAME  — ops admin username (default: "admin")
 *   OPS_PASSWORD  — ops admin password (required; no default)
 *
 * On success issues an auth-session cookie with the special _ops_admin
 * userId, which checkOpsAuth() unconditionally accepts regardless of
 * the OPS_USER_IDS whitelist.
 */
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { signSession } from '@/lib/session'

const OPS_USERNAME = process.env.OPS_USERNAME ?? 'admin'
const OPS_PASSWORD = process.env.OPS_PASSWORD ?? ''

/** Timing-safe string comparison via HMAC — avoids length-timing leak. */
function safeEqual(a: string, b: string): boolean {
  const key = 'ops-check'
  const ha = crypto.createHmac('sha256', key).update(a).digest()
  const hb = crypto.createHmac('sha256', key).update(b).digest()
  return crypto.timingSafeEqual(ha, hb)
}

export async function POST(req: NextRequest) {
  if (!OPS_PASSWORD) {
    return NextResponse.json(
      { error: 'NOT_CONFIGURED', message: '后台账号未配置，请设置 OPS_PASSWORD 环境变量' },
      { status: 503 },
    )
  }

  let body: { username?: string; password?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const { username = '', password = '' } = body

  if (!safeEqual(username, OPS_USERNAME) || !safeEqual(password, OPS_PASSWORD)) {
    return NextResponse.json(
      { error: 'INVALID_CREDENTIALS', message: '用户名或密码错误' },
      { status: 401 },
    )
  }

  const sessionToken = signSession({
    tenantId: '_ops',
    userId: '_ops_admin',
    storeId: '',
    role: 'OWNER',
  })

  const isProd = process.env.NODE_ENV === 'production'
  const res = NextResponse.json({ ok: true })
  res.cookies.set('auth-session', sessionToken, {
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd,
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  })
  return res
}
