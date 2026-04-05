/**
 * POST /api/open
 *
 * Self-service merchant registration — creates a new tenant, store, and owner
 * user in one atomic transaction. Guarded by a shared STORE_OPEN_CODE env var
 * so only authorised new merchants can self-register.
 *
 * Body: { initData, storeName, ownerName, verifyCode }
 *
 * Flow:
 *  1. Validate required fields
 *  2. Check verifyCode === STORE_OPEN_CODE
 *  3. Verify Telegram initData HMAC (skip in dev if BOT_TOKEN not set)
 *  4. Guard: telegramId must not already be ACTIVE-bound to any tenant
 *  5. Create Tenant + Store + Owner User + UserStoreRole in a transaction
 *  6. Sign auth-session cookie → return { ok: true }
 */
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { signSession } from '@/lib/session'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? ''
const STORE_OPEN_CODE = process.env.STORE_OPEN_CODE ?? ''

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
  let body: { initData?: string; storeName?: string; ownerName?: string; verifyCode?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON', message: '请求格式错误' }, { status: 400 })
  }

  const { initData, storeName, ownerName, verifyCode } = body

  if (!initData || !storeName?.trim() || !ownerName?.trim() || !verifyCode?.trim()) {
    return NextResponse.json({ error: 'MISSING_FIELDS', message: '请填写所有必填项' }, { status: 400 })
  }

  // ── 1. Verify code ────────────────────────────────────────────────────────
  if (!STORE_OPEN_CODE) {
    return NextResponse.json(
      { error: 'NOT_CONFIGURED', message: '开店功能暂未开放，请联系管理员' },
      { status: 503 },
    )
  }
  if (verifyCode.trim() !== STORE_OPEN_CODE) {
    return NextResponse.json(
      { error: 'INVALID_CODE', message: '验证码错误，请联系管理员获取' },
      { status: 400 },
    )
  }

  // ── 2. Verify Telegram initData ───────────────────────────────────────────
  let params: URLSearchParams
  if (!BOT_TOKEN) {
    params = new URLSearchParams(initData) // dev: skip HMAC
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
    return NextResponse.json({ error: 'MISSING_USER', message: '无法获取 Telegram 用户信息' }, { status: 400 })
  }
  let tgUser: { id: number; first_name?: string; last_name?: string; username?: string }
  try {
    tgUser = JSON.parse(userStr)
  } catch {
    return NextResponse.json({ error: 'INVALID_USER_PAYLOAD' }, { status: 400 })
  }
  const telegramId = String(tgUser.id)

  // ── 3. Guard: must not already be bound ───────────────────────────────────
  const existing = await prisma.user.findFirst({
    where: { telegramId, status: 'ACTIVE' },
    select: { id: true, displayName: true },
  })
  if (existing) {
    return NextResponse.json(
      { error: 'ALREADY_BOUND', message: `该 Telegram 账号已绑定商户账号「${existing.displayName}」，请直接使用已有账号` },
      { status: 409 },
    )
  }

  // ── 4. Create tenant + store + owner in one transaction ───────────────────
  const storeCode = 'ST' + crypto.randomBytes(4).toString('hex').toUpperCase()

  const { newTenant, newStore, newUser } = await prisma.$transaction(async (tx) => {
    const newTenant = await tx.tenant.create({
      data: { name: storeName.trim() },
    })

    const newStore = await tx.store.create({
      data: {
        tenantId: newTenant.id,
        code: storeCode,
        name: storeName.trim(),
      },
    })

    const newUser = await tx.user.create({
      data: {
        tenantId: newTenant.id,
        username: 'owner',
        displayName: ownerName.trim(),
        role: 'OWNER',
        status: 'ACTIVE',
        telegramId,
        staffNumber: null,
      },
    })

    await tx.userStoreRole.create({
      data: {
        tenantId: newTenant.id,
        userId: newUser.id,
        storeId: newStore.id,
        role: 'OWNER',
        status: 'ACTIVE',
      },
    })

    return { newTenant, newStore, newUser }
  })

  // ── 5. Sign session cookie ────────────────────────────────────────────────
  const sessionToken = signSession({
    tenantId: newTenant.id,
    userId: newUser.id,
    storeId: newStore.id,
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
