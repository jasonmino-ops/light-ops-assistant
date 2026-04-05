/**
 * POST /api/open
 *
 * Submit a store-opening application. Creates a StoreApplication record with
 * status PENDING. Ops reviews the application in /ops and approves it to
 * generate an owner bind token. The applicant then scans the token to bind
 * their account via /bind → /home.
 *
 * Body: { initData, storeName, ownerName }
 */
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'

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
  let body: { initData?: string; storeName?: string; ownerName?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON', message: '请求格式错误' }, { status: 400 })
  }

  const { initData, storeName, ownerName } = body

  if (!initData || !storeName?.trim() || !ownerName?.trim()) {
    return NextResponse.json({ error: 'MISSING_FIELDS', message: '请填写所有必填项' }, { status: 400 })
  }

  // ── 1. Verify Telegram initData ───────────────────────────────────────────
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

  // ── 2. Guard: must not already be bound to an active account ─────────────
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

  // ── 3. Create PENDING application ─────────────────────────────────────────
  await prisma.storeApplication.create({
    data: {
      storeName: storeName.trim(),
      ownerName: ownerName.trim(),
      telegramId,
      telegramUsername: tgUser.username ?? null,
      status: 'PENDING',
    },
  })

  return NextResponse.json({ ok: true })
}
