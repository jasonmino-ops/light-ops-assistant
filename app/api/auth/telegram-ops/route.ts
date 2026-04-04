/**
 * POST /api/auth/telegram-ops
 *
 * Ops-admin specific Telegram auth endpoint.
 *
 * Why separate from /api/auth/telegram:
 *   The main mini-app bot and the Mino ops bot may have different bot tokens.
 *   /api/auth/telegram uses TELEGRAM_BOT_TOKEN and scopes user lookup to TENANT_ID.
 *   This endpoint uses OPS_BOT_TOKEN (falls back to TELEGRAM_BOT_TOKEN if not set)
 *   and searches for the user across ALL tenants by telegramId.
 *
 * Required env vars:
 *   OPS_BOT_TOKEN  — bot token for the ops Telegram bot (separate bot)
 *                    If not set, falls back to TELEGRAM_BOT_TOKEN.
 *   AUTH_SECRET    — used to sign the session cookie
 *
 * The issued session is then validated by checkOpsAuth() (role=OWNER + OPS_USER_IDS).
 */
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { signSession } from '@/lib/session'

const OPS_BOT_TOKEN = process.env.OPS_BOT_TOKEN ?? process.env.TELEGRAM_BOT_TOKEN ?? ''

function verifyInitData(initData: string): URLSearchParams | null {
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) return null

  params.delete('hash')
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(OPS_BOT_TOKEN).digest()
  const expected = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex')

  return expected === hash ? params : null
}

export async function POST(req: NextRequest) {
  let body: { initData?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const { initData } = body
  if (!initData) return NextResponse.json({ error: 'MISSING_INIT_DATA' }, { status: 400 })

  // Verify or skip (dev mode — no token configured)
  let params: URLSearchParams
  if (!OPS_BOT_TOKEN) {
    params = new URLSearchParams(initData)
  } else {
    const verified = verifyInitData(initData)
    if (!verified) {
      return NextResponse.json(
        { error: 'INVALID_SIGNATURE', message: 'Ops initData 签名验证失败' },
        { status: 401 },
      )
    }
    params = verified
  }

  const userStr = params.get('user')
  if (!userStr) return NextResponse.json({ error: 'MISSING_USER' }, { status: 400 })

  let telegramUserId: string
  try {
    telegramUserId = String(JSON.parse(userStr).id)
  } catch {
    return NextResponse.json({ error: 'INVALID_USER_PAYLOAD' }, { status: 400 })
  }

  // Search across ALL tenants (ops admin may belong to any tenant)
  const user = await prisma.user.findFirst({
    where: { telegramId: telegramUserId, status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    include: {
      storeRoles: {
        where: { status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: { storeId: true },
      },
    },
  })

  if (!user) {
    return NextResponse.json(
      { error: 'USER_NOT_FOUND', message: '未找到绑定账号，请联系运营管理员' },
      { status: 404 },
    )
  }

  let storeId = user.storeRoles[0]?.storeId
  if (!storeId) {
    const firstStore = await prisma.store.findFirst({
      where: { tenantId: user.tenantId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
    storeId = firstStore?.id ?? ''
  }

  const sessionToken = signSession({
    tenantId: user.tenantId,
    userId: user.id,
    storeId,
    role: user.role,
  })

  const isProd = process.env.NODE_ENV === 'production'
  const res = NextResponse.json({ ok: true, role: user.role })
  res.cookies.set('auth-session', sessionToken, {
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd,
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  })
  return res
}
