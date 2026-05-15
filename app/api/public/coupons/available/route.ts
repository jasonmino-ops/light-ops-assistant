/**
 * POST /api/public/coupons/available
 *
 * /menu 结算时根据当前购物车金额筛可用券；金额由后端基于券快照计算。
 * Body: { storeCode, telegramId, subtotal, couponId? }
 * 仅返回当前 (storeCode→tenantId/storeId) × telegramId × AVAILABLE × 未过期 的券。
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type CouponBrief = {
  id: string
  name: string
  type: 'AMOUNT_OFF' | 'PERCENT_OFF'
  amountOff: number | null
  percentOff: number | null
  minSpend: number
  expiresAt: string
  reason?: 'MIN_NOT_MET' | 'EXPIRED' | 'NOT_FOUND' | 'OTHER'
}

export async function POST(req: NextRequest) {
  let body: { storeCode?: string; telegramId?: string; subtotal?: number; couponId?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 }) }

  const storeCode  = (body.storeCode ?? '').trim()
  const telegramId = (body.telegramId ?? '').trim()
  const subtotal   = Number(body.subtotal)
  const reqCouponId = (body.couponId ?? '').trim() || null
  if (!storeCode || !telegramId || !Number.isFinite(subtotal) || subtotal < 0) {
    return NextResponse.json({ error: 'INVALID_PARAMS' }, { status: 400 })
  }

  const store = await prisma.store.findUnique({
    where:  { code: storeCode },
    select: { id: true, tenantId: true },
  })
  if (!store) return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })

  const now = new Date()
  const rows = await prisma.customerCoupon.findMany({
    where: {
      tenantId:   store.tenantId,
      telegramId,
      status:     'AVAILABLE',
      expiresAt:  { gt: now },
      OR: [{ storeId: store.id }, { storeId: null }],
    },
    orderBy: { expiresAt: 'asc' },
  })

  const available:   CouponBrief[] = []
  const unavailable: CouponBrief[] = []
  for (const c of rows) {
    const brief: CouponBrief = {
      id: c.id, name: c.name, type: c.type,
      amountOff:  c.amountOff ? c.amountOff.toNumber() : null,
      percentOff: c.percentOff,
      minSpend:   c.minSpend.toNumber(),
      expiresAt:  c.expiresAt.toISOString(),
    }
    if (brief.minSpend > subtotal) unavailable.push({ ...brief, reason: 'MIN_NOT_MET' })
    else available.push(brief)
  }

  // 选中 + 折扣计算
  let selectedCoupon: CouponBrief | null = null
  let discountAmount = 0
  if (reqCouponId) {
    const hit = available.find((c) => c.id === reqCouponId)
    if (hit) {
      selectedCoupon = hit
      discountAmount = computeDiscount(hit, subtotal)
    } else if (!unavailable.find((c) => c.id === reqCouponId)) {
      // 给前端反馈：传入的 couponId 完全不可见（已用/已过期/跨店/非本人）
      unavailable.push({ id: reqCouponId, name: '', type: 'AMOUNT_OFF', amountOff: null, percentOff: null, minSpend: 0, expiresAt: '', reason: 'NOT_FOUND' })
    }
  }

  const payableAmount = Math.max(0, +(subtotal - discountAmount).toFixed(2))
  return NextResponse.json({
    available, unavailable,
    selectedCoupon,
    subtotal:        +subtotal.toFixed(2),
    discountAmount:  +discountAmount.toFixed(2),
    payableAmount,
  })
}

function computeDiscount(c: { type: string; amountOff: number | null; percentOff: number | null }, subtotal: number): number {
  if (c.type === 'AMOUNT_OFF') return Math.min(Number(c.amountOff ?? 0), subtotal)
  if (c.type === 'PERCENT_OFF') {
    const p = Math.max(0, Math.min(100, Number(c.percentOff ?? 0)))
    return +((subtotal * p) / 100).toFixed(2)
  }
  return 0
}
