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

// OPS_TG_IDS: backward-compat whitelist (deprecated; prefer OpsAdmin.telegramId)
const OPS_TG_IDS = (process.env.OPS_TG_IDS ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean)

function issueOpsSession(opsRole: string): NextResponse {
  const sessionToken = signSession({
    tenantId: '_ops',
    userId: '_ops_tg',
    storeId: '',
    role: 'OWNER',
    opsRole,
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

    // ── HMAC verification ──────────────────────────────────────────────────────
    // Strict separation: when OPS_BOT_TOKEN (mino_ops_admin_bot) is configured,
    // ONLY accept initData signed by that bot — no fallback to the merchant bot token.
    // This prevents merchant-bot users from accidentally authenticating to the ops endpoint.
    //
    // Single-bot / dev mode: if OPS_BOT_TOKEN is not set, fall back to TELEGRAM_BOT_TOKEN.
    const opsToken = process.env.OPS_BOT_TOKEN?.trim()
    const tgToken = process.env.TELEGRAM_BOT_TOKEN?.trim()

    if (!opsToken && !tgToken) {
      return NextResponse.json({
        ok: false, error: 'MISSING_BOT_TOKEN',
        message: '未配置 OPS_BOT_TOKEN（mino_ops_admin_bot token），请在 Vercel 环境变量中设置',
      }, { status: 500 })
    }

    // If OPS_BOT_TOKEN is set → strict: only accept ops bot initData
    // If OPS_BOT_TOKEN is not set → fall back to TELEGRAM_BOT_TOKEN (dev / single-bot mode)
    const valid = opsToken
      ? verifyTelegramWebAppData(initData, opsToken)
      : (tgToken ? verifyTelegramWebAppData(initData, tgToken) : false)

    if (!valid) {
      return NextResponse.json({
        ok: false, error: 'OPS_INITDATA_INVALID',
        message: 'Telegram 签名验证失败，请确认使用的是 mino_ops_admin_bot 打开的页面，且 OPS_BOT_TOKEN 与该 bot token 一致',
      }, { status: 401 })
    }

    const tgUser = parseTelegramUser(initData)
    if (!tgUser?.id) {
      return NextResponse.json({ ok: false, error: 'MISSING_TELEGRAM_USER' }, { status: 400 })
    }

    const telegramId = String(tgUser.id)

    // ── New: OpsAdmin table lookup ────────────────────────────────────────────
    const admin = await prisma.opsAdmin.findFirst({
      where: { telegramId, status: 'ACTIVE' },
      select: { role: true },
    })

    if (admin) {
      return issueOpsSession(admin.role)
    }

    // ── Hint: admin exists but is DISABLED? ───────────────────────────────────
    const disabledAdmin = await prisma.opsAdmin.findFirst({
      where: { telegramId, status: 'DISABLED' },
      select: { name: true },
    })
    if (disabledAdmin) {
      return NextResponse.json({
        ok: false, error: 'ADMIN_DISABLED',
        message: `管理员「${disabledAdmin.name}」已被停用，请在 /ops/admins 中重新启用`,
      }, { status: 403 })
    }

    // ── Backward-compat: OPS_TG_IDS whitelist → SUPER_ADMIN ──────────────────
    if (OPS_TG_IDS.length > 0) {
      if (OPS_TG_IDS.includes(telegramId)) {
        return issueOpsSession('SUPER_ADMIN')
      }
      return NextResponse.json(
        { ok: false, error: 'FORBIDDEN', message: '该 Telegram 账号无 ops 访问权限，请联系运营管理员' },
        { status: 403 },
      )
    }

    // ── Backward-compat: DB user lookup ──────────────────────────────────────
    const user = await prisma.user.findFirst({
      where: { telegramId, role: 'OWNER' },
      select: { id: true, role: true, tenantId: true, status: true },
    })

    if (!user || user.status !== 'ACTIVE') {
      return NextResponse.json({
        ok: false, error: 'OPS_USER_NOT_FOUND',
        message: `Telegram ID ${telegramId} 未绑定任何 ops 管理员账号，请在 /ops/admins 中绑定`,
      }, { status: 403 })
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
      opsRole: 'OPS_ADMIN',
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
