/**
 * GET /api/ops/stores/[storeId]/customers
 *
 * OPS 后台查询某门店顾客资产。严格按 storeId/tenantId 隔离。
 * 鉴权：lib/ops-auth.checkOpsAuth（SUPER_ADMIN / OPS_ADMIN / BD）
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkOpsAuth } from '@/lib/ops-auth'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ storeId: string }> },
) {
  const role = await checkOpsAuth(req)
  if (!role) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const { storeId } = await params
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, code: true, name: true, tenantId: true },
  })
  if (!store) return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })
  const tenant = await prisma.tenant.findUnique({
    where:  { id: store.tenantId },
    select: { id: true, name: true },
  })

  // 1) 顾客联系人（严格按 storeCode 隔离）
  const contacts = await prisma.storeCustomerContact.findMany({
    where: { tenantId: store.tenantId, storeCode: store.code },
    orderBy: { lastSeenAt: 'desc' },
  })

  // 2) 该门店下所有顾客订单（按 telegramId 关联）
  const tgIds = contacts.map((c) => c.telegramId).filter(Boolean)
  const orders = tgIds.length === 0 ? [] : await prisma.customerOrder.findMany({
    where: {
      tenantId: store.tenantId,
      storeId:  store.id,
      customerTelegramId: { in: tgIds },
    },
    select: { customerTelegramId: true, totalAmount: true, createdAt: true, status: true, paymentStatus: true },
    orderBy: { createdAt: 'desc' },
  })
  const orderStat = new Map<string, { count: number; spent: number; lastOrderAt: string | null }>()
  for (const o of orders) {
    if (!o.customerTelegramId) continue
    const cur = orderStat.get(o.customerTelegramId) ?? { count: 0, spent: 0, lastOrderAt: null }
    cur.count += 1
    if (o.paymentStatus === 'PAID' && o.status !== 'CANCELLED') {
      cur.spent += o.totalAmount.toNumber()
    }
    const t = o.createdAt.toISOString()
    if (!cur.lastOrderAt || cur.lastOrderAt < t) cur.lastOrderAt = t
    orderStat.set(o.customerTelegramId, cur)
  }

  const customers = contacts.map((c) => {
    const stat = orderStat.get(c.telegramId) ?? { count: 0, spent: 0, lastOrderAt: null }
    return {
      telegramId:        c.telegramId,
      telegramUsername:  c.telegramUsername,
      telegramFirstName: c.telegramFirstName,
      telegramLastName:  c.telegramLastName,
      telegramLanguageCode: c.telegramLanguageCode,
      status:            c.status,
      opsNote:           c.opsNote ?? null,
      firstBoundAt:      c.firstBoundAt.toISOString(),
      lastSeenAt:        c.lastSeenAt.toISOString(),
      totalOrders:       stat.count,
      totalSpent:        +stat.spent.toFixed(2),
      lastOrderAt:       stat.lastOrderAt,
    }
  })

  return NextResponse.json({
    store:  { id: store.id, code: store.code, name: store.name },
    tenant: { id: tenant?.id ?? store.tenantId, name: tenant?.name ?? '—' },
    role,
    customers,
  })
}
