import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyTgInitData, extractTgUserIdFromParams } from '@/lib/verify-tg-init-data'

/**
 * POST /api/e-life/recent-stores/visit
 * Body: { initData: string, storeCode: string }
 *
 * 顾客访问 /menu?code=<storeCode> 时上报，后端 upsert StoreCustomerContact.lastSeenAt。
 * 校验 CUSTOMER_BOT_TOKEN HMAC，不信任前端传来的 tgId。
 * fire-and-forget：前端不等响应，失败时静默（localStorage 兜底）。
 */

const CUSTOMER_BOT_TOKEN = process.env.CUSTOMER_BOT_TOKEN?.trim() ?? ''

export async function POST(req: NextRequest) {
  let body: { initData?: string; storeCode?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'INVALID_JSON' }, { status: 400 })
  }

  const { initData, storeCode } = body
  if (!initData || !storeCode) {
    return NextResponse.json({ ok: false, error: 'MISSING_PARAMS' }, { status: 400 })
  }

  const params = verifyTgInitData(initData, CUSTOMER_BOT_TOKEN)
  if (!params) {
    return NextResponse.json({ ok: false, error: 'INVALID_TELEGRAM_AUTH' }, { status: 401 })
  }

  const tgId = extractTgUserIdFromParams(params)
  if (!tgId) {
    return NextResponse.json({ ok: false, error: 'MISSING_USER' }, { status: 401 })
  }

  // 提取 Telegram 用户名（供 create 分支写入，update 分支不覆盖）
  let firstName = '', username = ''
  try {
    const u = JSON.parse(params.get('user') ?? '{}')
    firstName = u.first_name ?? ''
    username  = u.username  ?? ''
  } catch { /* ignore */ }

  // 验证门店存在且 ACTIVE，同时取 tenantId（create 分支需要）
  const store = await prisma.store.findUnique({
    where: { code: storeCode },
    select: { tenantId: true, status: true },
  })
  if (!store || store.status !== 'ACTIVE') {
    return NextResponse.json({ ok: false, error: 'STORE_NOT_FOUND' }, { status: 404 })
  }

  // upsert：已有记录只更新 lastSeenAt；新记录用 source='e-life_visit' 标记来源
  await prisma.storeCustomerContact.upsert({
    where: { storeCode_telegramId: { storeCode, telegramId: tgId } },
    create: {
      tenantId:          store.tenantId,
      storeCode,
      telegramId:        tgId,
      telegramFirstName: firstName || null,
      telegramUsername:  username  || null,
      lastSeenAt:        new Date(),
      source:            'e-life_visit',
    },
    update: { lastSeenAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
