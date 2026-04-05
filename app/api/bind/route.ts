/**
 * POST /api/bind
 *
 * Consumes a BindToken to register a new user account.
 *
 * Body: { token: string, initData: string }
 *
 * Flow:
 *  1. Look up the token — must be ACTIVE, not expired, usedCount < maxUses
 *  2. Verify Telegram initData HMAC (skip if no BOT_TOKEN in dev)
 *  3. If this telegramId is already bound to a user in this tenant → error
 *  4. Create User + UserStoreRole
 *  5. Increment usedCount; set status=USED when maxUses reached
 *  6. Sign auth-session cookie → return { ok, role }
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { signSession } from '@/lib/session'

// Dual-token HMAC: try merchant bot first, then ops bot.
// Ops-generated bind tokens may be scanned via the ops bot Mini App, whose
// initData is signed with OPS_BOT_TOKEN rather than TELEGRAM_BOT_TOKEN.
const MERCHANT_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? ''
const OPS_BOT_TOKEN = process.env.OPS_BOT_TOKEN ?? ''

function verifyWithToken(initData: string, botToken: string): URLSearchParams | null {
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) return null
  params.delete('hash')
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
  const expected = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex')
  return expected === hash ? params : null
}

function verifyInitData(initData: string): URLSearchParams | null {
  if (!MERCHANT_BOT_TOKEN && !OPS_BOT_TOKEN) return new URLSearchParams(initData) // dev: skip
  if (MERCHANT_BOT_TOKEN) {
    const result = verifyWithToken(initData, MERCHANT_BOT_TOKEN)
    if (result) return result
  }
  if (OPS_BOT_TOKEN && OPS_BOT_TOKEN !== MERCHANT_BOT_TOKEN) {
    return verifyWithToken(initData, OPS_BOT_TOKEN)
  }
  return null
}

export async function POST(req: NextRequest) {
  let body: { token?: string; initData?: string; displayName?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON', message: '请求格式错误，请重试' }, { status: 400 })
  }

  const { token, initData, displayName: customDisplayName } = body
  if (!token || !initData) {
    return NextResponse.json({ error: 'MISSING_FIELDS', message: '链接参数不完整，请重新扫码' }, { status: 400 })
  }

  // ── 1. Validate bind token ────────────────────────────────────────────────
  const bt = await prisma.bindToken.findUnique({ where: { token } })

  if (!bt || bt.status !== 'ACTIVE') {
    return NextResponse.json(
      { error: 'INVALID_TOKEN', message: '邀请码无效或已失效' },
      { status: 400 },
    )
  }
  if (bt.expiresAt < new Date()) {
    return NextResponse.json(
      { error: 'TOKEN_EXPIRED', message: '邀请码已过期，请联系管理员重新生成' },
      { status: 400 },
    )
  }
  if (bt.usedCount >= bt.maxUses) {
    return NextResponse.json(
      { error: 'TOKEN_EXHAUSTED', message: '邀请码已被使用，请联系管理员' },
      { status: 400 },
    )
  }

  // ── 2. Verify Telegram initData ───────────────────────────────────────────
  const verified = verifyInitData(initData)
  if (!verified) {
    return NextResponse.json(
      { error: 'INVALID_SIGNATURE', message: 'Telegram 签名验证失败' },
      { status: 401 },
    )
  }
  const params = verified

  const userStr = params.get('user')
  if (!userStr) {
    return NextResponse.json({ error: 'MISSING_USER', message: '无法获取 Telegram 用户信息，请重新打开链接' }, { status: 400 })
  }
  let tgUser: { id: number; first_name?: string; last_name?: string; username?: string }
  try {
    tgUser = JSON.parse(userStr)
  } catch {
    return NextResponse.json({ error: 'INVALID_USER_PAYLOAD', message: 'Telegram 用户信息格式错误，请重试' }, { status: 400 })
  }
  const telegramId = String(tgUser.id)

  // ── 3. Check if telegramId already bound to ANY active user globally ─────
  // Rule: one Telegram account → one active user binding across all tenants.
  // Same-tenant multi-store is NOT a conflict (user already exists, just re-scanned).
  // Cross-tenant and same-tenant different-user are both blocked.
  const existing = await prisma.user.findFirst({
    where: { telegramId, status: 'ACTIVE' },
    select: { displayName: true, tenantId: true, tenant: { select: { name: true, status: true } } },
  })
  if (existing) {
    const isSameTenant = existing.tenantId === bt.tenantId
    const tenantArchived = existing.tenant?.status === 'ARCHIVED'
    const message = isSameTenant
      ? `该 Telegram 账号已绑定本商户账号「${existing.displayName}」，如需重新绑定请联系管理员解绑`
      : tenantArchived
        ? `该 Telegram 账号已绑定已归档商户「${existing.tenant?.name ?? ''}」，请联系运营管理员解绑后重试`
        : `该 Telegram 账号已绑定其他商户「${existing.tenant?.name ?? ''}」，不允许跨商户重复绑定，请联系运营管理员`
    return NextResponse.json({ error: 'ALREADY_BOUND', message }, { status: 409 })
  }

  // ── 4. Create user + store role ───────────────────────────────────────────
  // displayName: prefer what the user confirmed on the front-end; fall back to Telegram profile
  const autoDisplayName =
    [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') ||
    tgUser.username ||
    `用户${telegramId.slice(-4)}`
  const displayName = customDisplayName?.trim() || autoDisplayName

  // Use a transaction to create user, store role, and update token atomically
  const newUser = await prisma.$transaction(async (tx) => {
    // Count existing users of the same role in this tenant to generate sequential identifiers.
    // Race condition risk is negligible for small-store simultaneous onboarding.
    const roleCount = await tx.user.count({
      where: { tenantId: bt.tenantId, role: bt.role },
    })

    let username: string
    let staffNumber: number | null = null

    if (bt.role === 'OWNER') {
      // OWNER username: "owner" for the first, "owner_2" for subsequent
      username = roleCount === 0 ? 'owner' : `owner_${roleCount + 1}`
    } else {
      // STAFF username: sequential "staff_001", "staff_002", …
      staffNumber = roleCount + 1
      username = `staff_${String(staffNumber).padStart(3, '0')}`
    }

    const user = await tx.user.create({
      data: {
        tenantId: bt.tenantId,
        username,
        displayName,
        role: bt.role,
        status: 'ACTIVE',
        telegramId,
        staffNumber,
      },
    })

    await tx.userStoreRole.create({
      data: {
        tenantId: bt.tenantId,
        userId: user.id,
        storeId: bt.storeId,
        role: bt.role,
        status: 'ACTIVE',
      },
    })

    // ── 5. Consume token ──────────────────────────────────────────────────
    const newCount = bt.usedCount + 1
    await tx.bindToken.update({
      where: { id: bt.id },
      data: {
        usedCount: newCount,
        status: newCount >= bt.maxUses ? 'USED' : 'ACTIVE',
      },
    })

    return user
  })

  // ── 6. Sign session cookie ────────────────────────────────────────────────
  const sessionToken = signSession({
    tenantId: newUser.tenantId,
    userId: newUser.id,
    storeId: bt.storeId,
    role: newUser.role,
  })

  const isProd = process.env.NODE_ENV === 'production'
  const res = NextResponse.json({ ok: true, role: newUser.role, displayName: newUser.displayName })
  res.cookies.set('auth-session', sessionToken, {
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd,
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  })
  return res
}
