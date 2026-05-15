/**
 * POST /api/customers/[id]/coupons/issue — 单人发券（OWNER）
 * 路径 [id] = 顾客 telegramId
 * Body: { templateId: string }
 * 校验：OWNER + 同 tenant 下 active contact + 模板 ACTIVE + 每顾客每模板最多持有 1 张 AVAILABLE
 * 通知：若 telegramId + CUSTOMER_BOT_TOKEN 存在，尝试发送 TG 通知；失败不影响发券成功
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { sendAndLogMessage } from '@/lib/telegram'

const MAX_AVAILABLE_PER_TEMPLATE = 1 // 同顾客同模板持有 AVAILABLE 上限

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const { id } = await params
  const telegramId = decodeURIComponent(id ?? '').trim()
  if (!telegramId) return NextResponse.json({ error: 'INVALID_PARAMS' }, { status: 400 })

  let body: { templateId?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 }) }
  const templateId = (body.templateId ?? '').trim()
  if (!templateId) return NextResponse.json({ error: 'INVALID_PARAMS', message: '缺少 templateId' }, { status: 400 })

  // 1) 顾客必须属本租户且 active
  const contact = await prisma.storeCustomerContact.findFirst({
    where: { tenantId: ctx.tenantId, telegramId, status: 'active' },
    select: { storeCode: true, telegramLanguageCode: true },
  })
  if (!contact) return NextResponse.json({ error: 'CUSTOMER_NOT_FOUND' }, { status: 404 })

  // 2) 模板必须属本租户且 ACTIVE
  const tpl = await prisma.couponTemplate.findFirst({
    where: { id: templateId, tenantId: ctx.tenantId, status: 'ACTIVE' },
  })
  if (!tpl) return NextResponse.json({ error: 'TEMPLATE_NOT_FOUND' }, { status: 404 })

  // 3) 每顾客每模板最多持有 1 张 AVAILABLE
  const existing = await prisma.customerCoupon.count({
    where: { tenantId: ctx.tenantId, telegramId, templateId: tpl.id, status: 'AVAILABLE' },
  })
  if (existing >= MAX_AVAILABLE_PER_TEMPLATE) {
    return NextResponse.json(
      { error: 'ALREADY_HAS', message: '该顾客已持有同款可用券' },
      { status: 409 },
    )
  }

  // 4) 取目标门店
  const store = await prisma.store.findFirst({
    where: { tenantId: ctx.tenantId, code: contact.storeCode },
    select: { id: true, name: true },
  })

  const expiresAt = new Date(Date.now() + tpl.validDays * 24 * 60 * 60 * 1000)

  const coupon = await prisma.customerCoupon.create({
    data: {
      tenantId:       ctx.tenantId,
      storeId:        store?.id ?? null,
      templateId:     tpl.id,
      telegramId,
      status:         'AVAILABLE',
      name:           tpl.name,
      type:           tpl.type,
      amountOff:      tpl.amountOff,
      percentOff:     tpl.percentOff,
      minSpend:       tpl.minSpend,
      expiresAt,
      issuedByUserId: ctx.userId,
    },
  })

  // 5) TG 通知（失败静默，不影响发券成功）
  let notified = false
  const customerBotToken = process.env.CUSTOMER_BOT_TOKEN
  if (customerBotToken) {
    const text = buildCouponNoticeText(tpl.name, Number(tpl.amountOff ?? 0), Number(tpl.minSpend), tpl.validDays, store?.name ?? '')
    try {
      const r = await sendAndLogMessage({
        recipientTelegramId: telegramId,
        text,
        tenantId: ctx.tenantId,
        sentBy: 'SYSTEM',
        botToken: customerBotToken,
      })
      notified = !!r.ok
    } catch { /* ignore */ }
  }

  return NextResponse.json({ ok: true, couponId: coupon.id, notified })
}

function buildCouponNoticeText(name: string, amount: number, minSpend: number, validDays: number, storeName: string): string {
  const head = storeName ? `${storeName} ` : ''
  return `🎫 ${head}发券通知\n` +
    `券名：${name}\n` +
    `优惠：满 ${minSpend.toFixed(2)} 减 ${amount.toFixed(2)}\n` +
    `有效期：${validDays} 天\n` +
    `请到"我的优惠券"中查看使用。`
}
