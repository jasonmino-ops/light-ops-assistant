/**
 * GET  /api/campaign-links  — 当前门店的推广链接列表（OWNER）
 * POST /api/campaign-links  — 新建推广短链（OWNER）
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

function genCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

export async function GET(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  if (!ctx.storeId) return NextResponse.json({ error: 'NO_STORE' }, { status: 400 })

  const links = await prisma.campaignLink.findMany({
    where: { storeId: ctx.storeId },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: {
      id: true, code: true, sourcePlatform: true,
      creatorName: true, videoTitle: true, targetUrl: true,
      viewCount: true, clickCount: true, createdAt: true,
    },
  })
  return NextResponse.json({ links })
}

export async function POST(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  if (!ctx.storeId) return NextResponse.json({ error: 'NO_STORE' }, { status: 400 })

  let body: { creatorName?: string; videoTitle?: string; sourcePlatform?: string } = {}
  try { body = await req.json() } catch { /* no body ok */ }

  const store = await prisma.store.findUnique({
    where: { id: ctx.storeId },
    select: { code: true },
  })
  if (!store) return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
  const targetUrl = `${appUrl}/menu?code=${store.code}`

  // unique code retry (collision极低，最多重试5次)
  let code = genCode()
  for (let i = 0; i < 5; i++) {
    const exists = await prisma.campaignLink.findUnique({ where: { code }, select: { id: true } })
    if (!exists) break
    code = genCode()
  }

  const link = await prisma.campaignLink.create({
    data: {
      code,
      storeId:        ctx.storeId,
      sourcePlatform: typeof body.sourcePlatform === 'string' ? body.sourcePlatform : 'tiktok',
      creatorName:    typeof body.creatorName === 'string' ? body.creatorName.trim() || null : null,
      videoTitle:     typeof body.videoTitle  === 'string' ? body.videoTitle.trim()  || null : null,
      targetUrl,
    },
  })

  return NextResponse.json(
    { ...link, shortUrl: `${appUrl}/v/${link.code}` },
    { status: 201 },
  )
}
