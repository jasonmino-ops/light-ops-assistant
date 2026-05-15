/**
 * GET /api/customer/coupons?code=<storeCode>&tgId=<telegramId>
 *
 * 顾客 H5：查询当前顾客在该门店可见的优惠券。
 * 范围：store.tenantId × telegramId × (storeId = store.id OR storeId IS NULL)
 * 防御：仅按 (storeCode + tgId) 命中，不跨商户、不跨顾客；不更新 DB 状态，
 *      过期券由响应端按 expiresAt 判断。
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const code  = req.nextUrl.searchParams.get('code')?.trim()
  const tgId  = req.nextUrl.searchParams.get('tgId')?.trim()
  if (!code || !tgId) {
    return NextResponse.json({ error: 'INVALID_PARAMS', message: '缺少 code 或 tgId' }, { status: 400 })
  }

  const store = await prisma.store.findUnique({
    where:  { code },
    select: { id: true, tenantId: true, name: true },
  })
  if (!store) return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })

  const rows = await prisma.customerCoupon.findMany({
    where: {
      tenantId:   store.tenantId,
      telegramId: tgId,
      OR: [{ storeId: store.id }, { storeId: null }],
    },
    orderBy: { createdAt: 'desc' },
  })

  const now = Date.now()
  const available: ReturnType<typeof shape>[] = []
  const used:      ReturnType<typeof shape>[] = []
  const expired:   ReturnType<typeof shape>[] = []

  for (const c of rows) {
    const item = shape(c)
    if (c.status === 'USED') used.push(item)
    else if (c.status === 'CANCELLED' || c.status === 'EXPIRED') expired.push(item)
    else if (c.expiresAt.getTime() <= now) expired.push({ ...item, status: 'EXPIRED' })
    else available.push(item)
  }

  return NextResponse.json({
    counts: { available: available.length, used: used.length, expired: expired.length },
    available, used, expired,
  })
}

function shape(c: {
  id: string; name: string; type: string
  amountOff: { toNumber: () => number } | null
  percentOff: number | null
  minSpend:  { toNumber: () => number }
  expiresAt: Date; usedAt: Date | null; status: string
  storeId: string | null
}) {
  return {
    id:         c.id,
    name:       c.name,
    type:       c.type,
    amountOff:  c.amountOff ? c.amountOff.toNumber() : null,
    percentOff: c.percentOff,
    minSpend:   c.minSpend.toNumber(),
    expiresAt:  c.expiresAt.toISOString(),
    usedAt:     c.usedAt ? c.usedAt.toISOString() : null,
    status:     c.status,
    storeScope: c.storeId ? 'STORE' : 'TENANT',
  }
}
