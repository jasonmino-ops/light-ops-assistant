/**
 * POST /api/auth/telegram
 *
 * Validates Telegram WebApp initData, looks up the user by telegramId,
 * and sets an auth-session cookie.
 *
 * Required env vars:
 *   TELEGRAM_BOT_TOKEN — used to verify the HMAC signature of initData
 *   AUTH_SECRET        — used to sign the session cookie
 *   TENANT_ID          — the tenant this bot serves (defaults to seed-tenant-001)
 *
 * Dev mode: if TELEGRAM_BOT_TOKEN is not set, HMAC verification is skipped
 * so the flow can be tested without a real bot.
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { signSession } from '@/lib/session'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? ''

// ── Telegram initData verification ──────────────────────────────────────────

/**
 * Verifies the HMAC of Telegram WebApp initData.
 * Returns the decoded params (excluding hash) or null if invalid.
 */
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

// ── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: { initData?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const { initData } = body
  if (!initData) {
    return NextResponse.json({ error: 'MISSING_INIT_DATA' }, { status: 400 })
  }

  // Verify or skip (dev mode)
  let params: URLSearchParams
  if (!BOT_TOKEN) {
    // Dev: skip HMAC, just parse
    params = new URLSearchParams(initData)
  } else {
    const verified = verifyInitData(initData)
    if (!verified) {
      return NextResponse.json(
        { error: 'INVALID_SIGNATURE', message: 'Telegram initData 签名验证失败' },
        { status: 401 },
      )
    }
    params = verified
  }

  // Extract Telegram user id
  const userStr = params.get('user')
  if (!userStr) {
    return NextResponse.json({ error: 'MISSING_USER' }, { status: 400 })
  }
  let telegramUserId: string
  try {
    telegramUserId = String(JSON.parse(userStr).id)
  } catch {
    return NextResponse.json({ error: 'INVALID_USER_PAYLOAD' }, { status: 400 })
  }

  // Look up user by telegramId (cross-tenant: each user belongs to their own tenant)
  const user = await prisma.user.findFirst({
    where: { telegramId: telegramUserId, status: 'ACTIVE' },
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
      { error: 'USER_NOT_FOUND', message: '未找到绑定账号，请联系管理员' },
      { status: 404 },
    )
  }

  // Verify the user's own tenant is still active
  const tenant = await prisma.tenant.findUnique({
    where: { id: user.tenantId },
    select: { status: true },
  })
  if (!tenant || tenant.status !== 'ACTIVE') {
    return NextResponse.json(
      { error: 'TENANT_INACTIVE', message: '商户已停用，请联系管理员' },
      { status: 403 },
    )
  }

  // Resolve storeId: use primary store role, or first store in user's tenant
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
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  })
  return res
}
