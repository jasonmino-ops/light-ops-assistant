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

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? ''

function verifyInitData(initData: string): URLSearchParams | null {
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) return null
  params.delete('hash')
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest()
  const expected = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex')
  return expected === hash ? params : null
}

export async function POST(req: NextRequest) {
  let body: { token?: string; initData?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const { token, initData } = body
  if (!token || !initData) {
    return NextResponse.json({ error: 'MISSING_FIELDS' }, { status: 400 })
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
  let params: URLSearchParams
  if (!BOT_TOKEN) {
    params = new URLSearchParams(initData)
  } else {
    const verified = verifyInitData(initData)
    if (!verified) {
      return NextResponse.json(
        { error: 'INVALID_SIGNATURE', message: 'Telegram 签名验证失败' },
        { status: 401 },
      )
    }
    params = verified
  }

  const userStr = params.get('user')
  if (!userStr) {
    return NextResponse.json({ error: 'MISSING_USER' }, { status: 400 })
  }
  let tgUser: { id: number; first_name?: string; last_name?: string; username?: string }
  try {
    tgUser = JSON.parse(userStr)
  } catch {
    return NextResponse.json({ error: 'INVALID_USER_PAYLOAD' }, { status: 400 })
  }
  const telegramId = String(tgUser.id)

  // ── 3. Check if telegramId already bound ─────────────────────────────────
  const existing = await prisma.user.findFirst({
    where: { tenantId: bt.tenantId, telegramId },
  })
  if (existing) {
    return NextResponse.json(
      {
        error: 'ALREADY_BOUND',
        message: `该 Telegram 账号已绑定用户「${existing.displayName}」，如需重新绑定请联系管理员`,
      },
      { status: 409 },
    )
  }

  // ── 4. Create user + store role ───────────────────────────────────────────
  const displayName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') ||
    tgUser.username ||
    `用户${telegramId.slice(-4)}`

  // Use a transaction to create user, store role, and update token atomically
  const newUser = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        tenantId: bt.tenantId,
        username: `tg_${telegramId}`,
        displayName,
        role: bt.role,
        status: 'ACTIVE',
        telegramId,
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
