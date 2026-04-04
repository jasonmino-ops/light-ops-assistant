/**
 * POST /api/auth/bind
 *
 * First-time account binding: links a Telegram user ID to an existing app
 * user identified by username.  After binding, sets the auth-session cookie
 * so the user is immediately logged in.
 *
 * Body: { initData: string, username: string }
 *
 * Flow:
 *  1. Verify Telegram initData HMAC (same as /api/auth/telegram)
 *  2. Check that no OTHER user in this tenant already has this telegramId
 *     (prevents re-binding a telegramId that belongs to someone else)
 *  3. Find user by username (tenantId + username)
 *  4. Update user.telegramId = telegramUserId
 *  5. Set auth-session cookie and return { ok: true, role }
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { signSession } from '@/lib/session'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? ''
const TENANT_ID = process.env.TENANT_ID ?? 'seed-tenant-001'

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
  let body: { initData?: string; username?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const { initData, username } = body
  if (!initData || !username?.trim()) {
    return NextResponse.json({ error: 'MISSING_FIELDS' }, { status: 400 })
  }

  // Verify initData
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

  // Check if this telegramId is already bound to ANY active user globally
  const existing = await prisma.user.findFirst({
    where: { telegramId: telegramUserId, status: 'ACTIVE' },
    select: { displayName: true, tenantId: true, tenant: { select: { name: true, status: true } } },
  })
  if (existing) {
    const isSameTenant = existing.tenantId === TENANT_ID
    const tenantArchived = existing.tenant?.status === 'ARCHIVED'
    const message = isSameTenant
      ? `该 Telegram 账号已绑定用户「${existing.displayName}」，请联系管理员解绑`
      : tenantArchived
        ? `该 Telegram 账号已绑定已归档商户「${existing.tenant?.name ?? ''}」，请联系运营管理员解绑后重试`
        : `该 Telegram 账号已绑定其他商户「${existing.tenant?.name ?? ''}」，不允许跨商户重复绑定，请联系运营管理员`
    return NextResponse.json({ error: 'ALREADY_BOUND', message }, { status: 409 })
  }

  // Find target user by username
  const user = await prisma.user.findFirst({
    where: {
      tenantId: TENANT_ID,
      username: username.trim(),
      status: 'ACTIVE',
    },
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
      { error: 'USER_NOT_FOUND', message: '用户名不存在，请确认后重试' },
      { status: 404 },
    )
  }

  // Bind telegramId
  await prisma.user.update({
    where: { id: user.id },
    data: { telegramId: telegramUserId },
  })

  // Resolve storeId
  let storeId = user.storeRoles[0]?.storeId
  if (!storeId) {
    const firstStore = await prisma.store.findFirst({
      where: { tenantId: TENANT_ID, status: 'ACTIVE' },
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
  const res = NextResponse.json({ ok: true, role: user.role, displayName: user.displayName })
  res.cookies.set('auth-session', sessionToken, {
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd,
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  })
  return res
}
