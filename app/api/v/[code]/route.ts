/**
 * GET /api/v/[code] — 公开，无需登录
 * 返回推广短链关联的门店信息；同时异步 +1 viewCount。
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

function normalizeTargetPath(targetUrl: string): string {
  const trimmed = targetUrl.trim()
  if (!/^https?:\/\//i.test(trimmed)) return trimmed
  try {
    const url = new URL(trimmed)
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return trimmed
  }
}

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
      status:        true,
      creatorName:   true,
      videoTitle:    true,
      sourcePlatform: true,
      store: {
        select: { name: true, code: true, bannerUrl: true, announcement: true },
      },
    },
  })

  if (!link) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  if (link.status === 'PAUSED') {
    return NextResponse.json({ error: 'PAUSED', message: '该推广活动已结束' }, { status: 410 })
  }

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
    targetUrl:    normalizeTargetPath(link.targetUrl),
    creatorName:  link.creatorName ?? null,
    videoTitle:   link.videoTitle ?? null,
  })
}
