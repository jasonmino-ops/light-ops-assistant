/**
 * GET /api/creator-public/[token]
 *
 * 博主只读数据接口（无需登录）。
 * 返回该博主的推广数据汇总，不含顾客隐私字段。
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

function calcCommission(
  type: string | null, value: number | null,
  orderCount: number, salesAmount: number,
): number {
  if (!type || value == null || value <= 0) return 0
  if (type === 'percent') return +(salesAmount * value / 100).toFixed(2)
  if (type === 'fixed')   return +(orderCount  * value).toFixed(2)
  return 0
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params

  const creator = await prisma.creator.findUnique({
    where: { dashboardToken: token },
    select: {
      id: true, name: true, displayName: true, tiktokHandle: true,
      dashboardTokenRevokedAt: true,
    },
  })

  if (!creator || creator.dashboardTokenRevokedAt) {
    return NextResponse.json({ error: 'TOKEN_INVALID', message: '看板链接不存在或已失效' }, { status: 404 })
  }

  // 获取该博主的全部 CampaignLink
  const links = await prisma.campaignLink.findMany({
    where: { creatorId: creator.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, code: true, videoTitle: true,
      viewCount: true, clickCount: true,
      commissionType: true, commissionValue: true,
      settlementStatus: true, settledAt: true, createdAt: true,
    },
  })

  // 聚合订单数和成交金额（只取聚合值，不返回订单详情）
  const linkIds = links.map((l) => l.id)
  const stats = linkIds.length
    ? await prisma.customerOrder.groupBy({
        by: ['campaignLinkId'],
        where: { campaignLinkId: { in: linkIds } },
        _count: { id: true },
        _sum: { totalAmount: true },
      })
    : []
  const statsMap = new Map(stats.map((s) => [s.campaignLinkId, s]))

  const linkResults = links.map((l) => {
    const st = statsMap.get(l.id)
    const orderCount  = st?._count.id ?? 0
    const salesAmount = st?._sum.totalAmount ? Number(st._sum.totalAmount) : 0
    const commVal = l.commissionValue ? Number(l.commissionValue) : null
    const estimated = calcCommission(l.commissionType, commVal, orderCount, salesAmount)
    return {
      code:               l.code,
      videoTitle:         l.videoTitle,
      viewCount:          l.viewCount,
      clickCount:         l.clickCount,
      orderCount,
      salesAmount,
      commissionType:     l.commissionType,
      commissionValue:    commVal,
      estimatedCommission: estimated,
      settlementStatus:   l.settlementStatus,
      settledAt:          l.settledAt,
      createdAt:          l.createdAt,
    }
  })

  // 汇总
  let totalViews = 0, totalClicks = 0, totalOrders = 0
  let totalSales = 0, totalCommission = 0, settledCommission = 0
  for (const l of linkResults) {
    totalViews    += l.viewCount
    totalClicks   += l.clickCount
    totalOrders   += l.orderCount
    totalSales    += l.salesAmount
    totalCommission += l.estimatedCommission
    if (l.settlementStatus === 'settled') settledCommission += l.estimatedCommission
  }

  return NextResponse.json({
    creator: {
      name:         creator.name,
      displayName:  creator.displayName,
      tiktokHandle: creator.tiktokHandle,
    },
    summary: {
      totalViews,
      totalClicks,
      totalOrders,
      totalSalesAmount:           +totalSales.toFixed(2),
      totalEstimatedCommission:   +totalCommission.toFixed(2),
      totalSettledCommission:     +settledCommission.toFixed(2),
      totalUnsettledCommission:   +(totalCommission - settledCommission).toFixed(2),
    },
    links: linkResults,
  })
}
