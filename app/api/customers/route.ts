/**
 * GET /api/customers — 商户端顾客资产中心（OWNER only）
 *
 * 复用现有 StoreCustomerContact（绑定关系）+ CustomerOrder（订单 + customerTelegramId）。
 * 聚合在 API 层即时计算，避免新增冗余表/触发器。
 *
 * 返回：
 *   {
 *     overview: { totalCustomers, boundCustomers, todayBound, monthActive, totalSales, repeatCustomers },
 *     customers: CustomerSummary[]
 *   }
 *
 * 数据量预估：单租户活跃顾客 < 1000，订单 < 10000；JS 端 groupBy 足够快。
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

const HIGH_VALUE_THRESHOLD = 100   // USD — 累计消费 ≥ 该值标记为「高价值」
const SILENT_DAYS           = 30   // 最近 N 天无下单 + 有过订单 → 标记「沉默」

type ItemRow = { productId?: string; name?: string; spec?: string; price?: number; quantity?: number; lineAmount?: number }

type OrderLite = {
  orderNo: string
  customerTelegramId: string | null
  itemsJson: string
  totalAmount: { toNumber: () => number } | number
  status: string
  paymentStatus: string
  createdAt: Date
}

type CustomerSummary = {
  telegramId: string
  username: string | null
  displayName: string | null
  phone: string | null
  bound: boolean
  firstBoundAt: string | null
  lastActiveAt: string | null
  totalOrders: number
  totalSpent: number
  avgOrderValue: number
  lastOrderAt: string | null
  favoriteProductName: string | null
  favoriteProductCount: number
  tags: string[]
  customerLevel: 'NORMAL' | 'VIP'
  pointsBalance: number
  recentOrders: Array<{
    orderNo: string
    createdAt: string
    totalAmount: number
    status: string
    paymentStatus: string
    itemSummary: string
  }>
  topProducts: Array<{ name: string; count: number }>
}

function amountToNumber(v: { toNumber: () => number } | number | null | undefined): number {
  if (v == null) return 0
  if (typeof v === 'number') return v
  if (typeof (v as { toNumber?: () => number }).toNumber === 'function') {
    return (v as { toNumber: () => number }).toNumber()
  }
  return Number(v) || 0
}

export async function GET(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'FORBIDDEN', message: '仅老板可访问顾客资产' }, { status: 403 })

  const tenantId = ctx.tenantId

  const [contacts, ordersRaw] = await Promise.all([
    prisma.storeCustomerContact.findMany({
      where: { tenantId },
      orderBy: { lastSeenAt: 'desc' },
    }),
    prisma.customerOrder.findMany({
      where: { tenantId, customerTelegramId: { not: null } },
      select: {
        orderNo: true,
        customerTelegramId: true,
        itemsJson: true,
        totalAmount: true,
        status: true,
        paymentStatus: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 5000, // 上限保护
    }),
  ])

  const orders = ordersRaw as unknown as OrderLite[]

  // 按 telegramId groupBy
  const ordersByTg = new Map<string, OrderLite[]>()
  for (const o of orders) {
    const tg = o.customerTelegramId
    if (!tg) continue
    const arr = ordersByTg.get(tg) ?? []
    arr.push(o)
    ordersByTg.set(tg, arr)
  }

  // 全量 telegramId
  const allTgIds = new Set<string>()
  contacts.forEach((c) => allTgIds.add(c.telegramId))
  ordersByTg.forEach((_, tg) => allTgIds.add(tg))

  const now = Date.now()
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)

  const monthActiveSet = new Set<string>()
  let totalSalesAgg = 0
  let repeatCount   = 0

  const customers: CustomerSummary[] = []

  for (const tgId of allTgIds) {
    const contact   = contacts.find((c) => c.telegramId === tgId)
    const tgOrders  = ordersByTg.get(tgId) ?? []
    const paid      = tgOrders.filter((o) => o.paymentStatus === 'PAID' && o.status !== 'CANCELLED')

    const totalSpent    = paid.reduce((s, o) => s + amountToNumber(o.totalAmount), 0)
    const totalOrders   = paid.length
    const avgOrderValue = totalOrders > 0 ? totalSpent / totalOrders : 0
    const lastOrderAt   = tgOrders[0]?.createdAt ?? null

    // 常购商品聚合
    const productCount = new Map<string, number>()
    for (const o of paid) {
      try {
        const items: ItemRow[] = JSON.parse(o.itemsJson)
        for (const it of items) {
          const nm = (it.name ?? '').trim()
          if (!nm) continue
          productCount.set(nm, (productCount.get(nm) ?? 0) + (typeof it.quantity === 'number' ? it.quantity : 1))
        }
      } catch { /* ignore */ }
    }
    const topProducts = [...productCount.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)

    // 规则型标签
    const tags: string[] = []
    if (totalOrders >= 3)        tags.push('老客')
    else if (totalOrders === 1)  tags.push('新客')
    if (totalSpent >= HIGH_VALUE_THRESHOLD) tags.push('高价值')
    if (lastOrderAt && totalOrders >= 1) {
      const daysSince = (now - new Date(lastOrderAt).getTime()) / 86400000
      if (daysSince > SILENT_DAYS) tags.push('沉默')
    }

    if (paid.some((o) => o.createdAt >= monthStart)) monthActiveSet.add(tgId)
    if (totalOrders >= 2) repeatCount++
    totalSalesAgg += totalSpent

    // lastActiveAt = max(lastSeenAt, lastOrderAt)
    const seenAt = contact?.lastSeenAt ? contact.lastSeenAt.getTime() : 0
    const ordAt  = lastOrderAt ? new Date(lastOrderAt).getTime() : 0
    const lastActiveIso = seenAt || ordAt
      ? new Date(Math.max(seenAt, ordAt)).toISOString()
      : null

    customers.push({
      telegramId:           tgId,
      username:             contact?.telegramUsername ?? null,
      displayName:          contact?.telegramFirstName || contact?.telegramUsername || null,
      phone:                null,
      bound:                !!contact,
      firstBoundAt:         contact?.firstBoundAt?.toISOString() ?? null,
      lastActiveAt:         lastActiveIso,
      totalOrders,
      totalSpent:           Math.round(totalSpent * 100) / 100,
      avgOrderValue:        Math.round(avgOrderValue * 100) / 100,
      lastOrderAt:          lastOrderAt ? new Date(lastOrderAt).toISOString() : null,
      favoriteProductName:  topProducts[0]?.name ?? null,
      favoriteProductCount: topProducts[0]?.count ?? 0,
      tags,
      customerLevel:        totalSpent >= HIGH_VALUE_THRESHOLD ? 'VIP' : 'NORMAL',
      pointsBalance:        0,
      recentOrders: tgOrders.slice(0, 10).map((o) => {
        let itemSummary = ''
        try {
          const items: ItemRow[] = JSON.parse(o.itemsJson)
          itemSummary = items.slice(0, 2).map((i) => `${i.name ?? ''}×${i.quantity ?? 0}`).join('、')
          if (items.length > 2) itemSummary += ` 等${items.length}项`
        } catch { /* ignore */ }
        return {
          orderNo:       o.orderNo,
          createdAt:     o.createdAt.toISOString(),
          totalAmount:   amountToNumber(o.totalAmount),
          status:        o.status,
          paymentStatus: o.paymentStatus,
          itemSummary,
        }
      }),
      topProducts,
    })
  }

  const overview = {
    totalCustomers:   allTgIds.size,
    boundCustomers:   contacts.length,
    todayBound:       contacts.filter((c) => c.firstBoundAt >= todayStart).length,
    monthActive:      monthActiveSet.size,
    totalSales:       Math.round(totalSalesAgg * 100) / 100,
    repeatCustomers:  repeatCount,
  }

  return NextResponse.json({ overview, customers })
}
