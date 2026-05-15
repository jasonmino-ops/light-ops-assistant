/**
 * POST /api/customers/coupons/batch-issue — 批量发券（OWNER）
 * Body: { telegramIds: string[], templateId: string }
 * 校验：OWNER + ≤50 人 + 模板属本租户 ACTIVE
 *       每顾客每模板最多持有 1 张 AVAILABLE（已持有则记 skipped）
 *       仅向本租户 active contact 发；其它记 skipped
 * 通知：CUSTOMER_BOT_TOKEN 配置时尝试，失败不影响发券成功
 * 落盘：CouponIssueBatch 汇总；每张券独立 CustomerCoupon
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { sendAndLogMessage } from '@/lib/telegram'

const BATCH_MAX = 50
const MAX_AVAILABLE_PER_TEMPLATE = 1

type ItemResult = { telegramId: string; status: 'SUCCESS' | 'SKIPPED' | 'FAILED'; reason?: string; notified?: boolean }

export async function POST(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  let body: { telegramIds?: unknown; templateId?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 }) }

  const templateId = (body.templateId ?? '').trim()
  if (!templateId) return NextResponse.json({ error: 'INVALID_PARAMS', message: '缺少 templateId' }, { status: 400 })
  if (!Array.isArray(body.telegramIds)) return NextResponse.json({ error: 'INVALID_PARAMS', message: 'telegramIds 必须为数组' }, { status: 400 })
  const ids = Array.from(new Set(body.telegramIds.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean)))
  if (ids.length === 0) return NextResponse.json({ error: 'INVALID_PARAMS', message: '收件人列表为空' }, { status: 400 })
  if (ids.length > BATCH_MAX) return NextResponse.json({ error: 'BATCH_TOO_LARGE', message: `单次最多 ${BATCH_MAX} 人` }, { status: 400 })

  const tpl = await prisma.couponTemplate.findFirst({
    where: { id: templateId, tenantId: ctx.tenantId, status: 'ACTIVE' },
  })
  if (!tpl) return NextResponse.json({ error: 'TEMPLATE_NOT_FOUND' }, { status: 404 })

  const contacts = await prisma.storeCustomerContact.findMany({
    where: { tenantId: ctx.tenantId, telegramId: { in: ids }, status: 'active' },
    select: { telegramId: true, storeCode: true, telegramLanguageCode: true },
  })
  const contactMap = new Map(contacts.map((c) => [c.telegramId, c]))

  const stores = await prisma.store.findMany({
    where: { tenantId: ctx.tenantId, code: { in: Array.from(new Set(contacts.map((c) => c.storeCode))) } },
    select: { id: true, code: true, name: true },
  })
  const storeByCode = new Map(stores.map((s) => [s.code, s]))

  // 一次性查现有 AVAILABLE 数量
  const existingRows = await prisma.customerCoupon.groupBy({
    by: ['telegramId'],
    where: { tenantId: ctx.tenantId, templateId: tpl.id, telegramId: { in: ids }, status: 'AVAILABLE' },
    _count: { _all: true },
  })
  const existingMap = new Map(existingRows.map((r) => [r.telegramId, r._count._all]))

  const batch = await prisma.couponIssueBatch.create({
    data: {
      tenantId:       ctx.tenantId,
      templateId:     tpl.id,
      issuedByUserId: ctx.userId,
      totalCount:     ids.length,
    },
  })

  const customerBotToken = process.env.CUSTOMER_BOT_TOKEN
  const results: ItemResult[] = []
  let success = 0, failed = 0, notified = 0

  for (const telegramId of ids) {
    const contact = contactMap.get(telegramId)
    if (!contact) { results.push({ telegramId, status: 'SKIPPED', reason: 'NOT_BOUND' }); continue }
    if ((existingMap.get(telegramId) ?? 0) >= MAX_AVAILABLE_PER_TEMPLATE) {
      results.push({ telegramId, status: 'SKIPPED', reason: 'ALREADY_HAS' })
      continue
    }
    const store = storeByCode.get(contact.storeCode)
    const expiresAt = new Date(Date.now() + tpl.validDays * 24 * 60 * 60 * 1000)

    try {
      await prisma.customerCoupon.create({
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
          batchId:        batch.id,
          issuedByUserId: ctx.userId,
        },
      })
      success++

      if (customerBotToken) {
        const text = buildCouponNoticeText(tpl.name, Number(tpl.amountOff ?? 0), Number(tpl.minSpend), tpl.validDays, store?.name ?? '')
        try {
          const r = await sendAndLogMessage({
            recipientTelegramId: telegramId, text,
            tenantId: ctx.tenantId, sentBy: 'SYSTEM', botToken: customerBotToken,
          })
          if (r.ok) notified++
          results.push({ telegramId, status: 'SUCCESS', notified: !!r.ok })
        } catch { results.push({ telegramId, status: 'SUCCESS', notified: false }) }
      } else {
        results.push({ telegramId, status: 'SUCCESS', notified: false })
      }
    } catch (e) {
      failed++
      results.push({ telegramId, status: 'FAILED', reason: (e as Error).message ?? 'create failed' })
    }
  }

  await prisma.couponIssueBatch.update({
    where: { id: batch.id },
    data:  { successCount: success, failedCount: failed },
  }).catch(() => {})

  const skipped = results.filter((r) => r.status === 'SKIPPED').length
  return NextResponse.json({
    ok: true, batchId: batch.id,
    total: ids.length, success, skipped, failed, notified,
    results,
  })
}

function buildCouponNoticeText(name: string, amount: number, minSpend: number, validDays: number, storeName: string): string {
  const head = storeName ? `${storeName} ` : ''
  return `🎫 ${head}发券通知\n` +
    `券名：${name}\n` +
    `优惠：满 ${minSpend.toFixed(2)} 减 ${amount.toFixed(2)}\n` +
    `有效期：${validDays} 天\n` +
    `请到"我的优惠券"中查看使用。`
}
