import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { signSession } from '@/lib/session'

function verifyTelegramWebAppData(initData: string, botToken: string) {
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) return false

  params.delete('hash')
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')

  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
  const calc = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex')
  return calc === hash
}

function parseTelegramUser(initData: string) {
  const params = new URLSearchParams(initData)
  const raw = params.get('user')
  if (!raw) return null
  try {
    return JSON.parse(raw) as {
      id: number
      username?: string
      first_name?: string
      last_name?: string
    }
  } catch {
    return null
  }
}

// Comma-separated Telegram user IDs that may access /ops without a DB user record.
// If set, ONLY these IDs are allowed via Telegram; others are rejected.
// If empty, falls back to DB user lookup (backward-compat).
const OPS_TG_IDS = (process.env.OPS_TG_IDS ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean)

function issueOpsSession(): NextResponse {
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
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  })
  return res
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const initData = String(body?.initData || '')
    if (!initData) {
      return NextResponse.json({ ok: false, error: 'MISSING_INIT_DATA' }, { status: 400 })
    }

    const botToken = process.env.OPS_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN
    if (!botToken) {
      return NextResponse.json({ ok: false, error: 'MISSING_OPS_BOT_TOKEN' }, { status: 500 })
    }

    const valid = verifyTelegramWebAppData(initData, botToken)
    if (!valid) {
      return NextResponse.json({ ok: false, error: 'OPS_INITDATA_INVALID' }, { status: 401 })
    }

    const tgUser = parseTelegramUser(initData)
    if (!tgUser?.id) {
      return NextResponse.json({ ok: false, error: 'MISSING_TELEGRAM_USER' }, { status: 400 })
    }

    const telegramId = String(tgUser.id)

    // ── OPS_TG_IDS whitelist mode ─────────────────────────────────────────
    // If the env var is populated, it is the sole gate for Telegram access.
    if (OPS_TG_IDS.length > 0) {
      if (!OPS_TG_IDS.includes(telegramId)) {
        return NextResponse.json(
          { ok: false, error: 'FORBIDDEN', message: '该 Telegram 账号无 ops 访问权限，请联系运营管理员' },
          { status: 403 },
        )
      }
      return issueOpsSession()
    }

    // ── Backward-compat: DB user lookup ───────────────────────────────────
    const user = await prisma.user.findFirst({
      where: { telegramId, role: 'OWNER' },
      select: { id: true, role: true, tenantId: true, status: true },
    })

    if (!user) {
      return NextResponse.json({ ok: false, error: 'OPS_USER_NOT_FOUND' }, { status: 403 })
    }

    if (user.status !== 'ACTIVE') {
      return NextResponse.json({ ok: false, error: 'OPS_USER_INACTIVE' }, { status: 403 })
    }

    const defaultStore = await prisma.store.findFirst({
      where: { tenantId: user.tenantId, status: 'ACTIVE' },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    })

    if (!defaultStore) {
      return NextResponse.json({ ok: false, error: 'OPS_STORE_NOT_FOUND' }, { status: 500 })
    }

    const session = await signSession({
      userId: user.id,
      role: user.role,
      tenantId: user.tenantId,
      storeId: defaultStore.id,
    })

    const isProd = process.env.NODE_ENV === 'production'
    const res = NextResponse.json({ ok: true })
    res.cookies.set('auth-session', session, {
      httpOnly: true,
      sameSite: isProd ? 'none' : 'lax',
      secure: isProd,
      path: '/',
      maxAge: 60 * 60 * 24 * 14,
    })
    return res
  } catch (err) {
    console.error('telegram-ops auth error:', err)
    return NextResponse.json({ ok: false, error: 'OPS_AUTH_INTERNAL_ERROR' }, { status: 500 })
  }
}
