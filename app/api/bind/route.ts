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
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { signSession } from '@/lib/session'
import { sendAndLogMessage, WELCOME_TEXT } from '@/lib/telegram'

const MERCHANT_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? ''

class BindTokenConsumeError extends Error {
  constructor() {
    super('BIND_TOKEN_CONSUME_FAILED')
  }
}

function tokenHash(token: string | null | undefined) {
  if (!token) return null
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 12)
}

function redactedTelegramId(telegramId: string | null | undefined) {
  if (!telegramId) return null
  return `***${telegramId.slice(-4)}`
}

function logBind(stage: string, details: Record<string, unknown>) {
  console.info('[bind]', { stage, ...details })
}

async function consumeBindToken(tx: Prisma.TransactionClient, tokenId: string) {
  const updated = await tx.$executeRaw`
    UPDATE "BindToken"
    SET
      "usedCount" = "usedCount" + 1,
      "status" = CASE WHEN "usedCount" + 1 >= "maxUses" THEN 'USED' ELSE 'ACTIVE' END,
      "updatedAt" = NOW()
    WHERE "id" = ${tokenId}
      AND "status" = 'ACTIVE'
      AND "expiresAt" > NOW()
      AND "usedCount" < "maxUses"
  `
  if (updated !== 1) throw new BindTokenConsumeError()
}

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
  if (!MERCHANT_BOT_TOKEN) return new URLSearchParams(initData) // dev: skip
  return verifyWithToken(initData, MERCHANT_BOT_TOKEN)
}

export async function POST(req: NextRequest) {
  let body: { token?: string; initData?: string; displayName?: string; storeName?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON', message: '请求格式错误，请重试' }, { status: 400 })
  }

  const { token, initData, displayName: customDisplayName, storeName: customStoreName } = body
  if (!token || !initData) {
    logBind('missing_fields', { hasToken: !!token, hasInitData: !!initData })
    return NextResponse.json({ error: 'MISSING_FIELDS', message: '链接参数不完整，请重新扫码' }, { status: 400 })
  }

  // ── 1. Validate bind token ────────────────────────────────────────────────
  const bt = await prisma.bindToken.findUnique({
    where: { token },
    include: {
      tenant: { select: { status: true } },
      store:  { select: { status: true } },
    },
  })

  const INVALID_MSG = '邀请码无效或已失效 / លេខអញ្ជើញមិនត្រឹមត្រូវ ឬផុតកំណត់'

  if (!bt) {
    logBind('token_not_found', { token: tokenHash(token) })
    return NextResponse.json({ error: 'INVALID_TOKEN', message: INVALID_MSG }, { status: 400 })
  }
  if (bt.tenant.status !== 'ACTIVE' || bt.store.status !== 'ACTIVE') {
    logBind('token_store_inactive', { token: tokenHash(token), role: bt.role, storeId: bt.storeId })
    return NextResponse.json({ error: 'TOKEN_STORE_INACTIVE', message: INVALID_MSG }, { status: 400 })
  }
  if (bt.expiresAt < new Date()) {
    logBind('token_expired', { token: tokenHash(token), role: bt.role, storeId: bt.storeId })
    return NextResponse.json({ error: 'TOKEN_EXPIRED', message: INVALID_MSG }, { status: 400 })
  }

  // ── 2. Verify Telegram initData ───────────────────────────────────────────
  const verified = verifyInitData(initData)
  if (!verified) {
    logBind('invalid_signature', { token: tokenHash(token), role: bt.role, storeId: bt.storeId })
    return NextResponse.json(
      { error: 'INVALID_SIGNATURE', message: 'Telegram 签名验证失败' },
      { status: 401 },
    )
  }
  const params = verified

  const userStr = params.get('user')
  if (!userStr) {
    logBind('missing_user', { token: tokenHash(token), role: bt.role, storeId: bt.storeId })
    return NextResponse.json({ error: 'MISSING_USER', message: '无法获取 Telegram 用户信息，请重新打开链接' }, { status: 400 })
  }
  let tgUser: { id: number; first_name?: string; last_name?: string; username?: string }
  try {
    tgUser = JSON.parse(userStr)
  } catch {
    logBind('invalid_user_payload', { token: tokenHash(token), role: bt.role, storeId: bt.storeId })
    return NextResponse.json({ error: 'INVALID_USER_PAYLOAD', message: 'Telegram 用户信息格式错误，请重试' }, { status: 400 })
  }
  const telegramId = String(tgUser.id)

  // ── 3. Check if telegramId already bound to ANY active user globally ─────
  // Rule: one Telegram account → one active user binding across all tenants.
  // Same-tenant multi-store is NOT a conflict (user already exists, just re-scanned).
  // Cross-tenant and same-tenant different-user are both blocked.
  const existing = await prisma.user.findFirst({
    where: { telegramId, status: 'ACTIVE' },
    select: {
      id: true,
      displayName: true,
      role: true,
      tenantId: true,
      tenant: { select: { name: true, status: true } },
      storeRoles: {
        where: { storeId: bt.storeId, status: 'ACTIVE' },
        select: { storeId: true },
        take: 1,
      },
    },
  })

  if (bt.status !== 'ACTIVE' || bt.usedCount >= bt.maxUses) {
    const alreadyBoundToThisStore =
      existing?.tenantId === bt.tenantId &&
      existing.role === bt.role &&
      existing.storeRoles.some((r) => r.storeId === bt.storeId)

    if (alreadyBoundToThisStore) {
      logBind('token_reopen_idempotent', {
        token: tokenHash(token),
        role: bt.role,
        storeId: bt.storeId,
        telegramId: redactedTelegramId(telegramId),
      })
      const sessionToken = signSession({
        tenantId: bt.tenantId,
        userId: existing.id,
        storeId: bt.storeId,
        role: existing.role,
      })

      const isProd = process.env.NODE_ENV === 'production'
      const res = NextResponse.json({ ok: true, role: existing.role, displayName: existing.displayName })
      res.cookies.set('auth-session', sessionToken, {
        httpOnly: true,
        sameSite: isProd ? 'none' : 'lax',
        secure: isProd,
        maxAge: 60 * 60 * 24 * 7,
        path: '/',
      })
      return res
    }

    logBind('token_exhausted', {
      token: tokenHash(token),
      role: bt.role,
      storeId: bt.storeId,
      telegramId: redactedTelegramId(telegramId),
    })
    return NextResponse.json({ error: 'TOKEN_EXHAUSTED', message: INVALID_MSG }, { status: 400 })
  }
  if (existing) {
    const isSameTenant = existing.tenantId === bt.tenantId
    const tenantArchived = existing.tenant?.status === 'ARCHIVED'
    if (isSameTenant) {
      if (existing.role !== bt.role) {
        return NextResponse.json(
          {
            error: 'ROLE_CONFLICT',
            message: `该 Telegram 账号已绑定为「${existing.role === 'OWNER' ? '老板' : '员工'}」，不能使用「${bt.role === 'OWNER' ? '老板' : '员工'}」邀请码重复绑定`,
          },
          { status: 409 },
        )
      }

      try {
        await prisma.$transaction(async (tx) => {
          await consumeBindToken(tx, bt.id)

          await tx.userStoreRole.upsert({
            where: { userId_storeId: { userId: existing.id, storeId: bt.storeId } },
            update: {
              tenantId: bt.tenantId,
              role: bt.role,
              status: 'ACTIVE',
            },
            create: {
              tenantId: bt.tenantId,
              userId: existing.id,
              storeId: bt.storeId,
              role: bt.role,
              status: 'ACTIVE',
            },
          })

          if (bt.role === 'OWNER' && customStoreName?.trim()) {
            await tx.store.update({
              where: { id: bt.storeId },
              data: { name: customStoreName.trim() },
            })
          }

        })
      } catch (e) {
        if (e instanceof BindTokenConsumeError) {
          logBind('token_consume_race_lost', {
            token: tokenHash(token),
            role: bt.role,
            storeId: bt.storeId,
            telegramId: redactedTelegramId(telegramId),
          })
          return NextResponse.json({ error: 'TOKEN_EXHAUSTED', message: INVALID_MSG }, { status: 409 })
        }
        throw e
      }

      const sessionToken = signSession({
        tenantId: bt.tenantId,
        userId: existing.id,
        storeId: bt.storeId,
        role: existing.role,
      })

      const isProd = process.env.NODE_ENV === 'production'
      const res = NextResponse.json({ ok: true, role: existing.role, displayName: existing.displayName })
      res.cookies.set('auth-session', sessionToken, {
        httpOnly: true,
        sameSite: isProd ? 'none' : 'lax',
        secure: isProd,
        maxAge: 60 * 60 * 24 * 7,
        path: '/',
      })
      return res
    }

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
  let newUser
  try {
    newUser = await prisma.$transaction(async (tx) => {
      await consumeBindToken(tx, bt.id)

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

      // Update store display name when OWNER provides one during first bind
      if (bt.role === 'OWNER' && customStoreName?.trim()) {
        await tx.store.update({
          where: { id: bt.storeId },
          data: { name: customStoreName.trim() },
        })
      }

      return user
    })
  } catch (e) {
    if (e instanceof BindTokenConsumeError) {
      logBind('token_consume_race_lost', {
        token: tokenHash(token),
        role: bt.role,
        storeId: bt.storeId,
        telegramId: redactedTelegramId(telegramId),
      })
      return NextResponse.json({ error: 'TOKEN_EXHAUSTED', message: INVALID_MSG }, { status: 409 })
    }
    throw e
  }

  // ── 6. 发送首次欢迎消息（非事务，失败不影响绑定结果）──────────────────────
  sendAndLogMessage({
    recipientTelegramId: newUser.telegramId!,
    text: WELCOME_TEXT,
    tenantId: newUser.tenantId,
    sentBy: 'SYSTEM',
  }).catch((e) => console.error('[bind] welcome message failed:', e))

  // ── 7. Sign session cookie ────────────────────────────────────────────────
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
