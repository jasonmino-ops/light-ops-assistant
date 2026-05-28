/**
 * GET /api/v/[code] — 公开，无需登录
 * 返回推广短链关联的门店信息；同时异步 +1 viewCount。
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params

  const link = await prisma.campaignLink.findUnique({
    where: { code },
    select: {
      id:            true,
      code:          true,
      targetUrl:     true,
      creatorName:   true,
      videoTitle:    true,
      sourcePlatform: true,
      store: {
        select: { name: true, code: true, bannerUrl: true, announcement: true },
      },
    },
  })

  if (!link) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  // fire-and-forget view count
  prisma.campaignLink.update({
    where: { code },
    data: { viewCount: { increment: 1 } },
  }).catch(() => {})

  return NextResponse.json({
    storeCode:    link.store.code,
    storeName:    link.store.name,
    bannerUrl:    link.store.bannerUrl ?? null,
    announcement: link.store.announcement ?? null,
    targetUrl:    link.targetUrl,
    creatorName:  link.creatorName ?? null,
    videoTitle:   link.videoTitle ?? null,
  })
}
