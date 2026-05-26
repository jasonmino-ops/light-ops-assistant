import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyTgInitData, extractTgUserIdFromParams } from '@/lib/verify-tg-init-data'

/**
 * POST /api/e-life/recent-stores
 * Body: { initData: string }
 *
 * 查询当前 Telegram 用户最近访问的 6 家店铺（按 lastSeenAt 倒序）。
 * 使用 CUSTOMER_BOT_TOKEN 校验 initData HMAC。
 */

const CUSTOMER_BOT_TOKEN = process.env.CUSTOMER_BOT_TOKEN?.trim() ?? ''

export async function POST(req: NextRequest) {
  let body: { initData?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'INVALID_JSON' }, { status: 400 })
  }

  const { initData } = body
  if (!initData) {
    return NextResponse.json({ ok: false, error: 'MISSING_INIT_DATA' }, { status: 401 })
  }

  const params = verifyTgInitData(initData, CUSTOMER_BOT_TOKEN)
  if (!params) {
    return NextResponse.json({ ok: false, error: 'INVALID_TELEGRAM_AUTH' }, { status: 401 })
  }

  const tgId = extractTgUserIdFromParams(params)
  if (!tgId) {
    return NextResponse.json({ ok: false, error: 'MISSING_USER' }, { status: 401 })
  }

  // 查最近访问的 6 家店（含 e-life_visit 和传统 telegram_bind_after_order 来源）
  const contacts = await prisma.storeCustomerContact.findMany({
    where: { telegramId: tgId },
    orderBy: { lastSeenAt: 'desc' },
    take: 6,
    select: { storeCode: true, lastSeenAt: true },
  })

  if (contacts.length === 0) {
    return NextResponse.json({ ok: true, stores: [] })
  }

  const codes = contacts.map((c) => c.storeCode)
  const stores = await prisma.store.findMany({
    where: { code: { in: codes }, status: 'ACTIVE' },
    select: { code: true, name: true, businessType: true, bannerUrl: true },
  })
  const storeMap = new Map(stores.map((s) => [s.code, s]))

  const lastSeenMap = new Map(contacts.map((c) => [c.storeCode, c.lastSeenAt.toISOString()]))

  // 保持 lastSeenAt 倒序，过滤掉已关闭店铺
  const result = codes
    .filter((code) => storeMap.has(code))
    .map((code) => {
      const st = storeMap.get(code)!
      return {
        storeCode:    code,
        storeName:    st.name,
        businessType: st.businessType,
        bannerUrl:    st.bannerUrl ?? null,
        lastSeenAt:   lastSeenMap.get(code)!,
      }
    })

  return NextResponse.json({ ok: true, stores: result })
}
