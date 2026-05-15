/**
 * GET /api/store/settings
 * PATCH /api/store/settings
 *
 * 商户端轻量门店设置接口。本期仅暴露 businessType（店铺类型）。
 *
 * 鉴权：
 *   - GET:   登录即可（OWNER / STAFF）
 *   - PATCH: 必须 OWNER；不允许 STAFF 修改
 *
 * 范围：仅作用于 ctx.storeId 对应门店；隔离 tenantId。
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

const VALID_TYPES = ['FOOD', 'RETAIL', 'SERVICE', 'GENERAL'] as const
type BizType = typeof VALID_TYPES[number]

export async function GET(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })

  const store = await prisma.store.findFirst({
    where:  { id: ctx.storeId, tenantId: ctx.tenantId },
    select: { id: true, code: true, name: true, businessType: true, checkoutMode: true },
  })
  if (!store) return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })

  return NextResponse.json({
    storeId:      store.id,
    storeCode:    store.code,
    storeName:    store.name,
    businessType: store.businessType,
    checkoutMode: store.checkoutMode,
  })
}

export async function PATCH(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') {
    return NextResponse.json({ error: 'FORBIDDEN', message: '只有老板可以修改店铺类型' }, { status: 403 })
  }

  let body: { businessType?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 }) }

  const bt = (body.businessType ?? '').trim()
  if (!VALID_TYPES.includes(bt as BizType)) {
    return NextResponse.json({ error: 'INVALID_BUSINESS_TYPE' }, { status: 400 })
  }

  const store = await prisma.store.findFirst({
    where:  { id: ctx.storeId, tenantId: ctx.tenantId },
    select: { id: true },
  })
  if (!store) return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })

  const updated = await prisma.store.update({
    where: { id: store.id },
    data:  { businessType: bt },
    select: { id: true, businessType: true },
  })

  return NextResponse.json({ ok: true, businessType: updated.businessType })
}
