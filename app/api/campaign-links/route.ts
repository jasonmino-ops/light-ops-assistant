/**
 * GET  /api/campaign-links  — 当前门店推广链接列表（OWNER）
 * POST /api/campaign-links  — 新建推广短链（OWNER）
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { publicUrl } from '@/lib/public-url'
import { campaignTargetRisk, validateCampaignTargetUrl } from '@/lib/campaign-target-url'

function genCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

function campaignCreateError(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return '短链码冲突，请重试'
    if (error.code === 'P2022') return '数据库字段未同步，请先执行生产迁移'
  }
  return '短链创建失败，请稍后重试'
}

function calcCommission(
  type: string | null, value: number | null,
  orderCount: number, salesAmount: number,
): number {
  if (!type || value == null || value <= 0) return 0
  if (type === 'percent') return +(salesAmount * value / 100).toFixed(2)
  if (type === 'fixed')   return +(orderCount  * value).toFixed(2)
  return 0
}

export async function GET(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  if (!ctx.storeId) return NextResponse.json({ error: 'NO_STORE' }, { status: 400 })

  const includePaused = req.nextUrl.searchParams.get('includePaused') === 'true'
  const links = await prisma.campaignLink.findMany({
    where: {
      storeId: ctx.storeId,
      ...(includePaused ? {} : { status: 'ACTIVE' }),
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true, code: true, sourcePlatform: true,
      creatorId: true, creatorName: true, videoTitle: true, targetUrl: true,
      status: true,
      viewCount: true, clickCount: true,
      commissionType: true, commissionValue: true,
      settlementStatus: true, settledAt: true, settledNote: true,
      createdAt: true,
      creator: { select: { id: true, name: true, tiktokHandle: true } },
    },
  })

  // 聚合归因订单数和成交金额
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

  const result = await Promise.all(links.map(async (l) => {
    const st = statsMap.get(l.id)
    const orderCount  = st?._count.id ?? 0
    const salesAmount = st?._sum.totalAmount ? Number(st._sum.totalAmount) : 0
    const commVal = l.commissionValue ? Number(l.commissionValue) : null
    return {
      id:               l.id,
      code:             l.code,
      sourcePlatform:   l.sourcePlatform,
      creatorId:        l.creatorId,
      creatorName:      l.creator?.name ?? l.creatorName ?? null,
      tiktokHandle:     l.creator?.tiktokHandle ?? null,
      videoTitle:       l.videoTitle,
      targetUrl:        l.targetUrl,
      status:           l.status,
      viewCount:        l.viewCount,
      clickCount:       l.clickCount,
      commissionType:   l.commissionType,
      commissionValue:  commVal,
      settlementStatus: l.settlementStatus,
      settledAt:        l.settledAt,
      settledNote:      l.settledNote,
      attributedOrderCount:  orderCount,
      attributedSalesAmount: salesAmount,
      estimatedCommission:   calcCommission(l.commissionType, commVal, orderCount, salesAmount),
      landingRisk:       await campaignTargetRisk(l.targetUrl, { tenantId: ctx.tenantId, storeId: ctx.storeId }),
      createdAt:        l.createdAt,
    }
  }))

  return NextResponse.json({ links: result })
}

export async function POST(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  if (!ctx.storeId) return NextResponse.json({ error: 'NO_STORE' }, { status: 400 })

  let body: {
    creatorId?: string; creatorName?: string; videoTitle?: string
    sourcePlatform?: string; commissionType?: string; commissionValue?: number
    targetUrl?: string
  } = {}
  try { body = await req.json() } catch { /* no body ok */ }

  // 验证 creatorId 归属当前门店
  let resolvedCreatorId: string | null = null
  let resolvedCreatorName: string | null = null
  if (typeof body.creatorId === 'string' && body.creatorId) {
    const creator = await prisma.creator.findUnique({
      where: { id: body.creatorId },
      select: { id: true, name: true, storeId: true, status: true },
    })
    if (!creator || creator.storeId !== ctx.storeId) {
      return NextResponse.json({ error: 'INVALID_CREATOR', message: '该博主不属于当前门店，请重新选择' }, { status: 400 })
    }
    if (creator.status !== 'active') {
      return NextResponse.json({ error: 'CREATOR_INACTIVE', message: '该博主已停用，请选择其他博主' }, { status: 400 })
    }
    resolvedCreatorId   = creator.id
    resolvedCreatorName = creator.name
  }
  // 如未绑定 Creator，用手填名称
  if (!resolvedCreatorName) {
    resolvedCreatorName = typeof body.creatorName === 'string' ? body.creatorName.trim() || null : null
  }

  const commissionType = ['percent', 'fixed'].includes(body.commissionType ?? '')
    ? body.commissionType! : null
  const commissionValue = typeof body.commissionValue === 'number' && body.commissionValue > 0
    ? body.commissionValue : null

  const targetResult = await validateCampaignTargetUrl(body.targetUrl, { tenantId: ctx.tenantId, storeId: ctx.storeId })
  if (!targetResult.ok) {
    return NextResponse.json({ error: 'INVALID_TARGET_URL', message: targetResult.message }, { status: 400 })
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const code = genCode()
    try {
      const link = await prisma.campaignLink.create({
        data: {
          code,
          storeId:        ctx.storeId,
          sourcePlatform: typeof body.sourcePlatform === 'string' ? body.sourcePlatform : 'tiktok',
          creatorId:      resolvedCreatorId,
          creatorName:    resolvedCreatorName,
          videoTitle:     typeof body.videoTitle === 'string' ? body.videoTitle.trim() || null : null,
          targetUrl:      targetResult.targetUrl,
          commissionType,
          commissionValue: commissionValue != null ? String(commissionValue) : null,
        },
      })

      return NextResponse.json(
        { ...link, commissionValue: commissionValue, shortUrl: publicUrl(`/v/${link.code}`, req.nextUrl.origin) },
        { status: 201 },
      )
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && attempt < 2) {
        continue
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return NextResponse.json({ error: 'CODE_CONFLICT', message: '短链码冲突，请重试' }, { status: 409 })
      }
      return NextResponse.json({ error: 'CREATE_FAILED', message: campaignCreateError(error) }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'CODE_CONFLICT', message: '短链码冲突，请重试' }, { status: 409 })
}
